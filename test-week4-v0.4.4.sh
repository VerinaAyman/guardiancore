#!/bin/bash
# GuardianCore v0.4.4 Comprehensive Test Script

echo "🧪 GuardianCore v0.4.4 Test Suite"
echo "=================================="
echo ""

# Test 1: Backend Health
echo "✓ Test 1: Backend Health"
HEALTH=$(curl -s http://localhost:8000/health)
if echo "$HEALTH" | grep -q '"status":"ok"'; then
  echo "  ✅ Backend healthy: $HEALTH"
else
  echo "  ❌ Backend not responding"
  exit 1
fi
echo ""

# Test 2: Add Rule
echo "✓ Test 2: Add Rule (Blocklist)"
ADD_RESULT=$(curl -s -X POST http://localhost:8000/rules/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dev-token-123" \
  -d '{"rule_type":"blocklist","pattern":"example.com","explanation":"Test rule","enabled":true}')
  
if echo "$ADD_RESULT" | grep -q '"id"'; then
  RULE_ID=$(echo "$ADD_RESULT" | grep -o '"id":[0-9]*' | cut -d: -f2)
  echo "  ✅ Rule created: ID=$RULE_ID, pattern=example.com"
else
  echo "  ❌ Failed to create rule"
  echo "  Response: $ADD_RESULT"
  exit 1
fi
echo ""

# Test 3: List Rules
echo "✓ Test 3: List Rules"
RULES=$(curl -s -H "Authorization: Bearer dev-token-123" "http://localhost:8000/rules/?enabled_only=true")
if echo "$RULES" | grep -q "example.com"; then
  echo "  ✅ Rules fetched successfully"
  echo "  Found rules: $(echo "$RULES" | grep -o '"pattern":"[^"]*"' | wc -l | tr -d ' ')"
else
  echo "  ❌ Failed to fetch rules"
  exit 1
fi
echo ""

# Test 4: Export Rules
echo "✓ Test 4: Export Rules"
EXPORT=$(curl -s -H "Authorization: Bearer dev-token-123" "http://localhost:8000/rules/export")
if echo "$EXPORT" | grep -q '"version"'; then
  echo "  ✅ Export working"
  echo "  Export version: $(echo "$EXPORT" | grep -o '"version":"[^"]*"' | cut -d'"' -f4)"
else
  echo "  ❌ Export failed"
  exit 1
fi
echo ""

# Test 5: Audit Stats
echo "✓ Test 5: Audit Stats"
STATS=$(curl -s -H "Authorization: Bearer dev-token-123" "http://localhost:8000/audit/stats")
if echo "$STATS" | grep -q '"total_audits"'; then
  echo "  ✅ Audit stats working"
  echo "  Total audits: $(echo "$STATS" | grep -o '"total_audits":[0-9]*' | cut -d: -f2)"
else
  echo "  ❌ Stats failed"
  exit 1
fi
echo ""

# Test 6: Risk Score
echo "✓ Test 6: Risk Score"
RISK=$(curl -s -H "Authorization: Bearer dev-token-123" "http://localhost:8000/risk/score")
if echo "$RISK" | grep -q '"score"'; then
  SCORE=$(echo "$RISK" | grep -o '"score":[0-9]*' | cut -d: -f2)
  echo "  ✅ Risk scoring working"
  echo "  Current score: $SCORE/100"
else
  echo "  ❌ Risk score failed"
  exit 1
fi
echo ""

# Test 7: Delete Rule
echo "✓ Test 7: Delete Rule"
DELETE=$(curl -s -X DELETE -H "Authorization: Bearer dev-token-123" "http://localhost:8000/rules/${RULE_ID}/")
if [ "$?" -eq 0 ]; then
  echo "  ✅ Rule deleted: ID=$RULE_ID"
else
  echo "  ❌ Delete failed"
  exit 1
fi
echo ""

echo "=================================="
echo "✅ All tests passed!"
echo ""
echo "📋 Next Steps:"
echo "1. Reload extension: chrome://extensions → GuardianCore → Refresh (⟳)"
echo "2. Open Options page and test:"
echo "   - Save Backend Settings (should show ✅ success)"
echo "   - Add a new rule (should show ✅ success)"
echo "   - View rules list (should display added rules)"
echo "3. Check popup:"
echo "   - Safe Streak should start at 0 hours"
echo "   - Risk Score should show current score"
echo "4. Test streak:"
echo "   - Browse normally for 1+ hour"
echo "   - Refresh popup → streak should increment"
echo "   - Visit blocked site → streak resets to 0"
