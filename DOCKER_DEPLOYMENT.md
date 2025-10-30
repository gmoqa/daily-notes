# Docker Deployment Guide - Daily Notes with Voice Transcription

## Overview

This guide explains how to deploy the Daily Notes application with on-premise voice transcription using Docker and Docker Compose.

## Architecture

The application consists of two Docker containers:
- **dailynotes-app**: Main Go application (port 3000)
- **whisper-server**: On-premise Whisper.cpp transcription service (port 8080, localhost only)

Both containers run in an isolated network and communicate internally.

## Prerequisites

### On the Server:
- Docker Engine 20.10+
- Docker Compose 2.0+
- Minimum 4GB RAM (2GB for Whisper + 2GB for app)
- ~2GB free disk space

### Installation:

```bash
# Install Docker on Ubuntu/Debian
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add your user to docker group
sudo usermod -aG docker $USER
newgrp docker

# Install Docker Compose (if not included)
sudo apt-get install docker-compose-plugin

# Verify installation
docker --version
docker compose version
```

## Quick Start

### 1. Clone Repository

```bash
git clone https://github.com/your-repo/daily-notes.git
cd daily-notes
```

### 2. Create Environment File

```bash
cp .env.example .env
nano .env
```

Add your environment variables:

```bash
# Google OAuth
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

# CORS (adjust to your domain)
CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com

# Application
ENV=production
PORT=3000
LOG_LEVEL=info

# Whisper server URL (handled automatically by Docker Compose)
# WHISPER_SERVER_URL=http://whisper:8080
```

### 3. Build and Start Services

```bash
# Build images (first time or after code changes)
docker compose build

# Start all services
docker compose up -d

# View logs
docker compose logs -f

# Check status
docker compose ps
```

## Service Details

### Whisper Server Container

**Image**: Built from `Dockerfile.whisper`
- **Base**: Debian 12 slim
- **Model**: ggml-base.bin (~141MB)
- **Port**: 8080 (only accessible from localhost and app container)
- **Memory**: 512MB-2GB
- **CPU**: 1-2 cores
- **Health check**: Automated

**Features**:
- Multi-stage build for minimal image size
- Non-root user for security
- Automatic model download during build
- Health monitoring

### App Container

**Image**: Built from `Dockerfile`
- **Base**: Alpine Linux
- **Runtime**: Go binary + FFmpeg
- **Port**: 3000 (publicly accessible)
- **Dependencies**: Whisper server

**Features**:
- Waits for Whisper to be healthy before starting
- FFmpeg for audio conversion
- SQLite database persisted in volume
- Health monitoring

## Commands

### Basic Operations

```bash
# Start services
docker compose up -d

# Stop services
docker compose down

# Restart services
docker compose restart

# View logs (all services)
docker compose logs -f

# View logs (specific service)
docker compose logs -f whisper
docker compose logs -f app

# Check service status
docker compose ps

# Execute command in container
docker compose exec app sh
docker compose exec whisper sh
```

### Maintenance

```bash
# Rebuild after code changes
docker compose build
docker compose up -d

# Rebuild without cache
docker compose build --no-cache

# Remove stopped containers and networks
docker compose down

# Remove containers, networks, and volumes
docker compose down -v

# View resource usage
docker stats

# Inspect container details
docker inspect whisper-server
docker inspect dailynotes-app
```

### Debugging

```bash
# Check Whisper server health
docker compose exec whisper curl http://localhost:8080/health

# Check app can reach Whisper
docker compose exec app wget -O- http://whisper:8080/health

# View Whisper server processes
docker compose exec whisper ps aux

# Check memory usage
docker compose exec whisper free -h

# Test transcription endpoint
curl -X POST http://localhost:3000/api/voice/transcribe \
  -F "audio=@test.wav" \
  -F "language=es"
```

## Production Deployment

### Option 1: Reverse Proxy with Nginx

```nginx
# /etc/nginx/sites-available/dailynotes

upstream dailynotes {
    server 127.0.0.1:3000;
}

server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://dailynotes;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Larger timeouts for voice transcription
        proxy_read_timeout 180s;
        proxy_connect_timeout 180s;
    }
}
```

Enable and reload:
```bash
sudo ln -s /etc/nginx/sites-available/dailynotes /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Option 2: Traefik (Docker-based)

Update `docker-compose.yml`:

```yaml
services:
  app:
    # ... existing config ...
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.dailynotes.rule=Host(`yourdomain.com`)"
      - "traefik.http.routers.dailynotes.entrypoints=websecure"
      - "traefik.http.routers.dailynotes.tls.certresolver=myresolver"
      - "traefik.http.services.dailynotes.loadbalancer.server.port=3000"
