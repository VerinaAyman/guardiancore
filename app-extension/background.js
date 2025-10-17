// GuardianCore Audit Probe - Background Service Worker with Rule Enforcement
// Phase 5: Account-aware authentication and per-child rule enforcement
console.log("GuardianCore Audit Probe v0.5.0 loaded");

// ========== AUTHENTICATION STATE ==========
let currentUser = null; // { user_id, account_type, token, username }

// Auto-configure defaults on first load
async function ensureDefaultConfig() {
  try {
    const { gc_backend_url, gc_api_token, gc_config_initialized } = await chrome.storage.local.get([
      'gc_backend_url', 'gc_api_token', 'gc_config_initialized'
    ]);
    
    // Only auto-configure if not already initialized
    if (!gc_config_initialized) {
      const defaults = {};
      
      if (!gc_backend_url) {
        defaults.gc_backend_url = 'http://localhost:8000';
        console.log("[Config] Auto-configured backend URL: http://localhost:8000");
      }
      
      if (!gc_api_token) {
        defaults.gc_api_token = 'dev-token-123';
        console.log("[Config] Auto-configured dev token: dev-token-123");
      }
      
      // Mark as initialized
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

// Check authentication on startup
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
    // Open login page only if not already open
    const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL('login.html') });
    if (tabs.length === 0) {
      chrome.tabs.create({ url: chrome.runtime.getURL('login.html') });
    }
    return false;
  }
  
  // Verify token is still valid
  try {
    const { gc_backend_url } = await chrome.storage.local.get('gc_backend_url');
    const backendUrl = gc_backend_url || 'http://localhost:8000';
    
    const response = await fetch(`${backendUrl}/auth/verify`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${gc_auth_token}` }
    });
    
    if (!response.ok) {
      console.log("[Auth] Token expired or invalid - clearing auth");
      await chrome.storage.local.remove([
        'gc_auth_token', 'gc_user_id', 'gc_account_type', 'gc_username', 'gc_email'
      ]);
      // Open login page only if not already open
      const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL('login.html') });
      if (tabs.length === 0) {
        chrome.tabs.create({ url: chrome.runtime.getURL('login.html') });
      }
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
    
    // Load XP state for authenticated user
    await loadXpState();
    
    // Load rules if child account
    if (gc_account_type === 'child') {
      console.log("[Auth] Child account detected - loading rules NOW");
      await loadChildRules(gc_user_id, gc_auth_token);
      console.log("[Auth] Rules loaded. Rules cache state:", {
        allowlist: rulesCache.allowlist.length,
        blocklist: rulesCache.blocklist.length,
        time_window: rulesCache.time_window.length
      });
      
      // Apply dynamic blocking rules using declarativeNetRequest
      await updateDynamicBlockingRules();
    } else {
      console.log("[Auth] Parent account - no rules enforced");
      // Parent accounts have no restrictions
      rulesCache = { allowlist: [], blocklist: [], time_window: [], lastFetch: Date.now() };
      
      // Clear any existing blocking rules for parent
      await updateDynamicBlockingRules();
    }
    
    console.log("[Auth] ========================================");
    return true;
  } catch (error) {
    console.error("[Auth] Failed to verify token:", error);
    return false;
  }
}

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

// Initialize authentication and gamification
(async () => {
  await loadFastMode();
  await initializeAuth();
  // XP state will be loaded in initializeAuth if user is authenticated
})();

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

// XP farming prevention: track recent navigations (url -> timestamp)
const recentNavigations = new Map(); // url -> last_awarded_timestamp
const XP_COOLDOWN_MS = 30000; // 30 seconds cooldown per unique URL

// Legacy streak/risk state removed – XP only retained; keep violation timestamp for XP penalties if needed
let lastViolationTs = null;

// Blocking availability flag (for fallback navigation blocking if declarativeNetRequest fails)
let blockingAvailable = true;

// XP (fast-feedback gamification) state (daily reset) - per account
let xpState = {
  dayKey: null,  // 'YYYY-MM-DD'
  xp: 0,
  level: 1
};

async function loadXpState() {
  try {
    // Load XP for current user only
    if (!currentUser) return;
    
    const storageKey = `gc_xp_${currentUser.user_id}`;
    const result = await chrome.storage.local.get([storageKey]);
    if (result[storageKey]) {
      xpState = result[storageKey];
    } else {
      // Initialize new XP state for this user
      xpState = { dayKey: null, xp: 0, level: 1 };
    }
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
    // level persists across days (optional) – keep level
    persistXp();
  }
}

function persistXp() {
  if (!currentUser) return;
  
  const storageKey = `gc_xp_${currentUser.user_id}`;
  chrome.storage.local.set({ [storageKey]: xpState });
}

function awardXp(event) {
  ensureXpDay();
  // event carries: trackers, csp, cors, blocked, violation (boolean)
  let delta = 1; // base per navigation
  if (event.csp) delta += 2;
  if (event.cors) delta += 1;
  if (event.trackers === 0) delta += 3; else delta -= Math.min(event.trackers, 5) * 0.5; // gentler tracker penalty (-0.5 per tracker, max -2.5)
  if (event.blocked || event.violation) delta -= 5; // heavy penalty for blocked sites
  if (delta < 0) delta = Math.max(delta, -5); // floor penalty at -5
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

// ========== ACTIVITY TRACKING (GDPR-Compliant) ==========

// Extract eTLD+1 domain from URL
function extractDomain(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    
    // Simple eTLD+1 extraction (domain.com from www.subdomain.domain.com)
    const parts = hostname.split('.');
    if (parts.length >= 2) {
      return parts.slice(-2).join('.');
    }
    return hostname;
  } catch (e) {
    return null;
  }
}

// Track time spent on domain (per tab)
const domainTimeTracking = new Map(); // tabId -> { domain, startTime }

// Capture activity event (only if tracking enabled for child)
async function captureActivityEvent(eventType, domain, additionalData = {}) {
  try {
    if (!currentUser || currentUser.account_type !== 'child') {
      return; // Only track child accounts
    }
    
    const { gc_backend_url } = await chrome.storage.local.get('gc_backend_url');
    const backendUrl = gc_backend_url || 'http://localhost:8000';
    
    const eventData = {
      domain: domain,
      event_type: eventType,
      ...additionalData
    };
    
    // Send to backend (backend will check if tracking is enabled)
    const response = await fetch(`${backendUrl}/activity/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentUser.token}`
      },
      body: JSON.stringify(eventData)
    });
    
    if (response.ok) {
      const result = await response.json();
      if (result.stored) {
        console.log(`[Activity] Captured ${eventType} event for ${domain}`);
      }
    }
  } catch (error) {
    // Silently fail - don't disrupt user experience
    console.debug("[Activity] Failed to capture event:", error);
  }
}

// Track tab navigation and time spent
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    const domain = extractDomain(tab.url);
    if (!domain) return;
    
    // Stop tracking previous domain for this tab
    if (domainTimeTracking.has(tabId)) {
      const prev = domainTimeTracking.get(tabId);
      const timeSpent = Math.floor((Date.now() - prev.startTime) / 1000);
      
      // Only capture if spent more than 5 seconds
      if (timeSpent >= 5) {
        const tabData = ensureTab(tabId);
        captureActivityEvent('time_spent', prev.domain, {
          duration_seconds: timeSpent,
          has_csp: tabData.lastCsp,
          has_cors: tabData.lastCors
        });
      }
    }
    
    // Start tracking new domain
    domainTimeTracking.set(tabId, {
      domain: domain,
      startTime: Date.now()
    });
    
    // Capture visit event
    const tabData = ensureTab(tabId);
    captureActivityEvent('visit', domain, {
      has_csp: tabData.lastCsp,
      has_cors: tabData.lastCors
    });
  }
});

// Clean up tracking when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (domainTimeTracking.has(tabId)) {
    const prev = domainTimeTracking.get(tabId);
    const timeSpent = Math.floor((Date.now() - prev.startTime) / 1000);
    
    if (timeSpent >= 5) {
      const tabData = ensureTab(tabId);
      captureActivityEvent('time_spent', prev.domain, {
        duration_seconds: timeSpent,
        has_csp: tabData.lastCsp,
        has_cors: tabData.lastCors
      });
    }
    
    domainTimeTracking.delete(tabId);
  }
  tabState.delete(tabId);
});

// Track blocked attempts
async function captureBlockedAttempt(url, category, reason) {
  const domain = extractDomain(url);
  if (!domain) return;
  
  await captureActivityEvent('blocked', domain, {
    blocked_category: category || 'unknown'
  });
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

// Load rules for a specific child account
async function loadChildRules(childId, token) {
  try {
    const { gc_backend_url } = await chrome.storage.local.get('gc_backend_url');
    const backendUrl = gc_backend_url || 'http://localhost:8000';
    
    // Use the combined endpoint to get both child rules and group rules
    const url = `${backendUrl}/accounts/rules/combined/child/${childId}`;
    console.log("[Rules] Fetching combined rules from:", url);
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (!response.ok) {
      console.error("[Rules] Failed to load child rules:", response.status, response.statusText);
      const errorText = await response.text();
      console.error("[Rules] Error response:", errorText);
      return;
    }
    
    const rules = await response.json();
    console.log("[Rules] Raw rules fetched:", rules);
    
    // Filter only enabled rules for enforcement
    const enabledRules = rules.filter(r => r.enabled);
    
    rulesCache = {
      allowlist: enabledRules.filter(r => r.rule_type === "allowlist"),
      blocklist: enabledRules.filter(r => r.rule_type === "blocklist"),
      time_window: enabledRules.filter(r => r.rule_type === "time_window"),
      lastFetch: Date.now()
    };
    
    console.log("[Rules] Child rules loaded:", {
      total: rules.length,
      enabled: enabledRules.length,
      allowlist: rulesCache.allowlist.length,
      blocklist: rulesCache.blocklist.length,
      time_window: rulesCache.time_window.length
    });
    
    console.log("[Rules] Blocklist rules:", rulesCache.blocklist);
    
    // Update dynamic blocking rules after loading
    await updateDynamicBlockingRules();
  } catch (error) {
    console.error("[Rules] Failed to load child rules:", error);
  }
}

// Legacy fetchRules function - deprecated in Phase 5
// Kept for backward compatibility during migration
async function fetchRules() {
  console.warn("[Rules] fetchRules() is deprecated - use loadChildRules() instead");
  // If authenticated as child, reload rules
  if (currentUser && currentUser.account_type === 'child') {
    await loadChildRules(currentUser.user_id, currentUser.token);
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
function evaluateTimeWindows(url) {
  const now = new Date();
  const currentHour = now.getHours();
  const currentDay = now.getDay();
  const hostname = (()=>{ try { return new URL(url).hostname.replace(/^www\./,''); } catch { return ''; } })();

  const domainAllowWindows = [];
  const domainBlockWindows = [];
  const globalBlockWindows = [];

  for (const rule of rulesCache.time_window) {
    try {
      let cfg;
      
      // Try to parse as JSON first (new format)
      try {
        cfg = JSON.parse(rule.pattern);
      } catch (jsonError) {
        // Fall back to pipe-delimited format: domain|days|hours
        // Example: reddit.com|Mon,Tue,Wed,Thu,Fri,Sat,Sun|00:00-23:45
        const parts = rule.pattern.split('|');
        if (parts.length >= 3) {
          const domain = parts[0].trim();
          const daysStr = parts[1].trim();
          const hoursStr = parts[2].trim();
          
          // Parse days: Mon,Tue,Wed... to [1,2,3...]
          const dayMap = {'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6};
          const days = daysStr.split(',').map(d => dayMap[d.trim()]).filter(d => d !== undefined);
          
          // Parse hours: 00:00-23:45 to start_hour and end_hour
          const [startTime, endTime] = hoursStr.split('-');
          const startHour = parseInt(startTime.split(':')[0]);
          const endHour = parseInt(endTime.split(':')[0]);
          
          cfg = {
            domain: domain || null,
            days: days.length > 0 ? days : [0,1,2,3,4,5,6],
            start_hour: startHour,
            end_hour: endHour,
            action: 'block' // Default action for pipe format
          };
        } else {
          throw new Error('Invalid pipe format');
        }
      }
      
      if (cfg.days && !cfg.days.includes(currentDay)) continue;
      const startHour = cfg.start_hour ?? 0;
      const endHour = cfg.end_hour ?? 24;
      const inWindow = startHour > endHour
        ? (currentHour >= startHour || currentHour < endHour)
        : (currentHour >= startHour && currentHour < endHour);
      const action = cfg.action === 'allow' ? 'allow' : 'block';

      if (cfg.domain) {
        const matchesDomain = hostname === cfg.domain || hostname.endsWith('.' + cfg.domain);
        if (!matchesDomain) continue; // Domain-specific rule only applies to that domain
        if (action === 'allow') {
          domainAllowWindows.push({ rule, inWindow });
        } else {
          domainBlockWindows.push({ rule, inWindow });
        }
      } else {
        // Global only meaningful for block windows
        if (action === 'block') {
          globalBlockWindows.push({ rule, inWindow });
        }
      }
    } catch (e) {
      console.error('[TimeWindow] Invalid time window rule:', rule.pattern, e);
    }
  }

  // Domain allow semantics
  if (domainAllowWindows.length) {
    if (domainAllowWindows.some(w => w.inWindow)) {
      return { allowed: true, reason: 'Allowed (scheduled allow window)' };
    }
    return { blocked: true, rule: domainAllowWindows[0].rule, reason: 'Outside allowed time window' };
  }

  // Domain block semantics
  if (domainBlockWindows.some(w => w.inWindow)) {
    return { blocked: true, rule: domainBlockWindows.find(w => w.inWindow).rule, reason: 'Blocked during scheduled window' };
  }

  // Global block semantics
  if (globalBlockWindows.some(w => w.inWindow)) {
    return { blocked: true, rule: globalBlockWindows.find(w => w.inWindow).rule, reason: 'Blocked (global time window)' };
  }

  return { allowed: true };
}

// Enforce rules on a URL
function enforceRules(url, tabId) {
  // Parent accounts bypass all rule enforcement - NO LOGGING
  if (!currentUser || currentUser.account_type !== 'child') {
    return { allowed: true };
  }
  
  console.log("[Rules] Enforcing rules on CHILD account:", url);
  console.log("[Rules] Rules cache:", {
    allowlist: rulesCache.allowlist.length,
    blocklist: rulesCache.blocklist.length,
    time_window: rulesCache.time_window.length
  });
  
  // Check allowlist first
  for (const rule of rulesCache.allowlist) {
    if (matchesPattern(url, rule.pattern)) {
      console.log("[Rules] Allowed by allowlist rule:", rule.pattern);
      return { allowed: true };
    }
  }

  // Evaluate time window scheduling (domain + global)
  const schedule = evaluateTimeWindows(url);
  if (schedule.blocked) {
    console.log("[Rules] Blocked by time window:", schedule);
    const state = ensureTab(tabId);
    state.blocked = {
      reason: schedule.rule?.explanation || schedule.reason,
      rule: schedule.rule,
      timestamp: Date.now()
    };
    return { blocked: true, reason: state.blocked.reason, rule: schedule.rule };
  } else if (schedule.allowed === true && schedule.reason) {
    console.log("[Rules] Allowed by time window:", schedule);
    return { allowed: true };
  }

  // Check blocklist
  for (const rule of rulesCache.blocklist) {
    if (matchesPattern(url, rule.pattern)) {
      console.log("[Rules] BLOCKED by blocklist rule:", rule.pattern, "Explanation:", rule.explanation);
      const state = ensureTab(tabId);
      state.blocked = {
        reason: rule.explanation || `Blocked: ${rule.category || "restricted content"}`,
        rule: rule,
        timestamp: Date.now()
      };
      return { blocked: true, reason: state.blocked.reason, rule: rule };
    }
  }

  console.log("[Rules] No matching rules - allowing");
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
  ["responseHeaders"]
);

// GuardianCore: Dynamic rule management for child account enforcement
async function updateDynamicBlockingRules() {
  // Only create blocking rules if user is a child
  if (!currentUser || currentUser.account_type !== 'child') {
    // Clear all rules for parents
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    if (existingRules.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: existingRules.map(r => r.id)
      });
    }
    return;
  }

  console.log("[DNR] Building blocking rules for child account");
  
  // Convert blocklist rules to declarativeNetRequest format
  const dnrRules = [];
  let ruleId = 1;
  
  for (const rule of rulesCache.blocklist) {
    const pattern = rule.pattern.toLowerCase();
    
    // Build URL filter - handle both domain.com and *.domain.com patterns
    let urlFilter;
    if (pattern.startsWith('*.')) {
      urlFilter = `*://${pattern.substring(2)}/*`;
    } else if (!pattern.includes('/')) {
      urlFilter = `*://*${pattern}/*`;
    } else {
      urlFilter = pattern;
    }
    
    const redirectUrl = chrome.runtime.getURL("blocked.html") + 
      `?reason=${encodeURIComponent(rule.explanation || 'Blocked by parental controls')}` +
      `&category=${encodeURIComponent(rule.category || "restricted")}` +
      `&pattern=${encodeURIComponent(pattern)}`;
    
    dnrRules.push({
      id: ruleId++,
      priority: 1,
      action: {
        type: "redirect",
        redirect: { url: redirectUrl }
      },
      condition: {
        urlFilter: urlFilter,
        resourceTypes: ["main_frame"]
      }
    });
    
    console.log(`[DNR] Rule ${ruleId - 1}: Block ${urlFilter}`);
  }
  
  // Replace all dynamic rules with new set
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existingRules.map(r => r.id),
    addRules: dnrRules
  });
  
  console.log(`[DNR] Applied ${dnrRules.length} blocking rules`);
}


