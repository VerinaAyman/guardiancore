/**
 * gl-safe-overlay.js — GuardianLens Safe Page Overlay
 * Inject via content_scripts in manifest.json on safe pages.
 * Adds a floating shield button (bottom-right) that opens a slide-in
 * chat panel with the same design as blocked.html / warning.html.
 *
 * Usage in manifest.json:
 * {
 *   "content_scripts": [{
 *     "matches": ["<all_urls>"],
 *     "js": ["gl-safe-overlay.js"],
 *     "run_at": "document_idle"
 *   }]
 * }
 *
 * Background sends { type: "GL_PAGE_STATUS", status: "safe"|"warn"|"blocked", ... }
 * This script only renders on "safe" pages.
 */

(function () {
  'use strict';

  // Only inject once
  if (document.getElementById('gl-overlay-root')) return;

  // ── Fonts (inject link tag if not present) ──
  if (!document.querySelector('link[href*="Sora"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&display=swap';
    document.head.appendChild(link);
  }

  const currentUrl = location.href;
  let siteDomain = currentUrl;
  try { siteDomain = new URL(currentUrl).hostname.replace('www.', ''); } catch (e) {}

  // ── Styles ──
  const style = document.createElement('style');
  style.id = 'gl-overlay-styles';
  style.textContent = `
    :root {
      --gl-bg:         #080e1a;
      --gl-surface:    #0f172a;
      --gl-border:     rgba(99,102,241,.18);
      --gl-border2:    rgba(255,255,255,.06);
      --gl-accent:     #6366f1;
      --gl-accent-g:   #818cf8;
      --gl-ok:         #10b981;
      --gl-text:       #f1f5f9;
      --gl-muted:      #94a3b8;
      --gl-dim:        #475569;
      --gl-sans:       'Sora', sans-serif;
      --gl-radius:     14px;
      --gl-radius-sm:  8px;
    }

    #gl-overlay-root * { box-sizing: border-box; margin: 0; padding: 0; font-family: var(--gl-sans); }

    /* ── Floating Button ── */
    #gl-fab {
      position: fixed;
      bottom: 24px; right: 24px;
      width: 52px; height: 52px;
      border-radius: 16px;
      background: linear-gradient(135deg, #6366f1, #818cf8);
      border: none;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      font-size: 1.4rem;
      box-shadow: 0 4px 24px rgba(99,102,241,.45), 0 0 0 0 rgba(99,102,241,.4);
      z-index: 2147483646;
      animation: glFabIn .5s cubic-bezier(.34,1.56,.64,1) both, glFabPulse 3s ease-in-out 1s infinite;
      transition: transform .2s, box-shadow .2s;
    }
    #gl-fab:hover { transform: scale(1.1) translateY(-2px); box-shadow: 0 8px 32px rgba(99,102,241,.6); }
    #gl-fab:active { transform: scale(.96); }

    @keyframes glFabIn {
      from { opacity:0; transform:scale(.3) translateY(20px); }
      to   { opacity:1; transform:scale(1) translateY(0); }
    }
    @keyframes glFabPulse {
      0%,100% { box-shadow:0 4px 24px rgba(99,102,241,.45),0 0 0 0 rgba(99,102,241,.4); }
      50%      { box-shadow:0 4px 24px rgba(99,102,241,.45),0 0 0 10px rgba(99,102,241,0); }
    }

    /* tooltip */
    #gl-fab::after {
      content: 'GuardianLens';
      position: absolute;
      right: calc(100% + 8px);
      top: 50%; transform: translateY(-50%);
      background: rgba(15,23,42,.95);
      border: 1px solid var(--gl-border);
      color: var(--gl-text);
      font-size: .72rem; font-weight: 600; white-space: nowrap;
      padding: 5px 10px; border-radius: 8px;
      opacity: 0; pointer-events: none;
      transition: opacity .2s;
    }
    #gl-fab:hover::after { opacity: 1; }

    /* ── Chat Panel ── */
    #gl-panel {
      position: fixed;
      bottom: 88px; right: 24px;
      width: 360px; height: 520px;
      background: linear-gradient(160deg, rgba(15,23,42,.98), rgba(18,27,48,.96));
      border: 1px solid var(--gl-border);
      border-radius: 20px;
      display: flex; flex-direction: column; overflow: hidden;
      box-shadow: 0 24px 64px rgba(0,0,0,.5), 0 0 0 1px rgba(99,102,241,.08);
      z-index: 2147483645;
      transform: scale(.85) translateY(20px);
      opacity: 0;
      pointer-events: none;
      transition: transform .3s cubic-bezier(.34,1.56,.64,1), opacity .25s ease;
      backdrop-filter: blur(20px);
    }
    #gl-panel.open {
      transform: scale(1) translateY(0);
      opacity: 1;
      pointer-events: all;
    }

    /* grid lines inside panel */
    #gl-panel::before {
      content: '';
      position: absolute; inset: 0; z-index: 0; pointer-events: none;
      background-image:
        linear-gradient(rgba(99,102,241,.03) 1px,transparent 1px),
        linear-gradient(90deg,rgba(99,102,241,.03) 1px,transparent 1px);
      background-size: 36px 36px;
    }

    #gl-panel-header {
      padding: 14px 16px;
      border-bottom: 1px solid var(--gl-border2);
      display: flex; align-items: center; gap: 10px;
      flex-shrink: 0; position: relative; z-index: 1;
    }
    #gl-panel-avatar {
      width: 34px; height: 34px; border-radius: 10px;
      background: linear-gradient(135deg,#6366f1,#818cf8);
      display: flex; align-items: center; justify-content: center;
      font-size: .95rem; flex-shrink: 0;
      box-shadow: 0 0 14px rgba(99,102,241,.4);
    }
    #gl-panel-title { font-size: .88rem; font-weight: 700; color: var(--gl-text); }
    #gl-panel-sub   {
      font-size: .7rem; color: var(--gl-ok);
      display: flex; align-items: center; gap: 4px;
    }
    .gl-online-dot { width:5px;height:5px;border-radius:50%;background:var(--gl-ok);animation:glBlink 2s infinite; }
    @keyframes glBlink{0%,100%{opacity:1}50%{opacity:.2}}
    #gl-panel-close {
      margin-left: auto;
      background: none; border: none; color: var(--gl-dim);
      font-size: 1.1rem; cursor: pointer; padding: 2px 6px; border-radius: 6px;
      transition: color .15s, background .15s;
    }
    #gl-panel-close:hover { color: var(--gl-text); background: rgba(255,255,255,.06); }

    #gl-safe-badge {
      margin: 12px 16px 0;
      padding: 8px 12px;
      background: rgba(16,185,129,.08);
      border: 1px solid rgba(16,185,129,.2);
      border-radius: var(--gl-radius-sm);
      font-size: .78rem; color: var(--gl-ok); font-weight: 600;
      display: flex; align-items: center; gap: 8px;
      flex-shrink: 0; position: relative; z-index: 1;
    }

    #gl-messages {
      flex: 1; overflow-y: auto; padding: 14px;
      display: flex; flex-direction: column; gap: 10px;
      scroll-behavior: smooth; position: relative; z-index: 1;
    }
    #gl-messages::-webkit-scrollbar { width: 3px; }
    #gl-messages::-webkit-scrollbar-thumb { background: rgba(255,255,255,.08); border-radius: 2px; }

    .gl-msg { max-width: 90%; padding: 9px 12px; border-radius: 12px; font-size: .82rem; line-height: 1.55; animation: glMsgIn .22s ease both; }
    @keyframes glMsgIn{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}
    .gl-msg.bot  { background:rgba(99,102,241,.1);border:1px solid rgba(99,102,241,.15);color:var(--gl-text);border-bottom-left-radius:4px;align-self:flex-start; }
    .gl-msg.user { background:rgba(99,102,241,.22);border:1px solid rgba(99,102,241,.3);color:var(--gl-text);border-bottom-right-radius:4px;align-self:flex-end; }
    .gl-msg a    { color:var(--gl-accent-g);text-decoration:underline;text-underline-offset:2px; }

    .gl-typing { display:flex;align-items:center;gap:4px;padding:9px 12px;background:rgba(99,102,241,.08);border:1px solid rgba(99,102,241,.12);border-radius:12px;border-bottom-left-radius:4px;align-self:flex-start;width:52px; }
    .gl-typing span { width:5px;height:5px;border-radius:50%;background:var(--gl-accent-g);animation:glTyping 1.2s ease-in-out infinite; }
    .gl-typing span:nth-child(2){animation-delay:.2s}.gl-typing span:nth-child(3){animation-delay:.4s}
    @keyframes glTyping{0%,60%,100%{transform:translateY(0);opacity:.5}30%{transform:translateY(-4px);opacity:1}}

    #gl-chips { display:flex;flex-wrap:wrap;gap:5px;padding:8px 14px;border-top:1px solid var(--gl-border2);flex-shrink:0;position:relative;z-index:1; }
    .gl-chip { padding:4px 10px;background:rgba(99,102,241,.1);border:1px solid rgba(99,102,241,.2);border-radius:20px;font-size:.72rem;color:var(--gl-accent-g);cursor:pointer;transition:all .15s;white-space:nowrap; }
    .gl-chip:hover { background:rgba(99,102,241,.22);border-color:rgba(99,102,241,.4);transform:translateY(-1px); }

    #gl-input-row { display:flex;gap:7px;padding:10px 14px;border-top:1px solid var(--gl-border2);flex-shrink:0;position:relative;z-index:1; }
    #gl-input { flex:1;background:rgba(255,255,255,.04);border:1px solid var(--gl-border2);border-radius:var(--gl-radius-sm);color:var(--gl-text);font-family:var(--gl-sans);font-size:.82rem;padding:8px 11px;outline:none;transition:border-color .2s; }
    #gl-input:focus { border-color:rgba(99,102,241,.4); }
    #gl-input::placeholder { color:var(--gl-dim); }
    #gl-send { padding:8px 12px;background:var(--gl-accent);border:none;border-radius:var(--gl-radius-sm);color:#fff;font-size:.95rem;cursor:pointer;transition:background .2s,transform .1s;flex-shrink:0; }
    #gl-send:hover { background:var(--gl-accent-g);transform:scale(1.05); }

    @media(max-width:480px){
      #gl-panel { width: calc(100vw - 24px); right: 12px; bottom: 80px; }
      #gl-fab   { bottom: 16px; right: 16px; }
    }
  `;
  chrome.runtime.sendMessage({ type: 'GL_OVERLAY_CSS', css: style.textContent });

  // ── Root container ──
  const root = document.createElement('div');
  root.id = 'gl-overlay-root';
  document.body.appendChild(root);

  // ── FAB ──
  const fab = document.createElement('button');
  fab.id = 'gl-fab';
  fab.innerHTML = '🛡️';
  fab.title = 'GuardianLens';
  fab.setAttribute('aria-label', 'Open GuardianLens');
  root.appendChild(fab);

  // ── Chat Panel ──
  root.innerHTML += `
    <div id="gl-panel" role="dialog" aria-label="GuardianLens chat">
      <div id="gl-panel-header">
        <div id="gl-panel-avatar">🛡️</div>
        <div>
          <div id="gl-panel-title">GuardianLens</div>
          <div id="gl-panel-sub"><span class="gl-online-dot"></span>&nbsp;Online · Safe page</div>
        </div>
        <button id="gl-panel-close" aria-label="Close">✕</button>
      </div>
      <div id="gl-safe-badge">✅ This page looks safe</div>
      <div id="gl-messages"></div>
      <div id="gl-chips">
        <div class="gl-chip" data-q="What's interesting about this website?">Tell me about this site</div>
        <div class="gl-chip" data-q="Find me similar safe websites">Similar sites</div>
        <div class="gl-chip" data-q="Are there any tips for using this site safely?">Safety tips</div>
      </div>
      <div id="gl-input-row">
        <input id="gl-input" type="text" placeholder="Ask GuardianLens…" autocomplete="off" />
        <button id="gl-send">➤</button>
      </div>
    </div>
  `;

  // re-query after innerHTML
  const panel    = document.getElementById('gl-panel');
  const closeBtn = document.getElementById('gl-panel-close');
  const messages = document.getElementById('gl-messages');
  const chips    = document.getElementById('gl-chips');
  const input    = document.getElementById('gl-input');
  const sendBtn  = document.getElementById('gl-send');

  let panelOpen = false;
  const history = [];

  // ── Audio ──
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  function playChime() {
    try {
      const ctx = new AudioCtx();
      [784, 880, 1047].forEach((f,i) => {
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.connect(g); g.connect(ctx.destination);
        osc.type='sine'; osc.frequency.value=f;
        g.gain.setValueAtTime(0, ctx.currentTime+i*.12);
        g.gain.linearRampToValueAtTime(0.08, ctx.currentTime+i*.12+.04);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+i*.12+.28);
        osc.start(ctx.currentTime+i*.12); osc.stop(ctx.currentTime+i*.12+.29);
      });
    } catch(e) {}
  }
  function playPop() {
    try {
      const ctx = new AudioCtx(), osc = ctx.createOscillator(), g = ctx.createGain();
      osc.connect(g); g.connect(ctx.destination);
      osc.type='sine'; osc.frequency.value=880;
      g.gain.setValueAtTime(0.07, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+.11);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime+.12);
    } catch(e) {}
  }

  // ── Open / Close ──
  function openPanel() {
    panel.classList.add('open');
    panelOpen = true;
    fab.style.transform = 'scale(.9)';
    playChime();
    if (history.length === 0) seedGreeting();
  }
  function closePanel() {
    panel.classList.remove('open');
    panelOpen = false;
    fab.style.transform = '';
  }

  fab.addEventListener('click', () => panelOpen ? closePanel() : openPanel());
  closeBtn.addEventListener('click', closePanel);
  document.addEventListener('keydown', e => { if (e.key==='Escape' && panelOpen) closePanel(); });

  // ── Messages ──
  function addMsg(role, text) {
    const div = document.createElement('div');
    div.className = 'gl-msg ' + role;
    div.innerHTML = text.replace(/\n/g,'<br>').replace(
      /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>'
    );
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    if (role==='bot') playPop();
  }
  function showTyping() { const d=document.createElement('div');d.className='gl-typing';d.id='gl-typing';d.innerHTML='<span></span><span></span><span></span>';messages.appendChild(d);messages.scrollTop=messages.scrollHeight; }
  function removeTyping() { document.getElementById('gl-typing')?.remove(); }

  const SYSTEM_PROMPT = `You are GuardianLens, a warm and friendly AI assistant in a family safety browser extension for kids.

The child is currently on this SAFE website:
- Full URL: ${currentUrl}
- Domain: ${siteDomain}

This page has been marked SAFE by GuardianLens.

Your job:
1. Be helpful and friendly — this is a safe page, so keep the vibe positive!
2. When asked about the site, give a fun, kid-friendly description of what ${siteDomain} is for.
3. If asked for similar sites, suggest 3–4 safe alternatives that do the same thing as ${siteDomain}.
4. Format links as [Name](url) with a quick emoji + description.
5. Keep answers short and upbeat. You're a friendly guardian, not a teacher.
Never suggest unsafe content. Keep it age-appropriate.`;

  function callGL(userMsg) {
    history.push({ role:'user', content:userMsg });
    showTyping();
    chrome.runtime.sendMessage({ type: 'LENS_GROQ_REQUEST', systemPrompt: SYSTEM_PROMPT, history }, (response) => {
      removeTyping();
      if (chrome.runtime.lastError || !response?.reply) {
        addMsg('bot', "I had a little hiccup — try again in a sec!");
        return;
      }
      history.push({ role: 'assistant', content: response.reply });
      addMsg('bot', response.reply);
    });
  }

  function seedGreeting() {
    callGL(`I just opened GuardianLens on ${siteDomain}. Give me a quick friendly intro to what this site is — 2 sentences max. Then ask if I want tips or similar sites.`);
  }

  function sendMsg() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    addMsg('user', text);
    callGL(text);
  }

  sendBtn.addEventListener('click', sendMsg);
  input.addEventListener('keydown', e => { if (e.key==='Enter') sendMsg(); });

  chips.querySelectorAll('.gl-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const q = chip.dataset.q;
      addMsg('user', q);
      callGL(q);
      chips.style.display = 'none';
      playPop();
    });
  });

})();