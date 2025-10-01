// GuardianCore Popup

console.log("[Popup] Script starting...");

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
  // We still load settings to display current configuration but make inputs read-only
  loadSettings().catch(e => console.error("[Popup] loadSettings error:", e));
  loadCurrentTab().catch(e => console.error("[Popup] loadCurrentTab error:", e));
  loadActiveRules().catch(e => console.error("[Popup] loadActiveRules error:", e));
  loadStats().catch(e => console.error("[Popup] loadStats error:", e));

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
    if (cspEl) cspEl.textContent = `${stats.csp_percentage || 0}%`;
    if (corsEl) corsEl.textContent = `${stats.cors_percentage || 0}%`;
    
    console.log("[loadStats] Stats displayed successfully");
  } catch (e) {
    console.error("[loadStats] Error:", e);
    const totalEl = document.getElementById("stat-total");
    if (totalEl) totalEl.textContent = "Error";
  }
}
