# Week 3 — Explainable Controls (RQ-B2)

## Overview
Week 3 implements proportional parental control with explainability, demonstrating ethical design principles through transparent and user-friendly controls.

## Features Implemented

### 1. Backend - Rules CRUD API (`/rules`)

**Endpoints:**
- `POST /rules` - Create new rule (allowlist, blocklist, time_window)
- `GET /rules` - List all rules (with filtering)
- `GET /rules/{id}` - Get specific rule
- `PATCH /rules/{id}` - Update rule
- `DELETE /rules/{id}` - Delete rule

**Rule Types:**
- **Allowlist**: Sites that are always permitted (e.g., educational sites)
- **Blocklist**: Sites that are blocked with explanation (e.g., social media during study time)
- **Time Window**: Time-based restrictions (e.g., no internet 10 PM - 6 AM)

**Example Rule:**
```json
{
  "rule_type": "blocklist",
  "pattern": "tiktok.com",
  "category": "social_media",
  "explanation": "TikTok is blocked during study hours for better focus",
  "enabled": true
}
```

### 2. Plugin - Rule Enforcement

**Features:**
- Fetches rules from backend on startup and every 5 minutes
- Evaluates rules before page navigation
- Blocks pages matching blocklist patterns
- Respects allowlist (bypass other rules)
- Enforces time window restrictions
- Shows explainable blocking page

**Expanded Tracker List:**
Now includes 20+ trackers with categories:
- `advertising` - Ad networks (DoubleClick, Google Ads, etc.)
- `analytics` - Analytics services (Google Analytics)
- `social_media` - Social platforms (Facebook, Twitter, TikTok)
- `video` - Video platforms (YouTube)

### 3. Explainable UI

**Blocking Page (`blocked.html`):**
- Clear explanation of why content was blocked
- Shows rule category (e.g., "SOCIAL MEDIA")
- User-friendly language
- Option to go back

**Enhanced Popup (`popup.html`):**
- **Status Tab**: Current page statistics, active rules, blocking status
- **Stats Tab**: Audit analytics (total audits, unique origins, avg trackers, CSP/CORS coverage)
- **Settings Tab**: Backend configuration, rule refresh

**Parent Settings Page (`options.html`, `options.js`):**
- **PIN Protection**: Default PIN `1234`, customizable 4-digit PIN
- **Backend Configuration**: Set backend URL, API token, change PIN
- **Rule Management**: 
  - Add new rules (all 3 types: allowlist, blocklist, time_window)
  - View all rules with status badges
  - Enable/disable rules
  - Delete rules
  - Time window configuration with day selector
- **Real-time Sync**: Changes immediately notify background worker to refresh rules

### 4. Throttling Mechanism

**Implementation:**
- 10-second window per tab/origin combination
- Prevents duplicate audit submissions
- Uses `submit_throttle` database table
- Automatic cleanup of old records (60 min)

**Flow:**
1. Check if same origin+tab submitted within 10s
2. If yes, return throttled response (don't insert)
3. If no, insert/update throttle record and audit event

### 5. Retention Job

**Database Cleanup:**
```python
async def cleanup_old_audits(days: int = 30):
    """Delete audit records older than specified days"""
    # Deletes audit_events older than 30 days

async def cleanup_old_throttle(minutes: int = 60):
    """Delete throttle records older than specified minutes"""
    # Deletes submit_throttle older than 60 minutes
```

**Usage:**
- Can be scheduled weekly via cron or task scheduler
- Maintains GDPR compliance (data minimization)
- Prevents database bloat

### 6. Enhanced Stats Page

**New Metrics:**
- Trackers by category breakdown
- Blocked content tracking
- Time-windowed queries (24h, 7d, 30d)
- CSP/CORS coverage percentages

## Database Schema

### Rules Table
```sql
CREATE TABLE rules (
    id BIGSERIAL PRIMARY KEY,
    rule_type TEXT NOT NULL,      -- 'allowlist', 'blocklist', 'time_window'
    pattern TEXT NOT NULL,         -- domain or JSON config
    category TEXT,                 -- e.g., 'social_media', 'advertising'
    explanation TEXT,              -- Human-readable reason
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Submit Throttle Table
```sql
CREATE TABLE submit_throttle (
    id BIGSERIAL PRIMARY KEY,
    origin_hash CHAR(64) NOT NULL,
    tab_id INTEGER NOT NULL,
    last_submit TIMESTAMPTZ NOT NULL,
    UNIQUE(origin_hash, tab_id)
);
```

## Testing

### Run Complete Test Suite
```bash
./scripts/test-week3.sh
```

### Test Coverage
1. ✅ Rules CRUD operations
2. ✅ Rule filtering (by type, enabled status)
3. ✅ Throttling mechanism (10s window)
4. ✅ Enhanced audit stats
5. ✅ Database schema validation
6. ✅ Authorization checks
7. ✅ Rule deletion
8. ✅ Recent audits retrieval

### Manual Testing
1. Create rules via API or future admin UI
2. Load extension in Chrome
3. Configure backend URL and token
4. Visit blocked sites (e.g., tiktok.com)
5. Observe blocking page with explanation
6. Check popup stats tab for analytics
7. Verify rules refresh automatically

## API Examples

### Create a Blocklist Rule
```bash
curl -X POST http://localhost:8000/rules \
  -H "Authorization: Bearer dev-token-123" \
  -H "Content-Type: application/json" \
  -d '{
    "rule_type": "blocklist",
    "pattern": "instagram.com",
    "category": "social_media",
    "explanation": "Instagram is restricted to promote focus during study time",
    "enabled": true
  }'
