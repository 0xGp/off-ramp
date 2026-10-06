#!/usr/bin/env bash
# Local live test against MAINNET: real Arc deposits, real Paycrest orders, real treasury funds.
# Uses backend/.env.mainnet-local (its own database). Stop `npm run dev` first; same ports.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/backend/.env.mainnet-local"
WEB_PORT="${WEB_PORT:-3100}"

[ -f "$ENV_FILE" ] || { echo "missing backend/.env.mainnet-local" >&2; exit 1; }
for port in 4000 "$WEB_PORT"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "port $port is in use (is \`npm run dev\` still running?):" >&2
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >&2
    exit 1
  fi
done

(cd "$ROOT/backend" && npm run --silent db:start && node --env-file="$ENV_FILE" src/db/migrate.ts)

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

run api 36 backend node --env-file="$ENV_FILE" src/api/main.ts
run worker 35 backend node --env-file="$ENV_FILE" src/worker/main.ts
run web 32 web env NEXT_PUBLIC_MELO_NETWORK=mainnet NEXT_PUBLIC_MELO_BACKEND_URL=http://localhost:4000 npx next dev -p "$WEB_PORT"

echo "LIVE (mainnet) API http://localhost:4000 | Web http://localhost:$WEB_PORT | Ctrl-C to stop"
wait
