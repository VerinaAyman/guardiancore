# GuardianCore 🛡️

**A comprehensive, GDPR-compliant parental control and privacy protection system for modern browsers**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.104+-green.svg)](https://fastapi.tiangolo.com/)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Manifest%20V3-yellow.svg)](https://developer.chrome.com/docs/extensions/mv3/)

---

## 📋 Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [System Architecture](#system-architecture)
- [Quick Start](#quick-start)
- [User Guide](#user-guide)
- [API Documentation](#api-documentation)
- [Development](#development)
- [Security & Privacy](#security--privacy)
- [GDPR Compliance](#gdpr-compliance)
- [Testing](#testing)
- [Deployment](#deployment)
- [Contributing](#contributing)
- [License](#license)

---

## 🌟 Overview

GuardianCore is a modern, privacy-first parental control system that combines a browser extension with a powerful backend to provide:

- **Explainable Controls**: Transparent blocking with clear explanations
- **Activity Monitoring**: GDPR-compliant browsing activity dashboard
- **Multi-Account Management**: Support for multiple children and groups
- **Flexible Rules**: Blocklists, allowlists, and time-based restrictions
- **Privacy by Design**: Domain-level tracking, automatic data expiration
- **Modern UX**: Search, pagination, and intuitive interfaces

### What Makes GuardianCore Different?

1. **Privacy-First**: Only domain-level data (e.g., "youtube.com"), never full URLs or page content
2. **GDPR Compliant**: Explicit consent, data minimization, automatic deletion (30-90 days)
3. **Explainable**: Children see clear explanations when content is blocked
4. **Flexible**: Rules can target individual children or groups
5. **Actionable**: Parents can block/allow domains directly from the activity dashboard
6. **Modern**: Built with FastAPI, PostgreSQL, and Chrome Manifest V3

---

## ✨ Key Features

### 🔐 Authentication & Account Management
- **Parent Accounts**: Full control over settings, children, and rules
- **Child Accounts**: Limited access with activity tracking opt-in
- **PIN Protection**: Secure access to parent settings
- **Recovery Codes**: 5 one-time use codes for account recovery
- **WebAuthn Support**: Passwordless authentication (future)

### 👨‍👩‍👧‍👦 Multi-Account System
- **Children Management**: Create and manage multiple child accounts
- **Groups**: Organize children into groups (e.g., "Teenagers", "Elementary")
- **Bulk Actions**: Apply rules to entire groups at once
- **Search & Pagination**: Easy navigation with 5 items per page
- **Activity Tracking**: Per-child opt-in activity monitoring

### 📏 Rule System
- **Blocklist Rules**: Block specific domains (e.g., social media during study time)
- **Allowlist Rules**: Only allow specific domains (strict mode)
- **Time Window Rules**: Restrict access during specific times/days (e.g., bedtime)
- **Per-Target Rules**: Apply rules to individual children or groups
- **Rule Priority**: Allowlist > Time Window > Blocklist
- **Import/Export**: Share rule sets between accounts

### 📊 Activity Dashboard (GDPR-Compliant)
- **Domain-Level Tracking**: Only captures domains, not full URLs
- **Time Spent**: Track how long children spend on each domain
- **Security Indicators**: CSP and CORS presence detection
- **Blocked Attempts**: See which sites were blocked
- **Quick Actions**: Block or allow domains directly from dashboard
- **Search & Filter**: Find specific domains quickly
- **Automatic Deletion**: Data expires after 30-90 days

### 🎯 Modern UX Features
- **Search Everywhere**: Real-time search in all sections
- **Pagination**: 5 items per page for better performance
- **Filter Buttons**: Show Children Only, Groups Only, or All
- **Card-Based Selectors**: Visual, clickable cards instead of dropdowns
- **Dark Theme**: Modern, eye-friendly interface
- **Responsive Design**: Works on all screen sizes

### 🔒 Privacy & Security
- **Domain Hashing**: SHA-256 hashing for privacy
- **No PII**: No personal identifiable information stored
- **Encrypted Transport**: HTTPS in production
- **JWT Authentication**: Secure token-based auth
- **Role-Based Access**: Parent vs child permissions
- **Audit Logging**: Track all system actions

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Browser Extension                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Popup      │  │   Options    │  │  Background  │      │
│  │  (3 tabs)    │  │   (Parent)   │  │   (Rules)    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│         │                  │                  │              │
│         └──────────────────┴──────────────────┘              │
│                            │                                 │
│                            ▼                                 │
│                    ┌──────────────┐                          │
│                    │  chrome.     │                          │
│                    │  storage     │                          │
│                    └──────────────┘                          │
└─────────────────────────────────────────────────────────────┘
                             │
                             │ HTTPS + JWT
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                      FastAPI Backend                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │    Auth      │  │   Accounts   │  │   Activity   │      │
│  │   Router     │  │    Router    │  │    Router    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │    Rules     │  │    Groups    │  │    Audit     │      │
│  │   Router     │  │    Router    │  │    Router    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                            │                                 │
│                            ▼                                 │
│                    ┌──────────────┐                          │
│                    │  PostgreSQL  │                          │
│                    │   Database   │                          │
│                    └──────────────┘                          │
└─────────────────────────────────────────────────────────────┘
```

### Database Schema

**Core Tables**:
- `accounts` - User accounts (parent/child)
- `children` - Child profiles with parent relationships
- `groups` - Child groups for bulk management
- `group_members` - Many-to-many child-group relationships
- `rules` - Blocking/allowing/time rules
- `audit_events` - System audit log (30-day retention)

**Activity Tables** (GDPR-Compliant):
- `child_activity_settings` - Per-child tracking opt-in
- `activity_events` - Raw activity events (30-day retention)
- `activity_summaries` - Daily aggregated summaries (90-day retention)

---

## 🚀 Quick Start

### Prerequisites

- **Docker & Docker Compose** (recommended)
- **Chrome/Edge/Brave** browser (Manifest V3 support)
- **Python 3.11+** (for local development)
- **PostgreSQL 15+** (if not using Docker)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/guardiancore.git
   cd guardiancore
   ```

2. **Start the backend services:**
   ```bash
   docker compose up --build
   ```
   
   This starts:
   - PostgreSQL database on port 5432
   - FastAPI backend on port 8000

3. **Load the Chrome extension:**
   - Open `chrome://extensions`
   - Enable **Developer mode** (top right)
   - Click **Load unpacked**
   - Select the `app-extension/` folder
   - Pin the extension to your toolbar

4. **Verify the setup:**
   ```bash
   # Check backend health
   curl http://localhost:8000/health
   
   # Check database connection
   curl http://localhost:8000/health/db
   ```

5. **Create your first account:**
   - Click the GuardianCore extension icon
   - Click "Sign up as parent"
   - Fill in your details
   - Save your recovery codes!

---

## 📖 User Guide

### For Parents

#### 1. **Initial Setup**
1. Install the extension and create a parent account
2. Set up a PIN for accessing settings (default: 1234)
3. Save your 5 recovery codes in a safe place

#### 2. **Adding Children**
1. Go to extension options → **Children** tab
2. Click **+ Add Child**
3. Enter child's name, email, and password
4. Child can now log in with their credentials

#### 3. **Creating Groups**
1. Go to **Groups** tab
2. Click **+ Add Group**
3. Name the group (e.g., "Teenagers")
4. Click **Manage Members** to add children

#### 4. **Setting Up Rules**
1. Go to **Rules** tab
2. Select a child or group
3. Click **+ Add Rule**
4. Choose rule type:
   - **Blocklist**: Block specific domains
   - **Allowlist**: Only allow specific domains
   - **Time Window**: Restrict during certain times
5. Enter pattern (e.g., "tiktok.com")
6. Add explanation (shown to child when blocked)
7. Click **Create Rule**

#### 5. **Activity Monitoring**
1. Go to **Activity** tab
2. Select a child
3. Click **Enable Activity Tracking** (requires consent)
4. View dashboard:
   - Domains visited
   - Time spent per domain
   - Security indicators (CSP/CORS)
   - Blocked attempts
5. Use **Block** or **Allow** buttons for quick actions

#### 6. **Search & Filters**
- Use search bars to find children, groups, or rules
- Use filter buttons in Rules tab (All/Children Only/Groups Only)
- Navigate with Previous/Next buttons (5 items per page)

### For Children

#### 1. **Logging In**
1. Click the extension icon
2. Select "Child" account type
3. Enter your credentials
4. You'll see limited options (no rule management)

#### 2. **When Content is Blocked**
- You'll see a blocking page with:
  - Clear explanation of why it was blocked
  - Which rule triggered the block
  - When the restriction applies (if time-based)

#### 3. **Activity Tracking Notice**
- If your parent enables activity tracking, you'll see a notice
- You'll know exactly what is tracked (domains only)
- You'll know what is NOT tracked (no URLs, content, or messages)

---

## 📡 API Documentation

### Base URL
```
http://localhost:8000
```

### Authentication

All protected endpoints require a JWT token:
```
Authorization: Bearer <token>
```

### Endpoints

#### **Authentication** (`/auth`)
- `POST /auth/register` - Register new account
- `POST /auth/login` - Login and get JWT token
- `POST /auth/reset-password-only` - Reset password with recovery code
- `POST /auth/reset-pin` - Reset PIN with recovery code

#### **Accounts** (`/accounts`)
- `GET /accounts/profile` - Get current user profile
- `PUT /accounts/profile` - Update profile
- `GET /accounts/children` - List children (parent only)
- `POST /accounts/children` - Create child account
- `DELETE /accounts/children/{id}` - Delete child account
- `GET /accounts/rules/{type}/{id}` - Get rules for child/group

#### **Groups** (`/groups`)
- `GET /groups` - List all groups
- `POST /groups` - Create new group
- `PUT /groups/{id}` - Update group
- `DELETE /groups/{id}` - Delete group
- `POST /groups/{id}/members` - Add member to group
- `DELETE /groups/{id}/members/{child_id}` - Remove member

#### **Rules** (`/rules`)
- `GET /rules` - List all rules
- `POST /rules` - Create new rule
- `PUT /rules/{id}` - Update rule
- `DELETE /rules/{id}` - Delete rule
- `POST /rules/{id}/toggle` - Enable/disable rule

#### **Activity** (`/activity`)
- `POST /activity/events` - Capture activity event (child only)
- `GET /activity/settings/{child_id}` - Get tracking settings
- `POST /activity/settings` - Enable/disable tracking
- `GET /activity/dashboard/{child_id}` - View dashboard data
- `POST /activity/actions` - Block/allow domain from dashboard

#### **Audit** (`/audit`)
- `POST /audit/submit` - Submit audit record
- `GET /audit/stats` - Get audit statistics
- `GET /audit/recent` - Get recent audit records

### Example Requests

**Register a parent account:**
```bash
curl -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "John Doe",
    "email": "john@example.com",
    "password": "SecurePass123!",
    "account_type": "parent"
  }'
```

**Create a blocklist rule:**
```bash
curl -X POST http://localhost:8000/rules/ \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "rule_type": "blocklist",
    "pattern": "tiktok.com",
    "target_type": "child",
    "target_id": 1,
    "explanation": "Blocked during study hours",
    "enabled": true
  }'
```

**Get activity dashboard:**
```bash
curl http://localhost:8000/activity/dashboard/1?days=7 \
  -H "Authorization: Bearer <token>"
```

---

## 🛠️ Development

### Project Structure

```
guardiancore/
├── backend/                    # FastAPI backend
│   ├── src/app/
│   │   ├── main.py            # FastAPI app + background jobs
│   │   ├── config.py          # Configuration
│   │   ├── db.py              # Database models
│   │   └── routers/           # API routers
│   │       ├── auth.py        # Authentication
│   │       ├── accounts.py    # Account management
│   │       ├── groups.py      # Group management
│   │       ├── rules.py       # Rule management
│   │       ├── activity.py    # Activity tracking
│   │       ├── audit.py       # Audit logging
│   │       └── webauthn.py    # WebAuthn (future)
│   ├── requirements.txt       # Python dependencies
│   └── Dockerfile             # Backend container
├── app-extension/             # Chrome extension
│   ├── manifest.json          # Manifest V3 config
│   ├── popup.html             # Extension popup (3 tabs)
│   ├── popup.js               # Popup logic
│   ├── login.html             # Login/register page
│   ├── login.js               # Auth logic
│   ├── options.html           # Parent dashboard
│   ├── options.js             # Dashboard logic (2500+ lines)
│   ├── child-options.html     # Child settings
│   ├── child-options.js       # Child logic
│   ├── blocked.html           # Blocking page
│   ├── blocked.js             # Block explanation
│   ├── background.js          # Service worker (rules + tracking)
│   └── styles.css             # Shared styles
├── docs/                      # Documentation
│   ├── DPIA.md               # Data Protection Impact Assessment
│   ├── architecture.md        # Architecture diagrams
│   ├── PHASE-*.md            # Implementation summaries
│   └── *.md                  # Feature documentation
├── scripts/                   # Utility scripts
│   ├── test-*.sh             # Test scripts
│   └── setup.sh              # Setup script
├── docker-compose.yml         # Multi-service setup
└── README.md                 # This file
```

### Local Development

#### Backend Development
```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn src.app.main:app --reload --host 0.0.0.0 --port 8000
```

#### Extension Development
1. Make changes in `app-extension/`
2. Go to `chrome://extensions`
3. Click the reload icon on GuardianCore
4. Test your changes

#### Database Management
```bash
# Connect to PostgreSQL
docker exec -it guardiancore-db-1 psql -U postgres -d guardiancore

# View tables
\dt

# Query data
SELECT * FROM accounts;
SELECT * FROM rules;
SELECT * FROM activity_summaries;
```

### Environment Variables

Create a `.env` file in the `backend/` directory:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/guardiancore
SECRET_KEY=your-secret-key-here
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
```

---

## 🔒 Security & Privacy

### Privacy-First Design

1. **Data Minimization**
   - Only domain-level data (e.g., "youtube.com")
   - No full URLs, page titles, or content
   - No personal messages or form data
   - Only essential metadata (time, CSP, CORS)

2. **Domain Hashing**
   - Domains hashed with SHA-256
   - Prevents reverse lookup
   - Maintains privacy even if database compromised

3. **Automatic Deletion**
   - Raw events: 30 days maximum
   - Aggregated summaries: 90 days maximum
   - Hourly cleanup jobs
   - No data kept indefinitely

4. **Explicit Consent**
   - Activity tracking OFF by default
   - Parent must explicitly enable per child
   - Child receives clear notification
   - Can be disabled at any time

### Security Measures

1. **Authentication**
   - JWT-based token authentication
   - Secure password hashing (bcrypt)
   - Recovery codes for account recovery
   - PIN protection for parent settings

2. **Authorization**
   - Role-based access control (parent vs child)
   - Parent can only access their own children
   - Child cannot view their own activity data
   - Strict endpoint permissions

3. **Transport Security**
   - HTTPS required in production
   - Secure token storage in chrome.storage
   - No sensitive data in logs
   - CORS configured properly

4. **Database Security**
   - Parameterized queries (SQL injection prevention)
   - Connection pooling
   - Docker network isolation
   - Regular backups recommended

---

## ⚖️ GDPR Compliance

GuardianCore is designed with GDPR compliance as a core principle:

### ✅ Lawful Basis
- **Parental supervision** as lawful basis for processing
- Explicit consent required for activity tracking
- Clear purpose limitation

### ✅ Data Minimization
- Only domain-level data collected
- No unnecessary personal data
- Minimal metadata (time, security indicators)

### ✅ Transparency
- Clear privacy notices to parents and children
- Dashboard shows GDPR disclaimer
- Documentation explains data handling

### ✅ Storage Limitation
- 30-day retention for raw events
- 90-day retention for summaries
- Automatic deletion enforced
- No indefinite storage

### ✅ Access Control
- Parent-only dashboard access
- Child cannot view their own data
- Strict authentication/authorization
- Audit logging of all actions

### ✅ Security
- Domain hashing for privacy
- Encrypted transport (HTTPS)
- Secure token handling
- Regular security updates

### ✅ Rights of Data Subjects
- Right to access (parent can view dashboard)
- Right to erasure (delete child account)
- Right to restrict processing (disable tracking)
- Right to data portability (export feature planned)

---

## 🧪 Testing

### Automated Tests

```bash
# Run all tests
./scripts/complete-test.sh

# Test specific features
./scripts/test-week3.sh      # Rule system
./scripts/test-activity.sh   # Activity dashboard
```

### Manual Testing

#### Test Account Creation
1. Create parent account
2. Verify recovery codes received
3. Set PIN
4. Create child account
5. Verify child can log in

#### Test Rule System
1. Create blocklist rule for "tiktok.com"
2. As child, try to visit tiktok.com
3. Verify blocking page appears
4. Verify explanation is shown

#### Test Activity Dashboard
1. Enable tracking for a child
2. As child, browse some websites (≥5 seconds each)
3. As parent, view activity dashboard
4. Verify domains appear
5. Test Block/Allow buttons

#### Test Search & Pagination
1. Create 10+ children
2. Test search functionality
3. Verify pagination works
4. Test filter buttons in Rules tab

---

## 🚢 Deployment

### Production Checklist

- [ ] Change default PIN from 1234
- [ ] Set strong SECRET_KEY in environment
- [ ] Enable HTTPS (required for production)
- [ ] Configure proper CORS origins
- [ ] Set up database backups
- [ ] Enable audit logging
- [ ] Review GDPR compliance
- [ ] Test all features end-to-end
- [ ] Monitor background jobs
- [ ] Set up error tracking

### Docker Deployment

```bash
# Production build
docker compose -f docker-compose.prod.yml up -d

# View logs
docker compose logs -f backend

# Restart services
docker compose restart backend
```

### Environment Configuration

Production `.env`:
```env
DATABASE_URL=postgresql://user:pass@db-host:5432/guardiancore
SECRET_KEY=<generate-strong-key>
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
ENVIRONMENT=production
```

---

## 🤝 Contributing

We welcome contributions! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Code Style

- **Python**: Follow PEP 8, use type hints
- **JavaScript**: Use ES6+, consistent naming
- **SQL**: Use parameterized queries
- **Comments**: Explain why, not what

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 📞 Support

- **Documentation**: See `docs/` folder
- **Issues**: GitHub Issues
- **Email**: support@guardiancore.example

---

## 🎯 Roadmap

### Phase 7 (Planned)
- [ ] Export functionality (CSV/JSON)
- [ ] Activity charts and trends
- [ ] Email summaries
- [ ] Mobile app support

### Phase 8 (Future)
- [ ] Multi-device sync
- [ ] Advanced analytics
- [ ] Anomaly detection
- [ ] Peer benchmarking
- [ ] WebAuthn passwordless auth

---

## 🙏 Acknowledgments

- FastAPI for the excellent web framework
- Chrome Extensions team for Manifest V3
- PostgreSQL for reliable data storage
- All contributors and testers

---

**Built with ❤️ for safer, more transparent browsing**

*GuardianCore - Privacy-first parental controls for the modern web*
