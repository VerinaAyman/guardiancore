// GuardianCore Audit Probe - Background Service Worker with Rule Enforcement
// Phase 7: Intelligent Content Classification with AI
console.log("GuardianCore Audit Probe v0.6.0 loaded");

// ========== AUTHENTICATION STATE ==========
let currentUser = null; // { user_id, account_type, token, username }

async function ensureDefaultConfig() {
  try {
    const { gc_backend_url, gc_api_token, gc_config_initialized } = await chrome.storage.local.get([
      'gc_backend_url', 'gc_api_token', 'gc_config_initialized'
    ]);
    if (!gc_config_initialized) {
      const defaults = {};
      if (!gc_backend_url) {
        defaults.gc_backend_url = 'https://guardiancore.onrender.com';
        console.log("[Config] Auto-configured backend URL: https://guardiancore.onrender.com");
      }
      if (!gc_api_token) {
        defaults.gc_api_token = 'dev-token-123';
        console.log("[Config] Auto-configured dev token: dev-token-123");
      }
      defaults.gc_config_initialized = true;
      await chrome.storage.local.set(defaults);
      console.log("[Config] ✅ Default configuration applied");
    } else {
      console.log("[Config] Configuration already initialized");
    }
  } catch (error) {
    console.error("[Config] Failed to ensure default config:", error);
  }
}

function getTokenExpiry(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000;
  } catch {
    return null;
  }
}

async function scheduleTokenRefresh() {
  const { gc_auth_token } = await chrome.storage.local.get('gc_auth_token');
  if (!gc_auth_token) return;
  const expiry = getTokenExpiry(gc_auth_token);
  if (!expiry) return;
  const msUntilRefresh = expiry - Date.now() - (60 * 60 * 1000);
  if (msUntilRefresh <= 0) {
    console.log("[Auth] Token expired or expiring soon - clearing");
    await chrome.storage.local.remove(['gc_auth_token', 'gc_user_id', 'gc_account_type', 'gc_username', 'gc_email']);
    currentUser = null;
    return;
  }
  console.log(`[Auth] Token refresh scheduled in ${Math.round(msUntilRefresh / 3600000)}h`);
  setTimeout(async () => {
    console.log("[Auth] Token expiring soon - re-verifying");
    await initializeAuth();
  }, msUntilRefresh);
}

