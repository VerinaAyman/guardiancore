# GuardianCore

A regulated, GDPR-compliant browser extension and backend system for safer browsing with parental/guardian features.

## Week 2 Deliverables ✅

- ✅ FastAPI backend with health routes and PostgreSQL connection
- ✅ Manifest V3 Chrome extension with audit probe functionality
- ✅ Privacy-preserving audit data collection and submission
- ✅ Bearer token authentication for API security
- ✅ Audit statistics and analytics endpoints
- ✅ Enhanced database schema with audit_events table
- ✅ Docker Compose configuration for PostgreSQL and backend services
- ✅ Updated DPIA v2 with audit data processing details
- ✅ Architecture and data-flow diagrams
- ✅ Git repository with proper .gitignore

## Quick Start

### Prerequisites
- Chrome/Edge/Brave (for MV3 testing)
- Python 3.11+, Node 18+, Git
- Docker + Docker Compose

### Running the System

1. **Start the backend services:**
   ```bash
   docker compose up --build
   ```

2. **Load the Chrome extension:**
   - Open `chrome://extensions`
   - Enable Developer mode
   - Click "Load unpacked" and select the `app-extension/` folder
   - Pin the extension and click "Ping Backend" to test

3. **Verify the setup:**
   ```bash
   curl http://localhost:8000/          # Backend alive
   curl http://localhost:8000/health   # Health check
   curl http://localhost:8000/health/db # Database health
   ```

4. **Test the audit system:**
   ```bash
   ./scripts/test-audit-system.sh
   ```

## Architecture

See [docs/architecture.md](docs/architecture.md) for detailed architecture diagrams.

## Compliance

See [docs/DPIA.md](docs/DPIA.md) for the Data Protection Impact Assessment.

## Project Structure

```
guardiancore/
├── backend/                 # FastAPI backend
│   ├── src/app/
│   │   ├── main.py         # FastAPI app
│   │   ├── config.py       # Settings
│   │   ├── db.py          # Database connection
│   │   └── routers/       # API routes
│   ├── requirements.txt   # Python dependencies
│   └── Dockerfile         # Backend container
├── app-extension/          # Chrome extension
│   ├── manifest.json      # MV3 manifest
│   ├── popup.html         # Extension popup
│   ├── popup.js          # Popup logic
│   └── background.js      # Service worker
├── docs/                  # Documentation
│   ├── DPIA.md           # Data Protection Impact Assessment
│   └── architecture.md   # Architecture diagrams
├── docker-compose.yml     # Multi-service setup
└── README.md             # This file
```

## Development

### Backend Development
```bash
cd backend
pip install -r requirements.txt
uvicorn src.app.main:app --reload
```

### Extension Development
- Edit files in `app-extension/`
- Reload extension in Chrome
- Check console for errors

## Security & Privacy

- **Privacy-first design**: Only origin hashes (SHA-256) stored, no full URLs or PII
- **Data minimization**: Only security-relevant metadata (CSP, CORS, tracker counts)
- **Authentication**: Bearer token-based API security
- **Data retention**: 30-day retention policy for audit records
- **CORS configured** for localhost development
- **Database isolation** via Docker networks
- **Comprehensive audit logging** with privacy-preserving design

## API Endpoints

### Health & Status
- `GET /` - Backend status
- `GET /health` - Health check
- `GET /health/db` - Database health
- `GET /health/version` - Version info

### Audit System
- `POST /audit/submit` - Submit audit record (requires Bearer token)
- `GET /audit/stats` - Get audit statistics (requires Bearer token)
- `GET /audit/recent` - Get recent audit records (requires Bearer token)

### Authentication
All audit endpoints require a valid Bearer token in the Authorization header:
```
Authorization: Bearer dev-token-123
```
