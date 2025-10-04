// GuardianCore Options Page - Parent Settings with Hardened PIN & Recovery Codes
// Week 4: PBKDF2 PIN storage, 10 recovery codes, factory reset

// Import crypto utilities
import * as crypto from './crypto.js';

console.log("[Options] Script starting v0.4.4...");
console.log("[Options] Crypto module loaded:", crypto);

let isUnlocked = false;
let selectedDays = [0, 1, 2, 3, 4, 5, 6]; // All days by default

// PIN verification using PBKDF2
async function checkStoredPIN() {
  const { pin } = await chrome.storage.local.get("pin");
  return pin || null;
}

async function verifyPIN(inputPIN) {
  const storedPin = await checkStoredPIN();
  
  if (!storedPin) {
    // No PIN set yet - first time setup
    return { firstTime: true };
  }
  
  const isValid = await crypto.verifyPin(inputPIN, storedPin);
  return { valid: isValid, firstTime: false };
}

// Show/hide main content
function showMainContent() {
  document.getElementById("lock-screen").classList.add("hidden");
  document.getElementById("main-content").classList.remove("hidden");
  isUnlocked = true;
  
  // Setup button handlers AFTER unlocking
  setupButtonHandlers();
  
  loadSettings();
  loadRules();
  loadRecoveryStatus();
}

function showStatus(elementId, message, type) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = message;
  el.className = `status status-${type}`;
  el.classList.remove("hidden");
  
  if (type === "success") {
    setTimeout(() => el.classList.add("hidden"), 5000);
  }
}

// Initialize on load
document.addEventListener("DOMContentLoaded", async () => {
  console.log("[Options] DOM loaded");
  
  // Tab navigation
  setupTabs();
  
  // Check if PIN exists
  const storedPin = await checkStoredPIN();
  
  if (!storedPin) {
    // First time - show PIN creation
    showPINCreation();
  } else {
    // Show PIN entry
    showPINEntry();
  }
});

function setupTabs() {
  const tabs = document.querySelectorAll(".tab-btn");
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const targetTab = tab.dataset.tab;
      
      // Update active tab button with CSS
      document.querySelectorAll(".tab-btn").forEach(t => {
        t.classList.remove("active");
        t.style.borderBottom = "2px solid transparent";
        t.style.color = "var(--gc-text-dim)";
      });
      tab.classList.add("active");
      tab.style.borderBottom = "2px solid var(--gc-accent)";
      tab.style.color = "var(--gc-accent)";
      
      // Update active tab content
      document.querySelectorAll(".tab-content").forEach(c => c.style.display = "none");
      const content = document.getElementById(`${targetTab}-tab`);
      if (content) content.style.display = "block";

      // Refresh recovery status each time user opens that tab (after unlock)
      if (isUnlocked && targetTab === 'recovery') {
        loadRecoveryStatus();
      }
    });
  });
}

function showPINCreation() {
  document.getElementById("lock-screen").classList.remove("hidden");
  document.getElementById("main-content").classList.add("hidden");
  document.getElementById("pin-hint").textContent = "Create your parent PIN to secure these settings";
  
  const unlockBtn = document.getElementById("unlock-btn");
  unlockBtn.textContent = "Create PIN";
  
  unlockBtn.onclick = async () => {
    const pin = document.getElementById("pin-input").value;
    
    if (!pin || pin.length < 4) {
      document.getElementById("pin-error").textContent = "PIN must be at least 4 digits";
      document.getElementById("pin-error").classList.remove("hidden");
      return;
    }
    
    const confirmPin = prompt("Confirm your PIN:");
    if (pin !== confirmPin) {
      document.getElementById("pin-error").textContent = "PINs don't match";
      document.getElementById("pin-error").classList.remove("hidden");
      return;
    }
    
    // Hash PIN with PBKDF2
    const hashedPin = await crypto.hashPin(pin);
    await chrome.storage.local.set({ pin: hashedPin });
    
    // Generate recovery codes
    const batch = await crypto.createRecoveryBatch();
    
    // Show codes to user (ONLY TIME)
    const codes = batch.codes.map(c => c.plaintext).join("\n");
    alert(`⚠️ SAVE THESE RECOVERY CODES NOW!\n\nThey will only be shown once:\n\n${codes}\n\nStore them securely offline.`);
    
    // Remove plaintext from storage immediately
    batch.codes.forEach(c => delete c.plaintext);
    await chrome.storage.local.set({ recovery_batches: [batch] });
    
    showMainContent();
  };
  
  // Forgot PIN button
  document.getElementById("forgot-pin-btn").onclick = forgotPIN;
}

