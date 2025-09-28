#!/bin/bash

echo "🔍 GuardianCore Week 1 Verification Script"
echo "=========================================="

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker Desktop first."
    echo "   On macOS: Open Docker Desktop application"
    exit 1
fi

echo "✅ Docker is running"

# Start services
echo "🚀 Starting services..."
docker compose up --build -d

# Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 10

# Test backend endpoints
echo "🧪 Testing backend endpoints..."

echo "Testing root endpoint..."
curl -s http://localhost:8000/ | jq . || echo "❌ Root endpoint failed"

echo "Testing health endpoint..."
curl -s http://localhost:8000/health | jq . || echo "❌ Health endpoint failed"

echo "Testing database health..."
curl -s http://localhost:8000/health/db | jq . || echo "❌ Database health failed"

echo "Testing version endpoint..."
curl -s http://localhost:8000/health/version | jq . || echo "❌ Version endpoint failed"

echo ""
echo "🎉 Verification complete!"
echo ""
echo "Next steps:"
echo "1. Open Chrome and go to chrome://extensions"
echo "2. Enable Developer mode"
echo "3. Click 'Load unpacked' and select the 'app-extension' folder"
echo "4. Pin the extension and click 'Ping Backend' to test"
echo ""
echo "To stop services: docker compose down"
