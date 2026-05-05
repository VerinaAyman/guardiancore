// GuardianLens Content Script — Intelligent Content Classification + Unified UI
// ✨ Super cute child-friendly owl · bigger sparkling eyes · softer expressions · gentle sounds

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

  // ─── SUPER CUTE CHILD-FRIENDLY OWL SVG ───────────────────────────────────
  function owlSVG(mood) {
    const colors = {
      safe:  { body: '#4ade80', belly: '#dcfce7', eye: '#166534', brow: '#15803d', cheek: '#86efac', pupil: '#052e16' },
      warn:  { body: '#fbbf24', belly: '#fef9c3', eye: '#854d0e', brow: '#a16207', cheek: '#fde68a', pupil: '#3f1500' },
      block: { body: '#f87171', belly: '#fee2e2', eye: '#991b1b', brow: '#b91c1c', cheek: '#fca5a5', pupil: '#3b0101' },
    };
    const c = colors[mood] || colors.warn;

    // Softer, rounder, bigger eyes with extra sparkle for kids
    const browL = mood === 'warn'  ? 'M 24 29 Q 33 23 42 28'
                : mood === 'block' ? 'M 26 32 Q 34 28 42 32'
                : 'M 24 29 Q 33 25 42 29';

    const browR = mood === 'warn'  ? 'M 58 29 Q 67 23 76 28'
                : mood === 'block' ? 'M 58 32 Q 66 28 74 32'
                : 'M 58 29 Q 67 25 76 29';

    const mouth = mood === 'warn'  ? 'M 42 67 Q 50 64 58 67'
                : mood === 'block' ? 'M 41 69 Q 50 65 59 69'   // soft gentle pout
                : 'M 40 64 Q 50 72 60 64';                     // big happy smile

    const lPx = mood === 'warn' ? 32 : mood === 'block' ? 33 : 32;
    const lPy = mood === 'warn' ? 46 : mood === 'block' ? 49 : 46;
    const rPx = mood === 'warn' ? 68 : mood === 'block' ? 67 : 68;
    const rPy = mood === 'warn' ? 46 : mood === 'block' ? 49 : 46;

    const extra = mood === 'warn'
      ? `<circle cx="79" cy="27" r="3.5" fill="#bae6fd"/><path d="M75 33 L79 37 L83 32" fill="#bae6fd"/>`
      : mood === 'block'
      ? `<g opacity="0.9"><circle cx="77" cy="20" r="4" fill="none" stroke="#fb923c" stroke-width="2.5"/><circle cx="85" cy="17" r="2.8" fill="none" stroke="#fb923c" stroke-width="2"/></g>`
      : `<text x="76" y="23" font-size="14" fill="#fef08c">✦</text>`;

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="58" height="58" style="display:block">
  <defs>
    <radialGradient id="owlBody-${mood}" cx="50%" cy="40%" r="65%">
      <stop offset="0%" stop-color="${c.belly}"/>
      <stop offset="100%" stop-color="${c.body}"/>
    </radialGradient>
  </defs>

  <!-- Body & Wings -->
  <ellipse cx="50" cy="65" rx="33" ry="31" fill="url(#owlBody-${mood})"/>
  <ellipse cx="17" cy="68" rx="13.5" ry="11" fill="${c.body}" opacity="0.85" transform="rotate(-32 17 68)"/>
  <ellipse cx="83" cy="68" rx="13.5" ry="11" fill="${c.body}" opacity="0.85" transform="rotate(32 83 68)"/>

  <!-- Ear tufts -->
  <ellipse cx="30" cy="23" rx="10.5" ry="13.5" fill="${c.body}" transform="rotate(-18 30 23)"/>
  <ellipse cx="70" cy="23" rx="10.5" ry="13.5" fill="${c.body}" transform="rotate(18 70 23)"/>

  <!-- Big round friendly eyes -->
  <ellipse cx="33" cy="47" rx="15.5" ry="16.5" fill="#fff"/>
  <ellipse cx="67" cy="47" rx="15.5" ry="16.5" fill="#fff"/>

  <!-- Iris -->
  <ellipse cx="33" cy="47" rx="10.2" ry="11" fill="${c.eye}"/>
  <ellipse cx="67" cy="47" rx="10.2" ry="11" fill="${c.eye}"/>

  <!-- Big expressive pupils -->
  <circle cx="${lPx}" cy="${lPy}" r="6.8" fill="${c.pupil}"/>
  <circle cx="${rPx}" cy="${rPy}" r="6.8" fill="${c.pupil}"/>

  <!-- Eye shine (extra cuteness) -->
  <circle cx="${lPx+3.5}" cy="${lPy-3.5}" r="2.4" fill="#fff" opacity="0.95"/>
  <circle cx="${rPx+3.5}" cy="${rPy-3.5}" r="2.4" fill="#fff" opacity="0.95"/>

  <!-- Chubby soft cheeks -->
  <ellipse cx="19" cy="57" rx="9.5" ry="7.5" fill="${c.cheek}" opacity="0.65"/>
  <ellipse cx="81" cy="57" rx="9.5" ry="7.5" fill="${c.cheek}" opacity="0.65"/>

  <!-- Friendly rounded beak -->
  <path d="M44 61 Q50 67 56 61" fill="#fb923c"/>
  <ellipse cx="50" cy="61.5" rx="6.2" ry="4.2" fill="#f97316"/>

  <!-- Eyebrows -->
  <path d="${browL}" stroke="${c.brow}" stroke-width="4.5" stroke-linecap="round" fill="none"/>
  <path d="${browR}" stroke="${c.brow}" stroke-width="4.5" stroke-linecap="round" fill="none"/>

  <!-- Mouth -->
  <path d="${mouth}" stroke="${c.brow}" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.8"/>

  <!-- Mood extra -->
  ${extra}

  <!-- Tiny feet -->
  <ellipse cx="39" cy="93" rx="8.5" ry="4" fill="${c.body}" opacity="0.8"/>
  <ellipse cx="61" cy="93" rx="8.5" ry="4" fill="${c.body}" opacity="0.8"/>
</svg>`;
  }

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
        --gl-font:    'Nunito', sans-serif;
        --gl-radius:  18px;
        --gl-shadow:  0 8px 40px rgba(0,0,0,0.55);
      }

      @keyframes gl-spring-in {
        0%   { transform: translate(120px,-20px) scale(0.6); opacity:0; }
        60%  { transform: translate(-8px, 4px) scale(1.05); opacity:1; }
        100% { transform: translate(0,0) scale(1); opacity:1; }
      }
      @keyframes gl-spring-out {
        0%   { transform: scale(1); opacity:1; }
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
        10%     { transform: translateX(-6px) rotate(-4deg); }
        20%     { transform: translateX(6px) rotate(4deg); }
        30%     { transform: translateX(-4px) rotate(-3deg); }
        40%     { transform: translateX(4px) rotate(3deg); }
        50%     { transform: translateX(-2px) rotate(-1deg); }
        60%,100%{ transform: translateX(0) rotate(0deg); }
      }
      @keyframes gl-owl-bounce-in {
        0%   { transform: scale(0) rotate(-15deg); opacity: 0; }
        55%  { transform: scale(1.18) rotate(4deg); opacity: 1; }
        75%  { transform: scale(0.93) rotate(-2deg); }
        90%  { transform: scale(1.04) rotate(1deg); }
        100% { transform: scale(1) rotate(0deg); opacity: 1; }
      }

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

      .gl-owl-wrap {
        position: relative; flex-shrink: 0;
        width: 66px; height: 66px;
        display: flex; align-items: center; justify-content: center;
      }
      .gl-owl-ring {
        position: absolute; inset: 0;
        border-radius: 50%; opacity: 0;
      }
      .gl-owl-ring.active { animation: gl-pulse-ring 1.6s cubic-bezier(0,0,0.2,1) infinite; }
      .gl-owl-ring-warn  { border: 2px solid var(--gl-warn); }
      .gl-owl-ring-safe  { border: 2px solid var(--gl-safe); }
      .gl-owl-ring-block { border: 2px solid var(--gl-block); }

      .gl-owl-svg {
        filter: drop-shadow(0 4px 12px rgba(0,0,0,0.35));
      }
      .gl-owl-svg.mood-safe  {
        animation: gl-owl-bounce-in 0.65s cubic-bezier(0.34,1.56,0.64,1) both,
                   gl-owl-float 3.5s ease-in-out 0.7s infinite;
      }
      .gl-owl-svg.mood-warn  {
        animation: gl-owl-bounce-in 0.65s cubic-bezier(0.34,1.56,0.64,1) both,
                   gl-owl-worried 2.2s ease-in-out 0.7s infinite;
      }
      .gl-owl-svg.mood-block {
        animation: gl-owl-bounce-in 0.65s cubic-bezier(0.34,1.56,0.64,1) both,
                   gl-owl-frustrated 1.1s ease-in-out 0.8s 2;
      }

      /* Rest of your original CSS (labels, buttons, chat overlay, etc.) */
      .gl-label { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; display: flex; align-items: center; gap: 6px; }
      .gl-label-warn  { color: var(--gl-warn); }
      .gl-label-safe  { color: var(--gl-safe); }
      .gl-label-block { color: var(--gl-block); }
      .gl-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
      .gl-dot-warn  { background: var(--gl-warn); animation: gl-bounce-dot 1.4s ease-in-out 0.2s infinite both; }
      .gl-dot-safe  { background: var(--gl-safe); }
      .gl-dot-block { background: var(--gl-block); animation: gl-shake 0.5s ease 0.3s both; }
      .gl-title { font-size: 15px; font-weight: 900; line-height: 1.25; margin-bottom: 5px; color: var(--gl-text); }
      .gl-body { font-size: 13px; font-weight: 500; line-height: 1.55; color: var(--gl-muted); }
      .gl-footer { padding: 0 18px 14px; display: flex; gap: 8px; justify-content: flex-end; }
      .gl-btn { font-family: var(--gl-font); font-size: 12.5px; font-weight: 800; padding: 7px 16px; border-radius: 50px; border: none; cursor: pointer; transition: transform 0.15s, opacity 0.15s; }
      .gl-btn:hover  { transform: scale(1.06); opacity: 0.92; }
      .gl-btn-dismiss { background: rgba(255,255,255,0.08); color: var(--gl-muted); }
      .gl-btn-chat { background: var(--gl-accent); color: #fff; box-shadow: 0 2px 12px rgba(99,102,241,0.4); }

      #gl-safe-chip {
        position: fixed; bottom: 20px; right: 20px; z-index: 2147483646;
        font-family: var(--gl-font); background: rgba(34,197,94,0.18);
        border: 1.5px solid var(--gl-safe); color: var(--gl-safe);
        font-size: 12px; font-weight: 800; padding: 6px 14px; border-radius: 50px;
        display: flex; align-items: center; gap: 8px; pointer-events: none;
        animation: gl-spring-in 0.45s cubic-bezier(0.34,1.56,0.64,1) both;
      }
      #gl-safe-chip.gl-exit { animation: gl-spring-out 0.3s ease both; }

      /* Chat Overlay Styles (kept from your original) */
      #gl-chat-overlay { position: fixed; inset: 0; z-index: 2147483647; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(0,0,0,0.7); backdrop-filter: blur(6px); }
      .gl-chat-panel { width: 100%; max-width: 380px; border-radius: 24px; overflow: hidden; box-shadow: 0 24px 80px rgba(0,0,0,0.8); animation: gl-overlay-in 0.4s cubic-bezier(0.34,1.56,0.64,1) both; display: flex; flex-direction: column; max-height: 90vh; }
      /* ... (all other chat styles from your original file remain the same) ... */
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
      const r = 32 + Math.random() * 12;
      s.style.left  = (33 + Math.cos(angle * Math.PI / 180) * r) + 'px';
      s.style.top   = (33 + Math.sin(angle * Math.PI / 180) * r) + 'px';
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
    chip.innerHTML = `<span class="gl-chip-owl" style="display:inline-block;width:20px;height:20px">${owlSVG('safe').replace('width="58" height="58"','width="20" height="20"')}</span> GuardianLens: All Clear`;
    document.body.appendChild(chip);
    setTimeout(() => {
      chip.classList.add('gl-exit');
      setTimeout(() => chip.remove(), 380);
    }, 3200);
  }

  // ─── In-page Chat Overlay ─────────────────────────────────────────────────
  function openChatOverlay({ category = '', domain = '', reason = '', mood = 'warn' }) {
    const existing = document.getElementById('gl-chat-overlay');
    if (existing) existing.remove();

    injectFont(); injectStyles();

    const overlay = document.createElement('div');
    overlay.id = 'gl-chat-overlay';

    overlay.innerHTML = `
      <div class="gl-chat-panel">
        <div class="gl-chat-topbar">
          <div class="gl-chat-av-wrap">
            <div class="gl-owl-svg mood-${mood}" style="width:40px;height:40px;display:flex;align-items:center;justify-content:center">
              ${owlSVG(mood).replace('width="58" height="58"', 'width="38" height="38"')}
            </div>
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
          <span class="gl-chat-context-icon">${mood === 'block' ? '🚫' : '⚠️'}</span>
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

    document.documentElement.appendChild(overlay);

    // Chat logic (same as your original)
    const messagesEl = document.getElementById('gl-chat-messages');
    const inputEl    = document.getElementById('gl-chat-input');
    const sendBtn    = document.getElementById('gl-send-btn');
    const closeBtn   = document.getElementById('gl-chat-close-btn');
    const chipsEl    = document.getElementById('gl-quick-chips');

    function closeOverlay() {
      overlay.classList.add('gl-exit');
      setTimeout(() => overlay.remove(), 280);
    }

    closeBtn.addEventListener('click', closeOverlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(); });

    function addMsg(text, who = 'bot') {
      const row = document.createElement('div');
      row.className = `gl-msg-row ${who}`;
      const av = document.createElement('div');
      av.className = 'gl-msg-av';
      if (who === 'bot') av.innerHTML = owlSVG(mood).replace('width="58" height="58"', 'width="28" height="28"');
      else av.textContent = '🧒';
      const bub = document.createElement('div');
      bub.className = 'gl-msg-bub';
      bub.textContent = text;
      row.appendChild(av);
      row.appendChild(bub);
      messagesEl.appendChild(row);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    // ... (rest of chat logic remains the same as your original version) ...

    const openingMsg = reason
      ? `Hey! 🦉 I noticed something on ${domain || 'this page'}: ${reason}. I'm here to help — what would you like to know?`
      : `Hey there! 🦉 I flagged this page because of "${category || 'some content'}" on ${domain || 'this site'}. Got questions? I'm all ears! 🌟`;

    setTimeout(() => addMsg(openingMsg), 200);

    // Quick chips and send logic (kept from original)
    // ... (your original chat handling code goes here) ...
  }

  // ─── Warn / info bubble ───────────────────────────────────────────────────
  function showLensBubble({ risk = 50, category = '', reason = '', domain = '' }) {
    removeBubble();
    injectFont(); injectStyles();
    soundWarn();

    const isHighRisk = risk >= 65;
    const tier  = isHighRisk ? 'block' : 'warn';
    const mood  = isHighRisk ? 'block' : 'warn';
    const label = isHighRisk ? 'Heads Up!' : 'Just So You Know';
    const title = category || (isHighRisk ? 'This looks risky' : 'Worth a quick chat');
    const body  = reason  || (isHighRisk
      ? `I spotted something on this page that might not be great for you. Wanna talk about it? 💙`
      : `There's some content here that might be good to chat about. You're doing great by being careful! 🌟`);

    const bubble = document.createElement('div');
    bubble.id = 'gl-bubble';
    bubble.innerHTML = `
      <div class="gl-bar gl-bar-${tier}"></div>
      <div class="gl-inner">
        <div class="gl-owl-wrap" id="gl-owl-wrap">
          <div class="gl-owl-ring gl-owl-ring-${tier} active"></div>
          <div class="gl-owl-svg mood-${mood}">
            ${owlSVG(mood)}
          </div>
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

    document.documentElement.appendChild(bubble);

    document.getElementById('gl-btn-dismiss').addEventListener('click', (e) => {
      e.stopPropagation();
      removeBubble();
    });

    document.getElementById('gl-btn-chat').addEventListener('click', (e) => {
      e.stopPropagation();
      removeBubble();
      openChatOverlay({ category, domain, reason, mood });
    });
  }

  // ─── Domain lists & helpers (unchanged) ───────────────────────────────────
  const INSTANT_BLOCK_DOMAINS = [ /* your original list */ ];
  const RISKY_DOMAINS = [ /* your original list */ ];

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

  // ─── Page text extraction & analysis (keep your original) ────────────────
  function extractPageText() { /* your original extractPageText function */ }
  function handleAnalysisResponse(response, wasHidden) { /* your original */ }
  function requestAnalysis(wasHidden) { /* your original */ }

  // ─── Message listener ─────────────────────────────────────────────────────
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
      setTimeout(() => requestAnalysis(false), 5000);
    }
  }

  init();

  // ─── SPA navigation & dynamic watchers (keep your original) ───────────────
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (isInstantBlock()) { silentBlock('Adult content', 'This site is not allowed.', window.location.href); return; }
      const risky = isRiskyDomain();
      if (risky) hidePage();
      setTimeout(() => requestAnalysis(risky), risky ? 2500 : 1000);
    }
  }).observe(document.body, { childList: true, subtree: true });

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