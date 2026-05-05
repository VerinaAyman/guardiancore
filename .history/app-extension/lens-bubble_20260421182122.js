/**
 * lens-bubble.js — GuardianLens Lens chatbot content script
 *
 * Drop this file into app-extension/ and add it to manifest.json
 * as a content_script AFTER content-script.js so it runs on every page.
 *
 * How it works:
 *  1. Injects a floating 🛡 bubble into the corner of every page (child sees it always)
 *  2. Listens for a message from background.js: { type: 'LENS_TRIGGER', risk, category, summary }
 *  3. On trigger → opens chat panel → Lens starts a conversation using Groq API (free)
 *  4. Extreme content → skips chat, fires LENS_ESCALATE back to background.js → notify.py
 *
 * background.js integration:
 *  After analysis.py returns a result, background.js should send:
 *    chrome.tabs.sendMessage(tabId, {
 *      type: 'LENS_TRIGGER',
 *      risk: result.risk_score,       // 0-100
 *      category: result.category,     // e.g. "violence", "adult", "phishing"
 *      summary: result.child_narrative, // from pipeline.py
 *      domain: new URL(tab.url).hostname
 *    });
 *
 *  When Lens escalates, it sends back to background.js:
 *    chrome.runtime.sendMessage({ type: 'LENS_ESCALATE', domain, category })
 *  background.js should then call notify.py as it normally does for hard blocks.
 */

