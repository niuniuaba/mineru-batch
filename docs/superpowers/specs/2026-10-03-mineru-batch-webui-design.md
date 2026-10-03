# MinerU Batch Console — Design

**Date:** 2026-10-03
**Status:** Approved design, ready for implementation planning
**Repo:** `/home/wing/Apps/mineru-batch` → `github.com/niuniuaba/mineru-batch`

---

## 1. Purpose

Give the existing MinerU batch pipeline a browser front-end that behaves like a
modern document-ingestion tool: drop files, watch them convert, inspect the
result, then scale up to a batch once you trust it.

The console is a **front-end for `batch_api.py`**. The conversion engine does not
change.

### Why not the stock `mineru-webui`

MinerU ships a Gradio WebUI (`mineru-kit webui`) over the V1 REST API. It is
structurally single-document and cannot express this workflow:

- one input only — `gr.File(file_count="single", type="filepath")`
  (`mineru/kit/gradio/app.py:406-410`)
- one file → one V1 job → rich per-file artifacts; no batch table, no
  multi-select, no dashboard
- it refuses any V1 server that does not advertise `file_id` uploads and `zip`
  output (`mineru/kit/gradio/client.py:150-160`)

Gradio is a form library whose data model is one value per component. A
multi-select document table, live per-file status and a settings panel would be
fought, not used. The V1 API was already evaluated and rejected for this use in
`~/.claude/plans/atomic-crunching-dongarra.md` on evidence (path-less output
blobs, no resume, no mirrored tree, no run report).

### Why LightRAG's WebUI is the reference

`/home/wing/Apps/lightrag/lightrag_webui` is the UX being copied: drag-and-drop
that starts work immediately, a status dashboard, multi-select delete, and a
server-parameters panel. It is a React 19 + Vite + Tailwind + Radix single-page
app. Its FastAPI server mounts the built bundle as static files
(`lightrag/api/lightrag_server.py:410,1154`) — the same serving pattern adopted
here.

**Fresh-minimal, not a fork.** The document dialogs and status card are the
parts worth copying; the rest of `lightrag_webui` is retrieval and graph
machinery (sigma, graphology, mermaid) that would be deleted. Rebuilding a
purpose-made app of roughly six components is less work than pruning a few
hundred files.

---

## 2. Goals and non-goals

### Goals

1. Add documents by dropping files or a whole folder anywhere on the page, or
   via an explicit **Upload** button — either way, conversion starts
   automatically. There is no separate "start" step: adding documents and
   running them is one action. (The objection is to the two-step ceremony, not
   to an upload affordance; the button is the discoverable path for people who
   do not drag.)
2. A dashboard listing every document with its status, filterable by state.
3. Click a row to preview the converted Markdown in-app.
4. Multi-select delete, and download (single file, or selected as a zip).
5. A settings panel showing the server's real parameters and, for each, exactly
   how it would be changed.

### Non-goals (v1)

- **Images in the converted Markdown.** The output feeds LLM/RAG pipelines;
  embedded images inflate the token bill. Default stays `--image-mode marker`.
  See §7.4.
- **A VLM fallback tier.** On this host `standard`/`advanced` run the VLM through
  llama.cpp on a 2 GB GT 1030, which per `mineru-batch.service`'s own notes
  *"dies with ErrorOutOfDeviceMemory on image-heavy documents, while also
  measuring ~15x slower."* Not offerable as a UI action (§7.4).
