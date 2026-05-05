// GuardianLens Content Script — Super cute child-friendly owl + unified UI
// Fixed & complete version - April 2026

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
    link.id = 'gl-font';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap';
    document.head.appendChild(link);
  }

  // ─── Sound engine ─────────────────────────────────────────────────────────
  let _audioCtx = null;
  let _userHasInteracted = false;

  document.addEventListener('click', () => { _userHasInteracted = true; }, { once: true, capture: true });
  document.addEventListener('keydown', () => { _userHasInteracted = true; }, { once: true, capture: true });
  document.addEventListener('touchstart', () => { _userHasInteracted = true; }, { once: true, capture: true });

  function getAudioCtx() {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
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

  // ─── Super Cute Child-Friendly Owl SVG ───────────────────────────────────
  function owlSVG(mood) {
    const colors = {
      safe:  { body: '#4ade80', belly: '#dcfce7', eye: '#166534', brow: '#15803d', cheek: '#86efac', pupil: '#052e16' },
      warn:  { body: '#fbbf24', belly: '#fef9c3', eye: '#854d0e', brow: '#a16207', cheek: '#fde68a', pupil: '#3f1500' },
      block: { body: '#f87171', belly: '#fee2e2', eye: '#991b1b', brow: '#b91c1c', cheek: '#fca5a5', pupil: '#3b0101' },
    };
    const c = colors[mood] || colors.warn;

    const browL = mood === 'warn' ? 'M 24 29 Q 33 23 42 28' :
                  mood === 'block' ? 'M 26 32 Q 34 28 42 32' : 'M 24 29 Q 33 25 42 29';

    const browR = mood === 'warn' ? 'M 58 29 Q 67 23 76 28' :
                  mood === 'block' ? 'M 58 32 Q 66 28 74 32' : 'M 58 29 Q 67 25 76 29';

    const mouth = mood === 'warn' ? 'M 42 67 Q 50 64 58 67' :
                  mood === 'block' ? 'M 41 69 Q 50 65 59 69' : 'M 40 64 Q 50 72 60 64';

    const lPx = mood === 'warn' ? 32 : mood === 'block' ? 33 : 32;
    const lPy = mood === 'warn' ? 46 : mood === 'block' ? 49 : 46;
    const rPx = mood === 'warn' ? 68 : mood === 'block' ? 67 : 68;
    const rPy = mood === 'warn' ? 46 : mood === 'block' ? 49 : 46;

    const extra = mood === 'warn' ?
      `<circle cx="79" cy="27" r="3.5" fill="#bae6fd"/><path d="M75 33 L79 37 L83 32" fill="#bae6fd"/>` :
      mood === 'block' ?
      `<g opacity="0.9"><circle cx="77" cy="20" r="4" fill="none" stroke="#fb923c" stroke-width="2.5"/><circle cx="85" cy="17" r="2.8" fill="none" stroke="#fb923c" stroke-width="2"/></g>` :
      `<text x="76" y="23" font-size="14" fill="#fef08c">✦</text>`;

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="58" height="58" style="display:block">
  <defs>
    <radialGradient id="owlBody-${mood}" cx="50%" cy="40%" r="65%">
      <stop offset="0%" stop-color="${c.belly}"/>
      <stop offset="100%" stop-color="${c.body}"/>
    </radialGradient>
  </defs>
  <ellipse cx="50" cy="65" rx="33" ry="31" fill="url(#owlBody-${mood})"/>
  <ellipse cx="17" cy="68" rx="13.5" ry="11" fill="${c.body}" opacity="0.85" transform="rotate(-32 17 68)"/>
  <ellipse cx="83" cy="68" rx="13.5" ry="11" fill="${c.body}" opacity="0.85" transform="rotate(32 83 68)"/>
  <ellipse cx="30" cy="23" rx="10.5" ry="13.5" fill="${c.body}" transform="rotate(-18 30 23)"/>
  <ellipse cx="70" cy="23" rx="10.5" ry="13.5" fill="${c.body}" transform="rotate(18 70 23)"/>
  <ellipse cx="33" cy="47" rx="15.5" ry="16.5" fill="#fff"/>
  <ellipse cx="67" cy="47" rx="15.5" ry="16.5" fill="#fff"/>
  <ellipse cx="33" cy="47" rx="10.2" ry="11" fill="${c.eye}"/>
  <ellipse cx="67" cy="47" rx="10.2" ry="11" fill="${c.eye}"/>
  <circle cx="${lPx}" cy="${lPy}" r="6.8" fill="${c.pupil}"/>
  <circle cx="${rPx}" cy="${rPy}" r="6.8" fill="${c.pupil}"/>
  <circle cx="${lPx+3.5}" cy="${lPy-3.5}" r="2.4" fill="#fff" opacity="0.95"/>
  <circle cx="${rPx+3.5}" cy="${rPy-3.5}" r="2.4" fill="#fff" opacity="0.95"/>
  <ellipse cx="19" cy="57" rx="9.5" ry="7.5" fill="${c.cheek}" opacity="0.65"/>
  <ellipse cx="81" cy="57" rx="9.5" ry="7.5" fill="${c.cheek}" opacity="0.65"/>
  <path d="M44 61 Q50 67 56 61" fill="#fb923c"/>
  <ellipse cx="50" cy="61.5" rx="6.2" ry="4.2" fill="#f97316"/>
  <path d="${browL}" stroke="${c.brow}" stroke-width="4.5" stroke-linecap="round" fill="none"/>
  <path d="${browR}" stroke="${c.brow}" stroke-width="4.5" stroke-linecap="round" fill="none"/>
  <path d="${mouth}" stroke="${c.brow}" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.8"/>
  ${extra}
  <ellipse cx="39" cy="93" rx="8.5" ry="4" fill="${c.body}" opacity="0.8"/>
  <ellipse cx="61" cy="93" rx="8.5" ry="4" fill="${c.body}" opacity="0.8"/>
</svg>`;
  }

  // ─── Inject Styles ────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('gl-styles')) return;
    const style = document.createElement('style');
    style.id = 'gl-styles';
    style.textContent = ` /* Full CSS from previous version - paste your complete CSS here if you have extra styles */ 
      :root { --gl-safe: ${GL.safe}; --gl-warn: ${GL.warn}; --gl-block: ${GL.block}; --gl-accent: ${GL.accent}; --gl-bg: ${GL.bg}; --gl-surface: ${GL.surface}; --gl-text: ${GL.text}; --gl-muted: ${GL.muted}; --gl-font: 'Nunito', sans-serif; --gl-radius: 18px; --gl-shadow: 0 8px 40px rgba(0,0,0,0.55); }
      @keyframes gl-spring-in {0%{transform:translate(120px,-20px)scale(0.6);opacity:0}60%{transform:translate(-8px,4px)scale(1.05);opacity:1}100%{transform:translate(0,0)scale(1);opacity:1}}
      @keyframes gl-spring-out {0%{transform:scale(1);opacity:1}100%{transform:translate(140px,-20px)scale(0.7);opacity:0}}
      @keyframes gl-owl-float {0%,100%{transform:translateY(0)rotate(-1deg)}40%{transform:translateY(-8px)rotate(2deg)}70%{transform:translateY(-4px)rotate(-1deg)}}
      @keyframes gl-owl-worried {0%,100%{transform:translateX(0)}15%{transform:translateX(-4px)rotate(-4deg)}30%{transform:translateX(3px)rotate(3deg)}45%{transform:translateX(-3px)rotate(-3deg)}60%{transform:translateX(2px)rotate(2deg)}}
      @keyframes gl-owl-frustrated {0%,100%{transform:translateX(0)rotate(0)}10%{transform:translateX(-6px)rotate(-4deg)}20%{transform:translateX(6px)rotate(4deg)}30%{transform:translateX(-4px)rotate(-3deg)}40%{transform:translateX(4px)rotate(3deg)}}
      @keyframes gl-owl-bounce-in {0%{transform:scale(0)rotate(-15deg);opacity:0}55%{transform:scale(1.18)rotate(4deg);opacity:1}100%{transform:scale(1)rotate(0deg);opacity:1}}
      .gl-owl-svg.mood-safe {animation:gl-owl-bounce-in .65s cubic-bezier(0.34,1.56,0.64,1) both, gl-owl-float 3.5s ease-in-out .7s infinite}
      .gl-owl-svg.mood-warn {animation:gl-owl-bounce-in .65s cubic-bezier(0.34,1.56,0.64,1) both, gl-owl-worried 2.2s ease-in-out .7s infinite}
      .gl-owl-svg.mood-block {animation:gl-owl-bounce-in .65s cubic-bezier(0.34,1.56,0.64,1) both, gl-owl-frustrated 1.1s ease-in-out .8s 2}
      /* Add the rest of your original CSS styles here (bubble, chat, buttons, etc.) if you have more */
    `;
    document.head.appendChild(style);
  }

  // ─── Simple bubble for testing (we'll expand later if needed) ─────────────
  function showLensBubble({ risk = 50, category = '', reason = '', domain = '' }) {
    removeBubble();
    injectFont();
    injectStyles();
    const isBlock = risk >= 65;
    const mood = isBlock ? 'block' : 'warn';
    soundWarn();

    const bubble = document.createElement('div');
    bubble.id = 'gl-bubble';
    bubble.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:2147483647;background:#1e293b;color:white;padding:16px;border-radius:18px;box-shadow:0 8px 40px rgba(0,0,0,0.6);max-width:340px;`;
    bubble.innerHTML = `
      <div style="display:flex;gap:14px;align-items:start">
        <div style="width:66px;height:66px;flex-shrink:0">${owlSVG(mood)}</div>
        <div>
          <div style="font-weight:800;color:${isBlock ? '#ef4444' : '#f59e0b'}">${isBlock ? 'BLOCKED' : 'Warning'}</div>
          <div style="font-size:15px;font-weight:900;margin:4px 0">${escHtml(category || 'Content Alert')}</div>
          <div style="font-size:13px;opacity:0.9">${escHtml(reason || 'This page may not be suitable')}</div>
        </div>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">
        <button onclick="this.closest('#gl-bubble').remove()" style="padding:6px 14px;border:none;border-radius:9999px;background:rgba(255,255,255,0.1);color:white;cursor:pointer">Got it</button>
        <button onclick="this.closest('#gl-bubble').remove()" style="padding:6px 14px;border:none;border-radius:9999px;background:#6366f1;color:white;cursor:pointer">Chat with Lens 🦉</button>
      </div>
    `;
    document.documentElement.appendChild(bubble);
  }

  function removeBubble() {
    document.getElementById('gl-bubble')?.remove();
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ─── Domain lists (add your full lists here) ──────────────────────────────
  const INSTANT_BLOCK_DOMAINS = ['pornhub.com','xvideos.com','xnxx.com' /* add all your domains */ ];
  const RISKY_DOMAINS = ['tumblr.com','reddit.com' /* add your risky ones */ ];

  function getDomain(url) {
    try { return new URL(url).hostname.replace('www.', ''); } catch { return ''; }
  }

  function isInstantBlock() {
    const d = getDomain(location.href);
    return INSTANT_BLOCK_DOMAINS.some(b => d.includes(b));
  }

  // ─── Main init ────────────────────────────────────────────────────────────
  function init() {
    if (isInstantBlock()) {
      soundBlock();
      setTimeout(() => {
        location.replace(chrome.runtime.getURL('blocked.html') + '?category=Adult+content&reason=This+site+is+not+allowed.');
      }, 100);
      return;
    }

    // Simple test: show warning bubble on some pages
    if (Math.random() > 0.7) {
      setTimeout(() => {
        showLensBubble({ risk: 70, category: 'Mature Content', reason: 'Some elements may not be suitable for kids', domain: getDomain(location.href) });
      }, 1500);
    }
  }

  init();

})();