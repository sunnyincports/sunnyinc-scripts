// ==UserScript==
// @name         Rugplay Watchlist Ticker
// @namespace    Sunny Inc.
// @version      1.0.0
// @description  Move the Rugplay watchlist items to the right in a seamless loop.
// @match        https://rugplay.com/*
// @match        https://www.rugplay.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  const LABEL = 'watchlist';
  const CLONE_ATTRIBUTE = 'data-rugplay-watchlist-clone';
  const VIEWPORT_CLASS = 'rugplay-watchlist-ticker-viewport';
  const STYLE_ID = 'rugplay-watchlist-ticker-styles';
  const SPEED_PX_PER_SECOND = 50;

  const states = new WeakMap();
  const activeContainers = new Set();
  const boundContainers = new WeakSet();
  let currentContainer = null;
  let refreshQueued = false;
  let forceRefreshQueued = false;
  let animationRunning = false;
  let lastFrameTime = null;

  function normalizedText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${VIEWPORT_CLASS} {
        overflow-x: hidden !important;
        scroll-behavior: auto !important;
        scrollbar-width: none !important;
      }
      .${VIEWPORT_CLASS}::-webkit-scrollbar {
        display: none !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function findWatchlistViewport() {
    const heading = [...document.querySelectorAll('h2')].find(
      (element) => normalizedText(element.textContent).toLowerCase() === LABEL
    );
    const row = heading?.parentElement?.parentElement;
    if (!row) return null;

    return [...row.children].find((element) =>
      [...element.children].some(
        (child) =>
          child.tagName === 'A' &&
          (child.getAttribute('href') || '').startsWith('/coin/')
      )
    ) || null;
  }

  function getOriginalItems(container) {
    return [...container.children].filter(
      (child) =>
        child.tagName === 'A' &&
        (child.getAttribute('href') || '').startsWith('/coin/') &&
        !child.hasAttribute(CLONE_ATTRIBUTE)
    );
  }

  function getSignature(items) {
    return items
      .map((item) => `${item.getAttribute('href') || ''}|${item.innerHTML}`)
      .join('\u001f');
  }

  function getGap(container) {
    const style = window.getComputedStyle(container);
    const gap = Number.parseFloat(style.columnGap || style.gap);
    return Number.isFinite(gap) ? gap : 0;
  }

  function removeClones(container) {
    for (const child of [...container.children]) {
      if (child.hasAttribute(CLONE_ATTRIBUTE)) child.remove();
    }
  }

  function bindPauseEvents(container) {
    if (boundContainers.has(container)) return;
    boundContainers.add(container);

    const pause = () => {
      const state = states.get(container);
      if (state) state.paused = true;
    };
    const resume = () => {
      const state = states.get(container);
      if (state) state.paused = false;
    };

    container.addEventListener('pointerenter', pause);
    container.addEventListener('pointerleave', resume);
    container.addEventListener('focusin', pause);
    container.addEventListener('focusout', (event) => {
      if (!container.contains(event.relatedTarget)) resume();
    });
  }

  function reducedMotionRequested() {
    return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  }

  function refreshContainer(container, force = false) {
    const previous = states.get(container);
    const originals = getOriginalItems(container);
    const signature = getSignature(originals);

    if (!force && previous && previous.signature === signature) return;

    const progress = previous?.active && previous.period > 0
      ? Math.max(0, Math.min(1, (previous.period - previous.position) / previous.period))
      : 0;
    const wasPaused = previous?.paused || false;

    removeClones(container);
    activeContainers.delete(container);

    if (originals.length < 2 || container.clientWidth === 0 || reducedMotionRequested()) {
      container.classList.remove(VIEWPORT_CLASS);
      container.scrollLeft = 0;
      states.set(container, { active: false, signature, paused: wasPaused });
      return;
    }

    const widths = originals.map((item) => item.getBoundingClientRect().width);
    const gap = getGap(container);
    const itemsWidth = widths.reduce((sum, width) => sum + width, 0);
    const contentWidth = itemsWidth + gap * Math.max(0, originals.length - 1);

    if (contentWidth <= container.clientWidth + 1) {
      container.classList.remove(VIEWPORT_CLASS);
      container.scrollLeft = 0;
      states.set(container, { active: false, signature, paused: wasPaused });
      return;
    }

    const period = itemsWidth + gap * originals.length;
    for (const item of originals) {
      const clone = item.cloneNode(true);
      clone.setAttribute(CLONE_ATTRIBUTE, '');
      clone.setAttribute('aria-hidden', 'true');
      clone.tabIndex = -1;
      container.appendChild(clone);
    }

    container.classList.add(VIEWPORT_CLASS);
    const position = previous?.active ? period * (1 - progress) : period;
    const state = { active: true, signature, period, position, paused: wasPaused };
    states.set(container, state);
    activeContainers.add(container);
    container.scrollLeft = position;
    bindPauseEvents(container);
    startAnimation();
  }

  function cleanUpContainer(container) {
    if (!container) return;
    removeClones(container);
    container.classList.remove(VIEWPORT_CLASS);
    container.scrollLeft = 0;
    activeContainers.delete(container);
    states.delete(container);
  }

  function refresh() {
    const nextContainer = findWatchlistViewport();
    if (nextContainer !== currentContainer) {
      if (currentContainer) resizeObserver?.unobserve(currentContainer);
      cleanUpContainer(currentContainer);
      currentContainer = nextContainer;
      if (currentContainer) resizeObserver?.observe(currentContainer);
    }

    if (currentContainer) refreshContainer(currentContainer);
  }

  function queueRefresh(force = false) {
    forceRefreshQueued = forceRefreshQueued || force;
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
      refreshQueued = false;
      const shouldForce = forceRefreshQueued;
      forceRefreshQueued = false;
      const nextContainer = findWatchlistViewport();
      if (nextContainer !== currentContainer) {
        if (currentContainer) resizeObserver?.unobserve(currentContainer);
        cleanUpContainer(currentContainer);
        currentContainer = nextContainer;
        if (currentContainer) resizeObserver?.observe(currentContainer);
      }
      if (currentContainer) refreshContainer(currentContainer, shouldForce);
    });
  }

  function startAnimation() {
    if (animationRunning || activeContainers.size === 0) return;
    animationRunning = true;
    requestAnimationFrame(animate);
  }

  function animate(time) {
    if (activeContainers.size === 0) {
      animationRunning = false;
      lastFrameTime = null;
      return;
    }

    const elapsed = lastFrameTime === null ? 0 : Math.min(time - lastFrameTime, 100);
    lastFrameTime = time;

    if (!document.hidden) {
      for (const container of activeContainers) {
        const state = states.get(container);
        if (!container.isConnected) {
          activeContainers.delete(container);
          states.delete(container);
          continue;
        }
        if (!state?.active || state.paused) continue;

        state.position -= (SPEED_PX_PER_SECOND * elapsed) / 1000;
        if (state.position <= 0) state.position += state.period;
        container.scrollLeft = state.position;
      }
    } else {
      lastFrameTime = time;
    }

    requestAnimationFrame(animate);
  }

  const resizeObserver = typeof ResizeObserver === 'undefined'
    ? null
    : new ResizeObserver(() => queueRefresh(true));

  const mutationObserver = new MutationObserver(() => queueRefresh());
  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['href']
  });

  window.addEventListener('resize', () => queueRefresh(true), { passive: true });
  window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', () => queueRefresh(true));

  ensureStyles();
  refresh();
})();
