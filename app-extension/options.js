// GuardianCore Options - Complete v0.5.3
console.log("[Options] Script starting v0.5.3...");

// Current user state
let currentUser = null;
let children = [];
let groups = [];
let pin = null;
let recoveryCodes = [];
let isPINVerified = false;

// Backend URL
let backendUrl = 'https://guardiancore.onrender.com';

// Pagination state
const ITEMS_PER_PAGE = 5;
let childrenCurrentPage = 1;
let childrenSearchQuery = '';
let groupsCurrentPage = 1;
let groupsSearchQuery = '';
let activityCurrentPage = 1;
let activitySearchQuery = '';
let activitySummaries = []; // Store all summaries for filtering/pagination
let activityChildrenCurrentPage = 1;
let activityChildrenSearchQuery = '';
let activityChildren = []; // Store children for activity selector
let rulesTargetsCurrentPage = 1;
let rulesTargetsSearchQuery = '';
let rulesTargetsFilter = 'all'; // 'all', 'child', 'group'
let rulesTargets = []; // Store all targets for filtering/pagination
let rulesListCurrentPage = 1;
let rulesListSearchQuery = '';
let currentRules = []; // Store current rules for filtering/pagination
let currentRuleTarget = { type: '', id: '', name: '' }; // Store current target info

// ========== AUTHENTICATION ==========

async function checkAuth() {
  try {
    const storage = await chrome.storage.local.get([
      'gc_auth_token', 'gc_user_id', 'gc_account_type', 'gc_username', 'gc_email', 'gc_backend_url', 'gc_pin', 'gc_recovery_codes', 'gc_api_token', 'gc_config_initialized'
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
      console.log("[Options] Auto-configured defaults");
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
    
    // Check if child account - redirect to child options
    if (data.account_type === 'child') {
      window.location.href = 'child-options.html';
      return false;
    }
    
    // Parent account - continue
    currentUser = {
      user_id: storage.gc_user_id,
      username: storage.gc_username,
      email: storage.gc_email,
      account_type: storage.gc_account_type,
      token: storage.gc_auth_token
    };
    
    pin = storage.gc_pin;
    recoveryCodes = storage.gc_recovery_codes || [];
    
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
    await chrome.runtime.sendMessage({ type: "LOGOUT" });
    redirectToLogin();
  } catch (error) {
    console.error("[Logout] Failed:", error);
  }
}

// ========== PIN SYSTEM ==========

async function verifyPINOnLoad() {
  // Check if PIN is set
  const storage = await chrome.storage.local.get(['gc_pin', 'gc_pin_verified']);
  
  if (!storage.gc_pin) {
    // No PIN set, show setup
    await showPINSetup();
    isPINVerified = true;
    return true;
  }
  
  // Check if already verified in this session
  if (storage.gc_pin_verified) {
    // Clear the verification flag (one-time use)
    await chrome.storage.local.remove('gc_pin_verified');
    isPINVerified = true;
    pin = storage.gc_pin;
    return true;
  }
  
  // Redirect to PIN lock page for verification
  window.location.href = 'pin-lock.html';
  return false;
}

async function showPINSetup() {
  const setupPIN = prompt('Set up a Parental Lock PIN (4-6 digits):');
  if (!setupPIN || setupPIN.length < 4 || !/^\d{4,6}$/.test(setupPIN)) {
    alert('PIN must be 4-6 digits. Please try again.');
    return showPINSetup();
  }
  
  const confirmPIN = prompt('Confirm your PIN:');
  if (setupPIN !== confirmPIN) {
    alert('PINs do not match. Please try again.');
    return showPINSetup();
  }
  
  try {
    // Set PIN via backend API
    const response = await fetch(`${backendUrl}/accounts/pin/set`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentUser.token}`
      },
      body: JSON.stringify({ pin: setupPIN })
    });
    
    if (!response.ok) throw new Error('Failed to set PIN');
    
    const data = await response.json();
    recoveryCodes = data.recovery_codes;
    
    // Store PIN and recovery codes locally for quick access
    await chrome.storage.local.set({
      gc_pin: setupPIN,
      gc_recovery_codes: recoveryCodes
    });
    
    pin = setupPIN;
    
    // Download recovery codes
    downloadRecoveryCodes(recoveryCodes, 'guardiancore-recovery-codes-initial.txt');
    
    alert(`PIN set successfully!\n\nYour 10 Recovery Codes have been downloaded.\n\nSave this file in a secure location!`);
  } catch (error) {
    console.error('[PIN] Setup failed:', error);
    alert('Failed to set PIN. Please try again.');
  }
}

function generateRecoveryCodes(count) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const code = Math.random().toString(36).substring(2, 10).toUpperCase();
    codes.push(code);
  }
  return codes;
}

function downloadRecoveryCodes(codes, filename) {
  const content = `GuardianCore Recovery Codes
Generated: ${new Date().toLocaleString()}

KEEP THESE CODES SECURE!
You can use any of these codes to reset your PIN if forgotten.

${codes.map((code, idx) => `${idx + 1}. ${code}`).join('\n')}

Each code can only be used once.
Store this file in a safe place.
`;
  
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function regenerateRecoveryCodes() {
  const enteredPIN = prompt('Enter your PIN to regenerate recovery codes:');
  if (enteredPIN !== pin) {
    alert('Incorrect PIN!');
    return;
  }
  
  try {
    // Regenerate codes via backend API
    const response = await fetch(`${backendUrl}/accounts/recovery-codes/regenerate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentUser.token}`
      }
    });
    
    if (!response.ok) throw new Error('Failed to regenerate recovery codes');
    
    const data = await response.json();
    const newCodes = data.recovery_codes;
    
    // Store new codes locally
    await chrome.storage.local.set({
      gc_recovery_codes: newCodes
    });
    
    recoveryCodes = newCodes;
    
    // Download new codes
    downloadRecoveryCodes(newCodes, `guardiancore-recovery-codes-${Date.now()}.txt`);
    
    alert('New Recovery Codes Generated!\n\nThe file has been downloaded.\n\nOld codes are now invalid. Save the new file!');
    
    displayRecoveryCodes();
  } catch (error) {
    console.error('[Recovery] Regenerate failed:', error);
    alert('Failed to regenerate recovery codes. Please try again.');
  }
}

async function displayRecoveryCodes() {
  try {
    // Always fetch recovery codes from backend (source of truth)
    const response = await fetch(`${backendUrl}/accounts/recovery-codes`, {
      headers: { 'Authorization': `Bearer ${currentUser.token}` }
    });
    
    if (response.ok) {
      const data = await response.json();
      recoveryCodes = data.recovery_codes || [];
      
      // Sync local storage with backend data (backend is source of truth)
      await chrome.storage.local.set({
        gc_recovery_codes: recoveryCodes
      });
      
      // Get PIN from local storage
      const storage = await chrome.storage.local.get(['gc_pin']);
      pin = storage.gc_pin || null;
    } else {
      // Fallback to local storage only if backend fails
      console.warn('[Recovery] Backend fetch failed, using local storage as fallback');
      const storage = await chrome.storage.local.get(['gc_recovery_codes', 'gc_pin']);
      recoveryCodes = storage.gc_recovery_codes || [];
      pin = storage.gc_pin || null;
    }
  } catch (error) {
    console.error('[Recovery] Load failed:', error);
    // Fallback to local storage on error
    const storage = await chrome.storage.local.get(['gc_recovery_codes', 'gc_pin']);
    recoveryCodes = storage.gc_recovery_codes || [];
    pin = storage.gc_pin || null;
  }
  
  const codesContainer = document.getElementById('recovery-codes-list');
  if (codesContainer) {
    if (recoveryCodes.length === 0 && !pin) {
      codesContainer.innerHTML = '<p style="color:var(--gc-text-dim);">No recovery codes available. PIN not set up yet.</p>';
    } else {
      const maskedPIN = pin ? '•'.repeat(pin.length) : 'Not set';
      codesContainer.innerHTML = `
        <div class="card">
          <h3 class="card-title">Current PIN</h3>
          <div class="code-display" style="font-size:18px; letter-spacing:6px;">${maskedPIN}</div>
          <p style="color:var(--gc-text-dim); margin-top:8px; font-size:13px;">Your parental lock PIN is active.</p>
        </div>
        
        <div class="card mt-20">
          <h3 class="card-title">Your Recovery Codes</h3>
          ${recoveryCodes.length === 0 ? 
            '<p style="color:var(--gc-text-dim);">No recovery codes available.</p>' :
            `<div class="code-display" style="font-size:14px; letter-spacing:2px; text-align:left; padding:20px;">
              ${recoveryCodes.map((code, idx) => `<div>${idx + 1}. ${code}</div>`).join('')}
            </div>`
          }
          <p style="color:var(--gc-text-dim); margin-top:12px; font-size:13px;">Save these codes in a secure location. You can use any of these codes to reset your PIN if forgotten.</p>
          <button class="btn mt-20" id="regenerate-codes-btn">Regenerate New Codes</button>
        </div>
      `;
      
      // Attach event listener to regenerate button
      const regenBtn = document.getElementById('regenerate-codes-btn');
      if (regenBtn) {
        regenBtn.addEventListener('click', regenerateRecoveryCodes);
      }
    }
  }
}

async function changePIN() {
  const enteredPIN = prompt('Enter your current PIN:');
  if (enteredPIN !== pin) {
    alert('Incorrect PIN!');
    return;
  }
  
  const newPIN = prompt('Enter new PIN (4-6 digits):');
  if (!newPIN || newPIN.length < 4 || !/^\d{4,6}$/.test(newPIN)) {
    alert('PIN must be 4-6 digits.');
    return;
  }
  
  const confirmNewPIN = prompt('Confirm new PIN:');
  if (newPIN !== confirmNewPIN) {
    alert('PINs do not match.');
    return;
  }
  
  try {
    // Change PIN via backend API
    const response = await fetch(`${backendUrl}/accounts/pin/change`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentUser.token}`
      },
      body: JSON.stringify({ 
        current_pin: enteredPIN,
        new_pin: newPIN 
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to change PIN');
    }
    
    // Update local storage
    await chrome.storage.local.set({ gc_pin: newPIN });
    pin = newPIN;
    
    alert('PIN changed successfully!');
    displayRecoveryCodes();
  } catch (error) {
    console.error('[PIN] Change failed:', error);
    alert(`Failed to change PIN: ${error.message}`);
  }
}

// ========== PROFILE MANAGEMENT ==========

async function loadProfile() {
  const usernameEl = document.getElementById('profile-username');
  const emailEl = document.getElementById('profile-email');
  
  if (usernameEl && currentUser) usernameEl.value = currentUser.username;
  if (emailEl && currentUser) emailEl.value = currentUser.email;
}

async function saveProfile() {
  const usernameEl = document.getElementById('profile-username');
  const statusEl = document.getElementById('profile-status');
  
  const newUsername = usernameEl.value.trim();
  
  if (!newUsername) {
    showStatus(statusEl, 'Username cannot be empty', 'error');
    return;
  }
  
  try {
    const response = await fetch(`${backendUrl}/accounts/profile`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentUser.token}`
      },
      body: JSON.stringify({ username: newUsername })
    });
    
    if (!response.ok) throw new Error('Failed to update profile');
    
    // Update storage
    await chrome.storage.local.set({ gc_username: newUsername });
    currentUser.username = newUsername;
    updateUserDisplay();
    
    showStatus(statusEl, 'Profile updated successfully', 'success');
  } catch (error) {
    console.error("[Profile] Save failed:", error);
    showStatus(statusEl, 'Failed to update profile', 'error');
  }
}

async function changePassword() {
  const currentPasswordEl = document.getElementById('current-password');
  const newPasswordEl = document.getElementById('new-password');
  const confirmPasswordEl = document.getElementById('confirm-password');
  const statusEl = document.getElementById('password-status');
  
  const currentPassword = currentPasswordEl.value.trim();
  const newPassword = newPasswordEl.value.trim();
  const confirmPassword = confirmPasswordEl.value.trim();
  
  if (!currentPassword || !newPassword || !confirmPassword) {
    showStatus(statusEl, 'All password fields are required', 'error');
    return;
  }
  
  if (newPassword !== confirmPassword) {
    showStatus(statusEl, 'New passwords do not match', 'error');
    return;
  }
  
  if (newPassword.length < 6) {
    showStatus(statusEl, 'New password must be at least 6 characters', 'error');
    return;
  }
  
  try {
    const response = await fetch(`${backendUrl}/accounts/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentUser.token}`
      },
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword
      })
    });
    
    if (!response.ok) {
      let msg = 'Failed to change password';
      let detail = '';
      try { detail = (await response.json()).detail; } catch (_) {}
      if (response.status === 401) msg = 'Current password incorrect';
      else if (response.status === 403) msg = 'Only parent accounts can change password';
      else if (response.status === 404) msg = 'Password change endpoint not found (backend mismatch)';
      throw new Error(detail || msg);
    }
    
    // Clear password fields
    currentPasswordEl.value = '';
    newPasswordEl.value = '';
    confirmPasswordEl.value = '';
    
    showStatus(statusEl, 'Password changed successfully', 'success');
  } catch (error) {
    console.error("[Profile] Change password failed:", error);
    showStatus(statusEl, error.message || 'Failed to change password', 'error');
  }
}

// ========== CHILDREN MANAGEMENT ==========

async function loadChildren() {
  try {
    const response = await fetch(`${backendUrl}/accounts/children`, {
      headers: { 'Authorization': `Bearer ${currentUser.token}` }
    });
    
    if (!response.ok) throw new Error('Failed to load children');
    
    children = await response.json();
    displayChildren();
  } catch (error) {
    console.error("[Children] Load failed:", error);
  }
}

function displayChildren() {
  const listEl = document.getElementById('children-list');
  const emptyEl = document.getElementById('children-empty');
  const paginationEl = document.getElementById('children-pagination');
  
  if (!listEl) return;
  
  // Filter children based on search query
  let filteredChildren = children;
  if (childrenSearchQuery) {
    filteredChildren = children.filter(child => 
      child.username.toLowerCase().includes(childrenSearchQuery.toLowerCase())
    );
  }
  
  if (filteredChildren.length === 0) {
    listEl.innerHTML = '';
    if (paginationEl) paginationEl.classList.add('hidden');
    if (emptyEl) {
      if (childrenSearchQuery) {
        emptyEl.innerHTML = `
          <div class="empty-icon">🔍</div>
          <p>No children found matching "${escapeHtml(childrenSearchQuery)}"</p>
        `;
      } else {
        emptyEl.innerHTML = `
          <div class="empty-icon">👶</div>
          <p>No children added yet</p>
          <button class="btn" id="add-first-child-btn">Add Your First Child</button>
        `;
      }
      emptyEl.classList.remove('hidden');
    }
    return;
  }
  
  if (emptyEl) emptyEl.classList.add('hidden');
  
  // Calculate pagination
  const totalPages = Math.ceil(filteredChildren.length / ITEMS_PER_PAGE);
  const startIndex = (childrenCurrentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedChildren = filteredChildren.slice(startIndex, endIndex);
  
  // Update pagination controls
  if (paginationEl && totalPages > 1) {
    paginationEl.classList.remove('hidden');
    const prevBtn = document.getElementById('children-prev-btn');
    const nextBtn = document.getElementById('children-next-btn');
    const pageInfo = document.getElementById('children-page-info');
    
    if (prevBtn) prevBtn.disabled = childrenCurrentPage === 1;
    if (nextBtn) nextBtn.disabled = childrenCurrentPage === totalPages;
    if (pageInfo) pageInfo.textContent = `Page ${childrenCurrentPage} of ${totalPages}`;
  } else if (paginationEl) {
    paginationEl.classList.add('hidden');
  }
  
  listEl.innerHTML = paginatedChildren.map(child => `
    <div class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">${escapeHtml(child.username)}</h3>
          <div style="margin-top:8px;">
            <span class="badge badge-child">Child Account</span>
          </div>
          <div style="margin-top:12px; font-size:13px; color:var(--gc-text-dim);">
            <strong>Access Code:</strong> <span class="code-display" style="font-size:18px; display:inline-block; margin-left:8px;">${child.access_code}</span>
          </div>
          <div style="margin-top:15px; padding-top:15px; border-top:1px solid var(--gc-border);">
            <div style="font-size:13px; color:var(--gc-text-dim); margin-bottom:8px;">
              <strong>Activity Tracking:</strong>
              <span id="tracking-status-${child.id}" style="margin-left:8px; color:#f59e0b;">Checking...</span>
            </div>
            <button class="btn btn-sm" id="toggle-tracking-${child.id}" data-child-id="${child.id}" style="font-size:12px;">
              Manage Tracking
            </button>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn btn-sm btn-danger" data-delete-child="${child.id}" data-child-name="${escapeHtml(child.username)}">
            Delete
          </button>
        </div>
      </div>
    </div>
  `).join('');
  
  // Attach delete handlers
  listEl.querySelectorAll('[data-delete-child]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const childId = e.target.dataset.deleteChild;
      const childName = e.target.dataset.childName;
      if (confirm(`Delete ${childName}? This will delete all their rules and stats.`)) {
        deleteChild(childId);
      }
    });
  });
  
  // Attach tracking toggle handlers
  listEl.querySelectorAll('[id^="toggle-tracking-"]').forEach(btn => {
    const childId = parseInt(btn.dataset.childId);
    btn.addEventListener('click', () => {
      // Switch to activity tab and select this child
      const activityTab = document.querySelector('[data-tab="activity"]');
      if (activityTab) activityTab.click();
      
      setTimeout(() => {
        const childSelect = document.getElementById('activity-child-select');
        if (childSelect) {
          childSelect.value = childId;
          childSelect.dispatchEvent(new Event('change'));
        }
      }, 100);
    });
  });
  
  // Load tracking status for each child
  children.forEach(child => {
    loadChildTrackingStatus(child.id);
  });
}

async function deleteChild(childId) {
  try {
    const response = await fetch(`${backendUrl}/accounts/children/${childId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${currentUser.token}` }
    });
    
    if (!response.ok) throw new Error('Failed to delete child');
    
    await loadChildren();
  } catch (error) {
    console.error("[Children] Delete failed:", error);
    alert('Failed to delete child account');
  }
}

async function loadChildTrackingStatus(childId) {
  try {
    const response = await fetch(`${backendUrl}/activity/settings/${childId}`, {
      headers: { 'Authorization': `Bearer ${currentUser.token}` }
    });
    
    if (!response.ok) {
      console.warn(`Failed to load tracking status for child ${childId}`);
      return;
    }
    
    const settings = await response.json();
    const statusEl = document.getElementById(`tracking-status-${childId}`);
    
    if (statusEl) {
      if (settings.tracking_enabled) {
        statusEl.textContent = '✅ Enabled';
        statusEl.style.color = '#10b981';
      } else {
        statusEl.textContent = '⚠️ Disabled';
        statusEl.style.color = '#f59e0b';
      }
    }
  } catch (error) {
    console.error(`Failed to load tracking status for child ${childId}:`, error);
  }
}

function showAddChildModal() {
  const modal = document.getElementById('add-child-modal');
  const nameInput = document.getElementById('new-child-name');
  
  if (modal) {
    modal.classList.remove('hidden');
    if (nameInput) {
      nameInput.value = '';
      nameInput.focus();
    }
  }
}

function hideAddChildModal() {
  const modal = document.getElementById('add-child-modal');
  if (modal) modal.classList.add('hidden');
}

async function createChild() {
  const nameInput = document.getElementById('new-child-name');
  const statusEl = document.getElementById('child-status');
  
  const name = nameInput.value.trim();
  
  if (!name) {
    showStatus(statusEl, 'Child name is required', 'error');
    return;
  }
  
  try {
    const response = await fetch(`${backendUrl}/accounts/children`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentUser.token}`
      },
      body: JSON.stringify({ username: name })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to create child');
    }
    
    const newChild = await response.json();
    
    alert(`Child account created!\n\nName: ${newChild.username}\nAccess Code: ${newChild.access_code}\n\nSave this code!`);
    
    hideAddChildModal();
    await loadChildren();
    showStatus(statusEl, 'Child account created successfully', 'success');
  } catch (error) {
    console.error("[Children] Create failed:", error);
    showStatus(statusEl, error.message || 'Failed to create child account', 'error');
  }
}

