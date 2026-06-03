// GuardianLens Background Service Worker — v0.7.4
// 🔧 fixes:
//    - Chat alerts now show YELLOW bubble (risk capped at 65, not 85)
//    - Groq key no longer falls back to Railway JWT — shows clear error instead
//    - warning-overlay.js injected before LENS_TRIGGER fires (fixes missing bubble)
//    - Per-tab 60s cooldown after block/warn — stops repeated analysis firing
//    - fireLensTrigger has 30s cooldown per tab — stops bubble vibrating
//    - loadChildRules/updateDynamicBlockingRules skipped for chat detections

console.log("GuardianLens Background v0.7.4 loaded");

let currentUser = null;

async function ensureDefaultConfig() {
  try {
    const { gc_backend_url, gl_config_initialized } = await chrome.storage.local.get(['gc_backend_url', 'gl_config_initialized']);
    if (!gl_config_initialized) {
      const defaults = {};
      if (!gc_backend_url) defaults.gc_backend_url = 'https://guardiancore-production.up.railway.app';
      if (Object.keys(defaults).length > 0) await chrome.storage.local.set(defaults);
      await chrome.storage.local.set({ gl_config_initialized: true });
    }
  } catch (e) { console.error('[Config] ensureDefaultConfig failed:', e); }
}

async function initializeAuth() {
  const { gc_auth_token, gc_user_id, gc_account_type, gc_username } = await chrome.storage.local.get(['gc_auth_token', 'gc_user_id', 'gc_account_type', 'gc_username']);
  if (!gc_auth_token) {
    console.log("[Auth] No token — user needs to log in");
    const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL('login.html') });
    if (tabs.length === 0) chrome.tabs.create({ url: chrome.runtime.getURL('login.html') });
    return false;
  }
  try {
    const { gc_backend_url } = await chrome.storage.local.get('gc_backend_url');
    const backendUrl = gc_backend_url || 'https://guardiancore-production.up.railway.app';
    const response = await fetch(`${backendUrl}/auth/verify`, { method: 'POST', headers: { 'Authorization': `Bearer ${gc_auth_token}` } });
    if (!response.ok) {
      await chrome.storage.local.remove(['gc_auth_token','gc_user_id','gc_account_type','gc_username','gc_email']);
      const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL('login.html') });
      if (tabs.length === 0) chrome.tabs.create({ url: chrome.runtime.getURL('login.html') });
      return false;
    }
    currentUser = { user_id: gc_user_id, account_type: gc_account_type, token: gc_auth_token, username: gc_username };
    await chrome.storage.local.set({ gl_parent_token: gc_auth_token });
    if (currentUser.account_type === 'child') {
      fetch(`${backendUrl}/accounts/profile`, { headers: { 'Authorization': 'Bearer ' + currentUser.token } })
        .then(r => r.json())
        .then(profile => {
          if (profile.parent_email) { currentUser.parentEmail = profile.parent_email; console.log('[GuardianLens] Parent email loaded:', currentUser.parentEmail); }
          else { console.warn('[GuardianLens] No parent email found in profile'); }
        })
        .catch(e => console.warn('[GuardianLens] Could not fetch parent email:', e));
    }
    console.log(`[Auth] ✅ Authenticated: ${gc_account_type} · ${gc_username} (${gc_user_id})`);
    await loadXpState();
    if (gc_account_type === 'child') {
      await loadChildRules(gc_user_id, gc_auth_token);
      await updateDynamicBlockingRules();
    } else {
      rulesCache = { allowlist: [], blocklist: [], time_window: [], lastFetch: Date.now() };
      await updateDynamicBlockingRules();
    }
    await scheduleTokenRefresh();
    return true;
  } catch (error) { console.error("[Auth] Token verify failed:", error); return false; }
}

async function scheduleTokenRefresh() {}

let fastMode = false;
async function loadFastMode() {
  try {
    const { gl_fast_mode } = await chrome.storage.local.get(["gl_fast_mode"]);
    fastMode = !!gl_fast_mode;
    if (fastMode) console.log("[Gamification] FAST MODE on (1 min = 1 hr)");
  } catch (e) {}
}

(async () => { await loadFastMode(); await initializeAuth(); })();

