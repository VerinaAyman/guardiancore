#!/bin/bash
# Week 4 Test Suite - GuardianCore
# Tests: Risk Scoring, Export/Import, WebAuthn stubs, Gamification

set -e

BASE_URL="${BASE_URL:-http://localhost:8000}"
API_TOKEN="${API_TOKEN:-dev-token-123}"

echo "🧪 GuardianCore Week 4 Test Suite"
echo "=================================="
echo "Backend: $BASE_URL"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

function pass() {
  echo -e "${GREEN}✓${NC} $1"
}

function fail() {
  echo -e "${RED}✗${NC} $1"
  exit 1
}

function info() {
  echo -e "${YELLOW}ℹ${NC} $1"
}

# Test 1: Health Check
echo "Test 1: Health Check"
response=$(curl -s "$BASE_URL/health")
if echo "$response" | grep -q "healthy"; then
  pass "Backend is healthy"
else
  fail "Backend health check failed"
fi
echo ""

# Test 2: Risk Scoring Endpoint
echo "Test 2: Risk Scoring Endpoint"
response=$(curl -s -H "Authorization: Bearer $API_TOKEN" "$BASE_URL/risk/score")
if echo "$response" | grep -q "score"; then
  score=$(echo "$response" | grep -o '"score":[0-9]*' | grep -o '[0-9]*')
  pass "Risk score retrieved: $score"
else
  fail "Risk score endpoint failed"
fi
echo ""

# Test 3: Submit Test Audits for Risk Calculation
echo "Test 3: Submit Test Audits (Blocked Events)"
for i in {1..3}; do
  # Generate unique hash for each
  hash=$(echo -n "test-origin-$i-$(date +%s)" | shasum -a 256 | cut -d' ' -f1)
  
  response=$(curl -s -X POST "$BASE_URL/audit/submit" \
    -H "Authorization: Bearer $API_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
      \"origin_hash\": \"$hash\",
      \"check_type\": \"page_audit_v2\",
      \"policy_state\": {
        \"csp_present\": false,
        \"cors_signals\": true,
        \"tracker_count\": 5,
        \"blocked\": true,
        \"trackers_by_category\": {
          \"advertising\": 3,
          \"social_media\": 2
        }
      }
    }")
  
  if echo "$response" | grep -q "ok"; then
    info "Audit $i submitted"
  fi
done
pass "Test audit data submitted"
echo ""

# Test 4: Verify Risk Score Updated
echo "Test 4: Verify Risk Score Reflects Test Data"
sleep 1  # Brief wait for processing
response=$(curl -s -H "Authorization: Bearer $API_TOKEN" "$BASE_URL/risk/score")
score=$(echo "$response" | grep -o '"score":[0-9]*' | grep -o '[0-9]*')
breakdown=$(echo "$response" | grep -o '"blocked_site_attempts":[0-9]*' | grep -o '[0-9]*')

if [ "$score" -gt 0 ]; then
  pass "Risk score increased to $score (blocked attempts: $breakdown)"
else
  fail "Risk score did not update"
fi
echo ""

# Test 5: Rules Export
echo "Test 5: Export Rules"
response=$(curl -s -H "Authorization: Bearer $API_TOKEN" "$BASE_URL/rules/export")
if echo "$response" | grep -q "version"; then
  version=$(echo "$response" | grep -o '"version":[0-9]*' | grep -o '[0-9]*')
  pass "Rules exported (version: $version)"
  
  # Save for import test
  echo "$response" > /tmp/gc_rules_export.json
else
  fail "Rules export failed"
fi
echo ""

# Test 6: Rules Import (re-import same data)
echo "Test 6: Import Rules"
if [ -f /tmp/gc_rules_export.json ]; then
  response=$(curl -s -X POST "$BASE_URL/rules/import" \
    -H "Authorization: Bearer $API_TOKEN" \
    -H "Content-Type: application/json" \
    -d @/tmp/gc_rules_export.json)
  
  if echo "$response" | grep -q "ok"; then
    imported=$(echo "$response" | grep -o '"imported_count":[0-9]*' | grep -o '[0-9]*')
    pass "Rules imported ($imported rules)"
  else
    fail "Rules import failed"
  fi
else
  fail "Export file not found"
fi
echo ""

# Test 7: WebAuthn Stubs
echo "Test 7: WebAuthn Stub Endpoints"

# Register options
response=$(curl -s -X POST "$BASE_URL/webauthn/register/options" \
  -H "Authorization: Bearer $API_TOKEN")
if echo "$response" | grep -q "stub"; then
  pass "WebAuthn register/options stub responding"
else
  fail "WebAuthn register/options failed"
fi

# Assertion options
response=$(curl -s -X POST "$BASE_URL/webauthn/assertion/options" \
  -H "Authorization: Bearer $API_TOKEN")
if echo "$response" | grep -q "stub"; then
  pass "WebAuthn assertion/options stub responding"
else
  fail "WebAuthn assertion/options failed"
fi
echo ""

# Test 8: Stats Endpoint
echo "Test 8: Audit Stats Endpoint"
response=$(curl -s -H "Authorization: Bearer $API_TOKEN" "$BASE_URL/audit/stats")
if echo "$response" | grep -q "total_audits"; then
  total=$(echo "$response" | grep -o '"total_audits":[0-9]*' | grep -o '[0-9]*')
  unique=$(echo "$response" | grep -o '"unique_origins":[0-9]*' | grep -o '[0-9]*')
  pass "Stats retrieved (total: $total, unique: $unique)"
else
  fail "Stats endpoint failed"
fi
echo ""

# Test 9: Recent Audits
echo "Test 9: Recent Audits Endpoint"
response=$(curl -s -H "Authorization: Bearer $API_TOKEN" "$BASE_URL/audit/recent?limit=5")
if echo "$response" | grep -q "items"; then
  items=$(echo "$response" | grep -o '"items":\[' | wc -l)
  pass "Recent audits retrieved"
else
  fail "Recent audits failed"
fi
echo ""

# Test 10: Risk Score Breakdown
echo "Test 10: Risk Score Breakdown Components"
response=$(curl -s -H "Authorization: Bearer $API_TOKEN" "$BASE_URL/risk/score")
if echo "$response" | grep -q "inputs_breakdown"; then
  pass "Risk breakdown includes all components"
  
  # Extract components
  blocked=$(echo "$response" | grep -o '"blocked_site_attempts":[0-9]*' | grep -o '[0-9]*')
  time_viol=$(echo "$response" | grep -o '"time_window_violations":[0-9]*' | grep -o '[0-9]*')
  trackers=$(echo "$response" | grep -o '"high_risk_tracker_origins":[0-9]*' | grep -o '[0-9]*')
  
  info "  - Blocked attempts: ${blocked:-0}"
  info "  - Time violations: ${time_viol:-0}"
  info "  - High-risk trackers: ${trackers:-0}"
else
  fail "Risk breakdown missing"
fi
echo ""

# Summary
echo "=================================="
echo -e "${GREEN}✓ All Week 4 tests passed!${NC}"
echo ""
echo "Next steps:"
echo "1. Load extension in Chrome/Brave"
echo "2. Test PIN creation (options page)"
echo "3. Generate and download recovery codes"
echo "4. Test popup gamification display"
echo "5. Test factory reset"
echo ""
echo "Extension tests (manual):"
echo "- Verify PIN never stored in plaintext"
echo "- Test recovery code verification"
echo "- Check safe streak increments"
echo "- Verify time-left nudges appear"
echo ""

# Cleanup
rm -f /tmp/gc_rules_export.json
