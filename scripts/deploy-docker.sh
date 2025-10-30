#!/bin/bash

# Docker Deployment Script for Daily Notes with Voice Transcription
# This script automates the deployment process

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_requirements() {
    log_info "Checking requirements..."

    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed"
        exit 1
    fi

    if ! command -v docker compose &> /dev/null; then
        log_error "Docker Compose is not installed"
        exit 1
    fi

    log_info "✓ Docker version: $(docker --version)"
    log_info "✓ Docker Compose version: $(docker compose version)"
}

check_env_file() {
    log_info "Checking environment file..."

    if [ ! -f .env ]; then
        log_warn ".env file not found"
        if [ -f .env.example ]; then
            log_info "Creating .env from .env.example"
            cp .env.example .env
            log_warn "Please edit .env file with your configuration before deploying"
            exit 1
        else
            log_error "No .env or .env.example file found"
            exit 1
        fi
    fi

    # Check required variables
    if ! grep -q "GOOGLE_CLIENT_ID" .env; then
        log_warn "GOOGLE_CLIENT_ID not found in .env"
    fi

    log_info "✓ Environment file exists"
}

build_images() {
    log_info "Building Docker images..."

    if [ "$1" == "--no-cache" ]; then
        log_info "Building with --no-cache flag"
        docker compose build --no-cache
    else
        docker compose build
    fi

    log_info "✓ Images built successfully"
}

start_services() {
    log_info "Starting services..."

    docker compose up -d

    log_info "Waiting for services to be healthy..."
    sleep 5

    # Check if services are running
    if docker compose ps | grep -q "whisper.*healthy"; then
        log_info "✓ Whisper server is healthy"
    else
        log_warn "Whisper server is not healthy yet, waiting..."
        sleep 10
    fi

    if docker compose ps | grep -q "app.*running"; then
        log_info "✓ App is running"
    else
        log_error "App failed to start"
        docker compose logs app
        exit 1
    fi
}

show_status() {
    log_info "Service status:"
    docker compose ps

    echo ""
    log_info "Testing Whisper server health..."
    if docker compose exec whisper curl -s http://localhost:8080/health | grep -q "ok"; then
        log_info "✓ Whisper server is responding"
    else
        log_warn "Whisper server is not responding"
    fi

    echo ""
    log_info "Application is running at:"
    echo "  http://localhost:3000"
    echo ""
    log_info "To access voice transcription:"
    echo "  1. Login to the application"
    echo "  2. Click the clock 5 times rapidly"
    echo "  3. You'll be redirected to /voice"
}

show_logs() {
    log_info "Showing logs (Ctrl+C to exit)..."
    docker compose logs -f
}

# Main script
main() {
    echo "═══════════════════════════════════════════════════════"
    echo "  Daily Notes - Docker Deployment"
    echo "═══════════════════════════════════════════════════════"
    echo ""

    # Parse arguments
    NO_CACHE=false
    SHOW_LOGS=false

    while [[ $# -gt 0 ]]; do
        case $1 in
            --no-cache)
                NO_CACHE=true
                shift
                ;;
            --logs)
                SHOW_LOGS=true
                shift
                ;;
            --help)
                echo "Usage: $0 [OPTIONS]"
                echo ""
                echo "Options:"
                echo "  --no-cache    Build images without cache"
                echo "  --logs        Show logs after deployment"
                echo "  --help        Show this help message"
                echo ""
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                exit 1
                ;;
        esac
    done

    # Run deployment steps
    check_requirements
    check_env_file

    if [ "$NO_CACHE" = true ]; then
        build_images "--no-cache"
    else
        build_images
    fi

    start_services
    show_status

    if [ "$SHOW_LOGS" = true ]; then
        show_logs
    fi

    echo ""
    log_info "Deployment completed successfully!"
    echo ""
    log_info "Useful commands:"
    echo "  docker compose logs -f        # View logs"
    echo "  docker compose ps             # Check status"
    echo "  docker compose restart        # Restart services"
    echo "  docker compose down           # Stop services"
    echo ""
}

# Run main function
main "$@"
