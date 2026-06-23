#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -f "$ROOT/dist/bin/playwright-cli-axi.js" ]]; then
  (cd "$ROOT" && npm run build)
fi

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/playwright-cli-axi-smoke.XXXXXX")"
STATE_DIR="$WORKDIR/state"
VIDEO_FILE="$WORKDIR/out.webm"
mkdir -p "$STATE_DIR"

run_axi() {
  set +e
  (cd "$WORKDIR" && XDG_STATE_HOME="$STATE_DIR" node "$ROOT/dist/bin/playwright-cli-axi.js" "$@")
  local status=$?
  set -e
  printf '\n'
  return "$status"
}

log() { printf '\n## %s\n' "$*"; }

log "home before browser"
run_axi

log "open browser"
if ! run_axi open 'about:blank'; then
  cat <<'MSG'

Browser open failed. If Chrome is missing, run one of:
  node dist/bin/playwright-cli-axi.js install-browser chrome-for-testing
  PLAYWRIGHT_MCP_EXECUTABLE_PATH=/usr/bin/chromium npm run smoke:video
MSG
  exit 1
fi

log "start recording"
run_axi video-start "$VIDEO_FILE" --size 320x240

log "show actions"
run_axi video-show-actions --duration 100 --position top-right --cursor pointer

log "perform visible navigation/action"
run_axi goto 'https://example.com'
run_axi mousemove 20 20

log "add chapter"
run_axi video-chapter Smoke --description 'AXI smoke' --duration 50

log "hide actions"
run_axi video-hide-actions

log "stop recording"
run_axi video-stop

log "close browser"
run_axi close

log "verify file"
if [[ ! -s "$VIDEO_FILE" ]]; then
  echo "Expected non-empty video file at $VIDEO_FILE" >&2
  exit 1
fi
ls -lh "$VIDEO_FILE"

if command -v ffprobe >/dev/null 2>&1; then
  ffprobe -v error -show_entries format=format_name,duration,size -show_streams -of compact "$VIDEO_FILE"
else
  echo "ffprobe not found; skipped container/duration inspection"
fi

log "home after smoke"
run_axi
