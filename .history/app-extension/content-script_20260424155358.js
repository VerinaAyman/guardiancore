// GuardianCore Content Script - Intelligent Content Classification
// Runs silently in the background. No overlays, no scanning screens.

(function() {
  'use strict';

  if (window.__guardiancore_content_script_loaded) return;
  window.__guardiancore_content_script_loaded = true;

  // ─── Instant Block Domains ────────────────────────────────────────────────
  // Silent redirect before user sees anything — no UI, just redirect.
  const INSTANT_BLOCK_DOMAINS = [
    'pornhub.com', 'xvideos.com', 'xnxx.com', 'xhamster.com', 'redtube.com',
    'youporn.com', 'tube8.com', 'spankbang.com', 'thisvid.com', 'rule34.xxx',
    'hentaihaven.xxx', 'nhentai.net', 'fakku.net', 'e-hentai.org',
    'onlyfans.com', 'fansly.com', 'manyvids.com',
    'chaturbate.com', 'cam4.com', 'livejasmin.com', 'stripchat.com',
    'brazzers.com', 'bangbros.com', 'naughtyamerica.com',
  ];

  // ─── Risky Domains ───────────────────────────────────────────────────────
  // Known borderline domains — page is hidden instantly (no UI shown),
  // pipeline runs, then page is revealed or blocked based on result.
  const RISKY_DOMAINS = [
    'tumblr.com', 'wattpad.com', 'archiveofourown.org', 'ao3.org',
    'reddit.com', 'twitter.com', 'x.com', 'deviantart.com',
    'urbandictionary.com', 'chatroulette.com', 'omegle.com',
    '4chan.org', '8kun.top',
  ];

  // ─── Helpers ──────────────────────────────────────────────────────────────
  function getDomain(url) {
    try { return new URL(url).hostname.replace('www.', ''); } catch { return ''; }
  }

  function isInstantBlock() {
    const d = getDomain(window.location.href);
    return INSTANT_BLOCK_DOMAINS.some(b => d === b || d.endsWith('.' + b));
  }

  function isRiskyDomain() {
    const d = getDomain(window.location.href);
    return RISKY_DOMAINS.some(b => d === b || d.endsWith('.' + b));
  }

  function shouldSkipAnalysis() {
    const url = window.location.href;
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return true;
    if (url.startsWith('about:') || url.startsWith('file://')) return true;
    if (url.includes('newtab')) return true;
    return false;
  }

  // ─── Visibility control (risky domains only, no UI) ───────────────────────
  function hidePage() {
    document.documentElement.style.visibility = 'hidden';
  }

  function showPage() {
    document.documentElement.style.visibility = '';
  }

  // ─── Silent redirect for blocked domains ──────────────────────────────────
  function silentBlock(category, reason, url) {
    showPage();
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
  function handleAnalysisResponse(response, wasHidden) {
    if (!response) {
      if (wasHidden) showPage();
      return;
    }

    console.log('[GuardianCore] Analysis result:', response.action, '|', response.category, '| confidence:', response.confidence);

    if (!response.safe && response.action === 'blocked') {
      // Hard block — stays hidden until blocked.html loads
      silentBlock(response.category, response.child_message, window.location.href);
      return;
    }

    if (!response.safe) {
      // Warn — reveal page + fire side bubble
      if (wasHidden) showPage();
      chrome.runtime.sendMessage({
        type: 'LENS_TRIGGER',
        risk: response.stage ? response.stage * 33 : 50,
        category: response.category || 'Potentially inappropriate',
        summary: response.child_message || 'This page may contain content worth a quick chat.',
        domain: window.location.hostname
      });
      return;
    }

    // Safe — reveal page, nothing else
    if (wasHidden) showPage();
  }

  // ─── Main analysis flow ───────────────────────────────────────────────────
  function requestAnalysis(wasHidden) {
    if (shouldSkipAnalysis()) {
      if (wasHidden) showPage();
      return;
    }

    const pageText = extractPageText();
    if (!pageText || pageText.length < 50) {
      if (wasHidden) showPage();
      return;
    }

    chrome.runtime.sendMessage(
      { type: 'ANALYZE_PAGE', url: window.location.href, text: pageText },
      (response) => {
        if (chrome.runtime.lastError) {
          if (wasHidden) showPage();
          return;
        }
        handleAnalysisResponse(response, wasHidden);
      }
    );
  }

  // ─── Entry point ──────────────────────────────────────────────────────────
  function init() {
    if (shouldSkipAnalysis()) return;

    if (isInstantBlock()) {
      silentBlock('Adult content', 'This site is not allowed.', window.location.href);
      return;
    }

    const risky = isRiskyDomain();
    if (risky) hidePage(); // invisible hold — no UI shown to user

    if (document.readyState === 'complete') {
      setTimeout(() => requestAnalysis(risky), 1500);
    } else {
      window.addEventListener('load', () => setTimeout(() => requestAnalysis(risky), 1500));
    }
  }

  init();

  // ─── SPA navigation ───────────────────────────────────────────────────────
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (isInstantBlock()) {
        silentBlock('Adult content', 'This site is not allowed.', window.location.href);
        return;
      }
      const risky = isRiskyDomain();
      if (risky) hidePage();
      setTimeout(() => requestAnalysis(risky), 1000);
    }
  }).observe(document.body, { childList: true, subtree: true });

  // ─── Dynamic content watchers ─────────────────────────────────────────────
  let dynamicTimer = null;
  const dynamicObserver = new MutationObserver(() => {
    clearTimeout(dynamicTimer);
    dynamicTimer = setTimeout(() => requestAnalysis(false), 3000);
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