(function () {
  'use strict';

  // ─── Config ────────────────────────────────────────────────────────────────
  const RISK_GUIDE_THRESHOLD = 40;    // show chat warning
  const RISK_ESCALATE_THRESHOLD = 85; // skip chat, alert parents immediately
const GROQ_MODEL = 'llama-3.1-8b-instant';
  const MAX_TOKENS = 220;

  // ─── State ──────────────────────────────────────────────────────────────────
  let chatOpen = false;
  let chatHistory = [];
  let currentContext = null;
  let groqKey = null;

  // ─── Load Groq key from extension storage ──────────────────────────────────
  // Parent sets this once in options.html → stored in chrome.storage.sync
  chrome.storage.sync.get('lens_groq_key', (res) => {
    groqKey = res.lens_groq_key || null;
  });

  // ─── System prompt for Lens ─────────────────────────────────────────────────
  function buildSystemPrompt(ctx) {
    return `You are Lens, a warm and smart AI safety buddy built into a parental control extension for kids aged 6–16 in Egypt.

WHAT TRIGGERED YOU:
- Website/page: ${ctx.domain}
- Risk category: ${ctx.category}
- Risk score: ${ctx.risk}/100
- What the safety system found: ${ctx.summary}

YOUR PERSONALITY:
- You're the kid's buddy, not a cop. Friendly, caring, genuinely cool.
- Use light natural slang (no cap, fr, sus, lowkey, ngl, bestie) — only when it fits their vibe
- Mirror the child's energy. Formal kid = tone down. Slang-heavy kid = match them.
- SHORT messages only: 2–3 sentences max. Kids don't read walls of text.
- Never repeat yourself. Never lecture.
- Ask questions — be curious about what THEY think.

WHAT TO DO:
- Explain briefly what you noticed and why it might be a problem, in simple words
- Ask them what they think — give them real agency
- If they push back, ask WHY they think it's okay — don't just repeat the warning
- If they give a good reason (e.g. "these are my real friends"), acknowledge it and give a tip instead
- If content is genuinely harmful and they keep insisting → tell them gently you'll need to let their parents know

NEVER:
- Describe explicit, graphic, or violent content in detail
- Threaten or shame the child
- Write more than 3 sentences per message
- Use bullet points or headers — pure natural chat only

Respond ONLY as Lens. No meta-commentary.`;
  }

  // ─── Groq API call ──────────────────────────────────────────────────────────
 async function askLens(userMessage) {
    if (userMessage) {
      chatHistory.push({ role: 'user', content: userMessage });
    }

    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'LENS_GROQ_REQUEST',
        systemPrompt: buildSystemPrompt(currentContext),
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

  function buildPanel() {
    // Floating bubble
    const bubble = document.createElement('button');
    bubble.id = 'lens-bubble';
    bubble.textContent = '🛡';
    bubble.setAttribute('aria-label', 'Open Lens safety buddy');
    bubble.onclick = togglePanel;
    document.body.appendChild(bubble);

    // Badge (shows when triggered)
    const badge = document.createElement('div');
    badge.id = 'lens-badge';
    badge.textContent = '!';
    document.body.appendChild(badge);

    // Chat panel
    const panel = document.createElement('div');
    panel.id = 'lens-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Lens safety chat');
    panel.innerHTML = `
      <div class="lens-topbar">
        <div class="lens-av">🛡</div>
        <div class="lens-meta">
          <div class="lens-name">Lens — your web buddy</div>
          <div class="lens-sub">always watching your back</div>
        </div>
        <button class="lens-close" aria-label="Close Lens" onclick="document.getElementById('lens-panel').classList.remove('open')">✕</button>
      </div>
      <div class="lens-chat" id="lens-chat"></div>
      <div class="lens-inputbar">
        <input class="lens-input" id="lens-input" type="text" placeholder="Reply to Lens…" autocomplete="off" />
        <button class="lens-send" id="lens-send" aria-label="Send">➤</button>
      </div>
    `;
    document.body.appendChild(panel);

    // Wire input
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
    }
  }

  // ─── Chat helpers ───────────────────────────────────────────────────────────
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
      row.innerHTML = `<div class="lens-row-av">🛡</div>
        <div class="lens-escalate-card">
          <div class="lens-escalate-tag">Letting your parents know</div>
          <div class="lens-escalate-body">${text}</div>
        </div>`;
    } else {
      row.innerHTML = `<div class="lens-row-av">🛡</div>
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
    row.innerHTML = `<div class="lens-row-av">🛡</div>
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
  }

  // ─── Main trigger — called by background.js message ─────────────────────────
  async function triggerLens(ctx) {
    currentContext = ctx;
    chatHistory = [];

    const bubble = document.getElementById('lens-bubble');
    const badge  = document.getElementById('lens-badge');
    const panel  = document.getElementById('lens-panel');
    const chat   = document.getElementById('lens-chat');
    if (!bubble || !panel || !chat) return;

    // Clear previous chat
    chat.innerHTML = '';

    // ── EXTREME: escalate immediately, no conversation ──────────────────────
    if (ctx.risk >= RISK_ESCALATE_THRESHOLD) {
      bubble.className = 'escalate';
      badge.textContent = '🚨';
      badge.classList.add('show');

      // Tell background.js to fire notify.py
      chrome.runtime.sendMessage({
        type: 'LENS_ESCALATE',
        domain: ctx.domain,
        category: ctx.category
      });

      // Open panel with hard-stop message
      chatOpen = true;
      panel.classList.add('open');
      addBotMessage(
        "Hey, I need to pause you here — this page has content that's way too intense for anyone your age. I've already let your parents know. You're not in trouble, I just care about you 💛",
        true
      );
      return;
    }

    // ── GUIDE: start a friendly conversation ────────────────────────────────
    if (ctx.risk >= RISK_GUIDE_THRESHOLD) {
      bubble.className = 'warn';
      badge.textContent = '!';
      badge.classList.add('show');

      // Auto-open after a brief delay so it feels natural
      setTimeout(async () => {
        chatOpen = true;
        panel.classList.add('open');
        setLock(true);
        showTyping();
        const opening = await askLens(null); // Lens opens the conversation
        removeTyping();
        addBotMessage(opening);
        setLock(false);
      }, 800);
    }
  }

  // ─── Listen for messages from background.js ─────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'LENS_TRIGGER') {
      triggerLens({
        risk: msg.risk,
        category: msg.category,
        summary: msg.summary || 'Potentially inappropriate content detected.',
        domain: msg.domain || window.location.hostname
      });
    }

    // Parent toggled Groq key from options page
    if (msg.type === 'LENS_KEY_UPDATED') {
      groqKey = msg.key;
    }
  });

  // ─── Init ────────────────────────────────────────────────────────────────────
  injectStyles();
  buildPanel();

})();