const TRACKERS = {
  "google-analytics.com":    { category: "analytics",    name: "Google Analytics",      risk: "medium" },
  "doubleclick.net":         { category: "advertising",  name: "DoubleClick",           risk: "high"   },
  "facebook.net":            { category: "social_media", name: "Facebook",              risk: "high"   },
  "googletagmanager.com":    { category: "analytics",    name: "Google Tag Manager",    risk: "medium" },
  "adservice.google.com":    { category: "advertising",  name: "Google Ads",            risk: "high"   },
  "googlesyndication.com":   { category: "advertising",  name: "Google AdSense",        risk: "high"   },
  "googleadservices.com":    { category: "advertising",  name: "Google Ad Services",    risk: "high"   },
  "facebook.com":            { category: "social_media", name: "Facebook",              risk: "high"   },
  "connect.facebook.net":    { category: "social_media", name: "Facebook Connect",      risk: "high"   },
  "analytics.google.com":    { category: "analytics",    name: "Google Analytics",      risk: "medium" },
  "googletagservices.com":   { category: "advertising",  name: "Google Tag Services",   risk: "high"   },
  "twitter.com":             { category: "social_media", name: "Twitter",               risk: "medium" },
  "instagram.com":           { category: "social_media", name: "Instagram",             risk: "medium" },
  "tiktok.com":              { category: "social_media", name: "TikTok",                risk: "medium" },
  "snapchat.com":            { category: "social_media", name: "Snapchat",              risk: "medium" },
  "youtube.com":             { category: "video",        name: "YouTube",               risk: "low"    },
  "amazon-adsystem.com":     { category: "advertising",  name: "Amazon Ads",            risk: "high"   },
  "criteo.com":              { category: "advertising",  name: "Criteo",                risk: "high"   },
  "outbrain.com":            { category: "advertising",  name: "Outbrain",              risk: "high"   },
  "taboola.com":             { category: "advertising",  name: "Taboola",               risk: "high"   },
};

const tabState          = new Map();
const recentNavigations = new Map();
const XP_COOLDOWN_MS    = 30000;
let lastViolationTs     = null;
let blockingAvailable   = true;
let xpState             = { dayKey: null, xp: 0, level: 1 };

async function loadXpState() {
  try {
    if (!currentUser) return;
    const storageKey = `gl_xp_${currentUser.user_id}`;
    const result = await chrome.storage.local.get([storageKey]);
    xpState = result[storageKey] || { dayKey: null, xp: 0, level: 1 };
    ensureXpDay();
  } catch (error) { console.error("[XP] Load failed:", error); }
}

function ensureXpDay() {
  const today = new Date().toISOString().slice(0, 10);
  if (xpState.dayKey !== today) { xpState.dayKey = today; xpState.xp = 0; persistXp(); }
}

function persistXp() {
  if (!currentUser) return;
  chrome.storage.local.set({ [`gl_xp_${currentUser.user_id}`]: xpState });
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
  chrome.runtime.sendMessage({ type: "xp:update", xp: xpState.xp, level: xpState.level, progress: xpState.xp / 100, delta }).catch(() => {});
}

function extractDomain(url) {
  try {
    const parts = new URL(url).hostname.split('.');
    return parts.length >= 2 ? parts.slice(-2).join('.') : new URL(url).hostname;
  } catch (e) { return null; }
}

const domainTimeTracking = new Map();

