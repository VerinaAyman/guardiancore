// GuardianCore Content Script - Intelligent Content Classification
// Extracts page text and sends to background worker for AI analysis

(function() {
  'use strict';
  
  // Prevent multiple injections
  if (window.__guardiancore_content_script_loaded) {
    console.log('[GuardianCore] Content script already loaded, skipping');
    return;
  }
  window.__guardiancore_content_script_loaded = true;
  
  console.log('%c[GuardianCore] Content script loaded for: ' + window.location.href, 'color: #00ff00; font-weight: bold');
  
  // Skip analysis for certain URLs
  function shouldSkipAnalysis() {
    const url = window.location.href;
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return true;
    if (url.startsWith('about:')) return true;
    if (url.startsWith('file://')) return true;
    if (url === 'chrome://newtab/' || url.includes('newtab')) return true;
    return false;
  }
  
  function extractPageText() {
    try {
      const contentSelectors = [
        'article', 'main', '.post', '.content',
        'p', '.comment', '.message', '.description',
        '.postMessage', '.reply', '.op',
        '.Post', '[data-testid="post-content"]', '.Comment',
        '#description', '#comments',
        '[data-testid="tweetText"]',
        '.forum-post', '.user-content', '.post-body'
      ];
      
      let text = '';
      for (const selector of contentSelectors) {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => { text += ' ' + el.innerText; });
        if (text.length > 500) break;
      }
      
      if (text.length < 100) {
        text = document.body ? document.body.innerText : '';
      }
      
      return text.replace(/\s+/g, ' ').trim().slice(0, 5000);
    } catch (error) {
      console.warn('[GuardianCore] Failed to extract page text:', error);
      return '';
    }
  }

  // ─── Handle analysis response ─────────────────────────────────────────────
  function handleAnalysisResponse(response) {
    if (!response) return;

    console.log('[GuardianCore] Analysis response:', response);

    // Page should be hard-blocked — redirect immediately
    if (response.blocked) {
      console.log('%c[GuardianCore] PAGE BLOCKED: ' + response.category, 'color: #ff0000; font-weight: bold');
      const blockUrl = chrome.runtime.getURL('blocked.html') +
        '?category=' + encodeURIComponent(response.category || 'Restricted content') +
        '&reason=' + encodeURIComponent(response.reason || '') +
        '&url=' + encodeURIComponent(window.location.href);
      window.location.replace(blockUrl);
      return;
    }

    // Page is risky but not blocked — trigger Lens warning bubble
    if (response.risk_score >= 40 && !response.safe) {
      console.log('%c[GuardianCore] Risky content — triggering Lens warning', 'color: #ff8800');
      chrome.runtime.sendMessage({
        type: 'LENS_TRIGGER',
        risk: response.risk_score || 50,
        category: response.category || 'Potentially inappropriate',
        summary: response.summary || 'This page may contain content that needs a chat.',
        domain: window.location.hostname
      });
      return;
    }

    if (response.safe) {
      console.log('%c[GuardianCore] Page is safe', 'color: #00ff00');
    }
  }
  
  // ─── Send analysis request ────────────────────────────────────────────────
  function requestAnalysis() {
    if (shouldSkipAnalysis()) {
      console.log('[GuardianCore] Skipping analysis for this page');
      return;
    }
    
    const pageText = extractPageText();
    const url = window.location.href;
    
    console.log('[GuardianCore] Extracted text length:', pageText.length);
    
    if (!pageText || pageText.length < 50) {
      console.log('[GuardianCore] Insufficient text content for analysis (< 50 chars)');
      return;
    }
    
    console.log('%c[GuardianCore] Requesting content analysis for: ' + url, 'color: #00ff00');
    
    chrome.runtime.sendMessage({
      type: 'ANALYZE_PAGE',
      url: url,
      text: pageText
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[GuardianCore] Failed to send analysis request:', chrome.runtime.lastError.message);
        return;
      }
      handleAnalysisResponse(response);
    });
  }
  
  // ─── Initial page load ────────────────────────────────────────────────────
  if (document.readyState === 'complete') {
    setTimeout(requestAnalysis, 500);
  } else {
    window.addEventListener('load', () => setTimeout(requestAnalysis, 500));
  }
  
  // ─── SPA navigation watcher ───────────────────────────────────────────────
  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    const currentUrl = location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      console.log('[GuardianCore] SPA navigation detected:', currentUrl);
      setTimeout(requestAnalysis, 1000);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // ─── Dynamic content watcher (YouTube comments, game chats, etc.) ─────────
  let dynamicScanTimer = null;
  const dynamicObserver = new MutationObserver(() => {
    // Debounce — wait for content to settle before re-scanning
    clearTimeout(dynamicScanTimer);
    dynamicScanTimer = setTimeout(() => {
      console.log('[GuardianCore] Dynamic content change detected — re-scanning');
      requestAnalysis();
    }, 3000);
  });

  // Watch for new comments, chat messages, feed items loading in
  const dynamicTargets = [
    '#comments',           // YouTube comments
    '[data-testid="primaryColumn"]', // Twitter feed
    '.chat-line__message', // Twitch chat
    '#chat-messages',      // Generic game/chat
    '.comment-list',       // Generic comments
  ];

  dynamicTargets.forEach(selector => {
    const el = document.querySelector(selector);
    if (el) {
      dynamicObserver.observe(el, { childList: true, subtree: true });
      console.log('[GuardianCore] Watching dynamic content:', selector);
    }
  });

  // Also watch for dynamic targets appearing later (e.g. YouTube lazy loads comments)
  setTimeout(() => {
    dynamicTargets.forEach(selector => {
      const el = document.querySelector(selector);
      if (el) {
        dynamicObserver.observe(el, { childList: true, subtree: true });
      }
    });
  }, 3000);

})();