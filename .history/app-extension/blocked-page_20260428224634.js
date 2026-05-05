// blocked-page.js — GuardianLens blocked page logic

// ── Audio ──
const AudioCtx = window.AudioContext || window.webkitAudioContext;
function playChime(type) {
  try {
    const ctx = new AudioCtx();
    const freqs = type === 'block' ? [523, 415, 370] : [523, 659, 784];
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine'; osc.frequency.value = f;
      gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.18);
      gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + i * 0.18 + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.35);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.36);
    });
  } catch(e) {}
}
function playPop() {
  try {
    const ctx = new AudioCtx(), osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine'; osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.13);
  } catch(e) {}
}

// ── Floating stars ──
const EMOJIS = ['⭐','✨','🌟','💫','🎈','🎵'];
function spawnStar() {
  const el = document.createElement('div');
  el.className = 'star';
  el.textContent = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
  el.style.left = Math.random() * 95 + 'vw';
  el.style.top  = (60 + Math.random() * 30) + 'vh';
  el.style.animationDelay = Math.random() * 2 + 's';
  el.style.animationDuration = (5 + Math.random() * 4) + 's';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 9000);
}
setInterval(spawnStar, 2200);

// ── Parse URL params ──
const params   = new URLSearchParams(location.search);
const category = params.get('category') || 'Restricted Content';
const reason   = params.get('reason')   || 'This content does not meet your family safety settings.';
const rawUrl   = params.get('url')      || document.referrer || 'Unknown';

document.getElementById('badgeCategory').textContent = category;
document.getElementById('infoCategory').textContent  = category;
document.getElementById('infoReason').textContent    = reason;
document.getElementById('infoUrl').textContent       = rawUrl;

// ── Parent notification ──
function notifyParent() {
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.sendMessage({ type: 'PAGE_BLOCKED', payload: { url: rawUrl, category, reason } });
  }
}

// ── Chat ──
const messagesEl = document.getElementById('chatMessages');
const history = [];

let siteDomain = rawUrl;
try { siteDomain = new URL(rawUrl).hostname.replace('www.', ''); } catch(e) {}

const SYSTEM_PROMPT = `You are GuardianLens, a warm and friendly AI assistant in a family safety browser extension for kids.

The child's browser just blocked this specific website:
- Full URL: ${rawUrl}
- Domain: ${siteDomain}
- Category: ${category}
- Reason: ${reason}

Your job on first message:
1. In 1-2 friendly sentences, explain why THIS specific site (${siteDomain}) was blocked. Be kind, not scary.
2. Then suggest exactly 3-5 safe alternatives that do the SAME thing as ${siteDomain}. Be specific to what the site does.
3. Format alternatives as markdown links: [Site Name](https://url.com) with a single emoji and short description.

For follow-up questions: answer warmly and helpfully. Never be preachy. Keep it short and fun.
Never suggest ${rawUrl} or any site in the same blocked category.`;

function addMsg(role, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  div.innerHTML = text.replace(/\n/g,'<br>').replace(
    /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>'
  );
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  if (role === 'bot') playPop();
}

function showTyping() {
  const div = document.createElement('div');
  div.className = 'typing'; div.id = 'typingIndicator';
  div.innerHTML = '<span></span><span></span><span></span>';
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}
function removeTyping() { document.getElementById('typingIndicator')?.remove(); }

async function callGL(userMsg) {
  history.push({ role: 'user', content: userMsg });
  showTyping();
  chrome.runtime.sendMessage({
    type: 'LENS_GROQ_REQUEST',
    payload: { system: SYSTEM_PROMPT, messages: history }
  }, (response) => {
    removeTyping();
    const reply = response?.reply || "I'm having trouble connecting. Try again!";
    history.push({ role: 'assistant', content: reply });
    addMsg('bot', reply);
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

// ── Event listeners (no inline handlers) ──
document.getElementById('sendChat').addEventListener('click', sendMessage);
document.getElementById('chatInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') sendMessage();
});

document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', function() {
    const q = this.dataset.q;
    addMsg('user', q);
    callGL(q);
    document.getElementById('quickChips').style.display = 'none';
  });
});

// ── Init ──
window.addEventListener('DOMContentLoaded', () => {
  playChime('block');
  notifyParent();
  setTimeout(() => {
    callGL(`I just landed on your blocked page. The site ${siteDomain} (${rawUrl}) was blocked for: ${category} — ${reason}. Please explain briefly why and suggest safe alternatives to ${siteDomain} specifically.`);
  }, 600);
});
