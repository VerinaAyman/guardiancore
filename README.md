# GuardianLens 🛡️

**AI-Powered Child Online Safety System**

[![Python](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.104+-green.svg)](https://fastapi.tiangolo.com/)
[![React Native](https://img.shields.io/badge/React%20Native-Expo-purple.svg)](https://expo.dev/)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Manifest%20V3-yellow.svg)](https://developer.chrome.com/docs/extensions/mv3/)

> Bachelor Thesis Project — Media Engineering and Technology  
> German University in Cairo  
> **Author: Verina Ayman**

---

## 📋 Table of Contents

- [Overview](#overview)
- [What Makes GuardianLens Different](#what-makes-guardianlens-different)
- [System Components](#system-components)
- [How to Test — Browser Extension](#-how-to-test--browser-extension)
- [How to Test — Mobile App](#-how-to-test--mobile-app-iphone)
- [System Architecture](#-system-architecture)
- [Tech Stack](#-tech-stack)
- [Security & Privacy](#-security--privacy)

---

## 🌟 Overview

GuardianLens is an AI-powered child safety system that protects children 
while browsing the internet — on any browser, any app, and any device.

It works on two levels:

- **🖥️ Browser Extension** — protects the child in Chrome on any computer
- **📱 Mobile App** — gives parents a real-time dashboard on their iPhone

### What it does:
- 🚫 Automatically blocks harmful and age-inappropriate websites
- ⚠️ Warns about risky content before the child sees it
- 💬 Detects grooming patterns in chat messages (WhatsApp Web, Discord, etc.)
- 📧 Sends the parent a notification and email when a site is blocked
- 🤖 Gives the child an AI companion to explain why something was blocked
- 📊 Tracks browsing activity with full privacy (domain level only, no URLs or content)
- 🌐 System-wide DNS filtering — blocks in Safari, Chrome, AND every app on the phone

---

## ✨ What Makes GuardianLens Different

| Feature | GuardianLens | Traditional Tools |
|---------|-------------|-------------------|
| AI grooming detection in chat | ✅ | ❌ |
| System-wide DNS filtering | ✅ | ❌ |
| Child-facing AI companion | ✅ | ❌ |
| Explainable blocking decisions | ✅ | ❌ |
| Privacy-first (domain level only) | ✅ | ❌ |
| Real-time parent notifications | ✅ | ❌ |

---

## 🧩 System Components

### 1. 🖥️ Browser Extension (Chrome)
- Intercepts and evaluates every web request
- Blocks harmful domains instantly with a child-readable explanation
- Warns about age-inappropriate sites (social media, gaming, etc.)
- Detects grooming language in chat messages on any website
- AI chatbot on the blocking page suggests safe alternatives
- Parent gets email notification every time something is blocked

### 2. 📱 Mobile App (React Native / Expo)
- Parent dashboard showing each child's activity in real-time
- Filter by visits, warnings, and blocked events
- Add custom domain blocks per child directly from the phone
- Push notifications when a new site is blocked
- DNS profile installation flow built in

### 3. 🌐 DNS Filtering Layer (iOS)
- System-wide blocking via encrypted DNS-over-HTTPS profile
- Blocks at the network level — works in every app, not just browsers
- AI classifies unknown domains into block / warn / safe
- Known harmful domains blocked instantly without AI token usage

### 4. ⚙️ Backend (FastAPI + PostgreSQL)
- JWT-authenticated REST API
- Role-based access (parent vs child)
- Activity tracking with GDPR-compliant automatic deletion
- Deployed live on Railway — no setup needed for testers

---

## 🚀 How to Test — Browser Extension

### Step 1: Download
Download **GuardianLens-Extension.zip** from the releases page:

👉 **[Download Here](https://github.com/VerinaAyman/guardiancore/releases/tag/v1.0.0)**

### Step 2: Install
1. Unzip the downloaded file
2. Open Chrome and go to: `chrome://extensions`
3. Enable **Developer Mode** (toggle in the top right corner)
4. Click **"Load unpacked"**
5. Select the unzipped `app-extension` folder
6. The GuardianLens shield icon will appear in your Chrome toolbar

### Step 3: Create an Account
1. Click the GuardianLens icon in the toolbar
2. Click **Register** → create a **Parent** account first
3. Then create a **Child** account
4. Log in as the child to test blocking

### Step 4: Test It

Log in as the child account and visit these sites:

| Site | Expected Result |
|------|----------------|
| `google.com` | ✅ Loads normally |
| `tiktok.com` | ⚠️ Warning page with AI chat |
| `pornhub.com` | 🚫 Blocked with explanation + AI chat |

**To test chat detection:**
1. Go to `web.whatsapp.com` while logged in as child
2. Send a message containing suspicious language
3. A warning overlay will appear on the page

---

## 📱 How to Test — Mobile App (iPhone)

### Step 1: Install Expo Go
Download **Expo Go** from the App Store on your iPhone.

### Step 2: Open the App
Open this link on your iPhone or paste it into Expo Go:
exp://u.expo.dev/94e774ef-725a-4dae-87e4-e45e846dcc13

👉 Expo Go → tap **"Enter URL manually"** → paste the link above

### Step 3: Test It
- Log in as a **parent** to see the full dashboard
- View blocked sites, warnings, and activity per child
- Tap the filter buttons (Visits / Warnings / Blocked)
- Add a custom blocked domain for a specific child
- Install the DNS profile to enable system-wide blocking on your phone

---

## 🏗️ System Architecture
┌─────────────────────────────────────────────────────┐
│               Chrome Browser Extension               │
│  ┌───────────┐  ┌───────────┐  ┌─────────────────┐ │
│  │  Popup    │  │  Options  │  │   Background    │ │
│  │ (3 tabs)  │  │ (Parent)  │  │ Service Worker  │ │
│  └───────────┘  └───────────┘  └─────────────────┘ │
│         │              │               │             │
│         └──────────────┴───────────────┘             │
│                        │                             │
│               Content Script                         │
│         (Page scanning + Chat interception)          │
└────────────────────────┬────────────────────────────┘
│ HTTPS + JWT
▼
┌─────────────────────────────────────────────────────┐
│              FastAPI Backend (Railway)               │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │   Auth   │ │  Rules   │ │ Activity │            │
│  └──────────┘ └──────────┘ └──────────┘            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ Accounts │ │ Analyze  │ │  Notify  │            │
│  └──────────┘ └──────────┘ └──────────┘            │
│                     │                               │
│              PostgreSQL Database                     │
└─────────────────────┬───────────────────────────────┘
│
┌───────────┴───────────┐
▼                       ▼
┌──────────────────┐   ┌──────────────────────┐
│  Groq API        │   │  React Native App     │
│  (LLaMA 3.3 70B) │   │  (Expo / iOS)         │
│  AI Classification│   │  Parent Dashboard     │
└──────────────────┘   └──────────────────────┘

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python, FastAPI, SQLAlchemy |
| Database | PostgreSQL (Railway) |
| Mobile App | React Native, Expo |
| Browser Extension | Chrome Manifest V3 |
| AI Classification | Groq API — LLaMA 3.3 70B |
| DNS Filtering | iOS DNS-over-HTTPS profile |
| Notifications | Expo Push Notifications, EmailJS |
| Deployment | Railway (backend + database) |

---

## 🔒 Security & Privacy

### Privacy-First Design
- **Domain-level only** — never full URLs, page content, or messages
- **SHA-256 hashing** of domains in the database
- **Automatic deletion** — raw events after 30 days, summaries after 90 days
- **Opt-in tracking** — activity monitoring is off by default

### Security Measures
- JWT authentication on every protected endpoint
- Role-based access control (parent vs child)
- bcrypt password hashing
- Parameterized queries throughout (SQL injection prevention)
- HTTPS enforced in production

### GDPR Compliance
- ✅ Data minimization — only domain-level data
- ✅ Storage limitation — automatic deletion enforced
- ✅ Transparency — children see explanations for every block
- ✅ Right to erasure — delete child account removes all data
- ✅ Explicit consent required for activity tracking

---

## 🌐 Live Backend
https://guardiancore-production.up.railway.app

Health check: `https://guardiancore-production.up.railway.app/health`

---

**Built with ❤️ for safer, smarter, and more transparent browsing**

*GuardianLens — From watching the child to guiding the digital citizen*
