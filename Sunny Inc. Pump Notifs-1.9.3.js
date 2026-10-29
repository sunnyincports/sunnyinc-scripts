// ==UserScript==
// @name         Sunny Inc. Pump Notifs
// @namespace    https://sunnyinc.local/
// @version      1.9.3
// @description  Sunny Inc. pump notifications now show up natively in Rugplay
// @author       Sunny Inc. (based on work by Not_Perfect / Hoodclassic)
// @match        *://rugplay.com/*
// @icon         https://github.com/sunnyincports/sunnyinc-scripts/blob/main/Sunny%20Inc.%20Pump%20Notifs-1.9.3.png?raw=true
// @grant        unsafeWindow
// @run-at       document_start
// ==/UserScript==

(function() {
    'use strict';

    const apiGet = async (URL) => await fetch(`${URL}`, {
        method: "GET"
    }).then(r => r.ok ? r.json() : r.status);

    const OriginalWebSocket = unsafeWindow.WebSocket;
    const cooldowns = new Map();
    const holderCache = new Map();
    const COOLDOWN_MS = 30000;
    const HOLDER_CACHE_MS = 11000;
    const STORAGE_KEY = 'sunnyinc_pump_notifs';

    let cachedUserId = null;
    let cachedUsername = null;

    const PUMP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-green-500"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`;

    const ALERT_TITLE = "Pump alert!";

    // Animated rainbow text (colors flow left to right).
    const rainbowStyle = document.createElement('style');
    rainbowStyle.textContent = `
        @keyframes sunny-rainbow-flow {
            from { background-position: 0 0; }
            to   { background-position: 200px 0; }
        }
        .sunny-rainbow {
            background-image: linear-gradient(90deg, #ff0000, #ff9900, #ffee00, #22cc44, #00ccff, #3366ff, #aa44ff, #ff0000);
            background-size: 200px 100%;
            background-repeat: repeat-x;
            -webkit-background-clip: text;
            background-clip: text;
            -webkit-text-fill-color: transparent;
            color: transparent;
            font-weight: 700;
            animation: sunny-rainbow-flow 2s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
            .sunny-rainbow { animation: none; }
        }
    `;
    (document.head || document.documentElement).appendChild(rainbowStyle);

    // The site renders the native notification itself, so find its title text and style it too.
    let rainbowQueued = false;
    function applyRainbow() {
        if (rainbowQueued) return;
        rainbowQueued = true;
        requestAnimationFrame(() => {
            rainbowQueued = false;
            document.querySelectorAll('p, h1, h2, h3, h4, span, div').forEach(el => {
                if (el.classList.contains('sunny-rainbow')) return;
                if (el.childElementCount === 0 && el.textContent.trim() === ALERT_TITLE) {
                    el.classList.add('sunny-rainbow');
                }
            });
        });
    }

    // Escapes untrusted text before it is placed into innerHTML.
    function escapeHtml(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[c]));
    }

    async function getUserId() {
        if (cachedUserId) return cachedUserId;
        const r = await apiGet("https://rugplay.com/__data.json?x-sveltekit-trailing-slash=1&x-sveltekit-invalidated=10").catch(() => null);
        if (!r) return null;
        const flat = r.nodes[0].data;
        const session = flat[flat[0].userSession];
        cachedUserId = flat[session.id];
        // Username is read from the same session object (if the site provides it).
        const nameIdx = session.username;
        cachedUsername = nameIdx !== undefined ? flat[nameIdx] : null;
        return cachedUserId;
    }

    // True when the trade was made by you, so you don't get alerts for your own pumps.
    async function isOwnTrade(trade) {
        await getUserId().catch(() => null);
        if (cachedUserId && trade.userId != null && String(trade.userId) === String(cachedUserId)) return true;
        const clean = v => String(v ?? '').replace(/^@/, '').trim().toLowerCase();
        if (cachedUsername && trade.username && clean(trade.username) === clean(cachedUsername)) return true;
        return false;
    }

    async function isHolder(symbol) {
        const now = Date.now();
        const cached = holderCache.get(symbol);
        if (cached && now - cached.ts < HOLDER_CACHE_MS) return cached.result;

        const userId = await getUserId();
        if (!userId) return false;

        const data = await apiGet(`https://rugplay.com/api/coin/${encodeURIComponent(symbol)}/holders?limit=100`).catch(() => null);
        if (!data || !Array.isArray(data.holders)) return false;

        const result = data.holders.some(h => String(h.userId) === String(userId));
        holderCache.set(symbol, { result, ts: now });
        return result;
    }

    function formatAge(ts) {
        const diff = Date.now() - ts;
        const s = Math.floor(diff / 1000);
        if (s < 60) return 'Just now';
        const m = Math.floor(s / 60);
        if (m < 60) return `${m}m ago`;
        const h = Math.floor(m / 60);
        if (h < 24) return `${h}h ago`;
        return `${Math.floor(h / 24)}d ago`;
    }

    function normalizeText(s) {
        return (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function notificationKey(n) {
        return normalizeText(`${n.title}|${n.message}|${n.link}`);
    }

    function getCache() {
        try {
            const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            return [];
        }
    }

    function setCache(cache) {
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
        } catch (e) {}
    }

    function saveNotification(title, message, link) {
        const cache = getCache();
        const key = notificationKey({ title, message, link });
        if (cache.some(n => notificationKey(n) === key)) return false;
        cache.unshift({ title, message, link, ts: Date.now() });
        if (cache.length > 20) cache.pop();
        setCache(cache);
        return true;
    }

    function buildRow(notif, className) {
        const row = document.createElement('a');
        // Only allow same-site relative links (blocks javascript: and external URLs).
        const safeLink = typeof notif.link === 'string' && notif.link.startsWith('/coin/') ? notif.link : '/';
        row.href = safeLink;
        row.setAttribute('data-notif-id', notif.ts);
        row.setAttribute('data-notif-key', notificationKey(notif));
        row.className = className;
        row.innerHTML = `
            <div class="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-500/10">
                ${PUMP_SVG}
            </div>
            <div class="flex-1 space-y-1">
                <p class="text-sm font-medium leading-none" style="display:flex;align-items:center;gap:6px;">
                    <span class="sunny-rainbow">${escapeHtml(notif.title)}</span>
                </p>
                <p class="text-sm text-muted-foreground">${escapeHtml(notif.message)}</p>
            </div>
            <div class="text-xs text-muted-foreground whitespace-nowrap">${escapeHtml(formatAge(notif.ts))}</div>
        `;
        return row;
    }

    const UNIT_MS = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000, mo: 2592000000, y: 31536000000 };
    const TIME_RE = /^(just now|(\d+)\s*(mo|[smhdwy])\s*ago)$/i;
    const rowTsCache = new WeakMap();

    // Approximate timestamp of a row in the list, or null if it can't be determined.
    // Our own rows carry an exact timestamp; real rows only show text like "39m ago",
    // so we look for the leaf element whose whole text is a relative time (not the description line).
    function getRowTs(row) {
        const own = row.getAttribute('data-notif-id');
        if (own) return Number(own);

        const els = row.querySelectorAll('p, span, div');
        for (let i = els.length - 1; i >= 0; i--) {
            const el = els[i];
            if (el.childElementCount !== 0) continue;
            const text = el.textContent.trim();
            const m = text.match(TIME_RE);
            if (!m) continue;

            const cached = rowTsCache.get(row);
            if (cached && cached.text === text) return cached.ts;

            // "5m ago" means somewhere in that 5th minute, so aim for the middle of the range.
            const ts = m[2]
                ? Date.now() - (parseInt(m[2], 10) + 0.5) * UNIT_MS[m[3].toLowerCase()]
                : Date.now() - 30000;
            rowTsCache.set(row, { text, ts });
            return ts;
        }
        return null;
    }

    function getRows(container) {
        return Array.from(container.querySelectorAll(':scope > a[class*="hover:bg-muted"]'));
    }

    // The first existing row that is older than (or equal to) ts: our row goes right before it.
    function findInsertRef(container, ts, selfRow) {
        for (const r of getRows(container)) {
            if (r === selfRow) continue;
            const rts = getRowTs(r);
            if (rts === null) continue;
            if (ts >= rts) return r;
        }
        return null;
    }

    function makeSeparator(container) {
        const tpl = container.querySelector(':scope > [data-slot="separator-root"]');
        let sep;
        if (tpl) {
            sep = tpl.cloneNode(true);
            sep.removeAttribute('id');
        } else {
            sep = document.createElement('div');
            sep.className = 'bg-border shrink-0 h-px w-full';
        }
        sep.setAttribute('data-notif-sep', '1');
        return sep;
    }

    // Puts a row (plus its separator) in the right place; does nothing if it is already there.
    function placeRow(container, row, ts) {
        const ref = findInsertRef(container, ts, row);

        if (row.parentElement === container) {
            const rows = getRows(container);
            const next = rows[rows.indexOf(row) + 1] || null;
            if (next === ref) return;
        }

        let sep = row.nextElementSibling && row.nextElementSibling.hasAttribute('data-notif-sep')
            ? row.nextElementSibling
            : makeSeparator(container);

        if (ref) {
            container.insertBefore(row, ref);
            container.insertBefore(sep, ref);
        } else {
            container.appendChild(sep);
            container.appendChild(row);
        }
    }

    function findListContainer() {
        const existingRow = document.querySelector('a[class*="hover:bg-muted"]:not([data-notif-id])');
        return existingRow ? existingRow.parentElement : null;
    }

    function rowExists(listContainer, notif) {
        const key = notificationKey(notif);
        if (listContainer.querySelector(`a[data-notif-key="${CSS.escape(key)}"]`)) return true;
        return Array.from(listContainer.querySelectorAll('a[class*="hover:bg-muted"]')).some(row =>
            normalizeText(row.textContent).includes(normalizeText(notif.title)) &&
            normalizeText(row.textContent).includes(normalizeText(notif.message))
        );
    }

    function injectCachedNotifications() {
        if (!location.pathname.startsWith('/notifications')) return;
        const cache = getCache();
        if (cache.length === 0) return;
        const listContainer = findListContainer();
        if (!listContainer) return;
        cache.forEach(notif => {
            let row = listContainer.querySelector(`a[data-notif-key="${CSS.escape(notificationKey(notif))}"]`);
            if (!row) {
                if (rowExists(listContainer, notif)) return;
                row = buildRow(notif, listContainer.querySelector('a[class*="hover:bg-muted"]')?.className || '');
            }
            placeRow(listContainer, row, notif.ts);
        });
    }

    unsafeWindow.WebSocket = new Proxy(OriginalWebSocket, {
        construct(target, args) {
            const ws = new target(...args);

            ws.addEventListener('message', async (eventRaw) => {
                try {
                    const event = JSON.parse(eventRaw.data);
                    const data = event?.data ?? 0;

                    if (event.type === "all-trades" && data.type == "BUY") {
                        const now = Date.now();
                        const lastAlert = cooldowns.get(data.coinSymbol) || 0;
                        if (now - lastAlert < COOLDOWN_MS) return;

                        let baseCurrencyNew = Math.sqrt(data.price * 1e12);
                        let oldPrice = ((baseCurrencyNew - data.totalValue) ** 2) / 1e12;
                        let increase = ((data.price - oldPrice) / oldPrice) * 100;

                        if (increase > 20) {
                            if (await isOwnTrade(data)) return;
                            const holding = await isHolder(data.coinSymbol);
                            if (holding) {
                                cooldowns.set(data.coinSymbol, now);

                                const userId = await getUserId();
                                const title = ALERT_TITLE;
                                const message = `${data.coinName} (*${data.coinSymbol}) was pumped ${increase.toFixed(1)}% by @${data.username}!`;
                                const link = `/coin/${encodeURIComponent(data.coinSymbol)}`;

                                const saved = saveNotification(title, message, link);

                                if (saved || location.pathname.startsWith('/notifications')) {
                                    ws.dispatchEvent(new MessageEvent("message", {
                                        data: JSON.stringify({
                                            type: "notification",
                                            timestamp: new Date().toISOString(),
                                            userId: userId,
                                            notificationType: "TRANSFER",
                                            title: title,
                                            message: message,
                                            link: link
                                        })
                                    }));
                                }
                            }
                        }
                    }
                } catch (e) {}
            });

            return ws;
        }
    });

    const observer = new MutationObserver(() => {
        if (location.pathname.startsWith('/notifications')) {
            injectCachedNotifications();
        }
        applyRainbow();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    getUserId();

})();