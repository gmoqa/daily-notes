#!/bin/bash

# Deployment script for session store fix

set -e  # Exit on error

echo "🚀 Starting deployment..."

# 1. Backup database
if [ -f "./data/daily-notes.db" ]; then
    echo "📦 Backing up database..."
    cp ./data/daily-notes.db ./data/daily-notes.db.backup.$(date +%Y%m%d_%H%M%S)
    echo "✅ Database backed up"
fi

# 2. Stop running containers
echo "🛑 Stopping existing containers..."
docker compose down

# 3. Rebuild images (no cache to ensure fresh build)
echo "🔨 Rebuilding Docker images..."
docker compose build --no-cache

# 4. Start containers
echo "▶️  Starting containers..."
docker compose up -d

# 5. Wait for health check
echo "⏳ Waiting for application to be healthy..."
sleep 5

# 6. Check logs
echo "📋 Recent logs:"
docker compose logs --tail=20

echo ""
echo "✅ Deployment complete!"
echo ""
echo "⚠️  IMPORTANT: Ask all users to:"
echo "   1. Clear browser cookies"
echo "   2. Refresh the page"
echo "   3. Log in again"
echo ""
echo "📊 To monitor logs: docker compose logs -f"
echo "🔍 To check sessions: docker compose exec app sqlite3 /root/data/daily-notes.db 'SELECT COUNT(*) FROM sessions;'"
