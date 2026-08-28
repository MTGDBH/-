#!/bin/sh
set -eu

python /app/ml/runtime_service.py &
runtime_pid=$!
cleanup() {
  kill "$runtime_pid" 2>/dev/null || true
  wait "$runtime_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

cd /app/server
node src/index.js
