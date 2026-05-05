// blocked.js — Lens chat on the block page
// Works with the new blocked.html layout

(function () {
  'use strict';

  // ── Parse URL params ────────────────────────────────────────────────────────
  // background.js redirects here with ?url=...&category=...&reason=...&risk=...
  const params     = new URLSearchParams(window.location.search);
  const blockedUrl = params.get('url')      || 'that page';
  const category   = params.get('category') || 'restricted content';
  const reason     = params.get('reason')   || '';
  const risk       = parseInt(params.get('risk') || '80', 10);
  const domain     = (() => {
    try { return new URL(blockedUrl).hostname.replace('www.', ''); }
    catch { return blockedUrl; }
  })();

  // ── Update top strip ────────────────────────────────────────────────────────
  const domainEl  = document.getElementById('blocked-domain');
  const badgeEl   = document.getElementById('category-badge');
  if (domainEl) domainEl.textContent = domain || 'This page was blocked';
  if (badgeEl) {
    badgeEl.textContent = category;
    if (risk < 85) badgeEl.classList.add('warn');
  }

  // ── Wire action buttons ─────────────────────────────────────────────────────
  document.getElementById('btn-back')?.addEventListener('click', () => history.back());
  document.getElementById('btn-home')?.addEventListener('click', () => {
    window.location.href = 'https://www.google.com';
  });

  // ── Chat state ──────────────────────────────────────────────────────────────
  let chatHistory = [];
  let busy = false;

  // ── System prompt ───────────────────────────────────────────────────────────
  const systemPrompt = `You are Lens, a warm and caring AI safety buddy built into a parental control extension for kids aged 6–16 in Egypt.

A page was just BLOCKED for this child. Here's the context:
- Blocked site: ${domain}
- Category: ${category}
- Risk score: ${risk}/100
- Extra detail: ${reason || 'Content was flagged as inappropriate or potentially harmful'}

YOUR JOB:
- Open with a warm, friendly greeting — explain briefly WHY this page was blocked in simple words
- Make it feel like a conversation, not a punishment
- Be empathetic — this might feel frustrating and that's valid
- Let them ask you anything. Answer honestly and openly.
- If they push back ("it's fine", "my friends use it"), ask WHY they think that — be genuinely curious, not dismissive
- If they have a good reason, acknowledge it and tell them they can ask their parent to review the block
- If content is truly dangerous, stay kind but firm — gently explain why it stays blocked
- NEVER shame them or make them feel stupid

TONE:
- Warm buddy, never preachy or robotic
- 2–3 sentences per message MAX — kids don't read walls of text
- Match their slang energy naturally — don't force it
- No bullet points, no headers — pure natural chat

Respond ONLY as Lens. No meta-commentary.`;

  // ── Chat helpers ────────────────────────────────────────────────────────────
  function scrollChat() {
    const box = document.getElementById('chat-box');
    if (box) box.scrollTop = box.scrollHeight;
  }

  function addBotMessage(text, escalate = false) {
    const box = document.getElementById('chat-box');
    if (!box) return;
    const row = document.createElement('div');
    row.className = 'msg-row bot';
    if (escalate) {
      row.innerHTML = `<div class="msg-av">🛡</div>
        <div class="escalate-bub">
          <div class="escalate-tag">Parents have been notified</div>
          <div class="escalate-body">${text}</div>
        </div>`;
    } else {
      row.innerHTML = `<div class="msg-av">🛡</div>
        <div class="msg-bub">${text.replace(/\n/g, '<br>')}</div>`;
    }
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
    busy = locked;
    const inp = document.getElementById('chat-input');
    const btn = document.getElementById('send-btn');
    if (inp) inp.disabled = locked;
    if (btn) btn.disabled = locked;
  }

  // ── Groq call via background.js ─────────────────────────────────────────────
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

  // ── Send message ─────────────────────────────────────────────────────────────
  async function sendMessage() {
    if (busy) return;
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
    inp.focus();
  }

  // ── Wire input ───────────────────────────────────────────────────────────────
  document.getElementById('chat-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
  document.getElementById('send-btn')?.addEventListener('click', sendMessage);

  // ── Lens opens immediately with context-aware message ───────────────────────
  async function openingMessage() {
    setLock(true);
    showTyping();
    const reply = await askLens(null);
    removeTyping();
    // High risk = escalation card style
    addBotMessage(reply, risk >= 85);
    setLock(false);
    document.getElementById('chat-input')?.focus();
  }

  openingMessage();

})();