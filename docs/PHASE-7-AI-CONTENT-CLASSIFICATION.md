# Phase 7: Intelligent Content Classification & PIN Sync

**Version:** 0.6.0  
**Date:** December 2024  
**Branch:** `phase-7`

---

## Overview

Phase 7 introduces two major features:
1. **PIN Sync Fix** - Synchronizes parental lock PIN across devices
2. **Intelligent Content Classification** - AI-powered content filtering using Hugging Face Serverless Inference API

---

## Table of Contents

1. [PIN Sync Fix](#1-pin-sync-fix)
2. [Intelligent Content Classification](#2-intelligent-content-classification)
3. [Architecture](#3-architecture)
4. [API Reference](#4-api-reference)
5. [Configuration](#5-configuration)
6. [Testing](#6-testing)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. PIN Sync Fix

### Problem
When a parent logged in on a new device, the extension prompted them to create a new PIN instead of using their existing one from the server.

### Solution
- Added `/accounts/pin/fetch` endpoint to retrieve the encrypted PIN from the server
- Updated `login.js` to automatically fetch and sync PIN after successful login

### Flow
```
Parent logs in on new device
        ↓
login.js calls /auth/parent/login
        ↓
On success, calls /accounts/pin/fetch
        ↓
Server returns decrypted PIN + recovery codes
        ↓
Extension stores in chrome.storage.local
        ↓
Parent can access settings without re-creating PIN
```

### Files Changed
| File | Change |
|------|--------|
| `backend/src/app/routers/accounts.py` | Added `GET /accounts/pin/fetch` endpoint |
| `app-extension/login.js` | Added PIN sync after login |

---

## 2. Intelligent Content Classification

### Overview
A two-layer AI content filtering system that analyzes both URLs and page content to automatically detect and block unsafe websites.

### Two-Layer Architecture

#### Layer 1: Fast Path (URL Analysis)
- **Speed:** Instant (~1ms)
- **Method:** URL tokenization + keyword matching
- **No API call required**

Tokenizes URLs and checks against 60+ high-risk keywords:
```
URL: https://eg1xbet.com/sports
     ↓
Tokens: ["eg1xbet", "1", "xbet", "bet", "sports", "com"]
     ↓
Match found: "bet", "xbet", "1xbet"
     ↓
BLOCKED (Fast Path)
```

**Keyword Categories:**
- Adult/NSFW content (porn, xxx, nude, etc.)
- Gambling (bet, casino, poker, 1xbet, bet365, etc.)
- Drugs/Substance abuse
- Violence/Gore
- Hate/Extremism
- Self-harm
- Scams/Phishing

#### Layer 2: Slow Path (AI Content Analysis)
- **Speed:** 2-10 seconds
- **Method:** Hugging Face Inference API (Zero-Shot Classification)
- **Only runs if URL passes fast path**

**Models Used (with fallback):**
1. Primary: `MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli`
2. Fallback: `cross-encoder/nli-distilroberta-base` (~82M params)

**Classification Labels:**
- safe, unsafe, adult, toxic, gambling, violence

### Automatic Rule Persistence

When unsafe content is detected, the system:
1. Creates a **persistent blocklist rule** in the database
2. Refreshes the extension's rules cache
3. Updates Chrome's declarativeNetRequest blocking
4. Redirects to `blocked.html`

**Result:** The domain is permanently blocked without needing AI analysis on future visits.

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                     CONTENT SCRIPT (content-script.js)               │
│  1. Extract document.body.innerText (truncated to 1000 chars)       │
│  2. Send {type: "ANALYZE_PAGE", url, text} to background            │
└─────────────────────────────────────┬───────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     BACKGROUND WORKER (background.js)                │
│  1. Rate limit check (1 request per domain per minute)              │
│  2. POST to /analyze/content                                        │
│  3. If unsafe: refresh rules, redirect to blocked.html              │
└─────────────────────────────────────┬───────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     BACKEND (/analyze/content)                       │
│  Layer 1: URL keyword check (instant)                               │
│     └─ If match → return UNSAFE                                     │
│  Layer 2: HuggingFace API call (2-10s)                             │
│     └─ If unsafe category > 60% → return UNSAFE                    │
│  If UNSAFE: Save blocklist rule to database                         │
└─────────────────────────────────────────────────────────────────────┘
```

### Files Created/Modified

| File | Type | Description |
|------|------|-------------|
| `backend/src/app/services/__init__.py` | New | Services module init |
| `backend/src/app/services/classifier.py` | New | ContentClassifier with two-layer logic |
| `backend/src/app/routers/analysis.py` | New | `/analyze/content` endpoint |
| `backend/src/app/config.py` | Modified | Added `HUGGINGFACE_API_KEY` |
| `backend/src/app/main.py` | Modified | Registered analysis router |
| `backend/requirements.txt` | Modified | Added `httpx==0.27.0` |
| `app-extension/content-script.js` | New | Page text extraction |
| `app-extension/manifest.json` | Modified | Registered content script, v0.6.0 |
| `app-extension/background.js` | Modified | ANALYZE_PAGE handler |

---

## 3. Architecture

### Backend Services

```
backend/src/app/
├── services/
│   ├── __init__.py
│   └── classifier.py      # ContentClassifier class
├── routers/
│   └── analysis.py        # /analyze/* endpoints
└── config.py              # HUGGINGFACE_API_KEY
```

### ContentClassifier Class

```python
class ContentClassifier:
    PRIMARY_MODEL = "MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli"
    FALLBACK_MODEL = "cross-encoder/nli-distilroberta-base"
    
    def _tokenize_url(url) -> set[str]
    def _check_url_keywords(url) -> (is_unsafe, keyword)
    async def _call_hf_model(model_url, text, headers) -> (result, status)
    async def _analyze_content_with_api(text) -> (is_unsafe, confidence, category)
    async def predict(url, text_content) -> dict
```

### Extension Components

```
app-extension/
├── content-script.js      # Injected into all pages
├── background.js          # Message handler + rule refresh
└── manifest.json          # content_scripts registration
```

---

## 4. API Reference

### POST /analyze/content

Analyze URL and page content for safety.

**Request:**
```json
{
  "url": "https://example.com/page",
  "text_content": "First 1000 characters of page text..."
}
```

**Response (Safe):**
```json
{
  "safe": true,
  "action": "none"
}
```

**Response (Unsafe):**
```json
{
  "safe": false,
  "action": "blocked",
  "blocked_by": "url_keywords",      // or "content_analysis"
  "category": "gambling",
  "confidence": 0.87,
  "matched_keyword": "bet",          // only for url_keywords
  "rule_created": true,
  "domain": "1xbet.com"
}
```

### GET /accounts/pin/fetch

Fetch PIN for syncing to new devices.

**Response:**
```json
{
  "has_pin": true,
  "pin": "1234",
  "recovery_codes": ["ABCD1234", "EFGH5678", ...]
}
```

### GET /analyze/health

Check classifier health.

**Response:**
```json
{
  "status": "healthy",
  "classifier_enabled": true,
  "fast_path_keywords": 5
}
```

---

## 5. Configuration

### Environment Variables

Add to `backend/.env`:

```bash
# Hugging Face API Key (required for AI content analysis)
HUGGINGFACE_API_KEY=hf_xxxxxxxxxxxxxxxxxxxxxxxx
```

**Get your API key:** https://huggingface.co/settings/tokens

### Without API Key

If `HUGGINGFACE_API_KEY` is not set:
- Layer 1 (URL keywords) still works
- Layer 2 (AI analysis) is skipped
- Logs warning: `"No Hugging Face API key configured, skipping content analysis"`

---

## 6. Testing

### Test URL Keyword Blocking

Visit these URLs while logged in as a **child account**:

| URL | Expected Result |
|-----|-----------------|
| `https://1xbet.com` | Blocked (keyword: "1xbet") |
| `https://pornhub.com` | Blocked (keyword: "pornhub") |
| `https://bet365.com` | Blocked (keyword: "bet365") |
| `https://google.com` | Allowed |

### Test AI Content Analysis

1. Visit a site with gambling content but clean URL
2. Check console for `[Analysis]` logs
3. Should see HuggingFace API call and classification result

### Verify Rule Persistence

1. Visit blocked site → redirected to blocked.html
2. Check parent dashboard → new blocklist rule should appear
3. Try visiting again → blocked immediately (no AI call)

### Console Logs to Look For

```
[GuardianCore] Content script loaded for: https://...
[GuardianCore] Requesting content analysis for: https://...
[Analysis] Received ANALYZE_PAGE request
[Analysis] URL: https://1xbet.com
[Analysis] Sending content analysis request for: 1xbet.com
[Analysis] Result: {safe: false, blocked_by: "url_keywords", ...}
[Analysis] Refreshing rules to apply new blocklist...
[Analysis] ✅ Rules refreshed - domain now permanently blocked
```

---

## 7. Troubleshooting

### Content Script Not Loading

**Symptom:** No `[GuardianCore]` logs in console

**Solution:**
1. Go to `chrome://extensions`
2. Find GuardianCore
3. Click refresh/reload button
4. Refresh the page

### API 410 Error (Model Gone)

**Symptom:** `410 Client Error` from Hugging Face

**Cause:** Model no longer available on free tier

**Solution:** Already handled with fallback model. If both fail, system allows content (fail-open).

### API 503 Error (Model Loading)

**Symptom:** `503 Service Unavailable`

**Cause:** Model is cold-starting on Hugging Face

**Solution:** Automatic retry with fallback model. First request after idle may be slow (15-30s).

### Rules Not Persisting

**Symptom:** Domain blocked once but not on future visits

**Check:**
1. Verify `rule_created: true` in response
2. Check database for new row in `child_rules`
3. Ensure `loadChildRules()` is called after block

### Rate Limiting

**Symptom:** Some pages not analyzed

**Cause:** 1-minute cooldown per domain

**Solution:** By design to prevent API abuse. Wait 60 seconds to re-analyze same domain.

---

## Summary of Changes

| Component | Files | Changes |
|-----------|-------|---------|
| **PIN Sync** | 2 files | New endpoint + login.js update |
| **Classifier Service** | 2 files | ContentClassifier + HF API integration |
| **Analysis Endpoint** | 1 file | /analyze/content with rule persistence |
| **Content Script** | 1 file | Page text extraction |
| **Background Worker** | 1 file | ANALYZE_PAGE handler |
| **Configuration** | 2 files | HUGGINGFACE_API_KEY + httpx |
| **Manifest** | 1 file | Content script registration |

**Total:** 10 files changed, ~800 lines added

---

## Future Improvements

1. **Image Analysis** - Scan images using NSFW detection models
2. **Caching** - Cache safe domains to reduce API calls
3. **Parent Notifications** - Alert parents when AI blocks content
4. **Configurable Sensitivity** - Let parents adjust AI threshold
5. **Whitelist Override** - Allow parents to unblock AI-flagged sites

