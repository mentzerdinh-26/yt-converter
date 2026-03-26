#!/bin/zsh
# Start script for macOS - snapyt2mp4.click
# Runs backend + Cloudflare tunnel with full logging

LOG_DIR="$(dirname "$0")/logs"
mkdir -p "$LOG_DIR"

TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
BACKEND_LOG="$LOG_DIR/backend_$TIMESTAMP.log"
TUNNEL_LOG="$LOG_DIR/tunnel_$TIMESTAMP.log"

cleanup() {
  echo ""
  echo "[$(date '+%H:%M:%S')] Shutting down..."
  kill $BACKEND_PID 2>/dev/null
  kill $TUNNEL_PID 2>/dev/null
  wait $BACKEND_PID 2>/dev/null
  wait $TUNNEL_PID 2>/dev/null
  echo "[$(date '+%H:%M:%S')] All processes stopped."
  exit 0
}
trap cleanup SIGINT SIGTERM

echo "============================================"
echo "  SnapYT - snapyt2mp4.click"
echo "============================================"
echo ""
echo "Backend log:  $BACKEND_LOG"
echo "Tunnel log:   $TUNNEL_LOG"
echo ""

# Start backend with logging (tee to both terminal and file)
echo "[$(date '+%H:%M:%S')] Starting backend on port 3000..."
node server.js 2>&1 | tee -a "$BACKEND_LOG" &
BACKEND_PID=$!

sleep 2

# Verify backend started
if ! kill -0 $BACKEND_PID 2>/dev/null; then
  echo "[ERROR] Backend failed to start. Check $BACKEND_LOG"
  exit 1
fi

echo "[$(date '+%H:%M:%S')] Backend is running (PID $BACKEND_PID)"
echo ""

# Start Cloudflare tunnel with logging
echo "[$(date '+%H:%M:%S')] Connecting Cloudflare Tunnel..."
cloudflared tunnel run my-yt-converter 2>&1 | tee -a "$TUNNEL_LOG" &
TUNNEL_PID=$!

sleep 3

echo ""
echo "============================================"
echo "  LOCAL:  http://localhost:3000"
echo "  PUBLIC: https://snapyt2mp4.click"
echo "============================================"
echo ""
echo "Press Ctrl+C to stop all services."
echo ""

# Wait for either process to exit
while kill -0 $BACKEND_PID 2>/dev/null && kill -0 $TUNNEL_PID 2>/dev/null; do
  sleep 1
done
echo "[$(date '+%H:%M:%S')] A process exited. Shutting down..."
cleanup