// ========== GROUPS MANAGEMENT ==========

async function loadGroups() {
  try {
    const response = await fetch(`${backendUrl}/accounts/groups`, {
      headers: { 'Authorization': `Bearer ${currentUser.token}` }
    });
    
    if (!response.ok) throw new Error('Failed to load groups');
    
    groups = await response.json();
    displayGroups();
  } catch (error) {
    console.error("[Groups] Load failed:", error);
  }
}

function displayGroups() {
  const listEl = document.getElementById('groups-list');
  const emptyEl = document.getElementById('groups-empty');
  const paginationEl = document.getElementById('groups-pagination');
  
  if (!listEl) return;
  
  // Filter groups based on search query
  let filteredGroups = groups;
  if (groupsSearchQuery) {
    filteredGroups = groups.filter(group => 
      group.name.toLowerCase().includes(groupsSearchQuery.toLowerCase())
    );
  }
  
  if (filteredGroups.length === 0) {
    listEl.innerHTML = '';
    if (paginationEl) paginationEl.classList.add('hidden');
    if (emptyEl) {
      if (groupsSearchQuery) {
        emptyEl.innerHTML = `
          <div class="empty-icon">🔍</div>
          <p>No groups found matching "${escapeHtml(groupsSearchQuery)}"</p>
        `;
      } else {
        emptyEl.innerHTML = `
          <div class="empty-icon">👥</div>
          <p>No groups created yet</p>
          <button class="btn" id="add-first-group-btn">Create Your First Group</button>
        `;
      }
      emptyEl.classList.remove('hidden');
    }
    return;
  }
  
  if (emptyEl) emptyEl.classList.add('hidden');
  
  // Calculate pagination
  const totalPages = Math.ceil(filteredGroups.length / ITEMS_PER_PAGE);
  const startIndex = (groupsCurrentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedGroups = filteredGroups.slice(startIndex, endIndex);
  
  // Update pagination controls
  if (paginationEl && totalPages > 1) {
    paginationEl.classList.remove('hidden');
    const prevBtn = document.getElementById('groups-prev-btn');
    const nextBtn = document.getElementById('groups-next-btn');
    const pageInfo = document.getElementById('groups-page-info');
    
    if (prevBtn) prevBtn.disabled = groupsCurrentPage === 1;
    if (nextBtn) nextBtn.disabled = groupsCurrentPage === totalPages;
    if (pageInfo) pageInfo.textContent = `Page ${groupsCurrentPage} of ${totalPages}`;
  } else if (paginationEl) {
    paginationEl.classList.add('hidden');
  }
  
  listEl.innerHTML = paginatedGroups.map(group => `
    <div class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">${escapeHtml(group.name)}</h3>
          ${group.description ? `<p style="margin-top:4px; font-size:13px; color:var(--gc-text-dim);">${escapeHtml(group.description)}</p>` : ''}
          <div style="margin-top:8px;">
            <button class="btn btn-sm btn-secondary" data-manage-members="${group.id}">Manage Members</button>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn btn-sm btn-danger" data-delete-group="${group.id}" data-group-name="${escapeHtml(group.name)}">
            Delete
          </button>
        </div>
      </div>
    </div>
  `).join('');
  
  // Attach delete handlers
  listEl.querySelectorAll('[data-delete-group]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const groupId = e.target.dataset.deleteGroup;
      const groupName = e.target.dataset.groupName;
      if (confirm(`Delete group "${groupName}"? Rules for this group will be deleted.`)) {
        deleteGroup(groupId);
      }
    });
  });
  
  // Attach manage members handlers
  listEl.querySelectorAll('[data-manage-members]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const groupId = e.target.dataset.manageMembers;
      showGroupMembersModal(groupId);
    });
  });
}

async function deleteGroup(groupId) {
  try {
    const response = await fetch(`${backendUrl}/accounts/groups/${groupId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${currentUser.token}` }
    });
    
    if (!response.ok) throw new Error('Failed to delete group');
    
    await loadGroups();
  } catch (error) {
    console.error("[Groups] Delete failed:", error);
    alert('Failed to delete group');
  }
}

