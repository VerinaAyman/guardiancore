# GuardianCore v0.4.4 - XP Balance & Recovery UX

**Released:** 2025-10-04  
**Type:** Balance Update & UX Improvement

---

## 🎯 Changes Summary

### 1. More Forgiving XP System

**Problem:** Tracker penalties were too harsh (-1 per tracker, max -5), making it hard to gain XP on tracker-heavy sites.

**Solution:** Reduced tracker penalty to **-0.5 per tracker** (max -2.5 total).

**Impact:**
- Example: Site with 3 trackers + CSP
  - **Before:** +1 (base) + 2 (CSP) - 3 (trackers) = **0 XP**
  - **After:** +1 (base) + 2 (CSP) - 1.5 (trackers) = **+1.5 XP** ✅
- Blocked sites still penalized heavily at -5 (unchanged)
- Floor changed from -7 to -5

### 2. Recovery Codes: Show Used Codes

**Problem:** Recovery Codes tab only showed unused codes, making it hard to track which codes had been used.

**Solution:** 
- Table now displays **all 10 codes** (both used and unused)
- Used codes marked with ✓ checkmark and dimmed (60% opacity)
- "Used At" column shows timestamp when code was consumed
- Em dash (—) for unused codes in "Used At" column

**Benefits:**
- Better audit trail of recovery code usage
- Easy to see which codes are still available
- Helps identify potential unauthorized access attempts

---

## 📊 Updated XP Rules Table

| Event / Condition | XP Delta | Change |
|-------------------|----------|--------|
| Base per page load | +1 | unchanged |
| Page has CSP header | +2 | unchanged |
| Page exposes CORS signals | +1 | unchanged |
| Zero trackers detected | +3 | unchanged |
| Each tracker (up to 5) | **-0.5** | **was -1** |
| Blocked / violation navigation | -5 | unchanged |
| Fast Mode enabled (dev) | Final delta ×3 | unchanged |

**Floor:** -5 (was -7)

---

## 🔧 Technical Details

### Code Changes

**File:** `app-extension/background.js`
- Line 91: Changed tracker penalty calculation
  - **Before:** `delta -= Math.min(event.trackers, 5);`
  - **After:** `delta -= Math.min(event.trackers, 5) * 0.5;`
- Line 93: Updated floor from -7 to -5
  - **Before:** `if (delta < 0) delta = Math.max(delta, -7);`
  - **After:** `if (delta < 0) delta = Math.max(delta, -5);`

**File:** `app-extension/options.js`
- Lines 566-577: Updated recovery code table rendering
  - Added checkmark (✓) for used codes
  - Added opacity styling (used codes at 60%)
  - Changed "Used At" to show em dash (—) for unused codes

**File:** `app-extension/popup.html`
- Line 129: Updated XP explainer text
  - **Before:** `-1 per tracker (up to -5)`
  - **After:** `**-0.5** per tracker (up to -2.5)`

**File:** `docs/WEEK4-COMPLETE.md`
- Updated XP Rules table and mechanics section
- Added note about forgiving tracker penalty

---

## 🧪 Testing

### Test XP Balance (2 min)

```
✅ 1. Navigate to tracker-heavy site (e.g., news site)
   Expected: Small positive XP gain (was 0 or negative before)

✅ 2. Check background console:
   Should see XP delta calculation
   Example: "base +1, CSP +2, trackers -1.5 = +1.5"

✅ 3. Navigate to blocked site
   Expected: Still -5 XP penalty (unchanged)
```

### Test Recovery Codes Display (1 min)

```
✅ 1. Open Options → Recovery Codes tab

✅ 2. If you have used codes:
   Expected: See all 10 codes in table
   Expected: Used codes dimmed with ✓ checkmark
   Expected: "Used At" shows timestamp

✅ 3. If no codes used yet:
   Expected: All codes show "Unused" status
   Expected: "Used At" shows em dash (—)
```

---

## 📝 Migration Notes

**No breaking changes.** Existing XP values and recovery codes remain valid.

**Version bump:** Extension version remains 0.4.3 in manifest (cosmetic v0.4.4 for docs).

**Backward compatible:** Works with all v0.4.x setups.

---

## 🎉 User Benefits

### XP System
- ✅ Easier to level up on real-world websites
- ✅ Less punishing for browsing tracker-heavy but legitimate sites
- ✅ Blocked sites still heavily penalized (maintains security incentive)
- ✅ More balanced progression curve

### Recovery Codes
- ✅ Full visibility of all 10 codes
- ✅ Easy audit trail of usage
- ✅ Better security awareness (can see if codes were used)
- ✅ Helps identify potential unauthorized access

---

*GuardianCore v0.4.4 - Making privacy protection more rewarding!*
