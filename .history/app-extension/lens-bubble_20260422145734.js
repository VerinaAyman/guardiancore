/**
 * lens-bubble.js — GuardianLens chatbot content script
 * Cute & cartoonish UI, safer alternatives, parent escalation
 */

(function () {
  'use strict';

  // ─── Config ────────────────────────────────────────────────────────────────
  const RISK_WARN_THRESHOLD     = 0.05;
  const RISK_ESCALATE_THRESHOLD = 0.85;

  // ─── State ──────────────────────────────────────────────────────────────────
  let chatOpen        = false;
  let chatHistory     = [];
  let currentContext  = null;
  let warningDismissed = false;

  // ─── Safer alternatives map ──────────────────────────────────────────────
  const SAFER_ALTERNATIVES = {
    'wattpad.com':       [{ name: 'Storybird', url: 'https://storybird.com', desc: 'Creative stories for kids' }, { name: 'FanFiction.net', url: 'https://www.fanfiction.net', desc: 'Fan fiction community' }],
    'tumblr.com':        [{ name: 'Blogger', url: 'https://www.blogger.com', desc: 'Simple & safe blogging' }, { name: 'WordPress.com', url: 'https://wordpress.com', desc: 'Build your own blog' }],
    'kotaku.com':        [{ name: 'Common Sense Media', url: 'https://www.commonsensemedia.org', desc: 'Safe game & movie reviews' }, { name: 'IGN Kids', url: 'https://www.ign.com', desc: 'Gaming news' }],
    'twitch.tv':         [{ name: 'YouTube Gaming', url: 'https://www.youtube.com/gaming', desc: 'Safe gaming videos' }, { name: 'PBS Kids', url: 'https://pbskids.org', desc: 'Fun & educational' }],
    '9gag.com':          [{ name: 'iFunny', url: 'https://ifunny.co', desc: 'Memes & fun' }, { name: 'Reddit Kids', url: 'https://www.reddit.com/r/aww', desc: 'Cute animal pics' }],
    'kik.com':           [{ name: 'Messenger Kids', url: 'https://messengerkids.com', desc: 'Safe messaging for kids' }],
    'tiktok.com':        [{ name: 'YouTube Kids', url: 'https://www.youtubekids.com', desc: 'Videos made for kids' }, { name: 'Nickelodeon', url: 'https://www.nick.com', desc: 'Fun shows & games' }],
    'default':           [{ name: 'Wikipedia', url: 'https://en.wikipedia.org', desc: 'Learn anything safely' }, { name: 'Khan Academy', url: 'https://www.khanacademy.org', desc: 'Free learning for everyone' }]
  };

  function getAlternatives(domain) {
    const key = Object.keys(SAFER_ALTERNATIVES).find(k => domain.includes(k));
    return SAFER_ALTERNATIVES[key] || SAFER_ALTERNATIVES['default'];
  }

  // ─── System prompt ──────────────────────────────────────────────────────────
  function buildSystemPrompt(ctx) {
    const alts = ctx ? getAlternatives(ctx.domain) : [];
    const altText = alts.map(a => `${a.name} (${a.url})`).join(', ');

    if (!ctx) {
      return `You are GuardianLens, a super friendly AI buddy built into a kids' safety extension for ages 6–16 in Egypt. You are warm, fun, and always on the kid's side. Keep responses to 2–3 sentences max.`;
    }
    return `You are GuardianLens, a super friendly AI safety buddy for kids aged 6–16 in Egypt.

WHAT YOU SAW:
- Website: ${ctx.domain}
- Risk type: ${ctx.category}
- Risk level: ${Math.round(ctx.risk * 100)}/100
- What was found: ${ctx.summary}

SAFER ALTERNATIVES TO SUGGEST (only if they ask or if it helps): ${altText}

YOUR VIBE:
- You're the kid's cool older friend, not a cop or teacher.
- Use light slang (no cap, fr, ngl, bestie) only when it fits.
- SHORT messages: 2–3 sentences MAXIMUM. Kids don't read walls.
- Never lecture. Never shame. Never repeat yourself.
- Ask what THEY think — give them real agency.
- If they give a good reason for being on the page, respect it and just share a tip.
- Only mention escalating to parents if content is genuinely harmful AND they keep insisting.
- When suggesting alternatives, make them sound fun and relevant, not like a punishment.

NEVER: describe graphic content, threaten, use bullet points, write more than 3 sentences.

Respond ONLY as GuardianLens.`;
  }

  // ─── Groq via background.js ──────────────────────────────────────────────
  async function askLens(userMessage) {
    if (userMessage) chatHistory.push({ role: 'user', content: userMessage });
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'LENS_GROQ_REQUEST',
        systemPrompt: buildSystemPrompt(currentContext),
        history: chatHistory
      }, (response) => {
        if (chrome.runtime.lastError || !response?.reply) {
          resolve("Oops, I had a little hiccup! Try again in a sec 🌀");
          return;
        }
        chatHistory.push({ role: 'assistant', content: response.reply });
        resolve(response.reply);
      });
    });
  }

  // ─── Logging ─────────────────────────────────────────────────────────────
  function logDismiss() {
    if (!currentContext) return;
    chrome.runtime.sendMessage({
      type: 'LENS_WARNING_DISMISSED',
      domain: currentContext.domain,
      category: currentContext.category,
      risk: currentContext.risk,
      url: window.location.href
    });
  }

  // ─── Google Fonts ────────────────────────────────────────────────────────
  function injectFonts() {
    if (document.getElementById('lens-fonts')) return;
    const link = document.createElement('link');
    link.id = 'lens-fonts';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap';
    document.head.appendChild(link);
  }

  // ─── Styles ─────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('lens-styles')) return;
    const style = document.createElement('style');
    style.id = 'lens-styles';
    style.textContent = `
      /* ── Bubble ── */
      #lens-bubble {
        position: fixed;
        bottom: 22px;
        right: 22px;
        width: 58px;
        height: 58px;
        border-radius: 50%;
        background: linear-gradient(135deg, #7C6FFF 0%, #B06EFF 100%);
        box-shadow: 0 6px 20px rgba(124,111,255,0.5), 0 0 0 3px #fff;
        cursor: pointer;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 26px;
        border: none;
        transition: transform 0.2s cubic-bezier(.34,1.56,.64,1), box-shadow 0.2s;
        font-family: 'Nunito', system-ui, sans-serif;
      }
      #lens-bubble:hover {
        transform: scale(1.12) rotate(-5deg);
        box-shadow: 0 8px 28px rgba(124,111,255,0.6), 0 0 0 3px #fff;
      }
      #lens-bubble.warn {
        background: linear-gradient(135deg, #FF8C42 0%, #FFD166 100%);
        box-shadow: 0 6px 20px rgba(255,140,66,0.55), 0 0 0 3px #fff;
        animation: lens-bounce 0.6s cubic-bezier(.34,1.56,.64,1) 3;
      }
      #lens-bubble.escalate {
        background: linear-gradient(135deg, #FF4E6A 0%, #FF8E53 100%);
        box-shadow: 0 6px 20px rgba(255,78,106,0.6), 0 0 0 3px #fff;
        animation: lens-shake 0.5s ease-in-out infinite;
      }
      @keyframes lens-bounce {
        0%,100% { transform: scale(1); }
        40% { transform: scale(1.22) rotate(-6deg); }
        70% { transform: scale(0.95) rotate(3deg); }
      }
      @keyframes lens-shake {
        0%,100% { transform: translateX(0); }
        25% { transform: translateX(-4px) rotate(-3deg); }
        75% { transform: translateX(4px) rotate(3deg); }
      }

      /* ── Badge ── */
      #lens-badge {
        position: fixed;
        bottom: 82px;
        right: 18px;
        background: linear-gradient(135deg, #FF8C42, #FFD166);
        color: #fff;
        font-size: 11px;
        font-weight: 900;
        padding: 4px 10px;
        border-radius: 20px;
        z-index: 2147483647;
        font-family: 'Nunito', system-ui, sans-serif;
        pointer-events: none;
        opacity: 0;
        transform: translateY(6px) scale(0.9);
        transition: opacity 0.25s, transform 0.25s cubic-bezier(.34,1.56,.64,1);
        box-shadow: 0 3px 10px rgba(255,140,66,0.4);
      }
      #lens-badge.show { opacity: 1; transform: translateY(0) scale(1); }

      /* ── Panel ── */
      #lens-panel {
        position: fixed;
        bottom: 94px;
        right: 18px;
        width: 330px;
        max-height: 500px;
        background: #FEFCFF;
        border-radius: 24px;
        box-shadow: 0 12px 48px rgba(124,111,255,0.22), 0 2px 8px rgba(0,0,0,0.08);
        z-index: 2147483647;
        display: none;
        flex-direction: column;
        overflow: hidden;
        font-family: 'Nunito', system-ui, sans-serif;
        border: 2px solid rgba(124,111,255,0.12);
        transform-origin: bottom right;
      }
      #lens-panel.open {
        display: flex;
        animation: lens-pop-in 0.3s cubic-bezier(.34,1.56,.64,1);
      }
      @keyframes lens-pop-in {
        from { opacity: 0; transform: scale(0.85) translateY(12px); }
        to   { opacity: 1; transform: scale(1) translateY(0); }
      }
      #lens-panel.warn-mode  .lens-topbar { background: linear-gradient(135deg, #FF8C42 0%, #FFD166 100%); }
      #lens-panel.escalate-mode .lens-topbar { background: linear-gradient(135deg, #FF4E6A 0%, #FF8E53 100%); }

      /* ── Topbar ── */
      .lens-topbar {
        background: linear-gradient(135deg, #7C6FFF 0%, #B06EFF 100%);
        padding: 13px 14px 11px;
        display: flex;
        align-items: center;
        gap: 10px;
        flex-shrink: 0;
        transition: background 0.4s;
        position: relative;
        overflow: hidden;
      }
      .lens-topbar::before {
        content: '⭐ 🌟 ✨';
        position: absolute;
        right: -8px;
        top: -6px;
        font-size: 28px;
        opacity: 0.18;
        letter-spacing: 2px;
        pointer-events: none;
      }
      .lens-av {
        width: 38px; height: 38px; border-radius: 50%;
        background: rgba(255,255,255,0.25);
        display: flex; align-items: center; justify-content: center;
        font-size: 20px; flex-shrink: 0;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        border: 2px solid rgba(255,255,255,0.4);
      }
      .lens-meta { flex: 1; }
      .lens-name {
        font-size: 13.5px; font-weight: 900; color: #fff;
        line-height: 1.2; letter-spacing: -0.2px;
        text-shadow: 0 1px 3px rgba(0,0,0,0.2);
      }
      .lens-sub { font-size: 10px; color: rgba(255,255,255,0.8); font-weight: 600; }
      .lens-close {
        background: rgba(255,255,255,0.2); border: none; color: #fff;
        font-size: 14px; cursor: pointer; padding: 5px 7px;
        line-height: 1; border-radius: 50%; transition: background 0.15s;
        width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
      }
      .lens-close:hover { background: rgba(255,255,255,0.35); }

      /* ── Chat area ── */
      .lens-chat {
        flex: 1;
        overflow-y: auto;
        padding: 14px 10px 10px;
        display: flex;
        flex-direction: column;
        gap: 9px;
        background: linear-gradient(180deg, #F5F3FF 0%, #FFF9F0 100%);
        min-height: 180px;
        max-height: 290px;
      }
      .lens-chat::-webkit-scrollbar { width: 3px; }
      .lens-chat::-webkit-scrollbar-thumb { background: rgba(124,111,255,0.2); border-radius: 4px; }

      /* ── Messages ── */
      .lens-row { display: flex; gap: 6px; align-items: flex-end; }
      .lens-row.bot { flex-direction: row; }
      .lens-row.user { flex-direction: row-reverse; }
      .lens-row-av {
        width: 28px; height: 28px; border-radius: 50%;
        background: linear-gradient(135deg, #EDE9FF, #F3E8FF);
        display: flex; align-items: center; justify-content: center;
        font-size: 14px; flex-shrink: 0;
        border: 1.5px solid rgba(124,111,255,0.2);
      }
      .lens-bub {
        max-width: 80%; padding: 9px 13px;
        font-size: 13px; line-height: 1.55;
        border-radius: 18px; word-break: break-word;
        font-weight: 600;
      }
      .lens-row.bot .lens-bub {
        background: #fff; color: #2D1F5E;
        border-bottom-left-radius: 5px;
        box-shadow: 0 2px 8px rgba(124,111,255,0.1);
        border: 1.5px solid rgba(124,111,255,0.1);
      }
      .lens-row.user .lens-bub {
        background: linear-gradient(135deg, #7C6FFF, #B06EFF);
        color: #fff;
        border-bottom-right-radius: 5px;
        box-shadow: 0 2px 8px rgba(124,111,255,0.3);
      }

      /* ── Alternatives card ── */
      .lens-alts {
        background: linear-gradient(135deg, #F0EDFF, #FFF4E8);
        border: 1.5px solid rgba(124,111,255,0.18);
        border-radius: 16px;
        padding: 10px 12px;
        max-width: 88%;
        margin-top: 2px;
      }
      .lens-alts-title {
        font-size: 10px; font-weight: 900; color: #7C6FFF;
        text-transform: uppercase; letter-spacing: 0.7px;
        margin-bottom: 7px;
      }
      .lens-alt-item {
        display: flex; align-items: center; gap: 8px;
        padding: 6px 8px; border-radius: 10px;
        background: #fff; margin-bottom: 5px;
        cursor: pointer; transition: transform 0.15s, box-shadow 0.15s;
        text-decoration: none;
        border: 1px solid rgba(124,111,255,0.1);
      }
      .lens-alt-item:last-child { margin-bottom: 0; }
      .lens-alt-item:hover { transform: translateX(3px); box-shadow: 0 3px 10px rgba(124,111,255,0.15); }
      .lens-alt-icon { font-size: 16px; flex-shrink: 0; }
      .lens-alt-info { flex: 1; }
      .lens-alt-name { font-size: 12px; font-weight: 800; color: #2D1F5E; }
      .lens-alt-desc { font-size: 10px; color: #8B8BA7; font-weight: 600; }
      .lens-alt-arrow { font-size: 12px; color: #7C6FFF; font-weight: 900; }

      /* ── Warning dismiss bar ── */
      .lens-dismiss-bar {
        background: linear-gradient(135deg, #FFF8EC, #FFFBF0);
        border-top: 2px solid rgba(255,140,66,0.18);
        padding: 9px 12px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-shrink: 0;
        gap: 8px;
      }
      .lens-dismiss-text { font-size: 11px; color: #9C4A0A; flex: 1; font-weight: 700; }
      .lens-dismiss-btn {
        font-size: 11px; font-weight: 900;
        color: #fff;
        background: linear-gradient(135deg, #FF8C42, #FFD166);
        border: none;
        border-radius: 20px;
        padding: 5px 12px;
        cursor: pointer;
        white-space: nowrap;
        transition: transform 0.15s, box-shadow 0.15s;
        box-shadow: 0 3px 8px rgba(255,140,66,0.3);
      }
      .lens-dismiss-btn:hover { transform: scale(1.05); box-shadow: 0 4px 12px rgba(255,140,66,0.45); }

      /* ── Escalate card ── */
      .lens-escalate-card {
        background: linear-gradient(135deg, #FFF0F3, #FFF5F0);
        border: 2px solid rgba(255,78,106,0.25);
        border-radius: 16px; padding: 11px 13px;
        font-size: 13px; line-height: 1.5; max-width: 88%;
        box-shadow: 0 3px 12px rgba(255,78,106,0.12);
      }
      .lens-escalate-tag {
        font-size: 10px; font-weight: 900; color: #FF4E6A;
        text-transform: uppercase; letter-spacing: 0.7px;
        margin-bottom: 5px; display: flex; align-items: center; gap: 4px;
      }
      .lens-escalate-body { color: #7A0020; font-weight: 600; font-size: 12.5px; }

      /* ── Typing dots ── */
      .lens-typing {
        display: flex; gap: 5px; align-items: center;
        background: #fff;
        border: 1.5px solid rgba(124,111,255,0.1);
        border-radius: 18px; border-bottom-left-radius: 5px;
        padding: 11px 15px; max-width: 64px;
        box-shadow: 0 2px 8px rgba(124,111,255,0.1);
      }
      .lens-typing span {
        width: 7px; height: 7px; border-radius: 50%;
        background: linear-gradient(135deg, #7C6FFF, #B06EFF);
        animation: lens-blink 1.2s infinite;
      }
      .lens-typing span:nth-child(2) { animation-delay: 0.2s; }
      .lens-typing span:nth-child(3) { animation-delay: 0.4s; }
      @keyframes lens-blink { 0%,80%,100%{opacity:0.25; transform:scale(0.85);} 40%{opacity:1; transform:scale(1.1);} }

      /* ── Input bar ── */
      .lens-inputbar {
        background: #fff;
        border-top: 1.5px solid rgba(124,111,255,0.1);
        padding: 9px 10px;
        display: flex;
        gap: 7px;
        align-items: center;
        flex-shrink: 0;
      }
      .lens-input {
        flex: 1;
        background: #F5F3FF;
        border: 2px solid rgba(124,111,255,0.15);
        border-radius: 20px;
        padding: 8px 14px;
        font-size: 13px;
        font-family: 'Nunito', system-ui, sans-serif;
        font-weight: 600;
        color: #2D1F5E;
        outline: none;
        transition: border 0.15s, box-shadow 0.15s;
      }
      .lens-input:focus {
        border-color: #7C6FFF;
        box-shadow: 0 0 0 3px rgba(124,111,255,0.12);
      }
      .lens-input::placeholder { color: #B8B4D8; }
      .lens-send {
        width: 36px; height: 36px; border-radius: 50%;
        background: linear-gradient(135deg, #7C6FFF, #B06EFF);
        border: none;
        cursor: pointer; display: flex; align-items: center; justify-content: center;
        flex-shrink: 0; transition: transform 0.15s, box-shadow 0.15s;
        color: #fff; font-size: 15px;
        box-shadow: 0 3px 10px rgba(124,111,255,0.35);
      }
      .lens-send:hover { transform: scale(1.1); box-shadow: 0 5px 14px rgba(124,111,255,0.5); }
      .lens-send:disabled { opacity: 0.4; pointer-events: none; }

      /* ── Stars decoration ── */
      .lens-stars {
        position: absolute;
        pointer-events: none;
        font-size: 10px;
        opacity: 0;
        animation: lens-star-pop 1s ease-out forwards;
      }
      @keyframes lens-star-pop {
        0%   { opacity: 0; transform: translateY(0) scale(0.5); }
        50%  { opacity: 1; transform: translateY(-18px) scale(1.2); }
        100% { opacity: 0; transform: translateY(-32px) scale(0.8); }
      }
    `;
    document.head.appendChild(style);
  }

  // ─── Build UI ────────────────────────────────────────────────────────────────
  function buildPanel() {
    if (document.getElementById('lens-bubble')) return;

    const bubble = document.createElement('button');
    bubble.id = 'lens-bubble';
    bubble.innerHTML = '🦉';
    bubble.setAttribute('aria-label', 'Open GuardianLens safety buddy');
    bubble.onclick = togglePanel;
    document.body.appendChild(bubble);

    const badge = document.createElement('div');
    badge.id = 'lens-badge';
    badge.textContent = 'hey! 👀';
    document.body.appendChild(badge);

    const panel = document.createElement('div');
    panel.id = 'lens-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'GuardianLens safety chat');
    panel.innerHTML = `
      <div class="lens-topbar">
        <div class="lens-av">🦉</div>
        <div class="lens-meta">
          <div class="lens-name">GuardianLens ✨</div>
          <div class="lens-sub" id="lens-sub">your web buddy 🛡️</div>
        </div>
        <button class="lens-close" aria-label="Close" id="lens-close-btn">✕</button>
      </div>
      <div class="lens-chat" id="lens-chat"></div>
      <div class="lens-inputbar">
        <input class="lens-input" id="lens-input" type="text" placeholder="Chat with Lens… 💬" autocomplete="off" />
        <button class="lens-send" id="lens-send" aria-label="Send">➤</button>
      </div>
    `;
    document.body.appendChild(panel);

    document.getElementById('lens-close-btn').addEventListener('click', () => {
      if (currentContext && currentContext.risk >= RISK_WARN_THRESHOLD &&
          currentContext.risk < RISK_ESCALATE_THRESHOLD && !warningDismissed) {
        logDismiss();
        warningDismissed = true;
      }
      chatOpen = false;
      panel.classList.remove('open');
    });

    document.getElementById('lens-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendMessage();
    });
    document.getElementById('lens-send').addEventListener('click', sendMessage);
  }

  function togglePanel() {
    const panel = document.getElementById('lens-panel');
    chatOpen = !chatOpen;
    panel.classList.toggle('open', chatOpen);
    if (chatOpen) {
      document.getElementById('lens-badge').classList.remove('show');
      document.getElementById('lens-input')?.focus();
    } else {
      if (currentContext && currentContext.risk >= RISK_WARN_THRESHOLD &&
          currentContext.risk < RISK_ESCALATE_THRESHOLD && !warningDismissed) {
        logDismiss();
        warningDismissed = true;
      }
    }
  }

  // ─── Safer alternatives card ─────────────────────────────────────────────
  function addAlternativesCard(domain) {
    const chat = document.getElementById('lens-chat');
    if (!chat) return;
    const alts = getAlternatives(domain);
    const altIcons = ['🌟', '🎯', '🚀'];
    const row = document.createElement('div');
    row.className = 'lens-row bot';
    const items = alts.map((a, i) => `
      <a class="lens-alt-item" href="${a.url}" target="_blank" rel="noopener noreferrer">
        <span class="lens-alt-icon">${altIcons[i] || '✨'}</span>
        <div class="lens-alt-info">
          <div class="lens-alt-name">${a.name}</div>
          <div class="lens-alt-desc">${a.desc}</div>
        </div>
        <span class="lens-alt-arrow">→</span>
      </a>
    `).join('');
    row.innerHTML = `
      <div class="lens-row-av">🦉</div>
      <div class="lens-alts">
        <div class="lens-alts-title">✨ Try these instead!</div>
        ${items}
      </div>
    `;
    chat.appendChild(row);
    scrollChat();
  }

  // ─── Dismiss bar ─────────────────────────────────────────────────────────
  function injectDismissBar() {
    document.getElementById('lens-dismiss-bar')?.remove();
    const bar = document.createElement('div');
    bar.className = 'lens-dismiss-bar';
    bar.id = 'lens-dismiss-bar';
    bar.innerHTML = `
      <span class="lens-dismiss-text">🟡 You can still stay here.</span>
      <button class="lens-dismiss-btn" id="lens-dismiss-btn">Got it, continue ✌️</button>
    `;
    const panel = document.getElementById('lens-panel');
    const inputBar = panel.querySelector('.lens-inputbar');
    panel.insertBefore(bar, inputBar);

    document.getElementById('lens-dismiss-btn').addEventListener('click', () => {
      logDismiss();
      warningDismissed = true;
      bar.remove();
      chatOpen = false;
      document.getElementById('lens-panel').classList.remove('open');
      const bubble = document.getElementById('lens-bubble');
      if (bubble) { bubble.className = ''; bubble.innerHTML = '🦉'; }
    });
  }

  // ─── Chat helpers ────────────────────────────────────────────────────────────
  function scrollChat() {
    const c = document.getElementById('lens-chat');
    if (c) c.scrollTop = c.scrollHeight;
  }

  function addBotMessage(text, escalate = false) {
    const chat = document.getElementById('lens-chat');
    if (!chat) return;
    const row = document.createElement('div');
    row.className = 'lens-row bot';
    if (escalate) {
      row.innerHTML = `<div class="lens-row-av">🦉</div>
        <div class="lens-escalate-card">
          <div class="lens-escalate-tag">🚨 Letting your parents know</div>
          <div class="lens-escalate-body">${text}</div>
        </div>`;
    } else {
      row.innerHTML = `<div class="lens-row-av">🦉</div>
        <div class="lens-bub">${text.replace(/\n/g, '<br>')}</div>`;
    }
    chat.appendChild(row);
    scrollChat();
  }

  function addUserMessage(text) {
    const chat = document.getElementById('lens-chat');
    if (!chat) return;
    const row = document.createElement('div');
    row.className = 'lens-row user';
    row.innerHTML = `<div class="lens-bub">${text}</div>`;
    chat.appendChild(row);
    scrollChat();
  }

  function showTyping() {
    const chat = document.getElementById('lens-chat');
    if (!chat) return;
    const row = document.createElement('div');
    row.className = 'lens-row bot';
    row.id = 'lens-typing-row';
    row.innerHTML = `<div class="lens-row-av">🦉</div>
      <div class="lens-typing"><span></span><span></span><span></span></div>`;
    chat.appendChild(row);
    scrollChat();
  }

  function removeTyping() {
    document.getElementById('lens-typing-row')?.remove();
  }

  function setLock(locked) {
    const inp = document.getElementById('lens-input');
    const btn = document.getElementById('lens-send');
    if (inp) inp.disabled = locked;
    if (btn) btn.disabled = locked;
  }

  // ─── Send message ────────────────────────────────────────────────────────
  async function sendMessage() {
    const inp = document.getElementById('lens-input');
    if (!inp) return;
    const text = inp.value.trim();
    if (!text) return;
    inp.value = '';
    addUserMessage(text);
    setLock(true);
    showTyping();
    const reply = await askLens(text);
    removeTyping();
    addBotMessage(reply);
    setLock(false);

    // Show alternatives if kid asks or after 2 exchanges in a warn state
    const isAskingForAlts = /alternative|instead|other|suggest|different/i.test(text);
    if (currentContext && isAskingForAlts) {
      addAlternativesCard(currentContext.domain);
    }
  }

  // ─── Main trigger ─────────────────────────────────────────────────────────────
  async function triggerLens(ctx) {
    currentContext = ctx;
    chatHistory    = [];
    warningDismissed = false;

    const bubble = document.getElementById('lens-bubble');
    const badge  = document.getElementById('lens-badge');
    const panel  = document.getElementById('lens-panel');
    const chat   = document.getElementById('lens-chat');
    const sub    = document.getElementById('lens-sub');
    if (!bubble || !panel || !chat) return;

    chat.innerHTML = '';
    document.getElementById('lens-dismiss-bar')?.remove();
    panel.classList.remove('warn-mode', 'escalate-mode');

    // ── ESCALATE ──────────────────────────────────────────────────────────
    if (ctx.risk >= RISK_ESCALATE_THRESHOLD) {
      bubble.className = 'escalate';
      bubble.innerHTML = '🚨';
      badge.textContent = 'uh oh!';
      badge.classList.add('show');
      panel.classList.add('escalate-mode');
      if (sub) sub.textContent = 'heads up! ⚠️';

      chrome.runtime.sendMessage({
        type: 'LENS_ESCALATE',
        domain: ctx.domain,
        category: ctx.category,
        url: window.location.href
      });

      chatOpen = true;
      panel.classList.add('open');
      addBotMessage(
        "Hey, I need to pause you here 💛 This page has stuff that's way too intense for your age. I've already let your parents know — you're not in trouble at all, I just care about you!",
        true
      );

      // Show alternatives after escalation
      setTimeout(() => addAlternativesCard(ctx.domain), 600);
      return;
    }

    // ── WARN ──────────────────────────────────────────────────────────────
    if (ctx.risk >= RISK_WARN_THRESHOLD) {
      bubble.className = 'warn';
      bubble.innerHTML = '👀';
      badge.textContent = 'hey! 👀';
      badge.classList.add('show');
      panel.classList.add('warn-mode');
      if (sub) sub.textContent = 'just a heads up!';

      setTimeout(async () => {
        chatOpen = true;
        panel.classList.add('open');
        setLock(true);
        showTyping();
        const opening = await askLens(null);
        removeTyping();
        addBotMessage(opening);
        setLock(false);
        injectDismissBar();

        // Auto-show alternatives after Lens opening message
        setTimeout(() => addAlternativesCard(ctx.domain), 400);
      }, 600);
    }
  }

  // ─── Listen for messages from background.js ───────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'LENS_TRIGGER') {
      triggerLens({
        risk:     msg.risk,
        category: msg.category || 'General concern',
        summary:  msg.reason || msg.summary || 'Potentially inappropriate content detected.',
        domain:   msg.domain || window.location.hostname
      });
    }
  });

  // ─── Init ─────────────────────────────────────────────────────────────────────
  injectFonts();
  injectStyles();
  buildPanel();

})();