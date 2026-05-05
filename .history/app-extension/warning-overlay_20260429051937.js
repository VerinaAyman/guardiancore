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

    #gl-open-lens-btn {
      margin: 12px 20px 16px;
      width: calc(100% - 40px);
      padding: 12px;
      background: linear-gradient(135deg, #1d4ed8, #7c3aed);
      border: none;
      border-radius: 12px;
      color: white;
      font-family: 'Sora', sans-serif;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    #gl-open-lens-btn:hover { opacity: 0.85; }
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

    <button id='gl-open-lens-btn' type='button'>
      🛡️ Chat with GuardianLens
    </button>
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

  // ── Open GuardianLens chat ──
  document.getElementById('gl-open-lens-btn').addEventListener('click', () => {
    dismissOverlay();
    setTimeout(() => {
      const fab = document.getElementById('gl-lens-fab');
      if (fab) fab.click();
    }, 400);
  });

})();