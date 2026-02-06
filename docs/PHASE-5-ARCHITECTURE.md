# GuardianCore Phase 5 Architecture Documentation

## Overview

GuardianCore is a comprehensive parental control browser extension with a sophisticated account management system, rule enforcement engine, and audit tracking capabilities. Phase 5 implements multi-user authentication, parent-child account relationships, group management, and granular rule enforcement.

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Account System](#account-system)
3. [Authentication & Authorization](#authentication--authorization)
4. [Rule Management System](#rule-management-system)
5. [Rule Enforcement Engine](#rule-enforcement-engine)
6. [Audit & Gamification System](#audit--gamification-system)
7. [Data Flow](#data-flow)
8. [Security Considerations](#security-considerations)

---

## System Architecture

### Components

```
┌─────────────────────────────────────────────────────┐
│           Chrome Extension (Manifest V3)            │
├─────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ Background   │  │   Popup      │  │  Options  │ │
│  │ Service      │  │   UI         │  │   Page    │ │
│  │ Worker       │  └──────────────┘  └───────────┘ │
│  │              │                                    │
│  │ - Auth Mgmt  │  ┌──────────────┐  ┌───────────┐ │
│  │ - Rules Load │  │ Child        │  │  Login    │ │
│  │ - Enforcement│  │ Options      │  │  Page     │ │
│  │ - Auditing   │  └──────────────┘  └───────────┘ │
│  └──────────────┘                                    │
└─────────────────────────────────────────────────────┘
                        │
                        │ HTTPS/REST API
                        │ JWT Authentication
                        ▼
┌─────────────────────────────────────────────────────┐
│              FastAPI Backend                        │
├─────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│  │   Auth   │  │ Accounts │  │  Audit   │         │
│  │  Router  │  │  Router  │  │  Router  │         │
│  └──────────┘  └──────────┘  └──────────┘         │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│  │  Rules   │  │   Risk   │  │  Health  │         │
│  │  Router  │  │  Router  │  │  Router  │         │
│  └──────────┘  └──────────┘  └──────────┘         │
└─────────────────────────────────────────────────────┘
                        │
                        │ asyncpg
                        ▼
┌─────────────────────────────────────────────────────┐
│              PostgreSQL Database                    │
├─────────────────────────────────────────────────────┤
│  • users                  • groups                  │
│  • group_members          • child_rules             │
│  • audit_events           • user_gamification       │
└─────────────────────────────────────────────────────┘
```

### Technology Stack

- **Frontend**: Chrome Extension (Manifest V3)
  - Background Service Worker
  - Popup, Options, and Login UI pages
  - declarativeNetRequest API for blocking
  - webNavigation API for time-based enforcement

- **Backend**: FastAPI (Python)
  - Async/await pattern
  - SQLAlchemy Core for database access
  - JWT-based authentication
  - RESTful API design

- **Database**: PostgreSQL
  - Relational data model
  - Foreign key constraints
  - JSON columns for flexible data

---

## Account System

### User Types

GuardianCore supports two primary account types:

#### 1. Parent Account
- **Registration**: Email + password (minimum 8 characters)
- **Authentication**: Email/password login → JWT token
- **Capabilities**:
  - Create and manage child accounts
  - Create and manage groups
  - Define rules for children and groups
  - View audit logs and statistics
  - Access gamification dashboard

#### 2. Child Account
- **Creation**: Created by parent with username
- **Authentication**: 6-digit access code → JWT token
- **Capabilities**:
  - View own rules and restrictions
  - View personal audit logs
  - Track gamification progress
  - Limited to read-only access

### Database Schema

```sql
-- Users table (unified parent and child accounts)
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR UNIQUE,              -- Only for parent accounts
    password_hash VARCHAR,             -- Only for parent accounts
    account_type VARCHAR NOT NULL,     -- 'parent' or 'child'
    username VARCHAR NOT NULL,
    access_code VARCHAR(6) UNIQUE,     -- Only for child accounts
    parent_id INTEGER REFERENCES users(id),  -- NULL for parents
    profile_data JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Groups table
CREATE TABLE groups (
    id SERIAL PRIMARY KEY,
    parent_id INTEGER NOT NULL REFERENCES users(id),
    name VARCHAR NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Group membership table (many-to-many)
CREATE TABLE group_members (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES groups(id),
    child_id INTEGER NOT NULL REFERENCES users(id),
    added_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(group_id, child_id)
);
```

### Parent-Child Relationship

```
┌──────────────────┐
│  Parent Account  │
│  (ID: 5)         │
│  Email: ...      │
└────────┬─────────┘
         │
         │ parent_id
         │
    ┌────┴─────┬───────────┬──────────┐
    │          │           │          │
┌───▼────┐ ┌──▼─────┐ ┌───▼────┐ ┌──▼─────┐
│ Child  │ │ Child  │ │ Child  │ │ Child  │
│ (ID: 6)│ │ (ID: 7)│ │ (ID: 8)│ │ (ID: 9)│
└────────┘ └────────┘ └────────┘ └────────┘
```

### Group Management

Groups allow parents to manage multiple children with shared rules:

```
┌─────────────────────────────────────────┐
│  Group: "Marvel"                        │
│  Parent: 5                              │
│  Description: "Marvel movies allowed"   │
└─────────────────┬───────────────────────┘
                  │
          ┌───────┴──────┐
          │              │
    ┌─────▼─────┐  ┌────▼──────┐
    │  Child 7  │  │  Child 8  │
    │  mahmoud  │  │   sara    │
    └───────────┘  └───────────┘
```

**Group Features**:
- Parent can create unlimited groups
- Children can belong to multiple groups
- Rules can target individual children or entire groups
- Group rules are combined with child-specific rules

---

## Authentication & Authorization

### JWT Token System

#### Token Generation
```python
def create_jwt_token(user_id: int, account_type: str) -> str:
    payload = {
        "user_id": user_id,
        "account_type": account_type,
        "exp": datetime.utcnow() + timedelta(hours=168),  # 7 days
        "iat": datetime.utcnow()
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")
```

#### Token Verification
```python
def verify_jwt_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        return payload  # Returns {user_id, account_type, exp, iat}
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")
```

### Authentication Flow

#### Parent Login
1. User submits email + password to `/auth/parent/login`
2. Backend verifies credentials with bcrypt
3. JWT token generated and returned
4. Extension stores token in `chrome.storage.local`
5. Background worker loads user context and rules

#### Child Login
1. User submits 6-digit access code to `/auth/child/login`
2. Backend looks up child by access_code
3. JWT token generated and returned
4. Extension stores token and loads child context
5. Child-specific rules loaded for enforcement

### Authorization Layers

#### 1. Backend Authorization
- **API Token**: Pre-shared tokens for system access
- **JWT Token**: User-specific authentication
- **Dual-mode**: `require_bearer()` accepts both types

```python
def require_bearer(authorization: str) -> Optional[int]:
    token = authorization.split(" ", 1)[1]
    
    # Check API token
    if token in settings.gc_api_tokens:
        return None  # API token has no user_id
    
    # Check JWT
    payload = verify_jwt_token(token)
    return payload.get("user_id")  # Return user_id for filtering
```

#### 2. Extension Authorization
- **Background Worker**: Maintains current user context
- **Storage**: `gc_auth_token`, `gc_user_id`, `gc_account_type`
- **Auto-config**: Sets default backend URL and dev token

---

## Rule Management System

### Rule Types

GuardianCore supports three rule types:

#### 1. Blocklist Rules
Block access to specific domains or URLs.

```json
{
    "id": 1,
    "rule_type": "blocklist",
    "pattern": "facebook.com",
    "enabled": true,
    "target_type": "child",
    "target_id": 7
}
```

**Enforcement**: Uses Chrome's `declarativeNetRequest` API to block matching URLs immediately.

#### 2. Allowlist Rules
Explicitly allow specific domains (overrides blocklist).

```json
{
    "id": 2,
    "rule_type": "allowlist",
    "pattern": "educational-site.com",
    "enabled": true,
    "target_type": "child",
    "target_id": 7
}
```

**Enforcement**: Checked before blocklist rules; if matched, allows access regardless of other rules.

#### 3. Time Window Rules
Restrict access to domains during specific time periods.

```json
{
    "id": 3,
    "rule_type": "time_window",
    "pattern": "youtube.com|14:00-16:00|Mon,Tue,Wed,Thu,Fri",
    "enabled": true,
    "target_type": "group",
    "target_id": 2
}
```

**Pattern Format** (pipe-delimited):
- `domain|start-end|days`
- Example: `youtube.com|09:00-17:00|Mon,Tue,Wed,Thu,Fri`

**Alternative Format** (JSON):
```json
{
    "domain": "youtube.com",
    "start": "09:00",
    "end": "17:00",
    "days": ["Mon", "Tue", "Wed", "Thu", "Fri"]
}
```

**Enforcement**: Checked on navigation; blocks access outside allowed time windows.

### Target Types

Rules can target either:

#### 1. Individual Child (`target_type: "child"`)
- Rule applies only to specific child
- Identified by `target_id` (child's user_id)

#### 2. Group (`target_type: "group"`)
- Rule applies to all members of the group
- Identified by `target_id` (group's ID)

### Rule Database Schema

```sql
CREATE TABLE child_rules (
    id SERIAL PRIMARY KEY,
    parent_id INTEGER NOT NULL REFERENCES users(id),
    target_type VARCHAR NOT NULL,      -- 'child' or 'group'
    target_id INTEGER NOT NULL,        -- child_id or group_id
    rule_type VARCHAR NOT NULL,        -- 'blocklist', 'allowlist', 'time_window'
    pattern TEXT NOT NULL,
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### Combined Rules Endpoint

The backend provides a combined rules endpoint for children:

```
GET /accounts/rules/combined/child/{child_id}
```

**Returns**:
- All rules directly targeting the child
- All rules targeting groups the child belongs to
- Combined into a single list for enforcement

**Example Response**:
```json
{
    "rules": [
        {
            "id": 1,
            "rule_type": "blocklist",
            "pattern": "facebook.com",
            "enabled": true,
            "target_type": "child",
            "target_id": 7
        },
        {
            "id": 15,
            "rule_type": "time_window",
            "pattern": "youtube.com|14:00-16:00|Mon,Tue,Wed,Thu,Fri",
            "enabled": true,
            "target_type": "group",
            "target_id": 2
        }
    ]
}
```

---

## Rule Enforcement Engine

### Architecture

```
┌────────────────────────────────────────────┐
│     Background Service Worker              │
├────────────────────────────────────────────┤
│                                            │
│  1. Initialize & Load Rules                │
│     ↓                                      │
│  2. Register Enforcement Listeners         │
│     ↓                                      │
│  3. Process Each Navigation                │
│     ↓                                      │
│  4. Apply Rule Chain                       │
│     ↓                                      │
│  5. Block or Allow                         │
│     ↓                                      │
│  6. Submit Audit Record                    │
│                                            │
└────────────────────────────────────────────┘
```

### Initialization Flow

```javascript
// On extension startup
chrome.runtime.onStartup.addListener(async () => {
    await ensureDefaultConfig();     // Set backend URL, dev token
    await initializeAuth();           // Load user context
    await loadChildRules();           // Fetch and apply rules
    setupEnforcementListeners();      // Register listeners
});
```

### Rule Loading Process

```javascript
async function loadChildRules() {
    const { gc_user_id, gc_account_type, gc_auth_token } = 
        await chrome.storage.local.get([...]);
    
    if (gc_account_type !== 'child') return;
    
    // Fetch combined rules (child + group)
    const response = await fetch(
        `${backendUrl}/accounts/rules/combined/child/${gc_user_id}`,
        { headers: { 'Authorization': `Bearer ${gc_auth_token}` } }
    );
    
    const data = await response.json();
    
    // Separate by rule type
    const blocklistRules = data.rules.filter(r => 
        r.rule_type === 'blocklist' && r.enabled
    );
    const allowlistRules = data.rules.filter(r => 
        r.rule_type === 'allowlist' && r.enabled
    );
    const timeWindowRules = data.rules.filter(r => 
        r.rule_type === 'time_window' && r.enabled
    );
    
    // Apply declarativeNetRequest rules
    await applyDeclarativeRules(blocklistRules, allowlistRules);
    
    // Store time window rules for runtime checking
    await chrome.storage.local.set({ gc_time_window_rules: timeWindowRules });
}
```

### Declarative Blocking

Uses Chrome's `declarativeNetRequest` API for instant blocking:

```javascript
async function applyDeclarativeRules(blocklistRules, allowlistRules) {
    const rules = [];
    let ruleId = 1;
    
    // Add allowlist rules (priority 2)
    for (const rule of allowlistRules) {
        rules.push({
            id: ruleId++,
            priority: 2,  // Higher priority = checked first
            action: { type: "allow" },
            condition: {
                urlFilter: rule.pattern,
                resourceTypes: ["main_frame", "sub_frame"]
            }
        });
    }
    
    // Add blocklist rules (priority 1)
    for (const rule of blocklistRules) {
        rules.push({
            id: ruleId++,
            priority: 1,
            action: { type: "block" },
            condition: {
                urlFilter: rule.pattern,
                resourceTypes: ["main_frame", "sub_frame"]
            }
        });
    }
    
    // Update dynamic rules
    await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: await getCurrentRuleIds(),
        addRules: rules
    });
}
```

### Time Window Enforcement

Time window rules are checked on navigation:

```javascript
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
    if (details.frameId !== 0) return;  // Only check top-level frames
    
    const url = new URL(details.url);
    const blocked = await evaluateTimeWindows(url);
    
    if (blocked) {
        // Redirect to blocked page
        chrome.tabs.update(details.tabId, {
            url: chrome.runtime.getURL('blocked.html')
        });
    }
});
```

### Time Window Evaluation

```javascript
async function evaluateTimeWindows(url) {
    const { gc_time_window_rules } = await chrome.storage.local.get(['gc_time_window_rules']);
    if (!gc_time_window_rules) return false;
    
    const now = new Date();
    const currentDay = now.toLocaleDateString('en-US', { weekday: 'short' });
    const currentTime = now.toTimeString().slice(0, 5);  // "HH:MM"
    
    for (const rule of gc_time_window_rules) {
        // Parse pattern (supports both JSON and pipe-delimited)
        let domain, start, end, days;
        
        try {
            // Try JSON format first
            const parsed = JSON.parse(rule.pattern);
            domain = parsed.domain;
            start = parsed.start;
            end = parsed.end;
            days = parsed.days;
        } catch {
            // Fall back to pipe-delimited format
            const parts = rule.pattern.split('|');
            domain = parts[0];
            const timeRange = parts[1].split('-');
            start = timeRange[0];
            end = timeRange[1];
            days = parts[2].split(',');
        }
        
        // Check if URL matches domain
        if (!url.hostname.includes(domain)) continue;
        
        // Check if current day is in allowed days
        if (!days.includes(currentDay)) continue;
        
        // Check if current time is within allowed window
        if (currentTime < start || currentTime > end) {
            return true;  // Outside window = blocked
        }
    }
    
    return false;  // No blocking rule matched
}
```

### Enforcement Order

1. **Allowlist** (priority 2): Checked first, always allows if matched
2. **Blocklist** (priority 1): Checked second, blocks if matched
3. **Time Window** (runtime): Checked on navigation, blocks outside window

---

## Audit & Gamification System

### Audit System

Tracks all enforcement actions and browsing activity.

#### Audit Record Structure

```javascript
{
    origin_hash: "abc123...",      // SHA-256 hash of origin
    ts_iso: "2024-01-15T10:30:00Z",  // Timestamp
    check_type: "navigation",      // Type of check
    policy_state: {
        csp_present: true,
        cors_signals: false,
        tracker_count: 3
    },
    client: {
        user_agent: "...",
        viewport: "1920x1080"
    },
    user_id: 7                     // Associated user
}
```

#### Audit Submission Flow

```
Extension (background.js)
    │
    │ POST /audit/submit
    │ Authorization: Bearer <JWT>
    │ Body: {origin_hash, ts_iso, check_type, policy_state, user_id}
    │
    ▼
Backend (audit.py)
    │
    │ 1. Extract user_id from JWT
    │ 2. Store audit record with user_id
    │ 3. Return success
    │
    ▼
Database (audit_events)
    │
    │ INSERT INTO audit_events (user_id, origin_hash, ts, ...)
    │
    ▼
Stored for statistics and reporting
```

#### Per-User Audit Statistics

```
GET /audit/stats
Authorization: Bearer <JWT>
```

**Backend Logic**:
```python
@router.get("/stats")
async def audit_stats(user_id: Optional[int] = Depends(require_bearer)):
    query = select(audit_events)
    
    # Filter by user_id if JWT is used
    if user_id is not None:
        query = query.where(audit_events.c.user_id == user_id)
    
    # Calculate statistics...
    return {
        "total_audits": total,
        "unique_origins": unique,
        "avg_trackers": avg,
        "csp_coverage": coverage,
        "recent_activity": count
    }
```

**Result**: Each user sees only their own audit statistics.

#### Audit Database Schema

```sql
CREATE TABLE audit_events (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),  -- Links to user
    origin_hash VARCHAR(64) NOT NULL,
    ts TIMESTAMP DEFAULT NOW(),
    client_ts TIMESTAMP,
    check_type VARCHAR(64),
    policy_state JSONB,
    UNIQUE(origin_hash, ts)
);
```

### Gamification System

Rewards users for safe browsing behavior with XP and levels.

#### Gamification Triggers

1. **Safe Navigation**: +10 XP per safe domain visited
2. **Blocked Threat**: +50 XP when malicious site blocked
3. **Daily Streak**: Bonus XP for consecutive days
4. **Milestone Achievements**: Level-up bonuses

#### Level Progression

```javascript
const levels = [
    { level: 1, xp_required: 0, title: "Novice Guardian" },
    { level: 2, xp_required: 100, title: "Guardian Scout" },
    { level: 3, xp_required: 300, title: "Guardian Knight" },
    { level: 4, xp_required: 600, title: "Guardian Champion" },
    { level: 5, xp_required: 1000, title: "Guardian Master" }
];
```

#### XP Award Flow

```javascript
async function awardXP(points, reason) {
    const { gc_user_id, gc_auth_token, gc_backend_url } = 
        await chrome.storage.local.get([...]);
    
    await fetch(`${gc_backend_url}/gamification/award`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${gc_auth_token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            user_id: gc_user_id,
            points: points,
            reason: reason
        })
    });
    
    // Update UI
    await updateGamificationDisplay();
}
```

#### Database Schema

```sql
CREATE TABLE user_gamification (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE REFERENCES users(id),
    day_key VARCHAR NOT NULL,  -- "YYYY-MM-DD"
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    updated_at TIMESTAMP DEFAULT NOW()
);
```

---

## Data Flow

### Complete User Journey: Child Login & Enforcement

```
1. User Opens Extension
   │
   ├─→ No auth token?
   │   └─→ Redirect to login.html
   │
   ├─→ Has auth token?
   │   ├─→ Verify token with /auth/verify
   │   └─→ Load user context
   │
   ▼

2. Child Logs In (login.html)
   │
   ├─→ Enter 6-digit access code
   ├─→ POST /auth/child/login
   ├─→ Backend verifies code
   ├─→ Returns JWT token + user data
   └─→ Store in chrome.storage.local
   │
   ▼

3. Background Worker Initializes
   │
   ├─→ ensureDefaultConfig()
   │   └─→ Set gc_backend_url, gc_api_token
   │
   ├─→ initializeAuth()
   │   └─→ Load currentUser from storage
   │
   ├─→ loadChildRules()
   │   ├─→ GET /accounts/rules/combined/child/{id}
   │   ├─→ Parse blocklist, allowlist, time_window
   │   └─→ Apply declarativeNetRequest rules
   │
   └─→ Setup enforcement listeners
   │
   ▼

4. User Navigates to URL
   │
   ├─→ webNavigation.onBeforeNavigate fires
   │
   ├─→ Check allowlist (priority 2)
   │   └─→ If matched, allow immediately
   │
   ├─→ Check blocklist (priority 1)
   │   └─→ If matched, block via declarativeNetRequest
   │
   ├─→ Check time window rules
   │   ├─→ Parse domain, time range, days
   │   ├─→ Compare current time
   │   └─→ If outside window, redirect to blocked.html
   │
   └─→ If all checks pass, allow navigation
   │
   ▼

5. Submit Audit Record
   │
   ├─→ webNavigation.onCompleted fires
   ├─→ Create audit record with user_id
   ├─→ POST /audit/submit
   │   └─→ Store in audit_events table
   │
   └─→ Award XP if safe site
   │
   ▼

6. User Views Statistics
   │
   ├─→ Open popup.js or child-options.js
   ├─→ GET /audit/stats
   │   └─→ Backend filters by JWT user_id
   ├─→ GET /gamification/stats
   └─→ Display personalized data
```

### Parent Managing Child Rules

```
1. Parent Logs In
   │
   ├─→ POST /auth/parent/login (email + password)
   ├─→ Receive JWT token
   └─→ Redirect to options.html
   │
   ▼

2. Parent Views Children
   │
   ├─→ GET /accounts/parent/{parent_id}/children
   └─→ Display list of children
   │
   ▼

3. Parent Creates Group
   │
   ├─→ POST /accounts/parent/{parent_id}/groups
   │   Body: {name: "Marvel", description: "..."}
   │
   └─→ Backend creates group, returns ID
   │
   ▼

4. Parent Adds Child to Group
   │
   ├─→ POST /accounts/groups/{group_id}/members
   │   Body: {child_id: 7}
   │
   └─→ Backend adds to group_members table
   │
   ▼

5. Parent Creates Rule
   │
   ├─→ POST /accounts/parent/{parent_id}/rules
   │   Body: {
   │       target_type: "group",
   │       target_id: 2,
   │       rule_type: "time_window",
   │       pattern: "youtube.com|14:00-16:00|Mon,Tue,Wed,Thu,Fri"
   │   }
   │
   └─→ Backend stores in child_rules table
   │
   ▼

6. Child Extension Reloads Rules
   │
   ├─→ Periodic refresh (every 5 minutes)
   │   OR
   ├─→ Manual refresh via AUTH_UPDATED message
   │
   ├─→ GET /accounts/rules/combined/child/{child_id}
   └─→ Update enforcement rules
```

---

## Security Considerations

### Password Security

- **Hashing**: bcrypt with automatic salt generation
- **Minimum Length**: 8 characters
- **Storage**: Only hashed password stored, never plaintext

```python
# Registration
password_hash = bcrypt.hash(password)

# Login
if not bcrypt.verify(password, user.password_hash):
    raise HTTPException(401, "Invalid credentials")
```

### Token Security

- **JWT Expiration**: 7 days (168 hours)
- **Secure Storage**: Chrome's `storage.local` (encrypted by browser)
- **Transmission**: HTTPS only, Bearer token in Authorization header
- **Validation**: Every request verifies token signature and expiration

### Child Access Code Security

- **Format**: 6-digit numeric code
- **Generation**: Cryptographically secure random (`secrets` module)
- **Uniqueness**: Database constraint ensures no duplicates
- **Display**: Shown once to parent, child must keep it secret

```python
def generate_child_code() -> str:
    return ''.join([str(secrets.randbelow(10)) for _ in range(6)])
```

### API Security

- **Authentication Required**: All endpoints require Bearer token
- **Dual-mode Auth**: Accepts both API tokens (dev) and JWT (users)
- **CORS**: Configured to allow only extension origin
- **Rate Limiting**: (Recommended for production)

### Data Privacy

- **User Isolation**: Each user sees only their own data
- **Query Filtering**: All database queries filter by `user_id`
- **Audit Logs**: Per-user isolation prevents cross-user data leakage
- **Parent-Child Boundary**: Children cannot access parent data

### Extension Security

- **Manifest V3**: Uses latest Chrome extension security model
- **No eval()**: No dynamic code execution
- **CSP**: Content Security Policy enforced
- **Host Permissions**: Minimal, only what's needed
- **Background Worker**: Isolated from web pages

---

## API Reference

### Authentication Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/auth/parent/register` | POST | None | Register new parent account |
| `/auth/parent/login` | POST | None | Parent login with email/password |
| `/auth/child/login` | POST | None | Child login with access code |
| `/auth/verify` | POST | JWT | Verify token validity |

### Account Management Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/accounts/parent/{parent_id}/children` | GET | JWT | List parent's children |
| `/accounts/parent/{parent_id}/children` | POST | JWT | Create new child account |
| `/accounts/parent/{parent_id}/groups` | GET | JWT | List parent's groups |
| `/accounts/parent/{parent_id}/groups` | POST | JWT | Create new group |
| `/accounts/groups/{group_id}/members` | GET | JWT | List group members |
| `/accounts/groups/{group_id}/members` | POST | JWT | Add child to group |
| `/accounts/groups/{group_id}/members/{child_id}` | DELETE | JWT | Remove child from group |

### Rule Management Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/accounts/parent/{parent_id}/rules` | GET | JWT | List all parent's rules |
| `/accounts/parent/{parent_id}/rules` | POST | JWT | Create new rule |
| `/accounts/rules/{rule_id}` | GET | JWT | Get specific rule |
| `/accounts/rules/{rule_id}` | PATCH | JWT | Update rule (enable/disable) |
| `/accounts/rules/{rule_id}` | DELETE | JWT | Delete rule |
| `/accounts/rules/combined/child/{child_id}` | GET | JWT | Get combined child+group rules |

### Audit Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/audit/submit` | POST | JWT/API | Submit audit record |
| `/audit/recent` | GET | JWT | Get recent audits (filtered by user) |
| `/audit/stats` | GET | JWT | Get audit statistics (filtered by user) |

### Gamification Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/gamification/stats` | GET | JWT | Get user's XP and level |
| `/gamification/award` | POST | JWT | Award XP to user |

---

## Configuration

### Backend Configuration (`.env`)

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/guardiancore

# Security
SECRET_KEY=your-secret-key-here
GC_API_TOKENS=dev-token-1,dev-token-2

# Server
HOST=0.0.0.0
PORT=8000
```

### Extension Configuration

Auto-configured on first load:

```javascript
{
    gc_backend_url: "http://localhost:8000",
    gc_api_token: "dev-token-placeholder",
    gc_config_initialized: true
}
```

### Docker Deployment

```yaml
version: '3.8'
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: guardiancore
      POSTGRES_USER: gcuser
      POSTGRES_PASSWORD: gcpassword
    ports:
      - "5432:5432"
  
  backend:
    build: ./backend
    environment:
      DATABASE_URL: postgresql://gcuser:gcpassword@postgres:5432/guardiancore
      SECRET_KEY: ${SECRET_KEY}
      GC_API_TOKENS: ${GC_API_TOKENS}
    ports:
      - "8000:8000"
    depends_on:
      - postgres
```

---

## Testing

### Manual Testing Checklist

#### Account System
- [ ] Parent registration with email/password
- [ ] Parent login with credentials
- [ ] Child account creation by parent
- [ ] Child login with access code
- [ ] JWT token expiration handling

#### Group Management
- [ ] Create group
- [ ] Add children to group
- [ ] Remove children from group
- [ ] View group members

#### Rule Management
- [ ] Create blocklist rule (child target)
- [ ] Create allowlist rule (group target)
- [ ] Create time window rule
- [ ] Enable/disable rule
- [ ] Delete rule
- [ ] Combined rules endpoint returns child+group rules

#### Rule Enforcement
- [ ] Blocklist blocks domain immediately
- [ ] Allowlist overrides blocklist
- [ ] Time window blocks outside allowed hours
- [ ] Time window allows inside allowed hours
- [ ] Extension reloads rules after changes

#### Audit System
- [ ] Audit records submitted with user_id
- [ ] Per-user audit statistics filtering
- [ ] Recent audits filtered by user
- [ ] Audit stats updated in real-time

#### Gamification
- [ ] XP awarded for safe browsing
- [ ] Level progression works
- [ ] Stats display correctly per user

### Automated Testing

```bash
# Backend tests
cd backend
python -m pytest tests/

# Extension tests
cd app-extension
npm test
```

---

## Troubleshooting

### Common Issues

#### Rules Not Enforcing
1. Check if rules are enabled in database
2. Verify combined endpoint returns rules
3. Check console logs for rule loading errors
4. Ensure declarativeNetRequest permissions granted

#### Time Window Not Working
1. Verify pattern format (pipe-delimited or JSON)
2. Check current time vs. allowed window
3. Ensure webNavigation listener registered
4. Check for timezone issues

#### Login Issues
1. Verify backend URL is correct
2. Check JWT token in storage
3. Verify database connection
4. Check password hash matches

#### Audit Stats Not Showing
1. Verify user_id is being sent in audit records
2. Check JWT token contains user_id
3. Ensure backend filters by user_id
4. Check database has audit records for user

---

## Future Enhancements

### Planned Features
- [ ] Mobile app support
- [ ] Real-time rule sync via WebSocket
- [ ] Advanced reporting dashboard
- [ ] AI-powered content categorization
- [ ] Multi-language support
- [ ] Parental controls API for third-party apps

### Performance Optimizations
- [ ] Rule caching with TTL
- [ ] Audit batching for reduced API calls
- [ ] Database query optimization
- [ ] CDN for static assets

### Security Enhancements
- [ ] Rate limiting per user
- [ ] Audit log encryption
- [ ] Two-factor authentication
- [ ] Session management improvements

---

## Conclusion

GuardianCore Phase 5 implements a complete, production-ready parental control system with:

✅ **Multi-user account system** (parent/child)  
✅ **Group management** for shared rules  
✅ **Three rule types** (blocklist, allowlist, time window)  
✅ **Real-time enforcement** via Chrome extension  
✅ **Per-user audit tracking** with statistics  
✅ **Gamification system** for engagement  
✅ **JWT authentication** with secure token management  
✅ **RESTful API** with comprehensive endpoints  

The system is designed for scalability, security, and user privacy, with clear separation between parent and child accounts and robust rule enforcement across individual and group targets.

---

**Document Version**: 1.0  
**Last Updated**: January 2025  
**Phase**: 5 (Account System Complete)