function showPINEntry() {
  document.getElementById("lock-screen").classList.remove("hidden");
  document.getElementById("main-content").classList.add("hidden");
  document.getElementById("pin-hint").textContent = "";
  
  const unlockBtn = document.getElementById("unlock-btn");
  unlockBtn.textContent = "Unlock";
  
  unlockBtn.onclick = async () => {
    const pin = document.getElementById("pin-input").value;
    const result = await verifyPIN(pin);
    
    if (result.valid) {
      showMainContent();
    } else {
      document.getElementById("pin-error").textContent = "Incorrect PIN";
      document.getElementById("pin-error").classList.remove("hidden");
    }
  };
  
  // Forgot PIN button
  document.getElementById("forgot-pin-btn").onclick = forgotPIN;
}

async function forgotPIN() {
  const code = prompt("🔑 Enter recovery code (format: XXXX-XXXX-XXXX):");
  if (!code) return;
  
  // Validate format
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) {
    alert("❌ Invalid format. Use: XXXX-XXXX-XXXX");
    return;
  }
  
  const { recovery_batches = [] } = await chrome.storage.local.get("recovery_batches");
  
  let verified = false;
  let batchToUpdate = null;
  
  for (const batch of recovery_batches) {
    if (!batch.active) continue;
    
    for (const recoveryCode of batch.codes) {
      if (recoveryCode.used) continue;
      
      const isValid = await crypto.verifyRecoveryCode(code, recoveryCode.hash, recoveryCode.salt);
      if (isValid) {
        verified = true;
        recoveryCode.used = true;
        recoveryCode.used_at = new Date().toISOString();
        batchToUpdate = batch;
        break;
      }
    }
    if (verified) break;
  }
  
  if (!verified) {
    alert("❌ Invalid or already used recovery code");
    return;
  }
  
  // Save updated batch
  await chrome.storage.local.set({ recovery_batches });
  
  alert("✅ Recovery code verified!");
  
  // Reset PIN
  const newPin = prompt("Enter your new PIN (at least 4 digits):");
  if (!newPin || newPin.length < 4) {
    alert("❌ PIN must be at least 4 digits");
    return;
  }
  
  const confirmPin = prompt("Confirm your new PIN:");
  if (newPin !== confirmPin) {
    alert("❌ PINs don't match");
    return;
  }
  
  await crypto.storePin(newPin);
  alert("✅ PIN reset successfully! New PIN stored.");
  
  // Auto-unlock
  showMainContent();
}

