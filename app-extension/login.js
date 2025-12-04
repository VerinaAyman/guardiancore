// GuardianCore Login - Parent and Child Authentication
console.log("[Login] Script starting...");

// Switch between login types
document.querySelectorAll('.type-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.type;
    
    // Update active button
    document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    // Show corresponding form
    document.querySelectorAll('.login-form').forEach(form => form.classList.remove('active'));
    if (type === 'parent') {
      document.getElementById('parent-form').classList.add('active');
    } else {
      document.getElementById('child-form').classList.add('active');
    }
    
    // Clear all statuses
    document.querySelectorAll('.status').forEach(s => {
      s.classList.remove('visible', 'status-success', 'status-error');
      s.textContent = '';
    });
  });
});

// Toggle between login and register
document.getElementById('show-register')?.addEventListener('click', () => {
  document.getElementById('parent-form').classList.remove('active');
  document.getElementById('register-form').classList.add('active');
  clearStatus('parent-status');
});

document.getElementById('show-login')?.addEventListener('click', () => {
  document.getElementById('register-form').classList.remove('active');
  document.getElementById('parent-form').classList.add('active');
  clearStatus('register-status');
});

document.getElementById('show-forgot-password')?.addEventListener('click', () => {
  document.getElementById('parent-form').classList.remove('active');
  document.getElementById('forgot-password-form').classList.add('active');
  clearStatus('parent-status');
});

document.getElementById('back-to-login')?.addEventListener('click', () => {
  document.getElementById('forgot-password-form').classList.remove('active');
  document.getElementById('parent-form').classList.add('active');
  clearStatus('forgot-status');
});

