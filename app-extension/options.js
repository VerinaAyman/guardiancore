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
let backendUrl = 'http://localhost:8000';

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
        defaults.gc_backend_url = 'http://localhost:8000';
        storage.gc_backend_url = 'http://localhost:8000';
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
  if (!setupPIN || setupPIN.length < 4) {
    alert('PIN must be at least 4 digits. Please try again.');
    return showPINSetup();
  }
  
  const confirmPIN = prompt('Confirm your PIN:');
  if (setupPIN !== confirmPIN) {
    alert('PINs do not match. Please try again.');
    return showPINSetup();
  }
  
  // Generate 10 recovery codes
  recoveryCodes = generateRecoveryCodes(10);
  
  // Store PIN and recovery codes
  await chrome.storage.local.set({
    gc_pin: setupPIN,
    gc_recovery_codes: recoveryCodes
  });
  
  pin = setupPIN;
  
  // Download recovery codes
  downloadRecoveryCodes(recoveryCodes, 'guardiancore-recovery-codes-initial.txt');
  
  alert(`PIN set successfully!\n\nYour 10 Recovery Codes have been downloaded.\n\nSave this file in a secure location!`);
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
  
  // Generate new codes
  const newCodes = generateRecoveryCodes(10);
  
  // Store new codes and expire old ones
  await chrome.storage.local.set({
    gc_recovery_codes: newCodes
  });
  
  recoveryCodes = newCodes;
  
  // Download new codes
  downloadRecoveryCodes(newCodes, `guardiancore-recovery-codes-${Date.now()}.txt`);
  
  alert('New Recovery Codes Generated!\n\nThe file has been downloaded.\n\nOld codes are now invalid. Save the new file!');
  
  displayRecoveryCodes();
}

async function displayRecoveryCodes() {
  const storage = await chrome.storage.local.get(['gc_recovery_codes', 'gc_pin']);
  recoveryCodes = storage.gc_recovery_codes || [];
  pin = storage.gc_pin || null;
  
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
  if (!newPIN || newPIN.length < 4) {
    alert('PIN must be at least 4 digits.');
    return;
  }
  
  const confirmNewPIN = prompt('Confirm new PIN:');
  if (newPIN !== confirmNewPIN) {
    alert('PINs do not match.');
    return;
  }
  
  await chrome.storage.local.set({ gc_pin: newPIN });
  pin = newPIN;
  
  alert('PIN changed successfully!');
  displayRecoveryCodes();
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
  
  if (!listEl) return;
  
  if (children.length === 0) {
    listEl.innerHTML = '';
    if (emptyEl) emptyEl.classList.remove('hidden');
    return;
  }
  
  if (emptyEl) emptyEl.classList.add('hidden');
  
  listEl.innerHTML = children.map(child => `
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
  
  if (!listEl) return;
  
  if (groups.length === 0) {
    listEl.innerHTML = '';
    if (emptyEl) emptyEl.classList.remove('hidden');
    return;
  }
  
  if (emptyEl) emptyEl.classList.add('hidden');
  
  listEl.innerHTML = groups.map(group => `
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
  
  const memberIds = new Set(currentMembers.map(m => m.id));
  
  // Create modal
  const modal = document.createElement('div');
  modal.id = 'group-members-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:1000;';
  
  modal.innerHTML = `
    <div style="background:var(--gc-panel);border:1px solid var(--gc-border);border-radius:14px;padding:24px;max-width:500px;width:90%;">
      <h3 style="margin:0 0 16px;font-size:18px;">Manage Members: ${escapeHtml(group.name)}</h3>
      
      ${currentMembers.length > 0 ? `
        <div style="margin-bottom:16px;">
          <h4 style="margin:0 0 8px;font-size:14px;color:var(--gc-text-dim);">Current Members</h4>
          <div id="current-members" style="max-height:150px;overflow-y:auto;margin-bottom:16px;">
            ${currentMembers.map(member => `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:8px;border-bottom:1px solid var(--gc-border);">
                <span>✓ ${escapeHtml(member.username)}</span>
                <button class="btn btn-sm" style="background:var(--gc-danger);color:white;" data-remove-member="${groupId}" data-child-id="${member.id}">
                  Remove
                </button>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
      
      <h4 style="margin:0 0 8px;font-size:14px;color:var(--gc-text-dim);">Available Children</h4>
      <div id="members-selection" style="max-height:200px;overflow-y:auto;margin-bottom:16px;">
        ${children.filter(child => !memberIds.has(child.id)).map(child => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:8px;border-bottom:1px solid var(--gc-border);">
            <span>${escapeHtml(child.username)}</span>
            <button class="btn btn-sm" data-add-member="${groupId}" data-child-id="${child.id}">
              Add
            </button>
          </div>
        `).join('') || '<p style="color:var(--gc-text-dim);font-size:12px;text-align:center;padding:16px;">All children are already members</p>'}
      </div>
      <button class="btn btn-secondary" id="close-members-modal">Close</button>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Attach close handler
  document.getElementById('close-members-modal').addEventListener('click', () => {
    modal.remove();
  });
  
  // Attach add handlers
  modal.querySelectorAll('[data-add-member]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const groupId = e.target.dataset.addMember;
      const childId = e.target.dataset.childId;
      const button = e.target;
      
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
        
        button.textContent = '✓ Added';
        
        // Reload modal to show updated members
        setTimeout(async () => {
          modal.remove();
          await loadGroups(); // Refresh group count
          showGroupMembersModal(groupId);
        }, 500);
      } catch (error) {
        console.error("[Groups] Add member failed:", error);
        button.disabled = false;
        button.textContent = 'Add';
        alert('Failed to add member to group');
      }
    });
  });
  
  // Attach remove handlers
  modal.querySelectorAll('[data-remove-member]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const groupId = e.target.dataset.removeMember;
      const childId = e.target.dataset.childId;
      const button = e.target;
      
      if (!confirm('Remove this child from the group?')) return;
      
      try {
        button.disabled = true;
        button.textContent = 'Removing...';
        
        const response = await fetch(`${backendUrl}/accounts/groups/${groupId}/members/${childId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${currentUser.token}` }
        });
        
        if (!response.ok) throw new Error('Failed to remove member');
        
        // Reload modal to show updated members
        modal.remove();
        await loadGroups(); // Refresh group count
        showGroupMembersModal(groupId);
      } catch (error) {
        console.error("[Groups] Remove member failed:", error);
        button.disabled = false;
        button.textContent = 'Remove';
        alert('Failed to remove member from group');
      }
    });
  });
}

