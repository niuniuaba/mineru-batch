#!/usr/bin/env bash
# Start the control plane in the foreground, serving the console it is built with.
#
#   MINERU_PYTHON=/path/to/venv/bin/python ./run.sh
#
# MINERU_PYTHON must be an interpreter where MinerU is installed — not this
# repository's own directory, which is a common way to get this wrong.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY="${MINERU_PYTHON:-$(command -v python3 || true)}"

if [ -z "$PY" ]; then
  echo "error: no python3 on PATH. Set MINERU_PYTHON to the virtualenv interpreter." >&2
  exit 1
fi

if ! "$PY" -c "import mineru" 2>/dev/null; then
  echo "error: $PY cannot import MinerU." >&2
  echo "Set MINERU_PYTHON to the interpreter of the virtualenv MinerU is installed in:" >&2
  echo "  MINERU_PYTHON=/path/to/venv/bin/python $0" >&2
  exit 1
fi

if [ ! -f "$REPO/batch_webui/dist/index.html" ]; then
  echo "note: the console is not built, so / will serve the fallback UI." >&2
  echo "      build it with:  (cd \"$REPO/batch_webui\" && bun install && bun run build)" >&2
fi

# -u: unbuffered, so the startup banner appears even when the output is piped.
exec "$PY" -u "$REPO/batch_api.py"
