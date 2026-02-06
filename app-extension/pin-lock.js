// GuardianCore PIN Lock Page
console.log("[PIN Lock] Initializing...");

let failedAttempts = 0;
const MAX_ATTEMPTS = 5;

// Get elements
const pinView = document.getElementById('view-pin');
const recoveryView = document.getElementById('view-recovery');
const pinInput = document.getElementById('pin-input');
const unlockBtn = document.getElementById('unlock-btn');
const errorMsg = document.getElementById('error-msg');
const attemptsWarning = document.getElementById('attempts-warning');
const showRecoveryBtn = document.getElementById('show-recovery-btn');

const recoveryCodeInput = document.getElementById('recovery-code-input');
const newPinInput = document.getElementById('new-pin-input');
const confirmPinInput = document.getElementById('confirm-pin-input');
const resetPinBtn = document.getElementById('reset-pin-btn');
const backToPinBtn = document.getElementById('back-to-pin-btn');
const recoveryErrorMsg = document.getElementById('recovery-error-msg');

// Focus PIN input on load
pinInput.focus();

// Handle PIN unlock
async function handleUnlock() {
  const enteredPin = pinInput.value.trim();
  
  if (!enteredPin) {
    showError('Please enter your PIN');
    return;
  }
  
  if (enteredPin.length < 4) {
    showError('PIN must be at least 4 digits');
    return;
  }
  
  try {
    unlockBtn.disabled = true;
    unlockBtn.textContent = 'Verifying...';
    
    // Get stored PIN
    const storage = await chrome.storage.local.get(['gc_pin']);
    
    if (!storage.gc_pin) {
      // No PIN set, redirect to setup (should not happen)
      window.location.href = 'options.html';
      return;
    }
    
    if (enteredPin === storage.gc_pin) {
      // Correct PIN!
      unlockBtn.textContent = '✓ Unlocked';
      errorMsg.classList.remove('show');
      
      // Store verification flag
      await chrome.storage.local.set({ gc_pin_verified: true });
      
      // Redirect to options page
      setTimeout(() => {
        window.location.href = 'options.html';
      }, 500);
    } else {
      // Wrong PIN
      failedAttempts++;
      
      if (failedAttempts >= MAX_ATTEMPTS) {
        showError('Too many failed attempts. Please use a recovery code.');
        unlockBtn.disabled = true;
        pinInput.disabled = true;
      } else {
        showError(`Incorrect PIN. ${MAX_ATTEMPTS - failedAttempts} attempts remaining.`);
        pinInput.value = '';
        pinInput.focus();
        
        if (failedAttempts >= 3) {
          attemptsWarning.textContent = `⚠️ Warning: ${MAX_ATTEMPTS - failedAttempts} attempts left before lockout`;
          attemptsWarning.style.display = 'block';
        }
      }
      
      unlockBtn.disabled = false;
      unlockBtn.textContent = 'Unlock';
    }
  } catch (error) {
    console.error('[PIN Lock] Verification failed:', error);
    showError('Verification failed. Please try again.');
    unlockBtn.disabled = false;
    unlockBtn.textContent = 'Unlock';
  }
}

// Show error message
function showError(message) {
  errorMsg.textContent = message;
  errorMsg.classList.add('show');
  setTimeout(() => {
    errorMsg.classList.remove('show');
  }, 3000);
}

// Show recovery error
function showRecoveryError(message) {
  recoveryErrorMsg.textContent = message;
  recoveryErrorMsg.classList.add('show');
  setTimeout(() => {
    recoveryErrorMsg.classList.remove('show');
  }, 3000);
}

// Toggle to recovery view
function showRecoveryView() {
  pinView.style.display = 'none';
  recoveryView.classList.add('active');
  recoveryCodeInput.focus();
}

// Toggle back to PIN view
function showPinView() {
  recoveryView.classList.remove('active');
  pinView.style.display = 'block';
  pinInput.value = '';
  pinInput.focus();
  recoveryCodeInput.value = '';
  newPinInput.value = '';
  confirmPinInput.value = '';
}

