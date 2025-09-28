# GuardianCore

A regulated, GDPR-compliant browser extension and backend system for safer browsing with parental/guardian features.

## Week 1 Deliverables ✅

- ✅ FastAPI backend with health routes and PostgreSQL connection
- ✅ Manifest V3 Chrome extension with API call functionality  
- ✅ Docker Compose configuration for PostgreSQL and backend services
- ✅ DPIA draft v1 with data flows and compliance considerations
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

- No personal data collection in Week 1
- CORS configured for localhost development
- Database isolation via Docker networks
- Audit logging planned for future releases
