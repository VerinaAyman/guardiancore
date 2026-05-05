/**
 * warning-overlay.js — GuardianLens Warning Overlay
 * Injected by background.js via chrome.scripting.executeScript on warned pages.
 * Shows a slide-in amber popup — child can proceed or chat with GuardianLens.
 */

(function () {
  'use strict';

  if (document.getElementById('gl-warning-root')) return;

  // Inject Sora font if not present
  if (!document.querySelector('link[href*="Sora"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap';
    document.head.appendChild(link);
  }

  // ── Styles ──
  const style = document.createElement('style');
  style.id = 'gl-warning-styles';
  style.textContent = `
    #gl-warning-root * {
      box-sizing: border-box; margin: 0; padding: 0;
      font-family: 'Sora', sans-serif;
    }

    /* ── Backdrop (subtle dim) ── */
    #gl-warning-backdrop {
      position: fixed; inset: 0;
      background: rgba(0,0,0,.45);
      z-index: 2147483644;
      animation: glBackdropIn .3s ease both;
    }
    @keyframes glBackdropIn { from{opacity:0} to{opacity:1} }

    /* ── Panel ── */
    #gl-warning-panel {
      position: fixed;
      top: 50%; right: 24px;
      transform: translateY(-50%) translateX(120%);
      width: 460px;
      background: #0f1929;
      border: 1px solid rgba(245,158,11,.3);
      border-radius: 20px;
      display: flex; flex-direction: column; overflow: hidden;
      box-shadow: 0 24px 64px rgba(0,0,0,.7), 0 0 0 1px rgba(245,158,11,.08);
      z-index: 2147483645;
      max-height: 680px;
      transition: transform .45s cubic-bezier(.34,1.56,.64,1), opacity .3s ease;
      opacity: 0;
    }
    #gl-warning-panel.open {
      transform: translateY(-50%) translateX(0);
      opacity: 1;
    }

    /* Header */
    #gl-warn-header {
      padding: 20px;
      border-bottom: 1px solid #1e293b;
      display: flex; align-items: center; gap: 12px;
      flex-shrink: 0;
      background: rgba(245,158,11,.05);
    }
    #gl-warn-icon-wrap {
      position: relative; width: 44px; height: 44px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
    }
    .gl-warn-ring {
      position: absolute; inset: -4px; border-radius: 50%;
      border: 2px solid rgba(245,158,11,.4);
      animation: glWarnRing 2s ease-out infinite;
    }
    .gl-warn-ring:nth-child(2) { animation-delay: .7s; }
    @keyframes glWarnRing {
      0%   { transform:scale(.8); opacity:.8; }
      100% { transform:scale(1.5); opacity:0; }
    }
    #gl-warn-emoji {
      font-size: 1.6rem;
      filter: drop-shadow(0 0 8px rgba(245,158,11,.6));
      animation: glWarnBob 2s ease-in-out infinite;
    }
    @keyframes glWarnBob {
      0%,100% { transform:translateY(0); }
      50%      { transform:translateY(-3px); }
    }
    #gl-warn-title-wrap { flex: 1; min-width: 0; }
    #gl-warn-title { font-size: 1.1rem; font-weight: 700; color: #f59e0b; }
    #gl-warn-sub   { font-size: 0.792rem; color: #64748b; margin-top: 2px; }
    #gl-warn-close {
      background: none; border: none; color: #64748b;
      font-size: 1.1rem; cursor: pointer; padding: 4px 8px;
      border-radius: 8px; transition: color .15s, background .15s; flex-shrink: 0;
    }
    #gl-warn-close:hover { color: #e2e8f0; background: rgba(255,255,255,.06); }

    /* Info strip */
    #gl-warn-info {
      padding: 20px;
      border-bottom: 1px solid #1e293b;
      display: flex; flex-direction: column; gap: 6px;
      flex-shrink: 0;
    }
    .gl-info-pill {
      display: flex; align-items: center; gap: 8px;
      padding: 6px 10px;
      background: rgba(245,158,11,.06);
      border: 1px solid rgba(245,158,11,.15);
      border-radius: 8px;
      font-size: 0.858rem;
    }
    .gl-info-pill-label { color: #64748b; min-width: 58px; font-size: 0.77rem; }
    .gl-info-pill-value { color: #e2e8f0; font-weight: 500; word-break: break-all; }
    .gl-info-pill-value.mono { font-family: 'JetBrains Mono', monospace; font-size: 0.792rem; color: #f59e0b; }

    /* Action buttons */
    #gl-warn-actions {
      padding: 20px;
      display: flex; gap: 8px; flex-shrink: 0;
      border-bottom: 1px solid #1e293b;
    }
    #gl-proceed-btn {
      flex: 1; padding: 10px 12px;
      background: rgba(255,255,255,.04);
      border: 1px solid #1e293b; border-radius: 10px;
      color: #64748b; font-family: 'Sora', sans-serif;
      font-size: 0.902rem; font-weight: 600;
      cursor: not-allowed;
      display: flex; align-items: center; justify-content: center; gap: 8px;
      transition: all .2s;
    }
    #gl-proceed-btn.ready {
      cursor: pointer; color: #e2e8f0;
      border-color: rgba(255,255,255,.15);
      background: rgba(255,255,255,.06);
    }
    #gl-proceed-btn.ready:hover { background: rgba(255,255,255,.1); transform: translateY(-1px); }

    /* Countdown ring */
    .gl-ring-wrap { position:relative; width:22px; height:22px; flex-shrink:0; }
    .gl-ring-wrap svg { position:absolute; top:0; left:0; transform:rotate(-90deg); }
    .gl-ring-track { fill:none; stroke:rgba(255,255,255,.1); stroke-width:2.5; }
    .gl-ring-fill  { fill:none; stroke:#f59e0b; stroke-width:2.5; stroke-linecap:round; stroke-dasharray:57; stroke-dashoffset:0; transition:stroke-dashoffset 1s linear; }
    .gl-ring-num   { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:.6rem; font-weight:700; color:#f59e0b; }

    #gl-goback-btn {
      padding: 10px 14px;
      background: rgba(245,158,11,.12);
      border: 1px solid rgba(245,158,11,.3); border-radius: 10px;
      color: #f59e0b; font-family: 'Sora', sans-serif;
      font-size: 0.902rem; font-weight: 700;
      cursor: pointer; transition: background .2s, transform .15s; flex-shrink: 0;
    }
    #gl-goback-btn:hover { background: rgba(245,158,11,.2); transform: translateY(-1px); }

    /* Chat toggle tab */
    #gl-chat-toggle {
      padding: 8px 16px;
      display: flex; align-items: center; justify-content: space-between;
      cursor: pointer; flex-shrink: 0;
      transition: background .15s;
    }
    #gl-chat-toggle:hover { background: rgba(255,255,255,.03); }
    #gl-chat-toggle-label {
      font-size: 0.88rem; font-weight: 600; color: #94a3b8;
      display: flex; align-items: center; gap: 8px;
    }
    #gl-chat-toggle-label .gl-avatar-mini {
      width: 24px; height: 24px; border-radius: 50%;
      background: linear-gradient(135deg,#1d4ed8,#7c3aed);
      display: flex; align-items: center; justify-content: center;
      font-size: .8rem;
    }
    #gl-chat-arrow { font-size: .8rem; color: #475569; transition: transform .25s; }
    #gl-chat-arrow.open { transform: rotate(180deg); }
    #gl-chat-status { font-size: 0.748rem; color: #22c55e; display:flex;align-items:center;gap:4px; }
    .gl-online-dot { width:5px;height:5px;border-radius:50%;background:#22c55e;animation:glBlink2 2s infinite; }
    @keyframes glBlink2 { 0%,100%{opacity:1} 50%{opacity:.2} }

    /* Chat section (collapsible) */
    #gl-chat-section {
      display: flex; flex-direction: column;
      max-height: 0; overflow: hidden;
      transition: max-height .35s ease;
      flex-shrink: 0;
    }
    #gl-chat-section.open { max-height: 400px; }

    #gl-messages {
      flex: 1; overflow-y: auto; padding: 20px;
      display: flex; flex-direction: column; gap: 8px;
      scroll-behavior: smooth; min-height: 0;
      max-height: 260px;
    }
    #gl-messages::-webkit-scrollbar { width: 3px; }
    #gl-messages::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 2px; }

    .gl-msg {
      max-width: 92%; padding: .5rem .85rem; border-radius: .9rem;
      font-size: 0.902rem; line-height: 1.55;
      animation: glMsgIn .22s ease both;
    }
    @keyframes glMsgIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
    .gl-msg.bot  { background:#162032; border:1px solid #1e293b; color:#e2e8f0; border-bottom-left-radius:.2rem; align-self:flex-start; }
    .gl-msg.user { background:#1e3a5f; color:#e2e8f0; border-bottom-right-radius:.2rem; align-self:flex-end; }
    .gl-msg a    { color:#60a5fa; text-decoration:none; }
    .gl-msg a:hover { text-decoration:underline; }

    .gl-typing {
      display:flex; align-items:center; gap:4px;
      padding:.5rem .85rem; background:#162032; border:1px solid #1e293b;
      border-radius:.9rem; border-bottom-left-radius:.2rem;
      align-self:flex-start; width:fit-content;
    }
    .gl-typing span { width:5px;height:5px;border-radius:50%;background:#64748b;animation:glBounce .9s ease-in-out infinite; }
    .gl-typing span:nth-child(2){animation-delay:.15s} .gl-typing span:nth-child(3){animation-delay:.30s}
    @keyframes glBounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-5px)} }

    #gl-chips { display:flex;flex-wrap:wrap;gap:.35rem;padding:20px;flex-shrink:0; }
    .gl-chip {
      background:#1e293b; border:1px solid #1e293b; border-radius:2rem;
      padding:.28rem .7rem; font-size:0.792rem; color:#94a3b8;
      cursor:pointer; transition:all .15s; white-space:nowrap;
    }
    .gl-chip:hover { background:#2d3f57; border-color:#f59e0b; color:#f59e0b; }

    #gl-input-row {
      display:flex; gap:.4rem; padding:20px; flex-shrink:0;
      border-top:1px solid #1e293b;
    }
    #gl-chat-input {
      flex:1; background:#1e293b; border:1px solid #1e293b; border-radius:.55rem;
      color:#e2e8f0; font-family:'Sora',sans-serif; font-size:0.902rem;
      padding:.48rem .75rem; outline:none; transition:border-color .15s;
    }
    #gl-chat-input:focus { border-color:#f59e0b; }
    #gl-chat-input::placeholder { color:#475569; }
    #gl-chat-send {
      background:#f59e0b; border:none; border-radius:.55rem;
      padding:.48rem .75rem; color:#000; font-size:0.99rem;
      font-weight:700; cursor:pointer; transition:opacity .15s; flex-shrink:0;
    }
    #gl-chat-send:hover { opacity:.85; }
  `;
  document.head.appendChild(style);

  // ── Build DOM ──
  const root = document.createElement('div');
  root.id = 'gl-warning-root';

  const backdrop = document.createElement('div');
  backdrop.id = 'gl-warning-backdrop';
  root.appendChild(backdrop);

  const panel = document.createElement('div');
  panel.id = 'gl-warning-panel';
  root.appendChild(panel);

  document.body.appendChild(root);

  // Get params passed via dataset (background.js sets them on the script element)
  // Fallback: read from a gl_warning_data global set before injection
  const data = (typeof gl_warning_data !== 'undefined') ? gl_warning_data : {};
  const rawUrl   = data.url      || location.href;
  const category = data.category || 'Caution';
  const reason   = data.reason   || 'This page may need caution.';

  let siteDomain = rawUrl;
  try { siteDomain = new URL(rawUrl).hostname.replace('www.', ''); } catch (e) {}

  panel.innerHTML = `
    <div id="gl-warn-header">
      <div id="gl-warn-icon-wrap">
        <div class="gl-warn-ring"></div>
        <div class="gl-warn-ring"></div>
        <div id="gl-warn-emoji">⚠️</div>
      </div>
      <div id="gl-warn-title-wrap">
        <div id="gl-warn-title">Heads Up!</div>
        <div id="gl-warn-sub">GuardianLens noticed something</div>
      </div>
      <button id="gl-warn-close" aria-label="Close warning">✕</button>
    </div>

    <div id="gl-warn-info">
      <div class="gl-info-pill">
        <span class="gl-info-pill-label">📂 Category</span>
        <span class="gl-info-pill-value" id="gl-info-category">—</span>
      </div>
      <div class="gl-info-pill">
        <span class="gl-info-pill-label">⚠️ Reason</span>
        <span class="gl-info-pill-value" id="gl-info-reason">—</span>
      </div>
      <div class="gl-info-pill">
        <span class="gl-info-pill-label">🔗 URL</span>
        <span class="gl-info-pill-value mono" id="gl-info-url">—</span>
      </div>
    </div>

    <div id="gl-warn-actions">
      <button id="gl-proceed-btn" disabled type="button">
        <div class="gl-ring-wrap">
          <svg viewBox="0 0 20 20">
            <circle class="gl-ring-track" cx="10" cy="10" r="9"/>
            <circle class="gl-ring-fill" id="gl-ring-fill" cx="10" cy="10" r="9"/>
          </svg>
          <div class="gl-ring-num" id="gl-count-num">3</div>
        </div>
        Continue anyway
      </button>
      <button id="gl-goback-btn" type="button">← Go back</button>
    </div>

    <div id="gl-chat-toggle">
      <div id="gl-chat-toggle-label">
        <div class="gl-avatar-mini">🛡️</div>
        <div>
          <div>Talk to GuardianLens</div>
          <div id="gl-chat-status"><span class="gl-online-dot"></span>&nbsp;Online · Here to help</div>
        </div>
      </div>
      <span id="gl-chat-arrow">▼</span>
    </div>

    <div id="gl-chat-section">
      <div id="gl-messages"></div>
      <div id="gl-chips">
        <div class="gl-chip" data-q="Is this site safe for me?">Is it safe?</div>
        <div class="gl-chip" data-q="Show me safer alternatives">Safer alternatives</div>
        <div class="gl-chip" data-q="Why did you warn me about this?">Why this warning?</div>
      </div>
      <div id="gl-input-row">
        <input id="gl-chat-input" type="text" placeholder="Ask GuardianLens…" autocomplete="off" />
        <button id="gl-chat-send" type="button">➤</button>
      </div>
    </div>
  `;

  // Fill info
  document.getElementById('gl-info-category').textContent = category;
  document.getElementById('gl-info-reason').textContent   = reason;
  document.getElementById('gl-info-url').textContent      = siteDomain;

  // Open panel with animation
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { panel.classList.add('open'); });
  });

  // ── Audio ──
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  function playChime() {
    try {
      const ctx = new AudioCtx();
      [523, 622, 523].forEach((freq, i) => {
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.connect(g); g.connect(ctx.destination);
        osc.type = 'sine'; osc.frequency.value = freq;
        g.gain.setValueAtTime(0, ctx.currentTime + i * .2);
        g.gain.linearRampToValueAtTime(0.12, ctx.currentTime + i * .2 + .05);
        g.gain.linearRampToValueAtTime(0, ctx.currentTime + i * .2 + .32);
        osc.start(ctx.currentTime + i * .2);
        osc.stop(ctx.currentTime + i * .2 + .35);
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

  playChime();

  // ── Countdown ──
  const proceedBtn = document.getElementById('gl-proceed-btn');
  const ringFill   = document.getElementById('gl-ring-fill');
  const countNum   = document.getElementById('gl-count-num');
  const circumference = 57;
  let remaining = 3;

  const tick = setInterval(() => {
    remaining -= 1;
    if (countNum) countNum.textContent = remaining;
    if (ringFill) ringFill.style.strokeDashoffset = circumference * (1 - remaining / 3);
    if (remaining <= 0) {
      clearInterval(tick);
      proceedBtn.disabled = false;
      proceedBtn.classList.add('ready');
      if (countNum) countNum.textContent = '✓';
      if (ringFill) { ringFill.style.stroke = '#22c55e'; }
    }
  }, 1000);

  // ── Proceed / Go back ──
  proceedBtn.addEventListener('click', () => {
    if (!proceedBtn.disabled) dismissOverlay();
  });

  document.getElementById('gl-goback-btn').addEventListener('click', () => {
    if (window.history.length > 1) window.history.back();
    else window.location.href = 'https://www.google.com';
  });

  // ── Close ──
  function dismissOverlay() {
    panel.style.transform = 'translateY(-50%) translateX(120%)';
    panel.style.opacity = '0';
    backdrop.style.opacity = '0';
    setTimeout(() => { root.remove(); }, 400);
  }

  document.getElementById('gl-warn-close').addEventListener('click', dismissOverlay);
  backdrop.addEventListener('click', dismissOverlay);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') dismissOverlay(); });

  // ── Chat toggle ──
  const chatToggle  = document.getElementById('gl-chat-toggle');
  const chatSection = document.getElementById('gl-chat-section');
  const chatArrow   = document.getElementById('gl-chat-arrow');
  let chatOpen = false;
  let chatSeeded = false;

  chatToggle.addEventListener('click', () => {
    chatOpen = !chatOpen;
    chatSection.classList.toggle('open', chatOpen);
    chatArrow.classList.toggle('open', chatOpen);
    if (chatOpen && !chatSeeded) { chatSeeded = true; seedGreeting(); }
  });

  // ── Chat logic ──
  const messagesEl = document.getElementById('gl-messages');
  const chipsEl    = document.getElementById('gl-chips');
  const chatInput  = document.getElementById('gl-chat-input');
  const chatSend   = document.getElementById('gl-chat-send');
  const chatHistory = [];

  const SYSTEM_PROMPT = `You are GuardianLens, a warm and friendly AI assistant in a family safety browser extension for kids. The child's browser has shown a WARNING about this website:
- Full URL: ${rawUrl}
- Domain: ${siteDomain}
- Category: ${category}
- Reason: ${reason}

The page is NOT blocked — the child can still choose to visit it. Your job:
1. In 1-2 friendly sentences, explain why this site triggered a warning. Be honest but not scary.
2. Suggest 3 safer alternatives that do the same thing as ${siteDomain}.
3. Format links as [Name](url) with an emoji and short description.
4. If they ask whether to proceed, say their parent can see this activity and let them decide themselves.

Keep it friendly and short. Never be preachy.`;

  function addMsg(role, text) {
    const div = document.createElement('div');
    div.className = 'gl-msg ' + role;
    div.innerHTML = text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    if (role === 'bot') playPop();
  }

  function showTyping() {
    const d = document.createElement('div');
    d.className = 'gl-typing'; d.id = 'gl-warn-typing';
    d.innerHTML = '<span></span><span></span><span></span>';
    messagesEl.appendChild(d);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  function removeTyping() { document.getElementById('gl-warn-typing')?.remove(); }

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
      setTimeout(() => {
        removeTyping();
        addMsg('bot', `⚠️ **${siteDomain}** triggered a warning for: *${category}*. You can still choose to continue or go back.`);
      }, 1000);
    }
  }

  function seedGreeting() {
    callGL(`I just opened the GuardianLens warning panel. The site ${siteDomain} triggered a warning for: ${category} — ${reason}. Briefly explain why and suggest safer alternatives.`);
  }

  function sendMsg() {
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';
    addMsg('user', text);
    callGL(text);
  }

  chatSend.addEventListener('click', sendMsg);
  chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMsg(); });

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