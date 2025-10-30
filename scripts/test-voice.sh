#!/bin/bash

# Script para probar la funcionalidad de voice transcription

echo "=========================================="
echo "Voice Transcription Feature Test"
echo "=========================================="
echo ""

# Check if ffmpeg is installed
echo "1. Checking ffmpeg installation..."
if command -v ffmpeg &> /dev/null; then
    echo "   ✓ ffmpeg is installed: $(ffmpeg -version | head -n 1)"
else
    echo "   ✗ ffmpeg is NOT installed"
    echo "   Please install ffmpeg: sudo pacman -S ffmpeg"
    exit 1
fi
echo ""

# Check if OpenAI API key is set
echo "2. Checking OpenAI API key..."
if [ -f .env ]; then
    if grep -q "^OPENAI_API_KEY=" .env; then
        if grep -q "^OPENAI_API_KEY=sk-" .env; then
            echo "   ✓ OpenAI API key is configured"
        else
            echo "   ⚠ OpenAI API key is commented out or empty"
            echo "   Please set OPENAI_API_KEY in .env file"
        fi
    else
        echo "   ✗ OpenAI API key is NOT configured"
        echo "   Please add OPENAI_API_KEY to .env file"
    fi
else
    echo "   ✗ .env file not found"
fi
echo ""

# Check if required directories exist
echo "3. Checking required directories..."
if [ ! -d "data/tmp/audio" ]; then
    echo "   Creating data/tmp/audio directory..."
    mkdir -p data/tmp/audio
    echo "   ✓ Directory created"
else
    echo "   ✓ data/tmp/audio exists"
fi
echo ""

# Check if templates are compiled
echo "4. Checking template compilation..."
if [ -f "templates/pages/voice_templ.go" ]; then
    echo "   ✓ Templates are compiled"
else
    echo "   ✗ Templates need compilation"
    echo "   Running: templ generate"
    templ generate
    if [ $? -eq 0 ]; then
        echo "   ✓ Templates compiled successfully"
    else
        echo "   ✗ Template compilation failed"
        exit 1
    fi
fi
echo ""

# Build the project
echo "5. Building project..."
go build -o daily-notes .
if [ $? -eq 0 ]; then
    echo "   ✓ Build successful"
else
    echo "   ✗ Build failed"
    exit 1
fi
echo ""

echo "=========================================="
echo "All checks passed! ✓"
echo "=========================================="
echo ""
echo "To start the server, run:"
echo "  ./daily-notes"
echo ""
echo "Then navigate to:"
echo "  http://localhost:3000/voice"
echo ""
echo "Note: You must be logged in to access /voice"
echo "=========================================="
