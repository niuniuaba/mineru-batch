#!/usr/bin/env bash
# Build the console, install the units, and restart the service.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO"

if [ -f batch_webui/package.json ]; then
  (cd batch_webui && bun install --frozen-lockfile && bun run build)
else
  echo "batch_webui is not scaffolded yet; skipping the build" >&2
fi

sudo install -m0644 mineru-batch-api.service /etc/systemd/system/
sudo install -m0644 mineru-batch.service /etc/systemd/system/
if [ ! -f /etc/mineru-batch.env ]; then
  echo "NOTE: /etc/mineru-batch.env does not exist; see batch.env.example" >&2
fi
sudo systemctl daemon-reload
sudo systemctl restart mineru-batch-api
systemctl status --no-pager mineru-batch-api
