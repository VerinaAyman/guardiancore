// GuardianLens Content Script — v0.9.0
// ✅ MutationObserver chat detection · multi-platform · slang detection · instant response

(function () {
  'use strict';

  if (window.__guardianlens_content_script_loaded) return;
  window.__guardianlens_content_script_loaded = true;

  function isExtensionAlive() {
    try { return !!chrome.runtime?.id; } catch { return false; }
  }

  const GL = {
    safe:    '#22c55e', warn: '#f59e0b', block: '#ef4444', accent: '#6366f1',
    bg:      '#0f172a', surface: 'rgba(15,23,42,0.97)', text: '#f1f5f9',
    muted:   '#94a3b8', font: 'Nunito',
  };

  function injectFont() {
    if (document.getElementById('gl-font')) return;
    const link = document.createElement('link');
    link.id = 'gl-font'; link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap';
    document.head.appendChild(link);
  }

  let _audioCtx = null;
  let _userHasInteracted = false;
  document.addEventListener('click',      () => { _userHasInteracted = true; }, { once: true, capture: true });
  document.addEventListener('keydown',    () => { _userHasInteracted = true; }, { once: true, capture: true });
  document.addEventListener('touchstart', () => { _userHasInteracted = true; }, { once: true, capture: true });
  document.addEventListener('scroll',     () => { _userHasInteracted = true; }, { once: true, capture: true });

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
        osc.connect(g); g.connect(ctx.destination);
        osc.start(t); osc.stop(t + dur);
        t += dur * 0.82;
      });
    } catch (_) {}
  }

  function soundSafe()  { playTone([[523,0.15,0.14],[659,0.15,0.14],[784,0.15,0.14],[1047,0.30,0.16]], 'sine'); }
  function soundWarn()  { playTone([[660,0.18,0.13],[520,0.18,0.13],[440,0.28,0.12]], 'triangle'); }
  function soundBlock() { playTone([[320,0.12,0.16],[240,0.16,0.16],[180,0.35,0.14]], 'sawtooth'); }

  function injectStyles() {
    if (document.getElementById('gl-styles')) return;
    const style = document.createElement('style');
    style.id = 'gl-styles';
    style.textContent = `
      :root {
        --gl-safe: ${GL.safe}; --gl-warn: ${GL.warn}; --gl-block: ${GL.block};
        --gl-accent: ${GL.accent}; --gl-bg: ${GL.bg}; --gl-surface: ${GL.surface};
        --gl-text: ${GL.text}; --gl-muted: ${GL.muted};
        --gl-font: 'Nunito','Segoe UI',sans-serif; --gl-radius: 18px;
        --gl-shadow: 0 8px 40px rgba(0,0,0,0.55);
      }
      @keyframes gl-spring-in {
        0%   { transform: translate(120px,-20px) scale(0.6); opacity:0; }
        60%  { transform: translate(-8px,4px) scale(1.05); opacity:1; }
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
      @keyframes gl-overlay-in {
        0%   { opacity:0; transform: scale(0.92) translateY(20px); }
        100% { opacity:1; transform: scale(1) translateY(0); }
      }
      @keyframes gl-overlay-out {
        0%   { opacity:1; transform: scale(1); }
        100% { opacity:0; transform: scale(0.9) translateY(20px); }
      }
      @keyframes gl-blink {
        0%,80%,100% { opacity:0.3; } 40% { opacity:1; }
      }
      #gl-safe-chip {
        position:fixed; bottom:20px; right:20px; z-index:2147483646;
        font-family:var(--gl-font);
        background:rgba(34,197,94,0.18); border:1.5px solid var(--gl-safe);
        color:var(--gl-safe); font-size:12px; font-weight:800;
        padding:6px 14px; border-radius:50px;
        display:flex; align-items:center; gap:8px; pointer-events:none;
        animation:gl-spring-in 0.45s cubic-bezier(0.34,1.56,0.64,1) both;
        backdrop-filter:blur(8px);
      }
      #gl-safe-chip.gl-exit { animation:gl-spring-out 0.3s ease both; }
      #gl-safe-chip .gl-chip-owl { display:inline-block; animation:gl-owl-float 2.5s ease-in-out infinite; }
    `;
    document.head.appendChild(style);
  }

  function removeBubble(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('gl-exit');
    setTimeout(() => el.remove(), 380);
  }

  function safeSend(message) {
    if (!isExtensionAlive()) return;
    try { chrome.runtime.sendMessage(message, () => { void chrome.runtime.lastError; }); } catch (_) {}
  }

  function showSafeChip() {
    removeBubble('gl-safe-chip');
    injectFont(); injectStyles();
    soundSafe();
    const chip = document.createElement('div');
    chip.id = 'gl-safe-chip';
    chip.innerHTML = `<span class="gl-chip-owl">✔</span> GuardianLens: All Clear`;
    document.body.appendChild(chip);
    setTimeout(() => { chip.classList.add('gl-exit'); setTimeout(() => chip.remove(), 380); }, 3200);
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function isInstantBlock() { return false; }
  function isRiskyDomain()  { return false; }
  function shouldSkipAnalysis() {
    const url = window.location.href;
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return true;
    if (url.startsWith('about:') || url.startsWith('file://')) return true;
    if (url.includes('newtab')) return true;
    return false;
  }
  function hidePage() { document.documentElement.style.visibility = 'hidden'; }
  function showPage() { document.documentElement.style.visibility = ''; }

  function silentBlock(category, reason, url) {
    soundBlock();
    if (!isExtensionAlive()) return;
    try {
      try { chrome.runtime.sendMessage({ type: 'PAGE_BLOCKED', url: url || window.location.href, reason: reason || 'Dangerous content' }); } catch (_) {}
      window.location.replace(
        chrome.runtime.getURL('blocked.html') +
        '?category=' + encodeURIComponent(category || 'Restricted content') +
        '&reason='   + encodeURIComponent(reason || '') +
        '&url='      + encodeURIComponent(url || window.location.href)
      );
    } catch (_) {}
  }

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

  function handleAnalysisResponse(response, wasHidden) {
    if (!response) { if (wasHidden) showPage(); return; }
    console.log('[GuardianLens] Result:', response.action, '|', response.category, '| confidence:', response.confidence);
    if (!response.safe && response.action === 'blocked') {
      silentBlock(response.category, response.child_message, window.location.href);
      return;
    }
    if (!response.safe) { if (wasHidden) showPage(); return; }
    if (wasHidden) showPage();
    if (response.confidence >= 0.10) showSafeChip();
  }

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
    if (message.type === 'EARLY_ANALYSIS_START') {
      console.log('[GuardianLens] Early analysis triggered for:', message.url);
      const risky = isRiskyDomain();
      if (risky) hidePage();
      setTimeout(() => requestAnalysis(risky), 300);
    }
  });

  // ─── SLANG DICTIONARY ─────────────────────────────────────────────────────
  const SLANG_CONTEXT = `
IMPORTANT: Also check for coded language and slang that children use to hide dangerous activity:
- Grooming/meetup: "wya" (where you at), "wanna link" (meet up), "slide thru" (come over), "pull up" (come meet me), "irl" (in real life meetup), "lmk" (let me know), "hmu" (hit me up)
- Secrecy: "don't say anything", "keep it between us", "our secret", "don't tell", "delete this", "clear chat", "ss?" (screenshot?)
- Age probing: "asl" (age sex location), "a/s/l", "how old r u", "u young?", "jailbait", "minor"
- Sexual coded: "Netflix and chill", "dtf", "fwb", "nsfw", "nudes", "pics", "send it", "body check", "rate me"
- Violence/self-harm: "unalive" (kill), "sewerslide" (suicide), "caught in 4k" (violence recorded), "irl beef" (real fight)
- Drug slang: "plug" (drug dealer), "pack" (drugs), "green" (weed), "molly/mandy" (MDMA), "snow/white" (cocaine), "420", "xans" (xanax), "perc" (percocet)
Treat these with HIGH suspicion especially when combined with requests for secrecy or meetups.
`;

  // ─── Platform detection ───────────────────────────────────────────────────
  function getChatPlatform() {
    const host = window.location.hostname;
    if (host.includes('web.whatsapp.com'))   return 'whatsapp';
    if (host.includes('web.telegram.org'))   return 'telegram';
    if (host.includes('discord.com'))        return 'discord';
    if (host.includes('messenger.com'))      return 'messenger';
    if (host.includes('facebook.com'))       return 'facebook';
    if (host.includes('instagram.com'))      return 'instagram';
    if (host.includes('slack.com'))          return 'slack';
    if (host.includes('teams.microsoft.com'))return 'teams';
    if (host.includes('snapchat.com'))       return 'snapchat';
    if (host.includes('tiktok.com'))         return 'tiktok';
    const hasChatIndicators =
      document.querySelector('[class*="message"]') ||
      document.querySelector('[class*="chat"]') ||
      document.querySelector('[class*="conversation"]') ||
      document.querySelector('[class*="inbox"]') ||
      document.querySelector('[data-message-id]') ||
      document.querySelector('[data-testid*="message"]');
    if (hasChatIndicators) return 'generic';
    return null;
  }

  function isChatPlatform() { return getChatPlatform() !== null; }

  // ─── Chat message extraction ──────────────────────────────────────────────
  function extractChatMessages() {
    const platform = getChatPlatform();
    const messages = new Set();

    if (platform === 'whatsapp') {
      document.querySelectorAll('[data-testid="msg-container"]').forEach(el => {
        const t = (el.innerText || '').trim().replace(/\n?\d{1,2}:\d{2}\s*(AM|PM)?$/i, '').trim();
        if (t.length > 2) messages.add(t);
      });
      document.querySelectorAll('.selectable-text,[class*="message-in"],[class*="message-out"]').forEach(el => {
        const t = (el.innerText || '').trim();
        if (t.length > 2) messages.add(t);
      });
    }

    if (platform === 'telegram') {
      document.querySelectorAll('.message,.text-content,[class*="message_text"]').forEach(el => {
        const t = (el.innerText || '').trim();
        if (t.length > 2) messages.add(t);
      });
    }

    if (platform === 'discord') {
      document.querySelectorAll('[class*="messageContent"],[class*="message-content"],li[class*="messageListItem"] [id^="message-content"]').forEach(el => {
        const t = (el.innerText || '').trim();
        if (t.length > 2) messages.add(t);
      });
    }

    if (platform === 'messenger' || platform === 'facebook') {
      document.querySelectorAll('[data-scope="messages_table"] [dir="auto"],[class*="message"] [dir="auto"]').forEach(el => {
        const t = (el.innerText || '').trim();
        if (t.length > 2) messages.add(t);
      });
    }

    if (platform === 'instagram') {
      document.querySelectorAll('[class*="DirectThreadMessage"] span,[role="row"] span').forEach(el => {
        const t = (el.innerText || '').trim();
        if (t.length > 2) messages.add(t);
      });
    }

    if (platform === 'slack') {
      document.querySelectorAll('[data-qa="message_content"],.c-message__body,[class*="message_body"]').forEach(el => {
        const t = (el.innerText || '').trim();
        if (t.length > 2) messages.add(t);
      });
    }

    if (platform === 'teams') {
      document.querySelectorAll('[data-tid="chat-pane-message"],[class*="message-body"]').forEach(el => {
        const t = (el.innerText || '').trim();
        if (t.length > 2) messages.add(t);
      });
    }

    if (messages.size === 0) {
      const genericSelectors = [
        '[class*="message"]','[class*="chat-line"]','[class*="chat_message"]',
        '[class*="conversation"]','[data-message-id]','[data-testid*="message"]',
        '[class*="bubble"]','[class*="msg-"]','[class*="-msg"]',
        '[role="row"]','[class*="comment"]'
      ];
      for (const sel of genericSelectors) {
        document.querySelectorAll(sel).forEach(el => {
          if (el.querySelectorAll(sel).length > 2) return;
          const t = (el.innerText || '').trim();
          if (t.length > 2 && t.length < 2000) messages.add(t);
        });
        if (messages.size > 5) break;
      }
    }

    return [...messages].slice(-40).join('\n');
  }

  // ─── Chat analysis (debounced) ────────────────────────────────────────────
  let lastChatText = '';
  let lastChatTs   = 0;
  const CHAT_DEBOUNCE_MS = 3000;

  function requestChatAnalysis() {
    if (!isExtensionAlive()) return;
    if (!isChatPlatform()) return;
    const messages = extractChatMessages();
    if (!messages || messages.length < 10) return;
    const now = Date.now();
    if (messages === lastChatText && now - lastChatTs < CHAT_DEBOUNCE_MS) return;
    lastChatText = messages;
    lastChatTs   = now;
    const enrichedText = messages + '\n\n' + SLANG_CONTEXT;
    console.log('[GuardianLens] Chat analysis on:', getChatPlatform(), '|', messages.length, 'chars');
    try {
      chrome.runtime.sendMessage(
        { type: 'ANALYZE_PAGE', url: window.location.href, text: enrichedText, isChat: true },
        (response) => {
          if (chrome.runtime.lastError) return;
          if (!response) return;
          console.log('[GuardianLens] Chat result:', response.action, '|', response.category, '| confidence:', response.confidence);
        }
      );
    } catch (_) {}
  }

  // ─── MutationObserver setup ───────────────────────────────────────────────
  let chatDebounceTimer = null;

  function setupChatObserver() {
    if (!isChatPlatform()) return;
    const platform = getChatPlatform();
    console.log('[GuardianLens] Setting up MutationObserver for:', platform);

    const rootSelectors = {
      whatsapp:  ['#main','[data-testid="conversation-panel-wrapper"]'],
      telegram:  ['#messages','.messages-container','[class*="bubbles"]'],
      discord:   ['[class*="scroller"]','[class*="messagesWrapper"]','ol[class*="scrollerInner"]'],
      messenger: ['[role="main"]','[class*="thread"]'],
      instagram: ['[role="main"]','[class*="DirectThread"]'],
      slack:     ['[data-qa="slack_kit_list"]','.c-virtual_list__scroll_container'],
      teams:     ['[data-tid="chat-pane-list"]','[class*="chatMessageList"]'],
      generic:   ['body'],
    };

    const selectors = rootSelectors[platform] || rootSelectors.generic;
    let observedRoot = null;
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) { observedRoot = el; break; }
    }

    if (!observedRoot) {
      console.log('[GuardianLens] Chat root not found, retrying in 2s...');
      setTimeout(setupChatObserver, 2000);
      return;
    }

    console.log('[GuardianLens] Observing:', observedRoot.tagName, observedRoot.className?.slice(0,60));

    const observer = new MutationObserver((mutations) => {
      if (!isExtensionAlive()) return;
      const hasNewNodes = mutations.some(m => m.addedNodes.length > 0);
      if (!hasNewNodes) return;
      clearTimeout(chatDebounceTimer);
      chatDebounceTimer = setTimeout(requestChatAnalysis, 600);
    });

    observer.observe(observedRoot, { childList: true, subtree: true });
    setTimeout(requestChatAnalysis, 1500);

    // Lightweight fallback poll (15s — observer handles real-time)
    setInterval(() => { if (isExtensionAlive()) requestChatAnalysis(); }, 15000);
  }

  // ─── Init ─────────────────────────────────────────────────────────────────
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
    if (isChatPlatform()) {
      if (document.readyState === 'complete') setupChatObserver();
      else window.addEventListener('load', setupChatObserver);
    }
  }

  init();

  // ─── SPA navigation watcher ───────────────────────────────────────────────
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (!isExtensionAlive()) return;
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (isInstantBlock()) { silentBlock('Adult content', 'This site is not allowed.', window.location.href); return; }
      const risky = isRiskyDomain();
      if (risky) hidePage();
      setTimeout(() => requestAnalysis(risky), risky ? 2500 : 1000);
      if (isChatPlatform()) setTimeout(setupChatObserver, 1500);
    }
  }).observe(document.body, { childList: true, subtree: true });

  // ─── Dynamic content watchers (non-chat pages) ────────────────────────────
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

  // ─── Groq relay ───────────────────────────────────────────────────────────
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.type !== 'GL_GROQ_REQUEST_RELAY') return;
    try {
      chrome.runtime.sendMessage({
        type: 'LENS_GROQ_REQUEST',
        systemPrompt: event.data.systemPrompt,
        history: event.data.history
      }, (response) => {
        if (chrome.runtime.lastError) {
          window.postMessage({ type: 'GL_GROQ_RESPONSE_RELAY', reply: null }, '*');
          return;
        }
        window.postMessage({ type: 'GL_GROQ_RESPONSE_RELAY', reply: response?.reply || null }, '*');
      });
    } catch(e) {
      window.postMessage({ type: 'GL_GROQ_RESPONSE_RELAY', reply: null }, '*');
    }
  });

})();