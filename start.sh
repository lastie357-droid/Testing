#!/bin/sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -d "/app/backend" ]; then
    BACKEND_DIR="/app/backend"
elif [ -d "$SCRIPT_DIR/backend" ]; then
    BACKEND_DIR="$SCRIPT_DIR/backend"
else
    echo "[start.sh] ERROR: Cannot find backend directory"
    exit 1
fi

if [ -d "/etc/frp" ]; then
    FRPS_CONF="/etc/frp/frps.toml"
    FRPC_CONF="/etc/frp/frpc.toml"
else
    FRPS_CONF="$SCRIPT_DIR/frps/frps.toml"
    FRPC_CONF="$SCRIPT_DIR/frpc/frpc.toml"
fi

echo "[start.sh] Using backend: $BACKEND_DIR"
echo "[start.sh] Using frps config: $FRPS_CONF"
echo "[start.sh] Using frpc config: $FRPC_CONF"

echo "[start.sh] Starting frps..."
frps -c "$FRPS_CONF" &

sleep 1

echo "[start.sh] Starting frpc..."
frpc -c "$FRPC_CONF" &

echo "[start.sh] Starting backend..."
cd "$BACKEND_DIR" && node server.js
