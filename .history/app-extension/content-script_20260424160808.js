// GuardianCore Content Script - Intelligent Content Classification
// Runs silently in the background. No overlays, no scanning screens.

(function() {
  'use strict';

  if (window.__guardiancore_content_script_loaded) return;
  window.__guardiancore_content_script_loaded = true;

  // ─── Instant Block Domains ────────────────────────────────────────────────
  const INSTANT_BLOCK_DOMAINS = [
    'pornhub.com', 'xvideos.com', 'xnxx.com', 'xhamster.com', 'redtube.com',
    'youporn.com', 'tube8.com', 'spankbang.com', 'thisvid.com', 'rule34.xxx',
    'hentaihaven.xxx', 'nhentai.net', 'fakku.net', 'e-hentai.org',
    'onlyfans.com', 'fansly.com', 'manyvids.com',
    'chaturbate.com', 'cam4.com', 'livejasmin.com', 'stripchat.com',
    'brazzers.com', 'bangbros.com', 'naughtyamerica.com',
  ];

  // ─── Risky Domains ───────────────────────────────────────────────────────
  const RISKY_DOMAINS = [
    'tumblr.com', 'wattpad.com', 'archiveofourown.org', 'ao3.org',
    'reddit.com', 'twitter.com', 'x.com', 'deviantart.com',
    'urbandictionary.com', 'chatroulette.com', 'omegle.com',
    '4chan.org', '8kun.top',
  ];

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

  function hidePage() {
    document.documentElement.style.visibility = 'hidden';
  }

  function showPage() {
    document.documentElement.style.visibility = '';
  }

  function silentBlock(category, reason, url) {
    showPage();
    window.location.replace(
      chrome.runtime.getURL('blocked.html') +
      '?category=' + encodeURIComponent(category || 'Restricted content') +
      '&reason='   + encodeURIComponent(reason || '') +
      '&url='      + encodeURIComponent(url || window.location.href)
    );
  }

  // ─── AGGRESSIVE Text Extraction ───────────────────────────────────────────
  // Grabs as much meaningful text as possible, including slang and definitions
  function extractPageText() {
    try {
      let chunks = [];

      // 1. Page title and URL — always include
      chunks.push(document.title || '');
      chunks.push(window.location.href);

      // 2. Meta description
      const metaDesc = document.querySelector('meta[name="description"]');
      if (metaDesc) chunks.push(metaDesc.getAttribute('content') || '');

      // 3. High-priority selectors — definitions, posts, user content
      const highPriority = [
        // Urban Dictionary specific
        '.definition', '.meaning', '.example', '[class*="definition"]',
        // AO3 specific
        '.userstuff', '.tags', '.tag', '.freeform', '.rating', '[class*="work"]',
        // Wattpad specific
        '.story-description', '.story-parts', '[class*="story"]',
        // Reddit specific
        '[data-testid="post-content"]', '.Post', '[class*="Comment"]', 'shreddit-post',
        // Twitter/X specific
        '[data-testid="tweetText"]', '[data-testid="tweet"]',
        // Generic content
        'article', 'main', '.post', '.content', '.post-content',
        '.entry-content', '.body', '.message-body',
        'h1', 'h2', 'h3',
        'p', '.description', '.summary',
        '.comment', '.reply', '.user-content',
      ];

      for (const selector of highPriority) {
        document.querySelectorAll(selector).forEach(el => {
          const t = (el.innerText || el.textContent || '').trim();
          if (t.length > 10) chunks.push(t);
        });
      }

      // 4. All visible text nodes — catch anything missed above
      // Walk the DOM and grab text from visible elements
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            const tag = parent.tagName.toLowerCase();
            // Skip scripts, styles, etc
            if (['script', 'style', 'noscript', 'svg', 'head'].includes(tag)) {
              return NodeFilter.FILTER_REJECT;
            }
            const text = node.textContent.trim();
            if (text.length < 3) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          }
        }
      );

      let rawText = '';
      let node;
      while ((node = walker.nextNode()) && rawText.length < 20000) {
        rawText += ' ' + node.textContent;
      }
      chunks.push(rawText);

      // 5. Alt text on images (catches tagged/labeled adult images)
      document.querySelectorAll('img[alt]').forEach(img => {
        const alt = img.getAttribute('alt');
        if (alt && alt.length > 3) chunks.push(alt);
      });

      // 6. Link text (navigation context is revealing)
      document.querySelectorAll('a[href]').forEach(a => {
        const t = (a.innerText || '').trim();
        if (t.length > 3 && t.length < 100) chunks.push(t);
      });

      // Combine, deduplicate lines, and trim
      const combined = chunks.join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      // Return up to 15,000 characters — much more than before
      return combined.slice(0, 15000);

    } catch (e) {
      console.warn('[GuardianCore] Text extraction error:', e);
      return document.body ? (document.body.innerText || '').slice(0, 15000) : '';
    }
  }

  // ─── Handle pipeline response ─────────────────────────────────────────────
  function handleAnalysisResponse(response, wasHidden) {
    if (!response) {
      if (wasHidden) showPage();
      return;
    }

    console.log('[GuardianCore] Analysis result:', response.action, '|', response.category, '| confidence:', response.confidence, '| safe:', response.safe);

    if (!response.safe && response.action === 'blocked') {
      silentBlock(response.category, response.child_message, window.location.href);
      return;
    }

    if (!response.safe) {
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

    if (wasHidden) showPage();
  }

  // ─── Main analysis flow ───────────────────────────────────────────────────
  function requestAnalysis(wasHidden) {
    if (shouldSkipAnalysis()) {
      if (wasHidden) showPage();
      return;
    }

    const pageText = extractPageText();
    console.log('[GuardianCore] Extracted text length:', pageText.length, '| preview:', pageText.slice(0, 200));

    if (!pageText || pageText.length < 30) {
      if (wasHidden) showPage();
      return;
    }

    chrome.runtime.sendMessage(
      { type: 'ANALYZE_PAGE', url: window.location.href, text: pageText },
      (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[GuardianCore] Message error:', chrome.runtime.lastError);
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
    if (risky) hidePage();

    // Wait longer on risky domains — give JS time to render content
    const delay = risky ? 2500 : 1500;

    if (document.readyState === 'complete') {
      setTimeout(() => requestAnalysis(risky), delay);
    } else {
      window.addEventListener('load', () => setTimeout(() => requestAnalysis(risky), delay));
    }

    // Second pass — catch late-loading dynamic content (e.g. Urban Dictionary definitions)
    if (risky) {
      setTimeout(() => {
        console.log('[GuardianCore] Running second-pass analysis for risky domain...');
        requestAnalysis(false); // page already shown by now, this is a safety re-check
      }, 5000);
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
      setTimeout(() => requestAnalysis(risky), risky ? 2500 : 1000);
    }
  }).observe(document.body, { childList: true, subtree: true });

  // ─── Dynamic content watchers ─────────────────────────────────────────────
  let dynamicTimer = null;
  const dynamicObserver = new MutationObserver(() => {
    clearTimeout(dynamicTimer);
    dynamicTimer = setTimeout(() => requestAnalysis(false), 3000);
  });

  function attachDynamicWatchers() {
    ['#comments', '[data-testid="primaryColumn"]', '.chat-line__message',
     '#chat-messages', '.comment-list', '.definition', '.userstuff'
    ].forEach(selector => {
      const el = document.querySelector(selector);
      if (el) dynamicObserver.observe(el, { childList: true, subtree: true });
    });
  }

  attachDynamicWatchers();
  setTimeout(attachDynamicWatchers, 3000);

})();