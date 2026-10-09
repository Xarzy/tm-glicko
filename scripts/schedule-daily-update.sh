#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_PATH="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/$(basename -- "${BASH_SOURCE[0]}")"
PROJECT_ROOT="$(cd -- "$(dirname -- "$SCRIPT_PATH")/.." && pwd)"
LOG_DIR="$PROJECT_ROOT/logs"
LOG_FILE="$LOG_DIR/daily-update.log"
PID_FILE="$LOG_DIR/daily-update.pid"
SCHEDULE_TZ="Europe/Paris"

timestamp() {
  TZ="$SCHEDULE_TZ" date '+%Y-%m-%d %H:%M:%S %Z'
}

run_scheduler() {
  trap 'exit 0' INT TERM
  trap 'if [[ -n "${sleep_pid:-}" ]]; then kill "$sleep_pid" 2>/dev/null || true; fi; rm -f "$PID_FILE"' EXIT

  while true; do
    now="$(TZ="$SCHEDULE_TZ" date +%s)"
    next_run="$(TZ="$SCHEDULE_TZ" date -d 'today 14:56' +%s)"
    if (( next_run <= now )); then
      next_run="$(TZ="$SCHEDULE_TZ" date -d 'tomorrow 19:30' +%s)"
    fi

    wait_seconds=$((next_run - now))
    printf '[%s] Next daily update at %s\n' \
      "$(timestamp)" \
      "$(TZ="$SCHEDULE_TZ" date -d "@$next_run" '+%Y-%m-%d %H:%M:%S %Z')"

    sleep "$wait_seconds" &
    sleep_pid=$!
    wait "$sleep_pid"
    sleep_pid=""

    printf '[%s] Starting daily update\n' "$(timestamp)"
    if (cd "$PROJECT_ROOT" && bun run src/jobs/dailyUpdate.ts); then
      printf '[%s] Daily update completed successfully\n' "$(timestamp)"
    else
      status=$?
      printf '[%s] Daily update failed with exit status %s\n' "$(timestamp)" "$status"
    fi
  done
}

mkdir -p "$LOG_DIR"

case "${1:-start}" in
  start)
    if [[ -f "$PID_FILE" ]]; then
      existing_pid="$(<"$PID_FILE")"
      if kill -0 "$existing_pid" 2>/dev/null; then
        printf 'Daily update scheduler is already running (PID %s).\n' "$existing_pid"
        exit 0
      fi
      rm -f "$PID_FILE"
    fi

    nohup bash "$SCRIPT_PATH" run >>"$LOG_FILE" 2>&1 </dev/null &
    scheduler_pid=$!
    printf '%s\n' "$scheduler_pid" >"$PID_FILE"
    printf 'Started daily update scheduler (PID %s). Log: %s\n' "$scheduler_pid" "$LOG_FILE"
    ;;
  run)
    run_scheduler
    ;;
  stop)
    if [[ ! -f "$PID_FILE" ]]; then
      printf 'Daily update scheduler is not running.\n'
      exit 0
    fi
    scheduler_pid="$(<"$PID_FILE")"
    if kill -0 "$scheduler_pid" 2>/dev/null; then
      kill "$scheduler_pid"
      printf 'Stopped daily update scheduler (PID %s).\n' "$scheduler_pid"
    else
      rm -f "$PID_FILE"
      printf 'Removed stale scheduler PID file.\n'
    fi
    ;;
  *)
    printf 'Usage: %s [start|stop]\n' "$0" >&2
    exit 2
    ;;
esac