async function showAddGroupModal() {
  const groupName = prompt('Enter group name:');
  if (!groupName) return;
  
  const groupDescription = prompt('Enter group description (optional):') || '';
  
  try {
    const response = await fetch(`${backendUrl}/accounts/groups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentUser.token}`
      },
      body: JSON.stringify({
        name: groupName,
        description: groupDescription
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to create group');
    }
    
    await loadGroups();
    alert('Group created successfully!');
  } catch (error) {
    console.error("[Groups] Create failed:", error);
    alert(error.message || 'Failed to create group');
  }
}

async function showGroupMembersModal(groupId) {
  // Get group details
  const group = groups.find(g => g.id == groupId);
  if (!group) return;
  
  // Fetch current group members from backend
  let currentMembers = [];
  try {
    const response = await fetch(`${backendUrl}/accounts/groups/${groupId}/members`, {
      headers: { 'Authorization': `Bearer ${currentUser.token}` }
    });
    if (response.ok) {
      currentMembers = await response.json();
    }
  } catch (error) {
    console.error("[Groups] Failed to load members:", error);
  }
  
  // State management for the modal
  const modalState = {
    currentMembers: currentMembers,
    availableChildren: children,
    currentPage: 1,
    availablePage: 1,
    itemsPerPage: 8,
    currentSearch: '',
    availableSearch: ''
  };
  
  // Create modal
  const modal = document.createElement('div');
  modal.id = 'group-members-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);display:flex;align-items:center;justify-content:center;z-index:1000;backdrop-filter:blur(4px);animation:fadeIn 0.2s ease;';
  
  // Insert into DOM before first render so handlers can bind on first load
  document.body.appendChild(modal);
  
  // Initial render
  renderModalContent();
  
  function renderModalContent() {
    const memberIds = new Set(modalState.currentMembers.map(m => m.id));
    const filteredAvailable = modalState.availableChildren.filter(child => 
      !memberIds.has(child.id) && 
      child.username.toLowerCase().includes(modalState.availableSearch.toLowerCase())
    );
    const filteredCurrent = modalState.currentMembers.filter(member =>
      member.username.toLowerCase().includes(modalState.currentSearch.toLowerCase())
    );
    
    // Pagination for current members
    const currentTotalPages = Math.ceil(filteredCurrent.length / modalState.itemsPerPage);
    const currentStartIdx = (modalState.currentPage - 1) * modalState.itemsPerPage;
    const currentPageItems = filteredCurrent.slice(currentStartIdx, currentStartIdx + modalState.itemsPerPage);
    
    // Pagination for available children
    const availableTotalPages = Math.ceil(filteredAvailable.length / modalState.itemsPerPage);
    const availableStartIdx = (modalState.availablePage - 1) * modalState.itemsPerPage;
    const availablePageItems = filteredAvailable.slice(availableStartIdx, availableStartIdx + modalState.itemsPerPage);
    
    modal.innerHTML = `
      <div style="background:linear-gradient(145deg,#1b2736,#14202c);border:1px solid #2a3a4c;border-radius:16px;padding:0;max-width:900px;width:95%;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);">
        <!-- Header -->
        <div style="padding:24px 32px;border-bottom:1px solid var(--gc-border);background:linear-gradient(120deg,#1e293b,#1a2332);border-radius:16px 16px 0 0;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div>
              <h3 style="margin:0 0 4px;font-size:22px;font-weight:650;color:#e2e8f0;">Manage Group Members</h3>
              <p style="margin:0;font-size:14px;color:var(--gc-text-dim);">Group: <span style="color:var(--gc-accent);font-weight:600;">${escapeHtml(group.name)}</span></p>
            </div>
            <button id="close-members-modal" style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:white;padding:8px 12px;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;transition:0.2s;" onmouseover="this.style.background='rgba(239,68,68,0.2)'" onmouseout="this.style.background='rgba(255,255,255,0.1)'">
              ✕ Close
            </button>
          </div>
        </div>
        
        <!-- Content Grid -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:24px 32px;overflow-y:auto;flex:1;">
          <!-- Current Members Panel -->
          <div style="display:flex;flex-direction:column;min-height:0;">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
              <div style="flex:1;">
                <h4 style="margin:0;font-size:16px;color:#e2e8f0;font-weight:600;">Current Members</h4>
                <p style="margin:4px 0 0;font-size:12px;color:var(--gc-text-dim);">${modalState.currentMembers.length} member${modalState.currentMembers.length !== 1 ? 's' : ''}</p>
              </div>
            </div>
            
            <!-- Search for current members -->
            <input type="text" id="current-members-search" value="${escapeHtml(modalState.currentSearch)}" placeholder="🔍 Search current members..." style="width:100%;padding:10px 12px;background:#0f1a27;border:1px solid #2a3a50;border-radius:8px;color:var(--gc-text);font-family:inherit;font-size:13px;margin-bottom:12px;">
            
            <!-- Members List -->
            <div style="flex:1;overflow-y:auto;background:#0f1a27;border:1px solid #2a3a50;border-radius:10px;padding:8px;min-height:300px;">
              ${currentPageItems.length > 0 ? currentPageItems.map(member => `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:12px;background:linear-gradient(145deg,#182331,#131c27);border:1px solid #2a3a4c;border-radius:8px;margin-bottom:8px;transition:0.2s;" onmouseover="this.style.borderColor='#3a4a5c'" onmouseout="this.style.borderColor='#2a3a4c'">
                  <div style="display:flex;align-items:center;gap:12px;">
                    <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#10b981,#059669);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:600;color:white;">
                      ${escapeHtml(member.username.charAt(0).toUpperCase())}
                    </div>
                    <div>
                      <div style="font-weight:600;color:#e2e8f0;font-size:14px;">${escapeHtml(member.username)}</div>
                      <div style="font-size:11px;color:var(--gc-text-dim);">Member</div>
                    </div>
                  </div>
                  <button class="btn btn-sm btn-danger" style="background:rgba(239,68,68,0.2);border:1px solid rgba(239,68,68,0.4);padding:6px 14px;font-size:12px;" data-remove-member="${groupId}" data-child-id="${member.id}">
                    Remove
                  </button>
                </div>
              `).join('') : `
                <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--gc-text-dim);padding:32px;">
                  <div style="font-size:48px;margin-bottom:12px;opacity:0.5;">👥</div>
                  <p style="font-size:14px;text-align:center;">${modalState.currentSearch ? 'No members match your search' : 'No members in this group yet'}</p>
                </div>
              `}
            </div>
            
            <!-- Pagination for current members -->
            ${currentTotalPages > 1 ? `
              <div style="display:flex;justify-content:center;align-items:center;gap:12px;margin-top:12px;">
                <button class="btn btn-sm btn-secondary" id="current-prev-btn" ${modalState.currentPage === 1 ? 'disabled' : ''} style="padding:6px 12px;font-size:12px;">← Prev</button>
                <span style="color:var(--gc-text-dim);font-size:13px;">Page ${modalState.currentPage} of ${currentTotalPages}</span>
                <button class="btn btn-sm btn-secondary" id="current-next-btn" ${modalState.currentPage === currentTotalPages ? 'disabled' : ''} style="padding:6px 12px;font-size:12px;">Next →</button>
              </div>
            ` : ''}
          </div>
          
          <!-- Available Children Panel -->
          <div style="display:flex;flex-direction:column;min-height:0;">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
              <div style="flex:1;">
                <h4 style="margin:0;font-size:16px;color:#e2e8f0;font-weight:600;">Available Children</h4>
                <p style="margin:4px 0 0;font-size:12px;color:var(--gc-text-dim);">${filteredAvailable.length} available</p>
              </div>
            </div>
            
            <!-- Search for available children -->
            <input type="text" id="available-children-search" value="${escapeHtml(modalState.availableSearch)}" placeholder="🔍 Search available children..." style="width:100%;padding:10px 12px;background:#0f1a27;border:1px solid #2a3a50;border-radius:8px;color:var(--gc-text);font-family:inherit;font-size:13px;margin-bottom:12px;">
            
            <!-- Children List -->
            <div style="flex:1;overflow-y:auto;background:#0f1a27;border:1px solid #2a3a50;border-radius:10px;padding:8px;min-height:300px;">
              ${availablePageItems.length > 0 ? availablePageItems.map(child => `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:12px;background:linear-gradient(145deg,#182331,#131c27);border:1px solid #2a3a4c;border-radius:8px;margin-bottom:8px;transition:0.2s;" onmouseover="this.style.borderColor='#3a4a5c'" onmouseout="this.style.borderColor='#2a3a4c'">
                  <div style="display:flex;align-items:center;gap:12px;">
                    <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#8b5cf6);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:600;color:white;">
                      ${escapeHtml(child.username.charAt(0).toUpperCase())}
                    </div>
                    <div>
                      <div style="font-weight:600;color:#e2e8f0;font-size:14px;">${escapeHtml(child.username)}</div>
                      <div style="font-size:11px;color:var(--gc-text-dim);">Not in group</div>
                    </div>
                  </div>
                  <button class="btn btn-sm" style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:6px 14px;font-size:12px;" data-add-member="${groupId}" data-child-id="${child.id}">
                    + Add
                  </button>
                </div>
              `).join('') : `
                <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--gc-text-dim);padding:32px;">
                  <div style="font-size:48px;margin-bottom:12px;opacity:0.5;">✓</div>
                  <p style="font-size:14px;text-align:center;">${modalState.availableSearch ? 'No children match your search' : 'All children are already members'}</p>
                </div>
              `}
            </div>
            
            <!-- Pagination for available children -->
            ${availableTotalPages > 1 ? `
              <div style="display:flex;justify-content:center;align-items:center;gap:12px;margin-top:12px;">
                <button class="btn btn-sm btn-secondary" id="available-prev-btn" ${modalState.availablePage === 1 ? 'disabled' : ''} style="padding:6px 12px;font-size:12px;">← Prev</button>
                <span style="color:var(--gc-text-dim);font-size:13px;">Page ${modalState.availablePage} of ${availableTotalPages}</span>
                <button class="btn btn-sm btn-secondary" id="available-next-btn" ${modalState.availablePage === availableTotalPages ? 'disabled' : ''} style="padding:6px 12px;font-size:12px;">Next →</button>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;
    
    attachModalHandlers();
  }
  
  function attachModalHandlers() {
    // Close handler - must be re-attached after every render
    const closeBtn = modal.querySelector('#close-members-modal');
    if (closeBtn) {
      closeBtn.onclick = () => modal.remove();
    }
    
    // Search handlers
    const currentSearchInput = modal.querySelector('#current-members-search');
    if (currentSearchInput) {
      currentSearchInput.oninput = (e) => {
        modalState.currentSearch = e.target.value;
        modalState.currentPage = 1;
        renderModalContent();
      };
    }
    
    const availableSearchInput = modal.querySelector('#available-children-search');
    if (availableSearchInput) {
      availableSearchInput.oninput = (e) => {
        modalState.availableSearch = e.target.value;
        modalState.availablePage = 1;
        renderModalContent();
      };
    }
    
    // Pagination handlers for current members
    const currentPrevBtn = modal.querySelector('#current-prev-btn');
    if (currentPrevBtn) {
      currentPrevBtn.onclick = () => {
        if (modalState.currentPage > 1) {
          modalState.currentPage--;
          renderModalContent();
        }
      };
    }
    
    const currentNextBtn = modal.querySelector('#current-next-btn');
    if (currentNextBtn) {
      currentNextBtn.onclick = () => {
        modalState.currentPage++;
        renderModalContent();
      };
    }
    
    // Pagination handlers for available children
    const availablePrevBtn = modal.querySelector('#available-prev-btn');
    if (availablePrevBtn) {
      availablePrevBtn.onclick = () => {
        if (modalState.availablePage > 1) {
          modalState.availablePage--;
          renderModalContent();
        }
      };
    }
    
    const availableNextBtn = modal.querySelector('#available-next-btn');
    if (availableNextBtn) {
      availableNextBtn.onclick = () => {
        modalState.availablePage++;
        renderModalContent();
      };
    }
    
    // Add member handlers
    modal.querySelectorAll('[data-add-member]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const groupId = e.target.dataset.addMember;
        const childId = e.target.dataset.childId;
        const button = e.target;
        const originalText = button.textContent;
        
        try {
          button.disabled = true;
          button.textContent = 'Adding...';
          
          const response = await fetch(`${backendUrl}/accounts/groups/${groupId}/members`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${currentUser.token}`
            },
            body: JSON.stringify({ child_id: parseInt(childId) })
          });
          
          if (!response.ok) throw new Error('Failed to add member');
          
          // Update modal state
          const child = modalState.availableChildren.find(c => c.id == childId);
          if (child) {
            modalState.currentMembers.push(child);
            modalState.currentPage = 1;
            modalState.availablePage = 1;
          }
          
          // Reload groups in background
          loadGroups();
          
          // Re-render modal
          renderModalContent();
        } catch (error) {
          console.error("[Groups] Add member failed:", error);
          button.disabled = false;
          button.textContent = originalText;
          alert('Failed to add member to group');
        }
      });
    });
    
    // Remove member handlers
    modal.querySelectorAll('[data-remove-member]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const groupId = e.target.dataset.removeMember;
        const childId = e.target.dataset.childId;
        const button = e.target;
        const originalText = button.textContent;
        
        if (!confirm('Remove this child from the group?')) return;
        
        try {
          button.disabled = true;
          button.textContent = 'Removing...';
          
          const response = await fetch(`${backendUrl}/accounts/groups/${groupId}/members/${childId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${currentUser.token}` }
          });
          
          if (!response.ok) throw new Error('Failed to remove member');
          
          // Update modal state
          modalState.currentMembers = modalState.currentMembers.filter(m => m.id != childId);
          if (modalState.currentPage > 1) {
            const totalPages = Math.ceil(modalState.currentMembers.length / modalState.itemsPerPage);
            if (modalState.currentPage > totalPages) {
              modalState.currentPage = totalPages || 1;
            }
          }
          
          // Reload groups in background
          loadGroups();
          
          // Re-render modal
          renderModalContent();
        } catch (error) {
          console.error("[Groups] Remove member failed:", error);
          button.disabled = false;
          button.textContent = originalText;
          alert('Failed to remove member from group');
        }
      });
    });
  }
  
  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

// ========== RULES MANAGEMENT ==========

async function loadRulesTargets() {
  rulesTargets = [
    ...children.map(c => ({ type: 'child', id: c.id, name: c.username })),
    ...groups.map(g => ({ type: 'group', id: g.id, name: g.name }))
  ];
  
  rulesTargetsCurrentPage = 1;
  rulesTargetsSearchQuery = '';
  renderRulesTargets();
}

function renderRulesTargets() {
  const targetsEl = document.getElementById('rules-targets');
  const paginationEl = document.getElementById('rules-targets-pagination');
  if (!targetsEl) return;
  
  // Filter targets based on type filter
  let filteredTargets = rulesTargets;
  if (rulesTargetsFilter === 'child') {
    filteredTargets = rulesTargets.filter(t => t.type === 'child');
  } else if (rulesTargetsFilter === 'group') {
    filteredTargets = rulesTargets.filter(t => t.type === 'group');
  }
  
  // Filter targets based on search
  if (rulesTargetsSearchQuery) {
    filteredTargets = filteredTargets.filter(t =>
      t.name.toLowerCase().includes(rulesTargetsSearchQuery.toLowerCase())
    );
  }
  
  if (filteredTargets.length === 0) {
    if (paginationEl) paginationEl.classList.add('hidden');
    
    if (rulesTargetsSearchQuery) {
      targetsEl.innerHTML = `
        <div style="text-align:center; padding:40px 20px; color:var(--gc-text-dim);">
          <div style="font-size:48px; margin-bottom:16px; opacity:0.5;">🔍</div>
          <h3 style="margin-bottom:8px; color:var(--gc-text);">No Matches Found</h3>
          <p style="font-size:14px;">No children or groups match "${escapeHtml(rulesTargetsSearchQuery)}"</p>
        </div>
      `;
    } else {
      targetsEl.innerHTML = '<p style="color:var(--gc-text-dim);">Create a child account or group first.</p>';
    }
    return;
  }
  
  // Calculate pagination
  const totalPages = Math.ceil(filteredTargets.length / ITEMS_PER_PAGE);
  const startIndex = (rulesTargetsCurrentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedTargets = filteredTargets.slice(startIndex, endIndex);
  
  // Update pagination controls
  if (paginationEl && totalPages > 1) {
    paginationEl.classList.remove('hidden');
    const prevBtn = document.getElementById('rules-targets-prev-btn');
    const nextBtn = document.getElementById('rules-targets-next-btn');
    const pageInfo = document.getElementById('rules-targets-page-info');
    
    if (prevBtn) prevBtn.disabled = rulesTargetsCurrentPage === 1;
    if (nextBtn) nextBtn.disabled = rulesTargetsCurrentPage === totalPages;
    if (pageInfo) pageInfo.textContent = `Page ${rulesTargetsCurrentPage} of ${totalPages}`;
  } else if (paginationEl) {
    paginationEl.classList.add('hidden');
  }
  
  targetsEl.innerHTML = `
    <div class="grid grid-2">
      ${paginatedTargets.map(target => `
        <div class="card" style="cursor:pointer;" data-load-rules="${target.type}" data-target-id="${target.id}" data-target-name="${escapeHtml(target.name)}">
          <h3 class="card-title">${escapeHtml(target.name)}</h3>
          <span class="badge badge-${target.type}">${target.type}</span>
        </div>
      `).join('')}
    </div>
  `;
  
  // Attach handlers
  targetsEl.querySelectorAll('[data-load-rules]').forEach(card => {
    card.addEventListener('click', (e) => {
      const type = e.currentTarget.dataset.loadRules;
      const id = e.currentTarget.dataset.targetId;
      const name = e.currentTarget.dataset.targetName;
      loadRulesForTarget(type, id, name);
    });
  });
}

async function loadRulesForTarget(targetType, targetId, targetName) {
  try {
    const response = await fetch(`${backendUrl}/accounts/rules/${targetType}/${targetId}`, {
      headers: { 'Authorization': `Bearer ${currentUser.token}` }
    });
    
    if (!response.ok) throw new Error('Failed to load rules');
    
    const rules = await response.json();
    currentRules = rules;
    currentRuleTarget = { type: targetType, id: targetId, name: targetName };
    rulesListCurrentPage = 1;
    rulesListSearchQuery = '';
    displayRules();
  } catch (error) {
    console.error("[Rules] Load failed:", error);
    alert('Failed to load rules');
  }
}

function displayRules() {
  const rulesListEl = document.getElementById('rules-list');
  const rulesContentEl = document.getElementById('rules-content');
  const paginationEl = document.getElementById('rules-list-pagination');
  if (!rulesListEl || !rulesContentEl) return;
  
  const { type: targetType, id: targetId, name: targetName } = currentRuleTarget;
  
  rulesListEl.classList.remove('hidden');
  
  // Filter rules based on search
  let filteredRules = currentRules;
  if (rulesListSearchQuery) {
    filteredRules = currentRules.filter(r =>
      r.pattern.toLowerCase().includes(rulesListSearchQuery.toLowerCase()) ||
      (r.explanation && r.explanation.toLowerCase().includes(rulesListSearchQuery.toLowerCase())) ||
      r.rule_type.toLowerCase().includes(rulesListSearchQuery.toLowerCase())
    );
  }
  
  // Calculate pagination
  const totalPages = Math.ceil(filteredRules.length / ITEMS_PER_PAGE);
  const startIndex = (rulesListCurrentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedRules = filteredRules.slice(startIndex, endIndex);
  
  // Update pagination controls
  if (paginationEl && filteredRules.length > ITEMS_PER_PAGE) {
    paginationEl.classList.remove('hidden');
    const prevBtn = document.getElementById('rules-list-prev-btn');
    const nextBtn = document.getElementById('rules-list-next-btn');
    const pageInfo = document.getElementById('rules-list-page-info');
    
    if (prevBtn) prevBtn.disabled = rulesListCurrentPage === 1;
    if (nextBtn) nextBtn.disabled = rulesListCurrentPage === totalPages;
    if (pageInfo) pageInfo.textContent = `Page ${rulesListCurrentPage} of ${totalPages}`;
  } else if (paginationEl) {
    paginationEl.classList.add('hidden');
  }
  
  rulesContentEl.innerHTML = `
    <div class="section-header">
      <h2 class="section-title">Rules for ${escapeHtml(targetName)}</h2>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-sm" data-add-rule="${targetType}" data-target-id="${targetId}" data-target-name="${escapeHtml(targetName)}">+ Add Rule</button>
        <button class="btn btn-sm btn-secondary" data-export-rules="${targetType}" data-target-id="${targetId}" data-target-name="${escapeHtml(targetName)}">Export Rules</button>
        <button class="btn btn-sm btn-secondary" data-import-rules="${targetType}" data-target-id="${targetId}" data-target-name="${escapeHtml(targetName)}">Import Rules</button>
        <button class="btn btn-sm btn-secondary" data-back-rules>← Back</button>
      </div>
    </div>
    
    ${filteredRules.length === 0 ? (
      rulesListSearchQuery ? `
        <div style="text-align:center; padding:40px 20px; color:var(--gc-text-dim);">
          <div style="font-size:48px; margin-bottom:16px; opacity:0.5;">🔍</div>
          <h3 style="margin-bottom:8px; color:var(--gc-text);">No Rules Found</h3>
          <p style="font-size:14px;">No rules match "${escapeHtml(rulesListSearchQuery)}"</p>
        </div>
      ` : `
        <div class="empty-state">
          <div class="empty-icon">📋</div>
          <p>No rules defined yet</p>
          <button class="btn" data-add-rule="${targetType}" data-target-id="${targetId}" data-target-name="${escapeHtml(targetName)}">Create First Rule</button>
        </div>
      `
    ) : `
      ${paginatedRules.map(rule => `
        <div class="card">
          <div class="card-header">
            <div>
              <h3 class="card-title">${rule.rule_type}</h3>
              <p style="margin-top:4px; font-size:14px;">${escapeHtml(rule.pattern)}</p>
              ${rule.explanation ? `<p style="margin-top:4px; font-size:12px; color:var(--gc-text-dim);">${escapeHtml(rule.explanation)}</p>` : ''}
              <div style="margin-top:8px;">
                <span class="badge badge-${rule.rule_type}">${rule.rule_type}</span>
                <span class="badge ${rule.enabled ? 'badge-active' : ''}">${rule.enabled ? 'Enabled' : 'Disabled'}</span>
              </div>
            </div>
            <div class="card-actions">
              <button class="btn btn-sm btn-secondary" data-toggle-rule="${rule.id}" data-enabled="${!rule.enabled}" data-type="${targetType}" data-id="${targetId}" data-name="${escapeHtml(targetName)}">
                ${rule.enabled ? 'Disable' : 'Enable'}
              </button>
              <button class="btn btn-sm btn-danger" data-delete-rule="${rule.id}" data-type="${targetType}" data-id="${targetId}" data-name="${escapeHtml(targetName)}">
                Delete
              </button>
            </div>
          </div>
        </div>
      `).join('')}
    `}
  `;
  
  // Attach event listeners
  rulesContentEl.querySelectorAll('[data-add-rule]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const type = e.target.dataset.addRule;
      const id = e.target.dataset.targetId;
      const name = e.target.dataset.targetName;
      showAddRuleModal(type, id, name);
    });
  });
  
  rulesContentEl.querySelectorAll('[data-export-rules]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const type = e.target.dataset.exportRules;
      const id = e.target.dataset.targetId;
      const name = e.target.dataset.targetName;
      exportRules(type, id, name);
    });
  });
  
  rulesContentEl.querySelectorAll('[data-import-rules]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const type = e.target.dataset.importRules;
      const id = e.target.dataset.targetId;
      const name = e.target.dataset.targetName;
      importRules(type, id, name);
    });
  });
  
  rulesContentEl.querySelectorAll('[data-back-rules]').forEach(btn => {
    btn.addEventListener('click', () => {
      loadRulesTargets();
      rulesListEl.classList.add('hidden');
    });
  });
  
  rulesContentEl.querySelectorAll('[data-toggle-rule]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const ruleId = e.target.dataset.toggleRule;
      const enabled = e.target.dataset.enabled === 'true';
      const type = e.target.dataset.type;
      const id = e.target.dataset.id;
      const name = e.target.dataset.name;
      toggleRule(ruleId, enabled, type, id, name);
    });
  });
  
  rulesContentEl.querySelectorAll('[data-delete-rule]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const ruleId = e.target.dataset.deleteRule;
      const type = e.target.dataset.type;
      const id = e.target.dataset.id;
      const name = e.target.dataset.name;
      if (confirm('Delete this rule?')) {
        deleteRule(ruleId, type, id, name);
      }
    });
  });
}

function showAddRuleModal(targetType, targetId, targetName) {
  // Create modal
  const modal = document.createElement('div');
  modal.id = 'add-rule-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;z-index:1000;backdrop-filter:blur(4px);';
  
  modal.innerHTML = `
    <div style="background:linear-gradient(145deg,#1b2736,#14202c);border:1px solid #233244;border-radius:16px;padding:32px;max-width:650px;width:92%;box-shadow:0 25px 70px rgba(0,0,0,0.6);">
      <h3 style="margin:0 0 24px;font-size:22px;font-weight:650;background:linear-gradient(90deg,#ffffff,#c7d2fe);-webkit-background-clip:text;background-clip:text;color:transparent;">Add Rule for ${escapeHtml(targetName)}</h3>
      
      <div style="margin-bottom:24px;">
        <label style="display:block;margin-bottom:10px;font-weight:600;font-size:13px;letter-spacing:0.05em;text-transform:uppercase;color:var(--gc-text-dim);">Rule Type</label>
        <div style="display:flex;gap:10px;flex-wrap:wrap;" id="rule-type-buttons">
          <button class="btn btn-sm" data-rule-type="blocklist" style="flex:1;min-width:120px;padding:12px 16px;font-size:13px;border-radius:12px;">
            🚫 Blocklist
          </button>
          <button class="btn btn-sm btn-secondary" data-rule-type="allowlist" style="flex:1;min-width:120px;padding:12px 16px;font-size:13px;border-radius:12px;">
            ✅ Allowlist
          </button>
          <button class="btn btn-sm btn-secondary" data-rule-type="time_window" style="flex:1;min-width:120px;padding:12px 16px;font-size:13px;border-radius:12px;">
            ⏰ Time Window
          </button>
        </div>
        <p id="rule-type-description" style="margin-top:12px;font-size:13px;line-height:1.6;color:var(--gc-text-dim);min-height:40px;">
          Select a rule type to continue
        </p>
      </div>
      
      <div style="margin-bottom:20px;" id="pattern-section">
        <label style="display:block;margin-bottom:10px;font-weight:600;font-size:13px;letter-spacing:0.05em;text-transform:uppercase;color:var(--gc-text-dim);">Website/Pattern <span style="color:var(--gc-danger);">*</span></label>
        <input type="text" id="rule-pattern" placeholder="e.g., facebook.com or youtube.com" style="width:100%;padding:12px 14px;border:2px solid var(--gc-border);border-radius:12px;background:rgba(15,23,42,0.8);color:var(--gc-text);font-size:14px;transition:all 0.2s;">
        <p style="margin-top:6px;font-size:12px;color:var(--gc-text-dim);line-height:1.5;" id="pattern-help">
          Enter the domain name (e.g., facebook.com, youtube.com)
        </p>
      </div>
      
      <div style="margin-bottom:20px;display:none;" id="time-window-section">
        <label style="display:block;margin-bottom:10px;font-weight:600;font-size:13px;letter-spacing:0.05em;text-transform:uppercase;color:var(--gc-text-dim);">Days of Week</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;" id="day-buttons">
          <button data-day="Mon" style="flex:1;min-width:60px;padding:10px 12px;font-size:12px;font-weight:600;border:2px solid var(--gc-border);border-radius:10px;background:rgba(255,255,255,0.05);color:var(--gc-text-dim);cursor:pointer;transition:all 0.2s;">Mon</button>
          <button data-day="Tue" style="flex:1;min-width:60px;padding:10px 12px;font-size:12px;font-weight:600;border:2px solid var(--gc-border);border-radius:10px;background:rgba(255,255,255,0.05);color:var(--gc-text-dim);cursor:pointer;transition:all 0.2s;">Tue</button>
          <button data-day="Wed" style="flex:1;min-width:60px;padding:10px 12px;font-size:12px;font-weight:600;border:2px solid var(--gc-border);border-radius:10px;background:rgba(255,255,255,0.05);color:var(--gc-text-dim);cursor:pointer;transition:all 0.2s;">Wed</button>
          <button data-day="Thu" style="flex:1;min-width:60px;padding:10px 12px;font-size:12px;font-weight:600;border:2px solid var(--gc-border);border-radius:10px;background:rgba(255,255,255,0.05);color:var(--gc-text-dim);cursor:pointer;transition:all 0.2s;">Thu</button>
          <button data-day="Fri" style="flex:1;min-width:60px;padding:10px 12px;font-size:12px;font-weight:600;border:2px solid var(--gc-border);border-radius:10px;background:rgba(255,255,255,0.05);color:var(--gc-text-dim);cursor:pointer;transition:all 0.2s;">Fri</button>
          <button data-day="Sat" style="flex:1;min-width:60px;padding:10px 12px;font-size:12px;font-weight:600;border:2px solid var(--gc-border);border-radius:10px;background:rgba(255,255,255,0.05);color:var(--gc-text-dim);cursor:pointer;transition:all 0.2s;">Sat</button>
          <button data-day="Sun" style="flex:1;min-width:60px;padding:10px 12px;font-size:12px;font-weight:600;border:2px solid var(--gc-border);border-radius:10px;background:rgba(255,255,255,0.05);color:var(--gc-text-dim);cursor:pointer;transition:all 0.2s;">Sun</button>
        </div>
        
        <label style="display:block;margin-bottom:10px;font-weight:600;font-size:13px;letter-spacing:0.05em;text-transform:uppercase;color:var(--gc-text-dim);">Time Range</label>
        <div style="display:flex;gap:12px;align-items:flex-start;">
          <div style="flex:1;">
            <label style="display:block;margin-bottom:6px;font-size:12px;color:var(--gc-text-dim);">Start Time</label>
            <select id="time-start" size="6" style="width:100%;padding:8px;border:2px solid var(--gc-border);border-radius:12px;background:rgba(15,23,42,0.8);color:var(--gc-text);font-size:14px;cursor:pointer;overflow-y:auto;">
              ${generateTimeOptions()}
            </select>
          </div>
          <div style="flex:1;">
            <label style="display:block;margin-bottom:6px;font-size:12px;color:var(--gc-text-dim);">End Time</label>
            <select id="time-end" size="6" style="width:100%;padding:8px;border:2px solid var(--gc-border);border-radius:12px;background:rgba(15,23,42,0.8);color:var(--gc-text);font-size:14px;cursor:pointer;overflow-y:auto;">
              ${generateTimeOptions()}
            </select>
          </div>
        </div>
        <p style="margin-top:6px;font-size:12px;color:var(--gc-text-dim);">Scroll to select start and end times for the restriction</p>
      </div>
      
      <div style="margin-bottom:24px;">
        <label style="display:block;margin-bottom:10px;font-weight:600;font-size:13px;letter-spacing:0.05em;text-transform:uppercase;color:var(--gc-text-dim);">Explanation <span style="color:var(--gc-danger);">*</span></label>
        <textarea id="rule-explanation" placeholder="Why is this rule needed? This message will be shown when the rule is triggered." style="width:100%;padding:12px 14px;border:2px solid var(--gc-border);border-radius:12px;background:rgba(15,23,42,0.8);color:var(--gc-text);font-size:14px;min-height:90px;resize:vertical;line-height:1.5;"></textarea>
      </div>
      
      <div id="rule-modal-status" style="margin-bottom:16px;padding:12px 16px;border-radius:12px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.35);color:#fca5a5;font-size:13px;display:none;font-weight:500;"></div>
      
      <div style="display:flex;gap:12px;justify-content:flex-end;">
        <button class="btn btn-secondary" id="cancel-rule-btn" style="padding:12px 24px;border-radius:12px;">Cancel</button>
        <button class="btn" id="create-rule-btn" style="padding:12px 24px;border-radius:12px;">Create Rule</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Attach event listeners
  document.querySelectorAll('#rule-type-buttons [data-rule-type]').forEach(btn => {
    btn.addEventListener('click', () => selectRuleType(btn.dataset.ruleType));
  });
  
  // Day button toggles
  document.querySelectorAll('#day-buttons [data-day]').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('active');
      if (btn.classList.contains('active')) {
        btn.style.background = 'linear-gradient(135deg,#6366f1,#8b5cf6)';
        btn.style.borderColor = '#6366f1';
        btn.style.color = '#fff';
      } else {
        btn.style.background = 'rgba(255,255,255,0.05)';
        btn.style.borderColor = 'var(--gc-border)';
        btn.style.color = 'var(--gc-text-dim)';
      }
    });
  });
  
  document.getElementById('cancel-rule-btn').addEventListener('click', () => {
    modal.remove();
  });
  
  document.getElementById('create-rule-btn').addEventListener('click', () => {
    submitRule(targetType, targetId, targetName);
  });
  
  // Initialize with blocklist selected
  selectRuleType('blocklist');
  
  // Focus pattern input
  setTimeout(() => {
    document.getElementById('rule-pattern').focus();
  }, 100);
}

// Helper function to generate time options (00:00 to 23:45 in 15-min intervals)
function generateTimeOptions() {
  const options = [];
  for (let hour = 0; hour < 24; hour++) {
    for (let min = 0; min < 60; min += 15) {
      const timeStr = `${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
      const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
      const ampm = hour < 12 ? 'AM' : 'PM';
      const displayStr = `${hour12.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')} ${ampm}`;
      options.push(`<option value="${timeStr}">${displayStr}</option>`);
    }
  }
  // Add 23:59 as the last option
  const hour12 = 11;
  const displayStr = `${hour12.toString().padStart(2, '0')}:59 PM`;
  options.push(`<option value="23:59">${displayStr}</option>`);
  return options.join('');
}

// Rule modal state and functions (now local, not global)
let selectedRuleType = 'blocklist';

function selectRuleType(type) {
  selectedRuleType = type;
  
  // Update button styles
  document.querySelectorAll('[data-rule-type]').forEach(btn => {
    if (btn.dataset.ruleType === type) {
      btn.classList.remove('btn-secondary');
      btn.classList.add('btn');
    } else {
      btn.classList.remove('btn');
      btn.classList.add('btn-secondary');
    }
  });
  
  // Update description
  const descriptions = {
    blocklist: '🚫 <strong>Blocklist:</strong> Block access to specific websites. The child will see a blocked page when trying to visit these sites.',
    allowlist: '✅ <strong>Allowlist:</strong> Only allow access to specific websites. All other sites will be blocked.',
    time_window: '⏰ <strong>Time Window:</strong> Restrict access during specific times and days (e.g., bedtime, school hours).'
  };
  
  document.getElementById('rule-type-description').innerHTML = descriptions[type];
  
  // Show/hide appropriate sections
  const patternSection = document.getElementById('pattern-section');
  const timeWindowSection = document.getElementById('time-window-section');
  const patternInput = document.getElementById('rule-pattern');
  const patternHelp = document.getElementById('pattern-help');
  
  if (type === 'time_window') {
    // Show time window UI
    patternSection.style.display = 'block';
    timeWindowSection.style.display = 'block';
    patternInput.placeholder = 'e.g., facebook.com (optional - leave empty for all sites)';
    patternHelp.textContent = 'Optional: Enter a specific website to restrict, or leave empty to apply time restriction to all sites';
  } else {
    // Show simple pattern input
    patternSection.style.display = 'block';
    timeWindowSection.style.display = 'none';
    patternInput.placeholder = 'e.g., facebook.com or youtube.com';
    patternHelp.textContent = 'Enter the domain name (e.g., facebook.com, youtube.com)';
  }
}

async function submitRule(targetType, targetId, targetName) {
  const pattern = document.getElementById('rule-pattern').value.trim();
  const explanation = document.getElementById('rule-explanation').value.trim();
  const statusEl = document.getElementById('rule-modal-status');
  const createBtn = document.getElementById('create-rule-btn');
  
  let finalPattern = pattern;
  
  // For time_window type, build pattern from time selectors and days
  if (selectedRuleType === 'time_window') {
    const timeStart = document.getElementById('time-start').value;
    const timeEnd = document.getElementById('time-end').value;
    const selectedDays = Array.from(document.querySelectorAll('#day-buttons [data-day].active'))
      .map(btn => btn.dataset.day);
    
    if (!timeStart || !timeEnd) {
      statusEl.textContent = 'Please select start and end times';
      statusEl.style.display = 'block';
      return;
    }
    
    // Build pattern: domain|days|time (or just days|time if no domain)
    const timeRange = `${timeStart}-${timeEnd}`;
    const daysStr = selectedDays.length > 0 ? selectedDays.join(',') : 'Mon,Tue,Wed,Thu,Fri,Sat,Sun';
    
    if (pattern) {
      finalPattern = `${pattern}|${daysStr}|${timeRange}`;
    } else {
      finalPattern = `*|${daysStr}|${timeRange}`;
    }
  }
  
  // Validation
  if (!finalPattern || (selectedRuleType !== 'time_window' && !pattern)) {
    statusEl.textContent = 'Pattern is required';
    statusEl.style.display = 'block';
    return;
  }
  
  if (!explanation) {
    statusEl.textContent = 'Explanation is required - please explain why this rule is needed';
    statusEl.style.display = 'block';
    return;
  }
  
  // Disable button
  createBtn.disabled = true;
  createBtn.textContent = 'Creating...';
  statusEl.style.display = 'none';
  
  try {
    await createRule(targetType, targetId, targetName, {
      rule_type: selectedRuleType,
      pattern: finalPattern,
      explanation: explanation,
      enabled: true
    });
    
    // Close modal on success
    document.getElementById('add-rule-modal').remove();
  } catch (error) {
    statusEl.textContent = error.message || 'Failed to create rule';
    statusEl.style.display = 'block';
    createBtn.disabled = false;
    createBtn.textContent = 'Create Rule';
  }
}

async function createRule(targetType, targetId, targetName, ruleData) {
  try {
    const response = await fetch(`${backendUrl}/accounts/rules`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentUser.token}`
      },
      body: JSON.stringify({
        ...ruleData,
        target_type: targetType,
        target_id: parseInt(targetId)
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to create rule');
    }
    
    await loadRulesForTarget(targetType, targetId, targetName);
  } catch (error) {
    console.error("[Rules] Create failed:", error);
    alert(error.message || 'Failed to create rule');
  }
}

async function toggleRule(ruleId, enabled, targetType, targetId, targetName) {
  try {
    const response = await fetch(`${backendUrl}/accounts/rules/${ruleId}?enabled=${enabled}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${currentUser.token}`
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Rules] Toggle failed:", response.status, errorText);
      throw new Error('Failed to toggle rule');
    }
    
    await loadRulesForTarget(targetType, targetId, targetName);
  } catch (error) {
    console.error("[Rules] Toggle failed:", error);
    alert('Failed to toggle rule');
  }
}

async function deleteRule(ruleId, targetType, targetId, targetName) {
  try {
    const response = await fetch(`${backendUrl}/accounts/rules/${ruleId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${currentUser.token}` }
    });
    
    if (!response.ok) throw new Error('Failed to delete rule');
    
    await loadRulesForTarget(targetType, targetId, targetName);
  } catch (error) {
    console.error("[Rules] Delete failed:", error);
    alert('Failed to delete rule');
  }
}

// ========== IMPORT/EXPORT RULES ==========

async function exportRules(targetType, targetId, targetName) {
  try {
    const response = await fetch(`${backendUrl}/accounts/rules/${targetType}/${targetId}`, {
      headers: { 'Authorization': `Bearer ${currentUser.token}` }
    });
    
    if (!response.ok) throw new Error('Failed to load rules');
    
    const rules = await response.json();
    
    // Create JSON blob
    const rulesJSON = JSON.stringify(rules, null, 2);
    const blob = new Blob([rulesJSON], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    // Download
    const a = document.createElement('a');
    a.href = url;
    a.download = `guardiancore-rules-${targetName}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    alert('Rules exported successfully!');
  } catch (error) {
    console.error("[Export] Failed:", error);
    alert('Failed to export rules');
  }
}

async function importRules(targetType, targetId, targetName) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    try {
      const text = await file.text();
      const rules = JSON.parse(text);
      
      if (!Array.isArray(rules)) {
        throw new Error('Invalid rules file format');
      }
      
      // Import each rule
      let imported = 0;
      for (const rule of rules) {
        try {
          await createRule(targetType, targetId, targetName, {
            rule_type: rule.rule_type,
            pattern: rule.pattern,
            explanation: rule.explanation || '',
            enabled: rule.enabled !== false
          });
          imported++;
        } catch (err) {
          console.error("[Import] Failed to import rule:", rule, err);
        }
      }
      
      alert(`Imported ${imported} out of ${rules.length} rules successfully!`);
      await loadRulesForTarget(targetType, targetId, targetName);
    } catch (error) {
      console.error("[Import] Failed:", error);
      alert('Failed to import rules: ' + error.message);
    }
  };
  
  input.click();
}

// ========== BACKEND CONFIGURATION ==========

async function loadBackendSettings() {
  const urlInput = document.getElementById('backend-url');
  if (urlInput) urlInput.value = backendUrl;
}

async function saveBackendSettings() {
  const urlInput = document.getElementById('backend-url');
  const statusEl = document.getElementById('backend-status');
  
  const newUrl = urlInput.value.trim();
  
  if (!newUrl) {
    showStatus(statusEl, 'Backend URL cannot be empty', 'error');
    return;
  }
  
  try {
    const response = await fetch(`${newUrl}/health`);
    if (!response.ok) throw new Error('Backend not reachable');
    
    await chrome.storage.local.set({ gc_backend_url: newUrl });
    backendUrl = newUrl;
    
    showStatus(statusEl, 'Backend URL saved successfully', 'success');
  } catch (error) {
    console.error("[Backend] Save failed:", error);
    showStatus(statusEl, 'Failed to connect to backend', 'error');
  }
}

// ========== UTILITY FUNCTIONS ==========

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showStatus(element, message, type) {
  if (!element) return;
  element.textContent = message;
  element.className = `status status-${type}`;
  element.classList.remove('hidden');
  
  if (type === 'success') {
    setTimeout(() => element.classList.add('hidden'), 5000);
  }
}

// ========== TAB MANAGEMENT ==========

function setupTabs() {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab;
      
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      const content = document.getElementById(`${targetTab}-tab`);
      if (content) content.classList.add('active');
      
      loadTabData(targetTab);
    });
  });
}

