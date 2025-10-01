// GuardianCore Options Page - Parent Settings with PIN Protection

console.log("[Options] Script starting...");

let isUnlocked = false;
let selectedDays = [0, 1, 2, 3, 4, 5, 6]; // All days by default

// PIN verification
async function checkPIN() {
  const { parent_pin = "1234" } = await chrome.storage.local.get("parent_pin");
  console.log("[checkPIN] PIN retrieved");
  return parent_pin;
}

async function verifyPIN(inputPIN) {
  const correctPIN = await checkPIN();
  const isValid = inputPIN === correctPIN;
  console.log("[verifyPIN] Verification result:", isValid);
  return isValid;
}

// Show/hide main content
function showMainContent() {
  document.getElementById("lock-screen").classList.add("hidden");
  document.getElementById("main-content").classList.remove("hidden");
  isUnlocked = true;
  loadSettings();
  loadRules();
}

function showStatus(elementId, message, type) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = message;
  el.className = `status status-${type}`;
  el.classList.remove("hidden");
  
  if (type === "success") {
    setTimeout(() => el.classList.add("hidden"), 3000);
  }
}

// Load backend settings
async function loadSettings() {
  const { gc_backend_url, gc_api_token, parent_pin } = await chrome.storage.local.get([
    "gc_backend_url",
    "gc_api_token",
    "parent_pin"
  ]);
  
  const backendUrlEl = document.getElementById("backend-url");
  const apiTokenEl = document.getElementById("api-token");
  const parentPinEl = document.getElementById("parent-pin");
  
  if (gc_backend_url && backendUrlEl) backendUrlEl.value = gc_backend_url;
  if (gc_api_token && apiTokenEl) apiTokenEl.value = gc_api_token;
  if (parent_pin && parentPinEl) parentPinEl.value = parent_pin;
}

// Load rules
async function loadRules() {
  const { gc_backend_url, gc_api_token } = await chrome.storage.local.get([
    "gc_backend_url",
    "gc_api_token"
  ]);
  
  const rulesList = document.getElementById("rules-list");
  if (!rulesList) return;
  
  if (!gc_backend_url) {
    rulesList.innerHTML = '<div class="empty-state">Configure backend settings first</div>';
    return;
  }
  
  try {
  const response = await fetch(`${gc_backend_url.replace(/\/+$/, "")}/rules?enabled_only=false`, {
      headers: {
        "Authorization": `Bearer ${gc_api_token}`
      }
    });
    
    if (!response.ok) throw new Error("Failed to fetch rules");
    
    const rules = await response.json();
    
    if (rules.length === 0) {
      rulesList.innerHTML = '<div class="empty-state">No rules yet. Add one above!</div>';
      return;
    }
    
    const html = rules.map(rule => {
      const patternDisplay = rule.rule_type === "time_window" 
        ? formatTimeWindow(rule.pattern)
        : rule.pattern;
      
      return `
        <div class="rule-card">
          <div class="rule-header">
            <div class="rule-info">
              <h4>
                <span class="badge badge-${rule.rule_type}">${rule.rule_type}</span>
                ${patternDisplay}
              </h4>
              <div class="rule-meta">
                ${rule.category ? `Category: ${rule.category} • ` : ""}
                ${rule.explanation}
              </div>
            </div>
            <div class="rule-actions">
              <button class="secondary rule-toggle-btn" data-rule-id="${rule.id}" data-next-enabled="${!rule.enabled}">
                ${rule.enabled ? "Disable" : "Enable"}
              </button>
              <button class="danger rule-delete-btn" data-rule-id="${rule.id}">Delete</button>
            </div>
          </div>
          <span class="badge badge-${rule.enabled ? 'enabled' : 'disabled'}">
            ${rule.enabled ? 'Active' : 'Disabled'}
          </span>
        </div>
      `;
    }).join("");
    
    rulesList.innerHTML = html;
  } catch (e) {
    rulesList.innerHTML = `<div class="empty-state">Error loading rules: ${e.message}</div>`;
  }
}

// Format time window display
function formatTimeWindow(pattern) {
  try {
    const config = JSON.parse(pattern);
    const days = config.days || [];
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const daysStr = days.length === 7 ? "Every day" : days.map(d => dayNames[d]).join(", ");
    return `${config.start_hour}:00 - ${config.end_hour}:00 (${daysStr})`;
  } catch {
    return pattern;
  }
}

