/**
 * lens-bubble.js — GuardianLens chatbot content script
 * Dark navy base + warm playful accents for kids
 * Modes: safe (teal/mint) · warn (amber) · escalate (coral/red)
 */

(function () {
  'use strict';

  if (document.getElementById('gl-bubble-root')) return;
  if (document.getElementById('gl-warning-root')) return;

  const RISK_WARN_THRESHOLD     = 0.05;
  const RISK_ESCALATE_THRESHOLD = 0.85;

  let chatOpen        = false;
  let chatHistory     = [];
  let currentContext  = null;
  let warningDismissed = false;
  let currentMode     = 'safe';

  if (!document.querySelector('link[href*="Sora"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap';
    document.head.appendChild(link);
  }

  const style = document.createElement('style');
  style.id = 'gl-bubble-styles';
  style.textContent = `
    #gl-bubble-root * { box-sizing:border-box;margin:0;padding:0;font-family:'Sora',sans-serif; }

    #gl-fab {
      position:fixed;bottom:24px;right:24px;
      width:60px;height:60px;border-radius:50%;
      background:linear-gradient(135deg,#0d9488,#06b6d4);
      border:3px solid rgba(255,255,255,0.15);cursor:pointer;
      display:flex;align-items:center;justify-content:center;font-size:1.6rem;
      box-shadow:0 6px 28px rgba(13,148,136,.5);
      z-index:2147483646;
      animation:glFabBounce .6s cubic-bezier(.34,1.56,.64,1) both, glFabFloat 3s ease-in-out 1s infinite;
      transition:transform .2s,box-shadow .2s,background .3s,border-color .3s;
    }
    #gl-fab.warn { background:linear-gradient(135deg,#d97706,#f59e0b);border-color:rgba(255,255,255,.2);box-shadow:0 6px 28px rgba(245,158,11,.5);animation:glFabBounce .6s cubic-bezier(.34,1.56,.64,1) both,glFabWarnPulse 1.4s ease-in-out infinite; }
    #gl-fab.escalate { background:linear-gradient(135deg,#dc2626,#f97316);border-color:rgba(255,255,255,.2);box-shadow:0 6px 28px rgba(220,38,38,.6);animation:glFabBounce .6s cubic-bezier(.34,1.56,.64,1) both,glFabShake .45s ease-in-out infinite; }
    #gl-fab:hover { transform:scale(1.12) translateY(-3px); }
    #gl-fab:active { transform:scale(.93); }
    #gl-fab::after { content:'GuardianLens';position:absolute;right:calc(100% + 10px);top:50%;transform:translateY(-50%);background:#111827;border:1px solid #1e293b;color:#e2e8f0;font-size:.72rem;font-weight:600;white-space:nowrap;padding:5px 10px;border-radius:8px;opacity:0;pointer-events:none;transition:opacity .2s; }
    #gl-fab:hover::after { opacity:1; }
    @keyframes glFabBounce { from{opacity:0;transform:scale(.2) translateY(30px)} to{opacity:1;transform:scale(1) translateY(0)} }
    @keyframes glFabFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
    @keyframes glFabWarnPulse { 0%,100%{box-shadow:0 6px 28px rgba(245,158,11,.5),0 0 0 0 rgba(245,158,11,.3)} 60%{box-shadow:0 6px 28px rgba(245,158,11,.5),0 0 0 14px rgba(245,158,11,0)} }
    @keyframes glFabShake { 0%,100%{transform:translateX(0) rotate(0)} 25%{transform:translateX(-5px) rotate(-4deg)} 75%{transform:translateX(5px) rotate(4deg)} }

    #gl-badge { position:fixed;bottom:92px;right:20px;font-size:.72rem;font-weight:800;padding:5px 12px;border-radius:20px;z-index:2147483646;pointer-events:none;opacity:0;transform:translateY(8px) scale(.88);transition:opacity .25s,transform .3s cubic-bezier(.34,1.56,.64,1);border:2px solid rgba(255,255,255,.15); }
    #gl-badge.safe     { background:#0d9488;color:#fff;box-shadow:0 4px 14px rgba(13,148,136,.4); }
    #gl-badge.warn     { background:#f59e0b;color:#000;box-shadow:0 4px 14px rgba(245,158,11,.4); }
    #gl-badge.escalate { background:#dc2626;color:#fff;box-shadow:0 4px 14px rgba(220,38,38,.4); }
    #gl-badge.show { opacity:1;transform:translateY(0) scale(1); }

    #gl-panel { position:fixed;bottom:96px;right:24px;width:400px;max-height:600px;background:#0b1120;border:1px solid #1e293b;border-radius:24px;display:none;flex-direction:column;overflow:hidden;box-shadow:0 28px 70px rgba(0,0,0,.75),0 0 0 1px rgba(255,255,255,.04);z-index:2147483645;transform-origin:bottom right; }
    #gl-panel.open { display:flex;animation:glPanelIn .35s cubic-bezier(.34,1.56,.64,1); }
    @keyframes glPanelIn { from{opacity:0;transform:scale(.82) translateY(16px)} to{opacity:1;transform:scale(1) translateY(0)} }

    #gl-header { padding:16px 16px 13px;border-bottom:1px solid #1e293b;display:flex;align-items:center;gap:12px;flex-shrink:0;transition:background .3s; }
    #gl-header.safe     { background:linear-gradient(135deg,rgba(13,148,136,.12),rgba(6,182,212,.06)); }
    #gl-header.warn     { background:linear-gradient(135deg,rgba(217,119,6,.12),rgba(245,158,11,.06)); }
    #gl-header.escalate { background:linear-gradient(135deg,rgba(220,38,38,.12),rgba(249,115,22,.06)); }

    #gl-avatar-wrap { position:relative;flex-shrink:0; }
    #gl-avatar { width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.4rem;border:2px solid rgba(255,255,255,.1);transition:background .3s; }
    #gl-avatar.safe     { background:linear-gradient(135deg,#0d9488,#06b6d4); }
    #gl-avatar.warn     { background:linear-gradient(135deg,#d97706,#f59e0b); }
    #gl-avatar.escalate { background:linear-gradient(135deg,#dc2626,#f97316); }
    .gl-avatar-ring { position:absolute;inset:-5px;border-radius:50%;border:2px solid rgba(13,148,136,.4);opacity:.5;animation:glRingPulse 2s ease-out infinite; }
    @keyframes glRingPulse { 0%{transform:scale(1);opacity:.4} 100%{transform:scale(1.45);opacity:0} }

    #gl-title { font-size:.95rem;font-weight:800;color:#f1f5f9;letter-spacing:-.2px; }
    #gl-sub { font-size:.72rem;color:#64748b;margin-top:2px;display:flex;align-items:center;gap:5px;font-weight:600; }
    #gl-sub.safe { color:#2dd4bf; } #gl-sub.warn { color:#fbbf24; } #gl-sub.escalate { color:#f87171; }
    .gl-dot { width:6px;height:6px;border-radius:50%;flex-shrink:0; }
    .gl-dot.safe     { background:#2dd4bf;animation:glBlink 2s infinite; }
    .gl-dot.warn     { background:#fbbf24;animation:glBlink 1.2s infinite; }
    .gl-dot.escalate { background:#f87171;animation:glBlink .8s infinite; }
    @keyframes glBlink { 0%,100%{opacity:1} 50%{opacity:.2} }

    #gl-close { margin-left:auto;background:none;border:none;color:#475569;font-size:1.1rem;cursor:pointer;padding:4px 8px;border-radius:8px;transition:color .15s,background .15s;line-height:1; }
    #gl-close:hover { color:#e2e8f0;background:rgba(255,255,255,.07); }

    #gl-context { padding:9px 14px;border-bottom:1px solid #1e293b;display:none;flex-shrink:0; }
    #gl-context.show { display:flex;flex-wrap:wrap;gap:6px; }
    .gl-ctx-pill { display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:20px;font-size:.73rem;font-weight:700; }
    .gl-ctx-pill.safe     { background:rgba(13,148,136,.1);border:1px solid rgba(13,148,136,.25);color:#2dd4bf; }
    .gl-ctx-pill.warn     { background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.25);color:#fbbf24; }
    .gl-ctx-pill.escalate { background:rgba(220,38,38,.1);border:1px solid rgba(220,38,38,.25);color:#f87171; }

    #gl-messages { flex:1;overflow-y:auto;padding:14px 12px;display:flex;flex-direction:column;gap:10px;scroll-behavior:smooth;min-height:180px;max-height:320px; }
    #gl-messages::-webkit-scrollbar { width:3px; }
    #gl-messages::-webkit-scrollbar-thumb { background:#1e293b;border-radius:2px; }

    .gl-msg { max-width:88%;padding:.6rem 1rem;border-radius:1.1rem;font-size:.88rem;line-height:1.65;font-weight:500;animation:glMsgIn .25s cubic-bezier(.34,1.56,.64,1) both; }
    @keyframes glMsgIn { from{opacity:0;transform:translateY(8px) scale(.96)} to{opacity:1;transform:none} }
    .gl-msg.bot { background:#111827;border:1px solid #1e293b;color:#e2e8f0;border-bottom-left-radius:.3rem;align-self:flex-start;border-left:3px solid #0d9488; }
    .gl-msg.bot.warn-mode  { border-left-color:#f59e0b; }
    .gl-msg.bot.escalate-mode { border-left-color:#dc2626;background:rgba(220,38,38,.07);color:#fca5a5; }
    .gl-msg.user { background:linear-gradient(135deg,#1e3a5f,#1e293b);color:#e2e8f0;border-bottom-right-radius:.3rem;align-self:flex-end;border:1px solid #2d4a6b; }
    .gl-msg a { color:#34d399;text-decoration:none;font-weight:600; }
    .gl-msg a:hover { text-decoration:underline; }

    .gl-alts { background:#111827;border:1px solid #1e293b;border-radius:14px;padding:11px;max-width:92%;align-self:flex-start;border-top:3px solid #7c3aed; }
    .gl-alts-title { font-size:.72rem;font-weight:800;color:#a78bfa;text-transform:uppercase;letter-spacing:.7px;margin-bottom:9px; }
    .gl-alt-item { display:flex;align-items:center;gap:9px;padding:8px 10px;background:#0f1929;border:1px solid #1e293b;border-radius:10px;margin-bottom:6px;text-decoration:none;transition:transform .15s,border-color .15s,background .15s; }
    .gl-alt-item:last-child { margin-bottom:0; }
    .gl-alt-item:hover { transform:translateX(4px);border-color:#7c3aed;background:#162032; }
    .gl-alt-name { font-size:.8rem;font-weight:700;color:#f1f5f9; }
    .gl-alt-desc { font-size:.7rem;color:#64748b;margin-top:1px; }
    .gl-alt-arrow { font-size:.8rem;color:#7c3aed;margin-left:auto;font-weight:800; }

    .gl-typing { display:flex;align-items:center;gap:5px;padding:.55rem .9rem;background:#111827;border:1px solid #1e293b;border-radius:1.1rem;border-bottom-left-radius:.3rem;border-left:3px solid #0d9488;align-self:flex-start;width:fit-content; }
    .gl-typing.warn-typing { border-left-color:#f59e0b; }
    .gl-typing.escalate-typing { border-left-color:#dc2626; }
    .gl-typing span { width:6px;height:6px;border-radius:50%;background:#475569;animation:glDot .9s ease-in-out infinite; }
    .gl-typing span:nth-child(2){animation-delay:.18s} .gl-typing span:nth-child(3){animation-delay:.36s}
    @keyframes glDot { 0%,80%,100%{transform:translateY(0);opacity:.4} 40%{transform:translateY(-6px);opacity:1} }

    #gl-dismiss-bar { padding:9px 14px;border-top:1px solid #1e293b;display:none;align-items:center;gap:8px;flex-shrink:0;background:rgba(245,158,11,.04); }
    #gl-dismiss-bar.show { display:flex; }
    #gl-dismiss-text { font-size:.75rem;color:#94a3b8;flex:1;font-weight:600; }
    #gl-dismiss-btn { background:linear-gradient(135deg,#d97706,#f59e0b);border:none;border-radius:20px;padding:6px 14px;color:#000;font-family:'Sora',sans-serif;font-size:.73rem;font-weight:800;cursor:pointer;transition:opacity .15s,transform .15s; }
    #gl-dismiss-btn:hover { opacity:.9;transform:scale(1.04); }

    #gl-chips { display:flex;flex-wrap:wrap;gap:.4rem;padding:.5rem 1rem;flex-shrink:0; }
    .gl-chip { background:#111827;border:1px solid #1e293b;border-radius:2rem;padding:.32rem .85rem;font-size:.74rem;font-weight:600;color:#94a3b8;cursor:pointer;transition:all .18s;white-space:nowrap; }
    .gl-chip:hover { background:#162032;border-color:#0d9488;color:#2dd4bf;transform:translateY(-1px); }

    #gl-input-row { display:flex;gap:.5rem;padding:.7rem 1rem .85rem;flex-shrink:0;border-top:1px solid #1e293b;background:#0b1120; }
    #gl-input { flex:1;background:#111827;border:1.5px solid #1e293b;border-radius:.7rem;color:#f1f5f9;font-family:'Sora',sans-serif;font-size:.85rem;font-weight:500;padding:.52rem .85rem;outline:none;transition:border-color .2s,box-shadow .2s; }
    #gl-input:focus { border-color:#0d9488;box-shadow:0 0 0 3px rgba(13,148,136,.12); }
    #gl-input.warn:focus { border-color:#f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.12); }
    #gl-input::placeholder { color:#334155; }
    #gl-send { background:linear-gradient(135deg,#0d9488,#06b6d4);border:none;border-radius:.7rem;padding:.52rem .9rem;color:#fff;font-size:1rem;font-weight:800;cursor:pointer;transition:opacity .15s,transform .15s;flex-shrink:0;box-shadow:0 3px 12px rgba(13,148,136,.35); }
    #gl-send.warn { background:linear-gradient(135deg,#d97706,#f59e0b);color:#000;box-shadow:0 3px 12px rgba(245,158,11,.35); }
    #gl-send.escalate { background:linear-gradient(135deg,#dc2626,#f97316);box-shadow:0 3px 12px rgba(220,38,38,.35); }
    #gl-send:hover { opacity:.88;transform:translateY(-1px); }
    #gl-send:active { transform:scale(.94); }
    #gl-send:disabled { opacity:.35;pointer-events:none; }

    @media(max-width:480px){ #gl-panel{width:calc(100vw - 20px);right:10px;bottom:88px;} #gl-fab{bottom:16px;right:16px;width:54px;height:54px;font-size:1.4rem;} }
  `;
  document.head.appendChild(style);

  const SAFER_ALTERNATIVES = {
    'twitch.tv':     [{ name:'YouTube Gaming', url:'https://www.youtube.com/gaming', desc:'Safe gaming streams & videos' }, { name:'PBS Kids', url:'https://pbskids.org', desc:'Fun & educational content' }],
    'tiktok.com':    [{ name:'YouTube Kids', url:'https://www.youtubekids.com', desc:'Videos made for kids' }, { name:'Nickelodeon', url:'https://www.nick.com', desc:'Fun shows & games' }],
    'instagram.com': [{ name:'Flickr', url:'https://www.flickr.com', desc:'Safe photo sharing' }, { name:'Behance', url:'https://www.behance.net', desc:'Creative portfolios' }],
    'discord.com':   [{ name:'Messenger Kids', url:'https://messengerkids.com', desc:'Safe messaging for kids' }],
    'roblox.com':    [{ name:'Scratch', url:'https://scratch.mit.edu', desc:'Build your own games!' }, { name:'Minecraft Education', url:'https://education.minecraft.net', desc:'Creative & educational' }],
    'reddit.com':    [{ name:'Wikipedia', url:'https://en.wikipedia.org', desc:'Learn anything safely' }, { name:'Khan Academy', url:'https://www.khanacademy.org', desc:'Free learning for everyone' }],
    'default':       [{ name:'Wikipedia', url:'https://en.wikipedia.org', desc:'Learn anything safely' }, { name:'Khan Academy', url:'https://www.khanacademy.org', desc:'Free learning for everyone' }, { name:'NASA Kids', url:'https://www.nasa.gov/kids-and-education/', desc:'Space & science fun!' }]
  };

  function getAlts(domain) {
    const key = Object.keys(SAFER_ALTERNATIVES).find(k => domain.includes(k));
    return SAFER_ALTERNATIVES[key] || SAFER_ALTERNATIVES['default'];
  }

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
      <div id="gl-avatar-wrap">
        <div id="gl-avatar" class="safe">🛡️</div>
        <div class="gl-avatar-ring"></div>
      </div>
      <div>
        <div id="gl-title">GuardianLens</div>
        <div id="gl-sub" class="safe"><span class="gl-dot safe"></span>Online · Here to help</div>
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
      <div class="gl-chip" data-q="Is this site safe for me?">Is it safe? 🛡️</div>
      <div class="gl-chip" data-q="Show me safer alternatives">Safer options ✨</div>
      <div class="gl-chip" data-q="Why did you flag this page?">Why flagged? 🤔</div>
    </div>
    <div id="gl-input-row">
      <input id="gl-input" type="text" placeholder="Ask GuardianLens anything… 💬" autocomplete="off" />
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

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  function playChime(freqs = [523,659,784]) {
    try {
      const ctx = new AudioCtx();
      freqs.forEach((f,i) => {
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.connect(g); g.connect(ctx.destination);
        osc.type = 'sine'; osc.frequency.value = f;
        g.gain.setValueAtTime(0, ctx.currentTime + i*.13);
        g.gain.linearRampToValueAtTime(0.09, ctx.currentTime + i*.13 + .05);
        g.gain.linearRampToValueAtTime(0, ctx.currentTime + i*.13 + .3);
        osc.start(ctx.currentTime + i*.13); osc.stop(ctx.currentTime + i*.13 + .32);
      });
    } catch(e) {}
  }
  function playPop() {
    try {
      const ctx = new AudioCtx(), osc = ctx.createOscillator(), g = ctx.createGain();
      osc.connect(g); g.connect(ctx.destination); osc.type='sine'; osc.frequency.value=900;
      g.gain.setValueAtTime(0.06, ctx.currentTime); g.gain.linearRampToValueAtTime(0, ctx.currentTime+.13);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime+.14);
    } catch(e) {}
  }

  const MODES = {
    safe:     { fab:'🛡️', badge:'Psst! 👋',      badgeClass:'safe',     subText:'Online · Safe page',     dotClass:'safe',     chime:[523,659,784] },
    warn:     { fab:'⚠️', badge:'Heads up! 👀',   badgeClass:'warn',     subText:'Hey, quick heads up!',   dotClass:'warn',     chime:[440,370,440] },
    escalate: { fab:'🚨', badge:'Alert! 🚨',       badgeClass:'escalate', subText:'This needs attention!',  dotClass:'escalate', chime:[330,294,262] }
  };

  function setMode(mode) {
    currentMode = mode;
    const m = MODES[mode];
    fab.className = mode; fab.innerHTML = m.fab;
    const header = document.getElementById('gl-header');
    const avatar = document.getElementById('gl-avatar');
    const sub    = document.getElementById('gl-sub');
    ['safe','warn','escalate'].forEach(c => { header.classList.remove(c); avatar.classList.remove(c); sub.classList.remove(c); });
    header.classList.add(mode); avatar.classList.add(mode); sub.classList.add(mode);
    sub.innerHTML = `<span class="gl-dot ${mode}"></span>${m.subText}`;
    sendBtn.className = mode === 'safe' ? '' : mode;
    inputEl.className = mode === 'safe' ? '' : mode;
    badge.className = m.badgeClass;
    badge.textContent = m.badge;
  }

  function openPanel() {
    panel.classList.add('open'); chatOpen = true;
    badge.classList.remove('show'); inputEl.focus();
    playChime(MODES[currentMode].chime);
  }
  function closePanel() {
    panel.classList.remove('open'); chatOpen = false;
    if (currentContext && !warningDismissed && currentMode === 'warn') {
      chrome.runtime.sendMessage({ type:'LENS_WARNING_DISMISSED', domain:currentContext.domain, category:currentContext.category, risk:currentContext.risk, url:location.href });
      warningDismissed = true;
    }
  }

  fab.addEventListener('click', () => chatOpen ? closePanel() : openPanel());
  document.getElementById('gl-close').addEventListener('click', closePanel);
  document.addEventListener('keydown', e => { if (e.key==='Escape' && chatOpen) closePanel(); });

  function addMsg(role, text, extraClass='') {
    const div = document.createElement('div');
    div.className = `gl-msg ${role} ${extraClass}`.trim();
    div.innerHTML = text
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\n/g,'<br>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    if (role==='bot') playPop();
  }

  function showTyping() {
    const d = document.createElement('div');
    d.className = `gl-typing${currentMode!=='safe'?' '+currentMode+'-typing':''}`;
    d.id = 'gl-typing';
    d.innerHTML = '<span></span><span></span><span></span>';
    messagesEl.appendChild(d);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  function removeTyping() { document.getElementById('gl-typing')?.remove(); }

  function addAltsCard(domain) {
    const alts = getAlts(domain);
    const wrap = document.createElement('div');
    wrap.className = 'gl-alts';
    wrap.innerHTML = `<div class="gl-alts-title">✨ Try these instead!</div>` +
      alts.map(a=>`<a class="gl-alt-item" href="${a.url}" target="_blank" rel="noopener noreferrer"><div><div class="gl-alt-name">${a.name}</div><div class="gl-alt-desc">${a.desc}</div></div><span class="gl-alt-arrow">→</span></a>`).join('');
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setLock(locked) { inputEl.disabled=locked; sendBtn.disabled=locked; }

  function showContext(mode, category, domain) {
    contextEl.innerHTML = `<span class="gl-ctx-pill ${mode}">📂 ${category}</span><span class="gl-ctx-pill ${mode}">🔗 ${domain}</span>`;
    contextEl.classList.add('show');
  }

  function buildPrompt(ctx) {
    if (!ctx) return `You are GuardianLens, a warm and friendly AI safety buddy for kids aged 6–16 in Egypt. Keep responses to 2–3 sentences. Be upbeat, helpful, and friendly.`;
    const alts = getAlts(ctx.domain).map(a=>`${a.name} (${a.url})`).join(', ');
    return `You are GuardianLens, a warm and friendly AI safety buddy for kids aged 6–16 in Egypt.
Website: ${ctx.domain} | Risk: ${Math.round(ctx.risk*100)}/100 | Type: ${ctx.category}
What was found: ${ctx.summary}
Safer alternatives: ${alts}
Style: Be the kid's cool older friend. 2–3 sentences MAX. Never lecture. Ask what they think. Fun, warm tone. Never shame them.`;
  }

  function callGL(userMsg) {
    if (userMsg) chatHistory.push({ role:'user', content:userMsg });
    showTyping(); setLock(true);
    chrome.runtime.sendMessage(
      { type:'LENS_GROQ_REQUEST', systemPrompt:buildPrompt(currentContext), history:chatHistory },
      (response) => {
        removeTyping(); setLock(false);
        if (chrome.runtime.lastError || !response?.reply) { addMsg('bot','Oops, little hiccup! Try again in a sec 🌀'); return; }
        chatHistory.push({ role:'assistant', content:response.reply });
        addMsg('bot', response.reply, currentMode!=='safe'?currentMode+'-mode':'');
      }
    );
  }

  function sendMsg() {
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = ''; addMsg('user', text); callGL(text);
    if (/alternative|instead|other|suggest|different|safer/i.test(text) && currentContext)
      setTimeout(()=>addAltsCard(currentContext.domain), 900);
  }

  sendBtn.addEventListener('click', sendMsg);
  inputEl.addEventListener('keydown', e => { if (e.key==='Enter') sendMsg(); });
  chipsEl.querySelectorAll('.gl-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const q = chip.dataset.q; if (!q) return;
      addMsg('user',q); callGL(q); chipsEl.style.display='none'; playPop();
    });
  });

  document.getElementById('gl-dismiss-btn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type:'LENS_WARNING_DISMISSED', domain:currentContext?.domain, category:currentContext?.category, risk:currentContext?.risk, url:location.href });
    warningDismissed=true; dismissBar.classList.remove('show'); closePanel(); setMode('safe');
  });

  function triggerLens(ctx) {
    currentContext=ctx; chatHistory=[]; warningDismissed=false;
    messagesEl.innerHTML=''; dismissBar.classList.remove('show'); chipsEl.style.display='';

    if (ctx.risk >= RISK_ESCALATE_THRESHOLD) {
      setMode('escalate'); showContext('escalate',ctx.category,ctx.domain);
      chrome.runtime.sendMessage({ type:'LENS_ESCALATE', domain:ctx.domain, category:ctx.category, url:location.href });
      badge.classList.add('show'); openPanel();
      addMsg('bot',"Hey, I need to pause you here 💛 This page has content that's way too intense. I've let your parents know — you're not in trouble at all, I just care about you!",'escalate-mode');
      setTimeout(()=>addAltsCard(ctx.domain), 700);

    } else if (ctx.risk >= RISK_WARN_THRESHOLD) {
      setMode('warn'); showContext('warn',ctx.category,ctx.domain);
      badge.classList.add('show');
      setTimeout(()=>{ openPanel(); callGL(null); setTimeout(()=>{ dismissBar.classList.add('show'); addAltsCard(ctx.domain); },1400); },500);

    } else {
      setMode('safe'); showContext('safe',ctx.category||'Safe',ctx.domain);
      badge.classList.add('show');
      setTimeout(()=>badge.classList.remove('show'),4000);
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type==='LENS_TRIGGER') {
      triggerLens({ risk:(msg.risk||0)/100, category:msg.category||'General concern', summary:msg.reason||msg.summary||'Potentially inappropriate content detected.', domain:msg.domain||location.hostname });
    }
  });

})();