```

### Option 3: Direct HTTPS in Docker

Modify `docker-compose.yml` to include SSL certificates:

```yaml
services:
  app:
    ports:
      - "443:3000"
    volumes:
      - ./data:/root/data
      - /etc/letsencrypt:/etc/letsencrypt:ro
    environment:
      # ... existing vars ...
      - SSL_CERT=/etc/letsencrypt/live/yourdomain.com/fullchain.pem
      - SSL_KEY=/etc/letsencrypt/live/yourdomain.com/privkey.pem
```

## Monitoring

### Health Checks

Both services have built-in health checks:

```bash
# Check health status
docker compose ps

# Should show "healthy" for both services
```

### Logs

```bash
# Real-time logs
docker compose logs -f

# Last 100 lines
docker compose logs --tail=100

# Specific service
docker compose logs -f whisper
```

### Resource Monitoring

```bash
# Live stats
docker stats

# One-time stats
docker stats --no-stream
```

## Backup and Recovery

### Backup Data

```bash
# Backup SQLite database and user data
tar -czf backup-$(date +%Y%m%d).tar.gz data/

# Copy to remote server
scp backup-*.tar.gz user@backup-server:/backups/
```

### Restore Data

```bash
# Stop services
docker compose down

# Restore data
tar -xzf backup-20241030.tar.gz

# Restart services
docker compose up -d
```

## Scaling and Performance

### Resource Limits

Adjust in `docker-compose.yml`:

```yaml
services:
  whisper:
    deploy:
      resources:
        limits:
          memory: 4G      # Increase for larger models
          cpus: '4.0'     # More CPUs = faster transcription
        reservations:
          memory: 1G
          cpus: '2.0'
```

### Use Different Whisper Model

Edit `Dockerfile.whisper`:

```dockerfile
# For faster, less accurate: tiny model
RUN wget -q https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin \
    -O models/ggml-tiny.bin

# For better accuracy: small model
RUN wget -q https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin \
    -O models/ggml-small.bin
```

Update CMD in `Dockerfile.whisper`:
```dockerfile
CMD ["/usr/local/bin/whisper-server", \
     "-m", "/models/ggml-small.bin", \  # Change model here
     "--host", "0.0.0.0", \
     "--port", "8080", \
     "-t", "4"]
```

## Troubleshooting

### Issue: "Whisper server not available"

**Solution**:
```bash
# Check if Whisper is running
docker compose ps whisper

# Check Whisper logs
docker compose logs whisper

# Restart Whisper
docker compose restart whisper

# Verify health
docker compose exec whisper curl http://localhost:8080/health
```

### Issue: High memory usage

**Solution**:
```bash
# Check current usage
docker stats

# Use smaller model (edit Dockerfile.whisper to use tiny or base)
# Reduce memory limits in docker-compose.yml
```

### Issue: Slow transcription

**Solution**:
```bash
# Increase CPU allocation in docker-compose.yml
# Use a smaller model (tiny/base instead of small/medium)
# Increase thread count in Dockerfile.whisper: -t 8
```

### Issue: Build fails

**Solution**:
```bash
# Clear Docker cache
docker compose build --no-cache

# Check disk space
df -h

# Pull base images manually
docker pull debian:12-slim
docker pull golang:1.24-alpine
docker pull alpine:latest
```

### Issue: Container won't start

**Solution**:
```bash
# Check logs
docker compose logs

# Inspect container
docker inspect whisper-server

# Remove and recreate
docker compose down
docker compose up -d
```

## Security Considerations

1. **Whisper Port**: Bound to 127.0.0.1 only, not exposed externally
2. **Docker Network**: Services isolated in private network
3. **Non-root User**: Whisper runs as unprivileged user
4. **SSL/TLS**: Use reverse proxy for HTTPS
5. **Environment Variables**: Store secrets in `.env`, not in code
6. **Updates**: Regularly update Docker images

## CI/CD Integration

### GitHub Actions Example

```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Deploy to VPS
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd /path/to/daily-notes
            git pull
            docker compose build
            docker compose up -d
            docker compose ps
```

## Updates

### Update Application Code

```bash
git pull
docker compose build app
docker compose up -d app
```

### Update Whisper

```bash
docker compose build whisper
docker compose up -d whisper
```

### Update All

```bash
git pull
docker compose build
docker compose up -d
```

## Uninstallation

```bash
# Stop and remove containers
docker compose down

# Remove volumes (warning: deletes data)
docker compose down -v

# Remove images
docker rmi dailynotes-app whisper-server

# Remove all unused Docker resources
docker system prune -a
```

## Support

For issues or questions:
1. Check logs: `docker compose logs`
2. Verify health: `docker compose ps`
3. Review documentation
4. Check GitHub issues

## Additional Resources

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Reference](https://docs.docker.com/compose/compose-file/)
- [Whisper.cpp GitHub](https://github.com/ggerganov/whisper.cpp)
