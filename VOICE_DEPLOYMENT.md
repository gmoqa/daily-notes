# Voice Transcription Feature - Production Deployment Guide

## Overview
This guide explains how to deploy the on-premise Whisper voice transcription feature to your VPS/production server.

## Prerequisites

### On the VPS Server:
1. **CMake** (for building Whisper)
2. **GCC/G++** compiler
3. **FFmpeg** (for audio conversion)
4. **Git**
5. **Minimum 2GB RAM** (4GB recommended)
6. **~500MB disk space** (for Whisper binary and model)

## Installation Steps

### 1. Install Dependencies

```bash
# On Ubuntu/Debian VPS
sudo apt update
sudo apt install -y git cmake build-essential ffmpeg

# On CentOS/RHEL
sudo yum install -y git cmake gcc gcc-c++ ffmpeg
```

### 2. Clone and Build Whisper.cpp

SSH into your VPS and navigate to your project directory:

```bash
cd /path/to/daily-notes

# Clone Whisper.cpp (if not already in repo)
git clone https://github.com/ggerganov/whisper.cpp.git lib/whisper

# Build Whisper
cd lib/whisper
mkdir -p build
cd build
cmake ..
make -j$(nproc)
```

This will create the `whisper-server` binary in `lib/whisper/build/bin/whisper-server`

### 3. Download Whisper Model

```bash
cd /path/to/daily-notes/lib/whisper

# Download the base model (~141MB)
bash ./models/download-ggml-model.sh base

# Or manually:
mkdir -p models
wget https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin -O models/ggml-base.bin
```

**Available models:**
- `tiny` (~75MB) - Fastest, least accurate
- `base` (~141MB) - **Recommended** - Good balance
- `small` (~466MB) - Better accuracy, slower
- `medium` (~1.5GB) - High accuracy, requires more RAM
- `large` (~3GB) - Best accuracy, requires 8GB+ RAM

### 4. Test Whisper Server

```bash
cd /path/to/daily-notes

# Test that the server starts
./scripts/start-whisper-server.sh

# Check if it's running
curl http://127.0.0.1:8080/health

# Should return: {"status":"ok"}
```

### 5. Configure Systemd Service (Production)

Create a systemd service to run Whisper server automatically:

```bash
sudo nano /etc/systemd/system/whisper-transcription.service
```

Add this content (adjust paths):

```ini
[Unit]
Description=Whisper Speech-to-Text Server
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/path/to/daily-notes
ExecStart=/path/to/daily-notes/lib/whisper/build/bin/whisper-server \
    -m /path/to/daily-notes/lib/whisper/models/ggml-base.bin \
    --host 127.0.0.1 \
    --port 8080 \
    -t 4
Restart=on-failure
RestartSec=10s

# Security
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/path/to/daily-notes/data/tmp

# Resource limits
LimitNOFILE=4096
MemoryMax=2G
CPUQuota=200%

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable whisper-transcription
sudo systemctl start whisper-transcription

# Check status
sudo systemctl status whisper-transcription

# View logs
sudo journalctl -u whisper-transcription -f
```

### 6. Update Environment Variables

Ensure your `.env` on the VPS has:

```bash
# Voice Transcription - uses local whisper server
# No API keys needed for on-premise setup
```

### 7. Firewall Configuration

The Whisper server runs on `localhost:8080` only, so **NO firewall changes needed**.
It's only accessible from the same machine where your Go app runs.

### 8. Deploy Your Application

Use your existing deployment script:

```bash
make prod-deploy-vps
```

Or manually:
```bash
# Build on your local machine
make prod-build

# Copy to VPS
scp bin/dailynotes your-vps:/path/to/daily-notes/

# Restart your app service
ssh your-vps "sudo systemctl restart dailynotes"
```

## Verification

### Test the voice feature:

1. Navigate to your app in the browser
2. Click the calendar clock **5 times rapidly** (within 2 seconds)
3. You should be redirected to `/voice`
4. Try recording and transcribing audio

### Check logs:

```bash
# Whisper server logs
sudo journalctl -u whisper-transcription -f

# Your app logs
sudo journalctl -u dailynotes -f

# Whisper server output (if using script)
tail -f /path/to/daily-notes/data/tmp/whisper-server.log
```

## Troubleshooting

### Error: "Whisper server not available"

**Check if server is running:**
```bash
curl http://127.0.0.1:8080/health

# If not running:
sudo systemctl start whisper-transcription
```

**Check server logs:**
```bash
sudo journalctl -u whisper-transcription --no-pager -n 50
```

**Common issues:**
- Model file not found: Check path in service file
- Port already in use: Check with `lsof -i:8080`
- Insufficient memory: Use `tiny` or `base` model instead of larger ones

### Error: "Failed to open channel" (Audio playback)

This is a browser issue, not server. User needs to refresh with Ctrl+Shift+R.

### Error: FFmpeg not found

```bash
# Install FFmpeg
sudo apt install ffmpeg

# Verify
ffmpeg -version
```

## Resource Usage

### Expected resource usage:
- **Memory**: 500MB - 1.5GB (depending on model)
- **CPU**: 100-200% during transcription (uses 4 threads)
- **Disk**: ~500MB (binary + base model)

### Performance:
- Base model: ~2-5 seconds for 10 seconds of audio
- Tiny model: ~1-2 seconds for 10 seconds of audio
- Small model: ~5-10 seconds for 10 seconds of audio

## Security Notes

1. ✅ Whisper server only binds to `127.0.0.1` (localhost)
2. ✅ Not exposed to the internet
3. ✅ No external API calls
4. ✅ All processing is on-premise
5. ✅ Audio files are temporary and cleaned up

## Updating Whisper

To update to a newer version:

```bash
cd /path/to/daily-notes/lib/whisper
git pull
cd build
cmake ..
make -j$(nproc)

# Restart service
sudo systemctl restart whisper-transcription
```

## Uninstalling

To remove the voice feature:

```bash
# Stop service
sudo systemctl stop whisper-transcription
sudo systemctl disable whisper-transcription
sudo rm /etc/systemd/system/whisper-transcription.service
sudo systemctl daemon-reload

# Remove files
rm -rf /path/to/daily-notes/lib/whisper
```

## Alternative: Using PM2 (instead of systemd)

If you prefer PM2:

```bash
# Create PM2 config
cat > whisper-pm2.config.js <<EOF
module.exports = {
  apps: [{
    name: 'whisper-server',
    script: '/path/to/daily-notes/lib/whisper/build/bin/whisper-server',
    args: '-m /path/to/daily-notes/lib/whisper/models/ggml-base.bin --host 127.0.0.1 --port 8080 -t 4',
    cwd: '/path/to/daily-notes',
    max_memory_restart: '2G',
    autorestart: true,
    watch: false
  }]
};
EOF

# Start with PM2
pm2 start whisper-pm2.config.js
pm2 save
pm2 startup
```

## Support

If you encounter issues:
1. Check the logs first
2. Verify all dependencies are installed
3. Ensure sufficient RAM is available
4. Try with a smaller model (tiny or base)

For Whisper.cpp issues, see: https://github.com/ggerganov/whisper.cpp
