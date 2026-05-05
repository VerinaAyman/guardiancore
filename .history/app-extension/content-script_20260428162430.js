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

  // ─── SVG Owl Factory ─────────────────────────────────────────────────────
  // mood: 'safe' | 'warn' | 'block'
  // w, h: output dimensions
  function owlSVG(mood, w, h) {
    w = w || 54; h = h || 54;
    const colors = {
      safe:  { body: '#4ade80', belly: '#dcfce7', eye: '#166534', brow: '#15803d', cheek: '#86efac', pupil: '#052e16' },
      warn:  { body: '#fbbf24', belly: '#fef9c3', eye: '#854d0e', brow: '#a16207', cheek: '#fde68a', pupil: '#3f1500' },
      block: { body: '#f87171', belly: '#fee2e2', eye: '#991b1b', brow: '#b91c1c', cheek: '#fca5a5', pupil: '#3b0101' },
    };
    const c = colors[mood] || colors.warn;
    const uid = mood + '_' + Math.random().toString(36).slice(2,6);

    // Eyebrows
    const browL = mood === 'warn'  ? 'M 26 30 Q 33 24 40 28'
                : mood === 'block' ? 'M 24 28 Q 33 34 40 29'
                :                   'M 26 32 Q 33 28 40 31';
    const browR = mood === 'warn'  ? 'M 60 28 Q 67 24 74 30'
                : mood === 'block' ? 'M 60 29 Q 67 34 76 28'
                :                   'M 60 31 Q 67 28 74 32';

    // Mouth
    const mouth = mood === 'warn'  ? 'M 43 68 Q 50 64 57 68'
                : mood === 'block' ? 'M 40 70 Q 50 63 60 70'
                :                   'M 41 66 Q 50 74 59 66';

    // Pupils
    const lPx = mood === 'warn' ? '33' : mood === 'block' ? '34' : '33';
    const lPy = mood === 'warn' ? '47' : mood === 'block' ? '51' : '49';
    const rPx = mood === 'warn' ? '67' : mood === 'block' ? '66' : '67';
    const rPy = mood === 'warn' ? '47' : mood === 'block' ? '51' : '49';

    // Mood extras
    const extra = mood === 'warn'
      ? `<g opacity="0.9">
          <ellipse cx="79" cy="30" rx="4" ry="6" fill="#93c5fd"/>
          <polygon points="75,34 79,36 83,34 79,42" fill="#93c5fd"/>
        </g>`
      : mood === 'block'
      ? `<g opacity="0.85">
          <circle cx="78" cy="22" r="5" fill="none" stroke="#f97316" stroke-width="2.5"/>
          <circle cx="86" cy="16" r="3.5" fill="none" stroke="#f97316" stroke-width="2"/>
          <circle cx="72" cy="15" r="2.5" fill="none" stroke="#f97316" stroke-width="1.5"/>
        </g>`
      : `<g opacity="0.9"><text x="76" y="26" font-size="12" fill="#fbbf24">✦</text></g>`;

    // Half-lid clip for block mood (pouty eyes)
    const clipDefs = mood === 'block'
      ? `<clipPath id="ecL${uid}"><rect x="18" y="42" width="30" height="22" rx="2"/></clipPath>
         <clipPath id="ecR${uid}"><rect x="52" y="42" width="30" height="22" rx="2"/></clipPath>`
      : '';
    const cpL = mood === 'block' ? `clip-path="url(#ecL${uid})"` : '';
    const cpR = mood === 'block' ? `clip-path="url(#ecR${uid})"` : '';

    const heavyLids = mood === 'block'
      ? `<path d="M 20 47 Q 33 42 46 47" stroke="${c.brow}" stroke-width="3.5" stroke-linecap="round" fill="none"/>
         <path d="M 54 47 Q 67 42 80 47" stroke="${c.brow}" stroke-width="3.5" stroke-linecap="round" fill="none"/>`
      : '';

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${w}" height="${h}" style="display:block;overflow:visible">
  <defs>
    <radialGradient id="owlBG${uid}" cx="50%" cy="38%" r="60%">
      <stop offset="0%" stop-color="${c.belly}"/>
      <stop offset="100%" stop-color="${c.body}"/>
    </radialGradient>
    ${clipDefs}
  </defs>
  <!-- Wings -->
  <ellipse cx="14" cy="68" rx="13" ry="9" fill="${c.body}" opacity="0.8" transform="rotate(-25,14,68)"/>
  <ellipse cx="86" cy="68" rx="13" ry="9" fill="${c.body}" opacity="0.8" transform="rotate(25,86,68)"/>
  <!-- Body -->
  <ellipse cx="50" cy="63" rx="32" ry="32" fill="url(#owlBG${uid})"/>
  <!-- Belly -->
  <ellipse cx="50" cy="67" rx="20" ry="24" fill="${c.belly}" opacity="0.65"/>
  <!-- Ear tufts -->
  <ellipse cx="32" cy="22" rx="9" ry="12" fill="${c.body}" transform="rotate(-15,32,22)"/>
  <ellipse cx="68" cy="22" rx="9" ry="12" fill="${c.body}" transform="rotate(15,68,22)"/>
  <ellipse cx="30" cy="14" rx="5" ry="7" fill="${c.belly}" opacity="0.7" transform="rotate(-15,30,14)"/>
  <ellipse cx="70" cy="14" rx="5" ry="7" fill="${c.belly}" opacity="0.7" transform="rotate(15,70,14)"/>
  <!-- Eye whites -->
  <circle cx="33" cy="49" r="14" fill="white" ${cpL}/>
  <circle cx="67" cy="49" r="14" fill="white" ${cpR}/>
  <!-- Iris rings -->
  <circle cx="33" cy="49" r="10" fill="${c.eye}" opacity="0.22" ${cpL}/>
  <circle cx="67" cy="49" r="10" fill="${c.eye}" opacity="0.22" ${cpR}/>
  <!-- Pupils -->
  <circle cx="${lPx}" cy="${lPy}" r="7" fill="${c.pupil}" ${cpL}/>
  <circle cx="${rPx}" cy="${rPy}" r="7" fill="${c.pupil}" ${cpR}/>
  <!-- Eye shine -->
  <circle cx="${parseInt(lPx)+3}" cy="${parseInt(lPy)-3}" r="2.5" fill="white" ${cpL}/>
  <circle cx="${parseInt(lPx)-1}" cy="${parseInt(lPy)+2}" r="1.2" fill="white" opacity="0.6" ${cpL}/>
  <circle cx="${parseInt(rPx)+3}" cy="${parseInt(rPy)-3}" r="2.5" fill="white" ${cpR}/>
  <circle cx="${parseInt(rPx)-1}" cy="${parseInt(rPy)+2}" r="1.2" fill="white" opacity="0.6" ${cpR}/>
  <!-- Heavy lids (block) -->
  ${heavyLids}
  <!-- Cheeks -->
  <ellipse cx="20" cy="57" rx="8" ry="6" fill="${c.cheek}" opacity="0.55"/>
  <ellipse cx="80" cy="57" rx="8" ry="6" fill="${c.cheek}" opacity="0.55"/>
  <!-- Beak -->
  <ellipse cx="50" cy="62" rx="6" ry="4.5" fill="#f97316"/>
  <path d="M 44 62 Q 50 67 56 62" fill="#ea580c" opacity="0.5"/>
  <!-- Eyebrows -->
  <path d="${browL}" stroke="${c.brow}" stroke-width="4" stroke-linecap="round" fill="none"/>
  <path d="${browR}" stroke="${c.brow}" stroke-width="4" stroke-linecap="round" fill="none"/>
  <!-- Mouth -->
  <path d="${mouth}" stroke="${c.brow}" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.75"/>
  <!-- Mood extra -->
  ${extra}
  <!-- Feet -->
  <ellipse cx="42" cy="94" rx="10" ry="5" fill="${c.body}" opacity="0.65"/>
  <ellipse cx="58" cy="94" rx="10" ry="5" fill="${c.body}" opacity="0.65"/>
  <path d="M 36 93 L 34 97 M 42 95 L 41 98 M 48 93 L 47 97" stroke="${c.body}" stroke-width="2" stroke-linecap="round" opacity="0.7"/>
  <path d="M 52 93 L 51 97 M 58 95 L 57 98 M 64 93 L 63 97" stroke="${c.body}" stroke-width="2" stroke-linecap="round" opacity="0.7"/>
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

      /* ── Warning Bubble ── */
      #gl-bubble {
        position: fixed;
        bottom: 24px; right: 24px;
        z-index: 2147483647;
        font-family: var(--gl-font);
        max-width: 340px; width: 340px;
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

      .gl-inner { padding: 16px 18px 14px; display: flex; gap: 14px; align-items: flex-start; }

      /* Owl wrap */
      .gl-owl-wrap {
        position: relative; flex-shrink: 0;
        width: 70px; height: 70px;
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

      .gl-owl-svg { filter: drop-shadow(0 4px 12px rgba(0,0,0,0.35)); }
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
                   gl-owl-frustrated 0.9s ease-in-out 0.7s 3;
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
        margin-bottom: 4px; display: flex; align-items: center; gap: 6px;
      }
      .gl-label-warn  { color: var(--gl-warn); }
      .gl-label-safe  { color: var(--gl-safe); }
      .gl-label-block { color: var(--gl-block); }

      .gl-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
      .gl-dot-warn  { background: var(--gl-warn); animation: gl-bounce-dot 1.4s ease-in-out 0.2s infinite both; }
      .gl-dot-safe  { background: var(--gl-safe); }
      .gl-dot-block { background: var(--gl-block); animation: gl-shake 0.5s ease 0.3s both; }

      .gl-title { font-size: 15px; font-weight: 900; line-height: 1.25; margin-bottom: 5px; color: var(--gl-text); }
      .gl-body  { font-size: 13px; font-weight: 500; line-height: 1.55; color: var(--gl-muted); }

      .gl-footer { padding: 0 18px 14px; display: flex; gap: 8px; justify-content: flex-end; }
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
      .gl-btn:hover  { transform: scale(1.06); opacity: 0.92; }
      .gl-btn:active { transform: scale(0.97); }
      .gl-btn-dismiss { background: rgba(255,255,255,0.08); color: var(--gl-muted); }
      .gl-btn-chat    { background: var(--gl-accent); color: #fff; box-shadow: 0 2px 12px rgba(99,102,241,0.4); }

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

  // ─── Sparkle burst ────────────────────────────────────────────────────────
  function burstSparkles(container, count = 6) {
    const emojis = ['✨','⭐','💫','🌟','✦','❋'];
    for (let i = 0; i < count; i++) {
      const s = document.createElement('span');
      s.className = 'gl-sparkle';
      s.textContent = emojis[i % emojis.length];
      const angle = (i / count) * 360;
      const r = 34 + Math.random() * 12;
      s.style.left  = (35 + Math.cos(angle * Math.PI / 180) * r) + 'px';
      s.style.top   = (35 + Math.sin(angle * Math.PI / 180) * r) + 'px';
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
    chip.innerHTML = `<span class="gl-chip-owl">${owlSVG('safe', 20, 20)}</span> GuardianLens: All Clear`;
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

    const miniOwlTopbar = owlSVG(mood, 38, 38);
    const miniOwlMsg    = owlSVG(mood, 22, 22);

    overlay.innerHTML = `
      <div class="gl-chat-panel">
        <div class="gl-chat-topbar">
          <div class="gl-chat-av-wrap">
            <div class="gl-owl-svg mood-${mood}" style="display:flex;align-items:center;justify-content:center;">
              ${miniOwlTopbar}
            </div>
            <div class="gl-chat-av-dot"></div>
          </div>
          <div class="gl-chat-meta">
            <div class="gl-chat-name">Lens 🦉 — your web buddy</div>
            <div class="gl-chat-sub">here to explain & help you out!</div>
          </div>
          <button class="gl-chat-close" id="gl-chat-close-btn" aria-label="Close">✕</button>
        </div>
        ${domain || category ? `
        <div class="gl-chat-context">
          <span style="font-size:14px">${mood === 'block' ? '🚫' : '⚠️'}</span>
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

    const messagesEl = document.getElementById('gl-chat-messages');
    const inputEl    = document.getElementById('gl-chat-input');
    const sendBtn    = document.getElementById('gl-send-btn');
    const closeBtn   = document.getElementById('gl-chat-close-btn');
    const chipsEl    = document.getElementById('gl-quick-chips');

    function closeOverlay() {
      overlay.classList.add('gl-exit');
      setTimeout(() => overlay.remove(), 280);
    }

    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeOverlay(); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(); });
    function onKeydown(e) {
      if (e.key === 'Escape') { closeOverlay(); document.removeEventListener('keydown', onKeydown); }
    }
    document.addEventListener('keydown', onKeydown);

    function addMsg(text, who = 'bot') {
      const row = document.createElement('div');
      row.className = `gl-msg-row ${who}`;
      const av = document.createElement('div');
      av.className = 'gl-msg-av';
      if (who === 'bot') av.innerHTML = miniOwlMsg;
      else av.textContent = '🧒';
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
      av.className = 'gl-msg-av'; av.innerHTML = miniOwlMsg;
      const t = document.createElement('div');
      t.className = 'gl-typing';
      t.innerHTML = '<span></span><span></span><span></span>';
      row.appendChild(av); row.appendChild(t);
      messagesEl.appendChild(row);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function removeTyping() { document.getElementById('gl-typing-row')?.remove(); }

    const openingMsg = reason
      ? `Hey! 🦉 I noticed something on ${domain || 'this page'}: ${reason}. I'm here to help — what would you like to know?`
      : `Hey there! 🦉 I flagged this page because of "${category || 'some content'}" on ${domain || 'this site'}. Got questions? I'm all ears! 🌟`;
    setTimeout(() => addMsg(openingMsg), 200);

    chipsEl.querySelectorAll('.gl-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const q = chip.textContent.replace(/\p{Emoji}/gu, '').trim();
        chipsEl.remove();
        addMsg(chip.textContent, 'user');
        handleSend(q);
      });
    });

    async function handleSend(overrideText) {
      const text = overrideText || inputEl.value.trim();
      if (!text) return;
      if (!overrideText) { addMsg(text, 'user'); inputEl.value = ''; }
      inputEl.disabled = true;
      sendBtn.disabled = true;
      showTyping();

      try {
        const reply = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('timeout')), 15000);
          if (!isExtensionAlive()) {
            clearTimeout(timeout);
            resolve("I'm having trouble connecting right now. Try asking a trusted adult for help! 💙");
            return;
          }
          try {
            chrome.runtime.sendMessage({
              type: 'LENS_GROQ_REQUEST',
              systemPrompt: `You are Lens 🦉, GuardianLens's friendly owl mascot for children.
A page was flagged${category ? ` for "${category}"` : ''}${domain ? ` on ${domain}` : ''}.
${reason ? 'Reason: ' + reason + '.' : ''}
Be warm, kind, age-appropriate. Keep answers 2-3 sentences max. Use 1 emoji. Never scary language. Encourage talking to a trusted adult if needed.`,
              history: [{ role: 'user', content: text }]
            }, (res) => {
              clearTimeout(timeout);
              if (chrome.runtime.lastError) {
                resolve("I'm a little sleepy right now! Ask a trusted adult if you need help 💙");
                return;
              }
              resolve(res?.reply || "I'm having a little hiccup! Try again in a moment 🌀");
            });
          } catch (err) {
            clearTimeout(timeout);
            resolve("I can't connect right now, but I'm always here to help! 💙");
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
    inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.stopPropagation(); handleSend(); } });
    setTimeout(() => inputEl.focus(), 420);
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
            ${owlSVG(mood, 54, 54)}
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

    if (isHighRisk) {
      setTimeout(() => burstSparkles(document.getElementById('gl-owl-wrap')), 300);
    }

    const dismissBtn  = document.getElementById('gl-btn-dismiss');
    const chatBtn     = document.getElementById('gl-btn-chat');

    if (dismissBtn) {
      dismissBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeBubble();
        safeSend({ type: 'LENS_WARNING_DISMISSED', domain, risk, category, url: window.location.href });
      });
    }
    if (chatBtn) {
      chatBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        removeBubble();
        openChatOverlay({ category, domain, reason, mood });
        safeSend({ type: 'LENS_OPEN_CHAT', domain, category });
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