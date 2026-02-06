#!/bin/bash

echo "🧪 GuardianCore Simple Test"
echo "=========================="

# Start services
echo "🚀 Starting services..."
docker compose up -d

# Wait for services
echo "⏳ Waiting for services to start..."
sleep 10

# Test basic endpoints
echo "✅ Testing basic endpoints..."
curl -s http://localhost:8000/ | jq .
curl -s http://localhost:8000/health | jq .
curl -s http://localhost:8000/health/db | jq .

# Test audit submit
echo "✅ Testing audit submit..."
curl -i -X POST http://localhost:8000/audit/submit \
  -H "Authorization: Bearer dev-token-123" \
  -H "Content-Type: application/json" \
  -d '{
    "origin_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "ts_iso": "2024-12-19T00:00:00Z",
    "check_type": "page_audit_v1",
    "policy_state": {
      "csp_present": true,
      "cors_signals": false,
      "tracker_count": 3
    }
  }'

# Test recent audits
echo "✅ Testing recent audits..."
curl -s -H "Authorization: Bearer dev-token-123" http://localhost:8000/audit/recent | jq .

echo ""
echo "🎉 Basic test complete!"
echo ""
echo "Next steps:"
echo "1. Load the Chrome extension"
echo "2. Configure backend URL: http://localhost:8000"
echo "3. Configure API token: dev-token-123"
echo "4. Browse some websites to generate audit data"

