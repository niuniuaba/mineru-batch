#!/usr/bin/env bash
# Build the console, install the units, and (re)start the service.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO"

UNITS=(mineru-batch-api.service mineru-batch.service)

command -v bun >/dev/null || {
  echo "bun is required to build the console" >&2
  exit 1
}

(cd batch_webui && bun install --frozen-lockfile && bun run build)

if [ ! -f batch_webui/dist/index.html ]; then
  echo "the console build produced no dist/index.html; the service would serve the fallback UI" >&2
  exit 1
fi

# The units ship with placeholders, and the natural place to fill them in is the installed
# copy. Overwriting that silently would undo the host's configuration and break the restart
# two steps later, so refuse and show the difference instead.
for unit in "${UNITS[@]}"; do
  target="/etc/systemd/system/$unit"
  if [ -f "$target" ] && ! cmp -s "$unit" "$target"; then
    echo "REFUSING to overwrite $target: it differs from the copy in this repository." >&2
    echo "Move host-specific values into a drop-in ($target.d/host.conf), or reconcile by hand:" >&2
    diff -u "$target" "$unit" >&2 || true
    exit 1
  fi
done

for unit in "${UNITS[@]}"; do
  sudo install -m0644 "$unit" "/etc/systemd/system/$unit"
done

ENV_FILE=/etc/mineru-batch.env
if [ ! -f "$ENV_FILE" ]; then
  echo "NOTE: $ENV_FILE does not exist; see batch.env.example" >&2
else
  mode=$(stat -c '%a' "$ENV_FILE" 2>/dev/null || echo unknown)
  if [ "$mode" != "600" ]; then
    echo "WARN: $ENV_FILE is mode $mode; it can hold MINERU_BATCH_TOKEN, so 0600 is safer" >&2
  fi
fi

sudo systemctl daemon-reload

# User= cannot come from EnvironmentFile, so a unit that still has the placeholder fails at
# start with a bare "status=217/USER". Catch it here, with the fix. Checked through systemd
# rather than by grepping the file, so a drop-in satisfies it.
for unit in "${UNITS[@]}"; do
  user=$(systemctl show -p User --value "$unit" 2>/dev/null || true)
  if [ -z "$user" ] || [ "$user" = "CHANGE_ME" ]; then
    echo "REFUSING to start: $unit has no usable User= (got '${user:-unset}')." >&2
    echo "Set it in a drop-in, so the installed unit keeps matching this repository:" >&2
    echo "  sudo install -d /etc/systemd/system/$unit.d" >&2
    echo "  printf '[Service]\\nUser=%s\\nGroup=%s\\n' \"\$(id -un)\" \"\$(id -gn)\" | sudo tee /etc/systemd/system/$unit.d/host.conf" >&2
    echo "  sudo systemctl daemon-reload" >&2
    exit 1
  fi
done

# enable --now, not restart: a fresh host would otherwise run the service until the next
# reboot and never bring it back.
sudo systemctl enable --now mineru-batch-api
if ! sudo systemctl restart mineru-batch-api; then
  echo "mineru-batch-api failed to restart" >&2
fi
systemctl status --no-pager mineru-batch-api || true
journalctl -u mineru-batch-api -n 20 --no-pager || true
