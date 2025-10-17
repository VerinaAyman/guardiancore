# GDPR-Compliant Parental Activity Dashboard

## Overview

The Activity Dashboard provides parents with actionable insights into their children's browsing activity while maintaining full GDPR compliance. Parents can view domain-level summaries, security indicators, and take immediate action to block or allow domains directly from the dashboard.

## Key Features

### 📊 Domain-Level Activity Tracking
- **Aggregated by domain** (eTLD+1 only, e.g., "youtube.com")
- **Time spent** per domain (minutes/day)
- **Visit counts** and **blocked attempts**
- **Security indicators**: CSP and CORS presence
- **No full URLs, page titles, or content stored**

### 🔒 GDPR Compliance

#### Data Minimization
- Only captures domain (eTLD+1), not full URLs
- No page titles, messages, or content
- No second-level timestamps (day-level only in summaries)
- Domain hashing for privacy

#### Lawful Basis & Consent
- **Explicit opt-in** required per child
- **Default OFF** until parent enables
- Clear consent dialog with full explanation
- Parent can disable at any time

#### Transparency
- **Parent notice**: Clear explanation of what is collected and why
- **Child notice**: Visible notification when tracking is active
- **Dashboard disclaimer**: GDPR compliance statement prominently displayed

#### Storage Limitation
- **Raw events**: Auto-deleted after ≤30 days
- **Daily summaries**: Auto-deleted after ≤90 days
- Automatic retention jobs run hourly

#### Access Control
- **Parent-only access** with JWT authentication
- **Child cannot view dashboard** (403 Forbidden)
- **Scoped access**: Parents can only view their own children's data
- **No cross-parent data leakage**

#### Security
- Domain hashing (SHA-256) for privacy
- HTTPS required in production
- JWT tokens with expiration
- No sensitive data in logs

### ⚡ Actionable Insights

Parents can take immediate action from the dashboard:
- **Block** a domain → Creates blocklist rule for child/group
- **Allow** a domain → Creates allowlist rule (overrides blocklist)
- Rules take effect immediately after next sync

### 📋 Ready-to-Use Notices

#### Parent Consent Toggle
```
"Enable activity summaries for this child. This records domain-level 
usage (e.g., 'youtube.com', minutes per day) and basic security signals 
(CSP/CORS). No page titles, messages, or full URLs are stored. Data is 
deleted automatically after a short period."
```

#### Child Notification
```
"Your parent can see which websites you visit at the domain level and 
how long you spend on them, plus basic security settings (CSP/CORS). 
No messages or page content are collected. This helps set fair rules."
```

#### Dashboard Disclaimer
```
"These insights are provided for parental guidance. Data is minimized, 
retained briefly, and never shared. You can disable tracking at any time."
```

## Architecture

### Backend (Python/FastAPI)

#### Database Tables
- `child_activity_settings`: Opt-in tracking per child
- `activity_events`: Raw events (30-day retention)
- `activity_summaries`: Daily aggregates (90-day retention)

#### API Endpoints
- `POST /activity/events` - Capture activity (child only)
- `GET /activity/settings/{child_id}` - Get tracking settings (parent only)
- `POST /activity/settings` - Enable/disable tracking (parent only)
- `GET /activity/dashboard/{child_id}` - View dashboard (parent only)
- `POST /activity/actions` - Block/allow domain (parent only)
- `GET /activity/status` - Check tracking status (authenticated)

#### Data Flow
1. **Child browses** → Extension captures domain + metadata
2. **Extension sends** event to `/activity/events` (if tracking enabled)
3. **Backend stores** in `activity_events` table (expires in 30 days)
4. **Hourly job aggregates** events into `activity_summaries` (expires in 90 days)
5. **Parent views** dashboard → Queries `activity_summaries`
6. **Cleanup job** deletes expired events and summaries

### Frontend (Browser Extension)

#### Background Script (`background.js`)
- Tracks tab navigation and time spent
- Extracts eTLD+1 domain from URLs
- Detects CSP/CORS headers
- Sends events to backend only if tracking enabled
- Captures blocked attempts

