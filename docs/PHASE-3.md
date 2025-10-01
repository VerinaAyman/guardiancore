# Week 3 — Explainable Controls (Completed) / Transition to Phase 3

This document captures the completed Week 3 deliverables (Explainable Controls - RQ-B2) and serves as the baseline entering Phase 3.

> Formerly named `PHASE-2.md` (Week 3 scope). Renamed to reflect that these capabilities are now complete and Phase 3 work builds atop them.

## Completion Summary
All Week 3 goals have been implemented:

- Rules CRUD API (`/rules`) with allowlist, blocklist, time_window
- Extension rule enforcement (precedence: allowlist > time_window > blocklist)
- Explainable blocking page with category + reason
- Popup UI (Status / Stats / Settings) fully functional
- Parent Options page with PIN protection (default 1234, configurable)
- Throttling (10s per origin+tab) to reduce duplicate audit noise
- Retention helpers for audit + throttle tables
- Expanded tracker categorization (>20 entries)
- Stats endpoint: aggregate metrics (totals, averages, categories)
- Test automation (`scripts/test-week3.sh` and inclusion in `complete-test.sh`)

## File Reference
```
backend/src/app/routers/rules.py   # Rules CRUD
backend/src/app/routers/audit.py   # Throttling + stats
backend/src/app/db.py              # Schema (rules + submit_throttle)
app-extension/background.js        # Enforcement + periodic refresh
app-extension/popup.html/js        # Multi-tab popup
app-extension/options.html/js      # Parent management UI (PIN + CRUD)
app-extension/blocked.html/js      # Explainable blocked reason page
scripts/test-week3.sh              # Automated verification
docs/PHASE-3.md                    # (this file)
```

## Notes for Phase 3
Phase 3 will build on this foundation. Potential next items:
1. Rich visualization dashboards (charts, trends)
2. Rule grouping / templates (e.g. "Study Mode")
3. Import/export rules (JSON bundle)
4. Notification or report generation
5. More granular time windows (per-category schedules)
6. Tamper resistance / integrity checks

## Ethical + Compliance Foundations (Retained Going Forward)
- Transparency: Clear explanations for blocks
- Proportionality: Time + category + allow exceptions
- Privacy by Design: No URL path storage, retention limits, origin hashing
- User Empowerment: Parent-configurable explanations and toggles

## Migration / Renaming Impact
Any previous references to `PHASE-2.md` in docs or scripts should now conceptually point to `PHASE-3.md`. Historical commit history preserves the original file for traceability.

---
If additional summarization or cross-linking to new Phase 3 objectives is needed, we can append a roadmap section after initial Phase 3 scoping is finalized.
