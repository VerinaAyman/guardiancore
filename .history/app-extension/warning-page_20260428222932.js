// warning-page.js — GuardianLens warning page logic

(function () {
  'use strict';

  // ── Audio ──
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  function playWarn() {
    try {
      const ctx = new AudioCtx();
      [523, 587].forEach((f, i) => {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sine'; osc.frequency.value = f;
        gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.22);
        gain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + i * 0.22 + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.22 + 0.3);
        osc.start(ctx.currentTime + i * 0.22);
        osc.stop(ctx.currentTime + i * 0.22 + 0.31);
      });
    } catch (e) {}
  }
  function playPop() {
    try {
      const ctx = new AudioCtx(), osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine'; osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.13);
    } catch (e) {}
  }

  // floating stars
  const EMOJIS = ['⭐', '✨', '🌟', '💫', '🎵', '🎈'];
  function spawnStar() {
    const el = document.createElement('div');
    el.className = 'star';
    el.textContent = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
    el.style.left = Math.random() * 95 + 'vw';
    el.style.top = (60 + Math.random() * 30) + 'vh';
    el.style.animationDelay = Math.random() * 2 + 's';
    el.style.animationDuration = (5 + Math.random() * 4) + 's';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 9000);
  }
  setInterval(spawnStar, 2800);

  // ── Params ──
  const params = new URLSearchParams(location.search);
  const category = params.get('category') || 'Caution';
  const reason = params.get('reason') || 'This page may contain content that needs a second look.';
  const rawUrl = params.get('url') || document.referrer || 'Unknown';
  const proceedUrl = params.get('proceed') || rawUrl;

  let siteDomain = rawUrl;
  try { siteDomain = new URL(rawUrl).hostname.replace('www.', ''); } catch (e) {}

  document.getElementById('badgeCategory').textContent = category;
  document.getElementById('infoReason').textContent = reason;
  document.getElementById('infoUrl').textContent = rawUrl.length > 60 ? rawUrl.slice(0, 60) + '…' : rawUrl;

  // ── Countdown (3s) ──
  let countdown = 3;
  const ringFill = document.getElementById('ringFill');
  const countNum = document.getElementById('countNum');
  const proceedBtn = document.getElementById('proceedBtn');
  const circumference = 63.6;
  ringFill.style.strokeDashoffset = 0;

  const timer = setInterval(() => {
    countdown--;
    countNum.textContent = countdown;
    ringFill.style.strokeDashoffset = circumference * (1 - countdown / 3);
    if (countdown <= 0) {
      clearInterval(timer);
      proceedBtn.disabled = false;
      proceedBtn.classList.add('ready');
      countNum.textContent = '✓';
      ringFill.style.stroke = 'var(--ok)';
      playPop();
    }
  }, 1000);

  function proceedToSite() {
    if (!proceedBtn.classList.contains('ready')) return;
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ type: 'WARN_PROCEED', payload: { url: rawUrl, category, reason } });
    }
    window.location.href = proceedUrl;
  }

  function scrollToChat() {
    document.getElementById('chatSection').scrollIntoView({ behavior: 'smooth' });
    playPop();
  }

  // ── Chat ──
  const messagesEl = document.getElementById('chatMessages');
  const history = [];

  const SYSTEM_PROMPT = `You are GuardianLens, a warm and friendly AI assistant in a family safety browser extension for kids.

The child's browser showed a WARNING (not a block) for this specific website:
- Full URL: ${rawUrl}
- Domain: ${siteDomain}
- Category: ${category}
- Reason: ${reason}

The child CAN still proceed to the site — this is a warning, not a block.

Your job:
1. In 1-2 friendly sentences, explain why ${siteDomain} triggered a warning. Be kind and non-scary.
2. Give your honest assessment — is this site probably fine or should they be careful?
3. Suggest 3 safe alternatives that do the same thing as ${siteDomain}, in case they'd prefer those.
4. Format alternatives as: [Site Name](https://url.com) — emoji + short description.

For follow-up questions: be warm, helpful, honest. Never lecture. Keep it short.`;

  function addMsg(role, text) {
    const div = document.createElement('div');
    div.className = 'msg ' + role;
    div.innerHTML = text.replace(/\n/g, '<br>').replace(
      /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>'
    );
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    if (role === 'bot') playPop();
  }
  function showTyping() {
    const div = document.createElement('div');
    div.className = 'typing'; div.id = 'typingIndicator'; div.innerHTML = '<span></span><span></span><span></span>';
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  function removeTyping() { document.getElementById('typingIndicator')?.remove(); }

  function callGL(userMsg) {
    history.push({ role: 'user', content: userMsg });
    showTyping();
    chrome.runtime.sendMessage({ type: 'LENS_GROQ_REQUEST', systemPrompt: SYSTEM_PROMPT, history }, (response) => {
      removeTyping();
      if (chrome.runtime.lastError || !response?.reply) {
        addMsg('bot', 'I had a little hiccup — try again in a sec!');
        return;
      }
      history.push({ role: 'assistant', content: response.reply });
      addMsg('bot', response.reply);
    });
  }

  function sendMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    addMsg('user', text);
    callGL(text);
  }
  function sendChip(text) {
    addMsg('user', text);
    callGL(text);
    document.getElementById('quickChips').style.display = 'none';
  }

  document.querySelectorAll('#quickChips .chip').forEach((chip) => {
    chip.addEventListener('click', () => sendChip(chip.dataset.q || chip.textContent.trim()));
  });

  document.getElementById('proceedBtn').addEventListener('click', proceedToSite);
  document.getElementById('chatScrollBtn').addEventListener('click', scrollToChat);
  document.getElementById('chatInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') sendMessage();
  });
  document.getElementById('sendChat').addEventListener('click', sendMessage);

  window.addEventListener('DOMContentLoaded', () => {
    playWarn();
    setTimeout(() => {
      callGL(`I just landed on your warning page. The site ${siteDomain} (${rawUrl}) triggered a warning for: ${category} — ${reason}. Please explain what this means and whether I should be careful, and suggest safe alternatives to ${siteDomain} if I'd prefer those.`);
    }, 600);
  });
})();
