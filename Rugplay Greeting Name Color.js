// ==UserScript==
// @name         Rugplay Greeting Name Color
// @namespace    Sunny Inc.
// @version      1.0.1
// @description  Show your equipped Rugplay name color in the home greeting.
// @match        https://rugplay.com/*
// @match        https://www.rugplay.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  const HOME_PATH = '/';
  const GREETING_PATTERN = /^(Good (?:morning|afternoon|evening|night),\s*)(.+)$/;
  const USERNAME_PATTERN = /^@([a-z0-9_]{3,30})$/i;

  // These keys and colors match Rugplay's name-color catalog in the supplied source.
  const NAME_COLORS = {
    green: { color: '#22c55e' },
    blue: { color: '#3b82f6' },
    orange: { color: '#fb923c' },
    purple: { color: '#a855f7' },
    red: { color: '#ef4444' },
    gold: { color: '#facc15' },
    fire: { gradient: 'linear-gradient(90deg, #f97316, #ef4444, #f59e0b)' },
    ocean: { gradient: 'linear-gradient(90deg, #06b6d4, #3b82f6, #8b5cf6)' },
    rainbow: {
      gradient: 'linear-gradient(90deg, #ef4444, #f97316, #eab308, #22c55e, #3b82f6, #8b5cf6, #ec4899)',
      animation: 'rainbow'
    },
    diamond: {
      gradient: 'linear-gradient(135deg, #e2e8f0, #67e8f9, #c084fc, #e2e8f0)',
      animation: 'diamond'
    }
  };

  const colorCache = new Map();
  let updateQueued = false;

  function ensureAnimationStyles() {
    if (document.getElementById('rugplay-greeting-name-color-styles')) return;

    const style = document.createElement('style');
    style.id = 'rugplay-greeting-name-color-styles';
    style.textContent = `
      .rugplay-greeting-name-color--gradient {
        color: transparent !important;
        -webkit-text-fill-color: transparent !important;
        background-color: transparent !important;
        background-clip: text !important;
        -webkit-background-clip: text !important;
      }
      .rugplay-greeting-name-color--rainbow {
        background-size: 200% auto;
        animation: rugplay-greeting-rainbow 3s linear infinite;
      }
      .rugplay-greeting-name-color--diamond {
        background-size: 200% auto;
        animation: rugplay-greeting-diamond 4s ease-in-out infinite;
      }
      @keyframes rugplay-greeting-rainbow {
        0%, 100% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
      }
      @keyframes rugplay-greeting-diamond {
        0%, 100% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
      }
      @media (prefers-reduced-motion: reduce) {
        .rugplay-greeting-name-color--rainbow,
        .rugplay-greeting-name-color--diamond {
          animation: none;
        }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function readGreeting() {
    if (window.location.pathname !== HOME_PATH) return null;

    for (const heading of document.querySelectorAll('h1')) {
      const match = (heading.textContent || '').trim().match(GREETING_PATTERN);
      if (match) return { heading, prefix: match[1], name: match[2] };
    }

    return null;
  }

  function readCurrentUsername(displayName) {
    const accountFooter = document.querySelector('[data-sidebar="footer"]');
    if (!accountFooter) return null;

    for (const button of accountFooter.querySelectorAll('[data-sidebar="menu-button"]')) {
      const spans = [...button.querySelectorAll('span')];
      const hasDisplayName = spans.some((span) => (span.textContent || '').trim() === displayName);
      if (!hasDisplayName) continue;

      for (const span of spans) {
        const match = (span.textContent || '').trim().match(USERNAME_PATTERN);
        if (match) return match[1];
      }
    }

    return null;
  }

  async function getEquippedColor(username) {
    const cacheKey = username.toLowerCase();
    if (colorCache.has(cacheKey)) return colorCache.get(cacheKey);

    const request = (async () => {
      try {
        const response = await fetch(
          `${window.location.origin}/api/user/${encodeURIComponent(username)}`,
          {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' }
          }
        );
        if (!response.ok) return null;

        const result = await response.json();
        const profile = result?.profile;
        if (!profile?.username || profile.username.toLowerCase() !== cacheKey) return null;

        return Object.hasOwn(NAME_COLORS, profile.nameColor) ? profile.nameColor : null;
      } catch {
        return null;
      }
    })();

    colorCache.set(cacheKey, request);
    const colorKey = await request;
    colorCache.set(cacheKey, colorKey);
    return colorKey;
  }

  function applyColor(heading, prefix, name, username, colorKey) {
    const color = NAME_COLORS[colorKey];
    if (!color) return;
    ensureAnimationStyles();

    const existing = [...heading.children].find((child) =>
      child.hasAttribute('data-rugplay-greeting-name')
    );
    if (
      existing &&
      existing.dataset.username?.toLowerCase() === username.toLowerCase() &&
      existing.dataset.colorKey === colorKey &&
      existing.textContent === name
    ) {
      return;
    }

    const nameElement = document.createElement('span');
    nameElement.setAttribute('data-rugplay-greeting-name', '');
    nameElement.dataset.username = username;
    nameElement.dataset.colorKey = colorKey;
    nameElement.textContent = name;

    if (color.color) {
      nameElement.style.color = color.color;
    } else {
      nameElement.classList.add('rugplay-greeting-name-color--gradient');
      nameElement.style.backgroundImage = color.gradient;
      if (color.animation) {
        nameElement.classList.add(`rugplay-greeting-name-color--${color.animation}`);
      }
    }

    heading.replaceChildren(document.createTextNode(prefix), nameElement);
  }

  async function updateGreeting() {
    const greeting = readGreeting();
    if (!greeting) return;

    const username = readCurrentUsername(greeting.name);
    if (!username) return;

    const colorKey = await getEquippedColor(username);
    if (!colorKey || window.location.pathname !== HOME_PATH) return;

    const currentGreeting = readGreeting();
    if (!currentGreeting || currentGreeting.name !== greeting.name) return;

    const currentUsername = readCurrentUsername(currentGreeting.name);
    if (currentUsername?.toLowerCase() !== username.toLowerCase()) return;

    applyColor(currentGreeting.heading, currentGreeting.prefix, currentGreeting.name, username, colorKey);
  }

  function queueUpdate() {
    if (updateQueued) return;
    updateQueued = true;
    requestAnimationFrame(() => {
      updateQueued = false;
      void updateGreeting();
    });
  }

  void updateGreeting();
  new MutationObserver(queueUpdate).observe(document.body, {
    childList: true,
    subtree: true
  });
})();