async function initializeAuth() {
  console.log("[Auth] ========================================");
  console.log("[Auth] Initializing authentication...");
  const { gc_auth_token, gc_user_id, gc_account_type, gc_username } = await chrome.storage.local.get([
    'gc_auth_token', 'gc_user_id', 'gc_account_type', 'gc_username'
  ]);
  console.log("[Auth] Storage values:", {
    hasToken: !!gc_auth_token,
    user_id: gc_user_id,
    account_type: gc_account_type,
    username: gc_username
  });
  if (!gc_auth_token) {
    console.log("[Auth] No token found - user needs to log in");
    console.log("[Auth] ========================================");
    const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL('login.html') });
    if (tabs.length === 0) chrome.tabs.create({ url: chrome.runtime.getURL('login.html') });
    return false;
  }
  try {
    const { gc_backend_url } = await chrome.storage.local.get('gc_backend_url');
    const backendUrl = gc_backend_url || 'https://guardiancore.onrender.com';
    const response = await fetch(`${backendUrl}/auth/verify`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${gc_auth_token}` }
    });
    if (!response.ok) {
      console.log("[Auth] Token expired or invalid - clearing auth");
      await chrome.storage.local.remove(['gc_auth_token', 'gc_user_id', 'gc_account_type', 'gc_username', 'gc_email']);
      const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL('login.html') });
      if (tabs.length === 0) chrome.tabs.create({ url: chrome.runtime.getURL('login.html') });
      return false;
    }
    currentUser = {
      user_id: gc_user_id,
      account_type: gc_account_type,
      token: gc_auth_token,
      username: gc_username
    };
    console.log(`[Auth] ✅ Authenticated as ${gc_account_type}: ${gc_username} (ID: ${gc_user_id})`);
    console.log("[Auth] currentUser object set:", currentUser);
    await loadXpState();
    if (gc_account_type === 'child') {
      console.log("[Auth] Child account detected - loading rules NOW");
      await loadChildRules(gc_user_id, gc_auth_token);
      console.log("[Auth] Rules loaded. Rules cache state:", {
        allowlist: rulesCache.allowlist.length,
        blocklist: rulesCache.blocklist.length,
        time_window: rulesCache.time_window.length
      });
      await updateDynamicBlockingRules();
    } else {
      console.log("[Auth] Parent account - no rules enforced");
      rulesCache = { allowlist: [], blocklist: [], time_window: [], lastFetch: Date.now() };
      await updateDynamicBlockingRules();
    }
    await scheduleTokenRefresh();
    console.log("[Auth] ========================================");
    return true;
  } catch (error) {
    console.error("[Auth] Failed to verify token:", error);
    return false;
  }
}

let fastMode = false;
async function loadFastMode() {
  try {
    const { gc_fast_mode } = await chrome.storage.local.get(["gc_fast_mode"]);
    fastMode = !!gc_fast_mode;
    if (fastMode) console.log("[Gamification] FAST MODE enabled (1 minute = 1 hour)");
  } catch (e) {}
}

(async () => {
  await loadFastMode();
  await initializeAuth();
})();

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

const tabState = new Map();
const recentNavigations = new Map();
const XP_COOLDOWN_MS = 30000;
let lastViolationTs = null;
let blockingAvailable = true;

let xpState = { dayKey: null, xp: 0, level: 1 };

async function loadXpState() {
  try {
    if (!currentUser) return;
    const storageKey = `gc_xp_${currentUser.user_id}`;
    const result = await chrome.storage.local.get([storageKey]);
    xpState = result[storageKey] || { dayKey: null, xp: 0, level: 1 };
    ensureXpDay();
  } catch (error) {
    console.error("[XP] Failed to load XP state:", error);
  }
}

function ensureXpDay() {
  const today = new Date().toISOString().slice(0,10);
  if (xpState.dayKey !== today) {
    xpState.dayKey = today;
    xpState.xp = 0;
    persistXp();
  }
}

function persistXp() {
  if (!currentUser) return;
  chrome.storage.local.set({ [`gc_xp_${currentUser.user_id}`]: xpState });
}

function awardXp(event) {
  ensureXpDay();
  let delta = 1;
  if (event.csp) delta += 2;
  if (event.cors) delta += 1;
  if (event.trackers === 0) delta += 3; else delta -= Math.min(event.trackers, 5) * 0.5;
  if (event.blocked || event.violation) delta -= 5;
  if (delta < 0) delta = Math.max(delta, -5);
  if (fastMode) delta *= 3;
  xpState.xp += delta;
  if (xpState.xp < 0) xpState.xp = 0;
  while (xpState.xp >= 100) { xpState.xp -= 100; xpState.level += 1; }
  persistXp();
  chrome.runtime.sendMessage({
    type: "xp:update", xp: xpState.xp, level: xpState.level,
    progress: xpState.xp / 100, delta
  }).catch(() => {});
}

// ========== ACTIVITY TRACKING ==========

function extractDomain(url) {
  try {
    const parsed = new URL(url);
    const parts = parsed.hostname.split('.');
    return parts.length >= 2 ? parts.slice(-2).join('.') : parsed.hostname;
  } catch (e) { return null; }
}

const domainTimeTracking = new Map();

async function captureActivityEvent(eventType, domain, additionalData = {}) {
  try {
    if (!currentUser || currentUser.account_type !== 'child') return;
    const { gc_backend_url } = await chrome.storage.local.get('gc_backend_url');
    const backendUrl = gc_backend_url || 'https://guardiancore.onrender.com';
    const response = await fetch(`${backendUrl}/activity/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentUser.token}` },
      body: JSON.stringify({ domain, event_type: eventType, ...additionalData })
    });
    if (response.ok) {
      const result = await response.json();
      if (result.stored) console.log(`[Activity] Captured ${eventType} event for ${domain}`);
    }
  } catch (error) {
    console.debug("[Activity] Failed to capture event:", error);
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    const domain = extractDomain(tab.url);
    if (!domain) return;
    if (domainTimeTracking.has(tabId)) {
      const prev = domainTimeTracking.get(tabId);
      const timeSpent = Math.floor((Date.now() - prev.startTime) / 1000);
      if (timeSpent >= 5) {
        const tabData = ensureTab(tabId);
        captureActivityEvent('time_spent', prev.domain, { duration_seconds: timeSpent, has_csp: tabData.lastCsp, has_cors: tabData.lastCors });
      }
    }
    domainTimeTracking.set(tabId, { domain, startTime: Date.now() });
    const tabData = ensureTab(tabId);
    captureActivityEvent('visit', domain, { has_csp: tabData.lastCsp, has_cors: tabData.lastCors });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (domainTimeTracking.has(tabId)) {
    const prev = domainTimeTracking.get(tabId);
    const timeSpent = Math.floor((Date.now() - prev.startTime) / 1000);
    if (timeSpent >= 5) {
      const tabData = ensureTab(tabId);
      captureActivityEvent('time_spent', prev.domain, { duration_seconds: timeSpent, has_csp: tabData.lastCsp, has_cors: tabData.lastCors });
    }
    domainTimeTracking.delete(tabId);
  }
  tabState.delete(tabId);
});

async function captureBlockedAttempt(url, category, reason) {
  const domain = extractDomain(url);
  if (!domain) return;
  await captureActivityEvent('blocked', domain, { blocked_category: category || 'unknown' });
}

function ensureTab(tid) {
  if (!tabState.has(tid)) {
    tabState.set(tid, { trackerCount: 0, trackersByCategory: {}, lastCsp: false, lastCors: false, blocked: null });
  }
  return tabState.get(tid);
}

async function sha256Hex(str) {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

let rulesCache = { allowlist: [], blocklist: [], time_window: [], lastFetch: 0 };

async function loadChildRules(childId, token) {
  try {
    const { gc_backend_url } = await chrome.storage.local.get('gc_backend_url');
    const backendUrl = gc_backend_url || 'https://guardiancore.onrender.com';
    const url = `${backendUrl}/accounts/rules/combined/child/${childId}`;
    console.log("[Rules] Fetching combined rules from:", url);
    const response = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!response.ok) {
      console.error("[Rules] Failed to load child rules:", response.status, response.statusText);
      return;
    }
    const rules = await response.json();
    console.log("[Rules] Raw rules fetched:", rules);
    const enabledRules = rules.filter(r => r.enabled);
    rulesCache = {
      allowlist: enabledRules.filter(r => r.rule_type === "allowlist"),
      blocklist: enabledRules.filter(r => r.rule_type === "blocklist"),
      time_window: enabledRules.filter(r => r.rule_type === "time_window"),
      lastFetch: Date.now()
    };
    console.log("[Rules] Child rules loaded:", {
      total: rules.length, enabled: enabledRules.length,
      allowlist: rulesCache.allowlist.length, blocklist: rulesCache.blocklist.length,
      time_window: rulesCache.time_window.length
    });
    console.log("[Rules] Blocklist rules:", rulesCache.blocklist);
    await updateDynamicBlockingRules();
  } catch (error) {
    console.error("[Rules] Failed to load child rules:", error);
  }
}

async function fetchRules() {
  console.warn("[Rules] fetchRules() is deprecated - use loadChildRules() instead");
  if (currentUser && currentUser.account_type === 'child') {
    await loadChildRules(currentUser.user_id, currentUser.token);
  }
}

function matchesPattern(url, pattern) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return hostname === pattern || hostname.endsWith("." + pattern);
  } catch { return false; }
}

function evaluateTimeWindows(url) {
  const now = new Date();
  const currentHour = now.getHours();
  const currentDay = now.getDay();
  const hostname = (()=>{ try { return new URL(url).hostname.replace(/^www\./,''); } catch { return ''; } })();
  const domainAllowWindows = [], domainBlockWindows = [], globalBlockWindows = [];

  for (const rule of rulesCache.time_window) {
    try {
      let cfg;
      try {
        cfg = JSON.parse(rule.pattern);
      } catch (jsonError) {
        const parts = rule.pattern.split('|');
        if (parts.length >= 3) {
          const domain = parts[0].trim();
          const daysStr = parts[1].trim();
          const hoursStr = parts[2].trim();
          const dayMap = {'Sun':0,'Mon':1,'Tue':2,'Wed':3,'Thu':4,'Fri':5,'Sat':6};
          const days = daysStr.split(',').map(d => dayMap[d.trim()]).filter(d => d !== undefined);
          const [startTime, endTime] = hoursStr.split('-');
          const [startHour, startMin] = startTime.split(':').map(s => parseInt(s));
          const [endHour, endMin] = endTime.split(':').map(s => parseInt(s));
          cfg = {
            domain: (domain && domain !== '*') ? domain : null,
            days: days.length > 0 ? days : [0,1,2,3,4,5,6],
            start_hour: startHour, start_min: startMin || 0,
            end_hour: endHour, end_min: endMin || 0, action: 'block'
          };
        } else { throw new Error('Invalid pipe format'); }
      }
      if (cfg.days && !cfg.days.includes(currentDay)) continue;
      const startHour = cfg.start_hour ?? 0, startMin = cfg.start_min ?? 0;
      const endHour = cfg.end_hour ?? 24, endMin = cfg.end_min ?? 0;
      const currentTimeInMinutes = currentHour * 60 + now.getMinutes();
      const startTimeInMinutes = startHour * 60 + startMin;
      const endTimeInMinutes = endHour * 60 + endMin;
      const inWindow = startTimeInMinutes > endTimeInMinutes
        ? (currentTimeInMinutes >= startTimeInMinutes || currentTimeInMinutes < endTimeInMinutes)
        : (currentTimeInMinutes >= startTimeInMinutes && currentTimeInMinutes < endTimeInMinutes);
      const action = cfg.action === 'allow' ? 'allow' : 'block';
      if (cfg.domain && cfg.domain !== '*') {
        const matchesDomain = hostname === cfg.domain || hostname.endsWith('.' + cfg.domain);
        if (!matchesDomain) continue;
        if (action === 'allow') domainAllowWindows.push({ rule, inWindow });
        else domainBlockWindows.push({ rule, inWindow });
      } else {
        if (action === 'block') globalBlockWindows.push({ rule, inWindow });
      }
    } catch (e) { console.error('[TimeWindow] Invalid time window rule:', rule.pattern, e); }
  }

  if (domainAllowWindows.length) {
    if (domainAllowWindows.some(w => w.inWindow)) return { allowed: true, reason: 'Allowed (scheduled allow window)' };
    const rule = domainAllowWindows[0].rule;
    return { blocked: true, rule, reason: rule.explanation || 'Outside allowed time window' };
  }
  if (domainBlockWindows.some(w => w.inWindow)) {
    const rule = domainBlockWindows.find(w => w.inWindow).rule;
    return { blocked: true, rule, reason: rule.explanation || 'Blocked during scheduled window' };
  }
  if (globalBlockWindows.some(w => w.inWindow)) {
    const rule = globalBlockWindows.find(w => w.inWindow).rule;
    return { blocked: true, rule, reason: rule.explanation || 'Blocked (global time window)' };
  }
  return { allowed: true };
}

function enforceRules(url, tabId) {
  if (!currentUser || currentUser.account_type !== 'child') return { allowed: true };
  console.log("[Rules] Enforcing rules on CHILD account:", url);
  for (const rule of rulesCache.allowlist) {
    if (matchesPattern(url, rule.pattern)) { console.log("[Rules] Allowed by allowlist rule:", rule.pattern); return { allowed: true }; }
  }
  const schedule = evaluateTimeWindows(url);
  if (schedule.blocked) {
    console.log("[Rules] Blocked by time window:", schedule);
    const state = ensureTab(tabId);
    state.blocked = { reason: schedule.rule?.explanation || schedule.reason, rule: schedule.rule, timestamp: Date.now() };
    return { blocked: true, reason: state.blocked.reason, rule: schedule.rule };
  } else if (schedule.allowed === true && schedule.reason) { return { allowed: true }; }
  for (const rule of rulesCache.blocklist) {
    if (matchesPattern(url, rule.pattern)) {
      console.log("[Rules] BLOCKED by blocklist rule:", rule.pattern);
      const state = ensureTab(tabId);
      state.blocked = { reason: rule.explanation || `Blocked: ${rule.category || "restricted content"}`, rule, timestamp: Date.now() };
      return { blocked: true, reason: state.blocked.reason, rule };
    }
  }
  console.log("[Rules] No matching rules - allowing");
  return { allowed: true };
}

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
    } catch (e) {}
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0 || !details.responseHeaders) return;
    const st = ensureTab(details.tabId);
    const h = Object.create(null);
    for (const { name, value } of details.responseHeaders) h[name.toLowerCase()] = (value || "");
    st.lastCsp = Boolean(h["content-security-policy"]);
    st.lastCors = Boolean(h["access-control-allow-origin"]) || (h["vary"] || "").includes("Origin");
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

async function updateDynamicBlockingRules() {
  if (!currentUser || currentUser.account_type !== 'child') {
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    if (existingRules.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existingRules.map(r => r.id) });
    }
    return;
  }
  console.log("[DNR] Building blocking rules for child account");
  const dnrRules = [];
  let ruleId = 1;
  for (const rule of rulesCache.blocklist) {
    const pattern = rule.pattern.toLowerCase();
    let urlFilter;
    if (pattern.startsWith('*.')) urlFilter = `*://${pattern.substring(2)}/*`;
    else if (!pattern.includes('/')) urlFilter = `*://*${pattern}/*`;
    else urlFilter = pattern;
    const redirectUrl = chrome.runtime.getURL("blocked.html") +
      `?category=${encodeURIComponent(rule.category || "blocked_keyword")}` +
      `&reason=${encodeURIComponent(rule.explanation || '')}` +
      `&url=`;
    dnrRules.push({
      id: ruleId++, priority: 1,
      action: { type: "redirect", redirect: { url: redirectUrl } },
      condition: { urlFilter, resourceTypes: ["main_frame"] }
    });
    console.log(`[DNR] Rule ${ruleId - 1}: Block ${urlFilter}`);
  }
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existingRules.map(r => r.id),
    addRules: dnrRules
  });
  console.log(`[DNR] Applied ${dnrRules.length} blocking rules`);
}

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;
  if (!currentUser || currentUser.account_type !== 'child') return;
  const url = details.url.toLowerCase();
  for (const rule of rulesCache.blocklist) {
    if (matchesPattern(url, rule.pattern)) {
      console.log("[Violation] Child attempted to access blocked site:", details.url);
      lastViolationTs = Date.now();
      chrome.storage.local.set({ lastViolation: lastViolationTs });
      awardXp({ trackers: 0, csp: false, cors: false, blocked: true, violation: true });
      await captureBlockedAttempt(details.url, rule.category, rule.explanation);
      break;
    }
  }
});

