# GuardianCore Gamification (XP-Only Model)

**Version:** 0.4.3 (XP Simplification)  
**Released:** 2025-10-04  
**Branch:** phase-4  
**Focus:** Replace legacy Risk + Streak with a single fast-feedback XP system.

---
## 🎯 Rationale
Earlier iterations used a backend risk score (0–100) and a safe streak (active hours since last violation). These proved:  
- Too static (risk often sat at 0)  
- Overlapping in meaning (safety over time vs. composite risk)  
- Added complexity (heartbeat timers, polling, color classes, breakdown UI)  

To deliver instant, comprehensible progress, we consolidated to **XP only**. Every navigation awards or penalizes XP locally; progress is visible immediately without server latency.

---
## 🧮 XP Rules
| Event / Condition | XP Delta |
|-------------------|----------|
| Base per page load | +1 |
| Page has CSP header | +2 |
| Page exposes CORS signals | +1 |
| Zero trackers detected | +3 |
| Each tracker (up to 5) | -1 each (max -5) |
| Blocked / violation navigation | -5 (immediate) |
| Fast Mode enabled (dev) | Final delta ×3 |

- XP floors at 0 (never negative overall)  
- Level increases every time XP reaches 100 (XP wraps: `xp -= 100; level++`)  
- Daily reset: XP resets at day boundary (UTC ISO date comparison); **level persists**  
- Negative outcomes (trackers / violations) can nullify gains but have a capped penalty

---
## 🔄 Daily Reset Logic
Stored state (`gc_xp_state`):
```json
{ "dayKey": "2025-10-04", "xp": 57, "level": 3 }
```
On any XP mutation or XP state request:  
1. Compute today = `new Date().toISOString().slice(0,10)`  
2. If `dayKey !== today` → set `xp = 0`, keep `level`, update `dayKey`.

---
## 🧪 Developer / Test Aids
Unlock dev panel: press `D` 5× quickly in popup.  
Buttons:
- Fast Mode toggle (1 real navigation second ≈ accelerated testing; implementation multiplies XP delta by 3)  
- Simulate Violation (applies -5 XP penalty)  
- Reset XP (invokes `DEV_RESET_XP`)  

---
## 🗑 Removed / Deprecated
| Removed Component | Reason |
|-------------------|--------|
| Risk score polling `/risk/score` in extension | Redundant vs. immediate XP feedback |
| Safe streak accumulation & heartbeat | Added complexity; overlapping motivational signal |
| Time-left nudges | Depended on streak timer infrastructure |
| Risk breakdown dev panel | No longer relevant |
| Streak/risk CSS classes & UI elements | Visual noise |

Backend endpoint `/risk/score` remains for now (API stability) but is unused by the extension (can be sunset later or repurposed for guardian reporting dashboard).

---
## 🧱 Storage Hygiene
Legacy keys no longer used by extension UI: `browserStartTime`, `gc_active_ms`, `lastViolation`. They can be safely purged in a future housekeeping task / migration script. Current active keys relevant to gamification:
- `gc_xp_state` (XP + dayKey + level)
- `gc_fast_mode` (dev-only)

---
## 🔐 Security Impact
All gamification logic now local and deterministic → fewer backend calls, reduced surface for timing inference, and no exposure of rule semantics or internal scoring rationale.

---
## 🧩 Popup UX Changes
New elements:
- Level, Daily XP, Progress Bar (fills based on `xp/100`)
- “X XP to next level” text below bar
- “How you earn XP” compact explanation list

Removed elements:
- Safe Streak hours & compliance message
- Risk score color indicator & breakdown
- Time restriction nudge banners

---
## 📦 Code Touchpoints
| File | Change |
|------|--------|
| `background.js` | Removed risk & streak logic; kept XP award; fixed award bug capturing tracker count before reset |
| `popup.html` | Pruned streak/risk UI; added XP how-to section & remaining XP text; linked `xp.css` |
| `popup.js` | Removed legacy message handlers; added Reset XP handler; simplified real-time updates |
| `xp.css` | New stylesheet containing XP bar & explanatory section styles |

---
## 🐞 Fixed in 0.4.3
| Issue | Fix |
|-------|-----|
| XP not visibly increasing (always 0 trackers after reset) | Captured counts before reset in navigation completion handler |
| Hard-to-scan inline styles | Extracted to `xp.css` |

---
## 🚀 Future Enhancements (Backlog)
- Parent dashboard: aggregate weekly XP & historical trends
- Achievement badges (first day with 0 trackers, 5 consecutive clean pages, etc.)
- Optional positive streak multiplier (only if it doesn’t reintroduce complexity)
- Sunset `/risk/score` or repurpose for guardian aggregate analytics

---
## 🔄 Changelog Addendum (from 0.4.2 → 0.4.3)
```
[0.4.3]
- Remove risk score & safe streak systems
- Introduce XP-only progress model
- Add XP remaining indicator & explanatory section in popup
- Fix XP award tracker count bug
- Extract XP styles to dedicated stylesheet
- Add dev Reset XP button
```

---
## ✅ Validation Checklist
- Navigation awards XP & updates progress bar real-time
- Zero trackers page shows larger positive delta (+3 bonus minus none)
- Blocked navigation triggers immediate -5 penalty & still loads blocked page UX
- Day rollover resets XP but not level (manually tested by altering `dayKey`)
- Dev Reset XP sets XP=0, level retained, progress bar empties

---
*End of XP Model Documentation*
