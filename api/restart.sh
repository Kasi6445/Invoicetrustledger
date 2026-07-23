#!/usr/bin/env bash
# Safely (re)start the Invoice Trust Ledger API on :3000.
#
# WHY THIS EXISTS — two failure modes bit us and this script exists to make both
# impossible:
#   1. `pkill -f "node server.js"` / `pgrep -f server.js` also match the SHELL
#      running the command (its argv contains "server.js"), so they kill the
#      wrong process and can leave the real server alive. This script kills ONLY
#      the PID that actually owns the :3000 listening socket (lsof/fuser/ss).
#   2. Starting a new server before the old one releases the port makes the new
#      one die with EADDRINUSE while the OLD (stale) code keeps serving —
#      SILENTLY. This script refuses to start until the port is CONFIRMED free,
#      and exits non-zero + loud if it can't free it. A script that hides stale
#      code is worse than no script.
#
# Idempotent: safe to run when nothing is listening.
# Usage: bash restart.sh          (restarts in whatever LEDGER_MODE .env has)
set -u

PORT=3000
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$DIR/data/server.log"     # under data/ (gitignored)
API="http://localhost:$PORT"

say()  { printf '%s\n' "$*"; }
loud() { printf '\n!!! %s\n\n' "$*" >&2; }

# PIDs LISTENING on $PORT, by socket ownership — never by process-name match.
listeners() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null
  elif command -v fuser >/dev/null 2>&1; then
    fuser "$PORT/tcp" 2>/dev/null | tr -s ' ' '\n' | grep -E '^[0-9]+$'
  else
    ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -oP 'pid=\K[0-9]+'
  fi
}
port_free() { [ -z "$(listeners)" ]; }

# ---- 1. stop whatever holds the port (idempotent) ----
pids="$(listeners | sort -u)"
if [ -n "$pids" ]; then
  say "Stopping PID(s) holding :$PORT -> $(echo $pids | tr '\n' ' ')"
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null
else
  say "Nothing listening on :$PORT (clean start)."
fi

# ---- 2. poll until the port is CONFIRMED free, or give up LOUDLY ----
deadline=$(( $(date +%s) + 15 ))
while ! port_free; do
  if [ "$(date +%s)" -ge "$deadline" ]; then
    still="$(listeners | sort -u)"
    say "Port still busy after 15s — escalating to SIGKILL: $(echo $still | tr '\n' ' ')"
    # shellcheck disable=SC2086
    [ -n "$still" ] && kill -9 $still 2>/dev/null
    sleep 2
    if ! port_free; then
      loud "ABORT: :$PORT is STILL held by PID(s) $(listeners | tr '\n' ' '). NOT starting a second server — it would EADDRINUSE and the stale one would keep serving. Investigate by hand: lsof -iTCP:$PORT -sTCP:LISTEN"
      exit 1
    fi
    break
  fi
  sleep 0.3
done
say "Port :$PORT is free."

# ---- 3. start the server ----
mkdir -p "$DIR/data"
cd "$DIR" || { loud "ABORT: cannot cd to $DIR"; exit 1; }
nohup node server.js > "$LOG" 2>&1 &
newpid=$!
say "Started node server.js (pid $newpid), logging to $LOG"

# ---- 4. wait for /health; if the process dies mid-start, fail loudly ----
deadline=$(( $(date +%s) + 20 ))
health=""
while [ "$(date +%s)" -lt "$deadline" ]; do
  health="$(curl -s "$API/health" 2>/dev/null)"
  [ -n "$health" ] && break
  if ! kill -0 "$newpid" 2>/dev/null; then
    loud "ABORT: server process exited during startup. Last log lines:"
    tail -5 "$LOG" >&2; exit 1
  fi
  sleep 0.3
done
if [ -z "$health" ]; then
  loud "ABORT: server did not answer /health within 20s. Last log lines:"
  tail -5 "$LOG" >&2; exit 1
fi

# ---- 5. announce the LEDGER_MODE it came up in (mock vs fabric confusion) ----
mode="$(printf '%s' "$health" | grep -oP '"ledgerMode":"\K[^"]+')"
mode="${mode:-unknown}"
printf '\n========================================\n'
printf '  API UP on %s\n' "$API"
printf '  LEDGER_MODE = %s\n' "$mode"
printf '========================================\n\n'
say "$health"
