# GuardianCore Week 4 - Complete Documentation

**Version:** 0.4.5 (Scheduled Windows & XP Balance)  
**Released:** 2025-10-04  
**Branch:** phase-4  
**Focus:** XP-Only Gamification, Security Hardening, PIN/Recovery System, Developer Tooling

---

## 📋 Table of Contents

1. [Overview](#ove- Physical OS access → Can export chrome.storage.local (OS-level threat)
- Lost PIN + Lost recovery codes → Unrecoverable (by design)
- No rate limiting on PIN attempts (future enhancement)

---

## Features Implemented

### 1. XP System (Extension - Local)

**Implementation:** `background.js`

```javascript
function awardXp(event) {
  ensureXpDay();
  let delta = 1; // base
  if (event.csp) delta += 2;
  if (event.cors) delta += 1;
  if (event.trackers === 0) delta += 3; 
  else delta -= Math.min(event.trackers, 5);
  if (event.blocked || event.violation) delta -= 5;
  if (delta < 0) delta = Math.max(delta, -7);
  if (fastMode) delta *= 3;
  
  xpState.xp += delta;
  if (xpState.xp < 0) xpState.xp = 0;
  
  while (xpState.xp >= 100) {
    xpState.xp -= 100;
    xpState.level += 1;
  }
  
  persistXp();
  notifyPopup();
}
```

**Triggers:**
- `chrome.webNavigation.onCompleted` (main frame only)
- Blocked navigations (immediate penalty)

**Excluded:**
- `chrome://` pages
- `chrome-extension://` pages
- Navigations within XP cooldown window

### 2. Auto-Refresh Rules (v0.4.3)

**Problem:** After saving backend config in Options, rules list was empty until page refresh + PIN re-entry.

**Solution:**
```javascript
async function saveSettings() {
  await chrome.storage.local.set({ gc_backend_url, gc_api_token });
  showStatus("✅ Settings saved successfully", "success");
  
  // Auto-load rules immediately
  await loadRules();
  
  // Notify background to refetch
  chrome.runtime.sendMessage({ type: "REFRESH_RULES" });
}
```

**Result:** Rules appear instantly after saving config, no page refresh needed.

### 3. Export/Import (Backend)

**Export Endpoint:** `GET /rules/all/export`

**Response:**
```json
{
  "version": "1",
  "exported_at": "2025-10-04T12:00:00Z",
  "rules": [
    {
      "rule_type": "blocklist",
      "pattern": "tiktok.com",
      "category": "social_media",
      "enabled": true
    }
  ]
}
```

**Import Endpoint:** `POST /rules/all/import`

**Request:**
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

### 4. WebAuthn Stubs (Backend)

**Endpoints (All return stub):**
- `POST /webauthn/register/options`
- `POST /webauthn/register/verify`
- `POST /webauthn/assertion/options`
- `POST /webauthn/assertion/verify`

**Response:**
```json
{
  "status": "stub",
  "message": "WebAuthn coming soon",
  "available": false
}
```

### 5. Factory Reset (Extension)

**Functionality:**
- Clears all `chrome.storage.local` data
- Wipes PIN, recovery codes, cached rules, XP state
- Reloads extension via `chrome.runtime.reload()`

**Safety:**
- Two-step confirmation
- Explicit warnings shown
- No undo capability

---)
2. [Quick Start](#quick-start)
3. [Gamification System (XP-Only)](#gamification-system-xp-only)
4. [Security Enhancements](#security-enhancements)
5. [Features Implemented](#features-implemented)
6. [Testing Guide](#testing-guide)
7. [API Reference](#api-reference)
8. [Troubleshooting](#troubleshooting)
9. [Changelog](#changelog)

---

## Overview

Week 4 delivers a streamlined, fast-feedback gamification system and production-ready security for GuardianCore's privacy-focused parental controls.

### Key Achievements ✅

- 🎯 **XP-Only Gamification**: Instant feedback on every navigation
- ⚖️ **XP Balance Tuning**: Tracker penalty −0.5 (max −2.5) & negative floor −5 (was −7)
- � **Scheduled Time Windows**: Global or per-domain block / allow-only windows
- 🌐 **Global vs Domain**: Leave domain blank for global curfew; fill for domain-specific schedule
- 🔁 **Allow-Window Semantics**: Outside an allow-only window → domain blocked automatically
- 🏷 **Mandatory Reasons**: Every rule requires an explanatory reason
- ⏱ **Rule Timestamps & Scope Tags**: "24h" vs "Window" + created datetime
- 🔑 **Recovery Codes Simplified**: One-time view; minimal surface
- � **PBKDF2 PIN Security**: 310k iterations, unique salt
- 🧪 **Dev Tools**: Fast mode, violation simulation, XP reset
- 💾 **Export/Import**: `/rules/all/export` & `/rules/all/import`
- 🧱 **Security Loopholes Closed**: PIN-gated regeneration, XP farming prevention
- 👥 **Role Separation**: Popup is read‑only, rules hidden from child
- ⚡ **Auto-Refresh Rules**: Immediate display after backend save
- 🛠 **Dev Productivity**: `make db-reset` for schema resets

### Version History

- **0.4.0** - Initial Week 4: Risk score + safe streak + PIN system
- **0.4.1** - Security fixes: recovery code loophole patched
- **0.4.2** - Active-time streak redesign + dev tools
- **0.4.3** - XP-only model, XP farming prevention, auto-refresh rules
- **0.4.4** - XP balance tuning (tracker penalties, negative floor), recovery UI simplification
- **0.4.5** - Scheduled time windows (domain/global + allow/block), mandatory reasons, timestamps, db-reset

---

## Quick Start

### 1. Start Backend

```bash
cd guardiancore
docker compose up -d

# Verify services
docker ps
curl http://localhost:8000/health
# Expected: {"status":"ok","name":"GuardianCore","env":"dev"}
```

### 2. Load Extension

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" → Select `app-extension` folder
4. Pin extension to toolbar

### 3. First-Time Setup

#### A. Create PIN (Options Page)
1. Right-click extension → "Options"
2. Enter PIN (≥4 digits), confirm
3. **Alert shows 10 recovery codes** - save them immediately!
4. Options page auto-unlocks

#### B. Configure Backend (Options Page)
1. Settings tab
2. Backend URL: `http://localhost:8000`
3. API Token: `dev-token-123`
4. Click "Save Backend Settings"
5. Rules list loads automatically (no refresh needed!)

---

## Gamification System (XP-Only)

### 🎯 Design Rationale

**Removed:** Risk score (backend polling, 0–100 static value) + Safe streak (active time accumulation, heartbeat timers)

**Why?** Too static, overlapping meaning, added complexity without clear user benefit.

**New:** Local XP system with instant feedback per navigation.

### 🧮 XP Rules (v0.4.5)

| Event / Condition | XP Delta |
|-------------------|----------|
| Base per page load | +1 |
| Page has CSP header | +2 |
| Page exposes CORS signals | +1 |
| Zero trackers detected | +3 |
| Each tracker (up to 5) | **-0.5 each** (max -2.5) |
| Blocked / violation navigation | -5 |
| Fast Mode enabled (dev) | Final delta ×3 |

**Mechanics:**
- XP floors at 0 (never negative overall)
- Level up every 100 XP (XP wraps carry remainder)
- Daily reset at UTC day boundary; level persists
- Single-event negative delta floored at -5 (was -7 pre-0.4.4)
- Tracker penalty reduced for fairness on tracker-heavy sites

### 🔄 Daily Reset Logic

Stored state: `gc_xp_state`
```json
{ "dayKey": "2025-10-04", "xp": 57, "level": 3 }
```

On any XP mutation:
1. Check if `dayKey !== today`
2. If true: reset `xp = 0`, keep `level`, update `dayKey`
3. Persist to storage

### 🚫 XP Farming Prevention (v0.4.3)

**Problem:** Spamming refresh (F5) on the same URL awarded XP every time.

**Solution:** URL + timestamp tracking with 30-second cooldown.

```javascript
// Per-URL cooldown
const recentNavigations = new Map(); // url -> last_awarded_timestamp
const XP_COOLDOWN_MS = 30000; // 30 seconds

// Before awarding XP:
if (timeSinceLastAward >= XP_COOLDOWN_MS) {
  awardXp(...);
  recentNavigations.set(url, now);
}
```

**Result:** Refreshing the same page repeatedly won't farm XP. User must navigate to different pages or wait 30 seconds.

### 🧩 Popup UX

**Visible Elements:**
- Level (persistent)
- Daily XP (current, resets daily)
- Progress bar (0-100%, fills as XP increases)
- "X XP to next level" text
- **"How you earn XP"** explanation list

**Removed Elements:**
- Safe Streak hours
- Risk score color indicator
- Compliant message
- Time restriction nudges

---

## Security Enhancements

### 🔐 PIN Storage (PBKDF2)

**Algorithm:** PBKDF2-HMAC-SHA-256

**Parameters:**
- Iterations: 310,000 (OWASP 2023)
- Salt: 16 bytes random (unique per PIN)
- Output: 32 bytes (256 bits)

**Storage Format:**
```javascript
{
  algo: "PBKDF2-SHA256",
  iter: 310000,
  salt: "base64-encoded-salt",
  hash: "base64-encoded-hash",
  created_at: "ISO-8601-timestamp"
}
```

**Security Properties:**
- ✅ No plaintext PIN ever stored
- ✅ Constant-time comparison (prevents timing attacks)
- ✅ Unique salt per PIN (prevents rainbow tables)
- ✅ 310k iterations (brute-force resistant)

### 🔑 Recovery Codes

**Format:** `XXXX-XXXX-XXXX`

**Alphabet:** `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (32 chars, no look-alikes)

**Entropy:** 12 characters × ~5 bits = ~60 bits

**Storage (Per Code):**
```javascript
{
  id: "uuid-v4",
  salt: "base64-16-bytes",
  iter: 310000,
  hash: "base64-hash",
  used: false,
  used_at: null
}
```

**Operations:**
- **Generate:** Creates 10 codes, shows plaintext once (alert), then deletes plaintext from storage
- **Download:** Exports as `.txt` file (date + batch ID in filename)
- **Regenerate:** Requires PIN verification, marks old batch inactive
- **Verify:** Constant-time comparison, one-time use only
- **Forgot PIN:** Enter recovery code → Reset PIN → Auto-unlock options

### 🔴 Critical Security Fix: Recovery Regeneration Loophole

**Attack Vector (Before 0.4.1):**
1. Attacker opens locked options page
2. Navigate to Recovery Codes tab
3. Regenerate codes (no PIN required)
4. Use new code to reset PIN
5. Gain access ❌

**Fix:**
```javascript
async function regenerateRecoveryCodes() {
  const pin = prompt("Enter your PIN to confirm:");
  if (!pin) return;
  
  const result = await verifyPIN(pin);
  if (!result.valid) {
    alert("❌ Incorrect PIN. Cannot regenerate codes.");
    return;
  }
  // ... proceed with regeneration
}
```

**Impact:** 🔴 HIGH - Prevented unauthorized access vector

### ✅ Security Checklist

- [x] PIN stored as PBKDF2 hash (310k iterations)
- [x] Recovery codes stored as PBKDF2 hashes
- [x] Each code has unique salt
- [x] Codes can only be used once
- [x] Constant-time comparison prevents timing attacks
- [x] Regenerating codes requires PIN verification
- [x] Old codes invalidated when new batch created
- [x] No plaintext secrets in chrome.storage.local
- [x] Format validation on recovery code input
- [x] XP farming prevented via URL cooldown

### 🛡️ Threat Model

**Mitigated Threats:**

| Threat | Mitigation |
|--------|-----------|
| Unauthorized code regeneration | PIN required before regeneration |
| Recovery code reuse | Codes marked as used after verification |
| Timing attacks | Constant-time comparison |
| Rainbow table attacks | Unique salts per code/PIN |
| Brute force attacks | PBKDF2 with 310k iterations |
| XP farming (refresh spam) | 30-second per-URL cooldown |

**Known Limitations:**
- Physical OS access → Can export chrome.storage.local (OS-level threat)
- Lost PIN + Lost recovery codes → Unrecoverable (by design)
- No rate limiting on PIN attempts (future enhancement)
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

### Test 1: PIN Creation & Recovery (3 min)

```
✅ 1. Remove extension, clear storage:
   chrome.storage.local.clear()

✅ 2. Reload extension, open Options

✅ 3. Create PIN: 1234
   Confirm: 1234
   Expected: Alert shows 10 recovery codes

✅ 4. Save one code, close options

✅ 5. Reopen options → Click "Forgot PIN?"

✅ 6. Enter saved code
   Expected: ✅ "Recovery code verified!"

✅ 7. Create new PIN: 5678
   Expected: Auto-unlocks to settings

✅ 8. Try same code again
   Expected: ❌ "Invalid or already used"
```

### Test 2: XP System (4 min)

```
✅ 1. Open popup
   Expected: Level 1, XP 0, empty progress bar

✅ 2. Navigate to 3 different websites
   Expected: XP increases (3-12 depending on trackers/CSP)

✅ 3. Press F5 (refresh) 5 times on same page
   Expected: XP only increases once (cooldown active)

✅ 4. Wait 30 seconds, refresh again
   Expected: XP increases (cooldown expired)

✅ 5. Dev tools (press D 5×) → "Simulate Violation"
   Expected: XP decreases by 5

✅ 6. Dev tools → "Reset XP"
   Expected: XP = 0, level unchanged, bar empties
```

### Test 3: Auto-Refresh Rules (2 min)

```
✅ 1. Open Options (unlocked)

✅ 2. Go to Settings tab

✅ 3. Enter backend config:
   URL: http://localhost:8000
   Token: dev-token-123

✅ 4. Click "Save Backend Settings"
   Expected: Success message + Rules list loads immediately

✅ 5. Go to Rules tab
   Expected: Rules already visible (no refresh needed)
```

### Test 4: XP Farming Prevention (2 min)

```
✅ 1. Open popup, note current XP

✅ 2. Navigate to any website
   Expected: XP increases

✅ 3. Press F5 (refresh) 10 times rapidly
   Expected: XP does NOT increase after first load

✅ 4. Background console shows:
   "[XP] Cooldown active for [url] (Xs remaining)"

✅ 5. Wait 30 seconds, refresh once
   Expected: XP increases again
```

### Test 5: Recovery Code Download (2 min)

```
✅ 1. Options → Recovery Codes tab

✅ 2. Click "Regenerate Codes"
   Enter PIN: 1234
   Confirm warning

✅ 3. File downloads as:
   guardian_recovery_codes_20251004_XXXXX.txt

✅ 4. Open file
   Expected: 10 codes in XXXX-XXXX-XXXX format

✅ 5. Recovery tab updates
   Expected: 10 unused codes, old batch gone
```

### Backend Tests

```bash
# Test health endpoint
curl http://localhost:8000/health

# Expected: {"status":"ok","name":"GuardianCore","env":"dev"}
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

### Backend Endpoints

#### Health Check
```bash
GET /health
Response: { "status": "ok", "name": "GuardianCore", "env": "dev" }
```

#### Rules Export
```bash
GET /rules/all/export
Headers: Authorization: Bearer <token>
Response: { version: "1", rules: [...] }
```

#### Rules Import
```bash
POST /rules/all/import
Headers: Authorization: Bearer <token>
Body: { version: "1", rules: [...] }
Response: { imported: N, skipped: M, errors: [] }
```

#### Audit Stats
```bash
GET /audit/stats
Headers: Authorization: Bearer <token>
Response: {
  total_audits: 123,
  unique_origins: 45,
  avg_trackers: 2.3,
  csp_coverage: 0.67,
  cors_coverage: 0.89
}
```

#### WebAuthn (Stubs)
```bash
POST /webauthn/register/options
POST /webauthn/register/verify
POST /webauthn/assertion/options
POST /webauthn/assertion/verify
All return: { status: "stub", available: false }
```

### Extension Messages

#### Background → Popup
```javascript
// XP Update
{ type: "xp:update", xp: 57, level: 3, progress: 0.57, delta: +3 }

// Stats Update
{ type: "stats:update", stats: { total_audits: 123, ... } }
```

#### Popup/Options → Background
```javascript
// Get XP State
{ type: "GET_XP_STATE" }
Response: { xp: 57, level: 3, progress: 0.57 }

// Refresh Rules
{ type: "REFRESH_RULES" }
Response: { ok: true }

// Dev: Toggle Fast Mode
{ type: "DEV_TOGGLE_FAST_MODE" }
Response: { ok: true, fastMode: true }

// Dev: Simulate Violation
{ type: "DEV_SIMULATE_VIOLATION" }
Response: { ok: true }

// Dev: Reset XP
{ type: "DEV_RESET_XP" }
Response: { ok: true }
```

---

## Troubleshooting

### Issue: XP Not Increasing

**Symptoms:** XP stays at 0 no matter how much browsing

**Causes:**
1. XP not initialized on load
2. Navigation events not triggering
3. All pages in cooldown window

**Solution:**
```javascript
// Background console (chrome://extensions → service worker):
// Should see: "GuardianCore Audit Probe v0.4.3 loaded"
// Should see: XP award messages or cooldown messages

// If not:
chrome.storage.local.get('gc_xp_state', console.log)
// Should show: { dayKey: "2025-10-04", xp: N, level: M }

// Force refresh:
chrome.runtime.reload()
```

### Issue: Rules Not Loading After Config Save

**Symptoms:** Save backend config, but rules list stays empty

**Cause:** Fixed in 0.4.3 (auto-refresh implemented)

**If still broken:**
```javascript
// Options page console:
// Should see: [Options] Loaded N rules

// Check:
chrome.storage.local.get(['gc_backend_url', 'gc_api_token'], console.log)

// Manually trigger:
chrome.runtime.sendMessage({ type: "REFRESH_RULES" })
```

### Issue: XP Farming (Refresh Spam)

**Symptoms:** Refreshing same page farms XP

**Expected Behavior (v0.4.3):** 30-second cooldown per URL

**Verify:**
```javascript
// Background console should show:
"[XP] Cooldown active for https://example.com (25s remaining)"

// If not seeing cooldowns:
// Check version: should be v0.4.3 or higher
```

### Issue: PIN Creation Hangs

**Symptoms:** Enter PIN, click Create, nothing happens

**Cause:** Fixed in 0.4.3 (crypto module auto-generates salt)

**Solution:**
```javascript
// Options console should show:
[Options] Script starting v0.4.4...
[Options] Crypto module loaded: [object Object]

// If undefined:
// Reload extension
```

### Issue: Recovery Codes Don't Download

**Symptoms:** Click Regenerate, enter PIN, no file downloads

**Cause:** Fixed in 0.4.3 (batch structure corrected)

**Solution:**
```javascript
// Check manifest has "downloads" permission
// Check browser download settings
// Try incognito mode
```

**Modified Files:**
- `manifest.json` - Version updates, downloads permission
- `options.js` - PIN + recovery + backend config + fast mode persistence
- `options.html` - Security tab renamed to Options; rule explanations removed; fast mode toggle added
- `popup.js` - Dev unlock (5× 'D'), risk breakdown, simulation handlers
- `popup.html` - Risk breakdown container, hidden Dev Tools panel
- `background.js` - Active-time streak accumulator, heartbeat, fast mode, dev message handlers

**Lines Changed:**
- `options.js`: 661 lines (was 605)
- `crypto.js`: 261 lines (new)
- `background.js`: ~50 lines added
- `popup.js`: ~30 lines added

---

## Changelog

### [0.4.5] - 2025-10-04

**Added:**
- Domain & global scheduled time windows with `action` (block / allow)
- Allow-only windows (outside window implicitly blocked)
- Mandatory reason field for all rule types
- Rule timestamps & scope label (24h vs Window)
- `make db-reset` developer convenience target

**Changed:**
- Time window pattern JSON now includes `action` and optional `domain`
- Formatter shows `[BLOCK window]` or `[ALLOW window]` plus domain if present

**Fixed:**
- Domain-specific windows no longer apply globally

### [0.4.4] - 2025-10-04

**Added:**
- XP balance tuning: tracker penalty -0.5 (max -2.5), negative floor -5
- Simplified recovery codes UI (one-time display only)

**Removed:**
- Recovery status table (reduced sensitive code exposure)

**Fixed:**
- Edge cases around used recovery code visibility

### [0.4.3] - 2025-10-04

**Added:**
- XP-only gamification system (removed risk score & safe streak)
- XP farming prevention (30-second per-URL cooldown)
- "How you earn XP" explanation in popup
- "Remaining XP to next level" indicator
- Dev Reset XP button
- Auto-refresh rules after backend config save
- Extracted XP styles to dedicated `xp.css`

**Fixed:**
- XP not increasing (tracker count captured before reset)
- PIN creation hanging (hashPin auto-generates salt)
- Recovery codes not downloading (batch structure fixed)
- Rules not loading after config save (auto-refresh implemented)
- XP farming via refresh spam (cooldown system)

**Changed:**
- Popup UI: Removed streak/risk, focused on XP progress
- Background: Simplified to XP-only logic
- Documentation: Merged into single comprehensive guide

**Removed:**
- Risk score polling & display
- Safe streak accumulation & heartbeat
- Time-left nudges
- Risk breakdown dev panel
- Unused storage keys: `browserStartTime`, `gc_active_ms`

### [0.4.2] - 2025-10-04

**Added:**
- Active-time safe streak (replaced elapsed time model)
- Fast mode toggle (dev testing: 1 min = 1 hour)
- Dev tools panel (unlock: press D 5×)
- Simulate violation button
- Add safe hours button
- Manual risk refresh button

**Changed:**
- Streak calculation to active browsing time
- Heartbeat interval (5 min normal / 10s fast mode)
- Export/Import endpoints to `/rules/all/export` & `/rules/all/import`

### [0.4.1] - 2025-10-04

**Security Fixes:**
- Recovery code regeneration now requires PIN
- Closed unauthorized access loophole

**UX Improvements:**
- First-time PIN setup flow cleaned up
- Forgot PIN flow with format validation
- Error messages with emojis

### [0.4.0] - 2025-10-04

**Initial Week 4 Release:**
- PBKDF2 PIN storage (310k iterations)
- Recovery codes system (10 one-time codes)
- Risk scoring backend endpoint
- Safe streak tracking
- Real-time background updates (30s polling)
- Role separation (parent options vs child popup)
- Rule explanations removed
- Factory reset

---

## 🧱 Storage Keys Reference

### Active Keys (v0.4.3)

| Key | Type | Purpose |
|-----|------|---------|
| `pin` | Object | PBKDF2-hashed PIN data |
| `recovery_batches` | Array | Hashed recovery code batches |
| `gc_backend_url` | String | Backend API URL |
| `gc_api_token` | String | Backend auth token |
| `gc_xp_state` | Object | { dayKey, xp, level } |
| `gc_fast_mode` | Boolean | Dev fast mode toggle |

### Deprecated Keys (Safe to Remove)

| Key | Reason | Since |
|-----|--------|-------|
| `browserStartTime` | Streak system removed | 0.4.3 |
| `gc_active_ms` | Streak system removed | 0.4.3 |
| `lastViolation` | Only used for XP penalty now | 0.4.3 |

---

## 🚀 Future Enhancements

### Backlog

- [ ] Parent dashboard: weekly XP trends, achievement history
- [ ] Achievement badges (first clean day, 5 consecutive safe pages, etc.)
- [ ] Rate limiting on PIN attempts
- [ ] WebAuthn implementation (replace stubs)
- [ ] Sunset `/risk/score` backend endpoint (unused since 0.4.3)
- [ ] Optional positive streak multiplier (if simple enough)
- [ ] Persistent notification for level-ups
- [ ] XP delta toast ("+5 XP" near progress bar)

### Completed

- [x] XP-only gamification
- [x] XP farming prevention
- [x] Auto-refresh rules after config save
- [x] PIN creation flow fixes
- [x] Recovery code download fixes
- [x] Dev Reset XP button
- [x] Extract XP styles to CSS

---

## 📝 Developer Notes

### XP System Architecture

**Local-First Design:** All XP logic runs in `background.js` service worker. No server calls, instant feedback.

**Daily Reset:** Uses UTC ISO date string (`YYYY-MM-DD`) as key. Checked on every XP mutation and GET_XP_STATE request.

**Cooldown Map:** `Map<url, timestamp>` tracks last XP award per URL. Limited to 100 entries to prevent memory leak.

### Code Organization

```
app-extension/
├── background.js    # Core: rules, enforcement, audit, XP
├── popup.js         # Child UI: read-only, XP display
├── options.js       # Parent UI: PIN-gated, rules CRUD
├── crypto.js        # PBKDF2, recovery codes, salt generation
├── xp.css           # XP bar & explanation styles
└── manifest.json    # Extension config, permissions
```

### Testing Checklist

- [ ] PIN creation works (alert shows codes)
- [ ] Recovery codes download as .txt
- [ ] Options page unlocks after PIN entry
- [ ] Rules load after backend config save (no refresh)
- [ ] XP increases on navigation
- [ ] XP cooldown prevents refresh farming
- [ ] Dev tools work (simulate violation, reset XP)
- [ ] Daily XP resets at UTC day boundary

---

*GuardianCore v0.4.3 - Privacy-First Parental Controls*
