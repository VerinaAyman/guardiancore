// GuardianCore Audit Probe - Background Service Worker with Rule Enforcement
// Week 4: Real-time updates, gamification cues, risk scoring
console.log("GuardianCore Audit Probe v0.4.3 loaded");

// --- Dev / Test Mode Enhancements (Week4 Gamification Testability) ---
// Fast mode makes 1 minute count as 1 hour for safe streak progression.
let fastMode = false; // cached flag
async function loadFastMode() {
  try {
    const { gc_fast_mode } = await chrome.storage.local.get(["gc_fast_mode"]);
    fastMode = !!gc_fast_mode;
    if (fastMode) console.log("[Gamification] FAST MODE enabled (1 minute = 1 hour)");
  } catch (e) {
    // ignore
  }
}

// Initialize XP immediately on load
loadFastMode();
loadXpState();

// Expanded tracker list with categories
const TRACKERS = {
  "google-analytics.com": { category: "analytics", name: "Google Analytics", risk: "medium" },
  "doubleclick.net": { category: "advertising", name: "DoubleClick", risk: "high" },
  "facebook.net": { category: "social_media", name: "Facebook", risk: "high" },
  "googletagmanager.com": { category: "analytics", name: "Google Tag Manager", risk: "medium" },
  "adservice.google.com": { category: "advertising", name: "Google Ads", risk: "high" },
  "googlesyndication.com": { category: "advertising", name: "Google AdSense", risk: "high" },
  "googleadservices.com": { category: "advertising", name: "Google Ad Services", risk: "high" },
  "facebook.com": { category: "social_media", name: "Facebook", risk: "high" },
  "connect.facebook.net": { category: "social_media", name: "Facebook Connect", risk: "high" },
  "analytics.google.com": { category: "analytics", name: "Google Analytics", risk: "medium" },
  "googletagservices.com": { category: "advertising", name: "Google Tag Services", risk: "high" },
  "twitter.com": { category: "social_media", name: "Twitter", risk: "medium" },
  "instagram.com": { category: "social_media", name: "Instagram", risk: "medium" },
  "tiktok.com": { category: "social_media", name: "TikTok", risk: "medium" },
  "snapchat.com": { category: "social_media", name: "Snapchat", risk: "medium" },
  "youtube.com": { category: "video", name: "YouTube", risk: "low" },
  "amazon-adsystem.com": { category: "advertising", name: "Amazon Ads", risk: "high" },
  "criteo.com": { category: "advertising", name: "Criteo", risk: "high" },
  "outbrain.com": { category: "advertising", name: "Outbrain", risk: "high" },
  "taboola.com": { category: "advertising", name: "Taboola", risk: "high" }
};

// In-memory per-tab state
const tabState = new Map(); // tabId -> { trackerCount, trackersByCategory, lastCsp, lastCors, blocked }

// Legacy streak/risk state removed – XP only retained; keep violation timestamp for XP penalties if needed
let lastViolationTs = null;

// XP (fast-feedback gamification) state (daily reset)
let xpState = {
  dayKey: null,  // 'YYYY-MM-DD'
  xp: 0,
  level: 1
};

async function loadXpState() {
  try {
    const { gc_xp_state } = await chrome.storage.local.get(["gc_xp_state"]);
    if (gc_xp_state) xpState = gc_xp_state;
    ensureXpDay();
  } catch {}
}

function ensureXpDay() {
  const today = new Date().toISOString().slice(0,10);
  if (xpState.dayKey !== today) {
    xpState.dayKey = today;
    xpState.xp = 0;
    // level persists across days (optional) – keep level
    persistXp();
  }
}

function persistXp() {
  chrome.storage.local.set({ gc_xp_state: xpState });
}

