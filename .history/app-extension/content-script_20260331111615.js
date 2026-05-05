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
    
    // Skip extension pages
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
      return true;
    }
    
    // Skip about pages
    if (url.startsWith('about:')) {
      return true;
    }
    
    // Skip local files
    if (url.startsWith('file://')) {
      return true;
    }
    
    // Skip browser new tab pages
    if (url === 'chrome://newtab/' || url.includes('newtab')) {
      return true;
    }
    
    return false;
  }
  
  function extractPageText() {
    try {
      // Target content-rich elements first
      const contentSelectors = [
        'article', 'main', '.post', '.content', 
        'p', '.comment', '.message', '.description'
      ];
      
      let text = '';
      for (const selector of contentSelectors) {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          text += ' ' + el.innerText;
        });
        if (text.length > 500) break;
      }
      
      // Fallback to body if no content found
      if (text.length < 100) {
        text = document.body ? document.body.innerText : '';
      }
      
      return text.replace(/\s+/g, ' ').trim().slice(0, 2000);
    } catch (error) {
      console.warn('[GuardianCore] Failed to extract page text:', error);
      return '';
    }
  }
  
  // Send analysis request to background worker
  function requestAnalysis() {
    if (shouldSkipAnalysis()) {
      console.log('[GuardianCore] Skipping analysis for this page');
      return;
    }
    
    const pageText = extractPageText();
    const url = window.location.href;
    
    console.log('[GuardianCore] Extracted text length:', pageText.length);
    
    // Don't send if no meaningful text
    if (!pageText || pageText.length < 50) {
      console.log('[GuardianCore] Insufficient text content for analysis (< 50 chars)');
      return;
    }
    
    console.log('%c[GuardianCore] Requesting content analysis for: ' + url, 'color: #00ff00');
    console.log('[GuardianCore] Text preview:', pageText.substring(0, 200) + '...');
    
    // Send message to background worker
    chrome.runtime.sendMessage({
      type: 'ANALYZE_PAGE',
      url: url,
      text: pageText
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[GuardianCore] Failed to send analysis request:', chrome.runtime.lastError.message);
        return;
      }
      
      if (response) {
        console.log('[GuardianCore] Analysis response:', response);
        if (response.blocked) {
          console.log('%c[GuardianCore] PAGE BLOCKED: ' + response.category, 'color: #ff0000; font-weight: bold');
        } else if (response.safe) {
          console.log('%c[GuardianCore] Page is safe', 'color: #00ff00');
        } else if (response.skipped) {
          console.log('[GuardianCore] Analysis skipped:', response.reason);
        }
      }
    });
  }
  
  // Wait for page to be reasonably loaded before analyzing
  // Use document_idle timing in manifest, plus a small delay for dynamic content
  if (document.readyState === 'complete') {
    // Page already loaded, analyze after short delay for dynamic content
    setTimeout(requestAnalysis, 500);
  } else {
    // Wait for load event
    window.addEventListener('load', () => {
      setTimeout(requestAnalysis, 500);
    });
  }
  
  // Also handle SPA navigation (for sites that use History API)
  let lastUrl = location.href;
  
  const observer = new MutationObserver(() => {
    const currentUrl = location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      console.log('[GuardianCore] SPA navigation detected:', currentUrl);
      // Delay analysis for SPA navigation to allow content to load
      setTimeout(requestAnalysis, 1000);
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
})();