// Monitor navigation to track violations and award XP
chrome.webNavigation.onBeforeNavigate.addListener(
  async (details) => {
    if (details.frameId !== 0) return;
    if (!currentUser || currentUser.account_type !== 'child') return;
    
    // Check if URL matches any blocked pattern
    const url = details.url.toLowerCase();
    for (const rule of rulesCache.blocklist) {
      if (matchesPattern(url, rule.pattern)) {
        console.log("[Violation] Child attempted to access blocked site:", details.url);
        
        // Track violation
        lastViolationTs = Date.now();
        chrome.storage.local.set({ lastViolation: lastViolationTs });
        
        // Negative XP for violation
        awardXp({ trackers: 0, csp: false, cors: false, blocked: true, violation: true });
        
        // Capture blocked attempt for activity tracking
        await captureBlockedAttempt(details.url, rule.category, rule.explanation);
        
        break;
      }
    }
  }
);

// Fallback: If blocking permission not granted in this Chrome environment (e.g. enterprise policy),
// use webNavigation to detect completed loads of blocked pages and then forcibly redirect.
chrome.webRequest.onErrorOccurred?.addListener?.((info) => {
  // Detect specific permission error message pattern if possible (best effort)
  if (info.error && /blocked/i.test(info.error) && info.error.includes('permission')) {
    blockingAvailable = false;
    console.warn('[Blocking] webRequest blocking appears unavailable; activating fallback');
  }
}, { urls: ["<all_urls>"] });

