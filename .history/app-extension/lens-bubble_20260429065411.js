/**
 * lens-bubble.js — GuardianLens chatbot content script
 * Unified dark navy design matching blocked.html / warning-overlay.js
 * Modes: safe (blue/purple FAB) · warn (amber) · escalate (red)
 */

(function () {
  'use strict';

  if (document.getElementById('gl-bubble-root')) return;
  if (document.getElementById('gl-warning-root')) return; // warning overlay takes priority

  const RISK_WARN_THRESHOLD     = 0.05;
  const RISK_ESCALATE_THRESHOLD = 0.85;

  let chatOpen        = false;
  let chatHistory     = [];
  let currentContext  = null;
  let warningDismissed = false;
  let currentMode     = 'safe'; // 'safe' | 'warn' | 'escalate'

  // ── Fonts ──
  if (!document.querySelector('link[href*="Sora"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap';
    document.head.appendChild(link);
  }

  // ── Styles ──
  const style = document.createElement('style');
  style.id = 'gl-bubble-styles';
  style.textContent = `
    #gl-bubble-root * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Sora', sans-serif; }

    /* FAB */
    #gl-fab {
      position: fixed; bottom: 24px; right: 24px;
      width: 54px; height: 54px; border-radius: 50%;
      background: linear-gradient(135deg, #1d4ed8, #7c3aed);
      border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      font-size: 1.4rem;
      box-shadow: 0 4px 24px rgba(99,102,241,.5), 0 0 0 0 rgba(99,102,241,.4);
      z-index: 2147483646;
      animation: glFabIn .5s cubic-bezier(.34,1.56,.64,1) both, glFabPulse 3s ease-in-out 1s infinite;
      transition: transform .2s, box-shadow .2s, background .3s;
    }
    #gl-fab.warn     { background: linear-gradient(135deg, #d97706, #f59e0b); box-shadow: 0 4px 24px rgba(245,158,11,.5); animation: glFabIn .5s cubic-bezier(.34,1.56,.64,1) both, glFabWarnPulse 1.5s ease-in-out infinite; }
    #gl-fab.escalate { background: linear-gradient(135deg, #dc2626, #f97316); box-shadow: 0 4px 24px rgba(220,38,38,.6); animation: glFabIn .5s cubic-bezier(.34,1.56,.64,1) both, glFabShake .5s ease-in-out infinite; }
    #gl-fab:hover { transform: scale(1.1) translateY(-2px); }
    #gl-fab:active { transform: scale(.95); }
    @keyframes glFabIn { from{opacity:0;transform:scale(.3) translateY(20px)} to{opacity:1;transform:scale(1) translateY(0)} }
    @keyframes glFabPulse { 0%,100%{box-shadow:0 4px 24px rgba(99,102,241,.5),0 0 0 0 rgba(99,102,241,.4)} 50%{box-shadow:0 4px 24px rgba(99,102,241,.5),0 0 0 10px rgba(99,102,241,0)} }
    @keyframes glFabWarnPulse { 0%,100%{box-shadow:0 4px 24px rgba(245,158,11,.5),0 0 0 0 rgba(245,158,11,.4)} 50%{box-shadow:0 4px 24px rgba(245,158,11,.5),0 0 0 12px rgba(245,158,11,0)} }
    @keyframes glFabShake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-4px) rotate(-3deg)} 75%{transform:translateX(4px) rotate(3deg)} }

    /* Badge */
    #gl-badge {
      position: fixed; bottom: 86px; right: 20px;
      background: #f59e0b; color: #000;
      font-size: .7rem; font-weight: 700;
      padding: 4px 10px; border-radius: 20px;
      z-index: 2147483646; pointer-events: none;
      opacity: 0; transform: translateY(6px) scale(.9);
      transition: opacity .25s, transform .25s cubic-bezier(.34,1.56,.64,1);
    }
    #gl-badge.show { opacity: 1; transform: translateY(0) scale(1); }
    #gl-badge.escalate { background: #dc2626; color: #fff; }

    /* Panel */
    #gl-panel {
      position: fixed; bottom: 92px; right: 24px;
      width: 360px; max-height: 540px;
      background: #0f1929;
      border: 1px solid #1e293b; border-radius: 20px;
      display: none; flex-direction: column; overflow: hidden;
      box-shadow: 0 24px 64px rgba(0,0,0,.7);
      z-index: 2147483645;
      transform-origin: bottom right;
    }
    #gl-panel.open { display: flex; animation: glPanelIn .3s cubic-bezier(.34,1.56,.64,1); }
    @keyframes glPanelIn { from{opacity:0;transform:scale(.85) translateY(12px)} to{opacity:1;transform:scale(1) translateY(0)} }

    /* Header */
    #gl-header {
      padding: 14px 16px 12px; border-bottom: 1px solid #1e293b;
      display: flex; align-items: center; gap: 10px; flex-shrink: 0;
      transition: background .3s;
    }
    #gl-header.safe     { background: rgba(99,102,241,.05); }
    #gl-header.warn     { background: rgba(245,158,11,.07); }
    #gl-header.escalate { background: rgba(220,38,38,.07); }

    #gl-avatar {
      width: 40px; height: 40px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 1.2rem; flex-shrink: 0;
      transition: background .3s;
    }
    #gl-avatar.safe     { background: linear-gradient(135deg,#1d4ed8,#7c3aed); }
    #gl-avatar.warn     { background: linear-gradient(135deg,#d97706,#f59e0b); }
    #gl-avatar.escalate { background: linear-gradient(135deg,#dc2626,#f97316); }

    #gl-title { font-size: .92rem; font-weight: 700; color: #e2e8f0; }
    #gl-sub   { font-size: .7rem; color: #64748b; margin-top: 1px; display:flex; align-items:center; gap:4px; }
    #gl-sub.warn     { color: #f59e0b; }
    #gl-sub.escalate { color: #f87171; }
    .gl-online-dot { width:5px;height:5px;border-radius:50%;background:#22c55e;animation:glBlink 2s infinite; }
    .gl-online-dot.warn { background:#f59e0b; }
    .gl-online-dot.escalate { background:#f87171; }
    @keyframes glBlink { 0%,100%{opacity:1} 50%{opacity:.2} }

    #gl-close {
      margin-left:auto; background:none; border:none; color:#64748b;
      font-size:1.1rem; cursor:pointer; padding:2px 6px; border-radius:6px;
      transition:color .15s,background .15s;
    }
    #gl-close:hover { color:#e2e8f0; background:rgba(255,255,255,.06); }

    /* Context strip */
    #gl-context {
      padding: 8px 14px; border-bottom: 1px solid #1e293b;
      display: none; flex-shrink: 0;
    }
    #gl-context.show { display: block; }
    .gl-ctx-pill {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 5px 10px; border-radius: 8px; font-size: .75rem;
      font-weight: 600; margin-right: 6px; margin-bottom: 4px;
    }
    .gl-ctx-pill.warn     { background: rgba(245,158,11,.08); border: 1px solid rgba(245,158,11,.2); color: #f59e0b; }
    .gl-ctx-pill.escalate { background: rgba(220,38,38,.08); border: 1px solid rgba(220,38,38,.2); color: #f87171; }
    .gl-ctx-pill.safe     { background: rgba(34,197,94,.08); border: 1px solid rgba(34,197,94,.2); color: #22c55e; }

    /* Messages */
    #gl-messages {
      flex: 1; overflow-y: auto; padding: 12px;
      display: flex; flex-direction: column; gap: 8px;
      scroll-behavior: smooth; min-height: 160px; max-height: 300px;
    }
    #gl-messages::-webkit-scrollbar { width: 3px; }
    #gl-messages::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 2px; }

    .gl-msg {
      max-width: 90%; padding: .55rem .85rem; border-radius: .9rem;
      font-size: .83rem; line-height: 1.6;
      animation: glMsgIn .22s ease both;
    }
    @keyframes glMsgIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
    .gl-msg.bot  { background:#162032; border:1px solid #1e293b; color:#e2e8f0; border-bottom-left-radius:.2rem; align-self:flex-start; }
    .gl-msg.user { background:#1e3a5f; color:#e2e8f0; border-bottom-right-radius:.2rem; align-self:flex-end; }
    .gl-msg.escalate-card { background:rgba(220,38,38,.08); border:1px solid rgba(220,38,38,.2); color:#fca5a5; }
    .gl-msg a { color:#60a5fa; text-decoration:none; }
    .gl-msg a:hover { text-decoration:underline; }

    /* Alternatives */
    .gl-alts { background:#111827; border:1px solid #1e293b; border-radius:12px; padding:10px; max-width:92%; align-self:flex-start; margin-top:2px; }
    .gl-alts-title { font-size:.7rem; font-weight:700; color:#7c3aed; text-transform:uppercase; letter-spacing:.6px; margin-bottom:8px; }
    .gl-alt-item {
      display:flex; align-items:center; gap:8px; padding:7px 9px;
      background:#162032; border:1px solid #1e293b; border-radius:8px;
      margin-bottom:5px; text-decoration:none;
      transition:transform .15s, border-color .15s;
    }
    .gl-alt-item:last-child { margin-bottom:0; }
    .gl-alt-item:hover { transform:translateX(3px); border-color:#3b82f6; }
    .gl-alt-name { font-size:.78rem; font-weight:700; color:#e2e8f0; }
    .gl-alt-desc { font-size:.68rem; color:#64748b; }
    .gl-alt-arrow { font-size:.75rem; color:#3b82f6; margin-left:auto; }

    /* Typing */
    .gl-typing {
      display:flex; align-items:center; gap:4px;
      padding:.5rem .85rem; background:#162032; border:1px solid #1e293b;
      border-radius:.9rem; border-bottom-left-radius:.2rem;
      align-self:flex-start; width:fit-content;
    }
    .gl-typing span { width:5px;height:5px;border-radius:50%;background:#64748b;animation:glBounce .9s ease-in-out infinite; }
    .gl-typing span:nth-child(2){animation-delay:.15s} .gl-typing span:nth-child(3){animation-delay:.30s}
    @keyframes glBounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-5px)} }

    /* Dismiss bar */
    #gl-dismiss-bar {
      padding: 8px 14px; border-top: 1px solid #1e293b;
      display: none; align-items: center; gap: 8px; flex-shrink: 0;
      background: rgba(245,158,11,.04);
    }
    #gl-dismiss-bar.show { display: flex; }
    #gl-dismiss-text { font-size:.75rem; color:#94a3b8; flex:1; }
    #gl-dismiss-btn {
      background:#f59e0b; border:none; border-radius:20px;
      padding:5px 12px; color:#000; font-family:'Sora',sans-serif;
      font-size:.72rem; font-weight:700; cursor:pointer; white-space:nowrap;
      transition:opacity .15s;
    }
    #gl-dismiss-btn:hover { opacity:.85; }

    /* Chips */
    #gl-chips { display:flex;flex-wrap:wrap;gap:.35rem;padding:.4rem .85rem;flex-shrink:0; }
    .gl-chip {
      background:#1e293b; border:1px solid #1e293b; border-radius:2rem;
      padding:.28rem .7rem; font-size:.72rem; color:#94a3b8;
      cursor:pointer; transition:all .15s; white-space:nowrap;
    }
    .gl-chip:hover { background:#2d3f57; border-color:#3b82f6; color:#e2e8f0; }
    .gl-chip.warn:hover { border-color:#f59e0b; color:#f59e0b; }

    /* Input row */
    #gl-input-row {
      display:flex; gap:.4rem; padding:.6rem .85rem .75rem; flex-shrink:0;
      border-top:1px solid #1e293b;
    }
    #gl-input {
      flex:1; background:#1e293b; border:1px solid #1e293b; border-radius:.55rem;
      color:#e2e8f0; font-family:'Sora',sans-serif; font-size:.82rem;
      padding:.48rem .75rem; outline:none; transition:border-color .15s;
    }
    #gl-input:focus { border-color:#3b82f6; }
    #gl-input.warn:focus { border-color:#f59e0b; }
    #gl-input::placeholder { color:#475569; }
    #gl-send {
      background:linear-gradient(135deg,#1d4ed8,#7c3aed); border:none;
      border-radius:.55rem; padding:.48rem .75rem; color:#fff;
      font-size:.9rem; font-weight:700; cursor:pointer; transition:opacity .15s; flex-shrink:0;
    }
    #gl-send.warn { background:#f59e0b; color:#000; }
    #gl-send.escalate { background:#dc2626; }
    #gl-send:hover { opacity:.85; }
    #gl-send:disabled { opacity:.4; pointer-events:none; }

    @media(max-width:480px){
      #gl-panel { width:calc(100vw - 24px); right:12px; bottom:84px; }
      #gl-fab   { bottom:16px; right:16px; }
    }
  `;
  document.head.appendChild(style);

  // ── Safer alternatives ──
  const SAFER_ALTERNATIVES = {
    'twitch.tv':     [{ name:'YouTube Gaming', url:'https://www.youtube.com/gaming', desc:'Safe gaming videos' }, { name:'PBS Kids', url:'https://pbskids.org', desc:'Fun & educational' }],
    'tiktok.com':    [{ name:'YouTube Kids', url:'https://www.youtubekids.com', desc:'Videos made for kids' }, { name:'Nickelodeon', url:'https://www.nick.com', desc:'Fun shows & games' }],
    'instagram.com': [{ name:'Flickr', url:'https://www.flickr.com', desc:'Photo sharing safely' }, { name:'500px', url:'https://500px.com', desc:'Creative photography' }],
    'discord.com':   [{ name:'Messenger Kids', url:'https://messengerkids.com', desc:'Safe messaging for kids' }],
    'roblox.com':    [{ name:'Scratch', url:'https://scratch.mit.edu', desc:'Build games safely' }, { name:'Minecraft Education', url:'https://education.minecraft.net', desc:'Creative & educational' }],
    'reddit.com':    [{ name:'Wikipedia', url:'https://en.wikipedia.org', desc:'Learn anything safely' }, { name:'Khan Academy', url:'https://www.khanacademy.org', desc:'Free learning' }],
    'default':       [{ name:'Wikipedia', url:'https://en.wikipedia.org', desc:'Learn anything safely' }, { name:'Khan Academy', url:'https://www.khanacademy.org', desc:'Free learning for everyone' }, { name:'NASA Kids', url:'https://www.nasa.gov/kids-and-education/', desc:'Space & science fun' }]
  };

  function getAlts(domain) {
    const key = Object.keys(SAFER_ALTERNATIVES).find(k => domain.includes(k));
    return SAFER_ALTERNATIVES[key] || SAFER_ALTERNATIVES['default'];
  }

  // ── Build DOM ──
  const root = document.createElement('div');
  root.id = 'gl-bubble-root';
  document.body.appendChild(root);

  const fab = document.createElement('button');
  fab.id = 'gl-fab'; fab.innerHTML = '🛡️';
  fab.setAttribute('aria-label', 'Open GuardianLens');
  root.appendChild(fab);

  const badge = document.createElement('div');
  badge.id = 'gl-badge';
  root.appendChild(badge);

  const panel = document.createElement('div');
  panel.id = 'gl-panel';
  panel.setAttribute('role', 'dialog');
  panel.innerHTML = `
    <div id="gl-header" class="safe">
      <div id="gl-avatar" class="safe">🛡️</div>
      <div>
        <div id="gl-title">GuardianLens</div>
        <div id="gl-sub" class="safe"><span class="gl-online-dot"></span>&nbsp;Online · Here to help</div>
      </div>
      <button id="gl-close" aria-label="Close">✕</button>
    </div>
    <div id="gl-context"></div>
    <div id="gl-messages"></div>
    <div id="gl-dismiss-bar">
      <span id="gl-dismiss-text">You can still stay on this page.</span>
      <button id="gl-dismiss-btn">Got it ✌️</button>
    </div>
    <div id="gl-chips">
      <div class="gl-chip" data-q="Is this site safe for me?">Is it safe?</div>
      <div class="gl-chip" data-q="Show me safer alternatives">Safer options</div>
      <div class="gl-chip" data-q="Why did you flag this?">Why flagged?</div>
    </div>
    <div id="gl-input-row">
      <input id="gl-input" type="text" placeholder="Ask GuardianLens…" autocomplete="off" />
      <button id="gl-send">➤</button>
    </div>
  `;
  root.appendChild(panel);

  const messagesEl = document.getElementById('gl-messages');
  const chipsEl    = document.getElementById('gl-chips');
  const inputEl    = document.getElementById('gl-input');
  const sendBtn    = document.getElementById('gl-send');
  const dismissBar = document.getElementById('gl-dismiss-bar');
  const contextEl  = document.getElementById('gl-context');

  // ── Audio ──
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  function playChime(freqs = [784,880,1047]) {
    try {
      const ctx = new AudioCtx();
      freqs.forEach((f,i) => {
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.connect(g); g.connect(ctx.destination);
        osc.type = 'sine'; osc.frequency.value = f;
        g.gain.setValueAtTime(0, ctx.currentTime + i*.12);
        g.gain.linearRampToValueAtTime(0.09, ctx.currentTime + i*.12 + .04);
        g.gain.linearRampToValueAtTime(0, ctx.currentTime + i*.12 + .28);
        osc.start(ctx.currentTime + i*.12);
        osc.stop(ctx.currentTime + i*.12 + .3);
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

  // ── Mode switching ──
  function setMode(mode) {
    currentMode = mode;
    const el = { fab, header: document.getElementById('gl-header'), avatar: document.getElementById('gl-avatar'), sub: document.getElementById('gl-sub'), dot: document.querySelector('.gl-online-dot') };
    ['safe','warn','escalate'].forEach(m => {
      el.fab.classList.remove(m);
      el.header.classList.remove(m);
      el.avatar.classList.remove(m);
      el.sub.classList.remove(m);
      if (el.dot) el.dot.classList.remove(m);
    });
    el.fab.classList.add(mode);
    el.header.classList.add(mode);
    el.avatar.classList.add(mode);
    el.sub.classList.add(mode);
    if (el.dot) el.dot.classList.add(mode);
    sendBtn.className = mode === 'safe' ? '' : mode;
    inputEl.className = mode === 'safe' ? '' : mode;

    if (mode === 'safe') {
      el.fab.innerHTML = '🛡️';
      document.getElementById('gl-sub').innerHTML = '<span class="gl-online-dot"></span>&nbsp;Online · Safe page';
    } else if (mode === 'warn') {
      el.fab.innerHTML = '⚠️';
      document.getElementById('gl-sub').innerHTML = '<span class="gl-online-dot warn"></span>&nbsp;Heads up!';
      badge.className = 'show'; badge.textContent = 'Hey! 👀';
    } else {
      el.fab.innerHTML = '🚨';
      document.getElementById('gl-sub').innerHTML = '<span class="gl-online-dot escalate"></span>&nbsp;Alert!';
      badge.className = 'show escalate'; badge.textContent = 'Uh oh!';
    }
  }

  // ── Open / close ──
  function openPanel() {
    panel.classList.add('open');
    chatOpen = true;
    badge.classList.remove('show');
    inputEl.focus();
    if (currentMode === 'warn') playChime([523,622,523]);
    else if (currentMode === 'escalate') playChime([400,350,300]);
    else playChime();
  }
  function closePanel() {
    panel.classList.remove('open');
    chatOpen = false;
    if (currentContext && !warningDismissed && currentMode === 'warn') {
      chrome.runtime.sendMessage({ type:'LENS_WARNING_DISMISSED', domain:currentContext.domain, category:currentContext.category, risk:currentContext.risk, url:location.href });
      warningDismissed = true;
    }
  }

  fab.addEventListener('click', () => chatOpen ? closePanel() : openPanel());
  document.getElementById('gl-close').addEventListener('click', closePanel);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && chatOpen) closePanel(); });

  // ── Messages ──
  function addMsg(role, text, extraClass = '') {
    const div = document.createElement('div');
    div.className = `gl-msg ${role} ${extraClass}`.trim();
    div.innerHTML = text
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\n/g,'<br>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    if (role === 'bot') playPop();
  }

  function showTyping() {
    const d = document.createElement('div');
    d.className = 'gl-typing'; d.id = 'gl-typing';
    d.innerHTML = '<span></span><span></span><span></span>';
    messagesEl.appendChild(d);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  function removeTyping() { document.getElementById('gl-typing')?.remove(); }

  function addAltsCard(domain) {
    const alts = getAlts(domain);
    const wrap = document.createElement('div');
    wrap.className = 'gl-alts';
    wrap.innerHTML = `<div class="gl-alts-title">✨ Try these instead</div>` +
      alts.map(a => `<a class="gl-alt-item" href="${a.url}" target="_blank" rel="noopener noreferrer">
        <div><div class="gl-alt-name">${a.name}</div><div class="gl-alt-desc">${a.desc}</div></div>
        <span class="gl-alt-arrow">→</span></a>`).join('');
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setLock(locked) {
    inputEl.disabled = locked;
    sendBtn.disabled = locked;
  }

  // ── System prompt ──
  function buildPrompt(ctx) {
    if (!ctx) return `You are GuardianLens, a warm and friendly AI safety buddy for kids aged 6–16. Keep responses to 2–3 sentences max. Be helpful and friendly.`;
    const alts = getAlts(ctx.domain).map(a => `${a.name} (${a.url})`).join(', ');
    return `You are GuardianLens, a warm and friendly AI safety buddy for kids aged 6–16 in Egypt.
Website: ${ctx.domain} | Risk: ${Math.round(ctx.risk*100)}/100 | Type: ${ctx.category}
What was found: ${ctx.summary}
Safer alternatives: ${alts}
Keep responses to 2–3 sentences. Be the kid's cool older friend, not a cop. Never lecture. Never shame. Ask what they think.`;
  }

  // ── Groq call ──
  function callGL(userMsg) {
    if (userMsg) chatHistory.push({ role:'user', content:userMsg });
    showTyping(); setLock(true);
    chrome.runtime.sendMessage(
      { type:'LENS_GROQ_REQUEST', systemPrompt: buildPrompt(currentContext), history: chatHistory },
      (response) => {
        removeTyping(); setLock(false);
        if (chrome.runtime.lastError || !response?.reply) { addMsg('bot','I had a little hiccup — try again in a sec! 🙈'); return; }
        chatHistory.push({ role:'assistant', content:response.reply });
        addMsg('bot', response.reply);
      }
    );
  }

  // ── Send ──
  function sendMsg() {
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';
    addMsg('user', text);
    callGL(text);
    const asksAlts = /alternative|instead|other|suggest|different|safer/i.test(text);
    if (currentContext && asksAlts) setTimeout(() => addAltsCard(currentContext.domain), 800);
  }

  sendBtn.addEventListener('click', sendMsg);
  inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') sendMsg(); });

  chipsEl.querySelectorAll('.gl-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const q = chip.dataset.q; if (!q) return;
      addMsg('user', q); callGL(q);
      chipsEl.style.display = 'none'; playPop();
    });
  });

  // ── Dismiss ──
  document.getElementById('gl-dismiss-btn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type:'LENS_WARNING_DISMISSED', domain:currentContext?.domain, category:currentContext?.category, risk:currentContext?.risk, url:location.href });
    warningDismissed = true;
    dismissBar.classList.remove('show');
    closePanel();
    setMode('safe');
  });

  // ── Context pill ──
  function showContext(mode, category, domain) {
    contextEl.innerHTML = `<span class="gl-ctx-pill ${mode}">📂 ${category}</span><span class="gl-ctx-pill ${mode}">🔗 ${domain}</span>`;
    contextEl.classList.add('show');
  }

  // ── Main trigger ──
  function triggerLens(ctx) {
    currentContext = ctx;
    chatHistory    = [];
    warningDismissed = false;
    messagesEl.innerHTML = '';
    dismissBar.classList.remove('show');
    chipsEl.style.display = '';

    if (ctx.risk >= RISK_ESCALATE_THRESHOLD) {
      setMode('escalate');
      showContext('escalate', ctx.category, ctx.domain);
      chrome.runtime.sendMessage({ type:'LENS_ESCALATE', domain:ctx.domain, category:ctx.category, url:location.href });
      openPanel();
      addMsg('bot', "Hey, I need to pause you here 💛 This page has content that's too intense for your age. I've already let your parents know — you're not in trouble at all, I just care about you!", 'escalate-card');
      setTimeout(() => addAltsCard(ctx.domain), 600);

    } else if (ctx.risk >= RISK_WARN_THRESHOLD) {
      setMode('warn');
      showContext('warn', ctx.category, ctx.domain);
      setTimeout(() => {
        openPanel();
        callGL(null); // seed greeting
        setTimeout(() => {
          dismissBar.classList.add('show');
          addAltsCard(ctx.domain);
        }, 1200);
      }, 600);

    } else {
      setMode('safe');
      showContext('safe', ctx.category || 'Safe', ctx.domain);
    }
  }

  // ── Listen for background messages ──
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'LENS_TRIGGER') {
      triggerLens({
        risk:     (msg.risk || 0) / 100,
        category: msg.category || 'General concern',
        summary:  msg.reason  || msg.summary || 'Potentially inappropriate content detected.',
        domain:   msg.domain  || location.hostname
      });
    }
  });

})();