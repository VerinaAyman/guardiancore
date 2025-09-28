.PHONY: up down logs clean install test

# Start all services
up:
	docker compose up --build

# Stop all services
down:
	docker compose down -v

# View logs
logs:
	docker compose logs -f

# Clean up everything
clean:
	docker compose down -v
	docker system prune -f

# Install Python dependencies locally (for development)
install:
	cd backend && pip install -r requirements.txt

# Test the API endpoints
test:
	@echo "Testing backend endpoints..."
	@curl -s http://localhost:8000/ | jq .
	@curl -s http://localhost:8000/health | jq .
	@curl -s http://localhost:8000/health/db | jq .
	@curl -s http://localhost:8000/health/version | jq .

# Quick development setup
dev-setup:
	@echo "Setting up development environment..."
	@echo "1. Start services: make up"
	@echo "2. Load extension in Chrome: chrome://extensions"
	@echo "3. Test endpoints: make test"
	@echo "4. Check extension popup and click 'Ping Backend'"
