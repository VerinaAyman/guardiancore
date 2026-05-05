// blocked-page.js — GuardianLens blocked page logic

// ── Audio ──
const AudioCtx = window.AudioContext || window.webkitAudioContext;

function playChime(type) {
  try {
    const ctx = new AudioCtx();
    const freqs = type === 'block' ? [523, 415, 370] : [523, 659, 784];
    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.18);
      gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + i * 0.18 + 0.05);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + i * 0.18 + 0.4);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.5);
    });
  } catch (e) { /* audio not available */ }
}

function playPop() {
  try {
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.12);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.15);
  } catch (e) { /* audio not available */ }
}

// ── Stars ──
function spawnStars() {
  const container = document.getElementById('stars');
  if (!container) return;
  for (let i = 0; i < 60; i++) {
    const s = document.createElement('div');
    s.className = 'star';
    const size = Math.random() * 2.5 + 1;
    s.style.cssText = `
      width:${size}px; height:${size}px;
      left:${Math.random() * 100}%;
      top:${Math.random() * 100}%;
      --d:${(Math.random() * 4 + 2).toFixed(1)}s;
      --del:-${(Math.random() * 4).toFixed(1)}s;
      --op:${(Math.random() * 0.5 + 0.2).toFixed(2)};
    `;
    container.appendChild(s);
  }
}

// ── Parse URL params ──
function getParam(name) {
  try {
    return decodeURIComponent(
      (new URLSearchParams(window.location.search)).get(name) || ''
    );
  } catch (e) {
    return '';
  }
}

const rawUrl  = getParam('url');
const category = getParam('category');
const reason  = getParam('reason');

// ── Fill in the info card ──
function fillInfo() {
  const catEl = document.getElementById('infoCategory');
  const rsnEl = document.getElementById('infoReason');
  const urlEl = document.getElementById('infoUrl');

  if (catEl) catEl.textContent = category || 'Unknown';
  if (rsnEl) rsnEl.textContent = reason   || 'Policy violation';
  if (urlEl) urlEl.textContent = rawUrl   || 'Unknown URL';
}

// ── Parent notification ──
function notifyParent() {
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.sendMessage({
      type: 'PAGE_BLOCKED',
      payload: { url: rawUrl, category, reason }
    });
  }
}

// ── Chat ──
const messagesEl = document.getElementById('chatMessages');
const history = [];

let siteDomain = rawUrl;
try { siteDomain = new URL(rawUrl).hostname.replace('www.', ''); } catch (e) {}

const SYSTEM_PROMPT = `You are GuardianLens, a warm and friendly AI assistant in a family safety browser extension for kids. The child's browser just blocked this specific website:
- Full URL: ${rawUrl}
- Domain: ${siteDomain}
- Category: ${category}
- Reason: ${reason}

Your job on the first message:
1. In 1-2 friendly sentences, explain why THIS specific site (${siteDomain}) was blocked. Be kind, not scary.
2. Then suggest exactly 3-5 safe alternatives that do the SAME thing as ${siteDomain}. If it's a game site, suggest similar safe game sites. If it's a video site, suggest safe video sites. Etc.
3. Format alternatives as markdown links: [Site Name](https://url.com) — one per line, with a single emoji and a 5-word description.

For follow-up questions: answer warmly and helpfully. Never be preachy. Keep it short and fun. Never suggest ${rawUrl} or any site in the same blocked category.`;

function addMsg(role, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  // Convert markdown links to real anchor tags
  const html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );
  div.innerHTML = html;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  if (role === 'bot') playPop();
}

function showTyping() {
  const div = document.createElement('div');
  div.className = 'typing';
  div.id = 'typingIndicator';
  div.innerHTML = '<span></span><span></span><span></span>';
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function removeTyping() {
  const t = document.getElementById('typingIndicator');
  if (t) t.remove();
}

function callGL(userMsg) {
  history.push({ role: 'user', content: userMsg });
  showTyping();

  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.sendMessage(
      { type: 'LENS_GROQ_REQUEST', systemPrompt: SYSTEM_PROMPT, history },
      (response) => {
        removeTyping();
        if (chrome.runtime.lastError || !response || !response.reply) {
          addMsg('bot', "I had a little hiccup — try again in a sec! 🙈");
          return;
        }
        history.push({ role: 'assistant', content: response.reply });
        addMsg('bot', response.reply);
      }
    );
  } else {
    // Fallback for testing outside extension
    setTimeout(() => {
      removeTyping();
      addMsg('bot', `I can see that **${siteDomain}** was blocked because of: *${category}*. Here are some safe alternatives you might enjoy instead! 🌟`);
    }, 1200);
  }
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
  const chipsEl = document.getElementById('quickChips');
  if (chipsEl) chipsEl.style.display = 'none';
}

// ── Wire up event listeners ──
document.addEventListener('DOMContentLoaded', () => {
  spawnStars();
  fillInfo();
  notifyParent();
  playChime('block');

  // Send button
  const sendBtn = document.getElementById('sendChat');
  if (sendBtn) {
    sendBtn.addEventListener('click', sendMessage);
  }

  // Enter key in input
  const input = document.getElementById('chatInput');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendMessage();
    });
  }

  // Quick chips
  const chips = document.querySelectorAll('.chip');
  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const q = chip.getAttribute('data-q');
      if (q) sendChip(q);
    });
  });

  // Auto-greet after 600ms
  setTimeout(() => {
    const greeting = siteDomain
      ? `I just landed on your blocked page. The site ${siteDomain} (${rawUrl}) was blocked for: ${category} — ${reason}. Please explain briefly why and suggest safe alternatives to ${siteDomain} specifically.`
      : `A site was blocked. Category: ${category}. Reason: ${reason}. Please explain why and suggest safe alternatives.`;
    callGL(greeting);
  }, 600);
});