# Quick Test Guide - v0.4.3 Bug Fixes

## Test 1: PIN Creation Flow (2 min)

### Steps:
1. **Remove extension** (if already loaded)
   - Go to `chrome://extensions`
   - Click "Remove" on GuardianCore

2. **Clear extension data** (ensure fresh state)
   - Open DevTools Console (F12)
   - Run: `chrome.storage.local.clear()`

3. **Reload extension**
   - Click "Load unpacked"
   - Select `app-extension` folder
   - Pin extension to toolbar

4. **Open Options page**
   - Right-click extension icon → Options
   - Should see: "Create your parent PIN to secure these settings"

5. **Create PIN**
   - Enter PIN: `1234`
   - Click "Create PIN"
   - Should prompt: "Confirm your PIN:"
   - Enter: `1234`
   - **Expected:** Alert shows 10 recovery codes
   - **Expected:** Options page automatically unlocks and shows Settings tab

6. **Verify codes**
   - Go to "Recovery Codes" tab
   - Should see: "10 unused / 0 used (total 10)"
   - Should see table with masked codes

### Success Criteria:
- ✅ PIN creation completes without hanging
- ✅ Recovery codes displayed once in alert
- ✅ Options page unlocks automatically
- ✅ Recovery status shows 10 unused codes

---

## Test 2: XP System (3 min)

### Steps:
1. **Open popup**
   - Click extension icon
   - Check "Your Activity" section

2. **Verify initial state**
   - Level: 1
   - Daily XP: 0
   - Progress bar: empty (0%)
   - "100 XP to next level"

3. **Browse some pages**
   - Navigate to 3-4 different websites (e.g., google.com, github.com)
   - Wait 2-3 seconds after each page load

4. **Check XP updates**
   - Open popup again
   - **Expected:** XP value increased (should be 3-12 depending on trackers/CSP)
   - **Expected:** Progress bar filled proportionally
   - **Expected:** "X XP to next level" updates

5. **Test dev tools** (optional)
   - In popup, press `D` key 5 times quickly
   - Dev panel should appear
   - Click "Simulate Violation (XP Penalty)"
   - **Expected:** XP decreases by 5, status shows "Simulated violation"
   - Click "Reset XP"
   - **Expected:** XP resets to 0, progress bar empties

### Success Criteria:
- ✅ XP increases as you browse
- ✅ Progress bar updates in real-time
- ✅ Remaining XP calculation correct (100 - current XP)
- ✅ Dev tools work (violation penalty, reset)

---

## Test 3: Backend Connection (1 min)

### Steps:
1. **Ensure backend running**
   ```bash
   cd guardiancore
   docker compose up -d
   docker compose logs backend --tail 20
   ```
   - Should see: `INFO: Application startup complete`

2. **Configure in popup**
   - Click extension → Settings tab
   - Backend URL: `http://localhost:8000`
   - API Token: `dev-token-123`
   - Click "Save Settings"

3. **Check audit submission**
   - Navigate to any website
   - Check backend logs: `docker compose logs backend --tail 5`
   - **Expected:** See `audit submit ok` messages

### Success Criteria:
- ✅ Backend starts without errors
- ✅ Audit records submitted successfully
- ✅ No 401/403/500 errors in logs

---

## Test 4: Recovery Codes Download (2 min)

### Steps:
1. **Open Options** → Recovery Codes tab

2. **Regenerate codes**
   - Click "Regenerate Codes"
   - Enter PIN: `1234`
   - Click OK on warning
   - **Expected:** File download prompt appears
   - **Expected:** File named like `guardian_recovery_codes_20251004_XXXXX.txt`

3. **Open downloaded file**
   - Should contain:
     - Header with batch ID and date
     - 10 codes in format `XXXX-XXXX-XXXX`
     - Warning to store securely

4. **Verify in Recovery tab**
   - Should show new batch with 10 unused codes
   - Old batch should be gone (or marked inactive)

### Success Criteria:
- ✅ Download triggers after PIN verification
- ✅ File contains 10 valid codes
- ✅ Recovery status updates immediately
- ✅ Old codes invalidated

---

## Known Issues Fixed:
- ❌ **BEFORE:** PIN creation hung after entering PIN
- ✅ **AFTER:** PIN creation completes and unlocks options page

- ❌ **BEFORE:** Recovery codes didn't download
- ✅ **AFTER:** Recovery codes download as .txt file

- ❌ **BEFORE:** XP stayed at 0 no matter how much browsing
- ✅ **AFTER:** XP increases on every navigation

- ❌ **BEFORE:** Backend logs showed "Attaching to backend-1, db-1" and stopped
- ✅ **AFTER:** Backend runs normally, logs show audit submissions

---

## Troubleshooting:

### PIN creation still hangs:
```javascript
// Open options page, press F12, check Console for errors
// Look for: [Options] Script starting...
// If you see "Crypto module loaded: undefined" → crypto.js didn't load
```

### XP not updating:
```javascript
// Open popup, press F12
// Look for: [Popup] XP state request
// Open background service worker console (chrome://extensions → "service worker")
// Look for: "GuardianCore Audit Probe v0.4.3 loaded"
// If version is v0.4.0, extension didn't reload
```

### Recovery codes error:
```javascript
// Console should show: batch with plaintext codes temporarily
// After alert, plaintext should be deleted from storage
// Check: chrome.storage.local.get('recovery_batches', console.log)
// codes[].plaintext should be undefined
```

---

## Clean Slate Reset (if needed):
```javascript
// Open any page, F12 console:
chrome.storage.local.clear()
// Then reload extension:
// chrome://extensions → click reload icon on GuardianCore
```