function loadTabData(tabName) {
  switch(tabName) {
    case 'profile':
      loadProfile();
      break;
    case 'children':
      loadChildren();
      break;
    case 'groups':
      loadGroups();
      break;
    case 'rules':
      loadRulesTargets();
      break;
    case 'recovery':
      displayRecoveryCodes();
      break;
    case 'backend':
      loadBackendSettings();
      break;
    case 'activity':
      // Activity dashboard loads dynamically based on child selection
      populateActivityChildren();
      break;
  }
}

// ========== ACTIVITY DASHBOARD ==========

let selectedActivityChild = null;

function setupActivityDashboard() {
  const enableBtn = document.getElementById('activity-enable-btn');
  if (enableBtn) enableBtn.addEventListener('click', handleActivityEnableTracking);
  
  const disableBtn = document.getElementById('activity-disable-btn');
  if (disableBtn) disableBtn.addEventListener('click', handleActivityDisableTracking);
  
  // Populate with children
  populateActivityChildren();
}

async function populateActivityChildren() {
  activityChildren = [...children];
  activityChildrenCurrentPage = 1;
  activityChildrenSearchQuery = '';
  renderActivityChildren();
}

function renderActivityChildren() {
  const listEl = document.getElementById('activity-children-list');
  const paginationEl = document.getElementById('activity-children-pagination');
  if (!listEl) return;
  
  // Filter children based on search
  let filteredChildren = activityChildren;
  if (activityChildrenSearchQuery) {
    filteredChildren = activityChildren.filter(c =>
      c.username.toLowerCase().includes(activityChildrenSearchQuery.toLowerCase())
    );
  }
  
  if (filteredChildren.length === 0) {
    if (paginationEl) paginationEl.classList.add('hidden');
    
    if (activityChildrenSearchQuery) {
      listEl.innerHTML = `
        <div style="text-align:center; padding:40px 20px; color:var(--gc-text-dim);">
          <div style="font-size:48px; margin-bottom:16px; opacity:0.5;">🔍</div>
          <h3 style="margin-bottom:8px; color:var(--gc-text);">No Children Found</h3>
          <p style="font-size:14px;">No children match "${escapeHtml(activityChildrenSearchQuery)}"</p>
        </div>
      `;
    } else {
      listEl.innerHTML = '<p style="color:var(--gc-text-dim);">No children available. Create a child account first.</p>';
    }
    return;
  }
  
  // Calculate pagination
  const totalPages = Math.ceil(filteredChildren.length / ITEMS_PER_PAGE);
  const startIndex = (activityChildrenCurrentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedChildren = filteredChildren.slice(startIndex, endIndex);
  
  // Update pagination controls
  if (paginationEl && totalPages > 1) {
    paginationEl.classList.remove('hidden');
    const prevBtn = document.getElementById('activity-children-prev-btn');
    const nextBtn = document.getElementById('activity-children-next-btn');
    const pageInfo = document.getElementById('activity-children-page-info');
    
    if (prevBtn) prevBtn.disabled = activityChildrenCurrentPage === 1;
    if (nextBtn) nextBtn.disabled = activityChildrenCurrentPage === totalPages;
    if (pageInfo) pageInfo.textContent = `Page ${activityChildrenCurrentPage} of ${totalPages}`;
  } else if (paginationEl) {
    paginationEl.classList.add('hidden');
  }
  
  // Render children as clickable cards
  listEl.innerHTML = `
    <div class="grid grid-2">
      ${paginatedChildren.map(child => `
        <div class="card" style="cursor:pointer;" data-select-child="${child.id}">
          <h3 class="card-title">${escapeHtml(child.username)}</h3>
          <span class="badge badge-child">child</span>
        </div>
      `).join('')}
    </div>
  `;
  
  // Attach click handlers
  listEl.querySelectorAll('[data-select-child]').forEach(card => {
    card.addEventListener('click', (e) => {
      const childId = parseInt(e.currentTarget.dataset.selectChild);
      handleActivityChildSelect(childId);
    });
  });
}

async function handleActivityChildSelect(childId) {
  if (!childId) {
    hideActivitySections();
    return;
  }
  
  selectedActivityChild = children.find(c => c.id === childId);
  if (!selectedActivityChild) return;
  
  // Load tracking status
  await loadActivityTrackingStatus();
}

function hideActivitySections() {
  const statusDiv = document.getElementById('activity-tracking-status');
  const controlsDiv = document.getElementById('activity-tracking-controls');
  const contentDiv = document.getElementById('activity-dashboard-content');
  const emptyDiv = document.getElementById('activity-empty-state');
  
  if (statusDiv) statusDiv.style.display = 'none';
  if (controlsDiv) controlsDiv.style.display = 'none';
  if (contentDiv) contentDiv.style.display = 'none';
  if (emptyDiv) emptyDiv.classList.add('hidden');
}

async function loadActivityTrackingStatus() {
  try {
    const response = await fetch(`${backendUrl}/activity/settings/${selectedActivityChild.id}`, {
      headers: { 'Authorization': `Bearer ${currentUser.token}` }
    });
    
    if (!response.ok) {
      console.error("[Activity] Failed to load tracking status:", response.status);
      return;
    }
    
    const settings = await response.json();
    
    // Update UI
    const statusDiv = document.getElementById('activity-tracking-status');
    const messageEl = document.getElementById('activity-tracking-message');
    const controlsDiv = document.getElementById('activity-tracking-controls');
    const enableBtn = document.getElementById('activity-enable-btn');
    const disableBtn = document.getElementById('activity-disable-btn');
    const contentDiv = document.getElementById('activity-dashboard-content');
    const emptyDiv = document.getElementById('activity-empty-state');
    
    if (settings.tracking_enabled) {
      statusDiv.style.display = 'block';
      statusDiv.style.background = 'rgba(34, 197, 94, 0.1)';
      statusDiv.style.border = '1px solid rgba(34, 197, 94, 0.3)';
      messageEl.innerHTML = `✅ Activity tracking is enabled for ${settings.child_username}`;
      
      controlsDiv.style.display = 'block';
      enableBtn.style.display = 'none';
      disableBtn.style.display = 'inline-block';
      
      emptyDiv.classList.add('hidden');
      
      // Load dashboard data
      await loadActivityDashboard();
      
    } else {
      statusDiv.style.display = 'block';
      statusDiv.style.background = 'rgba(245, 158, 11, 0.1)';
      statusDiv.style.border = '1px solid rgba(245, 158, 11, 0.3)';
      messageEl.innerHTML = `⚠️ Activity tracking is disabled for ${settings.child_username}<br>
        <small style="font-size:13px;">Enable tracking to see browsing activity insights.</small>`;
      
      controlsDiv.style.display = 'block';
      enableBtn.style.display = 'inline-block';
      disableBtn.style.display = 'none';
      
      contentDiv.style.display = 'none';
      emptyDiv.classList.remove('hidden');
    }
    
  } catch (error) {
    console.error("[Activity] Load tracking status failed:", error);
  }
}

async function handleActivityEnableTracking() {
  try {
    const consent = confirm(`Enable Activity Tracking for ${selectedActivityChild.username}?\n\n` +
      `This will record:\n` +
      `• Domain-level usage (e.g., "youtube.com", minutes per day)\n` +
      `• Basic security signals (CSP/CORS presence)\n\n` +
      `NOT recorded:\n` +
      `• Full URLs, page titles, or messages\n` +
      `• Page content or form data\n\n` +
      `Data is automatically deleted after 3 days.\n` +
      `Your child will be notified about this tracking.`);
    
    if (!consent) return;
    
    const response = await fetch(`${backendUrl}/activity/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentUser.token}`
      },
      body: JSON.stringify({
        child_id: selectedActivityChild.id,
        tracking_enabled: true
      })
    });
    
    if (!response.ok) throw new Error('Failed to enable tracking');
    
    alert(`Activity tracking enabled for ${selectedActivityChild.username}`);
    await loadActivityTrackingStatus();
    await loadChildren(); // Refresh children list to show tracking status
    
  } catch (error) {
    console.error("[Activity] Enable tracking failed:", error);
    alert('Failed to enable tracking. Please try again.');
  }
}