// ========== RULES MANAGEMENT ==========

async function loadRulesTargets() {
  const targetsEl = document.getElementById('rules-targets');
  if (!targetsEl) return;
  
  const targets = [
    ...children.map(c => ({ type: 'child', id: c.id, name: c.username })),
    ...groups.map(g => ({ type: 'group', id: g.id, name: g.name }))
  ];
  
  if (targets.length === 0) {
    targetsEl.innerHTML = '<p style="color:var(--gc-text-dim);">Create a child account or group first.</p>';
    return;
  }
  
  targetsEl.innerHTML = `
    <div class="grid grid-2">
      ${targets.map(target => `
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
    displayRules(rules, targetType, targetId, targetName);
  } catch (error) {
    console.error("[Rules] Load failed:", error);
    alert('Failed to load rules');
  }
}

function displayRules(rules, targetType, targetId, targetName) {
  const rulesListEl = document.getElementById('rules-list');
  if (!rulesListEl) return;
  
  rulesListEl.classList.remove('hidden');
  
  rulesListEl.innerHTML = `
    <div class="section-header">
      <h2 class="section-title">Rules for ${escapeHtml(targetName)}</h2>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-sm" data-add-rule="${targetType}" data-target-id="${targetId}" data-target-name="${escapeHtml(targetName)}">+ Add Rule</button>
        <button class="btn btn-sm btn-secondary" data-export-rules="${targetType}" data-target-id="${targetId}" data-target-name="${escapeHtml(targetName)}">Export Rules</button>
        <button class="btn btn-sm btn-secondary" data-import-rules="${targetType}" data-target-id="${targetId}" data-target-name="${escapeHtml(targetName)}">Import Rules</button>
        <button class="btn btn-sm btn-secondary" data-back-rules>← Back</button>
      </div>
    </div>
    
    ${rules.length === 0 ? `
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <p>No rules defined yet</p>
        <button class="btn" data-add-rule="${targetType}" data-target-id="${targetId}" data-target-name="${escapeHtml(targetName)}">Create First Rule</button>
      </div>
    ` : `
      ${rules.map(rule => `
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
  rulesListEl.querySelectorAll('[data-add-rule]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const type = e.target.dataset.addRule;
      const id = e.target.dataset.targetId;
      const name = e.target.dataset.targetName;
      showAddRuleModal(type, id, name);
    });
  });
  
  rulesListEl.querySelectorAll('[data-export-rules]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const type = e.target.dataset.exportRules;
      const id = e.target.dataset.targetId;
      const name = e.target.dataset.targetName;
      exportRules(type, id, name);
    });
  });
  
  rulesListEl.querySelectorAll('[data-import-rules]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const type = e.target.dataset.importRules;
      const id = e.target.dataset.targetId;
      const name = e.target.dataset.targetName;
      importRules(type, id, name);
    });
  });
  
  rulesListEl.querySelectorAll('[data-back-rules]').forEach(btn => {
    btn.addEventListener('click', () => {
      loadRulesTargets();
      rulesListEl.classList.add('hidden');
    });
  });
  
  rulesListEl.querySelectorAll('[data-toggle-rule]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const ruleId = e.target.dataset.toggleRule;
      const enabled = e.target.dataset.enabled === 'true';
      const type = e.target.dataset.type;
      const id = e.target.dataset.id;
      const name = e.target.dataset.name;
      toggleRule(ruleId, enabled, type, id, name);
    });
  });
  
  rulesListEl.querySelectorAll('[data-delete-rule]').forEach(btn => {
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
        <div style="display:flex;gap:12px;align-items:center;">
          <select id="time-start" style="flex:1;padding:12px 14px;border:2px solid var(--gc-border);border-radius:12px;background:rgba(15,23,42,0.8);color:var(--gc-text);font-size:14px;cursor:pointer;">
            ${generateTimeOptions()}
          </select>
          <span style="color:var(--gc-text-dim);font-weight:600;">to</span>
          <select id="time-end" style="flex:1;padding:12px 14px;border:2px solid var(--gc-border);border-radius:12px;background:rgba(15,23,42,0.8);color:var(--gc-text);font-size:14px;cursor:pointer;">
            ${generateTimeOptions()}
          </select>
        </div>
        <p style="margin-top:6px;font-size:12px;color:var(--gc-text-dim);">Select start and end times for the restriction</p>
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
      options.push(`<option value="${timeStr}">${timeStr}</option>`);
    }
  }
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
  }
}

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