function setupButtonHandlers() {
  // Save settings
  document.getElementById("save-backend-btn")?.addEventListener("click", saveSettings);
  
  // Add rule
  document.getElementById("add-rule-btn")?.addEventListener("click", addRule);
  
  // Change PIN
  document.getElementById("change-pin-btn")?.addEventListener("click", changePIN);
  // Fast mode toggle
  const fastToggle = document.getElementById("fast-mode-toggle");
  if (fastToggle) {
    chrome.storage.local.get(["gc_fast_mode"]).then(({ gc_fast_mode }) => {
      fastToggle.checked = !!gc_fast_mode;
    });
    fastToggle.addEventListener("change", () => {
      chrome.storage.local.set({ gc_fast_mode: fastToggle.checked }).then(() => {
        showStatus("options-status", fastToggle.checked ? "Fast mode enabled" : "Fast mode disabled", "info");
        // Notify background to pick up change immediately
        chrome.runtime.sendMessage({ type: "DEV_TOGGLE_FAST_MODE" });
      });
    });
  }
  
  // Regenerate recovery codes
  document.getElementById("regenerate-codes-btn")?.addEventListener("click", regenerateRecoveryCodes);
  
  // Export rules
  document.getElementById("export-rules-btn")?.addEventListener("click", exportRules);
  
  // Import rules
  document.getElementById("import-rules-btn")?.addEventListener("click", () => {
    document.getElementById("import-file-input").click();
  });
  
  document.getElementById("import-file-input")?.addEventListener("change", importRules);
  
  // Factory reset
  document.getElementById("factory-reset-btn")?.addEventListener("click", factoryReset);
}

async function saveSettings() {
  const backendUrl = document.getElementById("backend-url").value.trim();
  const apiToken = document.getElementById("api-token").value.trim();
  
  await chrome.storage.local.set({
    gc_backend_url: backendUrl,
    gc_api_token: apiToken
  });
  
  showStatus("backend-status", "✅ Settings saved successfully", "success");
}

async function loadSettings() {
  const { gc_backend_url, gc_api_token } = await chrome.storage.local.get([
    "gc_backend_url",
    "gc_api_token"
  ]);
  
  if (gc_backend_url) document.getElementById("backend-url").value = gc_backend_url;
  if (gc_api_token) document.getElementById("api-token").value = gc_api_token;
}

