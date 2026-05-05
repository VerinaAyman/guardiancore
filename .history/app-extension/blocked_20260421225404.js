// blocked.js — Lens chat on the block page

(function () {
  // ─── Parse URL params ──────────────────────────────────────────────────────
  const params = new URLSearchParams(window.location.search);
  const category = params.get('category') || 'Restricted content';
  const reason   = params.get('reason')   || '';
  const blockedUrl = params.get('url')    || 'that page';

  // ─── Set category badge ────────────────────────────────────────────────────
  const badge = document.getElementById('category-badge');
  if (badge) badge.textContent = category;

  // ─── State ─────────────────────────────────────────────────────────────────
  let chatHistory = [];

  const systemPrompt = `You are Lens, a warm and caring AI safety buddy inside a parental control extension for kids aged 6–16 in Egypt.

A page was just BLOCKED for this child. Here's why:
- Blocked URL: ${blockedUrl}
- Category: ${category}
- Reason: ${reason || 'Content was flagged as inappropriate or potentially harmful'}

YOUR JOB RIGHT NOW:
- Explain kindly WHY this page was blocked, in simple words the child understands
- Be empathetic — this might feel frustrating for them and that's okay
- Help them understand the risk without shaming them
- Answer their questions honestly and openly
- If they push back, listen — really listen. Ask them what they think.
- If they have a genuinely good reason, acknowledge it and tell them they can ask their parent to review it
- NEVER make them feel stupid or bad for visiting the page

TONE:
- Warm, friendly, never preachy
- Short messages: 2–3 sentences max
- Natural chat, no bullet points or headers
- Light slang is okay if they use it first

Respond ONLY as Lens.`;

  // ─── Chat helpers ──────────────────────────────────────────────────────────
  function scrollChat() {
    const box = document.getElementById('chat-box');
    if (box) box.scrollTop = box.scrollHeight;
  }

  function addBotMessage(text) {
    const box = document.getElementById('chat-box');
    if (!box) return;
    const row = document.createElement('div');
    row.className = 'msg-row bot';
    row.innerHTML = `<div class="msg-av">🛡</div>
      <div class="msg-bub">${text.replace(/\n/g, '<br>')}</div>`;
    box.appendChild(row);
    scrollChat();
  }

  function addUserMessage(text) {
    const box = document.getElementById('chat-box');
    if (!box) return;
    const row = document.createElement('div');
    row.className = 'msg-row user';
    row.innerHTML = `<div class="msg-bub">${text}</div>`;
    box.appendChild(row);
    scrollChat();
  }

  function showTyping() {
    const box = document.getElementById('chat-box');
    if (!box) return;
    const row = document.createElement('div');
    row.className = 'msg-row bot';
    row.id = 'typing-row';
    row.innerHTML = `<div class="msg-av">🛡</div>
      <div class="typing"><span></span><span></span><span></span></div>`;
    box.appendChild(row);
    scrollChat();
  }

  function removeTyping() {
    document.getElementById('typing-row')?.remove();
  }

  function setLock(locked) {
    const inp = document.getElementById('chat-input');
    const btn = document.getElementById('send-btn');
    if (inp) inp.disabled = locked;
    if (btn) btn.disabled = locked;
  }

  // ─── Groq call via background ──────────────────────────────────────────────
  async function askLens(userMessage) {
    if (userMessage) {
      chatHistory.push({ role: 'user', content: userMessage });
    }

    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'LENS_GROQ_REQUEST',
        systemPrompt,
        history: chatHistory
      }, (response) => {
        if (chrome.runtime.lastError || !response?.reply) {
          resolve("I had a little hiccup — try again in a sec!");
          return;
        }
        chatHistory.push({ role: 'assistant', content: response.reply });
        resolve(response.reply);
      });
    });
  }

  // ─── Send message ──────────────────────────────────────────────────────────
  async function sendMessage() {
    const inp = document.getElementById('chat-input');
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
  }

  // ─── Wire up input ─────────────────────────────────────────────────────────
  document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
  document.getElementById('send-btn').addEventListener('click', sendMessage);

  // ─── Opening message from Lens ─────────────────────────────────────────────
  async function openingMessage() {
    setLock(true);
    showTyping();
    const reply = await askLens(null);
    removeTyping();
    addBotMessage(reply);
    setLock(false);
  }

  openingMessage();

})();