#!/usr/bin/env bash
# Runs Postgres, the API, the worker and the web app together. Ctrl-C stops all of them.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_PORT="${WEB_PORT:-3100}"

for dir in backend web; do
  if [ ! -d "$ROOT/$dir/node_modules" ]; then
    (cd "$ROOT/$dir" && npm install)
  fi
done

(cd "$ROOT/backend" && npm run --silent db:start && npm run --silent migrate)

# Each service runs in its own process group so cleanup can stop npm and every child it spawned.
set -m
pids=()
run() {
  local name="$1" color="$2" dir="$3"
  shift 3
  (cd "$ROOT/$dir" && "$@" 2>&1 | sed -u "s/^/$(printf '\033[%sm' "$color")[$name]$(printf '\033[0m') /") &
  pids+=("$!")
}

cleanup() {
  trap - INT TERM EXIT
  for pid in "${pids[@]}"; do
    kill -TERM -- "-$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

run api 36 backend npm run --silent dev:api
run worker 35 backend npm run --silent dev:worker
run web 32 web npx next dev -p "$WEB_PORT"

echo "API http://localhost:${PORT:-4000} | Web http://localhost:$WEB_PORT | Ctrl-C to stop"
wait
