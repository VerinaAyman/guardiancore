# GuardianCore Quick Reference

## 🚀 Quick Start (3 Steps)

### 1. Start Backend
```bash
cd /Users/ahmedkhadrawy/guardiancore
docker compose up -d
```

### 2. Load Extension
1. Open Chrome: `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select: `/Users/ahmedkhadrawy/guardiancore/app-extension`

### 3. Configure (Choose One)

**Option A: Via Options Page (Recommended)**
1. Right-click extension icon → Options
2. Enter PIN: `1234`
3. Set URL: `http://localhost:8000`
4. Set Token: `dev-token-123`
5. Click "Save Settings"
6. Add rules using the form

**Option B: Via Popup**
1. Click extension icon
2. Go to "Settings" tab
3. Enter backend URL and token
4. Save

## 📋 Common Commands

### Backend Management
```bash
# Start services
docker compose up -d

# Stop services
docker compose down

# View logs
docker compose logs -f backend

# Restart backend
docker compose restart backend

# Check status
docker compose ps
```

### Testing
```bash
# Run all Week 3 tests
./scripts/test-week3.sh

# Run complete test suite
./scripts/complete-test.sh

# Quick health check
curl http://localhost:8000/health/
```

### API Usage
```bash
# List all rules
curl -H "Authorization: Bearer dev-token-123" \
  http://localhost:8000/rules/ | jq

# Add blocklist rule
curl -X POST http://localhost:8000/rules/ \
  -H "Authorization: Bearer dev-token-123" \
  -H "Content-Type: application/json" \
  -d '{
    "rule_type": "blocklist",
    "pattern": "tiktok.com",
    "category": "social_media",
    "explanation": "TikTok blocked during study hours",
    "enabled": true
  }'

# Get statistics
curl -H "Authorization: Bearer dev-token-123" \
  http://localhost:8000/audit/stats/ | jq

# Disable rule (ID 5)
curl -X PATCH http://localhost:8000/rules/5/ \
  -H "Authorization: Bearer dev-token-123" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'

# Delete rule (ID 5)
curl -X DELETE http://localhost:8000/rules/5/ \
  -H "Authorization: Bearer dev-token-123"
```

## 🎯 Rule Examples

### Block Social Media
```javascript
{
  rule_type: "blocklist",
  pattern: "tiktok.com",
  category: "social_media",
  explanation: "TikTok blocked during study hours"
}
```

### Allow Education Sites
```javascript
{
  rule_type: "allowlist",
  pattern: "khanacademy.org",
  category: "education",
  explanation: "Khan Academy always allowed for learning"
}
```

### School Night Bedtime
```javascript
{
  rule_type: "time_window",
  pattern: JSON.stringify({
    start_hour: 22,  // 10 PM
    end_hour: 6,     // 6 AM
    days: [1,2,3,4,5] // Mon-Fri
  }),
  category: "sleep_time",
  explanation: "No browsing during sleep hours on school nights"
}
```

## 🔑 Default Configuration

### Backend
- URL: `http://localhost:8000`
- API Token: `dev-token-123`
- Database: PostgreSQL on port 5432

### Extension
- Parent PIN: `1234` (change this!)
- Rule refresh: Every 5 minutes
- Throttle window: 10 seconds

### Database Retention
- Audit events: 30 days
- Throttle records: 60 minutes

## 📱 Extension UI Overview

### Popup (3 Tabs)
**Status Tab:**
- Current page stats
- Active rules display
- Blocking status

**Stats Tab:**
- Total audit events
- Unique origins visited
- Average trackers per page
- CSP/CORS coverage

**Settings Tab:**
- Backend URL configuration
- API token input
- Rule refresh button

### Options Page (PIN Protected)
**Backend Settings:**
- Backend URL
- API Token
- Parent PIN

**Add Rule:**
- Rule type selector
- Domain/time input
- Category (optional)
- Explanation (required)

**Manage Rules:**
- View all rules
- Enable/disable toggle
- Delete rules
- Refresh from backend

### Blocking Page
- Shows when content is blocked
- Displays rule category
- Explains why blocked
- "Go Back" button

## 🔧 Troubleshooting

### Extension Not Loading
1. Check manifest.json syntax
2. Reload in `chrome://extensions`
3. Check console for errors

### Rules Not Working
1. Verify backend is running: `docker compose ps`
2. Check backend URL in settings
3. Verify API token is correct
4. Click "Refresh Rules" in options page
5. Check browser console for errors

### Options Page Not Opening
1. Verify manifest.json has `options_page` field
2. Reload extension
3. Try Method 1: `chrome://extensions` → Details → Options

### PIN Not Working
1. Default PIN is `1234`
2. Reset by clearing Chrome storage
3. Or manually set in DevTools:
   ```javascript
   chrome.storage.local.set({ parent_pin: "1234" })
   ```

### Backend Connection Errors
1. Check backend logs: `docker compose logs backend`
2. Verify URL has no trailing slash
3. Check CORS configuration
4. Test with curl: `curl http://localhost:8000/health/`

