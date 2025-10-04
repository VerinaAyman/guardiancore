# Recovery Codes Display Test

## Quick Test (1 min)

### Verify Used Codes Show Up:

1. **Open Options page** (chrome-extension://...)

2. **Go to Recovery Codes tab**

3. **Check the table:**
   - Should show ALL 10 codes
   - Used codes should be **dimmed (60% opacity)**
   - Used codes should have **✓ checkmark** in Status column
   - "Used At" column should show **timestamp** for used codes
   - "Used At" column should show **em dash (—)** for unused codes

### Example Table Row (Used Code):

```
#  | Identifier      | Status  | Used At
---|-----------------|---------|---------------------------
1  | ****-****-A3F2  | ✓ Used  | 10/4/2025, 3:45:23 PM
2  | ****-****-B7D9  | Unused  | —
```

### Debug if Not Showing:

```javascript
// Open DevTools Console (F12) in Options page:

// Check storage:
chrome.storage.local.get('recovery_batches', (result) => {
  console.log('Recovery batches:', result);
  const batch = result.recovery_batches?.find(b => b.active);
  if (batch) {
    console.log('Active batch codes:', batch.codes);
    batch.codes.forEach((c, i) => {
      console.log(`Code ${i+1}: used=${c.used}, used_at=${c.used_at}`);
    });
  }
});

// Manually trigger refresh:
// (paste in console while on Recovery Codes tab)
loadRecoveryStatus();
```

### Expected Behavior:

✅ Table shows all 10 codes  
✅ Used codes are visually distinct (dimmed)  
✅ Status column accurately shows "✓ Used" or "Unused"  
✅ Timestamps show when codes were used  
✅ Summary at top: "X unused / Y used (total 10)"

### Common Issues:

**Issue:** Used codes not showing  
**Fix:** Click away from Recovery tab, then click back (triggers refresh)

**Issue:** All codes show as "Unused" even though one was used  
**Fix:** Check that the code was actually verified (should have `used: true` in storage)

---

## Storage Structure Reference

Used code in storage:
```javascript
{
  id: "abc-123",
  salt: "base64-salt",
  hash: "base64-hash",
  iter: 310000,
  used: true,              // ← Should be true
  used_at: "2025-10-04T15:45:23.456Z"  // ← Should have timestamp
}
```

Unused code:
```javascript
{
  id: "def-456",
  salt: "base64-salt",
  hash: "base64-hash",
  iter: 310000,
  used: false,    // ← false
  used_at: null   // ← null
}
```