async function handleActivityDisableTracking() {
  try {
    const confirmDisable = confirm(`Disable activity tracking for ${selectedActivityChild.username}?\n\nExisting data will remain until it expires (3 days).`);
    if (!confirmDisable) return;
    
    const response = await fetch(`${backendUrl}/activity/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentUser.token}`
      },
      body: JSON.stringify({
        child_id: selectedActivityChild.id,
        tracking_enabled: false
      })
    });
    
    if (!response.ok) throw new Error('Failed to disable tracking');
    
    alert(`Activity tracking disabled for ${selectedActivityChild.username}`);
    await loadActivityTrackingStatus();
    await loadChildren(); // Refresh children list to show tracking status
    
  } catch (error) {
    console.error("[Activity] Disable tracking failed:", error);
    alert('Failed to disable tracking. Please try again.');
  }
}

async function loadActivityDashboard(days = 7) {
  try {
    console.log("[Activity] Loading dashboard for child:", selectedActivityChild.id);
    const contentDiv = document.getElementById('activity-dashboard-content');
    const emptyDiv = document.getElementById('activity-empty-state');
    
    const response = await fetch(`${backendUrl}/activity/dashboard/${selectedActivityChild.id}?days=${days}`, {
      headers: { 'Authorization': `Bearer ${currentUser.token}` }
    });
    
    console.log("[Activity] Dashboard response status:", response.status);
    
    if (!response.ok) {
      console.error("[Activity] Failed to load dashboard:", response.status);
      contentDiv.style.display = 'none';
      emptyDiv.classList.remove('hidden');
      return;
    }
    
    const data = await response.json();
    console.log("[Activity] Dashboard data received:", data);
    
    if (!data.tracking_enabled) {
      console.warn("[Activity] Tracking not enabled");
      contentDiv.style.display = 'none';
      emptyDiv.classList.remove('hidden');
      return;
    }
    
    // Show dashboard content even if empty (will show "No Activity Yet" message in table)
    contentDiv.style.display = 'block';
    emptyDiv.classList.add('hidden');
    
    const dateRangeEl = document.getElementById('activity-date-range');
    if (dateRangeEl) dateRangeEl.textContent = data.date_range;
    
    console.log("[Activity] Rendering", data.summaries.length, "domain summaries");
    activitySummaries = data.summaries; // Store for filtering/pagination
    activityCurrentPage = 1; // Reset to first page
    activitySearchQuery = ''; // Reset search
    renderActivityTable();
    
  } catch (error) {
    console.error("[Activity] Load dashboard failed:", error);
    const contentDiv = document.getElementById('activity-dashboard-content');
    const emptyDiv = document.getElementById('activity-empty-state');
    if (contentDiv) contentDiv.style.display = 'none';
    if (emptyDiv) emptyDiv.classList.remove('hidden');
  }
}