### Database Issues
1. Check PostgreSQL: `docker compose ps db`
2. View logs: `docker compose logs db`
3. Restart: `docker compose restart db`
4. Reset: `docker compose down -v && docker compose up -d`

## 📊 Monitoring

### Check System Health
```bash
# Backend health
curl http://localhost:8000/health/

# Database connection
curl -H "Authorization: Bearer dev-token-123" \
  http://localhost:8000/health/db

# View stats
curl -H "Authorization: Bearer dev-token-123" \
  http://localhost:8000/audit/stats/ | jq
```

### View Recent Activity
```bash
# Recent audit events
curl -H "Authorization: Bearer dev-token-123" \
  "http://localhost:8000/audit/recent/?limit=10" | jq

# View all rules
curl -H "Authorization: Bearer dev-token-123" \
  http://localhost:8000/rules/ | jq
```

### Database Queries
```bash
# Connect to PostgreSQL
docker compose exec db psql -U gcuser -d guardiancore

# List tables
\dt

# Count audit events
SELECT COUNT(*) FROM audit_events;

# View recent rules
SELECT * FROM rules ORDER BY created_at DESC LIMIT 5;

# Count throttle records
SELECT COUNT(*) FROM submit_throttle;

# Exit
\q
```

## 📚 Documentation

### Main Docs
- `README.md` - Project overview
- `SETUP.md` - Initial setup guide
- `COMPLETION-SUMMARY.md` - What was built

### Week 3 Docs
- `docs/WEEK3.md` - Full Week 3 documentation
- `docs/QUICKSTART-WEEK3.md` - Quick start guide
- `docs/WEEK3-SUMMARY.md` - Feature summary
- `docs/WEEK3-VERIFICATION.md` - Testing guide

### Parent Settings
- `docs/OPTIONS-PAGE-GUIDE.md` - Complete options page guide
- `docs/PARENT-SETTINGS-IMPLEMENTATION.md` - Technical details
- `docs/ARCHITECTURE-WITH-PARENT-SETTINGS.md` - Architecture diagrams

### Compliance
- `docs/DPIA.md` - Data Protection Impact Assessment
- `docs/architecture.md` - System architecture

## 🔐 Security Notes

### Change Default PIN
**Important:** Change from default `1234`!

1. Open options page
2. Enter current PIN: `1234`
3. In "Backend Settings", set new PIN
4. Click "Save Settings"

### Keep Token Secure
- Never commit token to git
- Use environment variables in production
- Rotate tokens regularly

### HTTPS in Production
- Use HTTPS for backend
- Update extension manifest for production domain
- Configure proper CORS

## 🎓 Learning Resources

### Key Files to Study
1. `backend/src/app/routers/rules.py` - Rules API
2. `app-extension/background.js` - Rule enforcement
3. `app-extension/options.js` - Options page logic
4. `backend/src/app/db.py` - Database schema

### Test Files
1. `scripts/test-week3.sh` - Week 3 test suite
2. `scripts/complete-test.sh` - Full test suite

### Example Scenarios
See `docs/OPTIONS-PAGE-GUIDE.md` for:
- School-age child setup
- Teenager configuration
- Weekend vs weekday rules

## 🚨 Common Errors

### 404 on /rules/
**Cause:** Backend not updated or wrong URL
**Fix:** Rebuild backend: `docker compose up -d --build`

### 401 Unauthorized
**Cause:** Invalid or missing API token
**Fix:** Check token in settings, use `dev-token-123` for dev

### 307 Redirect
**Cause:** Missing trailing slash
**Fix:** Use `/rules/` not `/rules`

### "Configure backend settings first"
**Cause:** Backend URL not set
**Fix:** Open options page, enter URL and token, save

### Throttling Warning
**Cause:** Multiple submissions in 10s window
**Fix:** This is normal behavior, working as designed

## 📞 Support

### Check Logs
```bash
# Backend logs
docker compose logs -f backend

# All logs
docker compose logs -f

# Browser console
F12 → Console tab
```

### Reset Everything
```bash
# Stop and remove containers
docker compose down -v

# Rebuild and start fresh
docker compose up -d --build

# Reload extension
Go to chrome://extensions → Reload

# Clear extension storage
Open DevTools → Application → Storage → Clear
```

## ✅ Status Check Checklist

- [ ] Backend running: `docker compose ps`
- [ ] Database healthy: `docker compose ps db`
- [ ] Extension loaded: `chrome://extensions`
- [ ] Options page accessible: Right-click icon → Options
- [ ] PIN works: Enter `1234` → Unlocks
- [ ] Backend configured: URL and token saved
- [ ] Rules loading: See rules in options page
- [ ] Enforcement working: Try blocking a domain
- [ ] Tests passing: `./scripts/test-week3.sh`

## 🎉 Success Indicators

When everything is working:
✅ Tests show "All Week 3 Tests Passed!"
✅ Extension icon shows in Chrome toolbar
✅ Options page unlocks with PIN
✅ Rules appear in options page list
✅ Popup shows current page stats
✅ Blocked pages show explanations
✅ Backend responds to health checks
✅ Database shows audit events

---

**Need More Help?** Check the detailed guides in `/docs/`