```

### Create a Time Window Rule
```bash
curl -X POST http://localhost:8000/rules \
  -H "Authorization: Bearer dev-token-123" \
  -H "Content-Type: application/json" \
  -d '{
    "rule_type": "time_window",
    "pattern": "{\"start_hour\": 22, \"end_hour\": 6, \"days\": [0,1,2,3,4,5,6]}",
    "category": "time_restriction",
    "explanation": "Internet access is restricted between 10 PM and 6 AM",
    "enabled": true
  }'
```

### List All Rules
```bash
curl http://localhost:8000/rules?enabled_only=true \
  -H "Authorization: Bearer dev-token-123"
```

### Get Audit Stats
```bash
curl http://localhost:8000/audit/stats?window_hours=24 \
  -H "Authorization: Bearer dev-token-123"
```

## Ethical Design Principles

### 1. Transparency
- Clear explanations for blocked content
- Visible active rules in popup
- No hidden or opaque restrictions

### 2. Proportionality
- Allowlist exceptions for educational content
- Time-based restrictions (not blanket blocks)
- Category-based controls

### 3. User Empowerment
- Rules are configurable, not hardcoded
- Parents can customize patterns and explanations
- Children see why content is blocked (educational)

### 4. Privacy by Design
- No content inspection (only domain patterns)
- Origin hashing (no URL storage)
- Retention policies (30-day cleanup)
- Throttling prevents over-collection

## Future Enhancements (Post-Week 3)

1. **Parent PIN Protection**: Secure rules configuration UI
2. **Options Page**: Full rules management interface
3. **Custom Explanations**: Per-rule custom messages
4. **Schedule Templates**: Pre-configured time windows
5. **Export/Import Rules**: Share rule configurations
6. **Stats Dashboard**: Visual charts and trends
7. **Notification System**: Alert parents to blocked attempts

## Compliance Notes

- **GDPR**: Retention job ensures data minimization
- **COPPA**: Parental controls respect child privacy
- **Academic**: Demonstrates proportional control (RQ-B2)
- **Ethical**: Explainable AI/rules (not black box)

## File Structure
```
backend/src/app/
  ├── routers/rules.py          # New: Rules CRUD API
  ├── routers/audit.py          # Enhanced: Throttling, stats
  └── db.py                     # Enhanced: Rules + throttle tables

app-extension/
  ├── background-v3.js          # Enhanced: Rule enforcement
  ├── popup-v3.html             # New: 3-tab interface
  ├── popup-v3.js               # New: Stats, rules display
  ├── blocked.html              # New: Explainable blocking page
  ├── blocked.js                # New: Block reason display
  └── manifest.json             # Updated: v0.3.0, new permissions

scripts/
  └── test-week3.sh             # New: Comprehensive Week 3 tests
```

## Deliverable Summary

✅ **Backend**: Full CRUD API for rules with 3 types  
✅ **Plugin**: Rule enforcement with explainable blocking  
✅ **UI**: 3-tab popup with stats and active rules display  
✅ **Throttling**: 10s window per tab/origin  
✅ **Retention**: Cleanup jobs for audit and throttle data  
✅ **Stats**: Enhanced analytics with categories  
✅ **Trackers**: Expanded list (20+) with categories  
✅ **Tests**: Automated test suite with 8 test scenarios  

**Result**: End-to-end "rule → enforcement → explainable UI" flow implemented and tested.
