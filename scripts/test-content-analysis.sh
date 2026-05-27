#!/bin/bash

echo "🧪 Content Analysis Endpoint Test"
echo "=================================="

BASE_URL="http://localhost:8000"

# Test helper function
test_endpoint() {
  local name=$1
  local text=$2
  
  echo ""
  echo "📝 Testing: $name"
  echo "Text: $text"
  echo ""
  
  curl -s -X POST "${BASE_URL}/analyze/content" \
    -H "Authorization: Bearer dev-token-123" \
    -H "Content-Type: application/json" \
    -d "{
      \"url\": \"https://example.com/chat\",
      \"text_content\": \"$text\",
      \"child_age\": 13,
      \"sensitivity\": \"high\",
      \"check_slang\": true,
      \"check_intent\": true
    }" | jq .
}

# Check if services are running
echo "🔍 Checking if services are running..."
if ! curl -s "${BASE_URL}/health" > /dev/null 2>&1; then
  echo "❌ Services not running. Starting docker compose..."
  docker compose up -d
  echo "⏳ Waiting for services to start..."
  sleep 15
fi

echo "✅ Services are running"

# Test 1: Grooming language
test_endpoint "Grooming Language" "Hey can you send me pics and keep it a secret between us? Don't tell your parents"

# Test 2: Manipulative language
test_endpoint "Manipulative Language" "If you really trust me you'll tell me your location and phone number"

# Test 3: Slang/drugs
test_endpoint "Harmful Slang" "Let's meet up and do some lines, I got some good stuff"

# Test 4: Isolation language
test_endpoint "Isolation Language" "Your parents don't understand you like I do. Let's keep this between us."

# Test 5: Safe content
test_endpoint "Safe Content" "Here's how to do your math homework. Step 1: solve for x by isolating the variable."

echo ""
echo "✅ Tests complete!"
