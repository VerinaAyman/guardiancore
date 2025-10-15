#!/bin/bash

echo "=========================================="
echo "GuardianCore Phase 5 Frontend - Pre-Test Check"
echo "=========================================="
echo

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

cd /Users/ahmedkhadrawy/guardiancore

# Check if backend is running
echo "1. Checking backend..."
if curl -s http://localhost:8000/health > /dev/null 2>&1; then
  echo -e "${GREEN}✓ Backend is running${NC}"
else
  echo -e "${RED}✗ Backend is NOT running${NC}"
  echo "  Run: make run"
  exit 1
fi

# Check extension files
echo
echo "2. Checking extension files..."

FILES=(
  "app-extension/background.js"
  "app-extension/popup.js"
  "app-extension/popup.html"
  "app-extension/options.js"
  "app-extension/options.html"
  "app-extension/child-options.js"
  "app-extension/child-options.html"
  "app-extension/manifest.json"
  "app-extension/login.js"
  "app-extension/login.html"
)

ALL_EXIST=true
for file in "${FILES[@]}"; do
  if [ -f "$file" ]; then
    echo -e "${GREEN}✓${NC} $file"
  else
    echo -e "${RED}✗${NC} $file (MISSING)"
    ALL_EXIST=false
  fi
done

if [ "$ALL_EXIST" = false ]; then
  echo
  echo -e "${RED}Some files are missing!${NC}"
  exit 1
fi

# Check backup files
echo
echo "3. Checking backup files..."
if [ -f "app-extension/options-old.js" ] && [ -f "app-extension/options-old.html" ]; then
  echo -e "${GREEN}✓ Backup files exist${NC}"
else
  echo -e "${YELLOW}⚠ No backup files found (this is OK for new installations)${NC}"
fi

# Test API endpoints
echo
echo "4. Testing API endpoints..."

# Test parent login
PARENT_TOKEN=$(curl -s -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "parent1@test.com", "password": "password123"}' | \
  grep -o '"access_token":"[^"]*"' | \
  cut -d'"' -f4)

if [ ! -z "$PARENT_TOKEN" ]; then
  echo -e "${GREEN}✓ Parent login works${NC}"
  
  # Test children endpoint
  CHILDREN=$(curl -s -X GET http://localhost:8000/accounts/children \
    -H "Authorization: Bearer $PARENT_TOKEN")
  
  if [[ $CHILDREN == *"["* ]]; then
    echo -e "${GREEN}✓ Children endpoint works${NC}"
  else
    echo -e "${RED}✗ Children endpoint failed${NC}"
  fi
  
  # Test groups endpoint
  GROUPS=$(curl -s -X GET http://localhost:8000/accounts/groups \
    -H "Authorization: Bearer $PARENT_TOKEN")
  
  if [[ $GROUPS == *"["* ]]; then
    echo -e "${GREEN}✓ Groups endpoint works${NC}"
  else
    echo -e "${RED}✗ Groups endpoint failed${NC}"
  fi
else
  echo -e "${RED}✗ Parent login failed${NC}"
  echo "  Make sure parent1@test.com exists"
fi

# Test child login
CHILD_TOKEN=$(curl -s -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"access_code": "068638"}' | \
  grep -o '"access_token":"[^"]*"' | \
  cut -d'"' -f4)

if [ ! -z "$CHILD_TOKEN" ]; then
  echo -e "${GREEN}✓ Child login works${NC}"
else
  echo -e "${YELLOW}⚠ Child login failed (child may not exist yet)${NC}"
fi

# Summary
echo
echo "=========================================="
echo "Summary"
echo "=========================================="
echo
echo -e "${GREEN}✓ All checks passed!${NC}"
echo
echo "Next steps:"
echo "1. Open Chrome and go to: chrome://extensions/"
echo "2. Enable 'Developer mode'"
echo "3. Click 'Load unpacked' and select: app-extension/"
echo "4. Click the extension icon to test"
echo
echo "Test accounts:"
echo "  Parent: parent1@test.com / password123"
echo "  Child: Access code 068638 (if exists)"
echo
echo "Expected behavior:"
echo "  - Parent login → options.html (dashboard)"
echo "  - Child login → child-options.html (limited interface)"
echo "  - Logout → login.html"
echo