#### Dashboard UI (`dashboard.html`, `dashboard.js`)
- Parent authentication required
- Child selector dropdown
- Domain activity table with:
  - Domain name
  - Total time spent
  - Time spent today
  - Visit count
  - Blocked attempts
  - CSP/CORS indicators
  - Block/Allow action buttons
- GDPR compliance notice
- Date range selector (7/30 days)

#### Child Options (`child-options.html`, `child-options.js`)
- Displays tracking notice when enabled
- Clear explanation of what is/isn't collected
- Privacy information and retention policy

## Usage

### Parent Workflow

#### 1. Enable Tracking
1. Open extension options
2. Navigate to "Children" tab
3. Click "Manage Tracking" for desired child
4. Review consent dialog
5. Click "Enable Activity Tracking"

#### 2. View Dashboard
1. Click "📊 Activity Dashboard" in options
2. Select child from dropdown
3. Review domain activity table
4. Check security indicators (CSP/CORS)
5. View blocked attempts

#### 3. Take Action
- **Block domain**: Click "Block" button → Confirms → Creates blocklist rule
- **Allow domain**: Click "Allow" button → Confirms → Creates allowlist rule
- Rules sync automatically to child's extension

#### 4. Disable Tracking
1. Select child in dashboard
2. Click "Disable Tracking"
3. Confirm action
- Existing data retained until expiry (30-90 days)
- No new events captured

### Child Experience

#### When Tracking is Enabled
1. **Notification appears** in extension options
2. Clear explanation of what is collected
3. Assurance about privacy (no content, messages, etc.)
4. Information about retention period

#### Browsing Behavior
- No visible changes to browsing experience
- Extension silently captures domain-level activity
- Blocked sites work as before
- No performance impact

## Technical Details

### Domain Extraction (eTLD+1)
```javascript
function extractDomain(url) {
  const parsed = new URL(url);
  const hostname = parsed.hostname;
  const parts = hostname.split('.');
  if (parts.length >= 2) {
    return parts.slice(-2).join('.');
  }
  return hostname;
}
```

Examples:
- `https://www.youtube.com/watch?v=123` → `youtube.com`
- `https://mail.google.com/inbox` → `google.com`
- `https://sub.example.co.uk` → `co.uk` (needs proper eTLD parsing)

### Event Types
- `visit`: User navigates to domain
- `time_spent`: User spent time on domain (≥5 seconds)
- `blocked`: User attempted to access blocked domain

### Data Retention

#### Raw Events (`activity_events`)
- **Retention**: 30 days
- **Purpose**: Generate daily summaries
- **Cleanup**: Automatic via `expires_at` column
- **Job**: Runs hourly, deletes `WHERE expires_at < now()`

#### Daily Summaries (`activity_summaries`)
- **Retention**: 90 days
- **Purpose**: Display in dashboard
- **Aggregation**: Daily job combines events by domain/date
- **Cleanup**: Automatic via `expires_at` column

#### Aggregation Logic
```python
# Runs daily at midnight (or hourly in dev)
INSERT INTO activity_summaries (
    child_id, domain_hash, domain, summary_date,
    total_time_seconds, visit_count, blocked_count,
    has_csp, has_cors, expires_at
)
SELECT 
    child_id, domain_hash, domain, DATE(event_date),
    SUM(duration_seconds), 
    COUNT(CASE WHEN event_type = 'visit' THEN 1 END),
    COUNT(CASE WHEN event_type = 'blocked' THEN 1 END),
    BOOL_OR(has_csp), BOOL_OR(has_cors),
    (DATE(event_date) + INTERVAL '90 days') as expires_at
FROM activity_events
WHERE DATE(event_date) = CURRENT_DATE - INTERVAL '1 day'
GROUP BY child_id, domain_hash, domain, DATE(event_date)
ON CONFLICT (child_id, domain_hash, summary_date) DO UPDATE ...
```

### Security Considerations

