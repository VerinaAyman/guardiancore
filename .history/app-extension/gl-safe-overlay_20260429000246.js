/**
 * gl-safe-overlay.js — GuardianLens Safe Page Overlay
 * Unified design: matches blocked.html / warning.html exactly.
 * Dark navy theme, same chat UI, same fonts, same animations.
 */

(function () {
  'use strict';

  if (document.getElementById('gl-overlay-root')) return;

  // Inject Sora font if not present
  if (!document.querySelector('link[href*="Sora"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap';
    document.head.appendChild(link);
  }

  const currentUrl = location.href;
  let siteDomain = currentUrl;
  try { siteDomain = new URL(currentUrl).hostname.replace('www.', ''); } catch (e) {}

  // ── Styles — exactly matching blocked/warning design tokens ──
  const style = document.createElement('style');
  style.id = 'gl-overlay-styles';
  style.textContent = `
    #gl-overlay-root * {
      box-sizing: border-box; margin: 0; padding: 0;
      font-family: 'Sora', sans-serif;
    }

    /* ── FAB ── */
    #gl-fab {
      position: fixed; bottom: 24px; right: 24px;
      width: 52px; height: 52px; border-radius: 50%;
      background: linear-gradient(135deg, #1d4ed8, #7c3aed);
      border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      font-size: 1.4rem;
      box-shadow: 0 4px 24px rgba(99,102,241,.5), 0 0 0 0 rgba(99,102,241,.4);
      z-index: 2147483646;
      animation: glFabIn .5s cubic-bezier(.34,1.56,.64,1) both,
                 glFabPulse 3s ease-in-out 1s infinite;
      transition: transform .2s, box-shadow .2s;
    }
    #gl-fab:hover { transform: scale(1.1) translateY(-2px); box-shadow: 0 8px 32px rgba(99,102,241,.7); }
    #gl-fab:active { transform: scale(.95); }
    @keyframes glFabIn {
      from { opacity:0; transform:scale(.3) translateY(20px); }
      to   { opacity:1; transform:scale(1) translateY(0); }
    }
    @keyframes glFabPulse {
      0%,100% { box-shadow:0 4px 24px rgba(99,102,241,.5),0 0 0 0 rgba(99,102,241,.4); }
      50%      { box-shadow:0 4px 24px rgba(99,102,241,.5),0 0 0 10px rgba(99,102,241,0); }
    }

    /* Tooltip */
    #gl-fab::after {
      content: 'GuardianLens';
      position: absolute; right: calc(100% + 10px); top: 50%;
      transform: translateY(-50%);
      background: #111827; border: 1px solid #1e293b;
      color: #e2e8f0; font-size: .72rem; font-weight: 600;
      white-space: nowrap; padding: 5px 10px; border-radius: 8px;
      opacity: 0; pointer-events: none; transition: opacity .2s;
    }
    #gl-fab:hover::after { opacity: 1; }

    /* ── Panel ── */
    #gl-panel {
      position: fixed; bottom: 88px; right: 24px;
      width: 360px; height: 500px;
      background: #0f1929;
      border: 1px solid #1e293b; border-radius: 20px;
      display: flex; flex-direction: column; overflow: hidden;
      box-shadow: 0 24px 64px rgba(0,0,0,.6);
      z-index: 2147483645;
      transform: scale(.85) translateY(20px);
      opacity: 0; pointer-events: none;
      transition: transform .3s cubic-bezier(.34,1.56,.64,1), opacity .25s ease;
    }
    #gl-panel.open {
      transform: scale(1) translateY(0);
      opacity: 1; pointer-events: all;
    }

    /* Panel header */
    #gl-panel-header {
      padding: 14px 16px; border-bottom: 1px solid #1e293b;
      display: flex; align-items: center; gap: 10px; flex-shrink: 0;
    }
    #gl-panel-avatar {
      width: 36px; height: 36px; border-radius: 50%;
      background: linear-gradient(135deg, #1d4ed8, #7c3aed);
      display: flex; align-items: center; justify-content: center;
      font-size: 1.1rem; flex-shrink: 0;
    }
    #gl-panel-title { font-size: .9rem; font-weight: 700; color: #e2e8f0; }
    #gl-panel-sub   { font-size: .7rem; color: #22c55e; display:flex; align-items:center; gap:4px; }
    .gl-online-dot  { width:5px;height:5px;border-radius:50%;background:#22c55e;animation:glBlink 2s infinite; }
    @keyframes glBlink { 0%,100%{opacity:1} 50%{opacity:.2} }
    #gl-panel-close {
      margin-left: auto; background: none; border: none;
      color: #64748b; font-size: 1.1rem; cursor: pointer;
      padding: 2px 6px; border-radius: 6px; transition: color .15s, background .15s;
    }
    #gl-panel-close:hover { color: #e2e8f0; background: rgba(255,255,255,.06); }

    /* Safe badge */
    #gl-safe-badge {
      margin: 10px 14px 0; padding: 7px 12px;
      background: rgba(34,197,94,.08); border: 1px solid rgba(34,197,94,.2);
      border-radius: 8px; font-size: .78rem; color: #22c55e; font-weight: 600;
      display: flex; align-items: center; gap: 8px; flex-shrink: 0;
    }

    /* Messages */
    #gl-messages {
      flex: 1; overflow-y: auto; padding: 14px;
      display: flex; flex-direction: column; gap: 10px; scroll-behavior: smooth;
    }
    #gl-messages::-webkit-scrollbar { width: 4px; }
    #gl-messages::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 2px; }

    .gl-msg {
      max-width: 90%; padding: .6rem .9rem; border-radius: 1rem;
      font-size: .84rem; line-height: 1.6;
      animation: glMsgIn .25s ease both;
    }
    @keyframes glMsgIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
    .gl-msg.bot  { background:#162032; border:1px solid #1e293b; color:#e2e8f0; border-bottom-left-radius:.25rem; align-self:flex-start; }
    .gl-msg.user { background:#1e3a5f; color:#e2e8f0; border-bottom-right-radius:.25rem; align-self:flex-end; }
    .gl-msg a    { color:#60a5fa; text-decoration:none; }
    .gl-msg a:hover { text-decoration:underline; }

    /* Typing */
    .gl-typing {
      display:flex; align-items:center; gap:5px;
      padding:.6rem .9rem; background:#162032; border:1px solid #1e293b;
      border-radius:1rem; border-bottom-left-radius:.25rem;
      align-self:flex-start; width:fit-content;
    }
    .gl-typing span { width:6px;height:6px;border-radius:50%;background:#64748b;animation:glBounce .9s ease-in-out infinite; }
    .gl-typing span:nth-child(2){animation-delay:.15s} .gl-typing span:nth-child(3){animation-delay:.30s}
    @keyframes glBounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-6px)} }

    /* Chips */
    #gl-chips { display:flex;flex-wrap:wrap;gap:.4rem;padding:.5rem 1rem;flex-shrink:0; }
    .gl-chip {
      background:#1e293b; border:1px solid #1e293b; border-radius:2rem;
      padding:.35rem .8rem; font-size:.75rem; color:#94a3b8;
      cursor:pointer; transition:background .15s,border-color .15s; white-space:nowrap;
    }
    .gl-chip:hover { background:#2d3f57; border-color:#3b82f6; color:#e2e8f0; }

    /* Input row */
    #gl-input-row {
      display:flex; gap:.5rem; padding:.75rem 1rem 1rem; flex-shrink:0;
      border-top:1px solid #1e293b;
    }
    #gl-input {
      flex:1; background:#1e293b; border:1px solid #1e293b; border-radius:.6rem;
      color:#e2e8f0; font-family:'Sora',sans-serif; font-size:.84rem;
      padding:.55rem .85rem; outline:none; transition:border-color .15s;
    }
    #gl-input:focus { border-color:#3b82f6; }
    #gl-input::placeholder { color:#64748b; }
    #gl-send {
      background:linear-gradient(135deg,#1d4ed8,#7c3aed); border:none;
      border-radius:.6rem; padding:.55rem .85rem; color:#fff;
      font-size:1rem; cursor:pointer; transition:opacity .15s; flex-shrink:0;
    }
    #gl-send:hover { opacity:.85; }

    @media(max-width:480px){
      #gl-panel { width:calc(100vw - 24px); right:12px; bottom:80px; }
      #gl-fab   { bottom:16px; right:16px; }
    }
  `;
  document.head.appendChild(style);

  // ── Root ──
  const root = document.createElement('div');
  root.id = 'gl-overlay-root';
  document.body.appendChild(root);

  // ── FAB ──
  const fab = document.createElement('button');
  fab.id = 'gl-fab';
  fab.innerHTML = '🛡️';
  fab.setAttribute('aria-label', 'Open GuardianLens');
  root.appendChild(fab);

  // ── Panel ──
  const panel = document.createElement('div');
  panel.id = 'gl-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'GuardianLens chat');
  panel.innerHTML = `
    <div id="gl-panel-header">
      <div id="gl-panel-avatar">🛡️</div>
      <div>
        <div id="gl-panel-title">GuardianLens</div>
        <div id="gl-panel-sub"><span class="gl-online-dot"></span>&nbsp;Online · Safe page</div>
      </div>
      <button id="gl-panel-close" aria-label="Close">✕</button>
    </div>
    <div id="gl-safe-badge">✅ This page looks safe · <span id="gl-domain"></span></div>
    <div id="gl-messages"></div>
    <div id="gl-chips">
      <div class="gl-chip" data-q="What's this website about?">About this site</div>
      <div class="gl-chip" data-q="Find me similar safe websites">Similar sites</div>
      <div class="gl-chip" data-q="Any tips for using this site safely?">Safety tips</div>
    </div>
    <div id="gl-input-row">
      <input id="gl-input" type="text" placeholder="Ask GuardianLens…" autocomplete="off" />
      <button id="gl-send">➤</button>
    </div>
  `;
  root.appendChild(panel);

  // Set domain in badge
  const domainEl = document.getElementById('gl-domain');
  if (domainEl) domainEl.textContent = siteDomain;

  const closeBtn  = document.getElementById('gl-panel-close');
  const messages  = document.getElementById('gl-messages');
  const chipsEl   = document.getElementById('gl-chips');
  const input     = document.getElementById('gl-input');
  const sendBtn   = document.getElementById('gl-send');

  let panelOpen = false;
  const chatHistory = [];

  // ── Audio ──
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  function playChime() {
    try {
      const ctx = new AudioCtx();
      [784, 880, 1047].forEach((f, i) => {
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.connect(g); g.connect(ctx.destination);
        osc.type = 'sine'; osc.frequency.value = f;
        g.gain.setValueAtTime(0, ctx.currentTime + i * .12);
        g.gain.linearRampToValueAtTime(0.08, ctx.currentTime + i * .12 + .04);
        g.gain.linearRampToValueAtTime(0, ctx.currentTime + i * .12 + .28);
        osc.start(ctx.currentTime + i * .12);
        osc.stop(ctx.currentTime + i * .12 + .3);
      });
    } catch (e) {}
  }
  function playPop() {
    try {
      const ctx = new AudioCtx(), osc = ctx.createOscillator(), g = ctx.createGain();
      osc.connect(g); g.connect(ctx.destination);
      osc.type = 'sine'; osc.frequency.value = 880;
      g.gain.setValueAtTime(0.07, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0, ctx.currentTime + .12);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + .13);
    } catch (e) {}
  }

  // ── Open / Close ──
  function openPanel() {
    panel.classList.add('open');
    panelOpen = true;
    playChime();
    if (chatHistory.length === 0) seedGreeting();
  }
  function closePanel() {
    panel.classList.remove('open');
    panelOpen = false;
  }

  fab.addEventListener('click', () => panelOpen ? closePanel() : openPanel());
  closeBtn.addEventListener('click', closePanel);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panelOpen) closePanel(); });

  // ── Messages ──
  function addMsg(role, text) {
    const div = document.createElement('div');
    div.className = 'gl-msg ' + role;
    div.innerHTML = text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    if (role === 'bot') playPop();
  }

  function showTyping() {
    const d = document.createElement('div');
    d.className = 'gl-typing'; d.id = 'gl-typing';
    d.innerHTML = '<span></span><span></span><span></span>';
    messages.appendChild(d);
    messages.scrollTop = messages.scrollHeight;
  }
  function removeTyping() { document.getElementById('gl-typing')?.remove(); }

  const SYSTEM_PROMPT = `You are GuardianLens, a warm and friendly AI assistant in a family safety browser extension for kids.

The child is currently on this SAFE website:
- Full URL: ${currentUrl}
- Domain: ${siteDomain}

This page has been marked SAFE by GuardianLens. Keep the vibe positive and helpful!

Your job:
1. When asked about the site, give a fun, kid-friendly description of what ${siteDomain} is.
2. If asked for similar sites, suggest 3-4 safe alternatives.
3. Format links as [Name](url) with an emoji and short description.
4. Keep answers short and upbeat.

Never suggest unsafe or age-inappropriate content.`;

  function callGL(userMsg) {
    chatHistory.push({ role: 'user', content: userMsg });
    showTyping();
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage(
        { type: 'LENS_GROQ_REQUEST', systemPrompt: SYSTEM_PROMPT, history: chatHistory },
        (response) => {
          removeTyping();
          if (chrome.runtime.lastError || !response?.reply) {
            addMsg('bot', "I had a little hiccup — try again in a sec! 🙈");
            return;
          }
          chatHistory.push({ role: 'assistant', content: response.reply });
          addMsg('bot', response.reply);
        }
      );
    } else {
      setTimeout(() => { removeTyping(); addMsg('bot', `✅ **${siteDomain}** is a safe site! Ask me anything about it.`); }, 1000);
    }
  }

  function seedGreeting() {
    callGL(`I just opened GuardianLens on ${siteDomain}. Give me a quick friendly 2-sentence intro to this site, then ask if I want tips or similar safe sites.`);
  }

  function sendMsg() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    addMsg('user', text);
    callGL(text);
  }

  sendBtn.addEventListener('click', sendMsg);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMsg(); });

  chipsEl.querySelectorAll('.gl-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const q = chip.dataset.q;
      if (!q) return;
      addMsg('user', q);
      callGL(q);
      chipsEl.style.display = 'none';
      playPop();
    });
  });

})();