async function captureActivityEvent(eventType, domain, additionalData = {}) {
  try {
    if (!currentUser || currentUser.account_type !== 'child') return;
    const { gc_backend_url } = await chrome.storage.local.get('gc_backend_url');
    const backendUrl = gc_backend_url || 'https://guardiancore-production.up.railway.app';
    const response = await fetch(`${backendUrl}/activity/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentUser.token}` },
      body: JSON.stringify({ domain, event_type: eventType, ...additionalData })
    });
    if (response.ok) { const result = await response.json(); if (result.stored) console.log(`[Activity] ${eventType} → ${domain}`); }
  } catch (error) { console.debug("[Activity] Event failed:", error); }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    const domain = extractDomain(tab.url);
    if (!domain) return;
    if (domainTimeTracking.has(tabId)) {
      const prev = domainTimeTracking.get(tabId);
      const timeSpent = Math.floor((Date.now() - prev.startTime) / 1000);
      if (timeSpent >= 5) { const tabData = ensureTab(tabId); captureActivityEvent('time_spent', prev.domain, { duration_seconds: timeSpent, has_csp: tabData.lastCsp, has_cors: tabData.lastCors }); }
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
    if (timeSpent >= 5) { const tabData = ensureTab(tabId); captureActivityEvent('time_spent', prev.domain, { duration_seconds: timeSpent, has_csp: tabData.lastCsp, has_cors: tabData.lastCors }); }
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
  if (!tabState.has(tid)) tabState.set(tid, { trackerCount: 0, trackersByCategory: {}, lastCsp: false, lastCors: false, blocked: null });
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
    const backendUrl = gc_backend_url || 'https://guardiancore-production.up.railway.app';
    const url = `${backendUrl}/accounts/rules/combined/child/${childId}`;
    console.log("[Rules] Fetching:", url);
    const response = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!response.ok) { console.error("[Rules] Failed:", response.status); return; }
    const rules = await response.json();
    const enabledRules = rules.filter(r => r.enabled);
    rulesCache = {
      allowlist:   enabledRules.filter(r => r.rule_type === "allowlist"),
      blocklist:   enabledRules.filter(r => r.rule_type === "blocklist"),
      time_window: enabledRules.filter(r => r.rule_type === "time_window"),
      lastFetch: Date.now()
    };
    console.log("[Rules] Loaded:", { total: rules.length, enabled: enabledRules.length });
    await updateDynamicBlockingRules();
  } catch (error) { console.error("[Rules] Load error:", error); }
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
  const currentDay  = now.getDay();
  const hostname = (()=>{ try { return new URL(url).hostname.replace(/^www\./,''); } catch { return ''; } })();
  const domainAllowWindows = [], domainBlockWindows = [], globalBlockWindows = [];
  for (const rule of rulesCache.time_window) {
    try {
      let cfg;
      try { cfg = JSON.parse(rule.pattern); } catch {
        const parts = rule.pattern.split('|');
        if (parts.length >= 3) {
          const domain = parts[0].trim(), daysStr = parts[1].trim(), hoursStr = parts[2].trim();
          const dayMap = {'Sun':0,'Mon':1,'Tue':2,'Wed':3,'Thu':4,'Fri':5,'Sat':6};
          const days = daysStr.split(',').map(d => dayMap[d.trim()]).filter(d => d !== undefined);
          const [startTime, endTime] = hoursStr.split('-');
          const [startHour, startMin] = startTime.split(':').map(s => parseInt(s));
          const [endHour,   endMin]   = endTime.split(':').map(s => parseInt(s));
          cfg = { domain: (domain && domain !== '*') ? domain : null, days: days.length > 0 ? days : [0,1,2,3,4,5,6], start_hour: startHour, start_min: startMin||0, end_hour: endHour, end_min: endMin||0, action: 'block' };
        } else { throw new Error('Invalid pipe format'); }
      }
      if (cfg.days && !cfg.days.includes(currentDay)) continue;
      const currentTimeInMinutes = currentHour * 60 + now.getMinutes();
      const startTimeInMinutes   = (cfg.start_hour??0) * 60 + (cfg.start_min??0);
      const endTimeInMinutes     = (cfg.end_hour??24)  * 60 + (cfg.end_min??0);
      const inWindow = startTimeInMinutes > endTimeInMinutes
        ? (currentTimeInMinutes >= startTimeInMinutes || currentTimeInMinutes < endTimeInMinutes)
        : (currentTimeInMinutes >= startTimeInMinutes && currentTimeInMinutes < endTimeInMinutes);
      const action = cfg.action === 'allow' ? 'allow' : 'block';
      if (cfg.domain && cfg.domain !== '*') {
        const matchesDomain = hostname === cfg.domain || hostname.endsWith('.' + cfg.domain);
        if (!matchesDomain) continue;
        if (action === 'allow') domainAllowWindows.push({ rule, inWindow });
        else domainBlockWindows.push({ rule, inWindow });
      } else { if (action === 'block') globalBlockWindows.push({ rule, inWindow }); }
    } catch (e) { console.error('[TimeWindow] Invalid rule:', rule.pattern, e); }
  }
  if (domainAllowWindows.length) {
    if (domainAllowWindows.some(w => w.inWindow)) return { allowed: true, reason: 'Allowed (scheduled allow window)' };
    const rule = domainAllowWindows[0].rule;
    return { blocked: true, rule, reason: rule.explanation || 'Outside allowed time window' };
  }
  if (domainBlockWindows.some(w => w.inWindow)) { const rule = domainBlockWindows.find(w => w.inWindow).rule; return { blocked: true, rule, reason: rule.explanation || 'Blocked during scheduled window' }; }
  if (globalBlockWindows.some(w => w.inWindow)) { const rule = globalBlockWindows.find(w => w.inWindow).rule; return { blocked: true, rule, reason: rule.explanation || 'Blocked (global time window)' }; }
  return { allowed: true };
}

function enforceRules(url, tabId) {
  if (!currentUser || currentUser.account_type !== 'child') return { allowed: true };
  for (const rule of rulesCache.allowlist) { if (matchesPattern(url, rule.pattern)) return { allowed: true }; }
  const schedule = evaluateTimeWindows(url);
  if (schedule.blocked) {
    const state = ensureTab(tabId);
    state.blocked = { reason: schedule.rule?.explanation || schedule.reason, rule: schedule.rule, timestamp: Date.now() };
    return { blocked: true, reason: state.blocked.reason, rule: schedule.rule };
  } else if (schedule.allowed === true && schedule.reason) { return { allowed: true }; }
  for (const rule of rulesCache.blocklist) {
    if (matchesPattern(url, rule.pattern)) {
      const state = ensureTab(tabId);
      state.blocked = { reason: rule.explanation || `Blocked: ${rule.category || "restricted content"}`, rule, timestamp: Date.now() };
      return { blocked: true, reason: state.blocked.reason, rule };
    }
  }
  return { allowed: true };
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
    try {
      const host = new URL(details.url).hostname.replace(/^www\./, "");
      for (const [domain, info] of Object.entries(TRACKERS)) {
        if (host.endsWith(domain)) { const state = ensureTab(details.tabId); state.trackerCount++; state.trackersByCategory[info.category] = (state.trackersByCategory[info.category] || 0) + 1; break; }
      }
    } catch (e) {}
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0 || !details.responseHeaders) return;
    const st = ensureTab(details.tabId);
    const h  = Object.create(null);
    for (const { name, value } of details.responseHeaders) h[name.toLowerCase()] = (value || "");
    st.lastCsp  = Boolean(h["content-security-policy"]);
    st.lastCors = Boolean(h["access-control-allow-origin"]) || (h["vary"] || "").includes("Origin");
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