chrome.webRequest.onErrorOccurred?.addListener?.((info) => {
  if (info.error && /blocked/i.test(info.error) && info.error.includes('permission')) {
    blockingAvailable = false;
    console.warn('[Blocking] webRequest blocking appears unavailable; activating fallback');
  }
}, { urls: ["<all_urls>"] });

chrome.webNavigation.onBeforeNavigate.addListener((nav) => {
  if (!currentUser || currentUser.account_type !== 'child') return;
  if (nav.frameId !== 0) return;
  if (nav.url.startsWith('chrome://') || nav.url.startsWith('chrome-extension://')) return;
  for (const rule of rulesCache.allowlist) {
    if (matchesPattern(nav.url, rule.pattern)) { console.log("[Blocking] ✅ Allowed by allowlist rule:", rule.pattern); return; }
  }
  const schedule = evaluateTimeWindows(nav.url);
  if (schedule.blocked) {
    console.log("[Blocking] ⏰ Time window blocking:", nav.url, schedule.reason);
    chrome.tabs.update(nav.tabId, {
      url: chrome.runtime.getURL("blocked.html") +
        `?reason=${encodeURIComponent(schedule.reason || 'Outside allowed time window')}` +
        `&category=time_restriction&url=${encodeURIComponent(nav.url)}`
    });
  }
});