function awardXp(event) {
  ensureXpDay();
  // event carries: trackers, csp, cors, blocked, violation (boolean)
  let delta = 1; // base per navigation
  if (event.csp) delta += 2;
  if (event.cors) delta += 1;
  if (event.trackers === 0) delta += 3; else delta -= Math.min(event.trackers, 5); // penalize trackers
  if (event.blocked || event.violation) delta -= 5; // heavy penalty
  if (delta < 0) delta = Math.max(delta, -7); // floor penalty
  if (fastMode) delta *= 3; // accelerate in fast mode
  xpState.xp += delta;
  if (xpState.xp < 0) xpState.xp = 0;
  while (xpState.xp >= 100) {
    xpState.xp -= 100;
    xpState.level += 1;
  }
  persistXp();
  // Notify popup
  chrome.runtime.sendMessage({
    type: "xp:update",
    xp: xpState.xp,
    level: xpState.level,
    progress: xpState.xp / 100,
    delta
  }).catch(() => {});
}

function ensureTab(tid) {
  if (!tabState.has(tid)) {
    tabState.set(tid, {
      trackerCount: 0,
      trackersByCategory: {},
      lastCsp: false,
      lastCors: false,
      blocked: null // { reason, rule, timestamp }
    });
  }
  return tabState.get(tid);
}

// SHA-256 hex (origin hashing)
async function sha256Hex(str) {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// Rules cache
let rulesCache = {
  allowlist: [],
  blocklist: [],
  time_window: [],
  lastFetch: 0
};

// Fetch rules from backend
async function fetchRules() {
  try {
    const { gc_backend_url, gc_api_token } = await chrome.storage.local.get(["gc_backend_url", "gc_api_token"]);
    if (!gc_backend_url) return;

    const url = `${gc_backend_url.replace(/\/+$/, "")}/rules?enabled_only=true`;
    const response = await fetch(url, {
      headers: {
        "Authorization": gc_api_token ? `Bearer ${gc_api_token}` : ""
      }
    });

    if (response.ok) {
      const rules = await response.json();
      rulesCache = {
        allowlist: rules.filter(r => r.rule_type === "allowlist"),
        blocklist: rules.filter(r => r.rule_type === "blocklist"),
        time_window: rules.filter(r => r.rule_type === "time_window"),
        lastFetch: Date.now()
      };
      console.log("Rules fetched:", rulesCache);
    }
  } catch (e) {
    console.error("Failed to fetch rules:", e);
  }
}

// Check if URL matches a rule
function matchesPattern(url, pattern) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    // Simple pattern matching: exact match or ends with pattern
    return hostname === pattern || hostname.endsWith("." + pattern);
  } catch {
    return false;
  }
}

// Check time window rules
function isInBlockedTimeWindow() {
  const now = new Date();
  const currentHour = now.getHours();
  const currentDay = now.getDay(); // 0 = Sunday, 6 = Saturday

  for (const rule of rulesCache.time_window) {
    try {
      const config = JSON.parse(rule.pattern);
      // Format: { start_hour: 22, end_hour: 6, days: [0,1,2,3,4,5,6] }
      if (config.days && !config.days.includes(currentDay)) continue;
      
      const startHour = config.start_hour || 0;
      const endHour = config.end_hour || 24;
      
      // Handle overnight windows (e.g., 22:00 to 6:00)
      if (startHour > endHour) {
        if (currentHour >= startHour || currentHour < endHour) {
          return { blocked: true, rule };
        }
      } else {
        if (currentHour >= startHour && currentHour < endHour) {
          return { blocked: true, rule };
        }
      }
    } catch (e) {
      console.error("Invalid time window rule:", rule, e);
    }
  }
  return { blocked: false };
}