#### Domain Hashing
```python
def hash_domain(domain: str) -> str:
    return hashlib.sha256(domain.encode('utf-8')).hexdigest()
```
- Used for indexing and deduplication
- Plain domain also stored for display
- Hash prevents reverse lookup attacks

#### Authentication
- JWT tokens required for all endpoints
- Parent/child role checked server-side
- Token expiry enforced (7 days default)
- Child cannot access parent endpoints (403)

#### Data Access Control
```python
async def verify_parent_owns_child(parent_id: int, child_id: int) -> bool:
    # Verify parent-child relationship before data access
    ...
```

## Configuration

### Backend Settings (`config.py`)
```python
# Activity tracking settings (future)
ACTIVITY_RAW_RETENTION_DAYS: int = 30
ACTIVITY_SUMMARY_RETENTION_DAYS: int = 90
ACTIVITY_AGGREGATION_INTERVAL: int = 3600  # 1 hour
```

### Extension Settings
- No user configuration needed
- Tracking enabled/disabled via backend API
- Automatic sync with backend

## API Examples

### Enable Tracking
```bash
curl -X POST "http://localhost:8000/activity/settings" \
  -H "Authorization: Bearer <parent_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "child_id": 2,
    "tracking_enabled": true
  }'
```

### View Dashboard
```bash
curl -X GET "http://localhost:8000/activity/dashboard/2?days=7" \
  -H "Authorization: Bearer <parent_token>"
```

Response:
```json
{
  "child_id": 2,
  "child_username": "alice",
  "tracking_enabled": true,
  "summaries": [
    {
      "domain": "youtube.com",
      "total_time_minutes": 120,
      "visit_count": 15,
      "blocked_count": 0,
      "has_csp": true,
      "has_cors": true,
      "time_spent_today": 30
    },
    {
      "domain": "tiktok.com",
      "total_time_minutes": 45,
      "visit_count": 8,
      "blocked_count": 3,
      "has_csp": false,
      "has_cors": true,
      "time_spent_today": 0
    }
  ],
  "date_range": "last 7 days"
}
```

### Block Domain
```bash
curl -X POST "http://localhost:8000/activity/actions" \
  -H "Authorization: Bearer <parent_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "child_id": 2,
    "domain": "tiktok.com",
    "action": "block",
    "target_type": "child"
  }'
```

## Future Enhancements

### Phase 7 Considerations
- [ ] Export activity data (CSV/JSON)
- [ ] Activity trends and charts
- [ ] Weekly/monthly email summaries
- [ ] Anomaly detection (unusual activity patterns)
- [ ] Category-based filtering
- [ ] Search and sort in dashboard
- [ ] Bulk actions (block/allow multiple domains)
- [ ] Activity reports with insights
- [ ] Scheduled tracking (e.g., only during school hours)

### Advanced Features
- [ ] Activity comparison between children
- [ ] Peer benchmarking (anonymized)
- [ ] Screen time goals and notifications
- [ ] Gamification for healthy browsing habits
- [ ] Integration with device screen time APIs
- [ ] Multi-device tracking (when child uses multiple browsers)

## Limitations

### Current Limitations
1. **eTLD+1 extraction** is simplified (doesn't handle complex TLDs like `.co.uk`)
   - Solution: Use public suffix list library
2. **Single-device tracking** (per browser/profile)
   - Solution: Multi-device sync in future
3. **No mobile support** yet
   - Solution: Build mobile extension/app
4. **Time tracking** pauses when tab is inactive
   - This is intentional (only tracks active viewing time)

### Privacy Trade-offs
- Storing plain domains (not just hashes) enables better UX
- Alternative: Store only hashes, use separate lookup table
- Current approach balances privacy with usability

## Support & Documentation

- **Test Guide**: See `ACTIVITY-DASHBOARD-TEST-GUIDE.md`
- **Architecture**: See `PHASE-5-ARCHITECTURE.md`
- **API Docs**: See FastAPI Swagger UI at `/docs`
- **GDPR Compliance**: See `DPIA.md`

## License

Part of GuardianCore parental control system.  
See main LICENSE file for details.