chrome.webNavigation.onCompleted.addListener(async (nav) => {
  try {
    const st = ensureTab(nav.tabId);
    const tab = await chrome.tabs.get(nav.tabId);
    if (!tab?.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) return;
    const origin = new URL(tab.url).origin;
    const originHash = await sha256Hex(origin);
    const record = {
      origin_hash: originHash, ts_iso: new Date().toISOString(), check_type: "page_audit_v2",
      policy_state: {
        csp_present: !!st.lastCsp, cors_signals: !!st.lastCors,
        tracker_count: st.trackerCount, trackers_by_category: st.trackersByCategory,
        blocked: st.blocked ? true : false
      },
      client: { ua_major: navigator.userAgentData?.brands?.[0]?.version || "n/a" }
    };
    const navTrackers = st.trackerCount;
    st.trackerCount = 0; st.trackersByCategory = {};
    const { gc_backend_url } = await chrome.storage.local.get(["gc_backend_url"]);
    if (!gc_backend_url) return;
    if (currentUser) record.user_id = currentUser.user_id;
    await fetch(`${gc_backend_url.replace(/\/+$/, "")}/audit/submit?tab_id=${nav.tabId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": currentUser ? `Bearer ${currentUser.token}` : "" },
      body: JSON.stringify(record), keepalive: true
    }).catch(() => {});
    const now = Date.now();
    const lastAwarded = recentNavigations.get(tab.url) || 0;
    if (now - lastAwarded >= XP_COOLDOWN_MS) {
      awardXp({ trackers: navTrackers, csp: record.policy_state.csp_present, cors: record.policy_state.cors_signals, blocked: record.policy_state.blocked, violation: false });
      recentNavigations.set(tab.url, now);
      if (recentNavigations.size > 100) recentNavigations.delete(recentNavigations.keys().next().value);
    } else {
      console.log(`[XP] Cooldown active for ${tab.url} (${Math.round((XP_COOLDOWN_MS - (now - lastAwarded)) / 1000)}s remaining)`);
    }
  } catch (e) { console.error("Audit submit error:", e); }
});

chrome.tabs.onRemoved.addListener((tabId) => { tabState.delete(tabId); });

async function fetchStats() {
  try {
    if (!currentUser) return;
    const { gc_backend_url } = await chrome.storage.local.get(["gc_backend_url"]);
    if (!gc_backend_url) return;
    const response = await fetch(`${gc_backend_url.replace(/\/+$/, "")}/audit/stats`, {
      headers: { "Authorization": `Bearer ${currentUser.token}` }
    });
    if (response.ok) {
      const stats = await response.json();
      console.log("[Stats] Stats updated:", stats);
      chrome.runtime.sendMessage({ type: "stats:update", stats }).catch(() => {});
    } else {
      console.error("[Stats] Failed to fetch stats:", response.status, response.statusText);
      if (response.status === 401) chrome.runtime.sendMessage({ type: 'stats:error', error: 'unauthorized' }).catch(()=>{});
    }
  } catch (e) { console.error("[Stats] Failed to fetch stats:", e); }
}

let updateTimer = null;
async function scheduleBackgroundUpdate() {
  if (updateTimer) return;
  updateTimer = setTimeout(async () => {
    if (currentUser) {
      if (currentUser.account_type === 'child') await loadChildRules(currentUser.user_id, currentUser.token);
      await fetchStats();
    }
    updateTimer = null;
    setTimeout(scheduleBackgroundUpdate, 30000);
  }, 1000);
}

chrome.runtime.onInstalled.addListener(async () => {
  console.log("GuardianCore Audit Probe installed");
  await ensureDefaultConfig();
  await initializeAuth();
  loadFastMode();
  if (currentUser) await loadXpState();
  scheduleBackgroundUpdate();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDefaultConfig();
  await initializeAuth();
  loadFastMode();
  if (currentUser) await loadXpState();
  scheduleBackgroundUpdate();
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "popup") scheduleBackgroundUpdate();
});

// ========== PARENT NOTIFICATION ==========

async function notifyParent({ url, category, parent_report, trigger_words }) {
  try {
    if (!currentUser || currentUser.account_type !== 'child') return;
    const { gc_backend_url } = await chrome.storage.local.get('gc_backend_url');
    const backendUrl = gc_backend_url || 'https://guardiancore.onrender.com';
    await fetch(`${backendUrl}/notify/parent-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentUser.token}` },
      body: JSON.stringify({
        child_id: currentUser.user_id,
        url, category,
        parent_report: parent_report || '',
        trigger_words: trigger_words || []
      })
    });
    console.log('[Notify] Parent notified for:', url);
  } catch (e) {
    console.warn('[Notify] Parent notification failed (non-blocking):', e);
  }
}

// ========== SINGLE UNIFIED MESSAGE LISTENER ==========
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_TAB_STATE") {
    sendResponse(tabState.get(message.tabId) || null);

  } else if (message.type === "REFRESH_RULES") {
    if (currentUser && currentUser.account_type === 'child') {
      loadChildRules(currentUser.user_id, currentUser.token).then(() => sendResponse({ ok: true }));
    } else { sendResponse({ ok: true }); }
    return true;

  } else if (message.type === "CHECK_AUTH") {
    sendResponse({
      authenticated: !!currentUser,
      user: currentUser ? { user_id: currentUser.user_id, username: currentUser.username, account_type: currentUser.account_type } : null
    });

  } else if (message.type === "AUTH_UPDATED") {
    console.log("[Auth] Received AUTH_UPDATED message - reloading authentication");
    initializeAuth().then(() => sendResponse({ ok: true }));
    return true;

  } else if (message.type === "LOGOUT") {
    currentUser = null;
    rulesCache = { allowlist: [], blocklist: [], time_window: [], lastFetch: 0 };
    chrome.storage.local.remove([
      'gc_auth_token', 'gc_user_id', 'gc_account_type', 'gc_username', 'gc_email',
      'gc_pin', 'gc_recovery_codes', 'gc_pin_verified'
    ]).then(async () => {
      const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL('login.html') });
      if (tabs.length === 0) chrome.tabs.create({ url: chrome.runtime.getURL('login.html') });
      sendResponse({ ok: true });
    });
    return true;

  } else if (message.type === "CHECK_TIME_NUDGE") {
    sendResponse({ ok: true });

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

  } else if (message.type === "ANALYZE_PAGE") {
    handleAnalyzePageRequest(message, sender).then(result => {
      sendResponse(result);
    }).catch(error => {
      console.error("[Analysis] Error:", error);
      sendResponse({ received: true, error: error.message });
    });
    return true;

  } else if (message.type === "LENS_GROQ_REQUEST") {
    chrome.storage.sync.get('lens_groq_key', async (res) => {
      const key = res.lens_groq_key;
      if (!key) {
        sendResponse({ reply: "Hey! Looks like Lens isn't fully set up yet. Ask your parent to add the Lens API key in the extension settings 🛡" });
        return;
      }
      try {
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
          body: JSON.stringify({
            model: 'llama-3.1-8b-instant',
            max_tokens: 220,
            temperature: 0.85,
            messages: [{ role: 'system', content: message.systemPrompt }, ...message.history]
          })
        });
        const data = await r.json();
        sendResponse({ reply: data.choices?.[0]?.message?.content?.trim() || "I had a little hiccup — try again in a sec!" });
      } catch (e) {
        sendResponse({ reply: "I lost my connection for a sec. Say something and I'll try again!" });
      }
    });
    return true;
  }
});

// ========== INTELLIGENT CONTENT CLASSIFICATION ==========

const analysisRateLimit = new Map();
const ANALYSIS_COOLDOWN_MS = 0;

async function handleAnalyzePageRequest(message, sender) {
  const { url, text } = message;

  console.log("[Analysis] ========================================");
  console.log("[Analysis] Received ANALYZE_PAGE request");
  console.log("[Analysis] URL:", url);
  console.log("[Analysis] Text length:", text?.length || 0);
  console.log("[Analysis] Current user:", currentUser ? `${currentUser.username} (${currentUser.account_type})` : "none");

  if (!currentUser || currentUser.account_type !== 'child') {
    console.log("[Analysis] Skipping analysis - not a child account");
    return { received: true, skipped: true, reason: "not_child_account" };
  }

  let domain;
  try {
    domain = new URL(url).hostname.replace(/^www\./, '');
  } catch (e) {
    return { received: true, skipped: true, reason: "invalid_url" };
  }

  for (const rule of rulesCache.allowlist) {
    if (matchesPattern(url, rule.pattern)) {
      console.log(`[Analysis] ✅ Domain ${domain} is ALLOWLISTED - skipping AI analysis`);
      return { received: true, safe: true, skipped: true, reason: "allowlisted" };
    }
  }

  for (const rule of rulesCache.blocklist) {
    if (matchesPattern(url, rule.pattern)) {
      console.log(`[Analysis] 🚫 Domain ${domain} is already BLOCKLISTED`);
      return { received: true, blocked: true, action: 'blocked', category: rule.category, child_message: rule.explanation, skipped: true, reason: "already_blocked" };
    }
  }

  analysisRateLimit.set(domain, Date.now());
  if (analysisRateLimit.size > 100) analysisRateLimit.delete(analysisRateLimit.keys().next().value);

  try {
    const { gc_backend_url } = await chrome.storage.local.get('gc_backend_url');
    const backendUrl = gc_backend_url || 'https://guardiancore.onrender.com';

    console.log(`[Analysis] Sending content analysis request for: ${domain}`);

    const response = await fetch(`${backendUrl}/analyze/content`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentUser.token}` },
      body: JSON.stringify({ url, text_content: message.text, child_age: 13 })
    });

    if (!response.ok) {
      console.error(`[Analysis] Backend error: ${response.status}`);
      return { received: true, error: "backend_error" };
    }

    const result = await response.json();
    console.log("[Analysis] Result:", result);

    if (!result.safe) {
      console.log(`[Analysis] ⚠️ Unsafe content detected: ${result.blocked_by} - ${result.category}`);

      // Refresh rules so domain gets blocked going forward
      await loadChildRules(currentUser.user_id, currentUser.token);
      await updateDynamicBlockingRules();

      await captureBlockedAttempt(url, result.category || 'ai_blocked', 'AI Detection');
      awardXp({ trackers: 0, csp: false, cors: false, blocked: true, violation: true });

      // ── Notify parent ──────────────────────────────────────────────────
      await notifyParent({
        url,
        category: result.category || 'ai_blocked',
        parent_report: result.parent_report || '',
        trigger_words: result.trigger_words || []
      });

      // ── Redirect tab to blocked page with Lens ─────────────────────────
      if (sender.tab && sender.tab.id) {
        const blockUrl = chrome.runtime.getURL("blocked.html") +
          `?reason=${encodeURIComponent(result.child_message || '')}` +
          `&category=${encodeURIComponent(result.category || 'Restricted content')}` +
          `&url=${encodeURIComponent(url)}`;
        chrome.tabs.update(sender.tab.id, { url: blockUrl });
      }

      return { received: true, blocked: true, action: 'blocked', category: result.category, child_message: result.child_message, rule_created: result.rule_created };
    }

    // ── Middle case: risky but not blocked ─────────────────────────────
    const riskScore = result.risk_score ?? result.confidence ?? 0;
    if (riskScore >= 0.05 && sender.tab && sender.tab.id) {
      console.log(`[Lens] Triggering warning bubble — risk score: ${riskScore}`);
      chrome.tabs.sendMessage(sender.tab.id, {
        type: "LENS_TRIGGER",
        risk: riskScore,
        url: url,
        category: result.category || "General concern",
        reason: result.child_message || "This page has some content worth talking about."
      }).catch(() => {});
    }

    return { received: true, safe: true, action: 'none', risk_score: riskScore };

  } catch (error) {
    console.error("[Analysis] Request failed (fail-open):", error);
    return { received: true, error: error.message };
  }
}