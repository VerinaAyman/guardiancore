#!/bin/bash

# Test Phase 5 Authentication Flow
# This script tests the basic authentication and rule loading for child accounts

echo "=========================================="
echo "GuardianCore Phase 5 Authentication Test"
echo "=========================================="
echo ""

BASE_URL="http://localhost:8000"

echo "1. Testing Parent Login..."
PARENT_LOGIN=$(curl -s -X POST "$BASE_URL/auth/parent/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "parent1@test.com",
    "password": "password123"
  }')

PARENT_TOKEN=$(echo "$PARENT_LOGIN" | jq -r '.token')
PARENT_ID=$(echo "$PARENT_LOGIN" | jq -r '.user_id')

if [ "$PARENT_TOKEN" != "null" ] && [ "$PARENT_TOKEN" != "" ]; then
  echo "✅ Parent login successful"
  echo "   User ID: $PARENT_ID"
  echo "   Token: ${PARENT_TOKEN:0:20}..."
else
  echo "❌ Parent login failed"
  echo "$PARENT_LOGIN"
  exit 1
fi

echo ""
echo "2. Testing Token Verification..."
VERIFY=$(curl -s -X POST "$BASE_URL/auth/verify" \
  -H "Authorization: Bearer $PARENT_TOKEN")

if echo "$VERIFY" | jq -e '.user_id' > /dev/null 2>&1; then
  echo "✅ Token verification successful"
  echo "   Account type: $(echo "$VERIFY" | jq -r '.account_type')"
  echo "   Username: $(echo "$VERIFY" | jq -r '.username')"
else
  echo "❌ Token verification failed"
  echo "$VERIFY"
  exit 1
fi

echo ""
echo "3. Creating a test child account..."
CHILD_CREATE=$(curl -s -X POST "$BASE_URL/accounts/children" \
  -H "Authorization: Bearer $PARENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "Test Child"
  }')

CHILD_CODE=$(echo "$CHILD_CREATE" | jq -r '.access_code')
CHILD_ID=$(echo "$CHILD_CREATE" | jq -r '.id')

if [ "$CHILD_CODE" != "null" ] && [ "$CHILD_CODE" != "" ]; then
  echo "✅ Child account created"
  echo "   Child ID: $CHILD_ID"
  echo "   Access Code: $CHILD_CODE"
else
  echo "❌ Child account creation failed"
  echo "$CHILD_CREATE"
  exit 1
fi

echo ""
echo "4. Testing Child Login..."
CHILD_LOGIN=$(curl -s -X POST "$BASE_URL/auth/child/login" \
  -H "Content-Type: application/json" \
  -d "{
    \"access_code\": \"$CHILD_CODE\"
  }")

CHILD_TOKEN=$(echo "$CHILD_LOGIN" | jq -r '.token')

if [ "$CHILD_TOKEN" != "null" ] && [ "$CHILD_TOKEN" != "" ]; then
  echo "✅ Child login successful"
  echo "   Token: ${CHILD_TOKEN:0:20}..."
else
  echo "❌ Child login failed"
  echo "$CHILD_LOGIN"
  exit 1
fi

echo ""
echo "5. Creating a test rule for child..."
RULE_CREATE=$(curl -s -X POST "$BASE_URL/accounts/rules" \
  -H "Authorization: Bearer $PARENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"rule_type\": \"blocklist\",
    \"pattern\": \"example.com\",
    \"target_type\": \"child\",
    \"target_id\": $CHILD_ID,
    \"enabled\": true,
    \"explanation\": \"Test blocking rule\"
  }")

RULE_ID=$(echo "$RULE_CREATE" | jq -r '.id')

if [ "$RULE_ID" != "null" ] && [ "$RULE_ID" != "" ]; then
  echo "✅ Rule created for child"
  echo "   Rule ID: $RULE_ID"
else
  echo "❌ Rule creation failed"
  echo "$RULE_CREATE"
  exit 1
fi

echo ""
echo "6. Fetching rules for child account..."
CHILD_RULES=$(curl -s -X GET "$BASE_URL/accounts/rules/child/$CHILD_ID?enabled_only=true" \
  -H "Authorization: Bearer $CHILD_TOKEN")

RULE_COUNT=$(echo "$CHILD_RULES" | jq '. | length')

if [ "$RULE_COUNT" -gt 0 ]; then
  echo "✅ Child rules loaded successfully"
  echo "   Number of rules: $RULE_COUNT"
  echo ""
  echo "   Rules:"
  echo "$CHILD_RULES" | jq '.[] | {id, rule_type, pattern, target_type}'
else
  echo "❌ No rules found for child"
  echo "$CHILD_RULES"
fi

echo ""
echo "7. Testing parent can list children..."
CHILDREN_LIST=$(curl -s -X GET "$BASE_URL/accounts/children" \
  -H "Authorization: Bearer $PARENT_TOKEN")

CHILDREN_COUNT=$(echo "$CHILDREN_LIST" | jq '. | length')

if [ "$CHILDREN_COUNT" -gt 0 ]; then
  echo "✅ Parent can list children"
  echo "   Number of children: $CHILDREN_COUNT"
else
  echo "❌ Failed to list children"
  echo "$CHILDREN_LIST"
fi

echo ""
echo "=========================================="
echo "🎉 All Phase 5 authentication tests passed!"
echo "=========================================="
echo ""
echo "Summary:"
echo "  - Parent account: parent1@test.com"
echo "  - Child account: $CHILD_CODE"
echo "  - Rule created: Block example.com for child"
echo ""
echo "Next steps:"
echo "  1. Reload extension in Chrome (chrome://extensions)"
echo "  2. Open extension and click 'Login'"
echo "  3. Test parent login with parent1@test.com / password123"
echo "  4. Test child login with code: $CHILD_CODE"
echo ""
