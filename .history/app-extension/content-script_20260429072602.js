// GuardianLens Content Script — v0.8.0
// ✨ Animated owl · unified design · spring animations · Web Audio sounds

(function () {
  'use strict';

  if (window.__guardianlens_content_script_loaded) return;
  window.__guardianlens_content_script_loaded = true;

  // ─── Extension alive guard ────────────────────────────────────────────────
  function isExtensionAlive() {
    try { return !!chrome.runtime?.id; } catch { return false; }
  }

  // ─── Design Tokens ────────────────────────────────────────────────────────
  const GL = {
    safe:    '#22c55e',
    warn:    '#f59e0b',
    block:   '#ef4444',
    accent:  '#6366f1',
    bg:      '#0f172a',
    surface: 'rgba(15,23,42,0.97)',
    text:    '#f1f5f9',
    muted:   '#94a3b8',
    font:    'Nunito',
  };

  // ─── Font injection ───────────────────────────────────────────────────────
  function injectFont() {
    if (document.getElementById('gl-font')) return;
    const link = document.createElement('link');
    link.id   = 'gl-font';
    link.rel  = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap';
    document.head.appendChild(link);
  }

  // ─── Sound engine (gated on user gesture) ────────────────────────────────
  let _audioCtx = null;
  let _userHasInteracted = false;
  document.addEventListener('click',     () => { _userHasInteracted = true; }, { once: true, capture: true });
  document.addEventListener('keydown',   () => { _userHasInteracted = true; }, { once: true, capture: true });
  document.addEventListener('touchstart',() => { _userHasInteracted = true; }, { once: true, capture: true });
  document.addEventListener('scroll',    () => { _userHasInteracted = true; }, { once: true, capture: true });

  function getAudioCtx() {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    return _audioCtx;
  }

  function playTone(notes, type = 'sine') {
    if (!_userHasInteracted) return;
    try {
      const ctx = getAudioCtx();
      let t = ctx.currentTime;
      notes.forEach(([freq, dur, vol = 0.18]) => {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(vol, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + dur);
        t += dur * 0.82;
      });
    } catch (_) {}
  }

  function soundSafe()  { playTone([[523,0.15,0.14],[659,0.15,0.14],[784,0.15,0.14],[1047,0.30,0.16]], 'sine'); }
  function soundWarn()  { playTone([[660,0.18,0.13],[520,0.18,0.13],[440,0.28,0.12]], 'triangle'); }
  function soundBlock() { playTone([[320,0.12,0.16],[240,0.16,0.16],[180,0.35,0.14]], 'sawtooth'); }

  // ─── CSS ──────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('gl-styles')) return;
    const style = document.createElement('style');
    style.id = 'gl-styles';
    style.textContent = `
      :root {
        --gl-safe:    ${GL.safe};
        --gl-warn:    ${GL.warn};
        --gl-block:   ${GL.block};
        --gl-accent:  ${GL.accent};
        --gl-bg:      ${GL.bg};
        --gl-surface: ${GL.surface};
        --gl-text:    ${GL.text};
        --gl-muted:   ${GL.muted};
        --gl-font:    'Nunito', 'Segoe UI', sans-serif;
        --gl-radius:  18px;
        --gl-shadow:  0 8px 40px rgba(0,0,0,0.55);
      }

      @keyframes gl-spring-in {
        0%   { transform: translate(120px,-20px) scale(0.6); opacity:0; }
        60%  { transform: translate(-8px, 4px) scale(1.05); opacity:1; }
        80%  { transform: translate(4px,-2px) scale(0.98); }
        100% { transform: translate(0,0) scale(1); opacity:1; }
      }
      @keyframes gl-spring-out {
        0%   { transform: scale(1); opacity:1; }
        40%  { transform: scale(1.06); }
        100% { transform: translate(140px,-20px) scale(0.7); opacity:0; }
      }
      @keyframes gl-owl-float {
        0%,100% { transform: translateY(0) rotate(-1deg) scale(1); }
        40%     { transform: translateY(-8px) rotate(2deg) scale(1.03); }
        70%     { transform: translateY(-4px) rotate(-1deg) scale(1.01); }
      }
      @keyframes gl-owl-worried {
        0%,100% { transform: translateX(0) translateY(0) rotate(0deg); }
        15%     { transform: translateX(-4px) translateY(-2px) rotate(-4deg); }
        30%     { transform: translateX(3px) translateY(-4px) rotate(3deg); }
        45%     { transform: translateX(-3px) translateY(-1px) rotate(-3deg); }
        60%     { transform: translateX(2px) translateY(-3px) rotate(2deg); }
        75%     { transform: translateX(-1px) translateY(0) rotate(-1deg); }
      }
      @keyframes gl-owl-frustrated {
        0%,100% { transform: translateX(0) rotate(0deg); }
        10%     { transform: translateX(-7px) rotate(-5deg); }
        20%     { transform: translateX(7px) rotate(5deg); }
        30%     { transform: translateX(-5px) rotate(-4deg); }
        40%     { transform: translateX(5px) rotate(4deg); }
        50%     { transform: translateX(-2px) rotate(-1deg); }
        60%,100%{ transform: translateX(0) rotate(0deg); }
      }
      @keyframes gl-owl-bounce-in {
        0%   { transform: scale(0) rotate(-15deg); opacity:0; }
        55%  { transform: scale(1.18) rotate(4deg); opacity:1; }
        75%  { transform: scale(0.93) rotate(-2deg); }
        90%  { transform: scale(1.04) rotate(1deg); }
        100% { transform: scale(1) rotate(0deg); opacity:1; }
      }
      @keyframes gl-pulse-ring {
        0%   { transform: scale(1);   opacity:0.6; }
        100% { transform: scale(2.4); opacity:0; }
      }
      @keyframes gl-sparkle {
        0%   { transform: scale(0) rotate(0deg);   opacity:1; }
        60%  { transform: scale(1) rotate(180deg); opacity:1; }
        100% { transform: scale(0) rotate(360deg); opacity:0; }
      }
      @keyframes gl-bounce-dot {
        0%,80%,100% { transform: scale(0); }
        40%         { transform: scale(1); }
      }
      @keyframes gl-shake {
        0%,100%  { transform: translateX(0); }
        20%,60%  { transform: translateX(-6px); }
        40%,80%  { transform: translateX(6px); }
      }
      @keyframes gl-progress-fill {
        from { width: 0%; }
        to   { width: 100%; }
      }
      @keyframes gl-overlay-in {
        0%   { opacity:0; transform: scale(0.92) translateY(20px); }
        100% { opacity:1; transform: scale(1) translateY(0); }
      }
      @keyframes gl-overlay-out {
        0%   { opacity:1; transform: scale(1); }
        100% { opacity:0; transform: scale(0.9) translateY(20px); }
      }
      @keyframes gl-blink {
        0%,80%,100% { opacity:0.3; }
        40%         { opacity:1; }
      }

      /* ── Safe chip ── */
      #gl-safe-chip {
        position: fixed; bottom: 20px; right: 20px;
        z-index: 2147483646;
        font-family: var(--gl-font);
        background: rgba(34,197,94,0.18);
        border: 1.5px solid var(--gl-safe);
        color: var(--gl-safe);
        font-size: 12px; font-weight: 800;
        padding: 6px 14px; border-radius: 50px;
        display: flex; align-items: center; gap: 8px;
        pointer-events: none;
        animation: gl-spring-in 0.45s cubic-bezier(0.34,1.56,0.64,1) both;
        backdrop-filter: blur(8px);
      }
      #gl-safe-chip.gl-exit { animation: gl-spring-out 0.3s ease both; }
      #gl-safe-chip .gl-chip-owl {
        display: inline-block;
        animation: gl-owl-float 2.5s ease-in-out infinite;
      }

      /* ── Chat Overlay ── */
      #gl-chat-overlay {
        position: fixed; inset: 0;
        z-index: 2147483647;
        display: flex; align-items: center; justify-content: center;
        padding: 16px;
        background: rgba(0,0,0,0.72);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
        font-family: var(--gl-font);
      }
      #gl-chat-overlay.gl-exit { animation: gl-overlay-out 0.25s ease both; }

      .gl-chat-panel {
        width: 100%; max-width: 390px;
        border-radius: 24px; overflow: hidden;
        box-shadow: 0 24px 80px rgba(0,0,0,0.8);
        animation: gl-overlay-in 0.4s cubic-bezier(0.34,1.56,0.64,1) both;
        display: flex; flex-direction: column; max-height: 90vh;
        background: #0f172a;
      }

      .gl-chat-topbar {
        background: linear-gradient(135deg, #4338ca, var(--gl-accent));
        padding: 14px 18px;
        display: flex; align-items: center; gap: 12px; flex-shrink: 0;
      }
      .gl-chat-av-wrap {
        position: relative;
        width: 50px; height: 50px;
        display: flex; align-items: center; justify-content: center;
        background: rgba(255,255,255,0.12); border-radius: 50%; flex-shrink: 0;
      }
      .gl-chat-av-dot {
        position: absolute; bottom: 0; right: 0;
        width: 11px; height: 11px; border-radius: 50%;
        background: #4ade80; border: 2px solid #4338ca;
        box-shadow: 0 0 6px #4ade80;
      }
      .gl-chat-meta { flex: 1; }
      .gl-chat-name { font-size: 14px; font-weight: 900; color: #fff; }
      .gl-chat-sub  { font-size: 10px; color: rgba(255,255,255,0.65); margin-top: 1px; }
      .gl-chat-close {
        width: 30px; height: 30px; border-radius: 50%;
        background: rgba(255,255,255,0.15); border: none;
        cursor: pointer; color: #fff; font-size: 16px;
        display: flex; align-items: center; justify-content: center;
        transition: background 0.15s, transform 0.1s; flex-shrink: 0;
      }
      .gl-chat-close:hover { background: rgba(255,255,255,0.28); transform: scale(1.1); }
      .gl-chat-close:active { transform: scale(0.95); }

      .gl-chat-context {
        background: rgba(239,68,68,0.10);
        border-bottom: 1px solid rgba(239,68,68,0.12);
        padding: 8px 16px; display: flex; align-items: center; gap: 8px; flex-shrink: 0;
      }
      .gl-chat-context-text { font-size: 11.5px; font-weight: 700; color: #fca5a5; font-family: var(--gl-font); }

      #gl-chat-messages {
        flex: 1; overflow-y: auto;
        padding: 14px 12px;
        display: flex; flex-direction: column; gap: 10px;
        background: #0f172a; min-height: 200px; max-height: 300px;
      }
      #gl-chat-messages::-webkit-scrollbar { width: 4px; }
      #gl-chat-messages::-webkit-scrollbar-thumb { background: rgba(99,102,241,0.25); border-radius: 4px; }

      .gl-msg-row { display: flex; gap: 8px; align-items: flex-end; }
      .gl-msg-row.bot  { flex-direction: row; }
      .gl-msg-row.user { flex-direction: row-reverse; }
      .gl-msg-av {
        width: 30px; height: 30px; border-radius: 50%;
        background: rgba(99,102,241,0.15);
        border: 1px solid rgba(99,102,241,0.2);
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0; overflow: hidden;
      }
      .gl-msg-bub {
        max-width: 82%; padding: 10px 14px;
        font-size: 13.5px; line-height: 1.55;
        border-radius: 18px; word-break: break-word;
        font-family: var(--gl-font); font-weight: 600;
      }
      .gl-msg-row.bot  .gl-msg-bub { background: #1e293b; color: var(--gl-text); border-bottom-left-radius: 4px; border: 1px solid rgba(255,255,255,0.06); }
      .gl-msg-row.user .gl-msg-bub { background: var(--gl-accent); color: #fff; border-bottom-right-radius: 4px; }

      .gl-typing {
        display: flex; gap: 4px; align-items: center;
        background: #1e293b; border: 1px solid rgba(255,255,255,0.06);
        border-radius: 18px; border-bottom-left-radius: 4px;
        padding: 10px 14px; max-width: 60px;
      }
      .gl-typing span {
        width: 6px; height: 6px; border-radius: 50%;
        background: var(--gl-accent); opacity: 0.4;
        animation: gl-blink 1.2s infinite;
      }
      .gl-typing span:nth-child(2) { animation-delay: 0.2s; }
      .gl-typing span:nth-child(3) { animation-delay: 0.4s; }

      .gl-chat-inputbar {
        background: #1e293b; border-top: 1px solid rgba(255,255,255,0.06);
        padding: 10px 12px; display: flex; gap: 8px; align-items: center; flex-shrink: 0;
      }
      .gl-chat-input {
        flex: 1; background: #263347; border: 1.5px solid rgba(255,255,255,0.08);
        border-radius: 20px; padding: 9px 16px;
        font-size: 13.5px; font-family: var(--gl-font); font-weight: 600;
        color: var(--gl-text); outline: none; transition: border 0.15s;
      }
      .gl-chat-input::placeholder { color: var(--gl-muted); }
      .gl-chat-input:focus { border-color: var(--gl-accent); }
      .gl-chat-input:disabled { opacity: 0.4; }
      .gl-send-btn {
        width: 38px; height: 38px; border-radius: 50%;
        background: var(--gl-accent); border: none; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        font-size: 15px; color: #fff; flex-shrink: 0;
        transition: background 0.15s, transform 0.1s;
        box-shadow: 0 2px 12px rgba(99,102,241,0.4);
      }
      .gl-send-btn:hover  { background: #4f46e5; transform: scale(1.05); }
      .gl-send-btn:active { transform: scale(0.95); }
      .gl-send-btn:disabled { opacity: 0.35; pointer-events: none; }

      .gl-quick-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 12px 0; background: #0f172a; }
      .gl-chip {
        font-family: var(--gl-font); font-size: 11.5px; font-weight: 700;
        padding: 5px 12px; border-radius: 20px;
        background: rgba(99,102,241,0.12); border: 1px solid rgba(99,102,241,0.25);
        color: #a5b4fc; cursor: pointer; transition: background 0.15s, transform 0.1s;
      }
      .gl-chip:hover  { background: rgba(99,102,241,0.22); transform: scale(1.04); }
      .gl-chip:active { transform: scale(0.97); }
    `;
    document.head.appendChild(style);
  }

  // ─── Remove bubble ────────────────────────────────────────────────────────
  function removeBubble(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('gl-exit');
    setTimeout(() => el.remove(), 380);
  }

  // ─── Safe send helper ─────────────────────────────────────────────────────
  function safeSend(message) {
    if (!isExtensionAlive()) return;
    try {
      chrome.runtime.sendMessage(message, () => { void chrome.runtime.lastError; });
    } catch (_) {}
  }

  // ─── Safe chip ────────────────────────────────────────────────────────────
  function showSafeChip() {
    removeBubble('gl-safe-chip');
    injectFont(); injectStyles();
    soundSafe();
    const chip = document.createElement('div');
    chip.id = 'gl-safe-chip';
    chip.innerHTML = `<span class="gl-chip-owl">✓</span> GuardianLens: All Clear`;
    document.body.appendChild(chip);
    setTimeout(() => {
      chip.classList.add('gl-exit');
      setTimeout(() => chip.remove(), 380);
    }, 3200);
  }
  // ─── Domain lists ─────────────────────────────────────────────────────────
  const INSTANT_BLOCK_DOMAINS = [
    'pornhub.com','xvideos.com','xnxx.com','xhamster.com','redtube.com',
    'youporn.com','tube8.com','spankbang.com','thisvid.com','rule34.xxx',
    'hentaihaven.xxx','nhentai.net','fakku.net','e-hentai.org',
    'onlyfans.com','fansly.com','manyvids.com',
    'chaturbate.com','cam4.com','livejasmin.com','stripchat.com',
    'brazzers.com','bangbros.com','naughtyamerica.com',
  ];
  const RISKY_DOMAINS = [
    'tumblr.com','wattpad.com','archiveofourown.org','ao3.org',
    'reddit.com','twitter.com','x.com','deviantart.com',
    'urbandictionary.com','chatroulette.com','omegle.com',
    '4chan.org','8kun.top',
  ];

  function getDomain(url) {
    try { return new URL(url).hostname.replace('www.', ''); } catch { return ''; }
  }
  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
  function hidePage()  { document.documentElement.style.visibility = 'hidden'; }
  function showPage()  { document.documentElement.style.visibility = ''; }

  function silentBlock(category, reason, url) {
    soundBlock();
    if (!isExtensionAlive()) return;
    try {
      // Fire-and-forget signal to background that a page was blocked
      try { chrome.runtime.sendMessage({ type: 'PAGE_BLOCKED', url: url || window.location.href, reason: reason || 'Dangerous content' }); } catch (_) {}
      window.location.replace(
        chrome.runtime.getURL('blocked.html') +
        '?category=' + encodeURIComponent(category || 'Restricted content') +
        '&reason='   + encodeURIComponent(reason || '') +
        '&url='      + encodeURIComponent(url || window.location.href)
      );
    } catch (_) {}
  }

  // ─── Page text extraction ─────────────────────────────────────────────────
  function extractPageText() {
    try {
      let chunks = [];
      chunks.push(document.title || '');
      chunks.push(window.location.href);
      const metaDesc = document.querySelector('meta[name="description"]');
      if (metaDesc) chunks.push(metaDesc.getAttribute('content') || '');
      const highPriority = [
        '.definition','.meaning','.example','[class*="definition"]',
        '.userstuff','.tags','.tag','.freeform','.rating','[class*="work"]',
        '.story-description','.story-parts','[class*="story"]',
        '[data-testid="post-content"]','.Post','[class*="Comment"]','shreddit-post',
        '[data-testid="tweetText"]','[data-testid="tweet"]',
        'article','main','.post','.content','.post-content',
        '.entry-content','.body','.message-body',
        'h1','h2','h3','p','.description','.summary',
        '.comment','.reply','.user-content',
      ];
      for (const selector of highPriority) {
        document.querySelectorAll(selector).forEach(el => {
          const t = (el.innerText || el.textContent || '').trim();
          if (t.length > 10) chunks.push(t);
        });
      }
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName.toLowerCase();
          if (['script','style','noscript','svg','head'].includes(tag)) return NodeFilter.FILTER_REJECT;
          if (node.textContent.trim().length < 3) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      let rawText = '', node;
      while ((node = walker.nextNode()) && rawText.length < 20000) rawText += ' ' + node.textContent;
      chunks.push(rawText);
      document.querySelectorAll('img[alt]').forEach(img => {
        const alt = img.getAttribute('alt');
        if (alt && alt.length > 3) chunks.push(alt);
      });
      return chunks.join(' ').replace(/\s+/g, ' ').trim().slice(0, 15000);
    } catch (e) {
      return document.body ? (document.body.innerText || '').slice(0, 15000) : '';
    }
  }

  // ─── Handle pipeline response ─────────────────────────────────────────────
  function handleAnalysisResponse(response, wasHidden) {
    if (!response) { if (wasHidden) showPage(); return; }
    console.log('[GuardianLens] Result:', response.action, '|', response.category, '| confidence:', response.confidence);
    if (!response.safe && response.action === 'blocked') {
      silentBlock(response.category, response.child_message, window.location.href);
      return;
    }
    if (!response.safe) {
      if (wasHidden) showPage();
      return;
    }
    if (wasHidden) showPage();
    if (response.confidence >= 0.10) showSafeChip();
  }

  // ─── Main analysis flow ───────────────────────────────────────────────────
  function requestAnalysis(wasHidden) {
    if (!isExtensionAlive()) { if (wasHidden) showPage(); return; }
    if (shouldSkipAnalysis()) { if (wasHidden) showPage(); return; }
    const pageText = extractPageText();
    if (!pageText || pageText.length < 30) { if (wasHidden) showPage(); return; }
    try {
      chrome.runtime.sendMessage(
        { type: 'ANALYZE_PAGE', url: window.location.href, text: pageText },
        (response) => {
          if (chrome.runtime.lastError) { if (wasHidden) showPage(); return; }
          handleAnalysisResponse(response, wasHidden);
        }
      );
    } catch (_) { if (wasHidden) showPage(); }
  }

  chrome.runtime.onMessage.addListener((message) => {
    // ── EARLY_ANALYSIS_START from background (webNavigation.onBeforeNavigate) ──
    if (message.type === 'EARLY_ANALYSIS_START') {
      console.log('[GuardianLens] Early analysis triggered for:', message.url);
      // Start analysis immediately without waiting for page load
      // Only hide page if it's a risky domain
      const risky = isRiskyDomain();
      if (risky) hidePage();
      // Use a small delay to allow DOM to at least partially populate
      setTimeout(() => requestAnalysis(risky), 300);
    }
  });

  // ─── Entry point ──────────────────────────────────────────────────────────
  function init() {
    if (!isExtensionAlive()) return;
    if (shouldSkipAnalysis()) return;
    if (isInstantBlock()) {
      soundBlock();
      setTimeout(() => silentBlock('Adult content', 'This site is not allowed.', window.location.href), 60);
      return;
    }
    const risky = isRiskyDomain();
    if (risky) hidePage();
    const delay = risky ? 2500 : 1500;
    if (document.readyState === 'complete') {
      setTimeout(() => requestAnalysis(risky), delay);
    } else {
      window.addEventListener('load', () => setTimeout(() => requestAnalysis(risky), delay));
    }
  }

  init();

  // ─── SPA navigation ───────────────────────────────────────────────────────
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (!isExtensionAlive()) return;
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (isInstantBlock()) { silentBlock('Adult content', 'This site is not allowed.', window.location.href); return; }
      const risky = isRiskyDomain();
      if (risky) hidePage();
      setTimeout(() => requestAnalysis(risky), risky ? 2500 : 1000);
    }
  }).observe(document.body, { childList: true, subtree: true });

  // ─── Dynamic content watchers ─────────────────────────────────────────────
  let dynamicTimer = null;
  const dynamicObserver = new MutationObserver(() => {
    if (!isExtensionAlive()) return;
    clearTimeout(dynamicTimer);
    dynamicTimer = setTimeout(() => requestAnalysis(false), 3000);
  });
  function attachDynamicWatchers() {
    ['#comments','[data-testid="primaryColumn"]','.chat-line__message',
     '#chat-messages','.comment-list','.definition','.userstuff'
    ].forEach(selector => {
      const el = document.querySelector(selector);
      if (el) dynamicObserver.observe(el, { childList: true, subtree: true });
    });
  }
  attachDynamicWatchers();
  setTimeout(attachDynamicWatchers, 3000);

})();