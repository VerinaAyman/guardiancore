// GuardianCore Content Script - Intelligent Content Classification
// Extracts page text and sends to background worker for AI analysis

(function() {
  'use strict';
  
  // Prevent multiple injections
  if (window.__guardiancore_content_script_loaded) {
    return;
  }
  window.__guardiancore_content_script_loaded = true;
  
  console.log('[GuardianCore] Content script loaded for:', window.location.href);
  
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
  
  // Extract visible text from the page
  function extractPageText() {
    try {
      // Get text from body
      const bodyText = document.body ? document.body.innerText : '';
      
      // Truncate to first 1000 characters to save bandwidth
      const truncatedText = bodyText.slice(0, 1000);
      
      // Clean up the text: remove excessive whitespace
      const cleanedText = truncatedText
        .replace(/\s+/g, ' ')
        .trim();
      
      return cleanedText;
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
    
    // Don't send if no meaningful text
    if (!pageText || pageText.length < 50) {
      console.log('[GuardianCore] Insufficient text content for analysis');
      return;
    }
    
    console.log('[GuardianCore] Requesting content analysis...');
    
    // Send message to background worker
    chrome.runtime.sendMessage({
      type: 'ANALYZE_PAGE',
      url: url,
      text: pageText
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[GuardianCore] Failed to send analysis request:', chrome.runtime.lastError.message);
        return;
      }
      
      if (response && response.received) {
        console.log('[GuardianCore] Analysis request received by background');
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