// Parent Login
document.getElementById('parent-login-btn')?.addEventListener('click', async () => {
  const email = document.getElementById('parent-email').value.trim();
  const password = document.getElementById('parent-password').value;
  
  if (!email || !password) {
    showStatus('parent-status', 'Please enter email and password', 'error');
    return;
  }
  
  const btn = document.getElementById('parent-login-btn');
  btn.disabled = true;
  btn.textContent = 'Signing in...';
  
  try {
    const { gc_backend_url } = await chrome.storage.local.get('gc_backend_url');
    const backendUrl = gc_backend_url || 'https://guardiancore.onrender.com';
    
    const response = await fetch(`${backendUrl}/auth/parent/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Login failed');
    }
    
    const data = await response.json();
    
        // Store authentication
    await chrome.storage.local.set({
      gc_auth_token: data.token,
      gc_user_id: data.user_id,
      gc_account_type: data.account_type,
      gc_username: data.username,
      gc_email: data.email || email
    });
    
    // Fetch PIN and recovery codes from server (for new device sync)
    try {
      const pinResponse = await fetch(`${backendUrl}/accounts/pin/fetch`, {
        method: 'GET',
        headers: { 
          'Authorization': `Bearer ${data.token}`
        }
      });
      
      if (pinResponse.ok) {
        const pinData = await pinResponse.json();
        if (pinData.has_pin && pinData.pin) {
          // Sync PIN and recovery codes to local storage
          await chrome.storage.local.set({
            gc_pin: pinData.pin,
            gc_recovery_codes: pinData.recovery_codes || []
          });
          console.log('[Login] PIN synced from server');
        } else {
          // IMPORTANT: Clear any existing local PIN since server has none
          // This prevents old account's PIN from being used on a new account
          await chrome.storage.local.remove(['gc_pin', 'gc_recovery_codes', 'gc_pin_verified']);
          console.log('[Login] No PIN set on server - cleared local PIN, will prompt for setup');
        }
      }
    } catch (pinError) {
      console.warn('[Login] Failed to fetch PIN from server:', pinError);
      // Continue with login even if PIN fetch fails
    }
    
    // Notify background service worker to reload authentication
    try {
      await chrome.runtime.sendMessage({ type: "AUTH_UPDATED" });
    } catch (e) {
      console.warn('[Login] Failed to notify background:', e);
    }
    
    showStatus('login-status', '✅ Login successful! Redirecting...', 'success');
    
    // Redirect to options page
    setTimeout(() => {
      chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
      window.close();
    }, 1000);
    
  } catch (error) {
    console.error('[Login] Parent login error:', error);
    showStatus('parent-status', `Login failed: ${error.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
});

// Parent Register
document.getElementById('register-btn')?.addEventListener('click', async () => {
  const username = document.getElementById('register-username').value.trim();
  const email = document.getElementById('register-email').value.trim();
  const password = document.getElementById('register-password').value;
  
  if (!username || !email || !password) {
    showStatus('register-status', 'Please fill all fields', 'error');
    return;
  }
  
  if (password.length < 8) {
    showStatus('register-status', 'Password must be at least 8 characters', 'error');
    return;
  }
  
  const btn = document.getElementById('register-btn');
  btn.disabled = true;
  btn.textContent = 'Creating account...';
  
  try {
    const { gc_backend_url } = await chrome.storage.local.get('gc_backend_url');
    const backendUrl = gc_backend_url || 'https://guardiancore.onrender.com';
    
    const response = await fetch(`${backendUrl}/auth/parent/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Registration failed');
    }
    
    const data = await response.json();
    
    // IMPORTANT: Clear any existing PIN data from previous accounts
    // New accounts must set up their own PIN
    await chrome.storage.local.remove(['gc_pin', 'gc_recovery_codes', 'gc_pin_verified']);
    
    // Store authentication data
    await chrome.storage.local.set({
      gc_auth_token: data.token,
      gc_user_id: data.user_id,
      gc_account_type: data.account_type,
      gc_username: data.username,
      gc_email: data.email
    });
    
    showStatus('register-status', '✅ Account created! Redirecting...', 'success');
    
    // Redirect to options page
    setTimeout(() => {
      chrome.runtime.openOptionsPage();
      window.close();
    }, 1000);
    
  } catch (error) {
    console.error('[Login] Register error:', error);
    showStatus('register-status', `Registration failed: ${error.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Account';
  }
});

// Forgot Password - Reset using Recovery Code (password only, PIN reset is separate)
document.getElementById('forgot-password-btn')?.addEventListener('click', async () => {
  const email = document.getElementById('forgot-email').value.trim();
  const recoveryCode = document.getElementById('recovery-code').value.trim().toUpperCase();
  const newPassword = document.getElementById('forgot-new-password').value;
  
  if (!email || !recoveryCode) {
    showStatus('forgot-status', 'Please enter email and recovery code', 'error');
    return;
  }
  
  if (!newPassword || newPassword.length < 8) {
    showStatus('forgot-status', 'New password must be at least 8 characters', 'error');
    return;
  }
  
  const btn = document.getElementById('forgot-password-btn');
  btn.disabled = true;
  btn.textContent = 'Resetting...';
  
  try {
    const { gc_backend_url } = await chrome.storage.local.get('gc_backend_url');
    const backendUrl = gc_backend_url || 'https://guardiancore.onrender.com';
    
    const response = await fetch(`${backendUrl}/auth/reset-password-only`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        email, 
        recovery_code: recoveryCode,
        new_password: newPassword
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Reset failed');
    }
    
    const data = await response.json();
    
    showStatus('forgot-status', '✅ Password reset successfully! You can now sign in.', 'success');
    
    // Clear form
    document.getElementById('forgot-email').value = '';
    document.getElementById('recovery-code').value = '';
    document.getElementById('forgot-new-password').value = '';
    
    // Redirect to login after 2 seconds
    setTimeout(() => {
      document.getElementById('forgot-password-form').classList.remove('active');
      document.getElementById('parent-form').classList.add('active');
      clearStatus('forgot-status');
    }, 2000);
    
  } catch (error) {
    console.error('[Login] Forgot password error:', error);
    showStatus('forgot-status', `Reset failed: ${error.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Reset Password';
  }
});

// Child Login
document.getElementById('child-login-btn')?.addEventListener('click', async () => {
  const code = document.getElementById('child-code').value.trim();
  
  if (!code || code.length !== 6 || !/^\d{6}$/.test(code)) {
    showStatus('child-status', 'Please enter a valid 6-digit code', 'error');
    return;
  }
  
  const btn = document.getElementById('child-login-btn');
  btn.disabled = true;
  btn.textContent = 'Signing in...';
  
  try {
    const { gc_backend_url } = await chrome.storage.local.get('gc_backend_url');
    const backendUrl = gc_backend_url || 'https://guardiancore.onrender.com';
    
    const response = await fetch(`${backendUrl}/auth/child/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_code: code })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Login failed');
    }
    
    const data = await response.json();
    
    // Store authentication data
    await chrome.storage.local.set({
      gc_auth_token: data.token,
      gc_user_id: data.user_id,
      gc_account_type: data.account_type,
      gc_username: data.username
    });
    
    // Notify background service worker to reload authentication
    try {
      await chrome.runtime.sendMessage({ type: "AUTH_UPDATED" });
    } catch (e) {
      console.warn('[Login] Failed to notify background:', e);
    }
    
    showStatus('child-status', '✅ Login successful! Redirecting...', 'success');
    
    // Redirect to child options page
    setTimeout(() => {
      chrome.tabs.create({ url: chrome.runtime.getURL('child-options.html') });
      window.close();
    }, 1000);
    
  } catch (error) {
    console.error('[Login] Child login error:', error);
    showStatus('child-status', `Login failed: ${error.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
});

// Handle Enter key
['parent-email', 'parent-password'].forEach(id => {
  document.getElementById(id)?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('parent-login-btn')?.click();
  });
});

['register-username', 'register-email', 'register-password'].forEach(id => {
  document.getElementById(id)?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('register-btn')?.click();
  });
});

document.getElementById('child-code')?.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('child-login-btn')?.click();
});

// Auto-format child code (add visual spacing)
document.getElementById('child-code')?.addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
});

// Auto-format recovery code
document.getElementById('recovery-code')?.addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
});

// Handle Enter key for forgot password form
['forgot-email', 'recovery-code', 'forgot-new-password'].forEach(id => {
  document.getElementById(id)?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('forgot-password-btn')?.click();
  });
});

// Helper functions
function showStatus(elementId, message, type) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = message;
  el.className = `status visible status-${type}`;
}

function clearStatus(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.className = 'status';
  el.textContent = '';
}

// Check if already logged in
async function checkAuth() {
  const { gc_auth_token, gc_account_type } = await chrome.storage.local.get([
    'gc_auth_token',
    'gc_account_type'
  ]);
  
  if (gc_auth_token) {
    console.log('[Login] Already authenticated as', gc_account_type);
    // Redirect to appropriate page
    if (gc_account_type === 'parent') {
      chrome.runtime.openOptionsPage();
    } else {
      chrome.tabs.create({ url: chrome.runtime.getURL('child-options.html') });
    }
    window.close();
  }
}

// Check on load
checkAuth();
