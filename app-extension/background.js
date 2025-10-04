// GuardianCore Audit Probe - Background Service Worker with Rule Enforcement
// Week 4: Real-time updates, gamification cues, risk scoring
console.log("GuardianCore Audit Probe v0.4.0 loaded");

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

// Gamification state (local only)
let gamificationState = {
  lastViolation: null,  // Timestamp of last blocked event
  safeStreakHours: 0,   // Hours since last violation
  riskScore: 0,         // Cached from backend
  lastRiskUpdate: 0     // Timestamp of last risk fetch
};

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
    gamificationState.lastViolation = Date.now();
    gamificationState.safeStreakHours = 0;
    await chrome.storage.local.set({ lastViolation: gamificationState.lastViolation });
    
    // Notify UIs about streak reset
    chrome.runtime.sendMessage({
      type: "nudge:streak",
      hours: 0,
      violation: true
    }).catch(() => {});
    
    // Redirect to blocking page with explanation
    const blockUrl = chrome.runtime.getURL("blocked.html") + 
      `?reason=${encodeURIComponent(enforcement.reason)}` +
      `&category=${encodeURIComponent(enforcement.rule.category || "restricted")}`;
    chrome.tabs.update(details.tabId, { url: blockUrl });
  }
});

// On navigation complete, emit audit record
chrome.webNavigation.onCompleted.addListener(async (nav) => {
  try {
    const st = ensureTab(nav.tabId);
    const tab = await chrome.tabs.get(nav.tabId);
    if (!tab?.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) return;

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

    // Reset counters
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
  } catch (e) {
    console.error("Audit submit error:", e);
  }
});

// Clean up tab state
chrome.tabs.onRemoved.addListener((tabId) => {
  tabState.delete(tabId);
});

// Fetch risk score from backend
async function fetchRiskScore() {
  try {
    const { gc_backend_url, gc_api_token } = await chrome.storage.local.get(["gc_backend_url", "gc_api_token"]);
    if (!gc_backend_url) return;

    const url = `${gc_backend_url.replace(/\/+$/, "")}/risk/score`;
    const response = await fetch(url, {
      headers: {
        "Authorization": gc_api_token ? `Bearer ${gc_api_token}` : ""
      }
    });

    if (response.ok) {
      const data = await response.json();
      gamificationState.riskScore = data.score;
      gamificationState.lastRiskUpdate = Date.now();
      console.log("Risk score updated:", data.score);
      
      // Notify UIs
      chrome.runtime.sendMessage({
        type: "risk:update",
        score: data.score,
        breakdown: data.inputs_breakdown
      }).catch(() => {}); // Ignore if no listeners
    }
  } catch (e) {
    console.error("Failed to fetch risk score:", e);
  }
}

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
function updateSafeStreak() {
  // Get browser start time and last violation
  chrome.storage.local.get(["browserStartTime", "lastViolation"]).then(({ browserStartTime, lastViolation }) => {
    const now = Date.now();
    const timeUnitMs = fastMode ? (1000 * 60) : (1000 * 60 * 60); // minute vs hour
    
    // Initialize browser start time if not set
    if (!browserStartTime) {
      chrome.storage.local.set({ browserStartTime: now });
      gamificationState.safeStreakHours = 0;
      return;
    }
    
    // If there's a recent violation, calculate from violation time
    if (lastViolation && lastViolation > browserStartTime) {
      const hoursSinceViolation = Math.floor((now - lastViolation) / timeUnitMs);
      gamificationState.safeStreakHours = Math.min(hoursSinceViolation, 999);
      gamificationState.lastViolation = lastViolation;
    } else {
      // No violations or old violation - calculate from browser start
      const hoursSinceStart = Math.floor((now - browserStartTime) / timeUnitMs);
      gamificationState.safeStreakHours = Math.min(hoursSinceStart, 999);
    }
  });
}

function calculateStreak() {
  updateSafeStreak();
}

