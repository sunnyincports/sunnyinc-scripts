// ==UserScript==
// @name         Rugplay AMM Sell Calculator
// @namespace    Sunny Inc.
// @version      1.0.2
// @description  Show estimated cash for all available tokens in an open Rugplay Sell dialog.
// @match        https://rugplay.com/*
// @match        https://www.rugplay.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  const FEE = 0.003;
  const DIALOG_SELECTOR = '[data-slot="dialog-content"]';
  const PANEL_ATTRIBUTE = 'data-rugplay-amm-sell-calculator';
  const SUFFIX_MULTIPLIERS = {
    K: 1e3,
    M: 1e6,
    B: 1e9,
    T: 1e12
  };
  const localeParts = new Intl.NumberFormat().formatToParts(12345.6);
  const groupSeparator = localeParts.find((part) => part.type === 'group')?.value || ',';
  const decimalSeparator = localeParts.find((part) => part.type === 'decimal')?.value || '.';
  let scanQueued = false;

  function normalizedText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function parseVisibleNumber(value) {
    let text = normalizedText(value).replace(/[\u00a0\u202f]/g, '');
    const suffixMatch = text.match(/([KMBT])\s*$/i);
    const multiplier = suffixMatch ? SUFFIX_MULTIPLIERS[suffixMatch[1].toUpperCase()] : 1;
    if (suffixMatch) text = text.slice(0, suffixMatch.index);

    text = text.replace(/[^\d.,+\-]/g, '');
    if (groupSeparator) text = text.split(groupSeparator).join('');
    if (decimalSeparator && decimalSeparator !== '.') {
      text = text.replace(decimalSeparator, '.');
    }

    const number = Number(text);
    return Number.isFinite(number) ? number * multiplier : null;
  }

  function readPoolReserves() {
    const heading = [...document.querySelectorAll('h4')].find(
      (element) => normalizedText(element.textContent).toLowerCase() === 'pool composition'
    );
    const section = heading?.parentElement;
    if (!section) return null;

    let base = null;
    let tokens = null;
    let symbol = null;

    for (const row of section.querySelectorAll('div.flex.justify-between')) {
      const spans = [...row.querySelectorAll('span')];
      if (spans.length < 2) continue;

      const label = normalizedText(spans[0].textContent);
      const value = normalizedText(spans[1].textContent);

      if (label.toLowerCase() === 'base currency:') {
        base = parseVisibleNumber(value);
      } else if (label.endsWith(':') && tokens === null) {
        const parsed = parseVisibleNumber(value);
        if (parsed !== null) {
          symbol = label.slice(0, -1).trim();
          tokens = parsed;
        }
      }
    }

    if (base === null || tokens === null || !symbol) return null;
    return { base, tokens, symbol };
  }

  function readAvailableTokens(dialog) {
    const availableText = [...dialog.querySelectorAll('p')].find((element) =>
      normalizedText(element.textContent).toLowerCase().startsWith('available:')
    );
    if (!availableText) return null;

    const match = normalizedText(availableText.textContent).match(/^Available:\s*([\d,.]+)/i);
    if (!match) return null;

    const quantity = Number(match[1].replace(/,/g, ''));
    return Number.isFinite(quantity) && quantity >= 0 ? quantity : null;
  }

  function isSellSelected(dialog) {
    const tablist = dialog.querySelector('[role="tablist"][aria-label="Trade side"]');
    if (!tablist) return false;

    return [...tablist.querySelectorAll('[role="tab"]')].some(
      (tab) =>
        normalizedText(tab.textContent).toLowerCase() === 'sell' &&
        tab.getAttribute('aria-selected') === 'true'
    );
  }

  function calculateCashOut(base, tokens, quantity) {
    if (
      !Number.isFinite(base) ||
      !Number.isFinite(tokens) ||
      !Number.isFinite(quantity) ||
      base <= 0 ||
      tokens <= 0 ||
      quantity < 0
    ) {
      return null;
    }

    const netTokens = quantity * (1 - FEE);
    return (base * netTokens) / (tokens + netTokens);
  }

  function formatCurrency(value) {
    if (!Number.isFinite(value)) return '—';
    return `$${new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6
    }).format(value)}`;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function panelMarkup(pool, availableTokens) {
    const cashOut =
      pool && availableTokens !== null
        ? calculateCashOut(pool.base, pool.tokens, availableTokens)
        : null;
    const value =
      availableTokens === null
        ? 'Available balance unavailable'
        : cashOut === null
          ? 'Estimate unavailable'
          : formatCurrency(cashOut);

    return `<div class="flex items-center justify-between gap-3">
      <span class="text-muted-foreground text-sm">Balance converted to money:</span>
      <strong class="text-muted-foreground text-sm">${escapeHtml(value)}</strong>
    </div>`;
  }

  function removePanel(dialog) {
    dialog.querySelector(`[${PANEL_ATTRIBUTE}]`)?.remove();
  }

  function updateDialog(dialog) {
    const open = dialog.getAttribute('data-state') === 'open';
    if (!open || !isSellSelected(dialog)) {
      removePanel(dialog);
      return;
    }

    const pool = readPoolReserves();
    const availableTokens = readAvailableTokens(dialog);
    let panel = dialog.querySelector(`[${PANEL_ATTRIBUTE}]`);

    if (!panel) {
      panel = document.createElement('section');
      panel.setAttribute(PANEL_ATTRIBUTE, '');
      panel.className = 'mt-3 border-t border-border pt-3 text-card-foreground';
      dialog.appendChild(panel);
    }

    const markup = panelMarkup(pool, availableTokens);
    if (panel._rugplayMarkup !== markup) {
      panel.innerHTML = markup;
      panel._rugplayMarkup = markup;
    }
  }

  function scanDialogs() {
    for (const dialog of document.querySelectorAll(DIALOG_SELECTOR)) {
      if (dialog.querySelector('[role="tablist"][aria-label="Trade side"]')) {
        updateDialog(dialog);
      } else {
        removePanel(dialog);
      }
    }
  }

  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(() => {
      scanQueued = false;
      scanDialogs();
    });
  }

  new MutationObserver(queueScan).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['aria-selected', 'data-state']
  });

  document.addEventListener(
    'click',
    (event) => {
      if (event.target?.closest?.(DIALOG_SELECTOR)) queueScan();
    },
    true
  );

  scanDialogs();
})();
