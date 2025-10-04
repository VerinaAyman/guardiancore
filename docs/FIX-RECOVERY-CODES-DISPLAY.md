# GuardianCore v0.4.4 - Recovery Codes Display Fix

**Date:** October 4, 2025  
**Type:** Bug Fix + UI Update

---

## 🐛 Issue Fixed: Used Recovery Codes Not Showing

### Problem
User reported that even though they had used a recovery code, it was not appearing in the Recovery Codes tab table.

### Root Cause
The `loadRecoveryStatus()` function was only being called when:
1. Initial page unlock
2. Tab switch (but only if `isUnlocked` was explicitly checked)

This meant if a code was used via "Forgot PIN" flow, the table wouldn't refresh automatically when switching back to the Recovery Codes tab.

### Solution
Modified the tab switching logic in `options.js` to **always** call `loadRecoveryStatus()` when the Recovery Codes tab is clicked, without checking `isUnlocked` status (since the tab is only accessible when unlocked anyway).

**Code Change:**
```javascript
// BEFORE:
if (isUnlocked && targetTab === 'recovery') {
  loadRecoveryStatus();
}

// AFTER:
if (targetTab === 'recovery') {
  loadRecoveryStatus();
}
```

### Impact
- ✅ Used codes now appear immediately when switching to Recovery Codes tab
- ✅ Table updates dynamically without page refresh
- ✅ Better visibility of recovery code usage history

---

## 📄 About Page Updated to v0.4.4

### Changes
Updated `options.html` About tab to reflect current version and features:

**Version:** 0.4.0 → **0.4.4**

**Added Features:**
- XP-only gamification with instant feedback
- Forgiving tracker penalties (-0.5 per tracker, max -2.5)
- 30-second cooldown to prevent XP farming
- Auto-refresh rules after backend config save
- Recovery codes usage tracking

**Added "Latest Changes" Section:**
- More forgiving XP system
- Recovery codes table shows used codes with timestamps
- Blocked sites maintain -5 XP penalty
- Daily XP reset with persistent levels

---

## 📝 Files Modified

1. **`app-extension/options.js`** (Line ~96)
   - Removed `isUnlocked` check from recovery tab refresh logic
   - Ensures `loadRecoveryStatus()` runs every time tab is clicked

2. **`app-extension/options.html`** (Lines 285-309)
   - Updated version from 0.4.0 to 0.4.4
   - Added release date
   - Updated features list
   - Added "Latest Changes" section

3. **`docs/RECOVERY-CODES-TEST.md`** (New file)
   - Created test guide for verifying recovery codes display
   - Includes debug commands and storage structure reference

---

## 🧪 Testing Checklist

### Test Recovery Codes Display:

```
✅ 1. Open Options → Recovery Codes tab
   Expected: Table loads immediately

✅ 2. If you have a used code:
   Expected: Code appears dimmed with ✓ checkmark
   Expected: "Used At" shows timestamp

✅ 3. Switch to another tab, then back to Recovery Codes
   Expected: Table refreshes automatically

✅ 4. Use a recovery code via "Forgot PIN"
   Expected: After resetting PIN, go to Recovery Codes tab
   Expected: Used code appears in table with status updated
```

### Test About Page:

```
✅ 1. Open Options → About tab
   Expected: Version shows 0.4.4
   Expected: Features list includes XP and tracker penalties
   Expected: "Latest Changes" section present
```

---

## 🎉 User Benefits

### Recovery Codes
- ✅ Immediate visibility when codes are used
- ✅ No need to refresh page or re-enter PIN
- ✅ Better security audit trail
- ✅ Easy to verify which codes are still available

### About Page
- ✅ Accurate version information
- ✅ Up-to-date feature list
- ✅ Clear documentation of recent improvements
- ✅ Better user awareness of system capabilities

---

## 🔍 Technical Details

### Recovery Codes Table Structure

The table now properly displays all 10 codes with:
- **#** - Sequential number (1-10)
- **Identifier** - Last 4 chars of hash (****-****-XXXX)
- **Status** - "✓ Used" or "Unused" (color-coded)
- **Used At** - Timestamp or em dash (—)

### Visual Styling
- Used codes: 60% opacity (dimmed)
- Used status: Warning color (`var(--gc-warn)`)
- Unused status: Success color (`var(--gc-success)`)
- Em dash for unused timestamps

---

## 📋 No Breaking Changes

- ✅ Existing recovery codes remain valid
- ✅ Storage structure unchanged
- ✅ Backward compatible with v0.4.3
- ✅ No migration needed

---

*GuardianCore v0.4.4 - Better visibility, better security awareness!*
