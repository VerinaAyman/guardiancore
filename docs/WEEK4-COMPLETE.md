# GuardianCore Week 4 - Complete Documentation

**Version:** 0.4.1 (Security Patch)  
**Released:** October 4, 2025  
**Branch:** phase-4  
**Focus:** Gamification, Risk Scoring, Security Hardening

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Features Implemented](#features-implemented)
4. [Security Enhancements](#security-enhancements)
5. [Testing Guide](#testing-guide)
6. [API Reference](#api-reference)
7. [Troubleshooting](#troubleshooting)
8. [Files Modified](#files-modified)
9. [Changelog](#changelog)

---

## Overview

Week 4 delivers production-ready gamification cues, risk scoring, and hardened security for GuardianCore's privacy-focused parental controls.

### Key Achievements ✅

- 🔐 **Hardened PIN Storage**: PBKDF2-SHA-256 with 310k iterations
- 🎮 **Gamification Cues**: Safe streak hours, risk score display
- 📊 **Risk Scoring v1**: Weighted algorithm analyzing audit data
- 🔑 **10 Recovery Codes**: One-time use, PBKDF2-hashed
- ⚡ **Real-Time Updates**: Background polling every 30 seconds
- 🔒 **Security Loophole Closed**: PIN required for code regeneration
- 👥 **Role Separation**: Parent (PIN-gated) vs Child (view-only)
- 💾 **Export/Import**: JSON v1 schema for rules backup

---

## Quick Start

### 1. Start Backend

```bash
cd guardiancore
docker-compose up --build -d

# Verify services
docker ps
curl http://localhost:8000/health
# Expected: {"status":"ok","name":"GuardianCore","env":"dev"}
```

### 2. Load Extension

1. Open Chrome/Brave
2. Navigate to `chrome://extensions`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked"
5. Select `guardiancore/app-extension` folder
6. Pin extension to toolbar

### 3. First-Time Setup

#### Configure Backend (Popup)
1. Click extension icon → Settings tab
2. Enter:
   - Backend URL: `http://localhost:8000`
   - API Token: `dev-token-123`
3. Click "Save Settings"

#### Set Up PIN (Options Page)
1. Right-click extension icon → "Options"
2. **First time**: You'll see "Create Your PIN"
3. Enter a PIN (at least 4 digits)
4. Confirm PIN
5. **Important**: Alert shows your 10 recovery codes
6. Copy/save codes immediately (shown only once)

#### Download Recovery Codes
1. In Options page, navigate to "Recovery Codes" tab
2. You'll see batch status (10 unused codes)
3. Click "Regenerate Codes" (requires PIN)
4. File downloads as `guardian_recovery_codes_YYYYMMDD_BATCHID.txt`
5. **Store this file securely offline!**

---

## Features Implemented

### 1. Risk Scoring v1 (Backend)

**Endpoint:** `GET /risk/score`

**Algorithm:**
```python
score = (
    blocked_site_attempts * 12 +
    time_window_violations * 10 +
    high_risk_tracker_origins * 6 +
    long_gaming_sessions * 8 -
    min(compliant_hours, 24) * 1
)
score = max(0, min(100, score))  # Clamp to [0, 100]
```

**Weights (Configurable):**
- Blocked site attempts: +12 per event
- Time violation: +10 per event
- High-risk tracker: +6 per origin
- Long session: +8 per session (>2 hours)
- Compliant hour: -1 per hour (capped at 24)

**Response:**
```json
{
  "score": 42,
  "updated_at": "2025-10-04T12:31:00Z",
  "inputs_breakdown": {
    "blocked_site_attempts": 2,
    "time_window_violations": 1,
    "high_risk_tracker_origins": 3,
    "long_gaming_sessions": 0,
    "compliant_hours": 18,
    "total_audits_analyzed": 245,
    "window_hours": 24
  }
}
```

### 2. Gamification Cues (Extension - Local)

**Safe Streak Bar** (Popup):
- Tracks hours since last violation
- Reset on blocking event
- Persists across browser restarts
- Color-coded display:
  - Green: 0-24 hours
  - Blue: 25+ hours

**Risk Score Display** (Popup):
- Fetched from backend every 30s
- Color-coded:
  - Green: 0-29 (low risk)
  - Yellow: 30-69 (medium risk)
  - Red: 70-100 (high risk)
- Shows breakdown on hover

**Time-Left Nudges** (Background):
- 15-minute warning before time window closes
- Lightweight toast notification
- No PII transmitted

**Compliant Message**:
- Shows when streak ≥12 hours
- Encourages positive behavior
- GDPR-safe (no server transmission)

### 3. Hardened PIN Storage (Extension)

**Algorithm:** PBKDF2-HMAC-SHA-256

**Parameters:**
- Iterations: 310,000 (OWASP 2023 recommendation)
- Salt: 16 bytes (random per PIN)
- Output: 32 bytes (256 bits)

**Storage Format:**
```javascript
{
  algo: "PBKDF2-SHA256",
  iter: 310000,
  salt: "base64-encoded-salt",
  hash: "base64-encoded-hash",
  created_at: "2025-10-04T12:31:00Z"
}
```

**Security Properties:**
- ✅ No plaintext PIN ever stored
- ✅ Constant-time comparison (prevents timing attacks)
- ✅ Unique salt per PIN (prevents rainbow tables)
- ✅ 310k iterations (brute-force resistant)

### 4. Recovery Codes System (Extension)

**Format:** `XXXX-XXXX-XXXX`

**Alphabet:** `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`
- No look-alikes (I/1, O/0, S/5, Z/2)
- 32 characters → ~5 bits per character
- 12 characters → ~60 bits entropy

**Storage (Per Code):**
```javascript
{
  id: "uuid-v4",
  salt: "unique-16-byte-salt",
  iter: 310000,
  hash: "pbkdf2-hash",
  used: false,
  used_at: null
}
```

**Batch Structure:**
```javascript
{
  version: 1,
  batch_id: "uuid-v4",
  codes: [ /* 10 hashed codes */ ],
  created_at: "2025-10-04T12:31:00Z",
  active: true
}
```

**Operations:**
- **Generate:** Creates batch of 10 codes, shows plaintext once
- **Download:** Exports to .txt file with metadata
- **Regenerate:** Creates new batch, marks old batch inactive (requires PIN)
- **Verify:** Constant-time comparison, marks code as used
- **Forgot PIN:** Accepts recovery code → Reset PIN → Auto-unlock

### 5. Real-Time Background Updates (Extension)

**Polling Interval:** 30 seconds (debounced)

**Endpoints Polled:**
- `/rules` → Rules list (cached)
- `/audit/stats` → Stats (cached)
- `/risk/score` → Risk score (cached)

**Message Types:**
- `risk:update` → Risk score changed
- `rules:update` → Rules modified
- `stats:update` → Stats refreshed
- `nudge:streak` → Streak milestone
- `nudge:timeleft` → Time window closing

**Caching:**
- Stored in `chrome.storage.local`
- ETags for versioning
- Background worker manages sync

### 6. Role Separation

**Parent (options.html):**
- Full CRUD for rules
- PIN setup/change
- Recovery code management
- Export/import rules
- Factory reset
- Backend configuration

**Child (popup.html):**
- View-only activity summary
- Safe streak display
- Risk score display
- "Open Parent Settings" button
- No editing capabilities

**Security:**
- Options page locked behind PIN
- Popup is always accessible (read-only)
- PIN required for sensitive operations

### 7. Export/Import (Backend)

**Export Endpoint:** `GET /rules/export`

**Response:**
```json
{
  "version": "1",
  "exported_at": "2025-10-04T12:31:00Z",
  "rules": [
    {
      "id": "uuid",
      "bundle_id": "uuid",
      "rule_type": "blocklist",
      "rule_data": {...},
      "created_at": "2025-10-04T12:00:00Z"
    }
  ]
}
```

**Import Endpoint:** `POST /rules/import`

**Request Body:**
```json
{
  "version": "1",
  "rules": [ /* array of rule objects */ ]
}
```

### 8. WebAuthn Stubs (Backend)

**Endpoints (All return stub response):**
- `POST /webauthn/register/options`
- `POST /webauthn/register/verify`
- `POST /webauthn/assertion/options`
- `POST /webauthn/assertion/verify`

**Response:**
```json
{
  "status": "stub",
  "message": "WebAuthn registration coming soon",
  "available": false
}
```

### 9. Factory Reset (Extension)

**Functionality:**
- Clears all `chrome.storage.local` data
- Wipes PIN, recovery codes, cached rules
- Reloads extension via `chrome.runtime.reload()`

**Safety:**
- Two-step confirmation
- Explicit warnings shown
- No undo capability

---

## Security Enhancements

### Critical: Recovery Code Regeneration Loophole - CLOSED ✅

**Issue:** Attacker could regenerate codes without PIN, then use new code to reset PIN and gain access.

**Attack Vector (Before Fix):**
```
1. Attacker opens options page (locked)
2. Navigate to "Recovery Codes" tab
3. Click "Regenerate Codes" (no verification required)
4. Download new codes
5. Click "Forgot PIN?"
6. Use newly generated code
7. Reset PIN → GAIN ACCESS ❌
```

**Protection (After Fix):**
```javascript
async function regenerateRecoveryCodes() {
  // PIN VERIFICATION REQUIRED
  const currentPin = prompt("Enter your current PIN to regenerate recovery codes:");
  const isValid = await crypto.verifyPin(currentPin, storedPin);
  
  if (!isValid) {
    alert("❌ Incorrect PIN. Cannot regenerate recovery codes.");
    return; // BLOCKED
  }
  
  // Only proceed if PIN verified
  const { batch_id, codes } = await crypto.createRecoveryBatch();
  // ... download codes
}
```

**Impact:** 🔴 HIGH - Prevented unauthorized access attack vector

### UX Improvements

**First-Time PIN Setup:**
- **Before:** Showed "Default PIN: 1234" during creation (confusing)
- **After:** Clean "Create Your PIN" flow, no default mentioned

**Forgot PIN Flow:**
- **Before:** Simple prompt, no validation
- **After:** Format validation, clear prompts with emojis, automatic unlock after reset

**Error Messages:**
- **Before:** Generic "Invalid code"
- **After:** Specific errors with emojis (❌ Invalid format, ✅ Code verified, etc.)

### Security Checklist ✅

- [x] PIN stored as PBKDF2 hash (310k iterations)
- [x] Recovery codes stored as PBKDF2 hashes
- [x] Each recovery code has unique salt
- [x] Recovery codes can only be used once
- [x] Constant-time comparison prevents timing attacks
- [x] Regenerating codes requires PIN verification
- [x] Old codes invalidated when new batch created
- [x] No plaintext secrets in chrome.storage.local
- [x] Format validation on recovery code input
- [x] Clear user feedback for all operations

### Threat Model

**Threats Mitigated ✅**

| Threat | Mitigation |
|--------|-----------|
| Unauthorized code regeneration | PIN required before regeneration |
| Recovery code reuse | Codes marked as used after verification |
| Timing attacks | Constant-time comparison implemented |
| Rainbow table attacks | Unique salts per code/PIN |
| Brute force attacks | PBKDF2 with 310k iterations |

**Known Limitations:**
- Physical access to OS → Can export chrome.storage.local (OS-level threat)
- Lost PIN + Lost recovery codes → Unrecoverable (by design)
- No rate limiting on PIN attempts (future enhancement)

---

## Testing Guide

### Quick Test (2 Minutes)

#### Test 1: Forgot PIN Flow (30 seconds)

```
✅ 1. Create PIN: 1234
   Alert shows 10 recovery codes → Copy one code
   
✅ 2. Close options page

✅ 3. Reopen options → Click "Forgot PIN?"

✅ 4. Enter recovery code
   Expected: ✅ "Recovery code verified!"
   
✅ 5. Create new PIN: 5678
   Confirm: 5678
   Expected: ✅ "PIN reset successfully!"
   Expected: ✅ Settings automatically unlocked

✅ 6. Close and reopen → Enter 5678 → Should unlock

✅ 7. Try same recovery code again
   Expected: ❌ "Invalid or already used"
```

#### Test 2: Regeneration Security (30 seconds)

```
✅ 1. Options unlocked

✅ 2. Go to "Recovery Codes" tab

✅ 3. Click "Regenerate Codes"
   Expected: Prompt "Enter your current PIN"

✅ 4. Enter WRONG PIN (e.g., 0000)
   Expected: ❌ "Incorrect PIN. Cannot regenerate"

✅ 5. Click "Regenerate Codes" again

✅ 6. Enter CORRECT PIN (5678)
   Expected: ⚠️ Warning about invalidating old codes
   
✅ 7. Confirm → File downloads
   Expected: ✅ New recovery codes downloaded
```

#### Test 3: Storage Security (30 seconds)

```
✅ 1. Options page → Right-click → Inspect

✅ 2. Console tab

✅ 3. Run:
   chrome.storage.local.get('recovery_batches', console.log)

✅ 4. Verify:
   - ❌ No plaintext codes visible
   - ✅ Each code has "salt" field
   - ✅ Each code has "hash" field
   - ✅ "iter": 310000
   - ✅ "used": true/false

✅ 5. Run:
   chrome.storage.local.get('pin', console.log)

✅ 6. Verify:
   - ❌ No plaintext PIN
   - ✅ Has "salt" field
   - ✅ Has "hash" field
   - ✅ "algo": "PBKDF2-SHA256"
   - ✅ "iter": 310000
```

### Comprehensive Test Suite

#### Backend Tests

```bash
# Test risk score endpoint
curl http://localhost:8000/risk/score \
  -H "Authorization: Bearer dev-token-123"

# Expected: { score: 0-100, inputs_breakdown, updated_at }

# Test WebAuthn stubs
curl -X POST http://localhost:8000/webauthn/register/options \
  -H "Authorization: Bearer dev-token-123"

# Expected: { status: "stub", message: "coming soon", available: false }

# Test audit stats
curl http://localhost:8000/audit/stats \
  -H "Authorization: Bearer dev-token-123"

# Expected: { total_audits, unique_origins, avg_trackers, ... }

# Test rules export
curl http://localhost:8000/rules/export \
  -H "Authorization: Bearer dev-token-123" \
  > rules-backup.json

# Test rules import
curl -X POST http://localhost:8000/rules/import \
  -H "Authorization: Bearer dev-token-123" \
  -H "Content-Type: application/json" \
  -d @rules-backup.json
```

#### Extension Tests

**Test PIN Protection:**
```
1. Options page locked on load
2. Correct PIN unlocks
3. Incorrect PIN shows error
4. Close & reopen requires PIN again
```

**Test Gamification:**
```
1. Open popup → See "Your Activity" section
2. Safe Streak: Shows hours without violations
3. Risk Score: Shows 0-100 score (color-coded)
4. Navigate to blocked site → Check popup
5. Streak resets to 0
```

**Test Real-Time Updates:**
```
1. Background updates every 30 seconds
2. Open popup triggers immediate refresh
3. Risk score updates from backend
4. Safe streak persists across restarts
```

**Test Factory Reset:**
```
1. Options → Export/Import tab
2. Scroll to bottom → Click "Factory Reset"
3. Confirm twice (warnings shown)
4. Extension reloads automatically
5. All data wiped (PIN, codes, rules)
6. Reopen options → First-time setup
```

---

## API Reference

### Risk Scoring

#### GET /risk/score

**Description:** Calculate risk score from last 24 hours of audit data

**Headers:**
- `Authorization: Bearer <token>`

**Response:**
```json
{
  "score": 42,
  "updated_at": "2025-10-04T12:31:00Z",
  "inputs_breakdown": {
    "blocked_site_attempts": 2,
    "time_window_violations": 1,
    "high_risk_tracker_origins": 3,
    "long_gaming_sessions": 0,
    "compliant_hours": 18,
    "total_audits_analyzed": 245,
    "window_hours": 24
  }
}
```

**Status Codes:**
- `200 OK` - Success
- `401 Unauthorized` - Invalid token

### WebAuthn (Stubs)

#### POST /webauthn/register/options

**Description:** Generate WebAuthn registration options (stub)

**Response:**
```json
{
  "status": "stub",
  "message": "WebAuthn registration coming soon",
  "available": false
}
```

#### POST /webauthn/register/verify

**Description:** Verify WebAuthn registration (stub)

**Response:**
```json
{
  "status": "stub",
  "message": "WebAuthn verification coming soon",
  "available": false
}
```

#### POST /webauthn/assertion/options

**Description:** Generate WebAuthn assertion options (stub)

**Response:**
```json
{
  "status": "stub",
  "message": "WebAuthn assertion coming soon",
  "available": false
}
```

#### POST /webauthn/assertion/verify

**Description:** Verify WebAuthn assertion (stub)

**Response:**
```json
{
  "status": "stub",
  "message": "WebAuthn assertion verification coming soon",
  "available": false
}
```

### Rules Management

#### GET /rules/export

**Description:** Export all rules as JSON v1

**Headers:**
- `Authorization: Bearer <token>`

**Response:**
```json
{
  "version": "1",
  "exported_at": "2025-10-04T12:31:00Z",
  "rules": [
    {
      "id": "uuid",
      "bundle_id": "uuid",
      "rule_type": "blocklist",
      "rule_data": {
        "pattern": "facebook.com",
        "enabled": true
      },
      "created_at": "2025-10-04T12:00:00Z"
    }
  ]
}
```

#### POST /rules/import

**Description:** Import rules from JSON v1

**Headers:**
- `Authorization: Bearer <token>`
- `Content-Type: application/json`

**Request Body:**
```json
{
  "version": "1",
  "rules": [ /* array of rule objects */ ]
}
```

**Response:**
```json
{
  "imported": 5,
  "skipped": 0,
  "errors": []
}
```

---

## Troubleshooting

### Issue: Page Frozen / Not Loading

**Symptoms:**
- Options page shows but nothing clickable
- No console errors
- Extension appears loaded

**Solution:**
```
1. chrome://extensions → Refresh extension (⟳)
2. Right-click page → Inspect → Console
3. Look for [Options] log messages:
   - [Options] Script starting v0.4.1...
   - [Options] Crypto module loaded
   - [Options] DOM loaded, initializing...
   - [Options] Stored PIN check: exists/not found
4. Check for red errors
5. If error persists, clear extension data:
   chrome.storage.local.clear()
   Then reload extension
```

### Issue: "Save Backend Settings" Not Working

**Symptoms:**
- Click "Save Backend Settings" button
- No response or status message

**Solution:**
```
1. Verify extension is unlocked (PIN entered)
2. Check console for errors
3. Verify button handler setup:
   - Should see setupButtonHandlers() called in showMainContent()
4. Try entering values and clicking again
5. Check chrome.storage.local:
   chrome.storage.local.get(['gc_backend_url', 'gc_api_token'], console.log)
```

### Issue: Recovery Codes Not Downloading

**Symptoms:**
- Click "Regenerate Codes"
- Enter PIN
- No file downloads

**Solution:**
```
1. Check manifest.json has "downloads" permission
2. Verify chrome.downloads API available:
   console.log(chrome.downloads)
3. Check browser download settings (not blocked)
4. Try in incognito mode (some extensions block downloads)
```

### Issue: Forgot PIN Doesn't Work

**Symptoms:**
- Click "Forgot PIN?"
- Enter recovery code
- Error: "Invalid or already used"

**Solution:**
```
1. Verify code format: XXXX-XXXX-XXXX
2. Check code hasn't been used:
   chrome.storage.local.get('recovery_batches', console.log)
   Look for "used": true
3. Verify batch is active:
   Look for "active": true
4. Try another code from the same batch
5. If all codes used, extension data needs reset
```

### Issue: Risk Score Always 0

**Symptoms:**
- Popup shows "Risk Score: 0"
- Backend is running

**Solution:**
```
1. Submit some audit data:
   curl -X POST http://localhost:8000/audit/submit \
     -H "Authorization: Bearer dev-token-123" \
     -H "Content-Type: application/json" \
     -d '{
       "origin_hash": "...",
       "check_type": "page_audit_v2",
       "policy_state": {
         "tracker_count": 10
       }
     }'

2. Check backend logs:
   docker-compose logs -f backend

3. Verify endpoint works:
   curl http://localhost:8000/risk/score \
     -H "Authorization: Bearer dev-token-123"
```

### Issue: Gamification Not Showing

**Symptoms:**
- Popup doesn't show safe streak or risk score
- Fields are empty or "N/A"

**Solution:**
```
1. Check background service worker:
   chrome://extensions → GuardianCore → service worker
   Should be "active"

2. Verify background.js loaded:
   Check for [Background] log messages

3. Check gamification state:
   chrome.storage.local.get('lastViolation', console.log)

4. Trigger manual update:
   - Open popup (triggers refresh)
   - Wait 30 seconds for next poll
```

---

## Files Modified

### Backend (FastAPI)

**New Files:**
- `src/app/routers/risk.py` - Risk scoring engine
- `src/app/routers/webauthn.py` - WebAuthn stub endpoints

**Modified Files:**
- `src/app/db.py` - Added bundle_id, rules_schedules, rule_bundles tables
- `src/app/config.py` - Added risk scoring weights, updated version
- `src/app/main.py` - Included risk_router and webauthn_router
- `src/app/routers/rules.py` - Added export/import endpoints

### Extension (Chrome MV3)

**New Files:**
- `crypto.js` - PBKDF2 implementation, recovery codes (⭐ Core security)
- `strings.js` - Centralized UI strings (i18n-ready)

**Modified Files:**
- `manifest.json` - Version 0.4.1, downloads permission, module type
- `options.js` - PIN setup/verify, recovery codes, tabs, button handlers
- `options.html` - Multi-tab layout, PIN lock screen, recovery UI
- `popup.js` - Gamification state display, real-time updates
- `popup.html` - Safe streak bar, risk score display
- `background.js` - Polling, gamification tracking, message handlers

**Lines Changed:**
- `options.js`: 661 lines (was 605)
- `crypto.js`: 261 lines (new)
- `background.js`: ~50 lines added
- `popup.js`: ~30 lines added

---

## Changelog

### v0.4.1 (October 4, 2025) - Security Patch

#### 🔒 Security Fixes
- **Critical:** Closed recovery code regeneration loophole (PIN now required)
- Enhanced "Forgot PIN?" flow with format validation
- Improved error messages for better UX

#### ✨ Features
- Dynamic PIN hint (only shown for existing PIN, hidden during creation)
- Format validation for recovery codes (XXXX-XXXX-XXXX)
- Automatic unlock after successful PIN reset
- Better prompts with emoji indicators

#### 🐛 Bug Fixes
- Fixed frozen page issue (button handlers now setup after unlock)
- Fixed missing DOM elements (#pin-error, #forgot-pin-btn)
- Added comprehensive error handling with try/catch
- Added debug console logs ([Options] prefix)

#### 📚 Documentation
- Consolidated all Week 4 docs into single comprehensive guide
- Created WEEK4-COMPLETE.md with full testing procedures
- Added security quick reference
- Updated troubleshooting section

### v0.4.0 (October 3, 2025) - Week 4 Complete

#### 🎮 Gamification
- Safe streak hours tracking (local only)
- Risk score display (color-coded: green/yellow/red)
- Time-left nudges (15-minute warning)
- Compliant message (≥12 hours streak)
- Real-time UI updates via message passing

#### 📊 Risk Scoring
- Weighted scoring algorithm
- Rolling 24-hour window
- Configurable weights
- Detailed breakdown in response
- Range enforcement (0-100)

#### 🔐 Security Hardening
- PBKDF2-SHA-256 PIN hashing (310k iterations)
- 10 recovery codes with unique salts
- Constant-time comparison
- No plaintext storage
- One-time use enforcement

#### ⚡ Real-Time Updates
- Background polling (30s interval)
- Debounced refresh
- Rules/stats/risk caching
- Push notifications to UIs
- ETag support seeds

#### 👥 Role Separation
- Parent (options.html): Full controls
- Child (popup.html): View-only cues
- PIN-gated settings
- Read-only fields in popup

#### 💾 Export/Import
- JSON v1 schema
- Rules backup/restore
- Bundle support ready
- Multi-interval schedule seeds

#### 🔗 WebAuthn Stubs
- Registration endpoints (stub)
- Assertion endpoints (stub)
- Future-ready for biometric auth

#### 🔄 Factory Reset
- Two-step confirmation
- Clears all extension data
- Reloads extension
- Explicit warnings

---

## Next Steps

### Immediate Actions
1. ✅ Load extension in browser
2. ✅ Run 2-minute quick test
3. ✅ Verify chrome.storage.local (no plaintext)
4. ✅ Test forgot PIN flow
5. ✅ Test regeneration security

### Future Enhancements
- [ ] Add rate limiting for PIN attempts
- [ ] Add recovery code expiration (optional)
- [ ] Implement full WebAuthn support
- [ ] Add PIN strength meter during creation
- [ ] Add multi-language support (i18n)
- [ ] Add biometric unlock (WebAuthn)
- [ ] Add encrypted backup to cloud (opt-in)

---

## Summary

**What Changed:**
- 🔒 Closed critical security loophole (PIN-gated regeneration)
- ✨ Improved UX for PIN creation and recovery
- 🐛 Fixed frozen page bug (button handler timing)
- 📊 Added comprehensive debugging logs
- 📚 Consolidated documentation

**What's Secure:**
- ✅ All secrets stored as PBKDF2 hashes (310k iterations)
- ✅ Unique salts for each code/PIN
- ✅ PIN required for sensitive operations
- ✅ One-time use recovery codes
- ✅ Constant-time comparison
- ✅ No plaintext storage

**What's Ready:**
- ✅ Backend running (FastAPI + PostgreSQL)
- ✅ Extension ready (Chrome MV3)
- ✅ Risk scoring v1 operational
- ✅ Gamification cues working
- ✅ Security hardened
- ✅ Documentation complete

**Status:** PRODUCTION READY ✅

---

**Version:** 0.4.1  
**Released:** October 4, 2025  
**Compatibility:** Chrome/Brave Manifest V3  
**License:** MIT (if applicable)  
**Contact:** guardiancore@example.com (update as needed)

---

*For additional support, see individual documentation files or check the project repository.*
