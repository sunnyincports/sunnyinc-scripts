// ==UserScript==
// @name         Rugplay QOL (Sunny inc. Port)
// @namespace    sunny.inc
// @version      2026-03-11
// @description  Rugplay QOL: shows 7 recent trades in the sidebar, hides sub-$10 bot trades in the live feed, and speeds up coinflip/slots in the arcade. Original script by Not_Perfect; maintained and rebranded by Sunny inc.
// @author       Not_Perfect (original), Sunny inc.
// @match        *://rugplay.com/*
// @icon         https://github.com/sunnyincports/sunnyinc-scripts/blob/main/Rugplay%20QOL%20(Sunny%20inc.%20Port)-2026-03-11.png?raw=true
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    "use strict";

    /* ------------------------------------------------------------------ *
     *  Rugplay QOL
     *  Original author : Not_Perfect
     *  Maintained by   : Sunny inc.
     * ------------------------------------------------------------------ */

    const SIDEBAR_LIMIT     = 7;    // sidebar used to show 5 trades (was 10 in the Sunny inc. fork)
    const COMPACT_LIMIT     = 6;    // compact/mobile list used to show 4 (original author's tuning)
    const MIN_TRADE_VALUE   = 10;   // hide live-feed trades below $10 (bots)
    const HIDE_SMALL_TRADES = true; // client-side safety net for the live feed
    const SPEED_UP_ARCADE   = true; // coinflip / slots

    /* ---------------------- fetch interception ------------------------ */

    const originalFetch = window.fetch;

    window.fetch = async function (...args) {
        let shouldFilter = false;

        const raw = args[0];
        let urlStr = null;
        if (typeof raw === "string")     urlStr = raw;
        else if (raw instanceof Request) urlStr = raw.url;
        else if (raw instanceof URL)     urlStr = raw.href;

        if (urlStr && urlStr.includes("/api/trades/recent")) {
            let u = null;
            try { u = new URL(urlStr, location.origin); } catch (_) { /* ignore */ }

            if (u) {
                let changed = false;

                // 1) Sidebar: 5 -> SIDEBAR_LIMIT
                if (u.searchParams.get("limit") === "5") {
                    u.searchParams.set("limit", String(SIDEBAR_LIMIT));
                    changed = true;
                }

                // 2) Live feed: ask the API to drop small trades …
                if (u.searchParams.get("limit") === "100") {
                    u.searchParams.set("minValue", String(MIN_TRADE_VALUE));
                    shouldFilter = true;
                    changed = true;
                }

                // Only rewrite when we can and when something actually changed.
                if (changed && (typeof raw === "string" || raw instanceof URL)) {
                    args[0] = u.toString();
                }
            }
        }

        const res = await originalFetch(...args);

        // … and enforce it client-side too (in case the API ignores minValue).
        if (HIDE_SMALL_TRADES && shouldFilter) {
            try {
                const data = await res.clone().json();

                if (Array.isArray(data)) {
                    const filtered = data.filter(
                        (t) => t && Number(t.totalValue) >= MIN_TRADE_VALUE
                    );

                    if (filtered.length !== data.length) {
                        const headers = new Headers(res.headers);
                        // Body is now plain JSON, so the original
                        // encoding/length headers would be wrong.
                        headers.delete("content-length");
                        headers.delete("content-encoding");

                        return new Response(JSON.stringify(filtered), {
                            status: res.status,
                            statusText: res.statusText,
                            headers,
                        });
                    }
                }
            } catch (_) {
                // Non-JSON body or already-consumed stream: leave it alone.
            }
        }

        return res;
    };

    /* ------------------- sidebar trade count (slice) ------------------ */

    const originalSlice = Array.prototype.slice;

    const TRADE_FIELDS = [
        "amount", "coinIcon", "coinName", "coinSymbol", "price",
        "timestamp", "totalValue", "type", "userId", "userImage", "username",
    ];

    Array.prototype.slice = function (start, end) {
        const first = this[0];

        if (
            this.length > 0 &&
            first !== null &&
            typeof first === "object" &&
            TRADE_FIELDS.every((field) => field in first)
        ) {
            if (start === 0) {
                if (end === 5) {
                    end = SIDEBAR_LIMIT;       // sidebar: 5 -> 7
                } else if (end === 4) {
                    end = COMPACT_LIMIT;       // compact list: 4 -> 6
                }
            }
        }

        return originalSlice.call(this, start, end);
    };

    /* ---------------------- arcade speed-up --------------------------- */

    const originalSetTimeout = window.setTimeout;

    window.setTimeout = function (fn, delay, ...rest) {
        if (SPEED_UP_ARCADE) {
            const src = typeof fn === "function"
                ? Function.prototype.toString.call(fn)
                : "";

            if (src.includes("3 OF A KIND")) {
                // Slots win handler
                delay = 0;
            } else if (delay === 2000) {
                // Coinflip target/result timeout (the only 2000 ms timers on the site)
                delay = 0;
            }
        }

        return originalSetTimeout.call(window, fn, delay, ...rest);
    };

})();