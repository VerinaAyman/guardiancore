# GuardianCore Week 4 - Complete Documentation

**Version:** 0.4.5  
**Branch:** phase-4  
**Focus:** XP-Only Gamification, Per-Domain Scheduling, Security Hardening

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Gamification System](#gamification-system)
4. [Scheduling System](#scheduling-system)
5. [Security Enhancements](#security-enhancements)
6. [Testing Guide](#testing-guide)
7. [API Reference](#api-reference)
8. [Troubleshooting](#troubleshooting)

---

## Overview

GuardianCore provides privacy-focused parental controls through a Chrome extension with backend API. The system uses local XP-based gamification, flexible per-domain scheduling, and PIN-protected configuration.

### Key Features

- **XP-Only Gamification**: Instant feedback on every navigation
- **Per-Domain Scheduling**: Block or allow specific sites during time windows
- **Global Curfews**: Block all browsing during specified hours
- **PIN Protection**: PBKDF2-secured parent settings
- **Recovery Codes**: 10 one-time backup codes for PIN recovery
- **XP Farming Prevention**: 30-second cooldown per URL
- **Auto-Refresh**: Rules load immediately after configuration

---

## Quick Start

### 1. Start Backend

```bash
cd guardiancore
docker compose up -d

# Verify services
docker compose ps
# Expected: db (healthy), backend (Up)

curl http://localhost:8000/health
# Expected: {"status":"ok","name":"GuardianCore","env":"dev"}
```

### 2. Load Extension

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" → Select `app-extension` folder
4. Pin extension to toolbar

### 3. Configure Extension

**Create PIN:**
1. Right-click extension → "Options"
2. Enter PIN (≥4 digits), confirm
3. Save the 10 recovery codes shown (one-time display!)

**Configure Backend:**
1. Settings tab
2. Backend URL: `http://localhost:8000`
3. API Token: `dev-token-123`
4. Click "Save Backend Settings"

---

## Gamification System

### How It Works

The extension awards XP (experience points) on every page load based on privacy/security signals. XP accumulates toward levels (100 XP = 1 level). Daily XP resets at UTC midnight, but levels persist.

### XP Rules (v0.4.5)

| Event / Condition | XP Delta | Notes |
|-------------------|----------|-------|
| Base per page load | +1 | Every navigation |
| Page has CSP header | +2 | Security bonus |
| Page exposes CORS signals | +1 | Privacy indicator |
| Zero trackers detected | +3 | Clean page bonus |
| Each tracker (up to 5) | **−0.5 each** | Max penalty: −2.5 |
| Blocked / violation | −5 | Heavy penalty maintained |
| Fast Mode (dev) | ×3 | Multiplies final delta |

**Mechanics:**
- XP floors at 0 (never negative overall)
- Level up every 100 XP (remainder carries over)
- Daily reset at UTC day boundary; **level persists**
- Single-event negative delta floored at −5
- Tracker penalty gentler for real-world browsing

### Daily Reset Logic

Stored state: `gc_xp_state`
```json
{ "dayKey": "2025-10-09", "xp": 57, "level": 3 }
```

On any XP mutation:
1. Check if `dayKey !== today`
2. If true: reset `xp = 0`, keep `level`, update `dayKey`
3. Persist to storage

### XP Farming Prevention (v0.4.3)

**Problem:** Spamming refresh (F5) awarded XP repeatedly.

**Solution:** 30-second per-URL cooldown.

```javascript
const recentNavigations = new Map(); // url -> timestamp
const XP_COOLDOWN_MS = 30000;

if (timeSinceLastAward >= XP_COOLDOWN_MS) {
  awardXp(...);
  recentNavigations.set(url, now);
}
```

**Result:** Refreshing same page won't farm XP. Must navigate elsewhere or wait 30s.

### Popup UX

**Visible:**
- Level (persistent across days)
- Daily XP (resets at UTC day boundary)
- Progress bar (0-100%, visual XP/100)
- "X XP to next level" text
- "How you earn XP" explanation list

**Removed:**
- Safe Streak hours
- Risk score color indicator
- Time restriction nudges

---

## Scheduling System

### Overview (v0.4.5)

Create time windows that apply **globally** or **per-domain** with two modes:

1. **Block Window**: Block access during specified hours
2. **Allow Window**: Only allow during specified hours (outside = blocked)

### Rule Types

#### Domain-Specific Block Window
**Use Case:** "Block TikTok during school hours (8AM-5PM weekdays)"

```json
{
  "rule_type": "time_window",
  "pattern": {
    "start_hour": 8,
    "end_hour": 17,
    "days": [1, 2, 3, 4, 5],
    "action": "block",
    "domain": "tiktok.com"
  },
  "explanation": "No social media during school"
}
```

**Behavior:**
- 8AM-5PM Mon-Fri: `tiktok.com` blocked
- Outside window OR other domains: No effect
- Domain-specific = surgical control

#### Domain-Specific Allow Window
**Use Case:** "Only allow educational sites 9AM-6PM"

```json
{
  "rule_type": "time_window",
  "pattern": {
    "start_hour": 9,
    "end_hour": 18,
    "days": [1, 2, 3, 4, 5],
    "action": "allow",
    "domain": "khanacademy.org"
  },
  "explanation": "Study time access"
}
```

**Behavior:**
- 9AM-6PM Mon-Fri: `khanacademy.org` allowed
- Outside window: `khanacademy.org` **blocked**
- Other domains: Unaffected

#### Global Block Window (Curfew)
**Use Case:** "No browsing after bedtime (10PM-7AM)"

```json
{
  "rule_type": "time_window",
  "pattern": {
    "start_hour": 22,
    "end_hour": 7,
    "days": [0, 1, 2, 3, 4, 5, 6],
    "action": "block",
    "domain": null
  },
  "explanation": "Bedtime curfew"
}
```

**Behavior:**
- 10PM-7AM every day: **All sites blocked** (except allowlist)
- Domain field empty = global scope

### Precedence Chain

1. **Allowlist** → Always accessible
2. **Allow Windows (domain)** → If in window, allow; else block that domain
3. **Block Windows (domain)** → If in window, block that domain
4. **Block Windows (global)** → If in window, block all non-allowlisted sites
5. **Blocklist** → Always blocked

### UI Implementation

**Options Page (Add Rule):**
```html
<select id="rule-type">
  <option value="allowlist">Allowlist (Always OK)</option>
  <option value="blocklist">Blocklist (Always Blocked)</option>
  <option value="time_window">Time Window</option>
</select>

<!-- Shown when time_window selected -->
<select id="time-window-action">
  <option value="block">Block during window</option>
  <option value="allow">Allow only during window</option>
</select>

<input id="rule-pattern" placeholder="Domain (empty = global)">
<input id="start-hour" type="number" min="0" max="23">
<input id="end-hour" type="number" min="0" max="23">
<!-- Day buttons: Sun-Sat -->
<input id="rule-explanation" required placeholder="Why this rule?">
```

**Pattern Builder:**
```javascript
if (ruleType === 'time_window') {
  const action = document.getElementById('time-window-action').value;
  const domain = document.getElementById('rule-pattern').value.trim() || null;
  pattern = JSON.stringify({
    start_hour: startHour,
    end_hour: endHour,
    days: selectedDays,
    action: action,
    domain: domain
  });
}
```

### Background Enforcement (background.js)

```javascript
function evaluateTimeWindows(url) {
  const now = new Date();
  const currentHour = now.getHours();
  const currentDay = now.getDay();
  const hostname = new URL(url).hostname.replace(/^www\./,'');

  const domainAllowWindows = [];
  const domainBlockWindows = [];
  const globalBlockWindows = [];

  for (const rule of rulesCache.time_window) {
    const cfg = JSON.parse(rule.pattern);
    if (cfg.days && !cfg.days.includes(currentDay)) continue;
    
    const inWindow = (cfg.start_hour > cfg.end_hour) // overnight
      ? (currentHour >= cfg.start_hour || currentHour < cfg.end_hour)
      : (currentHour >= cfg.start_hour && currentHour < cfg.end_hour);
    
    if (cfg.domain) {
      const matchesDomain = hostname === cfg.domain || 
                           hostname.endsWith('.' + cfg.domain);
      if (!matchesDomain) continue;
      
      if (cfg.action === 'allow') {
        domainAllowWindows.push({ rule, inWindow });
      } else {
        domainBlockWindows.push({ rule, inWindow });
      }
    } else if (cfg.action === 'block') {
      globalBlockWindows.push({ rule, inWindow });
    }
  }

  // Domain allow semantics
  if (domainAllowWindows.length) {
    if (domainAllowWindows.some(w => w.inWindow)) {
      return { allowed: true, reason: 'Allowed (scheduled window)' };
    }
    return { blocked: true, reason: 'Outside allowed window' };
  }

  // Domain block semantics
  if (domainBlockWindows.some(w => w.inWindow)) {
    return { blocked: true, reason: 'Blocked (scheduled window)' };
  }

  // Global block semantics
  if (globalBlockWindows.some(w => w.inWindow)) {
    return { blocked: true, reason: 'Blocked (global curfew)' };
  }

  return { allowed: true };
}
```

### Formatting (UI Display)

```javascript
function formatTimeWindow(pattern) {
  const config = JSON.parse(pattern);
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const daysStr = config.days?.length === 7 
    ? 'All Days' 
    : config.days.map(d => dayNames[d]).join(', ');
  const domainPart = config.domain ? `${config.domain} ` : 'Global ';
  const actionTag = config.action === 'allow' 
    ? '[ALLOW window]' 
    : '[BLOCK window]';
  return `${domainPart}${config.start_hour}:00-${config.end_hour}:00 ${actionTag} (${daysStr})`;
}
```

**Example Outputs:**
- `tiktok.com 8:00-17:00 [BLOCK window] (Mon, Tue, Wed, Thu, Fri)`
- `khanacademy.org 9:00-18:00 [ALLOW window] (Mon-Fri)`
- `Global 22:00-7:00 [BLOCK window] (All Days)`

---

## Security Enhancements

### PIN Storage (PBKDF2)

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

### Recovery Codes

**Format:** `XXXX-XXXX-XXXX`

**Alphabet:** `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (32 chars, no look-alikes: I/1, O/0, S/5, Z/2)

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
- **Generate:** Creates 10 codes, shows plaintext once (alert), then deletes from storage
- **Download:** Exports as `.txt` file (`guardian_recovery_codes_YYYYMMDD_BATCHID.txt`)
- **Regenerate:** Requires PIN verification, marks old batch inactive
- **Verify:** Constant-time comparison, one-time use only
- **Forgot PIN:** Enter recovery code → Reset PIN → Auto-unlock

### Critical Security Fix: Recovery Regeneration Loophole (v0.4.1)

**Attack Vector (Before Fix):**
1. Attacker opens locked options page
2. Navigate to Recovery Codes tab
3. Regenerate codes (no PIN required)
4. Use new code to reset PIN
5. Gain access ❌

**Fix Applied:**
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

### Threat Model

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
- Physical OS access → Can export `chrome.storage.local` (OS-level threat)
- Lost PIN + Lost recovery codes → Unrecoverable (by design)
- No rate limiting on PIN attempts (implementation pending)

---

## Testing Guide

### Test 1: PIN Creation & Recovery (3 min)

```
✅ 1. Clear storage: chrome.storage.local.clear()
✅ 2. Reload extension, open Options
✅ 3. Create PIN: 1234, confirm
✅ 4. Alert shows 10 recovery codes → Save one
✅ 5. Close options
✅ 6. Reopen → Click "Forgot PIN?"
✅ 7. Enter saved code → New PIN: 5678
✅ 8. Options auto-unlocks
✅ 9. Try same code again → ❌ "Invalid or already used"
```

### Test 2: XP System & Cooldown (4 min)

```
✅ 1. Open popup → Level 1, XP 0
✅ 2. Navigate to 3 different sites → XP increases
✅ 3. Press F5 (refresh) 5× on same page → XP increases only once
✅ 4. Background console shows: "[XP] Cooldown active for [url]"
✅ 5. Wait 30s, refresh again → XP increases
✅ 6. Dev tools (D 5×) → "Simulate Violation" → XP decreases by 5
✅ 7. Dev tools → "Reset XP" → XP=0, level unchanged
```

### Test 3: Per-Domain Scheduling (5 min)

```
✅ 1. Options → Rules tab → Add Rule
✅ 2. Rule Type: Time Window
✅ 3. Window Mode: Block during window
✅ 4. Domain: tiktok.com
✅ 5. Start: 8, End: 17
✅ 6. Days: Mon-Fri (select 5 buttons)
✅ 7. Reason: "No social media during school"
✅ 8. Click Add Rule → Success
✅ 9. Rule card shows: "tiktok.com 8:00-17:00 [BLOCK window] (Mon-Fri)"
✅ 10. Navigate to tiktok.com between 8AM-5PM weekday → Blocked
✅ 11. Navigate to youtube.com same time → Allowed (other domain unaffected)
✅ 12. Navigate to tiktok.com at 6PM → Allowed (outside window)
```

### Test 4: Auto-Refresh Rules (2 min)

```
✅ 1. Options (unlocked) → Settings tab
✅ 2. Enter backend URL & token
✅ 3. Click "Save Backend Settings"
✅ 4. Success message appears + Rules list populates immediately
✅ 5. Navigate to Rules tab → Rules visible (no refresh needed)
```

### Test 5: 307 Redirect Resolution (1 min)

```
✅ 1. Open browser DevTools → Network tab
✅ 2. Navigate with extension active
✅ 3. Filter for "/rules" requests
✅ 4. Verify: Direct 200 OK response (no 307 redirect)
✅ 5. Check backend logs: No "307 Temporary Redirect" entries
```

### Backend Tests

```bash
# Health check
curl http://localhost:8000/health
# Expected: {"status":"ok","name":"GuardianCore","env":"dev"}

# Database connectivity
curl http://localhost:8000/health/db
# Expected: {"db":"ok"}

# Rules endpoint (no trailing slash)
curl http://localhost:8000/rules?enabled_only=true \
  -H "Authorization: Bearer dev-token-123"
# Expected: Direct 200 OK (no redirect)

# Audit stats
curl http://localhost:8000/audit/stats \
  -H "Authorization: Bearer dev-token-123"
# Expected: {total_audits, unique_origins, avg_trackers, ...}

# Export rules
curl http://localhost:8000/rules/all/export \
  -H "Authorization: Bearer dev-token-123" \
  > rules-backup.json

# Import rules
curl -X POST http://localhost:8000/rules/all/import \
  -H "Authorization: Bearer dev-token-123" \
  -H "Content-Type: application/json" \
  -d @rules-backup.json
```

---

## API Reference

### Backend Endpoints

#### Health & Status
```bash
GET /health
# Response: {"status":"ok","name":"GuardianCore","env":"dev"}

GET /health/db
# Response: {"db":"ok"}

GET /health/version
# Response: {"version":"0.4.5"}
```

#### Rules Management
```bash
GET /rules?enabled_only=true
# Headers: Authorization: Bearer <token>
# Response: [{rule_type, pattern, enabled, explanation, created_at}, ...]

POST /rules
# Headers: Authorization: Bearer <token>, Content-Type: application/json
# Body: {rule_type, pattern, explanation, enabled}
# Response: {id, rule_type, pattern, enabled, created_at}

DELETE /rules/{rule_id}
# Headers: Authorization: Bearer <token>
# Response: 204 No Content

GET /rules/all/export
# Headers: Authorization: Bearer <token>
# Response: {version: "1", exported_at, rules: [...]}

POST /rules/all/import
# Headers: Authorization: Bearer <token>, Content-Type: application/json
# Body: {version: "1", rules: [...]}
# Response: {imported: N, skipped: M, errors: []}
```

#### Audit System
```bash
POST /audit/submit
# Headers: Authorization: Bearer <token>, Content-Type: application/json
# Body: {origin_hash, check_type, policy_state, timestamp}
# Response: {id, created_at}

GET /audit/stats
# Headers: Authorization: Bearer <token>
# Response: {total_audits, unique_origins, avg_trackers, csp_coverage, cors_coverage}
```

#### WebAuthn (Stubs)
```bash
POST /webauthn/register/options
POST /webauthn/register/verify
POST /webauthn/assertion/options
POST /webauthn/assertion/verify
# All return: {status: "stub", message: "coming soon", available: false}
```

### Extension Messages

#### Background → Popup
```javascript
// XP Update
{type: "xp:update", xp: 57, level: 3, progress: 0.57, delta: +3}

// Stats Update
{type: "stats:update", stats: {total_audits: 123, ...}}
```

#### Popup/Options → Background
```javascript
// Get XP State
{type: "GET_XP_STATE"}
// Response: {xp: 57, level: 3, progress: 0.57}

// Refresh Rules
{type: "REFRESH_RULES"}
// Response: {ok: true}

// Dev: Toggle Fast Mode
{type: "DEV_TOGGLE_FAST_MODE"}
// Response: {ok: true, fastMode: true}

// Dev: Simulate Violation
{type: "DEV_SIMULATE_VIOLATION"}
// Response: {ok: true}

// Dev: Reset XP
{type: "DEV_RESET_XP"}
// Response: {ok: true}
```

---

## Troubleshooting

### Issue: XP Not Increasing

**Symptoms:** XP stays at 0 despite browsing

**Causes:**
1. XP not initialized on load
2. Navigation events not triggering
3. All pages in cooldown window

**Solution:**
```javascript
// Background console (chrome://extensions → service worker):
// Should see: "GuardianCore Audit Probe v0.4.5 loaded"

// Check XP state:
chrome.storage.local.get('gc_xp_state', console.log)
// Expected: {dayKey: "2025-10-09", xp: N, level: M}

// Force refresh:
chrome.runtime.reload()
```

### Issue: 307 Redirects in Backend Logs

**Symptoms:** Backend logs show:
```
INFO: "GET /rules?enabled_only=true HTTP/1.1" 307 Temporary Redirect
INFO: "GET /rules/?enabled_only=true HTTP/1.1" 200 OK
```

**Cause:** Backend routes have trailing slashes, extension calls without.

**Solution:** Remove trailing slashes from `backend/src/app/routers/rules.py`:
```python
@router.get("/rules", response_model=list[RuleResponse])  # No trailing /
```

### Issue: Docker "No such image: postgres:16"

**Symptoms:** `docker compose up` fails with image not found error.

**Causes:**
1. Image pruned/deleted
2. Stale container references old image ID
3. Docker Desktop state corruption

**Solution:**
```bash
# 1. Stop and remove containers
docker compose down

# 2. Remove stale volume (destroys data!)
docker volume rm guardiancore_pgdata

# 3. Pull image fresh
docker pull postgres:16

# 4. Restart services
docker compose up -d

# 5. If still failing, restart Docker Desktop
osascript -e 'quit app "Docker"'
sleep 5
open -a Docker
```

### Issue: Rules Not Loading After Config Save

**Symptoms:** Save backend config, rules list stays empty.

**Cause:** Fixed in v0.4.3 (auto-refresh implemented).

**Verify:**
```javascript
// Options console should show:
[Options] Loaded N rules

// Check storage:
chrome.storage.local.get(['gc_backend_url', 'gc_api_token'], console.log)

// Manual trigger:
chrome.runtime.sendMessage({type: "REFRESH_RULES"})
```

### Issue: Domain-Specific Window Blocks Globally

**Symptoms:** Time window for `tiktok.com` blocks all sites.

**Cause:** Fixed in v0.4.5 (domain matching refined).

**Verify:**
```javascript
// Background console during navigation:
// Should see: "Evaluating windows for example.com"
// Should NOT block if domain doesn't match rule's domain field

// Check rule pattern:
chrome.storage.local.get('rulesCache', (r) => {
  console.log(r.rulesCache.time_window[0].pattern);
  // Expected: {"domain":"tiktok.com", "action":"block", ...}
  // Domain field must be present for domain-specific rules
});
```

---

## Developer Notes

### Code Organization

```
app-extension/
├── background.js    # Core: rules, enforcement, audit, XP
├── popup.js         # Child UI: read-only, XP display
├── options.js       # Parent UI: PIN-gated, rules CRUD
├── crypto.js        # PBKDF2, recovery codes, salt generation
├── xp.css           # XP bar & explanation styles
└── manifest.json    # Extension config, permissions

backend/
├── src/app/
│   ├── main.py           # FastAPI app, CORS, startup
│   ├── config.py         # Settings & environment
│   ├── db.py             # Database models & init
│   └── routers/
│       ├── health.py     # Health checks
│       ├── rules.py      # Rules CRUD & export/import
│       ├── audit.py      # Audit submission & stats
│       └── webauthn.py   # WebAuthn stubs
└── Dockerfile
```

### Storage Keys

| Key | Type | Purpose |
|-----|------|---------|
| `pin` | Object | PBKDF2-hashed PIN data |
| `recovery_batches` | Array | Hashed recovery code batches |
| `gc_backend_url` | String | Backend API URL |
| `gc_api_token` | String | Backend auth token |
| `gc_xp_state` | Object | `{dayKey, xp, level}` |
| `gc_fast_mode` | Boolean | Dev fast mode toggle |

### Makefile Targets

```bash
make up          # Start services
make down        # Stop services
make logs        # View logs
make clean       # Stop and remove volumes
make db-reset    # Reset database schema
make pull        # Pull fresh images
```

---

*GuardianCore v0.4.5 - Privacy-First Parental Controls*

### [0.4.5] - October 9, 2025

**Added:**
- Per-domain scheduled time windows with `action` ("block" | "allow") and optional `domain` field
- Allow-only window semantics (outside window = implicitly blocked for that domain)
- Mandatory reason field for all rule types with UI validation
- Rule timestamps & scope labels ("Window" vs "24h") in UI
- `make db-reset` target for developer convenience
- `make pull` target for explicit image pulling
- 307 redirect resolution (removed trailing slashes from backend routes)
- Docker troubleshooting documentation and stability improvements

**Changed:**
- Time window pattern JSON format now includes `action` and `domain` fields
- Rule card formatter displays domain + action tags (e.g., `tiktok.com [BLOCK window]`)
- Domain field always visible in time window form (labeled "optional for global")
- Backend routes no longer use trailing slashes (`/rules` not `/rules/`)

**Fixed:**
- Domain-specific windows no longer apply globally (precise hostname matching)
- 307 Temporary Redirect eliminated (direct 200 OK responses)
- Docker compose startup failures due to stale container image references
- Postgres volume persistence across restarts

### [0.4.4] - October 4, 2025

**Added:**
- XP balance tuning: tracker penalty reduced to −0.5 per tracker (max −2.5)
- Negative XP floor raised from −7 to −5 (gentler penalties)
- Simplified recovery codes UI (one-time display only, no persistent table)

**Removed:**
- Recovery status table (reduced sensitive code exposure)

**Fixed:**
- Edge cases around used recovery code visibility

### [0.4.3] - October 4, 2025

**Added:**
- XP-only gamification system (removed risk score & safe streak)
- XP farming prevention via 30-second per-URL cooldown
- "How you earn XP" explanation list in popup
- "X XP to next level" indicator
- Dev Reset XP button
- Auto-refresh rules after backend config save
- Extracted XP styles to dedicated `xp.css`

**Fixed:**
- XP not increasing (tracker count now captured before reset)
- PIN creation hanging (hashPin auto-generates salt)
- Recovery codes not downloading (batch structure corrected)
- Rules not loading after config save (auto-refresh implemented)
- XP farming via refresh spam (cooldown system)

**Changed:**
- Popup UI: Removed streak/risk displays, focused on XP progress
- Background: Simplified to XP-only logic
- Documentation: Merged into single comprehensive guide

**Removed:**
- Risk score polling & display
- Safe streak accumulation & heartbeat timers
- Time-left nudges
- Risk breakdown dev panel
- Unused storage keys: `browserStartTime`, `gc_active_ms`

### [0.4.2] - October 4, 2025

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

### [0.4.1] - October 4, 2025

**Security Fixes:**
- Recovery code regeneration now requires PIN verification
- Closed unauthorized access loophole (critical)

**UX Improvements:**
- First-time PIN setup flow cleaned up
- Forgot PIN flow with format validation
- Error messages with emoji indicators

### [0.4.0] - October 3, 2025

**Initial Week 4 Release:**
- PBKDF2 PIN storage (310k iterations)
- Recovery codes system (10 one-time codes)
- Risk scoring backend endpoint
- Safe streak tracking
- Real-time background updates (30s polling)
- Role separation (parent options vs child popup)
- Rule explanations removed (security)
- Factory reset functionality

---

## Storage Keys Reference

### Active Keys (v0.4.5)

| Key | Type | Purpose |
|-----|------|---------|
| `pin` | Object | PBKDF2-hashed PIN data |
| `recovery_batches` | Array | Hashed recovery code batches |
| `gc_backend_url` | String | Backend API URL |
| `gc_api_token` | String | Backend auth token |
| `gc_xp_state` | Object | `{dayKey, xp, level}` |
| `gc_fast_mode` | Boolean | Dev fast mode toggle |

### Deprecated Keys (Safe to Remove)

| Key | Reason | Since |
|-----|--------|-------|
| `browserStartTime` | Streak system removed | v0.4.3 |
| `gc_active_ms` | Streak system removed | v0.4.3 |
| `lastViolation` | Only used for XP penalty now | v0.4.3 |

---

## Future Enhancements

### Backlog

- [ ] Parent dashboard: weekly XP trends, achievement history
- [ ] Achievement badges (first clean day, 5 consecutive safe pages, etc.)
- [ ] Rate limiting on PIN attempts
- [ ] WebAuthn implementation (replace stubs)
- [ ] Sunset `/risk/score` backend endpoint (unused since v0.4.3)
- [ ] Multiple time windows per domain (aggregated logic)
- [ ] Minute-level scheduling granularity
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
- [x] Per-domain scheduled windows
- [x] Mandatory reasons
- [x] Rule timestamps & scope tags
- [x] 307 redirect elimination
- [x] Docker stability improvements

---

## Developer Notes

### XP System Architecture

**Local-First:** All XP logic in `background.js` service worker. No server calls, instant feedback.

**Daily Reset:** UTC ISO date string (`YYYY-MM-DD`) as key. Checked on every XP mutation.

**Cooldown Map:** `Map<url, timestamp>` tracks last award per URL. Limited to 100 entries to prevent memory leak.

### Code Organization

```
app-extension/
├── background.js    # Core: rules, enforcement, audit, XP
├── popup.js         # Child UI: read-only, XP display
├── options.js       # Parent UI: PIN-gated, rules CRUD
├── crypto.js        # PBKDF2, recovery codes, salt generation
├── xp.css           # XP bar & explanation styles
└── manifest.json    # Extension config, permissions

backend/
├── src/app/
│   ├── main.py           # FastAPI app, CORS, startup
│   ├── config.py         # Settings & environment
│   ├── db.py             # Database models & init
│   └── routers/
│       ├── health.py     # Health checks
│       ├── rules.py      # Rules CRUD & export/import
│       ├── audit.py      # Audit submission & stats
│       ├── risk.py       # Risk scoring (deprecated)
│       └── webauthn.py   # WebAuthn stubs
└── Dockerfile
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
- [ ] Per-domain time windows work correctly
- [ ] Domain-specific rules don't affect other domains
- [ ] Allow windows block access outside window
- [ ] Global curfew blocks all sites (except allowlist)
- [ ] Backend returns 200 OK (no 307 redirects)
- [ ] Docker compose starts cleanly after restart

---

*GuardianCore v0.4.5 - Privacy-First Parental Controls with Flexible Scheduling*
