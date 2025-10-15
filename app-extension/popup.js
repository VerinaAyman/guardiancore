// GuardianCore Popup - Phase 5: Account-aware with per-user stats
console.log("[Popup] Script starting v0.5.0...");

// Current user state
let currentUser = null;

// Establish persistent connection for real-time updates
let port = null;
try {
  port = chrome.runtime.connect({ name: "popup" });
  console.log("[Popup] Connected to background");
} catch (e) {
  console.error("[Popup] Failed to connect:", e);
}

// Check authentication status
async function checkAuth() {
  try {
    // Get auth from storage
    const { gc_auth_token, gc_user_id, gc_account_type, gc_username } = await chrome.storage.local.get([
      'gc_auth_token', 'gc_user_id', 'gc_account_type', 'gc_username'
    ]);
    
    if (!gc_auth_token || !gc_user_id) {
      showLoginPrompt();
      return false;
    }
    
    // Try to get user info from background, but fall back to storage if it fails
    try {
      const response = await Promise.race([
        chrome.runtime.sendMessage({ type: "CHECK_AUTH" }),
        new Promise((resolve) => setTimeout(() => resolve(null), 1000))
      ]);
      
      if (response && response.authenticated) {
        currentUser = response.user;
        showUserInfo();
        return true;
      }
    } catch (bgError) {
      console.log("[Popup] Background not responding, using storage data");
    }
    
    // Fallback: use storage data directly
    currentUser = {
      user_id: gc_user_id,
      username: gc_username,
      account_type: gc_account_type
    };
    showUserInfo();
    return true;
  } catch (error) {
    console.error("[Popup] Auth check failed:", error);
    showLoginPrompt();
    return false;
  }
}

// Show user info in header
function showUserInfo() {
  const userInfoEl = document.getElementById('user-info');
  const loginPromptEl = document.getElementById('login-prompt');
  const contentEl = document.querySelector('.tabs');
  
  if (userInfoEl && currentUser) {
    // Set user info
    const userNameEl = document.getElementById('user-name');
    const userTypeEl = document.getElementById('user-type');
    const avatarEl = userInfoEl.querySelector('.user-avatar');
    
    if (userNameEl) userNameEl.textContent = currentUser.username;
    if (userTypeEl) userTypeEl.textContent = currentUser.account_type;
    if (avatarEl) avatarEl.textContent = currentUser.username.charAt(0).toUpperCase();
    
    userInfoEl.classList.remove('hidden');
  }
  
  if (loginPromptEl) loginPromptEl.classList.add('hidden');
  if (contentEl) contentEl.classList.remove('hidden');
}

// Show login prompt
function showLoginPrompt() {
  const userInfoEl = document.getElementById('user-info');
  const loginPromptEl = document.getElementById('login-prompt');
  const contentEl = document.querySelector('.tabs');
  
  if (userInfoEl) userInfoEl.classList.add('hidden');
  if (loginPromptEl) loginPromptEl.classList.remove('hidden');
  if (contentEl) contentEl.classList.add('hidden');
}

