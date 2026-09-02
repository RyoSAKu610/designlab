#!/bin/bash
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then echo 'Node.js 20+ が必要です'; read -n 1; exit 1; fi
MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$MAJOR" -lt 20 ]; then echo 'Node.js 20+ が必要です'; read -n 1; exit 1; fi
if [ ! -f .env ]; then echo '.env がありません。先に setup.command を実行してください。'; read -n 1; exit 1; fi
( sleep 2; open http://127.0.0.1:4317 ) >/dev/null 2>&1 &
node server.mjs