// Enforce rules on a URL
function enforceRules(url, tabId) {
  // Check allowlist first
  for (const rule of rulesCache.allowlist) {
    if (matchesPattern(url, rule.pattern)) {
      return { allowed: true };
    }
  }

  // Check time windows
  const timeCheck = isInBlockedTimeWindow();
  if (timeCheck.blocked) {
    const state = ensureTab(tabId);
    state.blocked = {
      reason: timeCheck.rule.explanation || "Blocked due to time restrictions",
      rule: timeCheck.rule,
      timestamp: Date.now()
    };
    return { blocked: true, reason: state.blocked.reason, rule: timeCheck.rule };
  }

  // Check blocklist
  for (const rule of rulesCache.blocklist) {
    if (matchesPattern(url, rule.pattern)) {
      const state = ensureTab(tabId);
      state.blocked = {
        reason: rule.explanation || `Blocked: ${rule.category || "restricted content"}`,
        rule: rule,
        timestamp: Date.now()
      };
      return { blocked: true, reason: state.blocked.reason, rule: rule };
    }
  }

  return { allowed: true };
}

// Count tracker requests
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
    try {
      const host = new URL(details.url).hostname.replace(/^www\./, "");
      for (const [domain, info] of Object.entries(TRACKERS)) {
        if (host.endsWith(domain)) {
          const state = ensureTab(details.tabId);
          state.trackerCount++;
          state.trackersByCategory[info.category] = (state.trackersByCategory[info.category] || 0) + 1;
          break;
        }
      }
    } catch (e) {
      // Silently ignore malformed URLs
    }
  },
  { urls: ["<all_urls>"] }
);

// Inspect CSP/CORS from response headers
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0 || !details.responseHeaders) return;
    const st = ensureTab(details.tabId);
    const h = Object.create(null);
    for (const { name, value } of details.responseHeaders) {
      h[name.toLowerCase()] = (value || "");
    }
    st.lastCsp = Boolean(h["content-security-policy"]);
    st.lastCors = Boolean(h["access-control-allow-origin"]) || (h["vary"] || "").includes("Origin");
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders", "extraHeaders"]
);

// Block navigation if rules dictate
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return; // Only check main frame
  
  const enforcement = enforceRules(details.url, details.tabId);
  if (enforcement.blocked) {
    // Track violation for gamification
  lastViolationTs = Date.now();
  await chrome.storage.local.set({ lastViolation: lastViolationTs });

    // Award negative XP immediately
    awardXp({ trackers: 0, csp: false, cors: false, blocked: true, violation: true });
    
    // (Streak UI removed) – no broadcast
    
    // Redirect to blocking page with explanation
    const blockUrl = chrome.runtime.getURL("blocked.html") + 
      `?reason=${encodeURIComponent(enforcement.reason)}` +
      `&category=${encodeURIComponent(enforcement.rule.category || "restricted")}`;
    chrome.tabs.update(details.tabId, { url: blockUrl });
  } else {
    // Count navigation as activity
  // Activity accumulation removed
  }
});

// On navigation complete, emit audit record
chrome.webNavigation.onCompleted.addListener(async (nav) => {
  try {
    const st = ensureTab(nav.tabId);
    const tab = await chrome.tabs.get(nav.tabId);
    if (!tab?.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) return;

    // Mark activity on successful load
  // Legacy streak tracking removed

    const origin = new URL(tab.url).origin;
    const originHash = await sha256Hex(origin);

    const record = {
      origin_hash: originHash,
      ts_iso: new Date().toISOString(),
      check_type: "page_audit_v2",
      policy_state: {
        csp_present: !!st.lastCsp,
        cors_signals: !!st.lastCors,
        tracker_count: st.trackerCount,
        trackers_by_category: st.trackersByCategory,
        blocked: st.blocked ? true : false
      },
      client: { ua_major: navigator.userAgentData?.brands?.[0]?.version || "n/a" }
    };

  // Capture metrics before reset for XP logic
  const navTrackers = st.trackerCount;
  const navTrackersByCat = { ...st.trackersByCategory };
  // Reset for next navigation
  st.trackerCount = 0;
  st.trackersByCategory = {};

    const { gc_backend_url, gc_api_token } = await chrome.storage.local.get(["gc_backend_url", "gc_api_token"]);
    if (!gc_backend_url) return;
    
    const submitUrl = `${gc_backend_url.replace(/\/+$/, "")}/audit/submit?tab_id=${nav.tabId}`;

    await fetch(submitUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": gc_api_token ? `Bearer ${gc_api_token}` : ""
      },
      body: JSON.stringify(record),
      keepalive: true
    }).catch(() => {});

    // Local fast-feedback XP award
    awardXp({
      trackers: navTrackers,
      csp: record.policy_state.csp_present,
      cors: record.policy_state.cors_signals,
      blocked: record.policy_state.blocked,
      violation: false
    });
  } catch (e) {
    console.error("Audit submit error:", e);
  }
});

