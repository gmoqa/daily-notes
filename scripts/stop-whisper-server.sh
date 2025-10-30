#!/bin/bash

# Script para detener el servidor de whisper.cpp

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PID_FILE="$PROJECT_ROOT/data/tmp/whisper-server.pid"

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=========================================="
echo "Whisper Server Stop Script"
echo -e "==========================================${NC}"
echo ""

# Verificar si el PID file existe
if [ ! -f "$PID_FILE" ]; then
    echo -e "${YELLOW}⚠ No PID file found. Server may not be running.${NC}"

    # Intentar encontrar el proceso por nombre
    PIDS=$(pgrep -f "whisper-server")
    if [ -n "$PIDS" ]; then
        echo -e "${YELLOW}⚠ Found whisper-server processes: $PIDS${NC}"
        echo -n "Kill these processes? [y/N] "
        read -r REPLY
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            kill $PIDS
            echo -e "${GREEN}✓ Processes killed${NC}"
        fi
    else
        echo -e "${GREEN}✓ No whisper-server processes found${NC}"
    fi
    exit 0
fi

# Leer PID
PID=$(cat "$PID_FILE")

# Verificar si el proceso existe
if ! ps -p "$PID" > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠ Process (PID: $PID) not running${NC}"
    rm -f "$PID_FILE"
    echo -e "${GREEN}✓ Cleaned up stale PID file${NC}"
    exit 0
fi

echo "Stopping whisper server (PID: $PID)..."

# Intentar detener gracefully
kill "$PID"

# Esperar a que termine
echo -n "Waiting for process to stop"
MAX_WAIT=10
WAIT_COUNT=0

while [ $WAIT_COUNT -lt $MAX_WAIT ]; do
    if ! ps -p "$PID" > /dev/null 2>&1; then
        echo ""
        echo -e "${GREEN}✓ Server stopped successfully${NC}"
        rm -f "$PID_FILE"
        exit 0
    fi

    echo -n "."
    sleep 1
    WAIT_COUNT=$((WAIT_COUNT + 1))
done

echo ""
echo -e "${YELLOW}⚠ Process did not stop gracefully, forcing kill...${NC}"

# Force kill
kill -9 "$PID" 2>/dev/null

if ! ps -p "$PID" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Server forcefully stopped${NC}"
    rm -f "$PID_FILE"
    exit 0
else
    echo -e "${RED}✗ Failed to stop server${NC}"
    exit 1
fi
