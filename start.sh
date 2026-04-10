#!/bin/sh
set -e

echo "[start.sh] Starting frps..."
frps -c /etc/frp/frps.toml &

sleep 1

echo "[start.sh] Starting frpc..."
frpc -c /etc/frp/frpc.toml &

echo "[start.sh] Starting backend..."
cd /app/backend && node server.js