- **Editing server parameters from the browser.** Shown, not edited (§6.4).
- Rich HTML / layout-box / page-image preview (that is the Gradio app's job).
- i18n, dark-mode theming, pagination, per-run tier or image-mode overrides.

---

## 3. Current state (verified)

### The engine — unchanged by this design

- `batch_api.py` (659 lines) is a FastAPI control plane on `0.0.0.0:8090`
  (`HOST`/`PORT` defaults at `batch_api.py:52-53`). It uploads files into an
  input tree, spawns `batch-convert.py` as a child, relays the runner's stdout
  as progress, and serves the converted Markdown back.
- `batch-convert.py` (267 lines) walks a tree, mirrors it to `.md`, resumes by
  skipping existing outputs, isolates per-file failures, and writes
  `run-report.json` + `failures.txt`.
- Path safety is centralised: `_safe_relative` (`batch_api.py:156-175`) and
  `_resolve_within` (`:178-189`).
- Run survival is deliberate: an flock passed to the child, and a run log on
  disk rather than a pipe, so a restarted API adopts an in-flight run
  (`:390-412`).
- Inputs and outputs live on the NAS at `/mnt/nas/media/mineru/{ee-in,ee-md}`.

### Services

- `mineru-webui` — **active** on `:7860`, `--api-server-tier basic`, spawns a
  managed V1 child on loopback. Unaffected by this work.
- `mineru-batch-api` / `mineru-batch` — unit files exist in
  `/home/wing/Apps/mineru/` but are **not installed** (`systemctl is-enabled`
  reports `not-found`). Nothing is running from a unit; `:8090` is closed.

### Toolchain

`bun 1.4.2`, `node v24.21.0`, `npm 11.19.0` are present. The venv has **no
pytest and no test runner** (documented in the installed-package `CLAUDE.md`).

### Verified introspection available to the settings panel

- `mineru.config.get_config_source(path)` → `"default" | "file" | "env"`
  (`config.py:259`)
- `mineru.config.get_config_file_path()` / `get_config_file_exists()`
- `mineru.config.update_config_file(patch)` — lock- and atomic-replace-protected
  (`config.py:271`); usable if editing is ever wanted
- `mineru.config.model.small_backend` (`config.py:504`),
  `mineru.config.model.vlm.engine` (`config.py:436`)
- `mineru.model.runtime.device.get_device()` (`device.py:15`),
  `resolve_small_model_backend()` (`device.py:64`)

---

## 4. Architecture

### 4.1 Three separate things, three separate homes

| # | Thing | Home | Role |
|---|-------|------|------|
| 1 | Upstream MinerU source | `/home/wing/Apps/mineru.git` | clone of `opendatalab/MinerU`; holds the gradio patch branch and `patches/` |
| 2 | Installed MinerU package | `.../site-packages/mineru/` | a *deployment artifact*, replaced by any reinstall |
| 3 | **Batch tooling (this work)** | `/home/wing/Apps/mineru-batch/` | the control plane, the runner, the service units, the web console |

The only edge is at runtime: (3) does `import mineru`, resolving to (2). This
work never writes to (1) or (2), so no upgrade can destroy it.

Making MinerU an editable install from (1) would end the known problem that
edits under `site-packages/` are silently reverted on upgrade — but it is
**not required here** (this code imports two public helpers,
`mineru.filetypes` and `mineru.kit.common.PARSEABLE_SUFFIXES`) and is
deliberately left as a separate future decision.

### 4.2 Topology

```
.138 browser ──HTTP──> .102:8090  mineru-batch-api  (FastAPI/uvicorn, systemd)
                          │  GET  /                      serves the built SPA
                          │  GET  /api/status            run state + server params
                          │  GET  /api/documents         merged document table
                          │  POST /api/upload            multipart, N files, relative paths
                          │  POST /api/start             spawns the runner
                          │  POST /api/stop              terminate the run
                          │  POST /api/clear             empty ee-in
                          │  POST /api/documents/delete  remove input and/or result
                          │  GET  /api/results/download  one .md
                          │  GET  /api/results/content   one .md, inline (preview)
                          │  POST /api/results/zip       selected .md files as a zip
                          ▼
                    /mnt/nas/media/mineru/ee-in ──> batch-convert.py ──> ee-md (mirrored .md tree)
```

One process, one port, `0.0.0.0:8090` (already the default). Same-origin, so no
CORS.

### 4.3 Build and serve

```
/home/wing/Apps/mineru-batch/batch_webui/        source (React 19 + TS + Vite + Tailwind + Radix + axios)
/home/wing/Apps/mineru-batch/batch_webui/dist/   build output (generated, gitignored)
```

`bun install && bun run build` produces `dist/`. `batch_api.py` mounts it last:

```python
app.mount("/", StaticFiles(directory=DIST, html=True), name="static")
```

`/api/*` routes are registered first and therefore win. `batch_ui.html` is kept
in the repo and served as a fallback when `dist/` is missing, so an unbuilt
deploy degrades instead of 500ing.

Dev loop: `bun run dev` on `:5173` with a Vite proxy for `/api` →
`127.0.0.1:8090`.

### 4.4 Boundaries

The SPA is a pure HTTP client. It never imports MinerU, never invokes
`batch-convert.py`, and never touches NAS paths directly. `batch_api.py` remains
the control plane; `batch-convert.py` remains the engine.

### 4.5 Authentication

Inherits `MINERU_BATCH_TOKEN` as-is: **unset by default**, so the console is
open to anyone on the LAN who can reach `:8090` and it writes to the NAS. If a
token is ever set, the SPA needs a token field persisted in `localStorage`.

---

## 5. Backend contract (`batch_api.py` delta)

Existing endpoints are unchanged except where noted. All new paths reuse
`_resolve_within` for safety.

### 5.1 `GET /api/documents` — the table's single source

Supersedes `/api/results` for the console. The merge must happen server-side
because only the server knows the run history.

Resolve each relative path:

1. run active **and** path present in `state.files` → live status
   (`queued | running | done | skipped | failed`) with `pages`, `seconds`,
   `rate`, `error`
2. else a result exists in `ee-md` → `converted` (plus `pages`/`seconds` joined
   from `run-report.json`)
3. else an input exists in `ee-in` → `pending`

Each row: `path, status, pages, seconds, rate, bytes, error, has_input,
has_result`. `bytes` is the size of the result `.md` when one exists, and `null`
otherwise. Response also carries counts per status and the run `state`.

**Why server-side:** after an API restart `state.files` is empty (it is rebuilt
from the current run log). Without the merge, documents converted in an earlier
run would be reported as `pending` again.

Rows are returned unpaginated; runs are chunk-sized. Pagination is a later
concern.

### 5.2 `GET /api/results/content?path=` → `text/markdown`

Returns the body for in-app preview. Unlike `/api/results/download?path=`, it
sets no `Content-Disposition: attachment`. Same `_resolve_within(OUTPUT_DIR, …)`
guard; 404 for a missing or non-`.md` path.

### 5.3 `POST /api/documents/delete`

Body: `{paths: [...], delete_result: true}`.

- **409 while a run is active**, matching the existing rule in `/api/clear` —
  deleting the file the runner is mid-parse is not survivable
- every path validated with `_resolve_within` against both roots
- removes the input from `ee-in`; when `delete_result` is true, also the `.md`
  from `ee-md`
- returns a per-path outcome so a partial failure is visible rather than
  swallowed

`POST /api/clear` remains the "empty the whole input directory" action.

### 5.4 Server parameters

`GET /api/status.config` is extended. Each parameter is returned as a
**server-declared record**, so the UI cannot drift from the server:

```json
{"key": "tier", "value": "basic", "label": "Parse tier",
 "source": "env", "env_var": "MINERU_BATCH_TIER",
 "config_file": null, "effect": "restart"}
```

Two groups:

**Group A — batch service** (owned by `batch_api.py`, set as `Environment=` in
`/etc/systemd/system/mineru-batch-api.service`; `effect: "restart"`):

| Parameter | Env var | Current |
|---|---|---|
| bind host | `MINERU_BATCH_HOST` | `0.0.0.0` |
| port | `MINERU_BATCH_PORT` | `8090` |
| tier | `MINERU_BATCH_TIER` | `basic` |
| image mode | `MINERU_BATCH_IMAGE_MODE` | `marker` |
| root | `MINERU_BATCH_ROOT` | `/mnt/nas/media/mineru` |
| max upload bytes | `MINERU_BATCH_MAX_UPLOAD_BYTES` | 524288000 |
| auth | `MINERU_BATCH_TOKEN` | unset → LAN-open |

**Group B — MinerU** (precedence: defaults → `~/.mineru/config.yaml` →
`MINERU_*` env; `effect: "next_run"` — the runner is a fresh process and
re-reads config at import):

| Parameter | Knob | Source |
|---|---|---|
| small backend | `model.small_backend` ← `MINERU_MODEL_SMALL_BACKEND` | `get_config_source` |
| VLM engine | `model.vlm.engine` ← `MINERU_MODEL_VLM_ENGINE` | `get_config_source` |
| device | `MINERU_DEVICE_MODE` | env |
| model home | `MINERU_HOME` | env |
| config file | `MINERU_CONFIG` | path, with existence flag |

Plus environment facts: `mineru_version`, `python`, resolved `small_backend`,
resolved `vlm_engine`, `device`, `disk_free` / `disk_total` on `ROOT`, and the
live `state`, `pid`, `started_at`, `queued_in_input`.

**Read-only.** The panel shows value, source, the knob to turn, and when the
change takes effect. Editing is out of scope: this endpoint is unauthenticated
on the LAN by default and already writes to the NAS; a web form that rewrote the
model backend would raise the blast radius, and would create a second source of
truth competing with systemd for the same parameters. If ever wanted, it belongs
behind `MINERU_BATCH_TOKEN`.

### 5.5 Auto-start is UI-orchestrated

No new endpoint. The SPA chains `POST /api/upload` → `POST /api/start`. A `409`
means a run is already active; the client latches and starts automatically when
polling shows the run idle with pending documents. The engine's single-run lock
semantics are untouched.

---

## 6. Front-end design

### 6.1 Stack and structure

React 19 + TypeScript + Vite + Tailwind + Radix primitives + axios.
Markdown rendering: `react-markdown` + `remark-gfm` + `remark-math` +
`rehype-katex` (+ `katex`). KaTeX is not optional — MinerU emits LaTeX for
formulas, and without it every equation is unreadable.

```
src/
  main.tsx
  App.tsx                 layout: header · drop zone · run bar · documents table · preview drawer
  api/
    client.ts             axios instance; normalises FastAPI {"detail": ...} errors
    mineru.ts             typed wrappers for every endpoint
    types.ts              Document, StatusPayload, ConfigRecord
  hooks/
    useDocuments.ts       polls /api/documents + /api/status; optimistic delete
    useAutoStart.ts       the upload→start chain and the start-on-idle latch
  components/
    DropZone.tsx          drag-drop + Upload button (files / folder)
    RunStatusBar.tsx      state chip, counts, current file, within-file window, Stop / Clear
    FilterTabs.tsx        All · Pending · Running · Converted · Failed
    DocumentsTable.tsx    rows, multi-select, per-row actions
    PreviewDrawer.tsx     rendered Markdown
    SettingsPanel.tsx     two groups, from server-declared records
    ServerIndicator.tsx   fixed bottom-right connection dot (§6.6)
    ConfirmDialog.tsx     delete / clear
    ui/                   Radix wrappers: button, dialog, checkbox, badge, progress, table, tabs
```

### 6.2 Status vocabulary

Raw states the server reports: `queued`, `running`, `done`, `skipped`,
`failed` while a run is active, plus `pending` and `converted` derived on merge
(§5.1).

User-facing buckets: **All · Pending · Running · Converted · Failed**. Both
`done` and `skipped` fold into **Converted** — a document with a result is
converted whether this run produced it or it already existed — with `skipped`
rendered as a muted variant carrying an "already existed" tooltip.

### 6.3 Flows

**Add → convert.** Three entry points, all ending in the same chain:
`DataTransferItem.webkitGetAsEntry` for dragged files and folders,
`<input multiple>` for the **Upload** button, and `<input webkitdirectory>` for
its folder variant (using `webkitRelativePath`) — the approach already proven in
`batch_ui.html`. Whatever the source: `POST /api/upload` (multipart with
`relative_paths`) → `POST /api/start`. Upload progress from
`onUploadProgress`. On `409` the run bar shows *"N documents queued behind the
running job"* and the latch is armed.

**Preview.** Row click → `GET /api/results/content?path=` → rendered Markdown in
a side drawer, with Download / Copy / raw affordances. Only enabled when
`has_result`.

**Downloads.** Per row: `GET /api/results/download?path=`. Bulk: selected paths →
`POST /api/results/zip` → blob.

**Delete.** Row or bulk → `ConfirmDialog` → `POST /api/documents/delete`. The
dialog names the count and states that converted output is included.

**Polling.** ~1.5 s while a run is active, ~5 s idle, paused when
`document.visibilityState === "hidden"`. This host is CPU-bound; a background
tab must not compete with inference.

### 6.4 The figure-omitted marker

With `--image-mode marker`, each figure is replaced by
`<!-- figure omitted: ImageBlock -->`. Raw HTML comments are stripped by the
Markdown renderer and would vanish silently. A small transform converts them to
a visible muted chip — *"figure omitted"* — so the preview is honest about what
the text-only default dropped, with no engine change.

### 6.5 Error surfaces

No silent failures. Per-row `failed` carries the runner's message; run-level
failure shows `state.message` (already produced by `batch_api.py`); `413` →
"exceeds the 500 MB limit"; `400` → path rejected. A lost connection shows in
the indicator (§6.6) and, when a request actually fails, as an inline retry
banner rather than a dead spinner.

### 6.6 Server connection indicator

A persistent health indicator in the bottom-right corner, mirroring LightRAG's
`StatusIndicator` (`fixed right-4 bottom-4`):

- a small dot — green when the server answers, red when it does not
- a short label: **Connected** / **Disconnected**
- a brief scale/glow animation on each state change, so a transition is noticed
  without staring at it
- clicking it opens a details dialog: base URL, last successful check, round-trip
  latency, `mineru_version`, and the run `state` from `/api/status`

It is fed by the existing status poll — no extra endpoint, and no second timer
competing with the documents poll. Because `/api/status` is already the
healthiest possible probe (it reads the run state and the input tree), a
successful poll *is* the health signal; a failed one flips the dot to red and
starts the backoff. The indicator is the always-visible answer to "is this thing
even alive", which matters on a service that is unauthenticated and may be
reached over a flaky LAN.

---

## 7. Risks and decisions

### 7.1 Directory drop and relative paths

Gradio's `file_count="directory"` was the unknown that ruled out the Gradio
route. In a plain SPA this is solved: the entry API and `webkitRelativePath`
both supply the tree, and `batch_api`'s `/api/upload` already accepts
`relative_paths`. Proven in `batch_ui.html`.

### 7.2 Deleting while a run is in progress

Refused (409), consistent with `/api/clear`. Alternative considered: allow
deleting queued-but-not-started inputs. Rejected for v1 — the runner's progress
is derived from the queue order, and mutating the tree mid-run would make
"currently running" ambiguous.

### 7.3 Testability of module-level roots

`ROOT`, `INPUT_DIR`, `OUTPUT_DIR` are module constants read from env at import.
The endpoints should read them through a single small accessor so tests can
point them at a `tmp_path`. Folded into the §5.1/§5.3 work rather than a
separate refactor.

### 7.4 Images, and why there is no VLM button

The `.md` is the product; it feeds RAG and LLM-wiki pipelines where embedded
images are a direct token cost. `marker` is therefore the default and stays the
default.

The natural escape hatch — "run it again with a stronger model to get the
figures" — is not available on this host. `standard`/`advanced` drive the VLM
through llama.cpp on a 2 GB GT 1030, which the batch service's own notes record
as failing with `ErrorOutOfDeviceMemory` on image-heavy documents at ~15x
slower throughput. It is an off-box or future path, not a button.

### 7.5 Not a git-tracked problem anymore

`batch_api.py`, `batch-convert.py` and the service units were previously
untracked, living in the uv venv root. They move into a repository of their own,
leaving upstream MinerU and the installed package untouched.

---

## 8. Testing

### 8.1 Backend — pytest + `TestClient`

Requires `pytest` and `httpx` added to the venv as dev-only dependencies.
(`TestClient` drives async endpoints; no `pytest-asyncio` needed.)

Priority order:

1. `_safe_relative` / `_resolve_within` — traversal, absolute paths, drive
   letters, null bytes, and symlink escape, **especially through the read path**
   (`/api/results/content`, `/api/results/download`) where a miss leaks
   arbitrary files
2. `/api/documents` merge — including the regression case that motivated it:
   empty `state.files` after a restart must still report `converted`
3. delete — 409 while running, path safety on both roots, partial outcomes
4. upload — 413 oversize, nested directories, relative path preserved
5. `/api/results/content` — content type, 404, guard
6. config payload — each record carries `env_var` / `source` / `effect`

### 8.2 Front-end — vitest + `@testing-library/react`

vitest shares the existing Vite config. Cover the logic, not the pixels:

- status → bucket mapping, including `skipped` → Converted
- `useAutoStart`: upload→start, and 409 → start-on-idle, with fake timers
- the figure-omitted transform
- the delete confirm flow
- the unreachable-server banner

An 80% blanket threshold is not a useful target for a fresh SPA; coverage is
aimed at the modules where a defect is silent — status resolution, path
handling, and the auto-start latch.

---

## 9. Delivery

### 9.1 Repository

`/home/wing/Apps/mineru-batch/`, a git repository with its remote at
**`github.com/niuniuaba/mineru-batch`** (`origin`). Contains:

- `batch_api.py`, `batch-convert.py`, `batch_ui.html` (fallback)
- `mineru-batch-api.service`, `mineru-batch.service`
- `batch_webui/`
- `docs/superpowers/specs/`
- `.gitignore`: `node_modules/`, `dist/`, `__pycache__/`, `*.pyc`

### 9.2 Migration

Move the files; update `ExecStart=` and `WorkingDirectory=` in both units.
`MINERU_BATCH_RUNNER` defaults relative to `__file__`, so it follows. The
interpreter stays `/home/wing/Apps/mineru/bin/python`. Low risk: no unit is
currently installed (`is-enabled` → `not-found`).

### 9.3 Build and deploy

`deploy.sh`: `bun install` → `bun run build` → install unit files →
`systemctl daemon-reload`. `dist/` is gitignored and built at deploy time.

### 9.4 Acceptance checks

1. Drop one file → conversion starts with no further clicks; the same through the
   Upload button, once with a multi-select and once with a folder.
2. Click the row → Markdown renders, formulas included.
3. Download the result; download a multi-select as a zip.
4. Drop a folder → second run appends; relative paths preserved.
5. Multi-select delete removes input and result; refused while running.
6. Settings panel shows real values, their sources, the knob to change each, and
   when the change takes effect.
7. Kill the API mid-run, restart it → the run is adopted and progress restored.
8. Stop the API → the bottom-right indicator turns red; start it → green again.
9. Backend pytest suite green.

### 9.5 Suggested phasing

The work splits into three independently verifiable phases; the implementation
plan should preserve that order so each phase ends somewhere testable.

1. **Repo + backend.** Move the tooling into the new repo, fix the unit paths,
   add the §5 endpoints and the small settings-accessor refactor (§7.3), with
   the pytest suite. Ends with a working API and a fallback `batch_ui.html`.
2. **Console core.** Vite project, API client, drop zone with the auto-start
   chain, run bar, documents table with filter tabs. Ends with drop → convert →
   table, no preview.
3. **Console completion.** Preview drawer, downloads, multi-select delete, the
   settings panel, and the front-end tests.

---

## 10. Open items

- Editable install of MinerU from the clone: deliberately deferred (§4.1).
- Config editing from the browser: deliberately deferred, token-gated if ever
  (§5.4).

---

## 11. References

- `~/.claude/plans/atomic-crunching-dongarra.md` — the plan that produced
  `batch_api.py`, and its evidence for rejecting the V1 API
- `/home/wing/Apps/lightrag/lightrag_webui` — the UX reference
- `mineru/kit/gradio/app.py:406-410`, `kit/gradio/client.py:150-160` — why the
  stock WebUI was rejected
- `mineru/parser/api_server.py:83,475` — V1's ≤100-file jobs, evaluated and
  rejected
- `mineru/config.py:259,271,436,504` — config source resolution and write
- `mineru/model/runtime/device.py:15,64` — backend and device introspection
- `mineru-batch-api.service`, `mineru-batch.service` — operational context and
  the VLM/GPU constraint