// Handle PIN reset with recovery code
async function handlePinReset() {
  const recoveryCode = recoveryCodeInput.value.trim().toUpperCase();
  const newPin = newPinInput.value.trim();
  const confirmPin = confirmPinInput.value.trim();
  
  // Validation
  if (!recoveryCode) {
    showRecoveryError('Please enter a recovery code');
    return;
  }
  
  if (recoveryCode.length !== 8) {
    showRecoveryError('Recovery code must be 8 characters');
    return;
  }
  
  if (!newPin) {
    showRecoveryError('Please enter a new PIN');
    return;
  }
  
  if (newPin.length < 4) {
    showRecoveryError('PIN must be at least 4 digits');
    return;
  }
  
  if (newPin !== confirmPin) {
    showRecoveryError('PINs do not match');
    return;
  }
  
  try {
    resetPinBtn.disabled = true;
    resetPinBtn.textContent = 'Resetting...';
    
    // Get stored data
    const storage = await chrome.storage.local.get(['gc_recovery_codes', 'gc_backend_url', 'gc_email']);
    let recoveryCodes = storage.gc_recovery_codes || [];
    const backendUrl = storage.gc_backend_url;
    const email = storage.gc_email;
    
    // Check if code is valid locally first
    if (!recoveryCodes.includes(recoveryCode)) {
      showRecoveryError('Invalid or already used recovery code');
      resetPinBtn.disabled = false;
      resetPinBtn.textContent = 'Reset PIN';
      return;
    }
    
    // Call backend to reset PIN with recovery code
    if (backendUrl && email) {
      try {
        const response = await fetch(`${backendUrl}/auth/reset-pin-only`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email,
            recovery_code: recoveryCode,
            new_pin: newPin
          })
        });
        
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.detail || 'Failed to reset PIN');
        }
        
        const data = await response.json();
        
        // Update local storage with new PIN and remaining recovery codes
        const remainingCodes = recoveryCodes.filter(code => code !== recoveryCode);
        await chrome.storage.local.set({
          gc_pin: newPin,
          gc_recovery_codes: remainingCodes,
          gc_pin_verified: true
        });
        
        resetPinBtn.textContent = '✓ PIN Reset!';
        
        // Redirect to options page
        setTimeout(() => {
          window.location.href = 'options.html';
        }, 1000);
        
      } catch (error) {
        console.error('[PIN Lock] Backend reset failed:', error);
        showRecoveryError(error.message || 'Failed to reset PIN on server');
        resetPinBtn.disabled = false;
        resetPinBtn.textContent = 'Reset PIN';
      }
    } else {
      // Fallback to local-only update (shouldn't happen normally)
      const remainingCodes = recoveryCodes.filter(code => code !== recoveryCode);
      await chrome.storage.local.set({
        gc_pin: newPin,
        gc_recovery_codes: remainingCodes,
        gc_pin_verified: true
      });
      
      resetPinBtn.textContent = '✓ PIN Reset!';
      setTimeout(() => {
        window.location.href = 'options.html';
      }, 1000);
    }
    
  } catch (error) {
    console.error('[PIN Lock] Reset failed:', error);
    showRecoveryError('Reset failed. Please try again.');
    resetPinBtn.disabled = false;
    resetPinBtn.textContent = 'Reset PIN';
  }
}

// Event listeners
unlockBtn.addEventListener('click', handleUnlock);
showRecoveryBtn.addEventListener('click', showRecoveryView);
backToPinBtn.addEventListener('click', showPinView);
resetPinBtn.addEventListener('click', handlePinReset);

// Enter key handlers
pinInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') handleUnlock();
});

confirmPinInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') handlePinReset();
});

// Only allow digits in PIN inputs
[pinInput, newPinInput, confirmPinInput].forEach(input => {
  input.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/[^0-9]/g, '');
  });
});

// Only allow alphanumeric in recovery code
recoveryCodeInput.addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});
