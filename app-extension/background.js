// GuardianCore Audit Probe - Background Service Worker with Rule Enforcement
console.log("GuardianCore Audit Probe v0.3.0 loaded");

// Expanded tracker list with categories
const TRACKERS = {
  "google-analytics.com": { category: "analytics", name: "Google Analytics" },
  "doubleclick.net": { category: "advertising", name: "DoubleClick" },
  "facebook.net": { category: "social_media", name: "Facebook" },
  "googletagmanager.com": { category: "analytics", name: "Google Tag Manager" },
  "adservice.google.com": { category: "advertising", name: "Google Ads" },
  "googlesyndication.com": { category: "advertising", name: "Google AdSense" },
  "googleadservices.com": { category: "advertising", name: "Google Ad Services" },
  "facebook.com": { category: "social_media", name: "Facebook" },
  "connect.facebook.net": { category: "social_media", name: "Facebook Connect" },
  "analytics.google.com": { category: "analytics", name: "Google Analytics" },
  "googletagservices.com": { category: "advertising", name: "Google Tag Services" },
  "twitter.com": { category: "social_media", name: "Twitter" },
  "instagram.com": { category: "social_media", name: "Instagram" },
  "tiktok.com": { category: "social_media", name: "TikTok" },
  "snapchat.com": { category: "social_media", name: "Snapchat" },
  "youtube.com": { category: "video", name: "YouTube" },
  "amazon-adsystem.com": { category: "advertising", name: "Amazon Ads" },
  "criteo.com": { category: "advertising", name: "Criteo" },
  "outbrain.com": { category: "advertising", name: "Outbrain" },
  "taboola.com": { category: "advertising", name: "Taboola" }
};

// In-memory per-tab state
const tabState = new Map(); // tabId -> { trackerCount, trackersByCategory, lastCsp, lastCors, blocked }

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

// Fetch rules on startup and periodically
chrome.runtime.onInstalled.addListener(() => {
  console.log("GuardianCore Audit Probe installed");
  fetchRules();
});

chrome.runtime.onStartup.addListener(() => {
  fetchRules();
});

// Refresh rules every 5 minutes
setInterval(fetchRules, 5 * 60 * 1000);

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_TAB_STATE") {
    const state = tabState.get(message.tabId);
    sendResponse(state || null);
  } else if (message.type === "REFRESH_RULES") {
    fetchRules().then(() => sendResponse({ ok: true }));
    return true; // Async response
  }
});
