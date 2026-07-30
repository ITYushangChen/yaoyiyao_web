#!/usr/bin/env bash
# 局域网模式启动（Mac / Linux）
# 用法：./start-lan.sh
# 或：bash start-lan.sh

set -euo pipefail
cd "$(dirname "$0")"

# 清掉公网相关环境变量，避免本机误走 Railway 域名
unset PUBLIC_URL BASE_URL LAN_URL RAILWAY_PUBLIC_DOMAIN RAILWAY_STATIC_URL RAILWAY_ENVIRONMENT || true

PORT="${PORT:-8780}"
export PORT

echo ""
echo "=== 摇一摇 · 局域网模式 ==="
echo "大屏: http://127.0.0.1:${PORT}/screen"
echo "手机需与电脑连接同一 WiFi"
echo ""

exec node server.js
