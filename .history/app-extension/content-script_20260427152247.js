// GuardianLens Content Script — Intelligent Content Classification + Unified UI
// ✨ Unified design system: Nunito font · GL color tokens · spring animations · Web Audio sounds

(function () {
  'use strict';

  if (window.__guardianlens_content_script_loaded) return;
  window.__guardianlens_content_script_loaded = true;

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

  // ─── Sound engine ─────────────────────────────────────────────────────────
  let _audioCtx = null;
  let _userHasInteracted = false;
  document.addEventListener('click',     () => { _userHasInteracted = true; }, { once: true, capture: true });
  document.addEventListener('keydown',   () => { _userHasInteracted = true; }, { once: true, capture: true });
  document.addEventListener('touchstart',() => { _userHasInteracted = true; }, { once: true, capture: true });

  function getAudioCtx() {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return _audioCtx;
  }

  function playTone(notes, type = 'sine') {
    if (!_userHasInteracted) return;
    try {
      const ctx  = getAudioCtx();
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
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
        g.connect(gain);
        osc.start(t);
        osc.stop(t + dur);
        t += dur * 0.8;
      });
    } catch (_) {}
  }

  function soundSafe()  { playTone([[523,0.18],[659,0.18],[784,0.28]], 'sine'); }
  function soundWarn()  { playTone([[440,0.22],[392,0.22],[349,0.32]], 'triangle'); }
  function soundBlock() { playTone([[220,0.25],[196,0.25],[165,0.35]], 'sawtooth'); }

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
      @keyframes gl-float {
        0%,100% { transform: translateY(0px) rotate(-1deg); }
        50%     { transform: translateY(-7px) rotate(1deg); }
      }
      @keyframes gl-pulse-ring {
        0%   { transform: scale(1);   opacity:0.7; }
        100% { transform: scale(2.2); opacity:0; }
      }
      @keyframes gl-sparkle {
        0%   { transform: scale(0) rotate(0deg);   opacity:1; }
        60%  { transform: scale(1) rotate(180deg); opacity:1; }
        100% { transform: scale(0) rotate(360deg); opacity:0; }
      }
      @keyframes gl-shake {
        0%,100%  { transform: translateX(0); }
        20%,60%  { transform: translateX(-6px); }
        40%,80%  { transform: translateX(6px); }
      }
      @keyframes gl-bounce-dot {
        0%,80%,100% { transform: scale(0); }
        40%         { transform: scale(1); }
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
      @keyframes gl-owl-bob {
        0%,100% { transform: translateY(0) rotate(-2deg); }
        50%     { transform: translateY(-6px) rotate(2deg); }
      }

      /* ─── Warning Bubble ─── */
      #gl-bubble {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 2147483647;
        font-family: var(--gl-font);
        max-width: 340px;
        width: 340px;
        border-radius: var(--gl-radius);
        background: var(--gl-surface);
        border: 1.5px solid rgba(255,255,255,0.10);
        box-shadow: var(--gl-shadow);
        color: var(--gl-text);
        overflow: hidden;
        animation: gl-spring-in 0.55s cubic-bezier(0.34,1.56,0.64,1) both;
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
      }
      #gl-bubble.gl-exit {
        animation: gl-spring-out 0.35s cubic-bezier(0.36,0,0.66,-0.56) both;
      }

      .gl-bar { height: 5px; width: 100%; border-radius: 4px 4px 0 0; }
      .gl-bar-warn  { background: linear-gradient(90deg, var(--gl-warn), #fbbf24, var(--gl-warn)); animation: gl-progress-fill 0.6s ease both; }
      .gl-bar-safe  { background: linear-gradient(90deg, var(--gl-safe), #4ade80); animation: gl-progress-fill 0.6s ease both; }
      .gl-bar-block { background: linear-gradient(90deg, var(--gl-block), #f97316); animation: gl-progress-fill 0.6s ease both; }

      .gl-inner {
        padding: 16px 18px 14px;
        display: flex; gap: 14px; align-items: flex-start;
      }

      /* Owl mascot for bubble */
      .gl-owl-wrap {
        position: relative; flex-shrink: 0;
        width: 56px; height: 56px;
        display: flex; align-items: center; justify-content: center;
      }
      .gl-owl-ring {
        position: absolute; inset: 0;
        border-radius: 50%; opacity: 0;
      }
      .gl-owl-ring.active { animation: gl-pulse-ring 1.4s cubic-bezier(0,0,0.2,1) infinite; }
      .gl-owl-ring-warn  { border: 2px solid var(--gl-warn); }
      .gl-owl-ring-safe  { border: 2px solid var(--gl-safe); }
      .gl-owl-ring-block { border: 2px solid var(--gl-block); }
      .gl-owl-emoji {
        font-size: 34px;
        animation: gl-owl-bob 3s ease-in-out infinite;
        user-select: none;
        filter: drop-shadow(0 2px 8px rgba(0,0,0,0.4));
        line-height: 1;
      }

      .gl-sparkle {
        position: absolute; font-size: 12px;
        animation: gl-sparkle 0.8s ease forwards;
        pointer-events: none;
      }

      .gl-content { flex: 1; min-width: 0; }
      .gl-label {
        font-size: 11px; font-weight: 800;
        text-transform: uppercase; letter-spacing: 0.08em;
        margin-bottom: 4px;
        display: flex; align-items: center; gap: 6px;
      }
      .gl-label-warn  { color: var(--gl-warn); }
      .gl-label-safe  { color: var(--gl-safe); }
      .gl-label-block { color: var(--gl-block); }

      .gl-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
      .gl-dot-warn  { background: var(--gl-warn); animation: gl-bounce-dot 1.4s ease-in-out 0.2s infinite both; }
      .gl-dot-safe  { background: var(--gl-safe); }
      .gl-dot-block { background: var(--gl-block); animation: gl-shake 0.5s ease 0.3s both; }

      .gl-title {
        font-size: 15px; font-weight: 900; line-height: 1.25;
        margin-bottom: 5px; color: var(--gl-text);
      }
      .gl-body {
        font-size: 13px; font-weight: 500; line-height: 1.55; color: var(--gl-muted);
      }

      .gl-footer {
        padding: 0 18px 14px;
        display: flex; gap: 8px; justify-content: flex-end;
      }
      .gl-btn {
        font-family: var(--gl-font);
        font-size: 12.5px; font-weight: 800;
        padding: 7px 16px; border-radius: 50px;
        border: none; cursor: pointer;
        transition: transform 0.15s, opacity 0.15s;
        letter-spacing: 0.02em;
        position: relative; z-index: 2147483647;
        pointer-events: auto;
      }
      .gl-btn:hover  { transform: scale(1.05); opacity: 0.92; }
      .gl-btn:active { transform: scale(0.97); }
      .gl-btn-dismiss {
        background: rgba(255,255,255,0.08);
        color: var(--gl-muted);
      }
      .gl-btn-chat {
        background: var(--gl-accent);
        color: #fff;
        box-shadow: 0 2px 12px rgba(99,102,241,0.4);
      }

      /* ─── Safe chip ─── */
      #gl-safe-chip {
        position: fixed;
        bottom: 20px; right: 20px;
        z-index: 2147483646;
        font-family: var(--gl-font);
        background: rgba(34,197,94,0.18);
        border: 1.5px solid var(--gl-safe);
        color: var(--gl-safe);
        font-size: 12px; font-weight: 800;
        padding: 6px 14px; border-radius: 50px;
        display: flex; align-items: center; gap: 6px;
        pointer-events: none;
        animation: gl-spring-in 0.45s cubic-bezier(0.34,1.56,0.64,1) both;
        backdrop-filter: blur(8px);
      }
      #gl-safe-chip.gl-exit { animation: gl-spring-out 0.3s ease both; }

      /* ─── Chat Overlay ─── */
      #gl-chat-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        background: rgba(0,0,0,0.7);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
        font-family: var(--gl-font);
      }
      #gl-chat-overlay.gl-exit {
        animation: gl-overlay-out 0.25s ease both;
      }

      .gl-chat-panel {
        width: 100%;
        max-width: 380px;
        border-radius: 24px;
        overflow: hidden;
        box-shadow: 0 24px 80px rgba(0,0,0,0.8);
        animation: gl-overlay-in 0.4s cubic-bezier(0.34,1.56,0.64,1) both;
        display: flex;
        flex-direction: column;
        max-height: 90vh;
      }

      /* Chat topbar */
      .gl-chat-topbar {
        background: linear-gradient(135deg, #4338ca, var(--gl-accent));
        padding: 14px 18px;
        display: flex;
        align-items: center;
        gap: 12px;
        flex-shrink: 0;
      }
      .gl-chat-av-wrap {
        position: relative;
        width: 42px; height: 42px;
        display: flex; align-items: center; justify-content: center;
        background: rgba(255,255,255,0.15);
        border-radius: 50%;
        flex-shrink: 0;
      }
      .gl-chat-owl {
        font-size: 22px;
        animation: gl-owl-bob 3s ease-in-out infinite;
        line-height: 1;
      }
      .gl-chat-av-dot {
        position: absolute;
        bottom: 1px; right: 1px;
        width: 10px; height: 10px;
        border-radius: 50%;
        background: #4ade80;
        border: 2px solid #4338ca;
        box-shadow: 0 0 6px #4ade80;
      }
      .gl-chat-meta { flex: 1; }
      .gl-chat-name { font-size: 14px; font-weight: 900; color: #fff; }
      .gl-chat-sub  { font-size: 10px; color: rgba(255,255,255,0.65); margin-top: 1px; }
      .gl-chat-close {
        width: 30px; height: 30px;
        border-radius: 50%;
        background: rgba(255,255,255,0.15);
        border: none; cursor: pointer;
        color: #fff; font-size: 16px;
        display: flex; align-items: center; justify-content: center;
        transition: background 0.15s, transform 0.1s;
        flex-shrink: 0;
      }
      .gl-chat-close:hover  { background: rgba(255,255,255,0.25); transform: scale(1.1); }
      .gl-chat-close:active { transform: scale(0.95); }

      /* Chat context pill */
      .gl-chat-context {
        background: rgba(239,68,68,0.12);
        border-bottom: 1px solid rgba(239,68,68,0.15);
        padding: 8px 16px;
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }
      .gl-chat-context-icon { font-size: 14px; }
      .gl-chat-context-text {
        font-size: 11.5px;
        font-weight: 700;
        color: #fca5a5;
        font-family: var(--gl-font);
      }

      /* Chat messages */
      #gl-chat-messages {
        flex: 1;
        overflow-y: auto;
        padding: 14px 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        background: #0f172a;
        min-height: 200px;
        max-height: 300px;
      }
      #gl-chat-messages::-webkit-scrollbar { width: 4px; }
      #gl-chat-messages::-webkit-scrollbar-thumb { background: rgba(99,102,241,0.25); border-radius: 4px; }

      .gl-msg-row { display: flex; gap: 8px; align-items: flex-end; }
      .gl-msg-row.bot  { flex-direction: row; }
      .gl-msg-row.user { flex-direction: row-reverse; }
      .gl-msg-av {
        width: 28px; height: 28px; border-radius: 50%;
        background: rgba(99,102,241,0.15);
        border: 1px solid rgba(99,102,241,0.2);
        display: flex; align-items: center; justify-content: center;
        font-size: 15px; flex-shrink: 0;
      }
      .gl-msg-bub {
        max-width: 82%; padding: 10px 14px;
        font-size: 13.5px; line-height: 1.55;
        border-radius: 18px; word-break: break-word;
        font-family: var(--gl-font); font-weight: 600;
      }
      .gl-msg-row.bot .gl-msg-bub {
        background: #1e293b;
        color: var(--gl-text);
        border-bottom-left-radius: 4px;
        border: 1px solid rgba(255,255,255,0.06);
      }
      .gl-msg-row.user .gl-msg-bub {
        background: var(--gl-accent);
        color: #fff;
        border-bottom-right-radius: 4px;
      }

      /* typing indicator */
      .gl-typing {
        display: flex; gap: 4px; align-items: center;
        background: #1e293b;
        border: 1px solid rgba(255,255,255,0.06);
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

      /* Chat input bar */
      .gl-chat-inputbar {
        background: #1e293b;
        border-top: 1px solid rgba(255,255,255,0.06);
        padding: 10px 12px;
        display: flex; gap: 8px; align-items: center;
        flex-shrink: 0;
      }
      .gl-chat-input {
        flex: 1;
        background: #263347;
        border: 1.5px solid rgba(255,255,255,0.08);
        border-radius: 20px;
        padding: 9px 16px;
        font-size: 13.5px;
        font-family: var(--gl-font);
        font-weight: 600;
        color: var(--gl-text);
        outline: none;
        transition: border 0.15s;
      }
      .gl-chat-input::placeholder { color: var(--gl-muted); }
      .gl-chat-input:focus { border-color: var(--gl-accent); }
      .gl-chat-input:disabled { opacity: 0.4; }
      .gl-send-btn {
        width: 38px; height: 38px; border-radius: 50%;
        background: var(--gl-accent); border: none;
        cursor: pointer; display: flex; align-items: center; justify-content: center;
        font-size: 15px; color: #fff; flex-shrink: 0;
        transition: background 0.15s, transform 0.1s;
        box-shadow: 0 2px 12px rgba(99,102,241,0.4);
      }
      .gl-send-btn:hover  { background: #4f46e5; transform: scale(1.05); }
      .gl-send-btn:active { transform: scale(0.95); }
      .gl-send-btn:disabled { opacity: 0.35; pointer-events: none; }

      /* Quick action chips */
      .gl-quick-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding: 8px 12px 0;
        background: #0f172a;
      }
      .gl-chip {
        font-family: var(--gl-font);
        font-size: 11.5px;
        font-weight: 700;
        padding: 5px 12px;
        border-radius: 20px;
        background: rgba(99,102,241,0.12);
        border: 1px solid rgba(99,102,241,0.25);
        color: #a5b4fc;
        cursor: pointer;
        transition: background 0.15s, transform 0.1s;
      }
      .gl-chip:hover  { background: rgba(99,102,241,0.22); transform: scale(1.04); }
      .gl-chip:active { transform: scale(0.97); }
    `;
    document.head.appendChild(style);
  }

  // ─── Sparkle burst ────────────────────────────────────────────────────────
  function burstSparkles(container, count = 6) {
    const emojis = ['✨','⭐','💫','🌟','✦','❋'];
    for (let i = 0; i < count; i++) {
      const s = document.createElement('span');
      s.className = 'gl-sparkle';
      s.textContent = emojis[i % emojis.length];
      const angle = (i / count) * 360;
      const r = 28 + Math.random() * 14;
      s.style.left  = (26 + Math.cos(angle * Math.PI / 180) * r) + 'px';
      s.style.top   = (26 + Math.sin(angle * Math.PI / 180) * r) + 'px';
      s.style.animationDelay = (i * 0.07) + 's';
      container.appendChild(s);
      setTimeout(() => s.remove(), 900);
    }
  }

  // ─── Remove bubble ────────────────────────────────────────────────────────
  function removeBubble(id = 'gl-bubble') {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('gl-exit');
    setTimeout(() => el.remove(), 380);
  }

  // ─── Safe chip ────────────────────────────────────────────────────────────
  function showSafeChip() {
    removeBubble('gl-safe-chip');
    injectFont(); injectStyles();
    soundSafe();
    const chip = document.createElement('div');
    chip.id = 'gl-safe-chip';
    chip.innerHTML = `<span style="font-size:18px">🦉</span> GuardianLens: All Clear`;
    document.body.appendChild(chip);
    setTimeout(() => {
      chip.classList.add('gl-exit');
      setTimeout(() => chip.remove(), 380);
    }, 3200);
  }

  // ─── In-page Chat Overlay ─────────────────────────────────────────────────
  function openChatOverlay({ category = '', domain = '', reason = '' }) {
    // Remove any existing overlay
    const existing = document.getElementById('gl-chat-overlay');
    if (existing) existing.remove();

    injectFont(); injectStyles();

    const overlay = document.createElement('div');
    overlay.id = 'gl-chat-overlay';

    overlay.innerHTML = `
      <div class="gl-chat-panel">
        <div class="gl-chat-topbar">
          <div class="gl-chat-av-wrap">
            <span class="gl-chat-owl">🦉</span>
            <div class="gl-chat-av-dot"></div>
          </div>
          <div class="gl-chat-meta">
            <div class="gl-chat-name">Lens 🦉 — your web buddy</div>
            <div class="gl-chat-sub">here to explain & help you out!</div>
          </div>
          <button class="gl-chat-close" id="gl-chat-close-btn">✕</button>
        </div>
        ${domain || category ? `
        <div class="gl-chat-context">
          <span class="gl-chat-context-icon">⚠️</span>
          <span class="gl-chat-context-text">
            ${category ? `"${escHtml(category)}" detected` : ''}${domain ? ` on ${escHtml(domain)}` : ''}
          </span>
        </div>` : ''}
        <div class="gl-quick-chips" id="gl-quick-chips">
          <button class="gl-chip">Why was this flagged? 🤔</button>
          <button class="gl-chip">Is this dangerous? 🛡️</button>
          <button class="gl-chip">What should I do? 💡</button>
        </div>
        <div id="gl-chat-messages"></div>
        <div class="gl-chat-inputbar">
          <input class="gl-chat-input" id="gl-chat-input" type="text" placeholder="Ask Lens anything… 🦉" autocomplete="off" />
          <button class="gl-send-btn" id="gl-send-btn">➤</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const messagesEl = document.getElementById('gl-chat-messages');
    const inputEl    = document.getElementById('gl-chat-input');
    const sendBtn    = document.getElementById('gl-send-btn');
    const closeBtn   = document.getElementById('gl-chat-close-btn');
    const chipsEl    = document.getElementById('gl-quick-chips');

    // Close handlers
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeOverlay();
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeOverlay();
    });

    function closeOverlay() {
      overlay.classList.add('gl-exit');
      setTimeout(() => overlay.remove(), 280);
    }

    // Messaging helpers
    function addMsg(text, who = 'bot') {
      const row = document.createElement('div');
      row.className = `gl-msg-row ${who}`;
      const av = document.createElement('div');
      av.className = 'gl-msg-av';
      av.textContent = who === 'bot' ? '🦉' : '🧒';
      const bub = document.createElement('div');
      bub.className = 'gl-msg-bub';
      bub.textContent = text;
      row.appendChild(av);
      row.appendChild(bub);
      messagesEl.appendChild(row);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function showTyping() {
      const row = document.createElement('div');
      row.className = 'gl-msg-row bot'; row.id = 'gl-typing-row';
      const av = document.createElement('div');
      av.className = 'gl-msg-av'; av.textContent = '🦉';
      const t = document.createElement('div');
      t.className = 'gl-typing';
      t.innerHTML = '<span></span><span></span><span></span>';
      row.appendChild(av); row.appendChild(t);
      messagesEl.appendChild(row);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function removeTyping() {
      document.getElementById('gl-typing-row')?.remove();
    }

    // Opening message
    const openingMsg = reason
      ? `Hey! 🦉 I noticed something on ${domain || 'this page'}: ${reason}. I'm here to help — what would you like to know?`
      : `Hey there! 🦉 I flagged this page because of "${category || 'some content'}" on ${domain || 'this site'}. Got questions? I'm all ears! 🌟`;

    setTimeout(() => addMsg(openingMsg), 200);

    // Quick chip clicks
    chipsEl.querySelectorAll('.gl-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const q = chip.textContent.replace(/[\u{1F000}-\u{1FFFF}]/gu, '').trim();
        chipsEl.remove();
        addMsg(chip.textContent, 'user');
        handleSend(q);
      });
    });

    // Send handler
    async function handleSend(overrideText) {
      const text = overrideText || inputEl.value.trim();
      if (!text) return;
      if (!overrideText) {
        addMsg(text, 'user');
        inputEl.value = '';
      }
      inputEl.disabled = true;
      sendBtn.disabled = true;
      showTyping();

      try {
        const reply = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('timeout')), 15000);
          try {
            chrome.runtime.sendMessage({
              type: 'LENS_GROQ_REQUEST',
              systemPrompt: `You are Lens 🦉, GuardianLens's friendly owl mascot and web buddy for children.
A page was flagged${category ? ` for "${category}"` : ''}${domain ? ` on ${domain}` : ''}.
${reason ? 'Reason: ' + reason + '.' : ''}
Be warm, kind, and age-appropriate. Keep answers to 2-3 sentences max. Use 1 emoji. Never use scary language. Encourage talking to a trusted adult if needed.`,
              history: [{ role: 'user', content: text }]
            }, (res) => {
              clearTimeout(timeout);
              if (chrome.runtime.lastError) { reject(chrome.runtime.lastError); return; }
              resolve(res?.reply || "I'm having a little hiccup! Try again in a moment 🌀");
            });
          } catch (err) {
            clearTimeout(timeout);
            reject(err);
          }
        });
        removeTyping();
        addMsg(reply);
      } catch {
        removeTyping();
        addMsg("I'm having trouble connecting right now. You can always ask a trusted adult for help! 💙");
      } finally {
        inputEl.disabled = false;
        sendBtn.disabled = false;
        inputEl.focus();
      }
    }

    sendBtn.addEventListener('click', (e) => { e.stopPropagation(); handleSend(); });
    inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSend(); });

    // Focus input after animation
    setTimeout(() => inputEl.focus(), 420);
  }

  // ─── Warn / info bubble ───────────────────────────────────────────────────
  function showLensBubble({ risk = 50, category = '', reason = '', domain = '' }) {
    removeBubble();
    injectFont(); injectStyles();
    soundWarn();

    const isHighRisk = risk >= 65;
    const tier  = isHighRisk ? 'block' : 'warn';
    const owlEmoji = isHighRisk ? '🦉' : '🦉';
    const label = isHighRisk ? 'Heads Up!' : 'Just So You Know';
    const title = category || (isHighRisk ? 'This looks risky' : 'Worth a quick chat');
    const body  = reason  || (isHighRisk
      ? `I spotted something on this page that might not be great for you. Wanna talk about it? I'm here! 💙`
      : `There's some content here that might be good to chat about. You're doing great by being careful! 🌟`);

    const bubble = document.createElement('div');
    bubble.id = 'gl-bubble';
    bubble.innerHTML = `
      <div class="gl-bar gl-bar-${tier}"></div>
      <div class="gl-inner">
        <div class="gl-owl-wrap" id="gl-owl-wrap">
          <div class="gl-owl-ring gl-owl-ring-${tier} active"></div>
          <span class="gl-owl-emoji">${owlEmoji}</span>
        </div>
        <div class="gl-content">
          <div class="gl-label gl-label-${tier}">
            <span class="gl-dot gl-dot-${tier}"></span>
            GuardianLens · ${label}
          </div>
          <div class="gl-title">${escHtml(title)}</div>
          <div class="gl-body">${escHtml(body)}</div>
          ${domain ? `<div style="margin-top:6px;font-size:11px;color:var(--gl-muted);font-weight:600;font-family:var(--gl-font)">🌐 ${escHtml(domain)}</div>` : ''}
        </div>
      </div>
      <div class="gl-footer">
        <button class="gl-btn gl-btn-dismiss" id="gl-btn-dismiss">Got it</button>
        <button class="gl-btn gl-btn-chat" id="gl-btn-chat">🦉 Let's Chat</button>
      </div>
    `;

    document.body.appendChild(bubble);

    if (isHighRisk) {
      setTimeout(() => burstSparkles(document.getElementById('gl-owl-wrap')), 300);
    }

    const dismissBtn = document.getElementById('gl-btn-dismiss');
    const chatBtn    = document.getElementById('gl-btn-chat');

    if (dismissBtn) {
      dismissBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeBubble();
        try {
          chrome.runtime.sendMessage({
            type: 'LENS_WARNING_DISMISSED',
            domain, risk, category, url: window.location.href
          }, () => { void chrome.runtime.lastError; });
        } catch (_) {}
      });
    }

    if (chatBtn) {
      chatBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeBubble();
        // ✅ FIXED: actually open the chat overlay instead of just dismissing
        openChatOverlay({ category, domain, reason });
        try {
          chrome.runtime.sendMessage({
            type: 'LENS_OPEN_CHAT',
            domain, category
          }, () => { void chrome.runtime.lastError; });
        } catch (_) {}
      });
    }
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
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
  function isExtensionAlive() {
    try { return !!chrome.runtime?.id; } catch { return false; }
  }
  function hidePage()  { document.documentElement.style.visibility = 'hidden'; }
  function showPage()  { document.documentElement.style.visibility = ''; }

  function silentBlock(category, reason, url) {
    soundBlock();
    showPage();
    setTimeout(() => {
      window.location.replace(
        chrome.runtime.getURL('blocked.html') +
        '?category=' + encodeURIComponent(category || 'Restricted content') +
        '&reason='   + encodeURIComponent(reason || '') +
        '&url='      + encodeURIComponent(url || window.location.href)
      );
    }, 180);
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
          const text = node.textContent.trim();
          if (text.length < 3) return NodeFilter.FILTER_REJECT;
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
      document.querySelectorAll('a[href]').forEach(a => {
        const t = (a.innerText || '').trim();
        if (t.length > 3 && t.length < 100) chunks.push(t);
      });

      return chunks.join(' ').replace(/\s+/g, ' ').trim().slice(0, 15000);
    } catch (e) {
      console.warn('[GuardianLens] Text extraction error:', e);
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
      showLensBubble({
        risk:     response.confidence ? response.confidence * 100 : 50,
        category: response.category   || 'Content alert',
        reason:   response.child_message || '',
        domain:   window.location.hostname,
      });
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

    chrome.runtime.sendMessage(
      { type: 'ANALYZE_PAGE', url: window.location.href, text: pageText },
      (response) => {
        if (chrome.runtime.lastError) { if (wasHidden) showPage(); return; }
        handleAnalysisResponse(response, wasHidden);
      }
    );
  }

  // ─── LENS_TRIGGER from background ─────────────────────────────────────────
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'LENS_TRIGGER') {
      showLensBubble({
        risk:     message.risk     || 50,
        category: message.category || '',
        reason:   message.reason   || message.summary || '',
        domain:   message.domain   || window.location.hostname,
      });
    }
  });

  // ─── Entry point ──────────────────────────────────────────────────────────
  function init() {
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

    if (risky) {
      setTimeout(() => {
        console.log('[GuardianLens] Second-pass analysis...');
        requestAnalysis(false);
      }, 5000);
    }
  }

  init();

  // ─── SPA navigation ───────────────────────────────────────────────────────
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (isInstantBlock()) {
        silentBlock('Adult content', 'This site is not allowed.', window.location.href);
        return;
      }
      const risky = isRiskyDomain();
      if (risky) hidePage();
      setTimeout(() => requestAnalysis(risky), risky ? 2500 : 1000);
    }
  }).observe(document.body, { childList: true, subtree: true });

  // ─── Dynamic content watchers ─────────────────────────────────────────────
  let dynamicTimer = null;
  const dynamicObserver = new MutationObserver(() => {
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