async function updateDynamicBlockingRules() {
  if (!currentUser || currentUser.account_type !== 'child') {
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    if (existingRules.length > 0) await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existingRules.map(r => r.id) });
    return;
  }
  console.log("[DNR] Building blocking rules for child account");
  const dnrRules = [];
  let ruleId = 1;
  for (const rule of rulesCache.blocklist) {
    const pattern = rule.pattern.toLowerCase();
    if (!pattern.includes('.') && !pattern.includes('/')) { console.log(`[DNR] Skipping ${rule.pattern} (keyword filter — AI-only)`); continue; }
    if ((rule.confidence ?? 1) < 0.75) { console.log(`[DNR] Skipping ${rule.pattern} — confidence too low for DNR`); continue; }
    let urlFilter;
    if (pattern.startsWith('*.'))     urlFilter = `*://${pattern.substring(2)}/*`;
    else if (!pattern.includes('/'))  urlFilter = `*://*${pattern}/*`;
    else                              urlFilter = pattern;
    const redirectUrl = chrome.runtime.getURL("blocked.html") + `?url=&category=${encodeURIComponent(rule.category || "blocked_keyword")}&reason=${encodeURIComponent(rule.explanation || rule.category || 'Blocked by rule')}`;
    dnrRules.push({ id: ruleId++, priority: 1, action: { type: "redirect", redirect: { url: redirectUrl } }, condition: { urlFilter, resourceTypes: ["main_frame"] } });
  }
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existingRules.map(r => r.id), addRules: dnrRules });
  console.log(`[DNR] Applied ${dnrRules.length} blocking rules`);
}

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0 || !currentUser || currentUser.account_type !== 'child') return;
  const url = details.url.toLowerCase();
  for (const rule of rulesCache.blocklist) {
    if (matchesPattern(url, rule.pattern)) {
      lastViolationTs = Date.now();
      chrome.storage.local.set({ lastViolation: lastViolationTs });
      awardXp({ trackers: 0, csp: false, cors: false, blocked: true, violation: true });
      await captureBlockedAttempt(details.url, rule.category, rule.explanation);
      break;
    }
  }
});

chrome.webRequest.onErrorOccurred?.addListener?.((info) => {
  if (info.error && /blocked/i.test(info.error) && info.error.includes('permission')) { blockingAvailable = false; }
}, { urls: ["<all_urls>"] });

chrome.webNavigation.onBeforeNavigate.addListener((nav) => {
  if (!currentUser || currentUser.account_type !== 'child' || nav.frameId !== 0) return;
  if (nav.url.startsWith('chrome://') || nav.url.startsWith('chrome-extension://')) return;
  for (const rule of rulesCache.allowlist) { if (matchesPattern(nav.url, rule.pattern)) return; }
  const schedule = evaluateTimeWindows(nav.url);
  if (schedule.blocked) {
    chrome.tabs.update(nav.tabId, { url: chrome.runtime.getURL("blocked.html") + `?reason=${encodeURIComponent(schedule.reason || 'Outside allowed time window')}&category=${encodeURIComponent('time_restriction')}&url=${encodeURIComponent(nav.url)}` });
  }
  chrome.tabs.sendMessage(nav.tabId, { type: 'EARLY_ANALYSIS_START', url: nav.url }).catch(() => {});
});

chrome.webNavigation.onCompleted.addListener(async (nav) => {
  try {
    const st = ensureTab(nav.tabId);
    const tab = await chrome.tabs.get(nav.tabId);
    if (!tab?.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) return;
    const originHash = await sha256Hex(new URL(tab.url).origin);
    const record = {
      origin_hash: originHash, ts_iso: new Date().toISOString(), check_type: "page_audit_v2",
      policy_state: { csp_present: !!st.lastCsp, cors_signals: !!st.lastCors, tracker_count: st.trackerCount, trackers_by_category: st.trackersByCategory, blocked: !!st.blocked },
      client: { ua_major: navigator.userAgentData?.brands?.[0]?.version || "n/a" }
    };
    const navTrackers = st.trackerCount;
    st.trackerCount = 0; st.trackersByCategory = {};
    const { gc_backend_url } = await chrome.storage.local.get(["gc_backend_url"]);
    if (!gc_backend_url) return;
    if (currentUser) record.user_id = currentUser.user_id;
    await fetch(`${gc_backend_url.replace(/\/+$/, "")}/audit/submit?tab_id=${nav.tabId}`, {
      method: "POST", headers: { "Content-Type": "application/json", "Authorization": currentUser ? `Bearer ${currentUser.token}` : "" },
      body: JSON.stringify(record), keepalive: true
    }).catch(() => {});
    const now = Date.now();
    const lastAwarded = recentNavigations.get(tab.url) || 0;
    if (now - lastAwarded >= XP_COOLDOWN_MS) {
      awardXp({ trackers: navTrackers, csp: record.policy_state.csp_present, cors: record.policy_state.cors_signals, blocked: record.policy_state.blocked, violation: false });
      recentNavigations.set(tab.url, now);
      if (recentNavigations.size > 100) recentNavigations.delete(recentNavigations.keys().next().value);
    }
  } catch (e) { console.error("Audit submit error:", e); }
});

