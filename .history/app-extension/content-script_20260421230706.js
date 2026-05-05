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
  
  function shouldSkipAnalysis() {
    const url = window.location.href;
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return true;
    if (url.startsWith('about:') || url.startsWith('file://')) return true;
    if (url.includes('newtab')) return true;
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
        document.querySelectorAll(selector).forEach(el => { text += ' ' + el.innerText; });
        if (text.length > 500) break;
      }
      if (text.length < 100) text = document.body ? document.body.innerText : '';
      return text.replace(/\s+/g, ' ').trim().slice(0, 5000);
    } catch (e) {
      return '';
    }
  }

  // ─── Handle analysis response ──────────────────────────────────────────────
  // Backend fields: safe, action, category, child_message, parent_report,
  //                 trigger_words, stage (1=low, 2=medium, 3=high/block)
  function handleAnalysisResponse(response) {
    if (!response) return;
    console.log('[GuardianCore] Analysis response:', response);

    // Hard block — redirect to blocked page with Lens chat
    if (!response.safe && response.action === 'blocked') {
      console.log('%c[GuardianCore] BLOCKED: ' + response.category, 'color: #ff0000; font-weight: bold');
      window.location.replace(
        chrome.runtime.getURL('blocked.html') +
        '?category=' + encodeURIComponent(response.category || 'Restricted content') +
        '&reason='   + encodeURIComponent(response.child_message || '') +
        '&url='      + encodeURIComponent(window.location.href)
      );
      return;
    }

    // Soft warning — pulse Lens bubble and auto-open chat
    if (!response.safe) {
      console.log('%c[GuardianCore] Risky content — triggering Lens warning', 'color: #ff8800');
      chrome.runtime.sendMessage({
        type: 'LENS_TRIGGER',
        risk: response.stage ? response.stage * 33 : 50,
        category: response.category || 'Potentially inappropriate',
        summary: response.child_message || 'This page may contain content worth a quick chat.',
        domain: window.location.hostname
      });
    }
  }
  
  function requestAnalysis() {
    if (shouldSkipAnalysis()) return;
    const pageText = extractPageText();
    if (!pageText || pageText.length < 50) return;
    
    console.log('%c[GuardianCore] Analysing: ' + window.location.href, 'color: #00ff00');
    
    chrome.runtime.sendMessage(
      { type: 'ANALYZE_PAGE', url: window.location.href, text: pageText },
      (response) => {
        if (chrome.runtime.lastError) return;
        handleAnalysisResponse(response);
      }
    );
  }
  
  // ─── Triggers ──────────────────────────────────────────────────────────────

  // 1. On page load
  if (document.readyState === 'complete') {
    setTimeout(requestAnalysis, 500);
  } else {
    window.addEventListener('load', () => setTimeout(requestAnalysis, 500));
  }
  
  // 2. SPA navigation (React/Vue apps, YouTube etc.)
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(requestAnalysis, 1000);
    }
  }).observe(document.body, { childList: true, subtree: true });

  // 3. Dynamic content (comments, chat, feeds loading in)
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
  setTimeout(attachDynamicWatchers, 3000); // retry for lazy-loaded elements

})();