chrome.webNavigation.onBeforeNavigate.addListener((nav) => {
  // This listener handles time window blocking since declarativeNetRequest doesn't support time-based rules
  if (!currentUser || currentUser.account_type !== 'child') return;
  if (nav.frameId !== 0) return; // Only check main frame
  if (nav.url.startsWith('chrome://') || nav.url.startsWith('chrome-extension://')) return;
  
  // Only check time windows here (blocklist is handled by declarativeNetRequest)
  const schedule = evaluateTimeWindows(nav.url);
  if (schedule.blocked) {
    console.log("[Blocking] ⏰ Time window blocking:", nav.url, schedule.reason);
    const blockUrl = chrome.runtime.getURL("blocked.html") +
      `?reason=${encodeURIComponent(schedule.reason || 'Outside allowed time window')}` +
      `&category=time_restriction` +
      `&url=${encodeURIComponent(nav.url)}`;
    chrome.tabs.update(nav.tabId, { url: blockUrl });
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

    const { gc_backend_url } = await chrome.storage.local.get(["gc_backend_url"]);
    if (!gc_backend_url) return;
    
    // Include user_id in audit record for per-account tracking
    if (currentUser) {
      record.user_id = currentUser.user_id;
    }
    
    const submitUrl = `${gc_backend_url.replace(/\/+$/, "")}/audit/submit?tab_id=${nav.tabId}`;

    await fetch(submitUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": currentUser ? `Bearer ${currentUser.token}` : ""
      },
      body: JSON.stringify(record),
      keepalive: true
    }).catch(() => {});

    // XP farming prevention: check cooldown
    const now = Date.now();
    const lastAwarded = recentNavigations.get(tab.url) || 0;
    const timeSinceLastAward = now - lastAwarded;
    
    if (timeSinceLastAward >= XP_COOLDOWN_MS) {
      // Local fast-feedback XP award
      awardXp({
        trackers: navTrackers,
        csp: record.policy_state.csp_present,
        cors: record.policy_state.cors_signals,
        blocked: record.policy_state.blocked,
        violation: false
      });
      
      // Update last awarded timestamp
      recentNavigations.set(tab.url, now);
      
      // Cleanup old entries (keep last 100 URLs to prevent memory leak)
      if (recentNavigations.size > 100) {
        const oldestKey = recentNavigations.keys().next().value;
        recentNavigations.delete(oldestKey);
      }
    } else {
      console.log(`[XP] Cooldown active for ${tab.url} (${Math.round((XP_COOLDOWN_MS - timeSinceLastAward) / 1000)}s remaining)`);
    }
  } catch (e) {
    console.error("Audit submit error:", e);
  }
});