async function fetchStats() {
  try {
    if (!currentUser) return;
    const { gc_backend_url } = await chrome.storage.local.get(["gc_backend_url"]);
    if (!gc_backend_url) return;
    const response = await fetch(`${gc_backend_url.replace(/\/+$/, "")}/audit/stats`, { headers: { "Authorization": `Bearer ${currentUser.token}` } });
    if (response.ok) { const stats = await response.json(); chrome.runtime.sendMessage({ type: "stats:update", stats }).catch(() => {}); }
    else if (response.status === 401) { chrome.runtime.sendMessage({ type: 'stats:error', error: 'unauthorized' }).catch(()=>{}); }
  } catch (e) { console.error("[Stats] Failed:", e); }
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

chrome.runtime.onInstalled.addListener(async () => { await ensureDefaultConfig(); await initializeAuth(); loadFastMode(); if (currentUser) await loadXpState(); scheduleBackgroundUpdate(); });
chrome.runtime.onStartup.addListener(async () => { await ensureDefaultConfig(); await initializeAuth(); loadFastMode(); if (currentUser) await loadXpState(); scheduleBackgroundUpdate(); });
chrome.runtime.onConnect.addListener((port) => { if (port.name === "popup") scheduleBackgroundUpdate(); });

// ========== PARENT NOTIFICATION ==========
const notifyDebounce = new Map();
const NOTIFY_COOLDOWN_MS = 5 * 60 * 1000;

async function notifyParent({ url, category, parent_report, trigger_words, flagged_snippet }) {
  try {
    if (!currentUser || currentUser.account_type !== 'child') return;
    const debounceKey = `${url}|${category}`;
    const lastNotify = notifyDebounce.get(debounceKey) || 0;
    if (Date.now() - lastNotify < NOTIFY_COOLDOWN_MS) { console.log('[Notify] Skipping — already notified recently for:', debounceKey); return; }
    notifyDebounce.set(debounceKey, Date.now());
    if (notifyDebounce.size > 50) notifyDebounce.delete(notifyDebounce.keys().next().value);
    const { gc_backend_url } = await chrome.storage.local.get('gc_backend_url');
    const backendUrl = gc_backend_url || 'https://guardiancore-production.up.railway.app';
    await fetch(`${backendUrl}/notify/parent-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentUser.token}` },
      body: JSON.stringify({ child_id: currentUser.user_id, url, category, parent_report: parent_report || '', trigger_words: trigger_words || [], flagged_snippet: flagged_snippet || '' })
    });
    console.log('[Notify] Parent notified for:', url);
  } catch (e) { console.warn('[Notify] Parent notification failed:', e); }
}

// ========== LENS TRIGGER — 30s cooldown per tab ==========
const lensTriggerCooldown = new Map();

// 🔧 FIX: Inject warning-overlay.js before sending LENS_TRIGGER so the
//         content script is guaranteed to be loaded when the message arrives.
async function fireLensTrigger(tabId, { risk, category, reason, domain }) {
  const now = Date.now();
  const last = lensTriggerCooldown.get(tabId) || 0;
  if (now - last < 30000) {
    console.log(`[Lens] Skipping LENS_TRIGGER — cooldown active for tab ${tabId}`);
    return;
  }
  lensTriggerCooldown.set(tabId, now);
  try {
    // Inject overlay script first — safe to call even if already injected
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['warning-overlay.js']
    }).catch(e => console.warn('[Lens] overlay inject skipped:', e.message));

    await chrome.tabs.sendMessage(tabId, {
      type:     'LENS_TRIGGER',
      risk:     Math.round(risk),
      category: category || 'General concern',
      reason:   reason  || '',
      domain:   domain  || ''
    });
    console.log(`[Lens] LENS_TRIGGER fired → tab ${tabId} (risk:${risk}, cat:${category})`);
  } catch (e) {
    console.warn('[Lens] fireLensTrigger failed (tab may have navigated):', e.message);
  }
}

