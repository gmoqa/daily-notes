.PHONY: help build build-frontend build-backend run dev test test-go test-frontend test-all clean docker-build docker-run docker-stop deploy

# Set Go toolchain to auto for compatibility
export GOTOOLCHAIN=auto

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-15s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

build-frontend: ## Build the frontend TypeScript bundle
	@echo "Building frontend with Vite..."
	@npm run build
	@echo "Frontend build complete!"

build-backend: ## Build the Go backend binary
	@echo "Generating Templ templates..."
	@templ generate
	@echo "Building application..."
	@go build -o bin/dailynotes main.go
	@echo "Backend build complete! Binary: ./bin/dailynotes"

build: build-frontend build-backend ## Build the complete application (frontend + backend)

run: ## Run the application
	@echo "Generating templates..."
	@~/go/bin/templ generate || templ generate
	@echo "Running application..."
	@go run main.go

dev: ## Run the application in development mode with hot reload
	@echo "Starting development server with Templ watch..."
	@echo "Run 'templ generate --watch' in a separate terminal for hot template reload"
	@air || go run main.go

templ-watch: ## Watch and regenerate Templ templates on change
	@echo "Watching Templ templates..."
	@templ generate --watch

test: ## Run Go tests
	@echo "Running Go tests..."
	@go test -v ./...

test-go: ## Run Go tests with coverage
	@echo "Running Go tests with coverage..."
	@go test -v -coverprofile=coverage.out ./...
	@go tool cover -func=coverage.out | grep total

test-frontend: ## Run frontend tests
	@echo "Running frontend tests..."
	@npm test

test-all: ## Run all tests (Go + Frontend)
	@echo "Running all tests (Go + Frontend)..."
	@echo "\n=== Go Tests ==="
	@go test -v -coverprofile=coverage.out ./...
	@echo "\n=== Frontend Tests ==="
	@npm test
	@echo "\n=== Go Coverage Summary ==="
	@go tool cover -func=coverage.out | grep total

clean: ## Clean build artifacts
	@echo "Cleaning..."
	@rm -rf bin/
	@rm -rf static/dist/
	@rm -f dailynotes
	@echo "Clean complete!"

lint-frontend: ## Lint and format frontend code
	@echo "Linting TypeScript..."
	@npm run lint:fix
	@npm run format
	@echo "Frontend linting complete!"

docker-build: ## Build Docker image
	@echo "Building Docker image..."
	@docker build -t dailynotes:latest .
	@echo "Docker image built successfully!"

docker-run: ## Run Docker container
	@echo "Running Docker container..."
	@docker-compose up -d
	@echo "Container started! Visit http://localhost:3000"

docker-stop: ## Stop Docker container
	@echo "Stopping Docker container..."
	@docker-compose down
	@echo "Container stopped!"

docker-logs: ## Show Docker container logs
	@docker-compose logs -f

# Production deployment targets
prod-build: ## Build production binary
	@echo "Generating Templ templates..."
	@templ generate
	@echo "Building production binary..."
	@CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -a -installsuffix cgo -ldflags="-w -s" -o bin/dailynotes-linux main.go
	@echo "Production build complete!"

prod-deploy-vps: prod-build ## Deploy to VPS (requires configured SSH)
	@echo "Deploying to production VPS..."
	@echo "⚠️  Make sure you've configured your VPS details in the deploy script"
	@./scripts/deploy-vps.sh

# Utility targets
fmt: ## Format Go code
	@echo "Formatting code..."
	@go fmt ./...

lint: ## Lint Go code
	@echo "Linting code..."
	@golangci-lint run || echo "Install golangci-lint: https://golangci-lint.run/usage/install/"

deps: ## Download dependencies
	@echo "Downloading dependencies..."
	@go mod download
	@go mod tidy
	@echo "Dependencies updated!"

# Database/Storage maintenance
backup-note: ## Backup all notes (manual trigger for testing)
	@echo "Note: This app stores data in Google Drive - backups are handled by Google"

security-check: ## Run security checks
	@echo "Running security checks..."
	@govulncheck ./... || echo "Install govulncheck: go install golang.org/x/vuln/cmd/govulncheck@latest"