function renderActivityTable() {
  const container = document.getElementById('activity-table-container');
  const paginationEl = document.getElementById('activity-pagination');
  if (!container) return;
  
  // Filter summaries based on search query
  let filteredSummaries = activitySummaries;
  if (activitySearchQuery) {
    filteredSummaries = activitySummaries.filter(summary =>
      summary.domain.toLowerCase().includes(activitySearchQuery.toLowerCase())
    );
  }
  
  if (filteredSummaries.length === 0) {
    if (paginationEl) paginationEl.classList.add('hidden');
    
    if (activitySearchQuery) {
      container.innerHTML = `
        <div style="text-align:center; padding:40px 20px; color:var(--gc-text-dim);">
          <div style="font-size:48px; margin-bottom:16px; opacity:0.5;">🔍</div>
          <h3 style="margin-bottom:8px; color:var(--gc-text);">No Domains Found</h3>
          <p style="font-size:14px;">No domains match "${escapeHtml(activitySearchQuery)}"</p>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div style="text-align:center; padding:40px 20px; color:var(--gc-text-dim);">
          <div style="font-size:48px; margin-bottom:16px; opacity:0.5;">📭</div>
          <h3 style="margin-bottom:8px; color:var(--gc-text);">No Activity Recorded Yet</h3>
          <p style="font-size:14px; margin-bottom:20px;">Activity data will appear here once the child starts browsing.</p>
          <p style="font-size:13px; background:rgba(99,102,241,0.1); padding:12px; border-radius:8px; display:inline-block;">
            💡 <strong>Tip:</strong> Switch to the child's account and browse some websites to see data populate here.
          </p>
        </div>
      `;
    }
    return;
  }
  
  // Calculate pagination
  const totalPages = Math.ceil(filteredSummaries.length / ITEMS_PER_PAGE);
  const startIndex = (activityCurrentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedSummaries = filteredSummaries.slice(startIndex, endIndex);
  
  // Update pagination controls
  if (paginationEl && totalPages > 1) {
    paginationEl.classList.remove('hidden');
    const prevBtn = document.getElementById('activity-prev-btn');
    const nextBtn = document.getElementById('activity-next-btn');
    const pageInfo = document.getElementById('activity-page-info');
    
    if (prevBtn) prevBtn.disabled = activityCurrentPage === 1;
    if (nextBtn) nextBtn.disabled = activityCurrentPage === totalPages;
    if (pageInfo) pageInfo.textContent = `Page ${activityCurrentPage} of ${totalPages}`;
  } else if (paginationEl) {
    paginationEl.classList.add('hidden');
  }
  
  let html = `
    <table style="width:100%; border-collapse:collapse; margin-top:10px;">
      <thead>
        <tr style="border-bottom:2px solid var(--gc-border); background:rgba(0,0,0,0.2);">
          <th style="padding:14px 12px; text-align:left; font-weight:600; font-size:13px; text-transform:uppercase; letter-spacing:0.5px; color:var(--gc-text-dim);">Domain</th>
          <th style="padding:14px 12px; text-align:left; font-weight:600; font-size:13px; text-transform:uppercase; letter-spacing:0.5px; color:var(--gc-text-dim);">Time Spent</th>
          <th style="padding:14px 12px; text-align:left; font-weight:600; font-size:13px; text-transform:uppercase; letter-spacing:0.5px; color:var(--gc-text-dim);">Today</th>
          <th style="padding:14px 12px; text-align:center; font-weight:600; font-size:13px; text-transform:uppercase; letter-spacing:0.5px; color:var(--gc-text-dim);">Visits</th>
          <th style="padding:14px 12px; text-align:center; font-weight:600; font-size:13px; text-transform:uppercase; letter-spacing:0.5px; color:var(--gc-text-dim);">Blocked</th>
          <th style="padding:14px 12px; text-align:center; font-weight:600; font-size:13px; text-transform:uppercase; letter-spacing:0.5px; color:var(--gc-text-dim);">CSP</th>
          <th style="padding:14px 12px; text-align:center; font-weight:600; font-size:13px; text-transform:uppercase; letter-spacing:0.5px; color:var(--gc-text-dim);">CORS</th>
          <th style="padding:14px 12px; text-align:center; font-weight:600; font-size:13px; text-transform:uppercase; letter-spacing:0.5px; color:var(--gc-text-dim);">Actions</th>
        </tr>
      </thead>
      <tbody>
  `;
  
  for (const summary of paginatedSummaries) {
    const hours = Math.floor(summary.total_time_minutes / 60);
    const minutes = summary.total_time_minutes % 60;
    const timeStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    
    const todayHours = Math.floor(summary.time_spent_today / 60);
    const todayMinutes = summary.time_spent_today % 60;
    const todayStr = todayHours > 0 ? `${todayHours}h ${todayMinutes}m` : `${todayMinutes}m`;
    
    html += `
      <tr class="activity-row" style="border-bottom:1px solid var(--gc-border);">
        <td style="padding:14px 12px; font-weight:500; color:var(--gc-text);">${escapeHtml(summary.domain)}</td>
        <td style="padding:14px 12px; color:var(--gc-text-dim);">${timeStr}</td>
        <td style="padding:14px 12px; color:var(--gc-text-dim);">${todayStr}</td>
        <td style="padding:14px 12px; text-align:center; color:var(--gc-text-dim);">${summary.visit_count}</td>
        <td style="padding:14px 12px; text-align:center;">${summary.blocked_count > 0 ? `<span style="background:rgba(245,158,11,0.2); color:rgb(245,158,11); padding:4px 10px; border-radius:6px; font-size:12px; font-weight:600;">${summary.blocked_count}</span>` : '<span style="color:var(--gc-text-dim);">-</span>'}</td>
        <td style="padding:14px 12px; text-align:center;"><span style="background:${summary.has_csp ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}; color:${summary.has_csp ? 'rgb(34,197,94)' : 'rgb(239,68,68)'}; padding:4px 10px; border-radius:6px; font-size:12px; font-weight:600;">${summary.has_csp ? 'Yes' : 'No'}</span></td>
        <td style="padding:14px 12px; text-align:center;"><span style="background:${summary.has_cors ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}; color:${summary.has_cors ? 'rgb(34,197,94)' : 'rgb(239,68,68)'}; padding:4px 10px; border-radius:6px; font-size:12px; font-weight:600;">${summary.has_cors ? 'Yes' : 'No'}</span></td>
        <td style="padding:14px 12px; text-align:center;">
          <button class="activity-block-btn" data-domain="${escapeHtml(summary.domain)}" style="padding:8px 16px; margin:0 4px; background:rgba(239,68,68,0.15); color:rgb(239,68,68); border:1px solid rgba(239,68,68,0.3); border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; transition:all 0.2s;">Block</button>
          <button class="activity-allow-btn" data-domain="${escapeHtml(summary.domain)}" style="padding:8px 16px; margin:0 4px; background:rgba(34,197,94,0.15); color:rgb(34,197,94); border:1px solid rgba(34,197,94,0.3); border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; transition:all 0.2s;">Allow</button>
        </td>
      </tr>
    `;
  }
  
  html += `
      </tbody>
    </table>
  `;
  
  container.innerHTML = html;
  
  // Add hover effect to rows
  const rows = container.querySelectorAll('.activity-row');
  rows.forEach(row => {
    row.addEventListener('mouseenter', () => {
      row.style.background = 'rgba(99,102,241,0.05)';
    });
    row.addEventListener('mouseleave', () => {
      row.style.background = 'transparent';
    });
  });
  
  // Attach event listeners to buttons
  const blockButtons = container.querySelectorAll('.activity-block-btn');
  blockButtons.forEach(btn => {
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(239,68,68,0.25)';
      btn.style.borderColor = 'rgba(239,68,68,0.5)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'rgba(239,68,68,0.15)';
      btn.style.borderColor = 'rgba(239,68,68,0.3)';
    });
    btn.addEventListener('click', () => {
      const domain = btn.getAttribute('data-domain');
      handleActivityBlockDomain(domain);
    });
  });
  
  const allowButtons = container.querySelectorAll('.activity-allow-btn');
  allowButtons.forEach(btn => {
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(34,197,94,0.25)';
      btn.style.borderColor = 'rgba(34,197,94,0.5)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'rgba(34,197,94,0.15)';
      btn.style.borderColor = 'rgba(34,197,94,0.3)';
    });
    btn.addEventListener('click', () => {
      const domain = btn.getAttribute('data-domain');
      handleActivityAllowDomain(domain);
    });
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function handleActivityBlockDomain(domain) {
  try {
    if (!selectedActivityChild) return;
    
    const confirmBlock = confirm(`Block ${domain} for ${selectedActivityChild.username}?\n\nThis will create a blocklist rule and prevent access to this domain.`);
    if (!confirmBlock) return;
    
    const response = await fetch(`${backendUrl}/activity/actions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentUser.token}`
      },
      body: JSON.stringify({
        child_id: selectedActivityChild.id,
        domain: domain,
        action: 'block',
        target_type: 'child'
      })
    });
    
    if (!response.ok) throw new Error('Failed to block domain');
    
    const result = await response.json();
    alert(result.message);
    
    await loadActivityDashboard();
    
  } catch (error) {
    console.error("[Activity] Block domain failed:", error);
    alert('Failed to block domain. Please try again.');
  }
}

