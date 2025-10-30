#!/bin/bash

# Script para iniciar el servidor de whisper.cpp

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
WHISPER_DIR="$PROJECT_ROOT/lib/whisper"
SERVER_BIN="$WHISPER_DIR/build/bin/whisper-server"
MODEL_PATH="$WHISPER_DIR/models/ggml-base.bin"
HOST="127.0.0.1"
PORT="8080"
PID_FILE="$PROJECT_ROOT/data/tmp/whisper-server.pid"

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=========================================="
echo "Whisper Server Startup Script"
echo -e "==========================================${NC}"
echo ""

# Verificar si el servidor ya está corriendo
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if ps -p "$OLD_PID" > /dev/null 2>&1; then
        echo -e "${YELLOW}⚠ Whisper server already running (PID: $OLD_PID)${NC}"
        echo -e "${GREEN}✓ Server address: http://$HOST:$PORT${NC}"
        exit 0
    else
        echo -e "${YELLOW}⚠ Removing stale PID file${NC}"
        rm -f "$PID_FILE"
    fi
fi

# Verificar que el binario existe
if [ ! -f "$SERVER_BIN" ]; then
    echo -e "${RED}✗ Whisper server binary not found at: $SERVER_BIN${NC}"
    echo -e "${YELLOW}  Please run: cd lib/whisper && cmake --build build${NC}"
    exit 1
fi

# Verificar que el modelo existe
if [ ! -f "$MODEL_PATH" ]; then
    echo -e "${RED}✗ Whisper model not found at: $MODEL_PATH${NC}"
    echo -e "${YELLOW}  Please run: cd lib/whisper && bash ./models/download-ggml-model.sh base${NC}"
    exit 1
fi

# Crear directorio para PID si no existe
mkdir -p "$(dirname "$PID_FILE")"

echo -e "${GREEN}Starting whisper server...${NC}"
echo "  Binary: $SERVER_BIN"
echo "  Model: $MODEL_PATH"
echo "  Address: http://$HOST:$PORT"
echo ""

# Iniciar el servidor en background
nohup "$SERVER_BIN" \
    -m "$MODEL_PATH" \
    --host "$HOST" \
    --port "$PORT" \
    -t 4 \
    > "$PROJECT_ROOT/data/tmp/whisper-server.log" 2>&1 &

SERVER_PID=$!

# Guardar PID
echo "$SERVER_PID" > "$PID_FILE"

echo -e "${GREEN}✓ Server started (PID: $SERVER_PID)${NC}"

# Esperar a que el servidor esté listo
echo -n "Waiting for server to be ready"
MAX_WAIT=30
WAIT_COUNT=0

while [ $WAIT_COUNT -lt $MAX_WAIT ]; do
    if curl -s "http://$HOST:$PORT/health" > /dev/null 2>&1; then
        echo ""
        echo -e "${GREEN}✓ Server is ready!${NC}"
        echo ""
        echo -e "${GREEN}=========================================="
        echo "Whisper Server Started Successfully"
        echo "==========================================${NC}"
        echo ""
        echo "  URL: http://$HOST:$PORT"
        echo "  PID: $SERVER_PID"
        echo "  Log: $PROJECT_ROOT/data/tmp/whisper-server.log"
        echo ""
        echo "To stop the server, run:"
        echo "  ./scripts/stop-whisper-server.sh"
        echo ""
        exit 0
    fi

    echo -n "."
    sleep 1
    WAIT_COUNT=$((WAIT_COUNT + 1))
done

echo ""
echo -e "${RED}✗ Server failed to start within ${MAX_WAIT} seconds${NC}"
echo -e "${YELLOW}  Check logs at: $PROJECT_ROOT/data/tmp/whisper-server.log${NC}"

# Limpiar PID
rm -f "$PID_FILE"

# Intentar matar el proceso si todavía existe
if ps -p "$SERVER_PID" > /dev/null 2>&1; then
    kill "$SERVER_PID" 2>/dev/null
fi

exit 1
