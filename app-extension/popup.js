const backendEl = document.getElementById("backend");
const tokenEl = document.getElementById("token");
const statusEl = document.getElementById("status");
const saveBtn = document.getElementById("save");

// Load existing settings
chrome.storage.local.get(["gc_backend_url", "gc_api_token"], (result) => {
  if (result.gc_backend_url) backendEl.value = result.gc_backend_url;
  if (result.gc_api_token) tokenEl.value = result.gc_api_token;
});

// Save settings
saveBtn.addEventListener("click", async () => {
  const backendUrl = backendEl.value.trim();
  const apiToken = tokenEl.value.trim();
  
  if (!backendUrl) {
    showStatus("Backend URL is required", "error");
    return;
  }
  
  if (!apiToken) {
    showStatus("API Token is required", "error");
    return;
  }
  
  // Validate URL format
  try {
    new URL(backendUrl);
  } catch (e) {
    showStatus("Invalid URL format", "error");
    return;
  }
  
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";
  
  try {
    await chrome.storage.local.set({
      gc_backend_url: backendUrl,
      gc_api_token: apiToken
    });
    
    showStatus("Settings saved successfully!", "success");
    
    // Test connection
    try {
      const testUrl = `${backendUrl.replace(/\/+$/, "")}/health`;
      const response = await fetch(testUrl, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiToken}`
        }
      });
      
      if (response.ok) {
        showStatus("Settings saved and connection verified!", "success");
      } else {
        showStatus("Settings saved but connection test failed", "error");
      }
    } catch (e) {
      showStatus("Settings saved but connection test failed", "error");
    }
  } catch (e) {
    showStatus("Failed to save settings", "error");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save Settings";
  }
});

function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = `status-${type}`;
  
  if (type === "success") {
    setTimeout(() => {
      statusEl.textContent = "";
      statusEl.className = "";
    }, 3000);
  }
}
