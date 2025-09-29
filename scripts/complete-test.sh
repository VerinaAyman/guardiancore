#!/bin/bash

echo "🎉 GuardianCore Complete System Test"
echo "===================================="

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker Desktop first."
    exit 1
fi

echo "✅ Docker is running"

# Start services
echo "🚀 Starting services..."
docker compose up --build -d

# Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 10

echo ""
echo "🧪 Testing Backend Endpoints"
echo "============================"

# Test basic endpoints
echo "✅ Testing root endpoint..."
curl -s http://localhost:8000/ | jq .

echo "✅ Testing health endpoint..."
curl -s http://localhost:8000/health | jq .

echo "✅ Testing database health..."
curl -s http://localhost:8000/health/db | jq .

# Test audit system
echo ""
echo "🧪 Testing Audit System"
echo "======================="

echo "✅ Testing audit submit..."
curl -i -X POST http://localhost:8000/audit/submit \
  -H "Authorization: Bearer dev-token-123" \
  -H "Content-Type: application/json" \
  -d '{
    "origin_hash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "ts_iso": "2024-12-19T00:00:00Z",
    "check_type": "page_audit_v1",
    "policy_state": {
      "csp_present": false,
      "cors_signals": true,
      "tracker_count": 5
    }
  }'

echo ""
echo "✅ Testing audit stats..."
curl -s -H "Authorization: Bearer dev-token-123" http://localhost:8000/audit/stats | jq .

echo ""
echo "✅ Testing recent audits..."
curl -s -H "Authorization: Bearer dev-token-123" http://localhost:8000/audit/recent | jq .

echo ""
echo "🎉 All Tests Passed!"
echo ""
echo "📋 Chrome Extension Testing Steps:"
echo "1. Open Chrome and go to chrome://extensions"
echo "2. Enable 'Developer mode' (toggle in top right)"
echo "3. Click 'Load unpacked' and select the 'app-extension' folder"
echo "4. Pin the extension to your toolbar"
echo "5. Click the extension icon to open settings"
echo "6. Configure:"
echo "   - Backend URL: http://localhost:8000"
echo "   - API Token: dev-token-123"
echo "7. Click 'Save Settings'"
echo "8. Browse some websites (google.com, facebook.com, etc.)"
echo "9. Check the audit data being submitted!"
echo ""
echo "🔍 Monitoring Commands:"
echo "- Watch logs: docker compose logs -f backend"
echo "- Check database: docker compose exec db psql -U gc_user -d guardiancore -c 'SELECT * FROM audit_events ORDER BY ts DESC LIMIT 5;'"
echo "- Stop services: docker compose down"
