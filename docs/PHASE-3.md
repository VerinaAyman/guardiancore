# Week 3 — Explainable Controls (Completed) / Transition to Phase 3

This document captures the completed Week 3 deliverables (Explainable Controls - RQ-B2) and serves as the baseline entering Phase 3.

> Formerly named `PHASE-2.md` (Week 3 scope). Renamed to reflect that these capabilities are now complete and Phase 3 work builds atop them.

## 1. Completion Summary
All Week 3 goals have been implemented:

- Rules CRUD API (`/rules`) with allowlist, blocklist, time_window
- Extension rule enforcement (precedence: allowlist > time_window > blocklist)
- Explainable blocking page with category + reason
- Popup UI (Status / Stats / Settings) (Settings read‑only; redirects to parent Options)
- Parent Options page with PIN protection (default 1234, configurable)
- Throttling (10s per origin+tab) to reduce duplicate audit noise
- Retention helpers for audit + throttle tables
- Expanded tracker categorization (>20 entries)
- Stats endpoint: aggregate metrics (totals, averages, categories)
- Test automation (`scripts/test-week3.sh` and inclusion in `complete-test.sh`)

## 2. Purpose (Why These Features Exist)
- Provide proportional, explainable parental controls (ethical transparency).
- Allow parents to define granular constraints (time windows, domain rules) with clear reasons presented to the child.
- Supply measurable telemetry (stats) while minimizing stored personal data.
- Enforce rules locally in the extension for responsiveness + resilience even if backend momentarily unavailable.
- Prevent audit noise & storage bloat (throttling + retention).

## 3. High-Level Architecture (How It Fits Together)
- Browser Extension:
  - background.js: Periodically pulls `/rules`, intercepts navigations, applies evaluation logic, sends audits.
  - popup.html/js: Read-only status & stats view (child-facing).
  - options.html/js: Parent-only (PIN gate) configuration & CRUD actions.
  - blocked.html/js: Renders explanation when navigation is blocked.
- Backend (FastAPI):
  - rules router: CRUD (POST/GET/LIST/PATCH/DELETE)
  - audit router: audit ingest, stats aggregation
  - db.py: async engine + schema (rules, submit_throttle, audits*)
  - retention helpers (manual / cron-ready)
(*audit table assumed pre-existing in earlier phase)

## 4. Data Model (Key Tables)
- rules
  - id (int PK)
  - rule_type (enum: allowlist | blocklist | time_window)
  - pattern (domain or time window spec e.g. "22:00-06:00|0,1,2,3,4,5,6")
  - category (nullable text)
  - explanation (text)
  - enabled (bool)
  - created_at, updated_at
- submit_throttle
  - id, tab_id, origin_hash, last_submitted_at
  - UNIQUE (tab_id, origin_hash) for upsert-based throttling

## 5. API Endpoints (Behavior Summary)
- POST /rules
  - Creates rule; validates type & pattern format.
- GET /rules
  - Parameters: enabled_only (bool), type filter optional (if implemented).
- GET /rules/{id}
- PATCH /rules/{id}
  - Partial updates: enabled, pattern, explanation, category.
- DELETE /rules/{id}
- GET /audit/stats
  - Returns aggregated counts (blocked vs allowed, category tallies, recent window).
- (Audits ingestion endpoint assumed from prior phase.)

Authentication: Bearer token (dev: `dev-token-123`).

## 6. Rule Evaluation Logic (Enforcement Order)
Pseudo-flow executed in background.js when a navigation or request is inspected:

```
fetch currentRules (cached + periodic refresh)
extract domain from URL

if any enabled allowlist rule matches domain:
    allow (short-circuit)
else if any enabled time_window rule is active NOW:
    if rule defines restricted window:
        block with explanation from rule
    else continue
else if any enabled blocklist rule matches domain:
    block with explanation
else:
    allow
```

Matching:
- allowlist/blocklist: exact domain or subdomain suffix match.
- time_window: current weekday ∈ rule days AND current time within interval.

## 7. Throttling Mechanism
- Key: (tab_id, origin)
- On audit submit:
  1. Hash origin (privacy).
  2. Attempt INSERT with now().
  3. On conflict: compare timestamp; if < 10s since last_submitted_at → skip send.
  4. Else update last_submitted_at and allow send.
- Reduces redundant events from rapid redirects / reload loops.

## 8. Retention Strategy
- Weekly job (manual script / cron) deletes:
  - audits older than 30 days
  - throttle rows older than 30 days (stale tabs)
- Keeps storage bounded; supports privacy minimization.

## 9. Parent PIN & Configuration Security
- PIN stored in extension local storage (could be hashed in future).
- Options page gate:
  - Prompt → compare → unlock session variable (not persisted cross reload intentionally).
- Popup "Settings" now read-only and only opens Options when interaction needed.
- No API token editing without passing PIN.

## 10. Configuration & Caching
- Stored (backend_url, api_token, pin, last_rules_refresh_ts) in chrome.storage.local.
- background.js refresh cadence (e.g., every 5 minutes or forced via REFRESH_RULES message).
- Fallback: If fetch fails, continue using last cached rule set (best-effort continuity).

## 11. Stats Endpoint Output (Conceptual)
- total_audits
- total_blocked
- total_allowed
- blocked_ratio
- category_counts (map)
- last_24h_trend (if implemented) or placeholder for Phase 3 charts.

## 12. Block Page Explanation
- blocked.html consumes query params or runtime message with:
  - rule_type
  - category
  - explanation (parent-authored)
  - timestamp
- Shows a branded contextual reason (supports trust & transparency).

## 13. Test Coverage Summary
Scripts:
- scripts/test-week3.sh
  - Create rule(s)
  - List rules & filter
  - Update (enable/disable)
  - Delete
  - Throttling behavior
  - Stats endpoint sanity
- Included in complete-test.sh for regression chain.

## 14. Known Limitations (Baseline for Phase 3)
- No per-user multi-profile separation yet.
- Time windows single interval per rule (no multiple intervals per day).
- Rules not versioned / audited.
- No UI charts (raw stats only).
- PIN not hashed (improvable).
- No network integrity / rule signature check.

## 15. Phase 3 Potential (Refined)
1. Multi-interval / per-category schedules.
2. Rule bundles / templates (Study Mode, Sleep Mode).
3. Export/import JSON (parent portal portability).
4. Weekly emailed digest (opt-in).
5. Visual dashboard (charts: block trends, top categories).
6. Hardening: PIN hashing + tamper detection (storage integrity hash).
7. Local ML heuristic for suspicious trackers (privacy budget aware).
8. Optional ephemeral session unlocking (auto relock timer).

## 16. File Reference (Quick Index)
```
backend/src/app/routers/rules.py
backend/src/app/routers/audit.py
backend/src/app/db.py
app-extension/background.js
app-extension/popup.html / popup.js
app-extension/options.html / options.js
app-extension/blocked.html / blocked.js
scripts/test-week3.sh
```

## 17. Migration / Renaming Impact
Any previous references to `PHASE-2.md` in docs or scripts should now conceptually point to `PHASE-3.md`. Historical commit history preserves the original file for traceability.

---

If deeper protocol specs (e.g., JSON schema for rules, exact stats payload shape) are required, we can append an Appendix section.
