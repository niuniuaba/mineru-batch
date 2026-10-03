# mineru-batch

A batch conversion console for [MinerU](https://github.com/opendatalab/MinerU):
drop documents, watch a tree convert to mirrored Markdown, inspect the result, download it.

- `batch_api.py` — FastAPI control plane: upload, run, status, results, preview
- `batch_webui/` — the browser console (React + Vite), served by the control plane
- `batch-convert.py` — the conversion engine, run as a child process
- `batch_settings.py` — every path and parameter, from the environment
- `docs/superpowers/` — the design and the implementation plan

## How it works

```
browser ──> batch_api.py :8090 ──> batch-convert.py ──> $MINERU_HOME/batch/ee-md (mirrored .md)
                 │
                 └── serves the built console at /, the API under /api/
```

Choosing documents — by drag-and-drop, or with the **Upload files** / **Upload folder**
buttons — uploads them and starts the run. There is no separate "start" step.

The conversion is done by a child process that inherits the run lock and writes to
`run.log` on disk rather than a pipe, so **restarting the API does not kill a run**: the
restarted process adopts it and restores progress.

## Configure

Everything comes from the environment; nothing site-specific lives in this repository.
Copy `batch.env.example` to `/etc/mineru-batch.env` and edit it:

```bash
sudo install -m0600 batch.env.example /etc/mineru-batch.env
```

| Variable | Default | Meaning |
|---|---|---|
| `MINERU_HOME` | `~/.mineru` | MinerU's own home: config, models, logs |
| `MINERU_BATCH_ROOT` | `$MINERU_HOME/batch` | The batch tree (`ee-in/` → `ee-md/`) |
| `MINERU_BATCH_TIER` | `basic` | Parse tier |
| `MINERU_BATCH_IMAGE_MODE` | `marker` | `marker` omits figures from the Markdown |
| `MINERU_BATCH_HOST` / `_PORT` | `0.0.0.0` / `8090` | Where the control plane listens |
| `MINERU_BATCH_MAX_UPLOAD_BYTES` | 524288000 | Per-file upload cap |
| `MINERU_BATCH_TOKEN` | *(empty)* | If set, requires `Authorization: Bearer <token>` |

The **Server parameters** panel in the console shows each of these — its effective value,
which source won, and exactly how to change it.

## Run

```bash
# Development: Vite on :5173, proxying /api to a control plane on :8090
<venv>/bin/python batch_api.py &
cd batch_webui && bun install && bun run dev
```

## Deploy

```bash
./deploy.sh          # builds the console, installs the units, restarts the service
```

`deploy.sh` needs `/etc/mineru-batch.env` and the two paths in the unit files adjusted for
the host (`ExecStart`, `WorkingDirectory`, `User`). The built console lands in
`batch_webui/dist/`, which is gitignored and built at deploy time; if it is missing, `/`
falls back to the single-file `batch_ui.html`.

There is no authentication by default: anyone who can reach the port can upload, convert
and download. Set `MINERU_BATCH_TOKEN` to change that.

## Test

```bash
<venv>/bin/python -m pytest tests -v     # API: paths, merge, delete, config
cd batch_webui && bun run test           # console: buckets, upload chain, preview, UI
```
