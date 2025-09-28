# GuardianCore Setup Guide

## Prerequisites

1. **Docker Desktop** - Download and install from [docker.com](https://www.docker.com/products/docker-desktop/)
2. **Chrome/Edge/Brave** - For testing the extension
3. **Git** - For version control

## Quick Setup

### 1. Start Docker Desktop
- Open Docker Desktop application
- Wait for it to fully start (green icon in system tray)

### 2. Start the Services
```bash
# Option 1: Use the verification script
./scripts/verify-setup.sh

# Option 2: Manual setup
docker compose up --build
```

### 3. Load the Chrome Extension
1. Open Chrome and navigate to `chrome://extensions`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `app-extension` folder
5. Pin the extension to your toolbar
6. Click the extension icon and test "Ping Backend"

### 4. Verify Everything Works
```bash
# Test API endpoints
curl http://localhost:8000/          # Should return: {"message":"GuardianCore backend alive"}
curl http://localhost:8000/health    # Should return: {"status":"ok","name":"GuardianCore","env":"dev"}
curl http://localhost:8000/health/db # Should return: {"db":"ok"}
```

## Troubleshooting

### Docker Issues
- **"Cannot connect to Docker daemon"**: Start Docker Desktop
- **Port conflicts**: Stop other services using ports 8000 or 5432
- **Permission denied**: Run `sudo chmod +x scripts/verify-setup.sh`

### Extension Issues
- **CORS errors**: Make sure backend is running on localhost:8000
- **Extension won't load**: Check manifest.json syntax
- **"Ping Backend" fails**: Verify backend is running and accessible

### Database Issues
- **Connection refused**: Wait for PostgreSQL to fully start (can take 30+ seconds)
- **Health check fails**: Check `docker compose logs db`

## Development Commands

```bash
# Start services
make up
# or
docker compose up --build

# Stop services
make down
# or
docker compose down

# View logs
make logs
# or
docker compose logs -f

# Test endpoints
make test
```

## Project Structure

```
guardiancore/
├── backend/              # FastAPI backend
├── app-extension/        # Chrome extension
├── docs/                # Documentation
├── scripts/             # Utility scripts
├── docker-compose.yml   # Multi-service setup
└── Makefile            # Development commands
```

## Next Steps

1. ✅ Backend running with health checks
2. ✅ Chrome extension loaded and communicating
3. ✅ Database connected and healthy
4. ✅ DPIA draft completed
5. ✅ Architecture diagrams created
6. ✅ Git repository initialized

**Week 1 Complete!** 🎉