// Toggle rule enabled/disabled  
window.toggleRule = async function(ruleId, enable) {
  console.log("[toggleRule] Called:", ruleId, enable);
  const { gc_backend_url, gc_api_token } = await chrome.storage.local.get([
    "gc_backend_url",
    "gc_api_token"
  ]);
  
  console.log("[toggleRule] Backend URL:", gc_backend_url);
  
  try {
  const url = `${gc_backend_url.replace(/\/+$/, "")}/rules/${ruleId}`;
    console.log("[toggleRule] Fetching:", url);
    
    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${gc_api_token}`
      },
      body: JSON.stringify({ enabled: enable })
    });
    
    console.log("[toggleRule] Response status:", response.status);
    
    if (!response.ok) throw new Error("Failed to update rule");
    
    console.log("[toggleRule] Success, reloading rules...");
    loadRules();
    chrome.runtime.sendMessage({ type: "REFRESH_RULES" });
  } catch (e) {
    console.error("[toggleRule] Error:", e);
    alert(`Error: ${e.message}`);
  }
};

// Delete rule
window.deleteRule = async function(ruleId) {
  console.log("[deleteRule] Called:", ruleId);
  if (!confirm("Are you sure you want to delete this rule?")) {
    console.log("[deleteRule] User cancelled");
    return;
  }
  
  const { gc_backend_url, gc_api_token } = await chrome.storage.local.get([
    "gc_backend_url",
    "gc_api_token"
  ]);
  
  console.log("[deleteRule] Backend URL:", gc_backend_url);
  
  try {
  const url = `${gc_backend_url.replace(/\/+$/, "")}/rules/${ruleId}`;
    console.log("[deleteRule] Fetching:", url);
    
    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        "Authorization": `Bearer ${gc_api_token}`
      }
    });
    
    console.log("[deleteRule] Response status:", response.status);
    
    if (!response.ok) throw new Error("Failed to delete rule");
    
    console.log("[deleteRule] Success, reloading rules...");
    loadRules();
    chrome.runtime.sendMessage({ type: "REFRESH_RULES" });
  } catch (e) {
    console.error("[deleteRule] Error:", e);
    alert(`Error: ${e.message}`);
  }
};

// Initialize after DOM loads
document.addEventListener("DOMContentLoaded", () => {
  console.log("[Options] DOM Content Loaded");
  
  // Auto-focus PIN input
  const pinInput = document.getElementById("pin-input");
  if (pinInput) pinInput.focus();
  
  // PIN unlock
  const unlockBtn = document.getElementById("unlock-btn");
  if (unlockBtn) {
    unlockBtn.addEventListener("click", async () => {
      const pin = pinInput?.value.trim();
      
      if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
        showStatus("pin-status", "PIN must be 4 digits", "error");
        return;
      }
      
      const isValid = await verifyPIN(pin);
      if (isValid) {
        showMainContent();
      } else {
        showStatus("pin-status", "Incorrect PIN", "error");
        if (pinInput) pinInput.value = "";
      }
    });
  }
  
  // Enter key to unlock
  if (pinInput) {
    pinInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        unlockBtn?.click();
      }
    });
  }
  
  // Save backend settings
  const saveBackendBtn = document.getElementById("save-backend-btn");
  if (saveBackendBtn) {
    saveBackendBtn.addEventListener("click", async () => {
      const backendUrl = document.getElementById("backend-url")?.value.trim();
      const apiToken = document.getElementById("api-token")?.value.trim();
      const parentPin = document.getElementById("parent-pin")?.value.trim();
      
      if (!backendUrl || !apiToken) {
        showStatus("backend-status", "Backend URL and API Token are required", "error");
        return;
      }
      
      if (parentPin && (parentPin.length !== 4 || !/^\d{4}$/.test(parentPin))) {
        showStatus("backend-status", "PIN must be 4 digits", "error");
        return;
      }
      
      try {
        new URL(backendUrl);
      } catch (e) {
        showStatus("backend-status", "Invalid URL format", "error");
        return;
      }
      
      await chrome.storage.local.set({
        gc_backend_url: backendUrl,
        gc_api_token: apiToken,
        parent_pin: parentPin || "1234"
      });
      
      showStatus("backend-status", "Settings saved successfully!", "success");
      
      // Notify background to refresh rules
      chrome.runtime.sendMessage({ type: "REFRESH_RULES" });
    });
  }
  
  // Rule type change handler
  const ruleTypeSelect = document.getElementById("rule-type");
  if (ruleTypeSelect) {
    ruleTypeSelect.addEventListener("change", (e) => {
      const isTimeWindow = e.target.value === "time_window";
      const domainGroup = document.getElementById("domain-input-group");
      const timeGroup = document.getElementById("time-input-group");
      if (domainGroup) domainGroup.classList.toggle("hidden", isTimeWindow);
      if (timeGroup) timeGroup.classList.toggle("hidden", !isTimeWindow);
    });
  }
  
  // Day selector
  document.querySelectorAll(".day-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const day = parseInt(btn.dataset.day);
      const isSelected = btn.classList.contains("selected");
      
      if (isSelected) {
        btn.classList.remove("selected");
        selectedDays = selectedDays.filter(d => d !== day);
      } else {
        btn.classList.add("selected");
        selectedDays.push(day);
      }
      selectedDays.sort();
    });
  });
  
  // Add rule
  const addRuleBtn = document.getElementById("add-rule-btn");
  if (addRuleBtn) {
    addRuleBtn.addEventListener("click", async () => {
      const { gc_backend_url, gc_api_token } = await chrome.storage.local.get([
        "gc_backend_url",
        "gc_api_token"
      ]);
      
      if (!gc_backend_url) {
        showStatus("add-rule-status", "Configure backend settings first", "error");
        return;
      }
      
      const ruleType = document.getElementById("rule-type")?.value;
      let pattern;
      
      if (ruleType === "time_window") {
        const startHour = parseInt(document.getElementById("start-hour")?.value || "0");
        const endHour = parseInt(document.getElementById("end-hour")?.value || "0");
        
        if (isNaN(startHour) || isNaN(endHour) || startHour < 0 || startHour > 23 || endHour < 0 || endHour > 23) {
          showStatus("add-rule-status", "Invalid hour values (must be 0-23)", "error");
          return;
        }
        
        if (selectedDays.length === 0) {
          showStatus("add-rule-status", "Select at least one day", "error");
          return;
        }
        
        pattern = JSON.stringify({
          start_hour: startHour,
          end_hour: endHour,
          days: selectedDays
        });
      } else {
        pattern = document.getElementById("rule-pattern")?.value.trim();
        if (!pattern) {
          showStatus("add-rule-status", "Domain pattern is required", "error");
          return;
        }
        // Remove common prefixes
        pattern = pattern.replace(/^(https?:\/\/)?(www\.)?/, "");
      }
      
      const category = document.getElementById("rule-category")?.value.trim();
      const explanation = document.getElementById("rule-explanation")?.value.trim();
      
      if (!explanation) {
        showStatus("add-rule-status", "Please provide an explanation for this rule", "error");
        return;
      }
      
      const rule = {
        rule_type: ruleType,
        pattern: pattern,
        category: category || null,
        explanation: explanation,
        enabled: true
      };
      
      try {
  const response = await fetch(`${gc_backend_url.replace(/\/+$/, "")}/rules`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${gc_api_token}`
          },
          body: JSON.stringify(rule)
        });
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.detail || "Failed to create rule");
        }
        
        showStatus("add-rule-status", "Rule created successfully!", "success");
        
        // Clear form
        const patternEl = document.getElementById("rule-pattern");
        const categoryEl = document.getElementById("rule-category");
        const explanationEl = document.getElementById("rule-explanation");
        if (patternEl) patternEl.value = "";
        if (categoryEl) categoryEl.value = "";
        if (explanationEl) explanationEl.value = "";
        
        // Refresh rules list
        loadRules();
        
        // Notify background to refresh
        chrome.runtime.sendMessage({ type: "REFRESH_RULES" });
      } catch (e) {
        showStatus("add-rule-status", `Error: ${e.message}`, "error");
      }
    });
  }
  
  // Refresh rules button
  const refreshRulesBtn = document.getElementById("refresh-rules-btn");
  if (refreshRulesBtn) {
    refreshRulesBtn.addEventListener("click", () => {
      loadRules();
      chrome.runtime.sendMessage({ type: "REFRESH_RULES" });
    });
  }

  // Event delegation for rule action buttons (toggle/delete)
  const rulesListEl = document.getElementById("rules-list");
  if (rulesListEl) {
    rulesListEl.addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (target.classList.contains("rule-toggle-btn")) {
        const ruleId = parseInt(target.getAttribute("data-rule-id") || "0", 10);
        const nextEnabled = target.getAttribute("data-next-enabled") === "true";
        if (ruleId) window.toggleRule(ruleId, nextEnabled);
      } else if (target.classList.contains("rule-delete-btn")) {
        const ruleId = parseInt(target.getAttribute("data-rule-id") || "0", 10);
        if (ruleId) window.deleteRule(ruleId);
      }
    });
  }
});