// Handle logout
async function handleLogout() {
  try {
    await chrome.runtime.sendMessage({ type: "LOGOUT" });
    currentUser = null;
    showLoginPrompt();
  } catch (error) {
    console.error("[Popup] Logout failed:", error);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  console.log("[Popup] DOM Content Loaded");
  
  // Attach login button FIRST (before checkAuth)
  const openLoginBtn = document.getElementById("open-login-btn");
  if (openLoginBtn) {
    openLoginBtn.addEventListener("click", () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('login.html') });
    });
    console.log("[Popup] Open login button attached");
  }
  
  // Check authentication
  const isAuthenticated = await checkAuth();
  if (!isAuthenticated) {
    console.log("[Popup] Not authenticated, showing login prompt");
    return;
  }
  
  // Tab switching
  const tabs = document.querySelectorAll('.tab');
  console.log("[Popup] Found tabs:", tabs.length);
  
  tabs.forEach((tab, index) => {
    console.log(`[Popup] Setting up tab ${index}:`, tab.dataset.tab);
    tab.addEventListener('click', () => {
      console.log("[Popup] Tab clicked:", tab.dataset.tab);
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const targetTab = document.getElementById(`${tab.dataset.tab}-tab`);
      if (targetTab) {
        targetTab.classList.add('active');
        console.log("[Popup] Switched to tab:", tab.dataset.tab);
      } else {
        console.error("[Popup] Tab content not found:", `${tab.dataset.tab}-tab`);
      }
    });
  });

  // Initialize
  console.log("[Popup] Starting initialization...");
  // Load gamification state first (child-facing)
  // Legacy gamification (streak/risk) removed – XP only now
  // We still load settings to display current configuration but make inputs read-only
  loadSettings().catch(e => console.error("[Popup] loadSettings error:", e));
  loadCurrentTab().catch(e => console.error("[Popup] loadCurrentTab error:", e));
  // Removed loadActiveRules() - security: don't show rules to child
  loadStats().catch(e => console.error("[Popup] loadStats error:", e));
  // Load XP state
  requestXpState();
  
  // Listen for real-time updates from background
  chrome.runtime.onMessage.addListener(handleBackgroundMessage);

  // Logout button
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", handleLogout);
    console.log("[Popup] Logout button attached");
  }

  // Save settings button
  const saveBtn = document.getElementById("save-settings");
  if (saveBtn) {
    saveBtn.textContent = "Open Parent Settings";
    saveBtn.addEventListener("click", openParentSettings);
    console.log("[Popup] Parent settings redirect button attached");
  }

  // Make backend URL and token fields read-only and clickable to open parent settings
  const backendInput = document.getElementById("backend-url");
  const tokenInput = document.getElementById("api-token");
  [backendInput, tokenInput].forEach(el => {
    if (el) {
      el.setAttribute("readonly", "readonly");
      el.classList.add("readonly-field");
      el.addEventListener("click", openParentSettings);
    }
  });
  
  // Refresh stats button
  const refreshBtn = document.getElementById("refresh-stats");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      refreshBtn.disabled = true;
      refreshBtn.textContent = "Loading...";
      loadStats().then(() => {
        refreshBtn.disabled = false;
        refreshBtn.textContent = "Refresh Statistics";
      }).catch(e => {
        console.error("[Popup] Refresh stats error:", e);
        refreshBtn.disabled = false;
        refreshBtn.textContent = "Refresh Statistics";
      });
    });
    console.log("[Popup] Refresh stats button attached");
  } else {
    console.error("[Popup] refresh-stats button not found");
  }
  
  console.log("[Popup] Initialization complete");

  // Dev tools unlock: press D 5 times quickly inside popup to toggle
  setupDevToolsHotkey();
  attachDevToolsHandlers();
});

// Load gamification state (child-facing cues)
// Removed loadGamificationState (legacy)

// Handle real-time messages from background
function handleBackgroundMessage(message, sender, sendResponse) {
  console.log("[Popup] Message received:", message.type);
  
  if (message.type === "stats:update") {
    updateStatsDisplay(message.stats);
  } else if (message.type === "xp:update") {
    updateXpDisplay(message);
  }
}

// --- Dev/Test Tooling ---
let devUnlockClicks = 0;
let devUnlockTimer = null;
let devEnabled = false;

function setupDevToolsHotkey() {
  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'd') {
      devUnlockClicks++;
      if (!devUnlockTimer) {
        devUnlockTimer = setTimeout(() => {
          devUnlockClicks = 0;
          devUnlockTimer = null;
        }, 1500);
      }
      if (devUnlockClicks >= 5) {
        toggleDevTools();
        devUnlockClicks = 0;
        clearTimeout(devUnlockTimer);
        devUnlockTimer = null;
      }
    }
  });
}

function toggleDevTools() {
  devEnabled = !devEnabled;
  const panel = document.getElementById('dev-tools');
  if (panel) {
    panel.classList.toggle('hidden', !devEnabled);
  }
  const breakdown = document.getElementById('risk-breakdown');
  if (breakdown) breakdown.classList.toggle('hidden', !devEnabled);
}

function attachDevToolsHandlers() {
  const fastBtn = document.getElementById('dev-toggle-fast');
  const vioBtn = document.getElementById('dev-violation');
  const resetXpBtn = document.getElementById('dev-reset-xp');
  // Removed risk refresh & streak manipulation controls
  // Optionally add a reset XP button if dev tools present in future
  const statusEl = document.getElementById('dev-status');
  

  function setStatus(msg, cls='status-info') {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = `status ${cls}`;
    statusEl.classList.remove('hidden');
    setTimeout(() => statusEl.classList.add('hidden'), 3000);
  }

  if (fastBtn) fastBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'DEV_TOGGLE_FAST_MODE' }, (res) => {
      if (!res) return;
      fastBtn.textContent = res.fastMode ? 'Disable Fast Mode' : 'Enable Fast Mode';
      setStatus(`Fast Mode: ${res.fastMode ? 'ON' : 'OFF'}`);
    });
  });

  if (vioBtn) vioBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'DEV_SIMULATE_VIOLATION' }, () => {
      setStatus('Simulated violation (XP penalty applied)', 'status-warning');
      requestXpState();
    });
  });
  if (resetXpBtn) resetXpBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'DEV_RESET_XP' }, () => {
      setStatus('XP reset', 'status-info');
      requestXpState();
    });
  });
}

