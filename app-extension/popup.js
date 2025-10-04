// GuardianCore Popup - Week 4: Child-facing with gamification cues
// Import strings module (inline for now)
const strings = {
  safe_streak: "Safe Streak",
  safe_streak_hours: "hours without violations",
  risk_score: "Risk Score",
  compliant_message: "Great job! Keep up the safe browsing.",
  child_view_message: "This is your activity summary. For changes, ask a parent.",
  settings_open_options: "Open Parent Settings"
};

console.log("[Popup] Script starting v0.4.0...");

// Establish persistent connection for real-time updates
let port = null;
try {
  port = chrome.runtime.connect({ name: "popup" });
  console.log("[Popup] Connected to background");
} catch (e) {
  console.error("[Popup] Failed to connect:", e);
}

document.addEventListener("DOMContentLoaded", () => {
  console.log("[Popup] DOM Content Loaded");
  
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
  loadGamificationState().catch(e => console.error("[Popup] loadGamification error:", e));
  // We still load settings to display current configuration but make inputs read-only
  loadSettings().catch(e => console.error("[Popup] loadSettings error:", e));
  loadCurrentTab().catch(e => console.error("[Popup] loadCurrentTab error:", e));
  // Removed loadActiveRules() - security: don't show rules to child
  loadStats().catch(e => console.error("[Popup] loadStats error:", e));
  
  // Listen for real-time updates from background
  chrome.runtime.onMessage.addListener(handleBackgroundMessage);

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
});

// Load gamification state (child-facing cues)
async function loadGamificationState() {
  try {
    chrome.runtime.sendMessage({ type: "GET_GAMIFICATION_STATE" }, (state) => {
      if (!state) return;
      
      // Update safe streak display
      const streakEl = document.getElementById("safe-streak-hours");
      if (streakEl) {
        streakEl.textContent = state.safeStreakHours || 0;
      }
      
      // Update risk score display
      const riskEl = document.getElementById("risk-score-value");
      if (riskEl) {
        riskEl.textContent = state.riskScore || 0;
        
        // Color code risk score
        const scoreNum = state.riskScore || 0;
        if (scoreNum < 30) {
          riskEl.className = "risk-low";
        } else if (scoreNum < 70) {
          riskEl.className = "risk-medium";
        } else {
          riskEl.className = "risk-high";
        }
      }
      
      // Show compliant message if streak is good
      const messageEl = document.getElementById("compliant-message");
      if (messageEl && state.safeStreakHours >= 12) {
        messageEl.textContent = strings.compliant_message;
        messageEl.classList.remove("hidden");
      }
    });
    
    // Check for time-left nudges
    chrome.runtime.sendMessage({ type: "CHECK_TIME_NUDGE" });
  } catch (e) {
    console.error("[Gamification] Load error:", e);
  }
}

// Handle real-time messages from background
function handleBackgroundMessage(message, sender, sendResponse) {
  console.log("[Popup] Message received:", message.type);
  
  if (message.type === "risk:update") {
    const riskEl = document.getElementById("risk-score-value");
    if (riskEl) {
      riskEl.textContent = message.score || 0;
    }
  } else if (message.type === "nudge:streak") {
    const streakEl = document.getElementById("safe-streak-hours");
    if (streakEl) {
      streakEl.textContent = message.hours || 0;
    }
    
    if (message.violation) {
      // Show violation notification
      const messageEl = document.getElementById("compliant-message");
      if (messageEl) {
        messageEl.textContent = "Safe streak reset due to violation";
        messageEl.className = "message-warning";
        messageEl.classList.remove("hidden");
      }
    }
  } else if (message.type === "nudge:timeleft") {
    // Show time-left nudge
    const nudgeEl = document.getElementById("time-nudge");
    if (nudgeEl) {
      nudgeEl.textContent = `Time restriction starts in ${message.minutes} minutes`;
      nudgeEl.classList.remove("hidden");
      
      // Auto-hide after 10 seconds
      setTimeout(() => {
        nudgeEl.classList.add("hidden");
      }, 10000);
    }
  } else if (message.type === "stats:update") {
    updateStatsDisplay(message.stats);
  }
}

async function loadSettings() {
  const { gc_backend_url, gc_api_token } = await chrome.storage.local.get(["gc_backend_url", "gc_api_token"]);
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
  
  const { gc_backend_url, gc_api_token } = await chrome.storage.local.get(["gc_backend_url", "gc_api_token"]);
  
  if (!gc_backend_url) {
    console.log("[loadStats] No backend URL");
    const totalEl = document.getElementById("stat-total");
    if (totalEl) totalEl.textContent = "-";
    return;
  }

  try {
  const url = `${gc_backend_url.replace(/\/+$/, "")}/audit/stats`;
    console.log("[loadStats] Fetching from:", url);
    
    const response = await fetch(url, {
      headers: { "Authorization": `Bearer ${gc_api_token}` }
    });

    console.log("[loadStats] Response status:", response.status);
    
    if (!response.ok) throw new Error("Failed to fetch");

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
