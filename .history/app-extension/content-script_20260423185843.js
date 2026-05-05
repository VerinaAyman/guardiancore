// GuardianCore Content Script - Intelligent Content Classification
// Extracts page text and sends to background worker for AI analysis

(function() {
  'use strict';
  
  if (window.__guardiancore_content_script_loaded) {
    console.log('[GuardianCore] Content script already loaded, skipping');
    return;
  }
  window.__guardiancore_content_script_loaded = true;
  
  console.log('%c[GuardianCore] Content script loaded for: ' + window.location.href, 'color: #00ff00; font-weight: bold');

  // ─── Option B: Domain Reputation List ─────────────────────────────────────
  // Known bad domains — blocked instantly before page renders, no pipeline needed
  const INSTANT_BLOCK_DOMAINS = [
    'pornhub.com', 'xvideos.com', 'xnxx.com', 'xhamster.com', 'redtube.com',
    'youporn.com', 'tube8.com', 'spankbang.com', 'thisvid.com', 'rule34.xxx',
    'hentaihaven.xxx', 'nhentai.net', 'fakku.net', 'e-hentai.org',
    'onlyfans.com', 'fansly.com', 'manyvids.com',
    'chaturbate.com', 'cam4.com', 'livejasmin.com', 'stripchat.com',
    'brazzers.com', 'bangbros.com', 'naughtyamerica.com',
  ];

  // Known risky domains — show overlay and run pipeline, but start with warning state
  const RISKY_DOMAINS = [
    'tumblr.com', 'wattpad.com', 'archiveofourown.org', 'ao3.org',
    'reddit.com', 'twitter.com', 'x.com', 'deviantart.com',
    'urbandictionary.com', 'chatroulette.com', 'omegle.com',
    '4chan.org', '8kun.top',
  ];

  function getDomain(url) {
    try {
      return new URL(url).hostname.replace('www.', '');
    } catch { return ''; }
  }

  function isInstantBlock() {
    const domain = getDomain(window.location.href);
    return INSTANT_BLOCK_DOMAINS.some(d => domain === d || domain.endsWith('.' + d));
  }

  function isRiskyDomain() {
    const domain = getDomain(window.location.href);
    return RISKY_DOMAINS.some(d => domain === d || domain.endsWith('.' + d));
  }

  // ─── Option A: Overlay ─────────────────────────────────────────────────────
  let overlay = null;

  function showOverlay(risky = false) {
    if (overlay) return;

    // Freeze the page so kid can't scroll/read while we wait
    document.documentElement.style.overflow = 'hidden';

    overlay = document.createElement('div');
    overlay.id = '__gc_overlay';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: ${risky
        ? 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)'
        : 'linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 100%)'};
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      transition: opacity 0.3s ease;
    `;

    overlay.innerHTML = `
      <div style="text-align:center; padding: 40px; max-width: 420px;">
        <div style="
          width: 72px; height: 72px; border-radius: 50%;
          background: ${risky ? 'rgba(255,140,0,0.15)' : 'rgba(99,179,237,0.15)'};
          border: 2px solid ${risky ? '#ff8c00' : '#63b3ed'};
          display: flex; align-items: center; justify-content: center;
          margin: 0 auto 24px;
          animation: gc_pulse 1.5s ease-in-out infinite;
        ">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="${risky ? '#ff8c00' : '#63b3ed'}" stroke-width="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
        </div>
        <div style="
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          color: ${risky ? '#ff8c00' : '#63b3ed'};
          margin-bottom: 12px;
        ">GuardianCore</div>
        <div style="font-size: 18px; font-weight: 600; color: #fff; margin-bottom: 8px;">
          ${risky ? 'Checking this site…' : 'Scanning page content…'}
        </div>
        <div style="font-size: 14px; color: rgba(255,255,255,0.5); line-height: 1.6;">
          ${risky
            ? 'This site may contain mature content. Verifying it\'s appropriate for you.'
            : 'Just a moment while we make sure this page is safe.'}
        </div>
        <div style="
          margin-top: 28px;
          width: 200px;
          height: 3px;
          background: rgba(255,255,255,0.1);
          border-radius: 99px;
          overflow: hidden;
          margin-left: auto;
          margin-right: auto;
        ">
          <div style="
            height: 100%;
            background: ${risky ? '#ff8c00' : '#63b3ed'};
            border-radius: 99px;
            animation: gc_progress 3s ease-in-out infinite;
          "></div>
        </div>
      </div>
      <style>
        @keyframes gc_pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.08); opacity: 0.8; }
        }
        @keyframes gc_progress {
          0% { width: 0%; }
          50% { width: 80%; }
          100% { width: 100%; }
        }
      </style>
    `;

    document.documentElement.appendChild(overlay);
  }

  function removeOverlay() {
    if (!overlay) return;
    overlay.style.opacity = '0';
    document.documentElement.style.overflow = '';
    setTimeout(() => {
      overlay?.remove();
      overlay = null;
    }, 300);
  }

  function blockWithOverlay(category, reason, url) {
    // Already showing overlay — just redirect
    document.documentElement.style.overflow = '';
    window.location.replace(
      chrome.runtime.getURL('blocked.html') +
      '?category=' + encodeURIComponent(category || 'Restricted content') +
      '&reason='   + encodeURIComponent(reason || '') +
      '&url='      + encodeURIComponent(url || window.location.href)
    );
  }

  // ─── Skip check ───────────────────────────────────────────────────────────
  function shouldSkipAnalysis() {
    const url = window.location.href;
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return true;
    if (url.startsWith('about:') || url.startsWith('file://')) return true;
    if (url.includes('newtab')) return true;
    return false;
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
        '[data-e2e="search-card-desc"]', '.tiktok-j2a19r',
        'h1', 'h2', 'h3', 'span[class*="desc"]', 'div[class*="desc"]',
        '#description', '#comments', 'ytd-video-secondary-info-renderer',
        '[data-testid="post-content"]', '.Post h3', 'shreddit-post',
        '[class*="message"]', '[class*="chat"]', '[class*="title"]'
      ];
      let text = '';
      for (const selector of contentSelectors) {
        document.querySelectorAll(selector).forEach(el => { text += ' ' + el.innerText; });
        if (text.length > 500) break;
      }
      if (text.length < 200) text = document.body ? document.body.innerText : '';
      return text.replace(/\s+/g, ' ').trim().slice(0, 5000);
    } catch (e) {
      return '';
    }
  }

  // ─── Handle analysis response ─────────────────────────────────────────────
  function handleAnalysisResponse(response) {
    if (!response) {
      removeOverlay();
      return;
    }
    console.log('[GuardianCore] Analysis response:', response);

    if (!response.safe && response.action === 'blocked') {
      console.log('%c[GuardianCore] BLOCKED: ' + response.category, 'color: #ff0000; font-weight: bold');
      blockWithOverlay(response.category, response.child_message, window.location.href);
      return;
    }

    if (!response.safe) {
      console.log('%c[GuardianCore] Risky content — triggering Lens warning', 'color: #ff8800');
      removeOverlay();
      chrome.runtime.sendMessage({
        type: 'LENS_TRIGGER',
        risk: response.stage ? response.stage * 33 : 50,
        category: response.category || 'Potentially inappropriate',
        summary: response.child_message || 'This page may contain content worth a quick chat.',
        domain: window.location.hostname
      });
      return;
    }

    // Safe — remove overlay and let page show
    removeOverlay();
  }

  // ─── Main analysis flow ───────────────────────────────────────────────────
  function requestAnalysis() {
    if (shouldSkipAnalysis()) return;
    const pageText = extractPageText();
    if (!pageText || pageText.length < 50) {
      removeOverlay();
      return;
    }

    console.log('%c[GuardianCore] Analysing: ' + window.location.href, 'color: #00ff00');

    chrome.runtime.sendMessage(
      { type: 'ANALYZE_PAGE', url: window.location.href, text: pageText },
      (response) => {
        if (chrome.runtime.lastError) {
          removeOverlay();
          return;
        }
        handleAnalysisResponse(response);
      }
    );
  }

  // ─── Entry point ──────────────────────────────────────────────────────────
  function init() {
    if (shouldSkipAnalysis()) return;

    // Option B: Instant block for known bad domains — no overlay, no pipeline
    if (isInstantBlock()) {
      console.log('%c[GuardianCore] INSTANT BLOCK (domain reputation)', 'color: #ff0000; font-weight: bold');
      blockWithOverlay('Adult content', 'This site is not allowed.', window.location.href);
      return;
    }

    // Option A: Show overlay immediately so kid can't read page
    // Use orange "risky" style for known risky domains, blue "scanning" for unknown
    showOverlay(isRiskyDomain());

    // Wait for page content to load then run pipeline
    if (document.readyState === 'complete') {
      setTimeout(requestAnalysis, 1500);
    } else {
      window.addEventListener('load', () => setTimeout(requestAnalysis, 1500));
    }
  }

  init();

  // ─── SPA navigation (React/Vue apps, YouTube etc.) ────────────────────────
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      // Re-run for new SPA page
      if (isInstantBlock()) {
        blockWithOverlay('Adult content', 'This site is not allowed.', window.location.href);
        return;
      }
      showOverlay(isRiskyDomain());
      setTimeout(requestAnalysis, 1000);
    }
  }).observe(document.body, { childList: true, subtree: true });

  // ─── Dynamic content watchers ─────────────────────────────────────────────
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