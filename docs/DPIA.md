# Data Protection Impact Assessment (DPIA) – GuardianCore (v2, Week 2)

**Controller:** [Your university / your name]  
**Product:** GuardianCore (browser extension + backend)  
**Date:** 2024-12-19  
**Version:** 0.2 (Draft)

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
- **Extension → Backend**: audit data submission with privacy-preserving hashing
- **Backend → DB**: stores audit records with origin hashes (no PII)
- **No third-country transfers** in Week 2 (local dev). Future hosting: [EU region], SCCs if needed.

### Data Mapping Table (Week-2 scope)
| Flow | Fields | Purpose | Basis | Stored? | Retention |
|---|---|---|---|---|---|
| `/health` | none | Availability check | Legitimate interests | No | N/A |
| `/version` | none | Debug version | Legitimate interests | No | N/A |
| `/audit/submit` | origin_hash (SHA-256), policy_state, timestamps | Security audit evidence | Legitimate interests | Yes | 30 days |
| `/audit/stats` | aggregated counts, percentages | Analytics and trends | Legitimate interests | No | N/A |
| Future: `/auth/*` | email, hashed pwd | Auth | Contract | Yes (hashed) | Minimal, define later |

## 3. Necessity & Proportionality
- **Minimization:** Only origin hashes (SHA-256 of scheme+host+port), boolean CSP/CORS flags, and integer tracker counts. No full URLs, paths, queries, cookies, or identifiers.
- **Default settings:** Strict privacy defaults; analytics off; no third-party SDKs.
- **Transparency:** Clear privacy notice in extension listing + docs site.
- **Data minimization:** Origin hashing prevents URL reconstruction; only security-relevant metadata collected.

## 4. Risks & Mitigations (Week-1)
| Risk | Likelihood | Impact | Mitigations |
|---|---|---|---|
| Over-collection via extension | Low | Medium | Limit endpoints; code review; data schema approvals |
| Unauthorized DB access | Medium | High | Docker network isolation, least-priv DB user, rotate secrets, TLS when deployed |
| Logs leaking identifiers | Medium | Medium | Redaction, log levels, retention caps |
| Child data processing | Medium | High | Separate child profiles, parental verification pattern, no behavioral profiling |

## 5. Security Measures (Week 2)
- **Network security:** TLS/HTTPS for all communications; Docker network isolation
- **Authentication:** Bearer token authentication for API endpoints
- **Data security:** SHA-256 origin hashing; no PII storage; JSON schema validation
- **Access control:** API token-based authorization; rate limiting planned
- **Audit trail:** Comprehensive logging of audit submissions with privacy-preserving design
- **Data retention:** 30-day retention policy for audit records
- **DSR (Data-Subject Rights):** Export/delete endpoints planned for future releases

## 6. Consultation & Sign-off
- **DPO/Advisor:** [Name or "to be assigned"]
- **Status:** Draft for internal review (Week 1).

This is enough to submit a Week-1 DPIA draft and update later as features land.
