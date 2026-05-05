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
  const GROQ_MODEL = 'llama3-8b-8192';
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
    if (!groqKey) {
      return "Hey! Looks like Lens isn't fully set up yet. Ask your parent to add the Lens API key in the extension settings 🛡";
    }

    if (userMessage) {
      chatHistory.push({ role: 'user', content: userMessage });
    }

    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${groqKey}`
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          max_tokens: MAX_TOKENS,
          temperature: 0.85,
          messages: [
            { role: 'system', content: buildSystemPrompt(currentContext) },
            ...chatHistory
          ]
        })
      });

      const data = await res.json();
      if (data.error) return "I had a little hiccup — try again in a sec!";

      const reply = data.choices?.[0]?.message?.content?.trim() || '';
      chatHistory.push({ role: 'assistant', content: reply });
      return reply;
    } catch {
      return "I lost my connection for a sec. Say something and I'll try again!";
    }
  }

  // ─── Build UI ───────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('lens-styles')) return;
    const style = document.createElement('style');
    style.id = 'lens-styles';
    style.textContent = `
      #lens-bubble {
        position: fixed;
        bottom: 24px;
        right: 24px;
        width: 52px;
        height: 52px;
        border-radius: 50%;
        background: #6C63FF;
        box-shadow: 0 4px 16px rgba(108,99,255,0.4);
        cursor: pointer;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 22px;
        border: none;
        transition: transform 0.18s, box-shadow 0.18s;
        font-family: system-ui, sans-serif;
      }
      #lens-bubble:hover { transform: scale(1.1); box-shadow: 0 6px 24px rgba(108,99,255,0.55); }
      #lens-bubble.warn { background: #FF7043; box-shadow: 0 4px 16px rgba(255,112,67,0.5); animation: lens-pulse 1.5s ease-in-out 3; }
      #lens-bubble.escalate { background: #E53935; box-shadow: 0 4px 16px rgba(229,57,53,0.5); animation: lens-pulse 0.8s ease-in-out infinite; }

      @keyframes lens-pulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.15); }
      }

      #lens-badge {
        position: fixed;
        bottom: 78px;
        right: 20px;
        background: #FF7043;
        color: #fff;
        font-size: 11px;
        font-weight: 700;
        padding: 3px 9px;
        border-radius: 20px;
        z-index: 2147483647;
        font-family: system-ui, sans-serif;
        pointer-events: none;
        opacity: 0;
        transform: translateY(4px);
        transition: opacity 0.25s, transform 0.25s;
      }
      #lens-badge.show { opacity: 1; transform: translateY(0); }

      #lens-panel {
        position: fixed;
        bottom: 88px;
        right: 20px;
        width: 320px;
        max-height: 480px;
        background: #fff;
        border-radius: 20px;
        box-shadow: 0 8px 40px rgba(0,0,0,0.18);
        z-index: 2147483647;
        display: none;
        flex-direction: column;
        overflow: hidden;
        font-family: 'Nunito', system-ui, sans-serif;
        border: 1px solid rgba(108,99,255,0.15);
      }
      #lens-panel.open { display: flex; }

      .lens-topbar {
        background: #6C63FF;
        padding: 12px 14px;
        display: flex;
        align-items: center;
        gap: 10px;
        flex-shrink: 0;
      }
      .lens-av {
        width: 32px; height: 32px; border-radius: 50%;
        background: rgba(255,255,255,0.2);
        display: flex; align-items: center; justify-content: center;
        font-size: 16px; flex-shrink: 0;
      }
      .lens-meta { flex: 1; }
      .lens-name { font-size: 13px; font-weight: 800; color: #fff; line-height: 1.2; }
      .lens-sub  { font-size: 10px; color: rgba(255,255,255,0.7); }
      .lens-close {
        background: none; border: none; color: rgba(255,255,255,0.8);
        font-size: 18px; cursor: pointer; padding: 0 2px; line-height: 1;
      }
      .lens-close:hover { color: #fff; }

      .lens-chat {
        flex: 1;
        overflow-y: auto;
        padding: 12px 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        background: #F4F3FF;
        min-height: 200px;
        max-height: 320px;
      }
      .lens-chat::-webkit-scrollbar { width: 4px; }
      .lens-chat::-webkit-scrollbar-thumb { background: rgba(108,99,255,0.25); border-radius: 4px; }

      .lens-row { display: flex; gap: 6px; align-items: flex-end; }
      .lens-row.bot { flex-direction: row; }
      .lens-row.user { flex-direction: row-reverse; }
      .lens-row-av { width: 26px; height: 26px; border-radius: 50%; background: #EEEDFE; display: flex; align-items: center; justify-content: center; font-size: 13px; flex-shrink: 0; }
      .lens-bub {
        max-width: 82%; padding: 8px 12px;
        font-size: 13px; line-height: 1.5;
        border-radius: 16px; word-break: break-word;
      }
      .lens-row.bot .lens-bub {
        background: #fff; color: #1a1a2e;
        border-bottom-left-radius: 4px;
        border: 1px solid rgba(108,99,255,0.1);
      }
      .lens-row.user .lens-bub {
        background: #6C63FF; color: #fff;
        border-bottom-right-radius: 4px;
      }

      .lens-escalate-card {
        background: #FFEBEE; border: 1.5px solid #E53935;
        border-radius: 14px; padding: 10px 12px;
        font-size: 12.5px; line-height: 1.5; max-width: 88%;
      }
      .lens-escalate-tag { font-size: 10px; font-weight: 800; color: #E53935; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 4px; }
      .lens-escalate-body { color: #7f0000; }

      .lens-typing {
        display: flex; gap: 4px; align-items: center;
        background: #fff; border: 1px solid rgba(108,99,255,0.1);
        border-radius: 16px; border-bottom-left-radius: 4px;
        padding: 10px 14px; max-width: 60px;
      }
      .lens-typing span {
        width: 6px; height: 6px; border-radius: 50%;
        background: #6C63FF; opacity: 0.4;
        animation: lens-blink 1.2s infinite;
      }
      .lens-typing span:nth-child(2) { animation-delay: 0.2s; }
      .lens-typing span:nth-child(3) { animation-delay: 0.4s; }
      @keyframes lens-blink { 0%,80%,100%{opacity:0.3;} 40%{opacity:1;} }

      .lens-inputbar {
        background: #fff;
        border-top: 1px solid rgba(108,99,255,0.1);
        padding: 8px 10px;
        display: flex;
        gap: 7px;
        align-items: center;
        flex-shrink: 0;
      }
      .lens-input {
        flex: 1;
        background: #F4F3FF;
        border: 1.5px solid rgba(108,99,255,0.15);
        border-radius: 18px;
        padding: 7px 13px;
        font-size: 13px;
        font-family: inherit;
        color: #1a1a2e;
        outline: none;
        transition: border 0.15s;
      }
      .lens-input:focus { border-color: #6C63FF; }
      .lens-send {
        width: 34px; height: 34px; border-radius: 50%;
        background: #6C63FF; border: none;
        cursor: pointer; display: flex; align-items: center; justify-content: center;
        flex-shrink: 0; transition: background 0.15s;
        color: #fff; font-size: 15px;
      }
      .lens-send:hover { background: #3C3489; }
      .lens-send:disabled { opacity: 0.4; pointer-events: none; }
    `;
    document.head.appendChild(style);
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