// ========== UNIFIED MESSAGE LISTENER ==========
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === "GET_TAB_STATE") {
    sendResponse(tabState.get(message.tabId) || null);

  } else if (message.type === "REFRESH_RULES") {
    if (currentUser && currentUser.account_type === 'child') {
      loadChildRules(currentUser.user_id, currentUser.token).then(() => sendResponse({ ok: true }));
    } else { sendResponse({ ok: true }); }
    return true;

  } else if (message.type === "CHECK_AUTH") {
    sendResponse({ authenticated: !!currentUser, user: currentUser ? { user_id: currentUser.user_id, username: currentUser.username, account_type: currentUser.account_type } : null });

  } else if (message.type === "AUTH_UPDATED") {
    initializeAuth().then(() => sendResponse({ ok: true }));
    return true;

  } else if (message.type === "LOGOUT") {
    currentUser = null;
    rulesCache = { allowlist: [], blocklist: [], time_window: [], lastFetch: 0 };
    chrome.storage.local.remove(['gc_auth_token','gc_user_id','gc_account_type','gc_username','gc_email','gc_pin','gc_recovery_codes','gc_pin_verified','gl_parent_token']).then(async () => {
      const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL('login.html') });
      if (tabs.length === 0) chrome.tabs.create({ url: chrome.runtime.getURL('login.html') });
      sendResponse({ ok: true });
    });
    return true;

  } else if (message.type === "CHECK_TIME_NUDGE") {
    sendResponse({ ok: true });

  } else if (message.type === "DEV_TOGGLE_FAST_MODE") {
    fastMode = !fastMode;
    chrome.storage.local.set({ gl_fast_mode: fastMode });
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
    chrome.runtime.sendMessage({ type: "xp:update", xp: 0, level: 1, progress: 0, delta: 0 }).catch(() => {});
    sendResponse({ ok: true });

  } else if (message.type === "ANALYZE_PAGE") {
    handleAnalyzePageRequest(message, sender).then(result => sendResponse(result)).catch(error => {
      console.error("[Analysis] Error:", error);
      sendResponse({ received: true, error: error.message });
    });
    return true;

  } else if (message.type === 'GL_OVERLAY_CSS') {
    if (sender?.tab?.id && message.css) {
      chrome.scripting.insertCSS({ target: { tabId: sender.tab.id }, css: message.css }).catch((error) => { console.debug('[GL] insertCSS failed:', error); });
    }
    sendResponse({ ok: true });
    return true;

  } else if (message.type === 'LENS_GROQ_REQUEST') {
    // 🔧 FIX: Only use a real Groq key (starts with "gsk_").
    //         Never fall back to the Railway JWT — that causes "Having trouble connecting".
    (async () => {
      try {
        const res = await chrome.storage.sync.get('GROQ_API_KEY');
        const key = res.GROQ_API_KEY;

        if (!key || !key.startsWith('gsk_')) {
          console.warn('[Lens] No valid Groq key found in storage (lens_groq_key must start with gsk_)');
          sendResponse({ reply: "I'm not fully set up yet — ask a parent to add the Groq API key in settings." });
          return;
        }

        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            max_tokens: 400,
            temperature: 0.7,
            messages: [{ role: 'system', content: message.systemPrompt }, ...message.history]
          })
        });

        if (!r.ok) {
          const errText = await r.text().catch(() => '');
          console.error('[Lens] Groq API error:', r.status, errText);
          sendResponse({ reply: "I'm having a little trouble right now — try again in a moment!" });
          return;
        }

        const data = await r.json();
        const reply = data.choices?.[0]?.message?.content?.trim() || "I'm having a little trouble right now — try again in a moment!";
        sendResponse({ reply });
      } catch (e) {
        console.error('[Lens] Groq error:', e);
        sendResponse({ reply: "I'm having a little trouble right now — try again in a moment!" });
      }
    })();
    return true;

  } else if (message.type === "LENS_WARNING_DISMISSED") {
    console.log(`[Lens] Warning dismissed on ${message.domain} (risk: ${message.risk})`);
    // Reset cooldown so bubble can fire again after user dismisses
    if (sender?.tab?.id) lensTriggerCooldown.delete(sender.tab.id);
    const domain = message.domain || extractDomain(message.url) || 'unknown';
    captureActivityEvent('warning_dismissed', domain, { risk_score: message.risk, category: message.category, url: message.url });
    sendResponse({ ok: true });

  } else if (message.type === "LENS_OPEN_CHAT") {
    console.log(`[Lens] Chat opened for ${message.domain}`);
    sendResponse({ ok: true });

  } else if (message.type === "LENS_ESCALATE") {
    console.log(`[Lens] 🚨 ESCALATION for ${message.domain}`);
    const domain   = message.domain || extractDomain(message.url) || 'unknown';
    const escalUrl = message.url    || `https://${domain}`;
    const escalCat = message.category || 'high_risk';
    const childName = currentUser?.username || 'Your child';
    notifyParent({ url: escalUrl, category: escalCat, parent_report: `GuardianLens flagged high-risk content. ${childName} visited "${escalCat}" on ${domain}.`, trigger_words: message.trigger_words || [] });
    captureActivityEvent('escalation', domain, { category: escalCat, url: escalUrl, risk_level: 'high', child_name: childName });
    chrome.notifications?.create?.(`gl-escalate-${Date.now()}`, { type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon.svg'), title: '🚨 GuardianLens Alert', message: `${childName} visited high-risk content on ${domain}. Tap to open the dashboard.`, priority: 2, requireInteraction: true });
    if (sender?.tab?.id) fireLensTrigger(sender.tab.id, { risk: 100, category: escalCat, reason: message.reason || '', domain });
    console.log(`[Lens] ✅ Parent notified: ${domain}`);
    sendResponse({ ok: true });

  } else if (message.type === "PAGE_BLOCKED") {
    try {
      if (!currentUser) return;
      const msg = message;
      fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: 'service_bhvmmnb', template_id: 'template_nv9j9pr', user_id: '2TGOVUDR-rOODDeCs',
          template_params: { parent_email: currentUser.parentEmail || currentUser.email || '', child_username: currentUser.username || 'Unknown', blocked_url: msg.url || msg.blockedUrl || 'Unknown URL', reason: msg.reason || msg.category || 'Content policy violation', category: msg.category || '', timestamp: new Date().toLocaleString() }
        })
      }).then(res => { if (res.ok) console.log('[GuardianLens] ✅ Parent email sent via EmailJS'); else res.text().then(t => console.warn('[GuardianLens] EmailJS error:', t)); })
        .catch(e => console.error('[GuardianLens] EmailJS failed:', e));
    } catch (e) { console.warn('[GuardianLens] Parent alert failed', e); }
  }
});