// Clean up tab state
chrome.tabs.onRemoved.addListener((tabId) => {
  tabState.delete(tabId);
});

// Fetch risk score from backend

// Fetch audit stats
async function fetchStats() {
  try {
    const { gc_backend_url, gc_api_token } = await chrome.storage.local.get(["gc_backend_url", "gc_api_token"]);
    if (!gc_backend_url) return;

    const url = `${gc_backend_url.replace(/\/+$/, "")}/audit/stats`;
    const response = await fetch(url, {
      headers: {
        "Authorization": gc_api_token ? `Bearer ${gc_api_token}` : ""
      }
    });

    if (response.ok) {
      const stats = await response.json();
      console.log("Stats updated:", stats);
      
      // Notify UIs
      chrome.runtime.sendMessage({
        type: "stats:update",
        stats: stats
      }).catch(() => {});
    }
  } catch (e) {
    console.error("Failed to fetch stats:", e);
  }
}

// Update safe streak calculation - tracks active browsing time

// Track activity: consider navigation complete, focused window, or periodic ticks as activity

// Heartbeat, streak calculation, and time-left nudges removed (XP-only system)

// Periodic background updates (debounced polling)
let updateTimer = null;
async function scheduleBackgroundUpdate() {
  if (updateTimer) return; // Already scheduled
  updateTimer = setTimeout(async () => {
    await Promise.all([
      fetchRules(),
      fetchStats()
    ]);
    
    // No streak/risk broadcast
    
    updateTimer = null;
    
    // Schedule next update in 30 seconds
    setTimeout(scheduleBackgroundUpdate, 30000);
  }, 1000);
}

// Fetch rules on startup and periodically
chrome.runtime.onInstalled.addListener(() => {
  console.log("GuardianCore Audit Probe installed");
  loadFastMode();
  loadXpState();
  fetchRules();
  scheduleBackgroundUpdate();
});

chrome.runtime.onStartup.addListener(() => {
  loadFastMode();
  loadXpState();
  fetchRules();
  scheduleBackgroundUpdate();
});

// When popup opens, trigger immediate refresh
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "popup") {
    scheduleBackgroundUpdate();
  }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_TAB_STATE") {
    const state = tabState.get(message.tabId);
    sendResponse(state || null);
  } else if (message.type === "REFRESH_RULES") {
    fetchRules().then(() => sendResponse({ ok: true }));
    return true; // Async response
  } else if (message.type === "CHECK_TIME_NUDGE") {
    sendResponse({ ok: true }); // deprecated
  // --- Dev/Test message handlers ---
  } else if (message.type === "DEV_TOGGLE_FAST_MODE") {
    fastMode = !fastMode;
    chrome.storage.local.set({ gc_fast_mode: fastMode });
    sendResponse({ ok: true, fastMode });
  } else if (message.type === "DEV_SIMULATE_VIOLATION") {
    lastViolationTs = Date.now();
    chrome.storage.local.set({ lastViolation: lastViolationTs }).then(() => sendResponse({ ok: true }));
    return true;
  } else if (message.type === "GET_XP_STATE") {
    ensureXpDay();
    sendResponse({ xp: xpState.xp, level: xpState.level, progress: xpState.xp / 100 });
  } else if (message.type === "DEV_RESET_XP") {
    xpState.xp = 0; xpState.level = 1; persistXp();
    chrome.runtime.sendMessage({ type: "xp:update", xp: xpState.xp, level: xpState.level, progress: 0, delta: 0 }).catch(() => {});
    sendResponse({ ok: true });
  }
});