// Clean up tab state
chrome.tabs.onRemoved.addListener((tabId) => {
  tabState.delete(tabId);
});

// Fetch risk score from backend

// Fetch audit stats - global stats with optional time window
async function fetchStats() {
  try {
    if (!currentUser) return;
    
    const { gc_backend_url } = await chrome.storage.local.get(["gc_backend_url"]);
    if (!gc_backend_url) return;

    // Fetch global audit stats (backend doesn't filter by user_id)
    const url = `${gc_backend_url.replace(/\/+$/, "")}/audit/stats`;
    const response = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${currentUser.token}`
      }
    });

    if (response.ok) {
      const stats = await response.json();
      console.log("[Stats] Stats updated:", stats);
      
      // Notify UIs
      chrome.runtime.sendMessage({
        type: "stats:update",
        stats: stats
      }).catch(() => {});
    } else {
      console.error("[Stats] Failed to fetch stats:", response.status, response.statusText);
      if (response.status === 401) {
        chrome.runtime.sendMessage({ type: 'stats:error', error: 'unauthorized' }).catch(()=>{});
      }
    }
  } catch (e) {
    console.error("[Stats] Failed to fetch stats:", e);
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
    // Only fetch data if authenticated
    if (currentUser) {
      if (currentUser.account_type === 'child') {
        await loadChildRules(currentUser.user_id, currentUser.token);
      }
      await fetchStats();
    }
    
    updateTimer = null;
    
    // Schedule next update in 30 seconds
    setTimeout(scheduleBackgroundUpdate, 30000);
  }, 1000);
}

// Initialize on startup
chrome.runtime.onInstalled.addListener(async () => {
  console.log("GuardianCore Audit Probe installed");
  await ensureDefaultConfig(); // Auto-configure defaults first
  await initializeAuth(); // Check authentication
  loadFastMode();
  if (currentUser) {
    await loadXpState(); // Load XP for authenticated user
  }
  scheduleBackgroundUpdate();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDefaultConfig(); // Auto-configure defaults first
  await initializeAuth(); // Check authentication
  loadFastMode();
  if (currentUser) {
    await loadXpState(); // Load XP for authenticated user
  }
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
    // Refresh rules for current child account
    if (currentUser && currentUser.account_type === 'child') {
      loadChildRules(currentUser.user_id, currentUser.token).then(() => sendResponse({ ok: true }));
    } else {
      sendResponse({ ok: true });
    }
    return true; // Async response
  } else if (message.type === "CHECK_AUTH") {
    // Return current authentication state
    sendResponse({
      authenticated: !!currentUser,
      user: currentUser ? {
        user_id: currentUser.user_id,
        username: currentUser.username,
        account_type: currentUser.account_type
      } : null
    });
  } else if (message.type === "AUTH_UPDATED") {
    // Handle authentication update (login/register)
    console.log("[Auth] Received AUTH_UPDATED message - reloading authentication");
    initializeAuth().then(() => sendResponse({ ok: true }));
    return true; // Async response
  } else if (message.type === "LOGOUT") {
    // Handle logout
    currentUser = null;
    rulesCache = { allowlist: [], blocklist: [], time_window: [], lastFetch: 0 };
    chrome.storage.local.remove([
      'gc_auth_token', 'gc_user_id', 'gc_account_type', 'gc_username', 'gc_email'
    ]).then(async () => {
      // Open login page only if not already open
      const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL('login.html') });
      if (tabs.length === 0) {
        chrome.tabs.create({ url: chrome.runtime.getURL('login.html') });
      }
      sendResponse({ ok: true });
    });
    return true;
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