// ========== INTELLIGENT CONTENT CLASSIFICATION ==========
// Per-tab cooldown: after a warn/block fires, ignore new analysis for 60s
const tabAlertCooldown = new Map();

async function handleAnalyzePageRequest(message, sender) {
  const { url, text } = message;
  console.log("[Analysis] URL:", url, "| Text:", text?.length || 0, "chars");

  const stored = await chrome.storage.local.get(['gc_auth_token', 'gc_username', 'gc_account_type', 'gc_user_id', 'gc_backend_url', 'gc_child_id']);
  const authToken   = stored.gc_auth_token;
  const username    = stored.gc_username;
  const accountType = stored.gc_account_type;

  if (!authToken || accountType !== 'child') {
    console.log('[Analysis] Skipping — no child session');
    return { received: true, safe: true, action: 'none' };
  }
  console.log(`[Analysis] User: ${username} (${accountType})`);

  let domain;
  try { domain = new URL(url).hostname.replace(/^www\./, ''); }
  catch (e) { return { received: true, skipped: true, reason: "invalid_url" }; }

  // Per-tab cooldown: skip analysis for 60s after a warn/block
  const tabId = sender?.tab?.id;
  const lastAlert = tabAlertCooldown.get(tabId) || 0;
  if (tabId && Date.now() - lastAlert < 60000) {
    console.log(`[Analysis] Skipping — tab ${tabId} in post-alert cooldown`);
    return { received: true, safe: true, action: 'none' };
  }

  for (const rule of rulesCache.allowlist) {
    if (matchesPattern(url, rule.pattern)) { console.log(`[Analysis] ✅ ${domain} ALLOWLISTED`); return { received: true, safe: true, skipped: true, reason: "allowlisted" }; }
  }

  for (const rule of rulesCache.blocklist) {
    if (matchesPattern(url, rule.pattern)) { console.log(`[Analysis] 🚫 ${domain} BLOCKLISTED`); return { received: true, blocked: true, action: 'blocked', category: rule.category, skipped: true, reason: "already_blocked" }; }
  }

  try {
    const { gc_backend_url } = await chrome.storage.local.get('gc_backend_url');
    const backendUrl = gc_backend_url || 'https://guardiancore-production.up.railway.app';
    console.log(`[Analysis] Sending request for: ${domain}`);

    const isChat = !!message.isChat;
    const endpoint = isChat ? '/analyze/chat' : '/analyze/content';
    const body = isChat
      ? JSON.stringify({ url, messages: message.text, child_age: 13 })
      : JSON.stringify({ url, text_content: message.text, child_age: 13, sensitivity: 'high', check_slang: true, check_intent: true });

    const response = await fetch(`${backendUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body
    });

    if (!response.ok) { console.error(`[Analysis] Backend error: ${response.status}`); return { received: true, error: "backend_error" }; }

    const result = await response.json();
    console.log("[Analysis] Result:", result);

    const action           = result.action     || 'none';
    const confidence       = result.confidence || 0;
    const riskScore        = result.risk_score || 0;
    const returnedCategory = result.category   || '';

    console.log(`[Analysis] Category: "${returnedCategory}" → Action: ${action} | Confidence: ${confidence} | Risk: ${riskScore}`);

    // ── CHAT: both block and warn → show YELLOW warning bubble ──────────
    // 🔧 FIX: risk capped at 65 so the overlay renders yellow, not red
    if (isChat && (action === 'block' || (action === 'warn' && confidence >= 0.35))) {
      console.log(`[Analysis] ⚠️ CHAT ALERT — category: ${returnedCategory}, action: ${action}, confidence: ${confidence}`);

      // Set cooldown so no more analysis fires for 60s
      if (tabId) tabAlertCooldown.set(tabId, Date.now());

      const snippet = String(message.text || '').slice(0, 1000);
      await notifyParent({ url, category: returnedCategory || 'grooming', parent_report: result.parent_report || '', trigger_words: result.trigger_words || [], flagged_snippet: snippet });
      await captureActivityEvent('chat_blocked', domain, { snippet, trigger_words: result.trigger_words || [] });
      awardXp({ trackers: 0, csp: false, cors: false, blocked: true, violation: true });

      if (tabId) {
        // Highlight trigger words
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            func: (triggerWords) => {
              try {
                if (!triggerWords || !triggerWords.length) return;
                const safeWords = triggerWords.filter(Boolean).slice(0, 20);
                if (!safeWords.length) return;
                const regex = new RegExp('(' + safeWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
                const candidates = Array.from(document.querySelectorAll('.message-in span, .message-in div')).filter(e => e.children.length === 0 && e.innerText && regex.test(e.innerText));
                candidates.slice(0, 10).forEach(el => {
                  if (el.getAttribute('data-gl-highlighted')) return;
                  el.innerHTML = el.innerText.replace(regex, '<span style="background:#fff59d;padding:0 2px;border-radius:3px;">$1</span>');
                  el.setAttribute('data-gl-highlighted', '1');
                });
              } catch (e) { /* ignore */ }
            },
            args: [result.trigger_words || []]
          });
        } catch (e) { console.warn('[Analysis] highlight script failed', e); }

        // 🔧 FIX: Use risk 65 (yellow threshold) instead of 85 (red threshold)
        await fireLensTrigger(tabId, {
          risk: 65,
          category: returnedCategory || 'grooming',
          reason: result.child_message || result.parent_report || '⚠️ A potentially unsafe message was detected. Your parent has been notified.',
          domain
        });
      }

      return { received: true, safe: false, action: 'warn', category: returnedCategory, confidence, stage: 3 };
    }

    // ── NON-CHAT BLOCK: redirect to blocked page ─────────────────────
    if (!isChat && action === 'block') {
      console.log(`[Analysis] 🚫 PAGE BLOCK — category: ${returnedCategory}, confidence: ${confidence}`);
      if (tabId) tabAlertCooldown.set(tabId, Date.now());
      await loadChildRules(currentUser.user_id, currentUser.token);
      await updateDynamicBlockingRules();
      await captureBlockedAttempt(url, returnedCategory || 'ai_blocked', 'AI Detection');
      awardXp({ trackers: 0, csp: false, cors: false, blocked: true, violation: true });
      await notifyParent({ url, category: returnedCategory || 'ai_blocked', parent_report: result.parent_report || '', trigger_words: result.trigger_words || [], flagged_snippet: '' });
      if (tabId) {
        const redirectUrl = chrome.runtime.getURL('blocked.html') + `?url=${encodeURIComponent(url)}&category=${encodeURIComponent(returnedCategory || 'Restricted content')}&reason=${encodeURIComponent(result.child_message || result.parent_report || '')}`;
        await chrome.tabs.update(tabId, { url: redirectUrl });
      }
      return { received: true, safe: false, action: 'block', category: returnedCategory || 'Restricted content', child_message: result.child_message || '', confidence, stage: result.stage || 3 };
    }

    // ── NON-CHAT WARN ────────────────────────────────────────────────
    if (!isChat && action === 'warn' && confidence >= 0.50) {
      console.log(`[Analysis] ⚠️ PAGE WARN — category: ${returnedCategory}, confidence: ${confidence}`);
      if (tabId) tabAlertCooldown.set(tabId, Date.now());
      await notifyParent({ url, category: returnedCategory || 'risky_content', parent_report: result.parent_report || `Content on ${domain} (${returnedCategory})`, trigger_words: result.trigger_words || [], flagged_snippet: '' });
      if (tabId) {
        const reasonText = result.child_message || (result.trigger_words?.length ? `Detected: ${result.trigger_words.slice(0, 3).join(', ')}` : '') || result.parent_report || 'Content flagged for review';
        await fireLensTrigger(tabId, { risk: Math.round((riskScore || confidence) * 100), category: returnedCategory || 'Potentially inappropriate', reason: reasonText, domain });
      }
      return { received: true, safe: false, action: 'warn', category: returnedCategory || 'Potentially inappropriate', child_message: result.child_message || 'This page has some content worth knowing about.', confidence, stage: result.stage || 2 };
    }

    // ── SAFE ─────────────────────────────────────────────────────────
    console.log(`[Analysis] ✅ SAFE — category: ${returnedCategory}, confidence: ${confidence}`);
    return { received: true, safe: true, action: 'none', confidence, category: returnedCategory };

  } catch (error) {
    console.error("[Analysis] Failed (fail-open):", error);
    return { received: true, error: error.message };
  }
}