async function handleActivityAllowDomain(domain) {
  try {
    if (!selectedActivityChild) return;
    
    const confirmAllow = confirm(`Allow ${domain} for ${selectedActivityChild.username}?\n\nThis will create an allowlist rule and ensure access to this domain is not blocked.`);
    if (!confirmAllow) return;
    
    const response = await fetch(`${backendUrl}/activity/actions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentUser.token}`
      },
      body: JSON.stringify({
        child_id: selectedActivityChild.id,
        domain: domain,
        action: 'allow',
        target_type: 'child'
      })
    });
    
    if (!response.ok) throw new Error('Failed to allow domain');
    
    const result = await response.json();
    alert(result.message);
    
    await loadActivityDashboard();
    
  } catch (error) {
    console.error("[Activity] Allow domain failed:", error);
    alert('Failed to allow domain. Please try again.');
  }
}

// Make activity functions globally available for onclick handlers
window.handleActivityBlockDomain = handleActivityBlockDomain;
window.handleActivityAllowDomain = handleActivityAllowDomain;

// ========== INITIALIZATION ==========

document.addEventListener('DOMContentLoaded', async () => {
  console.log("[Options] DOM loaded");
  
  const isAuthenticated = await checkAuth();
  if (!isAuthenticated) return;
  
  // Verify PIN before showing options
  const isPINValid = await verifyPINOnLoad();
  if (!isPINValid) return;
  
  setupTabs();
  
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
  
  const saveProfileBtn = document.getElementById('save-profile-btn');
  if (saveProfileBtn) saveProfileBtn.addEventListener('click', saveProfile);
  
  const changePasswordBtn = document.getElementById('change-password-btn');
  if (changePasswordBtn) changePasswordBtn.addEventListener('click', changePassword);
  
  const addChildBtn = document.getElementById('add-child-btn');
  if (addChildBtn) addChildBtn.addEventListener('click', showAddChildModal);
  
  const createChildBtn = document.getElementById('create-child-btn');
  if (createChildBtn) createChildBtn.addEventListener('click', createChild);
  
  const cancelChildBtn = document.getElementById('cancel-child-btn');
  if (cancelChildBtn) cancelChildBtn.addEventListener('click', hideAddChildModal);
  
  const addGroupBtn = document.getElementById('add-group-btn');
  if (addGroupBtn) addGroupBtn.addEventListener('click', showAddGroupModal);
  
  const saveBackendBtn = document.getElementById('save-backend-btn');
  if (saveBackendBtn) saveBackendBtn.addEventListener('click', saveBackendSettings);
  
  const changePINBtn = document.getElementById('change-pin-btn');
  if (changePINBtn) changePINBtn.addEventListener('click', changePIN);
  
  // Activity Dashboard listeners
  setupActivityDashboard();
  
  // Activity children search and pagination
  const activityChildrenSearch = document.getElementById('activity-children-search');
  if (activityChildrenSearch) {
    activityChildrenSearch.addEventListener('input', (e) => {
      activityChildrenSearchQuery = e.target.value;
      activityChildrenCurrentPage = 1;
      renderActivityChildren();
    });
  }
  
  const activityChildrenPrevBtn = document.getElementById('activity-children-prev-btn');
  if (activityChildrenPrevBtn) {
    activityChildrenPrevBtn.addEventListener('click', () => {
      if (activityChildrenCurrentPage > 1) {
        activityChildrenCurrentPage--;
        renderActivityChildren();
      }
    });
  }
  
  const activityChildrenNextBtn = document.getElementById('activity-children-next-btn');
  if (activityChildrenNextBtn) {
    activityChildrenNextBtn.addEventListener('click', () => {
      const filteredChildren = activityChildrenSearchQuery
        ? activityChildren.filter(c => c.username.toLowerCase().includes(activityChildrenSearchQuery.toLowerCase()))
        : activityChildren;
      const totalPages = Math.ceil(filteredChildren.length / ITEMS_PER_PAGE);
      if (activityChildrenCurrentPage < totalPages) {
        activityChildrenCurrentPage++;
        renderActivityChildren();
      }
    });
  }
  
  // Activity search and pagination
  const activitySearch = document.getElementById('activity-search');
  if (activitySearch) {
    activitySearch.addEventListener('input', (e) => {
      activitySearchQuery = e.target.value;
      activityCurrentPage = 1; // Reset to first page
      renderActivityTable();
    });
  }
  
  const activityPrevBtn = document.getElementById('activity-prev-btn');
  if (activityPrevBtn) {
    activityPrevBtn.addEventListener('click', () => {
      if (activityCurrentPage > 1) {
        activityCurrentPage--;
        renderActivityTable();
      }
    });
  }
  
  const activityNextBtn = document.getElementById('activity-next-btn');
  if (activityNextBtn) {
    activityNextBtn.addEventListener('click', () => {
      const filteredSummaries = activitySearchQuery
        ? activitySummaries.filter(s => s.domain.toLowerCase().includes(activitySearchQuery.toLowerCase()))
        : activitySummaries;
      const totalPages = Math.ceil(filteredSummaries.length / ITEMS_PER_PAGE);
      if (activityCurrentPage < totalPages) {
        activityCurrentPage++;
        renderActivityTable();
      }
    });
  }
  
  // Children search and pagination
  const childrenSearch = document.getElementById('children-search');
  if (childrenSearch) {
    childrenSearch.addEventListener('input', (e) => {
      childrenSearchQuery = e.target.value;
      childrenCurrentPage = 1; // Reset to first page
      displayChildren();
    });
  }
  
  const childrenPrevBtn = document.getElementById('children-prev-btn');
  if (childrenPrevBtn) {
    childrenPrevBtn.addEventListener('click', () => {
      if (childrenCurrentPage > 1) {
        childrenCurrentPage--;
        displayChildren();
      }
    });
  }
  
  const childrenNextBtn = document.getElementById('children-next-btn');
  if (childrenNextBtn) {
    childrenNextBtn.addEventListener('click', () => {
      const filteredChildren = childrenSearchQuery 
        ? children.filter(c => c.username.toLowerCase().includes(childrenSearchQuery.toLowerCase()))
        : children;
      const totalPages = Math.ceil(filteredChildren.length / ITEMS_PER_PAGE);
      if (childrenCurrentPage < totalPages) {
        childrenCurrentPage++;
        displayChildren();
      }
    });
  }
  
  // Groups search and pagination
  const groupsSearch = document.getElementById('groups-search');
  if (groupsSearch) {
    groupsSearch.addEventListener('input', (e) => {
      groupsSearchQuery = e.target.value;
      groupsCurrentPage = 1; // Reset to first page
      displayGroups();
    });
  }
  
  const groupsPrevBtn = document.getElementById('groups-prev-btn');
  if (groupsPrevBtn) {
    groupsPrevBtn.addEventListener('click', () => {
      if (groupsCurrentPage > 1) {
        groupsCurrentPage--;
        displayGroups();
      }
    });
  }
  
  const groupsNextBtn = document.getElementById('groups-next-btn');
  if (groupsNextBtn) {
    groupsNextBtn.addEventListener('click', () => {
      const filteredGroups = groupsSearchQuery 
        ? groups.filter(g => g.name.toLowerCase().includes(groupsSearchQuery.toLowerCase()))
        : groups;
      const totalPages = Math.ceil(filteredGroups.length / ITEMS_PER_PAGE);
      if (groupsCurrentPage < totalPages) {
        groupsCurrentPage++;
        displayGroups();
      }
    });
  }
  
  // Rules filter buttons
  const rulesFilterAll = document.getElementById('rules-filter-all');
  const rulesFilterChildren = document.getElementById('rules-filter-children');
  const rulesFilterGroups = document.getElementById('rules-filter-groups');
  
  if (rulesFilterAll) {
    rulesFilterAll.addEventListener('click', () => {
      rulesTargetsFilter = 'all';
      rulesTargetsCurrentPage = 1;
      // Update button styles
      rulesFilterAll.classList.remove('btn-secondary');
      rulesFilterAll.classList.add('btn');
      rulesFilterChildren.classList.remove('btn');
      rulesFilterChildren.classList.add('btn-secondary');
      rulesFilterGroups.classList.remove('btn');
      rulesFilterGroups.classList.add('btn-secondary');
      renderRulesTargets();
    });
  }
  
  if (rulesFilterChildren) {
    rulesFilterChildren.addEventListener('click', () => {
      rulesTargetsFilter = 'child';
      rulesTargetsCurrentPage = 1;
      // Update button styles
      rulesFilterAll.classList.remove('btn');
      rulesFilterAll.classList.add('btn-secondary');
      rulesFilterChildren.classList.remove('btn-secondary');
      rulesFilterChildren.classList.add('btn');
      rulesFilterGroups.classList.remove('btn');
      rulesFilterGroups.classList.add('btn-secondary');
      renderRulesTargets();
    });
  }
  
  if (rulesFilterGroups) {
    rulesFilterGroups.addEventListener('click', () => {
      rulesTargetsFilter = 'group';
      rulesTargetsCurrentPage = 1;
      // Update button styles
      rulesFilterAll.classList.remove('btn');
      rulesFilterAll.classList.add('btn-secondary');
      rulesFilterChildren.classList.remove('btn');
      rulesFilterChildren.classList.add('btn-secondary');
      rulesFilterGroups.classList.remove('btn-secondary');
      rulesFilterGroups.classList.add('btn');
      renderRulesTargets();
    });
  }
  
  // Rules targets search and pagination
  const rulesTargetsSearch = document.getElementById('rules-targets-search');
  if (rulesTargetsSearch) {
    rulesTargetsSearch.addEventListener('input', (e) => {
      rulesTargetsSearchQuery = e.target.value;
      rulesTargetsCurrentPage = 1;
      renderRulesTargets();
    });
  }
  
  const rulesTargetsPrevBtn = document.getElementById('rules-targets-prev-btn');
  if (rulesTargetsPrevBtn) {
    rulesTargetsPrevBtn.addEventListener('click', () => {
      if (rulesTargetsCurrentPage > 1) {
        rulesTargetsCurrentPage--;
        renderRulesTargets();
      }
    });
  }
  
  const rulesTargetsNextBtn = document.getElementById('rules-targets-next-btn');
  if (rulesTargetsNextBtn) {
    rulesTargetsNextBtn.addEventListener('click', () => {
      const filteredTargets = rulesTargetsSearchQuery
        ? rulesTargets.filter(t => t.name.toLowerCase().includes(rulesTargetsSearchQuery.toLowerCase()))
        : rulesTargets;
      const totalPages = Math.ceil(filteredTargets.length / ITEMS_PER_PAGE);
      if (rulesTargetsCurrentPage < totalPages) {
        rulesTargetsCurrentPage++;
        renderRulesTargets();
      }
    });
  }
  
  // Rules list search and pagination
  const rulesListSearch = document.getElementById('rules-list-search');
  if (rulesListSearch) {
    rulesListSearch.addEventListener('input', (e) => {
      rulesListSearchQuery = e.target.value;
      rulesListCurrentPage = 1;
      displayRules();
    });
  }
  
  const rulesListPrevBtn = document.getElementById('rules-list-prev-btn');
  if (rulesListPrevBtn) {
    rulesListPrevBtn.addEventListener('click', () => {
      if (rulesListCurrentPage > 1) {
        rulesListCurrentPage--;
        displayRules();
      }
    });
  }
  
  const rulesListNextBtn = document.getElementById('rules-list-next-btn');
  if (rulesListNextBtn) {
    rulesListNextBtn.addEventListener('click', () => {
      const filteredRules = rulesListSearchQuery
        ? currentRules.filter(r =>
            r.pattern.toLowerCase().includes(rulesListSearchQuery.toLowerCase()) ||
            (r.explanation && r.explanation.toLowerCase().includes(rulesListSearchQuery.toLowerCase())) ||
            r.rule_type.toLowerCase().includes(rulesListSearchQuery.toLowerCase())
          )
        : currentRules;
      const totalPages = Math.ceil(filteredRules.length / ITEMS_PER_PAGE);
      if (rulesListCurrentPage < totalPages) {
        rulesListCurrentPage++;
        displayRules();
      }
    });
  }
  
  loadProfile();
  loadChildren();
  loadGroups();
  loadBackendSettings();
  
  console.log("[Options] Initialization complete");
});

// Additional event listeners for empty state buttons
document.addEventListener('DOMContentLoaded', () => {
  // These need to be attached dynamically when the empty state is shown
  const observer = new MutationObserver(() => {
    const addFirstChildBtn = document.getElementById('add-first-child-btn');
    if (addFirstChildBtn && !addFirstChildBtn.dataset.hasListener) {
      addFirstChildBtn.dataset.hasListener = 'true';
      addFirstChildBtn.addEventListener('click', showAddChildModal);
    }
    
    const addFirstGroupBtn = document.getElementById('add-first-group-btn');
    if (addFirstGroupBtn && !addFirstGroupBtn.dataset.hasListener) {
      addFirstGroupBtn.dataset.hasListener = 'true';
      addFirstGroupBtn.addEventListener('click', showAddGroupModal);
    }
  });
  
  observer.observe(document.body, { childList: true, subtree: true });
});
