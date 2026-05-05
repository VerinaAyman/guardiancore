// GuardianCore Content Script - Intelligent Content Classification
// Runs silently in the background. No overlays, no scanning screens.

(function() {
  'use strict';

  if (window.__guardiancore_content_script_loaded) return;
  window.__guardiancore_content_script_loaded = true;

  // ─── Instant Block Domains ────────────────────────────────────────────────
  // These redirect immediately at the content-script level (belt-and-suspenders
  // on top of DNR rules). Silent — no overlay, just redirect.
  const INSTANT_BLOCK_DOMAINS = [
    'pornhub.com', 'xvideos.com', 'xnxx.com', 'xhamster.com', 'redtube.com',
    'youporn.com', 'tube8.com', 'spankbang.com', 'thisvid.com', 'rule34.xxx',
    'hentaihaven.xxx', 'nhentai.net', 'fakku.net', 'e-hentai.org',
    'onlyfans.com', 'fansly.com', 'manyvids.com',
    'chaturbate.com', 'cam4.com', 'livejasmin.com', 'stripchat.com',
    'brazzers.com', 'bangbros.com', 'naughtyamerica.com',
  ];

  // ─── Helpers ──────────────────────────────────────────────────────────────
  function getDomain(url) {
    try { return new URL(url).hostname.replace('www.', ''); } catch { return ''; }
  }

  function isInstantBlock() {
    const d = getDomain(window.location.href);
    return INSTANT_BLOCK_DOMAINS.some(b => d === b || d.endsWith('.' + b));
  }

  function shouldSkipAnalysis() {
    const url = window.location.href;
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return true;
    if (url.startsWith('about:') || url.startsWith('file://')) return true;
    if (url.includes('newtab')) return true;
    return false;
  }

  // ─── Silent redirect for blocked domains ──────────────────────────────────
  function silentBlock(category, reason, url) {
    window.location.replace(
      chrome.runtime.getURL('blocked.html') +
      '?category=' + encodeURIComponent(category || 'Restricted content') +
      '&reason='   + encodeURIComponent(reason || '') +
      '&url='      + encodeURIComponent(url || window.location.href)
    );
  }

  // ─── Text extraction ──────────────────────────────────────────────────────
  function extractPageText() {
    try {
      const contentSelectors = [
        'article', 'main', '.post', '.content',
        'p', '.comment', '.message', '.description',
        '.postMessage', '.reply', '.op',
        '.Post', '[data-testid="post-content"]', '.Comment',
        '#description', '#comments',
        '[data-testid="tweetText"]',
        '.forum-post', '.user-content', '.post-body',
        '[data-e2e="video-desc"]', '[data-e2e="comment-level-1"]',
        '[data-e2e="search-card-desc"]',
        'h1', 'h2', 'h3',
        'ytd-video-secondary-info-renderer',
        'shreddit-post',
        '[class*="message"]', '[class*="chat"]', '[class*="title"]'
      ];
      let text = '';
      for (const selector of contentSelectors) {
        document.querySelectorAll(selector).forEach(el => { text += ' ' + el.innerText; });
        if (text.length > 500) break;
      }
      if (text.length < 200) text = document.body ? document.body.innerText : '';
      return text.replace(/\s+/g, ' ').trim().slice(0, 5000);
    } catch {
      return '';
    }
  }

  // ─── Handle pipeline response ─────────────────────────────────────────────
  function handleAnalysisResponse(response) {
    if (!response) return;

    console.log('[GuardianCore] Analysis result:', response.action, '|', response.category, '| confidence:', response.confidence);

    if (!response.safe && response.action === 'blocked') {
      // Hard block — silent redirect, no overlay
      silentBlock(response.category, response.child_message, window.location.href);
      return;
    }

    if (!response.safe) {
      // Warn — fire the side bubble only, page stays loaded
      chrome.runtime.sendMessage({
        type: 'LENS_TRIGGER',
        risk: response.stage ? response.stage * 33 : 50,
        category: response.category || 'Potentially inappropriate',
        summary: response.child_message || 'This page may contain content worth a quick chat.',
        domain: window.location.hostname
      });
      return;
    }

    // Safe — do nothing, page loads normally
  }

  // ─── Main analysis flow ───────────────────────────────────────────────────
  function requestAnalysis() {
    if (shouldSkipAnalysis()) return;

    const pageText = extractPageText();
    if (!pageText || pageText.length < 50) return;

    chrome.runtime.sendMessage(
      { type: 'ANALYZE_PAGE', url: window.location.href, text: pageText },
      (response) => {
        if (chrome.runtime.lastError) return;
        handleAnalysisResponse(response);
      }
    );
  }

  // ─── Entry point ──────────────────────────────────────────────────────────
  function init() {
    if (shouldSkipAnalysis()) return;

    // Instant block — redirect before user sees anything
    if (isInstantBlock()) {
      silentBlock('Adult content', 'This site is not allowed.', window.location.href);
      return;
    }

    // Everything else: let the page load normally, run pipeline after content is ready
    if (document.readyState === 'complete') {
      setTimeout(requestAnalysis, 1500);
    } else {
      window.addEventListener('load', () => setTimeout(requestAnalysis, 1500));
    }
  }

  init();

  // ─── SPA navigation (React/Vue/YouTube etc.) ──────────────────────────────
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (isInstantBlock()) {
        silentBlock('Adult content', 'This site is not allowed.', window.location.href);
        return;
      }
      setTimeout(requestAnalysis, 1000);
    }
  }).observe(document.body, { childList: true, subtree: true });

  // ─── Dynamic content watchers (comments, chat, feeds) ────────────────────
  let dynamicTimer = null;
  const dynamicObserver = new MutationObserver(() => {
    clearTimeout(dynamicTimer);
    dynamicTimer = setTimeout(requestAnalysis, 3000);
  });

  function attachDynamicWatchers() {
    [
      '#comments',
      '[data-testid="primaryColumn"]',
      '.chat-line__message',
      '#chat-messages',
      '.comment-list',
    ].forEach(selector => {
      const el = document.querySelector(selector);
      if (el) dynamicObserver.observe(el, { childList: true, subtree: true });
    });
  }

  attachDynamicWatchers();
  setTimeout(attachDynamicWatchers, 3000);

})();