#!/bin/bash

# DailyNotes VPS Deployment Script
# Usage: ./scripts/deploy-vps.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration (edit these values)
VPS_HOST="your-server.com"
VPS_USER="dailynotes"
VPS_PATH="/home/dailynotes/daily-notes"
BINARY_NAME="dailynotes"
SERVICE_NAME="dailynotes"

echo -e "${GREEN}🚀 Starting deployment to production VPS${NC}"
echo "================================================"

# Check if configuration is set
if [ "$VPS_HOST" = "your-server.com" ]; then
    echo -e "${RED}❌ Error: Please configure VPS_HOST in the script${NC}"
    echo "Edit scripts/deploy-vps.sh and set your server details"
    exit 1
fi

# Step 1: Build production binary
echo -e "\n${YELLOW}📦 Building production binary...${NC}"
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -a -installsuffix cgo -ldflags="-w -s" -o bin/$BINARY_NAME main.go

if [ ! -f "bin/$BINARY_NAME" ]; then
    echo -e "${RED}❌ Build failed${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Build successful${NC}"

# Step 2: Create backup on VPS
echo -e "\n${YELLOW}💾 Creating backup on VPS...${NC}"
ssh $VPS_USER@$VPS_HOST "cd $VPS_PATH && cp $BINARY_NAME ${BINARY_NAME}.backup 2>/dev/null || true"

# Step 3: Upload binary
echo -e "\n${YELLOW}📤 Uploading binary to VPS...${NC}"
scp bin/$BINARY_NAME $VPS_USER@$VPS_HOST:$VPS_PATH/$BINARY_NAME

# Step 4: Upload static files
echo -e "\n${YELLOW}📤 Uploading static files...${NC}"
rsync -avz --delete ./static/ $VPS_USER@$VPS_HOST:$VPS_PATH/static/

# Step 5: Upload views
echo -e "\n${YELLOW}📤 Uploading views...${NC}"
rsync -avz --delete ./views/ $VPS_USER@$VPS_HOST:$VPS_PATH/views/

# Step 6: Set permissions
echo -e "\n${YELLOW}🔐 Setting permissions...${NC}"
ssh $VPS_USER@$VPS_HOST "chmod +x $VPS_PATH/$BINARY_NAME"

# Step 7: Restart service
echo -e "\n${YELLOW}🔄 Restarting service...${NC}"
ssh $VPS_USER@$VPS_HOST "sudo systemctl restart $SERVICE_NAME"

# Step 8: Wait and check status
echo -e "\n${YELLOW}⏳ Waiting for service to start...${NC}"
sleep 3

# Step 9: Check if service is running
if ssh $VPS_USER@$VPS_HOST "sudo systemctl is-active --quiet $SERVICE_NAME"; then
    echo -e "\n${GREEN}✅ Deployment successful!${NC}"
    echo -e "${GREEN}Service is running${NC}"

    # Show recent logs
    echo -e "\n${YELLOW}📋 Recent logs:${NC}"
    ssh $VPS_USER@$VPS_HOST "sudo journalctl -u $SERVICE_NAME -n 10 --no-pager"

    echo -e "\n${GREEN}================================================${NC}"
    echo -e "${GREEN}🎉 Deployment completed successfully!${NC}"
    echo -e "${GREEN}Visit: https://$VPS_HOST${NC}"
else
    echo -e "\n${RED}❌ Service failed to start${NC}"
    echo -e "${YELLOW}Rolling back to previous version...${NC}"

    # Rollback
    ssh $VPS_USER@$VPS_HOST "cd $VPS_PATH && mv ${BINARY_NAME}.backup $BINARY_NAME 2>/dev/null || true"
    ssh $VPS_USER@$VPS_HOST "sudo systemctl restart $SERVICE_NAME"

    echo -e "${RED}Showing error logs:${NC}"
    ssh $VPS_USER@$VPS_HOST "sudo journalctl -u $SERVICE_NAME -n 20 --no-pager"

    exit 1
fi
