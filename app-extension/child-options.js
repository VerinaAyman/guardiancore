// GuardianCore Child Options - Phase 5: Limited Child Interface
console.log("[Child Options] Script starting v0.5.0...");

// Current user state
let currentUser = null;
let childProfile = null;

// Backend URL
let backendUrl = 'https://guardiancore.onrender.com';

// ========== AUTHENTICATION ==========

async function checkAuth() {
  try {
    const storage = await chrome.storage.local.get([
      'gc_auth_token', 'gc_user_id', 'gc_account_type', 'gc_username', 'gc_email', 'gc_backend_url', 'gc_api_token', 'gc_config_initialized'
    ]);
    
    // Auto-configure defaults if not initialized
    if (!storage.gc_config_initialized) {
      const defaults = {};
      
      if (!storage.gc_backend_url) {
        defaults.gc_backend_url = 'https://guardiancore.onrender.com';
        storage.gc_backend_url = 'https://guardiancore.onrender.com';
      }
      
      if (!storage.gc_api_token) {
        defaults.gc_api_token = 'dev-token-123';
      }
      
      defaults.gc_config_initialized = true;
      await chrome.storage.local.set(defaults);
      console.log("[Child Options] Auto-configured defaults");
    }
    
    if (storage.gc_backend_url) backendUrl = storage.gc_backend_url;
    
    if (!storage.gc_auth_token) {
      redirectToLogin();
      return false;
    }
    
    // Verify token
    const response = await fetch(`${backendUrl}/auth/verify`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${storage.gc_auth_token}` }
    });
    
    if (!response.ok) {
      redirectToLogin();
      return false;
    }
    
    const data = await response.json();
    
    // Check if NOT child account - redirect to parent options
    if (data.account_type !== 'child') {
      window.location.href = 'options.html';
      return false;
    }
    
    // Child account - continue
    currentUser = {
      user_id: storage.gc_user_id,
      username: storage.gc_username,
      email: storage.gc_email,
      account_type: storage.gc_account_type,
      token: storage.gc_auth_token
    };
    
    updateUserDisplay();
    return true;
  } catch (error) {
    console.error("[Auth] Check failed:", error);
    redirectToLogin();
    return false;
  }
}

function redirectToLogin() {
  chrome.tabs.create({ url: chrome.runtime.getURL('login.html') });
  window.close();
}

function updateUserDisplay() {
  const userNameEl = document.getElementById('user-name');
  const userAvatarEl = document.getElementById('user-avatar');
  
  if (userNameEl && currentUser) {
    userNameEl.textContent = currentUser.username;
  }
  
  if (userAvatarEl && currentUser) {
    userAvatarEl.textContent = currentUser.username.charAt(0).toUpperCase();
  }
}

async function handleLogout() {
  try {
    await chrome.storage.local.remove([
      'gc_auth_token', 'gc_user_id', 'gc_account_type', 'gc_username', 'gc_email'
    ]);
    chrome.runtime.sendMessage({ type: "LOGOUT" });
    redirectToLogin();
  } catch (error) {
    console.error("[Logout] Failed:", error);
  }
}

// ========== PROFILE MANAGEMENT ==========

async function loadProfile() {
  try {
    // Load child profile from backend
    const response = await fetch(`${backendUrl}/accounts/profile`, {
      headers: { 'Authorization': `Bearer ${currentUser.token}` }
    });
    
    if (!response.ok) throw new Error('Failed to load profile');
    
    childProfile = await response.json();
    displayProfile();
    
    // Check tracking status and show notice if enabled
    await checkTrackingStatus();
  } catch (error) {
    console.error("[Profile] Load failed:", error);
  }
}

function displayProfile() {
  const usernameEl = document.getElementById('profile-username');
  const codeEl = document.getElementById('profile-code');
  const parentEl = document.getElementById('profile-parent');
  
  if (usernameEl && childProfile) {
    usernameEl.textContent = childProfile.username;
  }
  
  if (codeEl && childProfile) {
    codeEl.textContent = childProfile.access_code || '------';
  }
  
  if (parentEl && childProfile) {
    parentEl.textContent = childProfile.parent_username || 'Unknown';
  }
}

// ========== ACTIVITY TRACKING ==========

async function checkTrackingStatus() {
  try {
    const response = await fetch(`${backendUrl}/activity/status`, {
      headers: { 'Authorization': `Bearer ${currentUser.token}` }
    });
    
    if (!response.ok) {
      console.warn("[Tracking] Failed to check status");
      return;
    }
    
    const data = await response.json();
    
    // Show/hide tracking notice based on status
    const noticeEl = document.getElementById('tracking-notice');
    if (noticeEl && data.tracking_enabled) {
      noticeEl.style.display = 'block';
      console.log("[Tracking] Notice displayed to child");
    }
  } catch (error) {
    console.error("[Tracking] Status check failed:", error);
  }
}

// ========== XP/LEVEL SYSTEM ==========

async function loadXPState() {
  try {
    const storageKey = `gc_xp_${currentUser.user_id}`;
    const storage = await chrome.storage.local.get([storageKey]);
    
    const xpState = storage[storageKey] || { level: 1, xp: 0 };
    displayXPState(xpState);
  } catch (error) {
    console.error("[XP] Load failed:", error);
  }
}

function displayXPState(xpState) {
  const levelEl = document.getElementById('xp-level');
  const currentEl = document.getElementById('xp-current');
  const neededEl = document.getElementById('xp-needed');
  const barEl = document.getElementById('xp-bar');
  
  const xpNeeded = 100 * xpState.level;
  const progress = (xpState.xp / xpNeeded) * 100;
  const widthPercent = Math.min(progress, 100);
  
  console.log("[XP] Displaying state:", { level: xpState.level, xp: xpState.xp, xpNeeded, progress, widthPercent });
  
  if (levelEl) levelEl.textContent = xpState.level;
  if (currentEl) currentEl.textContent = xpState.xp;
  if (neededEl) neededEl.textContent = xpNeeded;
  if (barEl) {
    // Force set width and ensure it sticks
    barEl.style.width = `${widthPercent}%`;
    // Set attribute as well for CSS fallback
    barEl.setAttribute('data-width', widthPercent);
    console.log("[XP] Bar width set to:", barEl.style.width);
  }
}

// ========== STATS MANAGEMENT ==========

async function loadStats() {
  try {
    const response = await fetch(`${backendUrl}/audit/stats`, {
      headers: { 'Authorization': `Bearer ${currentUser.token}` }
    });
    
    if (!response.ok) {
      console.warn("[Stats] Failed to load stats:", response.status);
      displayStats({ 
        total_audits: 0, 
        unique_origins: 0, 
        avg_trackers: 0,
        csp_coverage: 0,
        cors_coverage: 0
      });
      return;
    }
    
    const stats = await response.json();
    displayStats(stats);
  } catch (error) {
    console.error("[Stats] Load failed:", error);
    // Show default stats if load fails
    displayStats({ 
      total_audits: 0, 
      unique_origins: 0, 
      avg_trackers: 0,
      csp_coverage: 0,
      cors_coverage: 0
    });
  }
}

function displayStats(stats) {
  const totalAuditsEl = document.getElementById('stat-total-audits');
  const uniqueOriginsEl = document.getElementById('stat-unique-origins');
  const avgTrackersEl = document.getElementById('stat-avg-trackers');
  const cspCoverageEl = document.getElementById('stat-csp-coverage');
  const corsCoverageEl = document.getElementById('stat-cors-coverage');
  
  if (totalAuditsEl) {
    totalAuditsEl.textContent = stats.total_audits || 0;
  }
  
  if (uniqueOriginsEl) {
    uniqueOriginsEl.textContent = stats.unique_origins || 0;
  }
  
  if (avgTrackersEl) {
    avgTrackersEl.textContent = (stats.avg_trackers || 0).toFixed(2);
  }
  
  if (cspCoverageEl) {
    cspCoverageEl.textContent = `${Math.round((stats.csp_coverage || 0) * 100)}%`;
  }
  
  if (corsCoverageEl) {
    corsCoverageEl.textContent = `${Math.round((stats.cors_coverage || 0) * 100)}%`;
  }
}

// ========== TAB MANAGEMENT ==========

function setupTabs() {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab;
      
      // Update active tab
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // Update active content
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      const content = document.getElementById(`${targetTab}-tab`);
      if (content) content.classList.add('active');
      
      // Load tab data
      loadTabData(targetTab);
    });
  });
}

function loadTabData(tabName) {
  switch(tabName) {
    case 'profile':
      loadProfile();
      break;
    case 'stats':
      loadXPState();
      loadStats();
      break;
    case 'about':
      // Static content, no loading needed
      break;
  }
}

// ========== INITIALIZATION ==========

document.addEventListener('DOMContentLoaded', async () => {
  console.log("[Child Options] DOM loaded");
  
  const isAuthenticated = await checkAuth();
  if (!isAuthenticated) return;
  
  setupTabs();
  
  // Setup logout button
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', handleLogout);
  }
  
  // Load initial data
  loadProfile();
  loadXPState();
  loadStats();
  
  console.log("[Child Options] Initialization complete");
});
