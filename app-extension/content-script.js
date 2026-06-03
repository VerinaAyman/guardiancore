// GuardianLens Content Script — v0.9.4
// ✅ Inbound-only filtering · multi-platform · slang detection · instant response
// 🔧 v0.9.4 fixes:
//    - Faster debounce: 800ms (was 2500ms) for near-instant detection
//    - Quiet period lowered to 3s (was 6s)
//    - Initial scan at 800ms (was 2000ms)

(function () {
  'use strict';

  if (window.__guardianlens_content_script_loaded) return;
  window.__guardianlens_content_script_loaded = true;

  function safeSendMessage(msg, callback) {
    try {
      if (!chrome.runtime?.id) return;
      chrome.runtime.sendMessage(msg, callback);
    } catch (e) {
      if (e.message?.includes('Extension context invalidated')) return;
      console.warn('[GL] sendMessage failed:', e);
    }
  }

  function isChatPlatform() {
    const host = location.hostname;
    const path = location.pathname;
    return (
      host.includes('web.whatsapp.com') ||
      host.includes('discord.com') ||
      host.includes('telegram.org') ||
      host.includes('telegram.me') ||
      host.includes('messenger.com') ||
      host.includes('slack.com') ||
      host.includes('instagram.com') ||
      (host.includes('facebook.com') && path.startsWith('/messages'))
    );
  }

  function getPlatform() {
    const host = location.hostname;
    const path = location.pathname;
    if (host.includes('web.whatsapp.com'))                              return 'whatsapp';
    if (host.includes('discord.com'))                                   return 'discord';
    if (host.includes('telegram.org') || host.includes('telegram.me')) return 'telegram';
    if (host.includes('messenger.com'))                                 return 'messenger';
    if (host.includes('slack.com'))                                     return 'slack';
    if (host.includes('instagram.com'))                                 return 'instagram';
    if (host.includes('facebook.com') && path.startsWith('/messages')) return 'messenger';
    return 'web';
  }

  const SLANG_MAP = {
    'wya': 'where you at', 'wyd': 'what you doing', 'hmu': 'hit me up',
    'hmu later': 'hit me up later', 'irl': 'in real life', 'frfr': 'for real for real',
    'finna': 'going to', 'lowkey': 'secretly', 'sus': 'suspicious',
    'slide': 'come over', 'slide thru': 'come over', 'pull up': 'come to my location',
    'link up': 'meet in person', 'link': 'meet in person', 'dms': 'direct messages',
    'dm me': 'message me privately', 'lmk': 'let me know', 'ngl': 'not gonna lie',
    'tbh': 'to be honest', 'oml': 'oh my lord', 'istg': 'i swear to god',
    'ong': 'on god (seriously)', 'periodt': 'period (emphasis)', 'no cap': 'not lying',
    'cap': 'lie', 'bussin': 'really good', 'sheesh': 'expression of surprise',
    'bet': 'okay / agreed', 'slay': 'doing great', 'rent free': 'always thinking about',
    'understood the assignment': 'did well', 'it\'s giving': 'it seems like',
    'main character': 'center of attention', 'vibe check': 'assess the mood',
    'hits different': 'feels special', 'ate': 'did a great job',
    'left no crumbs': 'did a great job', 'rizz': 'charisma / charm',
    'npc': 'someone acting mindlessly', 'delulu': 'delusional', 'cheugy': 'outdated / uncool',
    'mid': 'mediocre', 'ratio': 'getting more dislikes than likes',
    'caught in 4k': 'caught doing something bad', 'ghosting': 'ignoring someone',
    'situationship': 'undefined romantic relationship', 'body count': 'number of sexual partners',
    'sneaky link': 'secret romantic partner', 'soft launch': 'subtly revealing a relationship',
    'hard launch': 'publicly announcing a relationship', 'pick me': 'seeking validation',
    'simp': 'overly devoted person', 'stan': 'obsessive fan',
    'ship': 'support a romantic pairing', 'otp': 'one true pairing',
    'finesse': 'manipulate skillfully', 'flex': 'show off', 'drip': 'stylish outfit',
    'snatched': 'looking attractive', 'fire': 'excellent', 'lit': 'exciting',
    'goat': 'greatest of all time', 'g': 'friend / gangster', 'fam': 'family / close friend',
    'bro': 'friend', 'bruh': 'expression of disbelief', 'fr': 'for real',
    'lowkey sus': 'secretly suspicious', 'w': 'win', 'l': 'loss',
    'ratio\'d': 'overwhelmed by negative replies', 'touch grass': 'go outside',
    'based': 'admirable / confident', 'cringe': 'embarrassing',
    'himbo': 'attractive but not intelligent', 'fomo': 'fear of missing out',
    'jomo': 'joy of missing out', 'irl meet': 'meet in person',
    'secret': 'keep this between us', 'dont tell': 'don\'t tell anyone',
    'our secret': 'keep this between us', 'special friend': 'close secret friend',
    'older friend': 'adult friend'
  };

  function expandSlang(text) {
    let expanded = text.toLowerCase();
    for (const [slang, meaning] of Object.entries(SLANG_MAP)) {
      const regex = new RegExp(`\\b${slang.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      expanded = expanded.replace(regex, `${slang} (${meaning})`);
    }
    return expanded;
  }

  function extractWhatsAppMessages() {
    const msgs = [];
    document.querySelectorAll('.message-in').forEach(el => {
      const textEl = el.querySelector('[data-testid="msg-text"], .copyable-text span, span.selectable-text');
      const text = (textEl?.innerText || el.innerText)?.trim();
      if (text && text.length > 2) msgs.push(text);
    });
    return msgs.slice(-30);
  }

  function extractDiscordMessages() {
    const msgs = [];
    let currentUsername = null;
    try {
      currentUsername = document.querySelector('[class*="nameTag"] [class*="username"], [class*="userTag"] span')?.innerText?.trim()?.toLowerCase();
    } catch (_) {}
    document.querySelectorAll('li[id^="chat-messages-"]').forEach(el => {
      if (currentUsername) {
        const authorEl = el.querySelector('[class*="username"], [class*="headerText"] span');
        const author = authorEl?.innerText?.trim()?.toLowerCase();
        if (author && author === currentUsername) return;
      }
      const textEl = el.querySelector('[class*="messageContent"]');
      const text = textEl?.innerText?.trim();
      if (text && text.length > 2) msgs.push(text);
    });
    return msgs.slice(-30);
  }

  function extractTelegramMessages() {
    const msgs = [];
    document.querySelectorAll('.message.in .text, .message.in .caption').forEach(el => {
      const text = el.innerText?.trim();
      if (text && text.length > 2) msgs.push(text);
    });
    return msgs.slice(-30);
  }

  function extractMessengerMessages() {
    const msgs = [];
    document.querySelectorAll('[role="row"]').forEach(row => {
      const isOutgoing = row.querySelector('[style*="flex-end"]') !== null || row.querySelector('[data-scope="sent_message"]') !== null;
      if (isOutgoing) return;
      const textEl = row.querySelector('[dir="auto"]');
      const text = textEl?.innerText?.trim();
      if (text && text.length > 2 && text.length < 1000) msgs.push(text);
    });
    return msgs.slice(-30);
  }

  function extractInstagramMessages() {
    const msgs = [];
    document.querySelectorAll('[class*="DirectThread"] > div, [role="listitem"]').forEach(item => {
      const style = window.getComputedStyle(item);
      if (style.justifyContent === 'flex-end' || style.alignSelf === 'flex-end') return;
      const text = item.querySelector('span[dir="auto"], div[dir="auto"]')?.innerText?.trim();
      if (text && text.length > 2 && text.length < 1000) msgs.push(text);
    });
    return msgs.slice(-30);
  }

  function extractGenericMessages() {
    const msgs = [];
    document.querySelectorAll('[class*="message"], [class*="chat"], [class*="bubble"], [data-message]').forEach(el => {
      if (el.children.length < 5) {
        const text = el.innerText?.trim();
        if (text && text.length > 2 && text.length < 2000) msgs.push(text);
      }
    });
    return msgs.slice(-30);
  }

  function extractChatMessages() {
    const platform = getPlatform();
    switch (platform) {
      case 'whatsapp':  return extractWhatsAppMessages();
      case 'discord':   return extractDiscordMessages();
      case 'telegram':  return extractTelegramMessages();
      case 'messenger': return extractMessengerMessages();
      case 'instagram': return extractInstagramMessages();
      default:          return extractGenericMessages();
    }
  }

const CHAT_DEDUP_MS = 30000;
  let lastChatText   = '';
  let lastChatSentAt = 0;

  function requestChatAnalysis() {
    const messages = extractChatMessages();
    if (!messages.length) return;

    const combined = messages.join('\n');
    const expanded = expandSlang(combined);
    const now = Date.now();

    if (expanded === lastChatText && (now - lastChatSentAt) < CHAT_DEDUP_MS) return;

    lastChatText   = expanded;
    lastChatSentAt = now;

    safeSendMessage({
      type:     'ANALYZE_PAGE',
      url:      location.href,
      text:     expanded,
      isChat:   true,
      platform: getPlatform()
    });
  }

  function requestAnalysis() {
    const text = document.body?.innerText?.trim() || '';
    if (!text || text.length < 50) return;
    safeSendMessage({
      type:     'ANALYZE_PAGE',
      url:      location.href,
      text:     text.slice(0, 5000),
      isChat:   false,
      platform: getPlatform()
    });
  }

  let chatDebounceTimer  = null;
  let lastObserverFire   = 0;

  function setupChatObserver() {
    const platform = getPlatform();
    const containerSelectors = {
      whatsapp:  '#main, [data-testid="conversation-panel-body"]',
      discord:   '[class*="scroller"], [class*="messagesWrapper"], ol[class*="scrollerInner"]',
      telegram:  '.messages-container, #column-center',
      messenger: '[role="main"]',
      slack:     '[data-qa="message_pane"]',
      instagram: '[role="main"], [class*="DirectThread"]',
    };

    const sel       = containerSelectors[platform] || 'body';
    const container = document.querySelector(sel) || document.body;

    console.log(`[GuardianLens] Chat observer attached on ${platform} →`, container);

    const observer = new MutationObserver(() => {
      const now = Date.now();

      // ✅ Quiet period = 3s (was 6s), debounce = 800ms (was 2500ms)
      if (now - lastObserverFire > 3000) {
        lastObserverFire = now;
        clearTimeout(chatDebounceTimer);
        requestChatAnalysis();
      } else {
        clearTimeout(chatDebounceTimer);
        chatDebounceTimer = setTimeout(() => {
          lastObserverFire = Date.now();
          requestChatAnalysis();
        }, 800);
      }
    });

    observer.observe(container, { childList: true, subtree: true });

    // ✅ Initial scan at 800ms (was 2000ms)
    setTimeout(requestChatAnalysis, 800);
  }

  function setupStaticObserver() {
    setTimeout(requestAnalysis, 1500);
  }

  function attachDynamicWatchers() {
    if (isChatPlatform()) return;
    const targets = ['#comments', '.comments', '[data-testid="tweet"]', 'article', 'main'];
    targets.forEach(sel => {
      const el = document.querySelector(sel);
      if (!el) return;
      const obs = new MutationObserver(() => requestAnalysis());
      obs.observe(el, { childList: true, subtree: true });
    });
  }

  let lastHref = location.href;

  function setupSPAWatcher() {
    const navObserver = new MutationObserver(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        lastChatText = ''; lastChatSentAt = 0; lastObserverFire = 0;
        console.log('[GuardianLens] SPA navigation →', lastHref);
        setTimeout(isChatPlatform() ? requestChatAnalysis : requestAnalysis, 1500);
      }
    });
    const titleEl = document.querySelector('title');
    if (titleEl) navObserver.observe(titleEl, { childList: true });

    ['pushState', 'replaceState'].forEach(method => {
      const orig = history[method].bind(history);
      history[method] = function (...args) {
        orig(...args);
        if (location.href !== lastHref) {
          lastHref = location.href;
          lastChatText = ''; lastChatSentAt = 0; lastObserverFire = 0;
          setTimeout(isChatPlatform() ? requestChatAnalysis : requestAnalysis, 1500);
        }
      };
    });

    window.addEventListener('popstate', () => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        lastChatText = ''; lastChatSentAt = 0; lastObserverFire = 0;
        setTimeout(isChatPlatform() ? requestChatAnalysis : requestAnalysis, 1500);
      }
    });
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'PING') {
      sendResponse({ status: 'alive', platform: getPlatform(), isChat: isChatPlatform() });
    }
    if (msg.type === 'REANALYZE') {
      if (isChatPlatform()) requestChatAnalysis();
      else requestAnalysis();
    }
  });

  console.log(`[GuardianLens] v0.9.4 loaded on ${getPlatform()} (chat: ${isChatPlatform()})`);

  if (isChatPlatform()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', setupChatObserver);
    } else {
      setTimeout(setupChatObserver, 1000);
    }
  } else {
    setupStaticObserver();
    attachDynamicWatchers();
  }

  setupSPAWatcher();

})();