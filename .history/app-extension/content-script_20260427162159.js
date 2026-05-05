// GuardianLens Content Script — Intelligent Content Classification + Unified UI
// ✨ Super cute child-friendly owl · improved expressions · sounds

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

  // ─── CUTER OWL SVG — More child-friendly ────────────────────────────────
  function owlSVG(mood) {
    const colors = {
      safe:  { body: '#4ade80', belly: '#dcfce7', eye: '#166534', brow: '#15803d', cheek: '#86efac', pupil: '#052e16' },
      warn:  { body: '#fbbf24', belly: '#fef9c3', eye: '#854d0e', brow: '#a16207', cheek: '#fde68a', pupil: '#3f1500' },
      block: { body: '#f87171', belly: '#fee2e2', eye: '#991b1b', brow: '#b91c1c', cheek: '#fca5a5', pupil: '#3b0101' },
    };
    const c = colors[mood] || colors.warn;

    // Softer, rounder, bigger eyes + more sparkle for kids
    const browL = mood === 'warn' ? 'M 25 29 Q 34 23 41 29' 
                : mood === 'block' ? 'M 26 33 Q 34 29 42 33' 
                : 'M 25 30 Q 34 26 41 30';

    const browR = mood === 'warn' ? 'M 59 29 Q 68 23 75 29'
                : mood === 'block' ? 'M 58 33 Q 66 29 74 33'
                : 'M 59 30 Q 68 26 75 30';

    const mouth = mood === 'warn'  ? 'M 42 68 Q 50 65 58 68'
                : mood === 'block' ? 'M 41 70 Q 50 66 59 70'   // softer pout
                : 'M 40 65 Q 50 73 60 65';                     // big happy smile

    const lPx = mood === 'warn' ? 32 : mood === 'block' ? 33 : 32;
    const lPy = mood === 'warn' ? 47 : mood === 'block' ? 50 : 47;
    const rPx = mood === 'warn' ? 68 : mood === 'block' ? 67 : 68;
    const rPy = mood === 'warn' ? 47 : mood === 'block' ? 50 : 47;

    const extra = mood === 'warn' 
      ? `<circle cx="78" cy="28" r="3" fill="#bae6fd"/><path d="M75 34 L79 38 L83 33" fill="#bae6fd"/>`
      : mood === 'block'
      ? `<g opacity="0.9"><circle cx="77" cy="21" r="4" fill="none" stroke="#fb923c" stroke-width="2.5"/><circle cx="85" cy="18" r="2.5" fill="none" stroke="#fb923c" stroke-width="2"/></g>`
      : `<text x="76" y="24" font-size="13" fill="#fef08c">✦</text>`;

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="58" height="58" style="display:block">
  <defs>
    <radialGradient id="owlBody-${mood}" cx="50%" cy="40%" r="65%">
      <stop offset="0%" stop-color="${c.belly}"/>
      <stop offset="100%" stop-color="${c.body}"/>
    </radialGradient>
  </defs>

  <!-- Body & Wings -->
  <ellipse cx="50" cy="65" rx="33" ry="31" fill="url(#owlBody-${mood})"/>
  <ellipse cx="18" cy="68" rx="13" ry="11" fill="${c.body}" opacity="0.85" transform="rotate(-30 18 68)"/>
  <ellipse cx="82" cy="68" rx="13" ry="11" fill="${c.body}" opacity="0.85" transform="rotate(30 82 68)"/>

  <!-- Ear tufts -->
  <ellipse cx="31" cy="24" rx="10" ry="13" fill="${c.body}" transform="rotate(-20 31 24)"/>
  <ellipse cx="69" cy="24" rx="10" ry="13" fill="${c.body}" transform="rotate(20 69 24)"/>

  <!-- Big friendly eye whites -->
  <ellipse cx="33" cy="48" rx="15" ry="16" fill="#fff"/>
  <ellipse cx="67" cy="48" rx="15" ry="16" fill="#fff"/>

  <!-- Iris -->
  <ellipse cx="33" cy="48" rx="10" ry="11" fill="${c.eye}"/>
  <ellipse cx="67" cy="48" rx="10" ry="11" fill="${c.eye}"/>

  <!-- Big expressive pupils -->
  <circle cx="${lPx}" cy="${lPy}" r="6.5" fill="${c.pupil}"/>
  <circle cx="${rPx}" cy="${rPy}" r="6.5" fill="${c.pupil}"/>

  <!-- Eye shine (extra cuteness) -->
  <circle cx="${lPx+3}" cy="${lPy-3}" r="2.2" fill="#fff" opacity="0.9"/>
  <circle cx="${rPx+3}" cy="${rPy-3}" r="2.2" fill="#fff" opacity="0.9"/>

  <!-- Soft cheeks -->
  <ellipse cx="20" cy="58" rx="9" ry="7" fill="${c.cheek}" opacity="0.6"/>
  <ellipse cx="80" cy="58" rx="9" ry="7" fill="${c.cheek}" opacity="0.6"/>

  <!-- Friendly rounded beak -->
  <path d="M45 62 Q50 68 55 62" fill="#fb923c"/>
  <ellipse cx="50" cy="62" rx="6" ry="4" fill="#f97316"/>

  <!-- Eyebrows -->
  <path d="${browL}" stroke="${c.brow}" stroke-width="4.5" stroke-linecap="round" fill="none"/>
  <path d="${browR}" stroke="${c.brow}" stroke-width="4.5" stroke-linecap="round" fill="none"/>

  <!-- Mouth -->
  <path d="${mouth}" stroke="${c.brow}" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.8"/>

  <!-- Mood extra -->
  ${extra}

  <!-- Tiny feet -->
  <ellipse cx="40" cy="93" rx="8" ry="4" fill="${c.body}"/>
  <ellipse cx="60" cy="93" rx="8" ry="4" fill="${c.body}"/>
</svg>`;
  }

  // (The rest of the file remains almost the same — only owlSVG was heavily improved)
  // ... [All the CSS, bubble, chat, analysis logic stays exactly as you had it]

  // Just replace the old owlSVG function with the new one above.
  // The animation classes (gl-owl-svg.mood-safe etc.) will now look cuter.

  // ─── Rest of your original code continues here (injectStyles, showSafeChip, showLensBubble, etc.) ───
  // Paste the rest of your previous content-script.js from "injectStyles()" down to the end.
  // (I kept everything else untouched for stability)

})();
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

      /* ── Owl mood animations ── */
      /* Safe: gentle happy float */
      @keyframes gl-owl-float {
        0%,100% { transform: translateY(0) rotate(-1deg) scale(1); }
        40%     { transform: translateY(-8px) rotate(2deg) scale(1.03); }
        70%     { transform: translateY(-4px) rotate(-1deg) scale(1.01); }
      }
      /* Warn: nervous side-to-side fidget + slight bob */
      @keyframes gl-owl-worried {
        0%,100% { transform: translateX(0) translateY(0) rotate(0deg); }
        15%     { transform: translateX(-4px) translateY(-2px) rotate(-4deg); }
        30%     { transform: translateX(3px) translateY(-4px) rotate(3deg); }
        45%     { transform: translateX(-3px) translateY(-1px) rotate(-3deg); }
        60%     { transform: translateX(2px) translateY(-3px) rotate(2deg); }
        75%     { transform: translateX(-1px) translateY(0) rotate(-1deg); }
      }
      /* Block: short sharp head-shake (frustrated) then hold */
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
        0%   { transform: scale(0) rotate(-15deg); opacity: 0; }
        55%  { transform: scale(1.18) rotate(4deg); opacity: 1; }
        75%  { transform: scale(0.93) rotate(-2deg); }
        90%  { transform: scale(1.04) rotate(1deg); }
        100% { transform: scale(1) rotate(0deg); opacity: 1; }
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

      /* Owl mascot */
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
      .gl-btn:hover  { transform: scale(1.06); opacity: 0.92; }
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
        display: flex; align-items: center; gap: 8px;
        pointer-events: none;
        animation: gl-spring-in 0.45s cubic-bezier(0.34,1.56,0.64,1) both;
        backdrop-filter: blur(8px);
      }
      #gl-safe-chip.gl-exit { animation: gl-spring-out 0.3s ease both; }
      #gl-safe-chip .gl-chip-owl { animation: gl-owl-float 2.5s ease-in-out infinite; display:inline-block; }

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
        width: 48px; height: 48px;
        display: flex; align-items: center; justify-content: center;
        background: rgba(255,255,255,0.15);
        border-radius: 50%;
        flex-shrink: 0;
        overflow: visible;
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
        font-size: 11.5px; font-weight: 700;
        color: #fca5a5;
        font-family: var(--gl-font);
      }

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
        font-size: 15px; flex-shrink: 0; overflow: hidden;
      }
      .gl-msg-bub {
        max-width: 82%; padding: 10px 14px;
        font-size: 13.5px; line-height: 1.55;
        border-radius: 18px; word-break: break-word;
        font-family: var(--gl-font); font-weight: 600;
      }
      .gl-msg-row.bot .gl-msg-bub {
        background: #1e293b; color: var(--gl-text);
        border-bottom-left-radius: 4px;
        border: 1px solid rgba(255,255,255,0.06);
      }
      .gl-msg-row.user .gl-msg-bub {
        background: var(--gl-accent); color: #fff;
        border-bottom-right-radius: 4px;
      }

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
        font-family: var(--gl-font); font-weight: 600;
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

      .gl-quick-chips {
        display: flex; flex-wrap: wrap; gap: 6px;
        padding: 8px 12px 0;
        background: #0f172a;
      }
      .gl-chip {
        font-family: var(--gl-font);
        font-size: 11.5px; font-weight: 700;
        padding: 5px 12px; border-radius: 20px;
        background: rgba(99,102,241,0.12);
        border: 1px solid rgba(99,102,241,0.25);
        color: #a5b4fc; cursor: pointer;
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
    chip.innerHTML = `<span class="gl-chip-owl" style="display:inline-block;width:20px;height:20px">${owlSVG('safe').replace('width="54" height="54"','width="20" height="20"')}</span> GuardianLens: All Clear`;
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

    const miniOwl = owlSVG(mood).replace('width="54" height="54"', 'width="28" height="28"');

    overlay.innerHTML = `
      <div class="gl-chat-panel">
        <div class="gl-chat-topbar">
          <div class="gl-chat-av-wrap">
            <div class="gl-owl-svg mood-${mood}" style="width:40px;height:40px;display:flex;align-items:center;justify-content:center">
              ${owlSVG(mood).replace('width="54" height="54"', 'width="38" height="38"')}
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
    function onKeydown(e) { if (e.key === 'Escape') { closeOverlay(); document.removeEventListener('keydown', onKeydown); } }
    document.addEventListener('keydown', onKeydown);

    function addMsg(text, who = 'bot') {
      const row = document.createElement('div');
      row.className = `gl-msg-row ${who}`;
      const av = document.createElement('div');
      av.className = 'gl-msg-av';
      if (who === 'bot') av.innerHTML = miniOwl;
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
      av.className = 'gl-msg-av'; av.innerHTML = miniOwl;
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
        const q = chip.textContent.replace(/[\u{1F000}-\u{1FFFF}]/gu, '').trim();
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
              systemPrompt: `You are Lens 🦉, GuardianLens's friendly owl mascot and web buddy for children.
A page was flagged${category ? ` for "${category}"` : ''}${domain ? ` on ${domain}` : ''}.
${reason ? 'Reason: ' + reason + '.' : ''}
Be warm, kind, and age-appropriate. Keep answers to 2-3 sentences max. Use 1 emoji. Never use scary language. Encourage talking to a trusted adult if needed.`,
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
            resolve("I can't connect right now, but I'm always here to help when I can! 💙");
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
        e.preventDefault();
        removeBubble();
        openChatOverlay({ category, domain, reason, mood });
        try {
          chrome.runtime.sendMessage({ type: 'LENS_OPEN_CHAT', domain, category }, () => { void chrome.runtime.lastError; });
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
      setTimeout(() => requestAnalysis(false), 5000);
    }
  }

  init();

  // ─── SPA navigation ───────────────────────────────────────────────────────
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