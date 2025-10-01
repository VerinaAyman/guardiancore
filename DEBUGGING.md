# Extension Debugging Guide

## Current Issues & Fixes

### Issue 1: Popup tabs don't switch
**Symptom:** Clicking on Stats or Settings tab does nothing
**Cause:** Tab switching code may have errors
**Fix Applied:** Added console logging to debug

### Issue 2: Rules show "Loading..." forever  
**Symptom:** Active Rules section shows "Loading rules..." and never updates
**Cause:** JavaScript error or API fetch failing
**Fix Applied:** 
- Added console logging
- Better error messages
- Null checks for DOM elements

### Issue 3: Options page buttons don't work
**Symptom:** Disable and Delete buttons in options page don't respond
**Cause:** Functions not accessible when onclick is called
**Fix Applied:** Made toggleRule and deleteRule global functions immediately

## How to Debug

### 1. Open Extension Popup
1. Click extension icon
2. Right-click on popup → Inspect
3. Check Console tab for errors

### 2. Check for Common Errors

**TypeError: Cannot read properties of null:**
- DOM element not found
- Check element IDs match between HTML and JS

**CORS Error:**
- Backend not allowing requests from extension
- Check backend CORS settings

**Failed to fetch:**
- Backend not running
- Wrong URL in settings
- Network issue

### 3. Test Step by Step

```javascript
// In popup console, test:
chrome.storage.local.get(["gc_backend_url", "gc_api_token"], console.log)

// Should show:
// {gc_backend_url: "http://localhost:8000", gc_api_token: "dev-token-123"}

// Test fetch manually:
fetch("http://localhost:8000/rules/?enabled_only=true", {
  headers: { "Authorization": "Bearer dev-token-123" }
})
.then(r => r.json())
.then(console.log)

// Should show array of rules
```

### 4. Check Background Worker

1. Go to `chrome://extensions`
2. Find GuardianCore
3. Click "service worker" link
4. Check console for errors

### 5. Test Options Page

1. Right-click extension → Options
2. Right-click on options page → Inspect
3. Enter PIN 1234
4. Check console for:
   - "toggleRule called: X, true/false"
   - "deleteRule called: X"

## Quick Fixes

### Reset Extension
```bash
# In chrome://extensions
1. Toggle extension off and on
2. Or click "Reload" icon
3. Or remove and re-add the extension folder
```

### Reset Storage
```javascript
// In popup or options console:
chrome.storage.local.clear()
```

### Check Backend
```bash
# Terminal:
cd /Users/ahmedkhadrawy/guardiancore
docker compose ps
docker compose logs backend | tail -20

# Test API directly:
curl http://localhost:8000/health/
curl -H "Authorization: Bearer dev-token-123" \
  http://localhost:8000/rules/
```

## Expected Console Output

### Popup Loading:
```
Loading rules from: http://localhost:8000
Fetching rules from: http://localhost:8000/rules/?enabled_only=true
Rules loaded: [{...}, {...}]
Rules displayed successfully
```

### Options Page - Toggle Rule:
```
toggleRule called: 5, false
```

### Options Page - Delete Rule:
```
deleteRule called: 5
```

## Common Problems & Solutions

### Problem: Popup shows black screen
**Solution:** Check for JavaScript syntax errors in popup.js

### Problem: Can't click anything
**Solution:** CSS z-index issue or event listener not attached

### Problem: "Loading rules..." forever
**Solution:** 
1. Check backend is running
2. Check URL is configured
3. Check API returns valid JSON
4. Look for JavaScript errors in console

### Problem: Buttons gray out but don't work
**Solution:** Event listener attached but function has error inside

### Problem: Changes don't take effect
**Solution:** Reload extension in chrome://extensions

## Testing Checklist

After fixes, verify:
- [ ] Extension loads without errors
- [ ] Popup opens and shows 3 tabs
- [ ] Status tab shows "Loading rules..." then rules or "No active rules"
- [ ] Stats tab shows numbers or "-"
- [ ] Settings tab shows input fields
- [ ] Can switch between tabs by clicking
- [ ] Options page opens with PIN lock
- [ ] PIN 1234 unlocks options
- [ ] Can add new rule
- [ ] Disable button works (rule badge changes)
- [ ] Delete button works (rule removed after confirm)
- [ ] Rules list refreshes after changes

## Files Modified

- `app-extension/popup.js` - Added logging, error handling
- `app-extension/options.js` - Made buttons global, added logging

## Next Test

1. Reload extension
2. Open popup → Check console
3. Try switching tabs
4. Open options → Try toggle/delete buttons
5. Report any console errors you see
