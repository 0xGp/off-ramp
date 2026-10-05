#!/usr/bin/env bash
# Local development Postgres in ./.pgdata on port 54329 (trust auth, localhost only).
set -euo pipefail
cd "$(dirname "$0")/.."
PGDATA=.pgdata
PORT=54329

case "${1:-}" in
  start)
    if [ ! -d "$PGDATA" ]; then
      initdb -D "$PGDATA" --auth=trust --encoding=UTF8 >/dev/null
    fi
    if ! pg_isready -q -h localhost -p "$PORT"; then
      pg_ctl -D "$PGDATA" -o "-p $PORT -k /tmp -c listen_addresses=localhost" -l "$PGDATA/server.log" -w start >/dev/null
    fi
    for db in melo melo_test; do
      createdb -h localhost -p "$PORT" "$db" 2>/dev/null || true
    done
    echo "Postgres on postgres://localhost:$PORT (databases: melo, melo_test)"
    ;;
  stop)
    pg_ctl -D "$PGDATA" -w stop >/dev/null && echo "stopped"
    ;;
  *)
    echo "usage: scripts/db.sh start|stop" >&2
    exit 1
    ;;
esac
