#!/bin/bash

echo "🧪 GuardianCore Audit System Test"
echo "================================="

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
sleep 15

# Test backend endpoints
echo "🧪 Testing backend endpoints..."

echo "Testing root endpoint..."
curl -s http://localhost:8000/ | jq . || echo "❌ Root endpoint failed"

echo "Testing health endpoint..."
curl -s http://localhost:8000/health | jq . || echo "❌ Health endpoint failed"

echo "Testing database health..."
curl -s http://localhost:8000/health/db | jq . || echo "❌ Database health failed"

# Test audit endpoints
echo "Testing audit submit endpoint..."
AUDIT_RECORD='{
  "origin_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "ts_iso": "2024-12-19T00:00:00Z",
  "check_type": "page_audit_v1",
  "policy_state": {
    "csp_present": true,
    "cors_signals": false,
    "tracker_count": 3
  }
}'

curl -i -X POST http://localhost:8000/audit/submit \
  -H "Authorization: Bearer dev-token-123" \
  -H "Content-Type: application/json" \
  -d "$AUDIT_RECORD" || echo "❌ Audit submit failed"

echo "Testing audit stats endpoint..."
curl -s -H "Authorization: Bearer dev-token-123" http://localhost:8000/audit/stats | jq . || echo "❌ Audit stats failed"

echo "Testing recent audits endpoint..."
curl -s -H "Authorization: Bearer dev-token-123" http://localhost:8000/audit/recent | jq . || echo "❌ Recent audits failed"

echo ""
echo "🎉 Audit system test complete!"
echo ""
echo "Next steps:"
echo "1. Load the updated extension in Chrome"
echo "2. Configure backend URL and API token in extension popup"
echo "3. Browse some websites to generate audit data"
echo "4. Check the audit stats endpoint for results"
echo ""
echo "To stop services: docker compose down"
