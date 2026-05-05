// GuardianLens Content Script - Minimal Working Version (Restore)

(function () {
  'use strict';

  if (window.__guardianlens_content_script_loaded) return;
  window.__guardianlens_content_script_loaded = true;

  console.log('[GuardianLens] Content script loaded successfully ✅');

  // Simple test bubble so you can see it's working
  function showTestBubble() {
    const bubble = document.createElement('div');
    bubble.style.cssText = `
      position: fixed; bottom: 30px; right: 30px; z-index: 2147483647;
      background: #1e293b; color: white; padding: 16px 20px; border-radius: 16px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5); font-family: Arial, sans-serif;
      max-width: 300px; border: 2px solid #6366f1;
    `;
    bubble.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 8px;">🦉 GuardianLens Restored</div>
      <div>The content script is working again.</div>
      <div style="margin-top: 10px; font-size: 12px; opacity: 0.8;">Try visiting a blocked site to test redirect.</div>
      <button onclick="this.parentElement.remove()" style="margin-top:12px; padding:6px 12px; background:#6366f1; color:white; border:none; border-radius:8px; cursor:pointer;">Close</button>
    `;
    document.documentElement.appendChild(bubble);
  }

  // Show bubble after a short delay on every page (for testing)
  setTimeout(() => {
    if (document.body) showTestBubble();
  }, 1200);

  // Instant block for adult sites (your original logic)
  const INSTANT_BLOCK_DOMAINS = [
    'pornhub.com', 'xvideos.com', 'xnxx.com', 'xhamster.com', 'redtube.com'
    // Add the rest of your domains here if you want
  ];

  function getDomain(url) {
    try { return new URL(url).hostname.replace('www.', ''); } catch { return ''; }
  }

  if (INSTANT_BLOCK_DOMAINS.some(d => getDomain(location.href).includes(d))) {
    console.log('[GuardianLens] Instant block triggered');
    setTimeout(() => {
      window.location.replace(
        chrome.runtime.getURL('blocked.html') + 
        '?category=Adult+content&reason=This+site+is+not+allowed.'
      );
    }, 300);
  }

})();