// Check for time-left nudges
function checkTimeLeftNudges() {
  const timeCheck = isInBlockedTimeWindow();
  if (!timeCheck.blocked) {
    // Not in a time window - check if one is coming soon
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    
    for (const rule of rulesCache.time_window) {
      try {
        const config = JSON.parse(rule.pattern);
        const startHour = config.start_hour || 0;
        
        // Check if we're within 15 minutes of window start
        const minutesUntilStart = (startHour * 60) - (currentHour * 60 + currentMinute);
        
        if (minutesUntilStart > 0 && minutesUntilStart <= 15) {
          // Send nudge
          chrome.runtime.sendMessage({
            type: "nudge:timeleft",
            minutes: minutesUntilStart,
            rule: rule
          }).catch(() => {});
          
          break;
        }
      } catch (e) {
        // Ignore malformed rules
      }
    }
  }
}

// Periodic background updates (debounced polling)
let updateTimer = null;
function scheduleBackgroundUpdate() {
  if (updateTimer) return; // Already scheduled
  
  updateTimer = setTimeout(async () => {
    await Promise.all([
      fetchRules(),
      fetchRiskScore(),
      fetchStats()
    ]);
    
    updateSafeStreak();
    
    // Notify UIs about streak update
    chrome.runtime.sendMessage({
      type: "nudge:streak",
      hours: gamificationState.safeStreakHours
    }).catch(() => {});
    
    updateTimer = null;
    
    // Schedule next update in 30 seconds
    setTimeout(scheduleBackgroundUpdate, 30000);
  }, 1000);
}

// Fetch rules on startup and periodically
chrome.runtime.onInstalled.addListener(() => {
  console.log("GuardianCore Audit Probe installed");
  loadFastMode();
  fetchRules();
  updateSafeStreak();
  scheduleBackgroundUpdate();
});

chrome.runtime.onStartup.addListener(() => {
  loadFastMode();
  fetchRules();
  updateSafeStreak();
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
  } else if (message.type === "GET_GAMIFICATION_STATE") {
    updateSafeStreak();
    sendResponse({
      safeStreakHours: gamificationState.safeStreakHours,
      riskScore: gamificationState.riskScore,
      lastUpdate: gamificationState.lastRiskUpdate
    });
  } else if (message.type === "CHECK_TIME_NUDGE") {
    checkTimeLeftNudges();
    sendResponse({ ok: true });
  // --- Dev/Test message handlers ---
  } else if (message.type === "DEV_TOGGLE_FAST_MODE") {
    fastMode = !fastMode;
    chrome.storage.local.set({ gc_fast_mode: fastMode });
    updateSafeStreak();
    chrome.runtime.sendMessage({ type: "nudge:streak", hours: gamificationState.safeStreakHours }).catch(() => {});
    sendResponse({ ok: true, fastMode });
  } else if (message.type === "DEV_SIMULATE_VIOLATION") {
    const now = Date.now();
    gamificationState.lastViolation = now;
    chrome.storage.local.set({ lastViolation: now }).then(() => {
      updateSafeStreak();
      chrome.runtime.sendMessage({ type: "nudge:streak", hours: gamificationState.safeStreakHours, violation: true }).catch(() => {});
      sendResponse({ ok: true });
    });
    return true;
  } else if (message.type === "DEV_ADD_SAFE_TIME") {
    const hours = message.hours || 1;
    chrome.storage.local.get(["browserStartTime", "lastViolation"]).then(({ browserStartTime, lastViolation }) => {
      const timeUnitMs = fastMode ? (1000 * 60) : (1000 * 60 * 60);
      const delta = hours * timeUnitMs;
      if (lastViolation && (!browserStartTime || lastViolation > browserStartTime)) {
        const newViolation = lastViolation - delta;
        chrome.storage.local.set({ lastViolation: newViolation }).then(() => {
          updateSafeStreak();
          chrome.runtime.sendMessage({ type: "nudge:streak", hours: gamificationState.safeStreakHours }).catch(() => {});
          sendResponse({ ok: true });
        });
      } else {
        const base = browserStartTime || Date.now();
        const newStart = base - delta;
        chrome.storage.local.set({ browserStartTime: newStart }).then(() => {
          updateSafeStreak();
          chrome.runtime.sendMessage({ type: "nudge:streak", hours: gamificationState.safeStreakHours }).catch(() => {});
          sendResponse({ ok: true });
        });
      }
    });
    return true; // async
  } else if (message.type === "DEV_FETCH_RISK") {
    fetchRiskScore().then(() => sendResponse({ ok: true, score: gamificationState.riskScore })).catch(() => sendResponse({ ok: false }));
    return true;
  }
});
