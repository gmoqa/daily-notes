# Docker Quick Start - Daily Notes with Voice Transcription

## 🚀 Fast Deployment

### Prerequisites
- Docker & Docker Compose installed
- 4GB+ RAM
- 2GB+ free disk space

### Deploy in 3 Steps

1. **Configure environment**
```bash
cp .env.example .env
nano .env  # Add your GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
```

2. **Deploy**
```bash
./scripts/deploy-docker.sh
```

3. **Access**
- Application: http://localhost:3000
- Easter egg: Click clock 5 times → `/voice`

## 📦 What's Included

- **dailynotes-app**: Main application (Port 3000)
- **whisper-server**: On-premise voice transcription (Port 8080, localhost only)

## 🛠️ Common Commands

```bash
# View logs
docker compose logs -f

# Restart
docker compose restart

# Stop
docker compose down

# Rebuild
docker compose build
docker compose up -d

# Status
docker compose ps
```

## 🔧 Troubleshooting

**Whisper not available?**
```bash
docker compose restart whisper
docker compose logs whisper
```

**Out of memory?**
```bash
# Edit docker-compose.yml, reduce whisper memory limit
# Or use tiny model in Dockerfile.whisper
```

## 📚 Full Documentation

See [DOCKER_DEPLOYMENT.md](DOCKER_DEPLOYMENT.md) for complete guide.

## 🔐 Production

For production with HTTPS:
1. Use reverse proxy (Nginx/Traefik)
2. Set up SSL certificates
3. Configure firewall
4. See production section in [DOCKER_DEPLOYMENT.md](DOCKER_DEPLOYMENT.md)