async function loadRules() {
  const { gc_backend_url, gc_api_token } = await chrome.storage.local.get([
    "gc_backend_url",
    "gc_api_token"
  ]);
  
  const rulesList = document.getElementById("rules-list");
  
  if (!gc_backend_url) {
    rulesList.innerHTML = '<div class="empty-state">Configure backend first</div>';
    return;
  }
  
  try {
    // Fetch ALL rules so that disabling doesn't make them disappear (user thought it was deleting)
    const response = await fetch(`${gc_backend_url.replace(/\/+$/, "")}/rules/?enabled_only=false`, {
      headers: {
        "Authorization": `Bearer ${gc_api_token}`
      }
    });
    
    if (!response.ok) {
      rulesList.innerHTML = '<div class="empty-state">Failed to load rules</div>';
      return;
    }
    
    const rules = await response.json();
    
    if (rules.length === 0) {
      rulesList.innerHTML = '<div class="empty-state">No rules yet. Add one above!</div>';
      return;
    }
    
    const html = rules.map(rule => {
      const badgeClass = `badge-${rule.rule_type}`;
      const enabledBadge = rule.enabled ? 
        '<span class="badge badge-enabled">Enabled</span>' : 
        '<span class="badge badge-disabled">Disabled</span>';
      
      const pattern = rule.rule_type === "time_window" ? 
        formatTimeWindow(rule.pattern) : 
        rule.pattern;
      
      return `
        <div class="rule-card" data-rule-id="${rule.id}">
          <div class="rule-header">
            <div class="rule-info">
              <h4>${pattern}</h4>
              <div class="rule-meta">
                <span class="badge ${badgeClass}">${rule.rule_type}</span>
                ${enabledBadge}
                ${rule.category ? `<span class=\"badge\">${rule.category}</span>` : ''}
              </div>
            </div>
            <div class="rule-actions">
              <button class="secondary rule-toggle-btn" data-rule-id="${rule.id}" data-new-enabled="${!rule.enabled}">
                ${rule.enabled ? 'Disable' : 'Enable'}
              </button>
              <button class="danger rule-delete-btn" data-rule-id="${rule.id}">Delete</button>
            </div>
          </div>
          ${rule.explanation ? `<p style=\"margin-top:8px;color:var(--gc-text-dim);font-size:13px;\">${rule.explanation}</p>` : ''}
        </div>
      `;
    }).join("");
    
    rulesList.innerHTML = html;
    attachRuleActionHandlers();
  } catch (e) {
    console.error("Failed to load rules:", e);
    rulesList.innerHTML = '<div class="empty-state">Error loading rules</div>';
  }
}

function attachRuleActionHandlers() {
  // Toggle buttons
  document.querySelectorAll('.rule-toggle-btn').forEach(btn => {
    btn.addEventListener('click', async (ev) => {
      const id = parseInt(btn.dataset.ruleId, 10);
      const newEnabled = btn.dataset.newEnabled === 'true';
      btn.disabled = true;
      btn.textContent = '...';
      try {
        await toggleRule(id, newEnabled);
      } finally {
        // Reload list will redraw buttons; no need to restore text here
      }
    });
  });
  // Delete buttons
  document.querySelectorAll('.rule-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.dataset.ruleId, 10);
      if (!confirm('Delete this rule?')) return;
      btn.disabled = true;
      btn.textContent = '...';
      try {
        await deleteRule(id);
      } finally {
        // UI refreshed by loadRules inside deleteRule
      }
    });
  });
}

function formatTimeWindow(pattern) {
  try {
    const config = JSON.parse(pattern);
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const days = config.days || [];
    const daysStr = days.length === 7 ? "Every day" : days.map(d => dayNames[d]).join(", ");
    return `${config.start_hour}:00-${config.end_hour}:00 (${daysStr})`;
  } catch {
    return pattern;
  }
}

async function addRule() {
  const ruleType = document.getElementById("rule-type").value;
  const pattern = document.getElementById("rule-pattern").value.trim();
  
  if (!pattern) {
    showStatus("add-rule-status", "Pattern is required", "error");
    return;
  }
  
  const { gc_backend_url, gc_api_token } = await chrome.storage.local.get([
    "gc_backend_url",
    "gc_api_token"
  ]);
  
  if (!gc_backend_url) {
    showStatus("add-rule-status", "Configure backend first", "error");
    return;
  }
  
  try {
    const response = await fetch(`${gc_backend_url.replace(/\/+$/, "")}/rules/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${gc_api_token}`
      },
      body: JSON.stringify({
        rule_type: ruleType,
        pattern: pattern,
  explanation: null,
        enabled: true
      })
    });
    
    if (!response.ok) throw new Error("Failed to create rule");
    
    showStatus("add-rule-status", "✅ Rule created successfully", "success");
    document.getElementById("rule-pattern").value = "";
  // Explanation field removed
    loadRules();
  } catch (e) {
    console.error("Failed to add rule:", e);
    showStatus("add-rule-status", "❌ Failed to create rule: " + e.message, "error");
  }
}

async function toggleRule(ruleId, enable) {
  const { gc_backend_url, gc_api_token } = await chrome.storage.local.get([
    "gc_backend_url",
    "gc_api_token"
  ]);
  
  try {
  const response = await fetch(`${gc_backend_url.replace(/\/+$/, "")}/rules/${ruleId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${gc_api_token}`
      },
      body: JSON.stringify({ enabled: enable })
    });
    
    if (!response.ok) throw new Error("Failed to toggle rule");
    
    loadRules();
    chrome.runtime.sendMessage({ type: "REFRESH_RULES" });
  } catch (e) {
    console.error("Failed to toggle rule:", e);
    alert("Failed to toggle rule");
  }
}

async function deleteRule(ruleId) {
  const { gc_backend_url, gc_api_token } = await chrome.storage.local.get([
    "gc_backend_url",
    "gc_api_token"
  ]);
  
  try {
  const response = await fetch(`${gc_backend_url.replace(/\/+$/, "")}/rules/${ruleId}`, {
      method: "DELETE",
      headers: {
        "Authorization": `Bearer ${gc_api_token}`
      }
    });
    
    if (!response.ok) throw new Error("Failed to delete rule");
    
    loadRules();
    chrome.runtime.sendMessage({ type: "REFRESH_RULES" });
  } catch (e) {
    console.error("Failed to delete rule:", e);
    alert("Failed to delete rule");
  }
}

// Make functions global
window.toggleRule = toggleRule;
window.deleteRule = deleteRule;

async function changePIN() {
  const currentPin = prompt("Enter your current PIN:");
  if (!currentPin) return;
  
  const result = await verifyPIN(currentPin);
  if (!result.valid) {
    alert("Incorrect PIN");
    return;
  }
  
  const newPin = prompt("Enter your new PIN (at least 4 digits):");
  if (!newPin || newPin.length < 4) {
    alert("PIN must be at least 4 digits");
    return;
  }
  
  const confirmPin = prompt("Confirm your new PIN:");
  if (newPin !== confirmPin) {
    alert("PINs don't match");
    return;
  }
  await crypto.storePin(newPin);
  alert("✅ PIN changed successfully! New PIN is active.");
}

async function loadRecoveryStatus() {
  const { recovery_batches = [] } = await chrome.storage.local.get("recovery_batches");
  const statusDiv = document.getElementById("recovery-status");
  
  if (recovery_batches.length === 0) {
    statusDiv.innerHTML = '<div class="empty-state">No recovery codes generated</div>';
    return;
  }
  
  const activeBatch = recovery_batches.find(b => b.active);
  if (!activeBatch) {
    statusDiv.innerHTML = '<div class="empty-state">No active recovery codes</div>';
    return;
  }
  
  const usedCount = activeBatch.codes.filter(c => c.used).length;
  const unusedCount = activeBatch.codes.length - usedCount;

  // Build table of codes (masked except last 4). Plaintext not stored after generation.
  const rows = activeBatch.codes.map((c, idx) => {
    const masked = `****-****-${c.hash.slice(-4)}`; // show last 4 of hash as identifier
    const status = c.used ? 'Used' : 'Unused';
    const statusColor = c.used ? 'var(--gc-warn)' : 'var(--gc-success)';
    const usedAt = c.used_at ? new Date(c.used_at).toLocaleString() : '';
    return `<tr>
      <td style="padding:6px 8px;font-family:monospace;font-size:12px;">${idx+1}</td>
      <td style="padding:6px 8px;font-family:monospace;font-size:12px;">${masked}</td>
      <td style="padding:6px 8px;color:${statusColor};font-size:12px;">${status}</td>
      <td style="padding:6px 8px;font-size:12px;color:var(--gc-text-dim);">${usedAt}</td>
    </tr>`;
  }).join("");

  statusDiv.innerHTML = `
    <div class="panel">
      <p style="margin-bottom:8px;"><strong>Batch:</strong> ${activeBatch.id.substring(0, 8)}… <strong>Created:</strong> ${new Date(activeBatch.created_at).toLocaleString()}</p>
      <p style="margin-bottom:12px;">
        <strong>Usage:</strong> ${unusedCount} unused / ${usedCount} used (total ${activeBatch.codes.length})
      </p>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr style="text-align:left;background:#0f1a27;">
              <th style="padding:6px 8px;font-weight:600;">#</th>
              <th style="padding:6px 8px;font-weight:600;">Identifier</th>
              <th style="padding:6px 8px;font-weight:600;">Status</th>
              <th style="padding:6px 8px;font-weight:600;">Used At</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
      <p style="margin-top:10px;font-size:11px;color:var(--gc-text-dim);">Original plaintext codes are only visible at generation time. Masked identifiers let you audit usage without exposing secrets.</p>
    </div>
  `;
}

async function regenerateRecoveryCodes() {
  const pin = prompt("⚠️ This will invalidate ALL existing recovery codes.\n\nEnter your PIN to confirm:");
  if (!pin) return;
  
  const result = await verifyPIN(pin);
  if (!result.valid) {
    alert("❌ Incorrect PIN. Cannot regenerate codes.");
    return;
  }
  
  if (!confirm("Are you sure? All existing recovery codes will stop working.")) return;
  
  // Generate new batch (this marks old batches inactive internally)
  const newBatch = await crypto.createRecoveryBatch();
  
  // Show codes (only time)
  const codes = newBatch.codes.map(c => c.plaintext).join("\n");
  
  // Remove plaintext from storage immediately after extraction
  newBatch.codes.forEach(c => delete c.plaintext);
  const { recovery_batches = [] } = await chrome.storage.local.get("recovery_batches");
  await chrome.storage.local.set({ recovery_batches });
  const codesText = `GuardianCore Recovery Codes
Generated: ${new Date().toISOString()}
Batch ID: ${newBatch.batch_id}

SAVE THESE CODES SECURELY!
Each code can only be used once.

${codes}

---
Store this file offline in a secure location.
`;
  
  // Download as file
  const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const filename = `guardian_recovery_codes_${date}_${newBatch.batch_id.substring(0, 8)}.txt`;
  
  const blob = new Blob([codesText], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  
  chrome.downloads.download({
    url: url,
    filename: filename,
    saveAs: true
  }, () => {
    URL.revokeObjectURL(url);
    alert(`✅ Recovery codes generated and downloaded!\n\nFile: ${filename}\n\nKeep this file safe and offline.`);
    loadRecoveryStatus();
  });
}

async function exportRules() {
  const { gc_backend_url, gc_api_token } = await chrome.storage.local.get([
    "gc_backend_url",
    "gc_api_token"
  ]);
  
  if (!gc_backend_url) {
    alert("Configure backend first");
    return;
  }
  
  try {
  const response = await fetch(`${gc_backend_url.replace(/\/+$/, "")}/rules/all/export`, {
      headers: {
        "Authorization": `Bearer ${gc_api_token}`
      }
    });
    
    if (!response.ok) throw new Error("Failed to export");
    
    const data = await response.json();
    const json = JSON.stringify(data, null, 2);
    
    const date = new Date().toISOString().split('T')[0];
    const filename = `guardiancore_rules_${date}.json`;
    
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: true
    }, () => {
      URL.revokeObjectURL(url);
      showStatus("export-status", "✅ Rules exported successfully", "success");
    });
  } catch (e) {
    console.error("Export failed:", e);
    showStatus("export-status", "❌ Export failed: " + e.message, "error");
  }
}

async function importRules(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = JSON.parse(e.target.result);
      
      const { gc_backend_url, gc_api_token } = await chrome.storage.local.get([
        "gc_backend_url",
        "gc_api_token"
      ]);
      
      if (!gc_backend_url) {
        alert("Configure backend first");
        return;
      }
      
      const response = await fetch(`${gc_backend_url.replace(/\/+$/, "")}/rules/all/import`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${gc_api_token}`
        },
        body: JSON.stringify(data)
      });
      
      if (!response.ok) throw new Error("Import failed");
      
      const result = await response.json();
      showStatus("import-status", `✅ Imported ${result.imported_count} rules`, "success");
      loadRules();
    } catch (e) {
      console.error("Import failed:", e);
      showStatus("import-status", "❌ Import failed: " + e.message, "error");
    }
  };
  reader.readAsText(file);
}

async function factoryReset() {
  const warning = "⚠️ This will erase:\n- Local rules cache\n- PIN\n- Recovery codes\n- All settings\n\nThis CANNOT be undone!";
  
  if (!confirm(warning)) return;
  
  if (!confirm("Are you ABSOLUTELY SURE? Type YES to confirm.") !== "YES") return;
  
  // Clear all storage
  await chrome.storage.local.clear();
  
  // Reload extension
  chrome.runtime.reload();
}
