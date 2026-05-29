#!/bin/bash
set -euo pipefail

# PitchSight Live — SessionStart hook.
# Installs the Next.js web app's dependencies so typecheck / build / dev work
# immediately in Claude Code on the web. Idempotent: npm install is safe to
# re-run and benefits from the cached container state.

# Only needed in the remote (web) environment; skip locally.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR/web"
npm install --no-audit --no-fund

# Note: the Python ingestion layer (ingestion/) is optional and its YOLOv8
# dependencies are large, so it is intentionally NOT installed here. Set it up
# on demand with:  cd ingestion && python -m venv .venv && \
#   .venv/bin/pip install -r requirements.txt
