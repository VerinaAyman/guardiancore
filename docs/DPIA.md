# Data Protection Impact Assessment (DPIA) – GuardianCore (v1, Week 1)

**Controller:** [Your university / your name]  
**Product:** GuardianCore (browser extension + backend)  
**Date:** 2024-12-19  
**Version:** 0.1 (Draft)

## 1. Summary
- **Purpose:** Provide a regulated, safer browsing/game-interaction layer with parental/guardian features and compliance hooks.
- **Scope:** Client MV3 extension, backend API, PostgreSQL.
- **Data subjects:** End-users (adults), children (with restricted profiles), guardians.
- **High-level data categories:** Extension identifiers, minimal telemetry (health, version), policy decisions, optional account metadata.
- **Lawful bases:** 
  - **Contract** (core service features for account holders),
  - **Legitimate interests** (security, fraud prevention; balanced, opt-out where feasible),
  - **Consent** (any non-essential telemetry or analytics—**disabled by default** in Week 1).

## 2. Processing Description & Data Flows
- **Extension → Backend**: health checks (no personal data), later: policy queries, account auth.
- **Backend → DB**: stores configuration, account records, logs (minimized; redact where possible).
- **No third-country transfers** in Week 1 (local dev). Future hosting: [EU region], SCCs if needed.

### Data Mapping Table (Week-1 scope)
| Flow | Fields | Purpose | Basis | Stored? | Retention |
|---|---|---|---|---|---|
| `/health` | none | Availability check | Legitimate interests | No | N/A |
| `/version` | none | Debug version | Legitimate interests | No | N/A |
| Future: `/auth/*` | email, hashed pwd | Auth | Contract | Yes (hashed) | Minimal, define later |
| Future: audit logs | action, timestamp, pseudo-ID | Accountability | Legitimate interests | Yes | Short (e.g., 30–90d) |

## 3. Necessity & Proportionality
- **Minimization:** No personal data in Week 1. Plan pseudo-IDs. Avoid cross-site tracking. No third-party SDKs.
- **Default settings:** Strict privacy defaults; analytics off.
- **Transparency:** Clear privacy notice in extension listing + docs site.

## 4. Risks & Mitigations (Week-1)
| Risk | Likelihood | Impact | Mitigations |
|---|---|---|---|
| Over-collection via extension | Low | Medium | Limit endpoints; code review; data schema approvals |
| Unauthorized DB access | Medium | High | Docker network isolation, least-priv DB user, rotate secrets, TLS when deployed |
| Logs leaking identifiers | Medium | Medium | Redaction, log levels, retention caps |
| Child data processing | Medium | High | Separate child profiles, parental verification pattern, no behavioral profiling |

## 5. Security Measures (initial)
- Network isolation via Compose; secrets via `.env` (later: vault).
- Rate limiting, input validation (add in Week 2).
- Audit trail design (to be added, minimal & purpose-bound).
- DSR (Data-Subject Rights) hooks: export/delete endpoints planned.

## 6. Consultation & Sign-off
- **DPO/Advisor:** [Name or "to be assigned"]
- **Status:** Draft for internal review (Week 1).

This is enough to submit a Week-1 DPIA draft and update later as features land.