async function requestXpState() {
  if (!currentUser) {
    console.log("[XP] No authenticated user");
    return;
  }
  
  try {
    // Load XP state for current user
    const storageKey = `gc_xp_${currentUser.user_id}`;
    const result = await chrome.storage.local.get([storageKey]);
    const xpState = result[storageKey] || { dayKey: null, xp: 0, level: 1 };
    updateXpDisplay(xpState);
  } catch (error) {
    console.error("[XP] Failed to load XP state:", error);
  }
}

function updateXpDisplay(state) {
  const xpVal = document.getElementById('xp-value');
  const lvlEl = document.getElementById('xp-level');
  const bar = document.getElementById('xp-bar-fill');
  const remainingEl = document.getElementById('xp-remaining');
  
  const currentXp = state.xp ?? 0;
  const currentLevel = state.level ?? 1;
  const xpNeeded = 100; // Always 100 XP per level
  const progress = (currentXp / xpNeeded) * 100;
  const remaining = xpNeeded - currentXp;
  
  console.log("[XP Display]", { currentXp, currentLevel, progress, remaining });
  
  if (xpVal) xpVal.textContent = currentXp;
  if (lvlEl) lvlEl.textContent = currentLevel;
  if (bar) {
    const widthPercent = Math.min(100, Math.max(0, progress));
    bar.style.width = `${widthPercent}%`;
    console.log("[XP Bar] Set width to:", widthPercent + "%");
  }
  if (remainingEl) {
    remainingEl.textContent = `${remaining} XP to next level`;
  }
}

// Risk breakdown removed

async function loadSettings() {
  // Ensure defaults are set (in case background hasn't initialized yet)
  let { gc_backend_url, gc_api_token, gc_config_initialized } = await chrome.storage.local.get([
    "gc_backend_url", "gc_api_token", "gc_config_initialized"
  ]);
  
  // Auto-configure if not initialized
  if (!gc_config_initialized) {
    const defaults = {};
    
    if (!gc_backend_url) {
      defaults.gc_backend_url = 'http://localhost:8000';
      gc_backend_url = 'http://localhost:8000';
    }
    
    if (!gc_api_token) {
      defaults.gc_api_token = 'dev-token-123';
      gc_api_token = 'dev-token-123';
    }
    
    defaults.gc_config_initialized = true;
    await chrome.storage.local.set(defaults);
    console.log("[Popup] Auto-configured defaults");
  }
  
  if (gc_backend_url) document.getElementById("backend-url").value = gc_backend_url;
  if (gc_api_token) document.getElementById("api-token").value = gc_api_token;
}

function openParentSettings() {
  // Open options page (parent PIN lock will gate changes)
  console.log("[Popup] Redirecting to options page for parent auth");
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.open(chrome.runtime.getURL('options.html'));
  }
}

function updateStatsDisplay(stats) {
  const totalEl = document.getElementById("stat-total");
  const uniqueEl = document.getElementById("stat-unique");
  const trackersEl = document.getElementById("stat-trackers");
  
  if (totalEl) totalEl.textContent = stats.total_audits || 0;
  if (uniqueEl) uniqueEl.textContent = stats.unique_origins || 0;
  if (trackersEl) trackersEl.textContent = (stats.avg_trackers || 0).toFixed(2);
}

async function loadCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.url?.startsWith("chrome://") || tab.url?.startsWith("chrome-extension://")) {
    return;
  }

  chrome.runtime.sendMessage({ type: "GET_TAB_STATE", tabId: tab.id }, (state) => {
    if (!state) return;
    document.getElementById("current-trackers").textContent = state.trackerCount || 0;
    document.getElementById("current-csp").textContent = state.lastCsp ? "Yes" : "No";
    document.getElementById("current-cors").textContent = state.lastCors ? "Yes" : "No";
  });
}

async function loadActiveRules() {
  console.log("[loadActiveRules] Starting...");
  
  const { gc_backend_url, gc_api_token } = await chrome.storage.local.get(["gc_backend_url", "gc_api_token"]);
  console.log("[loadActiveRules] Storage:", { gc_backend_url, hasToken: !!gc_api_token });
  
  const rulesDiv = document.getElementById("active-rules");
  
  if (!rulesDiv) {
    console.error("[loadActiveRules] active-rules div not found!");
    return;
  }
  
  if (!gc_backend_url) {
    console.log("[loadActiveRules] No backend URL configured");
    rulesDiv.innerHTML = '<div class="empty-state">Configure backend in Settings tab</div>';
    return;
  }

  try {
  const url = `${gc_backend_url.replace(/\/+$/, "")}/rules?enabled_only=true`;
    console.log("[loadActiveRules] Fetching from:", url);
    
    const response = await fetch(url, {
      headers: { "Authorization": `Bearer ${gc_api_token}` }
    });

    console.log("[loadActiveRules] Response status:", response.status);
    
    if (!response.ok) {
      console.error("[loadActiveRules] Fetch failed:", response.status);
      throw new Error(`HTTP ${response.status}`);
    }

    const rules = await response.json();
    console.log("[loadActiveRules] Rules loaded:", rules.length, "rules");
    console.log("[loadActiveRules] Rules data:", rules);
    
    if (rules.length === 0) {
      rulesDiv.innerHTML = '<div class="empty-state">No active rules</div>';
      return;
    }

    const html = rules.map(rule => {
      let display = rule.pattern;
      if (rule.rule_type === "time_window") {
        try {
          const config = JSON.parse(rule.pattern);
          const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
          const days = config.days || [];
          const daysStr = days.length === 7 ? "Every day" : days.map(d => dayNames[d]).join(", ");
          display = `${config.start_hour}:00-${config.end_hour}:00 (${daysStr})`;
        } catch {}
      }
      return `
        <div class="rule-item">
          <span class="badge badge-${rule.rule_type}">${rule.rule_type}</span>
          <span class="rule-pattern">${display}</span>
        </div>
      `;
    }).join("");

    rulesDiv.innerHTML = html;
    console.log("[loadActiveRules] Rules displayed successfully");
  } catch (e) {
    console.error("[loadActiveRules] Error:", e);
    console.error("[loadActiveRules] Error stack:", e.stack);
    rulesDiv.innerHTML = `<div class="empty-state">Error: ${e.message}</div>`;
  }
}

async function loadStats() {
  console.log("[loadStats] Starting...");
  
  if (!currentUser) {
    console.log("[loadStats] No authenticated user");
    return;
  }
  
  const { gc_backend_url, gc_auth_token } = await chrome.storage.local.get(["gc_backend_url", "gc_auth_token"]);
  
  console.log("[loadStats] Backend URL:", gc_backend_url);
  console.log("[loadStats] Has auth token:", !!gc_auth_token);
  
  if (!gc_backend_url) {
    console.log("[loadStats] No backend URL");
    const totalEl = document.getElementById("stat-total");
    if (totalEl) totalEl.textContent = "-";
    return;
  }
  
  if (!gc_auth_token) {
    console.error("[loadStats] No auth token found");
    const totalEl = document.getElementById("stat-total");
    if (totalEl) totalEl.textContent = "Error";
    return;
  }

  try {
    // Fetch per-user audit stats (backend filters by JWT user_id)
    const url = `${gc_backend_url.replace(/\/+$/, "")}/audit/stats`;
    console.log("[loadStats] Fetching from:", url);
    console.log("[loadStats] Using token:", gc_auth_token.substring(0, 20) + "...");
    
    const response = await fetch(url, {
      headers: { "Authorization": `Bearer ${gc_auth_token}` }
    });

    console.log("[loadStats] Response status:", response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("[loadStats] Failed to fetch stats:", response.status, errorText);
      throw new Error(`Failed to fetch: ${response.status}`);
    }

    const stats = await response.json();
    console.log("[loadStats] Stats loaded:", stats);
    
    const totalEl = document.getElementById("stat-total");
    const uniqueEl = document.getElementById("stat-unique");
    const trackersEl = document.getElementById("stat-trackers");
    const cspEl = document.getElementById("stat-csp");
    const corsEl = document.getElementById("stat-cors");
    
    if (totalEl) totalEl.textContent = stats.total_audits || 0;
    if (uniqueEl) uniqueEl.textContent = stats.unique_origins || 0;
    if (trackersEl) trackersEl.textContent = (stats.avg_trackers || 0).toFixed(2);
  if (cspEl) cspEl.textContent = `${Math.round((stats.csp_coverage || 0)*100)}%`;
  if (corsEl) corsEl.textContent = `${Math.round((stats.cors_coverage || 0)*100)}%`;
    
    console.log("[loadStats] Stats displayed successfully");
  } catch (e) {
    console.error("[loadStats] Error:", e);
    const totalEl = document.getElementById("stat-total");
    if (totalEl) totalEl.textContent = "Error";
  }
}
