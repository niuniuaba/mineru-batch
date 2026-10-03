# MinerU Batch Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser console for the existing MinerU batch pipeline — drop documents, watch them convert, inspect the Markdown, and pull the results — backed by `batch_api.py`.

**Architecture:** Three phases. Phase 1 moves the batch tooling into this repository, makes its paths testable, and grows the HTTP API with the endpoints the console needs. Phase 2 scaffolds a React SPA and builds the document table with drop-to-convert. Phase 3 adds preview, downloads, delete, and the settings panel. The SPA is a pure HTTP client; the conversion engine (`batch-convert.py`) is never modified.

**Tech Stack:** Python 3.12, FastAPI 0.141.1, Starlette 1.7.0, uvicorn 0.54.0, pydantic 2.13.5, python-multipart 0.0.32, httpx 0.28.1, pytest (to be added). Node 24.21.0, bun 1.4.2, React 19, TypeScript, Vite, Tailwind, Radix primitives, axios, react-markdown + remark-gfm + remark-math + rehype-katex, vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-10-03-mineru-batch-webui-design.md` — read it alongside this plan. Section references below (§N) point into it.

## Local Setup

Run once per shell. `PY` is the virtualenv where `import mineru` resolves — **not** this repository's interpreter.

```bash
export REPO=$(git rev-parse --show-toplevel)
export PY=<mineru-venv>/bin/python      # e.g. the venv MinerU is installed into
"$PY" -c "import mineru; print(mineru.__file__)"   # must print site-packages/mineru/__init__.py
```

## Global Constraints

- **Storage root:** `$MINERU_BATCH_ROOT`, defaulting to `$MINERU_HOME/batch` (`$MINERU_HOME` defaults to `~/.mineru`). Inputs are `ee-in/`, outputs `ee-md/`, both under that root. No other absolute path may be baked into committed code.
- **Bind:** `0.0.0.0:8090` (`MINERU_BATCH_HOST` / `MINERU_BATCH_PORT`).
- **Defaults that must not drift:** `--tier basic`, `--image-mode marker`. Figures stay omitted from the Markdown; the preview must never reintroduce them.
- **This repository is public.** No LAN addresses, no `<user>`-specific absolute paths, no hardware model names in committed files. Deployment specifics arrive via an uncommitted environment file (Task 8).
- **No "Start" control anywhere in the console.** Choosing documents starts the run. `POST /api/upload` and `POST /api/start` stay separate on the server; the client chains them.
- **The settings panel is read-only.** No endpoint may write configuration.
- **Every user-supplied relative path** — on upload, download, content, and delete — goes through `_resolve_within` against the relevant root, and the existing `_safe_relative` refusal rules (absolute, drive letter, `..`, null byte) are unchanged.
- **Per-file upload cap:** `MINERU_BATCH_MAX_UPLOAD_BYTES`, default 524288000.
- **Python style in this repo:** `from __future__ import annotations`, type annotations on every signature, Chinese module docstrings are *not* used here (this repo's existing files use English docstrings) — match `batch_api.py` as it stands.

## Review Focus

Five inputs the spec implies but no task's happy-path test exercises. Each has a test pinned to the owning task.

1. **A symlinked path pointing outside the root** on upload, content, download, or delete — must be refused (400/404), never followed.
2. **A result whose input no longer exists** (converted, then the input was deleted or the tree cleared) — must report `converted` and must not raise anywhere in the merge, delete, or content paths.
3. **Filenames that are legal on disk but awkward in a URL** — `?`, `#`, `%`, `+`, spaces, non-ASCII — must round-trip through content, download, and zip.
4. **Same basename in different subdirectories** (`a/report.pdf`, `b/report.pdf`) — must produce two independent rows and two independent results, never a collision.
5. **A drop arriving while a run is already active** — must upload, report queued, start exactly once when the run finishes, and never spawn a duplicate or lose the batch.

---

## File Structure

| File | Responsibility |
|---|---|
| `batch_settings.py` *(new)* | Environment-resolved paths and parameters; the single place tests can redirect. |
| `batch_api.py` *(moved, modified)* | FastAPI app, routes, middleware, run state. |
| `batch-convert.py` *(moved, unchanged)* | The engine. Not touched by any task. |
| `batch_ui.html` *(moved, unchanged)* | Fallback UI served when `batch_webui/dist` is absent. |
| `mineru-batch-api.service`, `mineru-batch.service` *(moved, modified)* | Generic unit templates; site values come from the environment file. |
| `dev-requirements.txt` *(new)* | `pytest`. |
| `tests/conftest.py` *(new)* | Temp-root fixture and `TestClient`. |
| `tests/test_paths.py` *(new)* | `_safe_relative` / `_resolve_within` — the security boundary. |
| `tests/test_documents.py` *(new)* | The `/api/documents` merge. |
| `tests/test_content.py` *(new)* | `/api/results/content`. |
| `tests/test_delete.py` *(new)* | `/api/documents/delete`. |
| `tests/test_upload.py` *(new)* | `/api/upload` limits and path preservation. |
| `tests/test_settings_records.py` *(new)* | The config records in `/api/status`. |
| `batch_webui/src/api/{client,mineru,types}.ts` *(new)* | HTTP client and shared types. |
| `batch_webui/src/lib/{buckets,uploadChain,figures}.ts` *(new)* | Pure logic; the tested core. |
| `batch_webui/src/hooks/useBatchApi.ts` *(new)* | Polling and mutations. |
| `batch_webui/src/components/*.tsx` *(new)* | Presentation. |

---

# Phase 1 — Repository and backend

### Task 1: Move the batch tooling into this repository

**Files:**
- Move: `batch_api.py`, `batch-convert.py`, `batch_ui.html`, `mineru-batch-api.service`, `mineru-batch.service` from the MinerU working directory into `$REPO/`
- Create: `README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a repository whose root contains `batch_api.py`; every later task assumes this layout.

- [ ] **Step 1: Move the files**

```bash
export OLD=<the directory the batch tooling currently lives in>
mv "$OLD/batch_api.py" "$OLD/batch-convert.py" "$OLD/batch_ui.html" \
   "$OLD/mineru-batch-api.service" "$OLD/mineru-batch.service" "$REPO/"
ls "$REPO"
```

Expected: all five files listed alongside `docs/`.

- [ ] **Step 2: Verify the module still imports and resolves its own directory**

```bash
cd "$REPO" && "$PY" -c "
import batch_api
print('BASE =', batch_api.BASE)
assert str(batch_api.BASE) == '$REPO', batch_api.BASE
print('routes =', len(batch_api.app.routes))
"
```

Expected: `BASE` equals the repository root; `routes` prints a positive number.

- [ ] **Step 3: Write `README.md`**

```markdown
# mineru-batch

A batch conversion console for [MinerU](https://github.com/opendatalab/MinerU):
upload documents, convert a tree to mirrored Markdown, download the results.

- `batch_api.py` — FastAPI control plane (upload, run, status, results)
- `batch-convert.py` — the conversion engine (unchanged by the console)
- `batch_webui/` — the browser console
- `docs/superpowers/` — design and plan

Storage defaults to `$MINERU_HOME/batch` (`ee-in/` → `ee-md/`).
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: move batch tooling into its own repository"
```

---

### Task 2: Test harness and the path-safety suite

**Files:**
- Create: `dev-requirements.txt`, `tests/conftest.py`, `tests/test_paths.py`

**Interfaces:**
- Consumes: `batch_api.py`'s existing `_safe_relative(relative: str) -> PurePosixPath` and `_resolve_within(root: Path, relative: str) -> Path`.
- Produces: the `api` fixture every later backend test uses — `def api(tmp_path, monkeypatch) -> Iterator[TestClient]` — and the `reset_settings()` contract Task 3 implements.

- [ ] **Step 1: Install pytest into the MinerU virtualenv**

```bash
echo "pytest" > "$REPO/dev-requirements.txt"
uv pip install --python "$PY" -r "$REPO/dev-requirements.txt"
"$PY" -m pytest --version
```

Expected: a pytest version is printed.

- [ ] **Step 2: Write the failing test**

Create `tests/test_paths.py`:

```python
"""The path guard is the security boundary for uploads, downloads and deletes."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi import HTTPException

import batch_api


@pytest.mark.parametrize(
    "relative",
    [
        "/etc/passwd",
        "C:/Windows/system32",
        "../outside.md",
        "a/../../outside.md",
        "nested/../../outside.md",
        "",
        "   ",
        "null\x00byte.md",
    ],
)
def test_safe_relative_refuses_escaping_paths(relative: str) -> None:
    with pytest.raises(HTTPException) as caught:
        batch_api._safe_relative(relative)
    assert caught.value.status_code == 400


def test_safe_relative_accepts_nested_relative_paths() -> None:
    assert batch_api._safe_relative("a/b/c.pdf").as_posix() == "a/b/c.pdf"


def test_resolve_within_refuses_symlink_escape(tmp_path: Path) -> None:
    root = tmp_path / "root"
    root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.md").write_text("secret", encoding="utf-8")
    os.symlink(outside, root / "link")

    with pytest.raises(HTTPException) as caught:
        batch_api._resolve_within(root, "link/secret.md")
    assert caught.value.status_code == 400


def test_resolve_within_stays_inside_root(tmp_path: Path) -> None:
    root = tmp_path / "root"
    (root / "sub").mkdir(parents=True)
    resolved = batch_api._resolve_within(root, "sub/file.md")
    assert resolved == (root / "sub" / "file.md").resolve()
```

Create `tests/conftest.py`:

```python
"""Shared fixtures: every test runs against a temporary batch root."""

from __future__ import annotations

import sys
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))


@pytest.fixture()
def api(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    """A TestClient whose storage root is a fresh temporary directory."""
    monkeypatch.setenv("MINERU_BATCH_ROOT", str(tmp_path))
    monkeypatch.setenv("MINERU_BATCH_TOKEN", "")
    import batch_settings
    import batch_api

    batch_settings.reset_settings()
    batch_api.state = batch_api.RunState()
    with TestClient(batch_api.app) as client:
        yield client
    batch_settings.reset_settings()
```

- [ ] **Step 3: Run the tests to verify the fixture fails**

Run: `cd "$REPO" && "$PY" -m pytest tests -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'batch_settings'`.

- [ ] **Step 4: Create the minimal `batch_settings.py` so the fixture imports**

Create `batch_settings.py` (full implementation arrives in Task 3):

```python
"""Environment-resolved paths and parameters for the batch control plane."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

BASE = Path(__file__).resolve().parent


@dataclass(frozen=True)
class BatchSettings:
    root: Path


_settings: BatchSettings | None = None


def get_settings() -> BatchSettings:
    global _settings
    if _settings is None:
        _settings = BatchSettings(root=Path("/tmp/mineru-batch-placeholder"))
    return _settings


def reset_settings() -> None:
    global _settings
    _settings = None
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd "$REPO" && "$PY" -m pytest tests -v`
Expected: 12 passed (8 parametrised refusals + 4 others).

- [ ] **Step 6: Commit**

```bash
git add dev-requirements.txt tests batch_settings.py
git commit -m "test: add pytest harness and the path-safety suite"
```

---

### Task 3: Settings module and the path refactor

**Files:**
- Modify: `batch_settings.py` (replace the placeholder entirely)
- Modify: `batch_api.py` (replace every module-level path/parameter constant with a `get_settings()` call)
- Test: `tests/test_settings.py` (create)

**Interfaces:**
- Consumes: `batch_api._safe_relative`, `batch_api._resolve_within`.
- Produces: `BatchSettings` with fields `root, input_dir, output_dir, runner, report, lock_path, run_log, ui_dist, ui_fallback, tier, image_mode, host, port, token, max_upload_bytes`; `BatchSettings.from_env(base: Path = BASE) -> BatchSettings`; `get_settings() -> BatchSettings`; `reset_settings(value: BatchSettings | None = None) -> None`. Every later task calls `get_settings()` inside functions and never at import time.

- [ ] **Step 1: Write the failing test**

Create `tests/test_settings.py`:

```python
"""Paths and parameters must come from the environment, resolved per call."""

from __future__ import annotations

from pathlib import Path

import batch_settings
from batch_settings import BatchSettings


def test_root_defaults_to_mineru_home_batch(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("MINERU_HOME", str(tmp_path / "home"))
    monkeypatch.delenv("MINERU_BATCH_ROOT", raising=False)
    assert BatchSettings.from_env().root == tmp_path / "home" / "batch"


def test_explicit_root_wins_over_mineru_home(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("MINERU_HOME", str(tmp_path / "home"))
    monkeypatch.setenv("MINERU_BATCH_ROOT", str(tmp_path / "explicit"))
    assert BatchSettings.from_env().root == tmp_path / "explicit"


def test_derived_paths_hang_off_the_root(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("MINERU_BATCH_ROOT", str(tmp_path))
    settings = BatchSettings.from_env()
    assert settings.input_dir == tmp_path / "ee-in"
    assert settings.output_dir == tmp_path / "ee-md"
    assert settings.report == tmp_path / "ee-md" / "run-report.json"
    assert settings.lock_path == tmp_path / ".run.lock"
    assert settings.run_log == tmp_path / "run.log"


def test_parameter_defaults(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("MINERU_BATCH_ROOT", str(tmp_path))
    for name in ("MINERU_BATCH_TIER", "MINERU_BATCH_IMAGE_MODE", "MINERU_BATCH_PORT", "MINERU_BATCH_HOST"):
        monkeypatch.delenv(name, raising=False)
    settings = BatchSettings.from_env()
    assert settings.tier == "basic"
    assert settings.image_mode == "marker"
    assert settings.port == 8090
    assert settings.host == "0.0.0.0"
    assert settings.max_upload_bytes == 524288000
    assert settings.token == ""


def test_reset_settings_clears_the_cache(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("MINERU_BATCH_ROOT", str(tmp_path / "first"))
    batch_settings.reset_settings()
    assert batch_settings.get_settings().root == tmp_path / "first"
    monkeypatch.setenv("MINERU_BATCH_ROOT", str(tmp_path / "second"))
    batch_settings.reset_settings()
    assert batch_settings.get_settings().root == tmp_path / "second"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd "$REPO" && "$PY" -m pytest tests/test_settings.py -v`
Expected: FAIL — `TypeError` on `BatchSettings(...)`, which currently takes only `root`.

- [ ] **Step 3: Write the full settings module**

Replace `batch_settings.py` with:

```python
"""Environment-resolved paths and parameters for the batch control plane.

Paths are built from the environment on first use and cached, but always through
a replaceable module-global, so tests can point the whole service at a temporary
tree instead of the real one. Nothing here may be read at import time: an import
must be safe under an environment that is still being set up.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

BASE = Path(__file__).resolve().parent

DEFAULT_TIER = "basic"
DEFAULT_IMAGE_MODE = "marker"
DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 8090
DEFAULT_MAX_UPLOAD_BYTES = 500 * 1024 * 1024


def default_root() -> Path:
    """The batch tree's home: $MINERU_HOME/batch, matching where MinerU keeps its state."""
    home = os.environ.get("MINERU_HOME") or os.path.join(os.path.expanduser("~"), ".mineru")
    return Path(home).expanduser() / "batch"


def _env(name: str, fallback: str) -> str:
    value = os.environ.get(name)
    return fallback if value in (None, "") else value


@dataclass(frozen=True)
class BatchSettings:
    """Everything the control plane reads from its environment, resolved once."""

    root: Path
    input_dir: Path
    output_dir: Path
    runner: Path
    report: Path
    lock_path: Path
    run_log: Path
    ui_dist: Path
    ui_fallback: Path
    tier: str
    image_mode: str
    host: str
    port: int
    token: str
    max_upload_bytes: int

    @classmethod
    def from_env(cls, base: Path = BASE) -> "BatchSettings":
        root = Path(_env("MINERU_BATCH_ROOT", str(default_root()))).expanduser()
        output_dir = root / "ee-md"
        return cls(
            root=root,
            input_dir=root / "ee-in",
            output_dir=output_dir,
            runner=Path(_env("MINERU_BATCH_RUNNER", str(base / "batch-convert.py"))),
            report=output_dir / "run-report.json",
            lock_path=root / ".run.lock",
            run_log=root / "run.log",
            ui_dist=base / "batch_webui" / "dist",
            ui_fallback=base / "batch_ui.html",
            tier=_env("MINERU_BATCH_TIER", DEFAULT_TIER),
            image_mode=_env("MINERU_BATCH_IMAGE_MODE", DEFAULT_IMAGE_MODE),
            host=_env("MINERU_BATCH_HOST", DEFAULT_HOST),
            port=int(_env("MINERU_BATCH_PORT", str(DEFAULT_PORT))),
            token=os.environ.get("MINERU_BATCH_TOKEN", ""),
            max_upload_bytes=int(_env("MINERU_BATCH_MAX_UPLOAD_BYTES", str(DEFAULT_MAX_UPLOAD_BYTES))),
        )


_settings: BatchSettings | None = None


def get_settings() -> BatchSettings:
    """The process settings, built on first call."""
    global _settings
    if _settings is None:
        _settings = BatchSettings.from_env()
    return _settings


def reset_settings(value: BatchSettings | None = None) -> None:
    """Rebuild the settings (or pin them to `value`). Tests call this between cases."""
    global _settings
    _settings = value
```

- [ ] **Step 4: Run the settings tests**

Run: `cd "$REPO" && "$PY" -m pytest tests/test_settings.py -v`
Expected: 5 passed.

- [ ] **Step 5: Refactor `batch_api.py` off module-level constants**

Delete the module-level block that defines `BASE, ROOT, INPUT_DIR, OUTPUT_DIR, RUNNER, REPORT, LOCK_PATH, UI_PATH, TIER, IMAGE_MODE, PORT, HOST, TOKEN, MAX_UPLOAD_BYTES, RUN_LOG` and add at the top of the imports:

```python
from batch_settings import get_settings
```

Then, in **every function that used those names**, add `settings = get_settings()` as its first statement and rewrite the references:

| Old constant | New reference |
|---|---|
| `ROOT` | `settings.root` |
| `INPUT_DIR` | `settings.input_dir` |
| `OUTPUT_DIR` | `settings.output_dir` |
| `RUNNER` | `settings.runner` |
| `REPORT` | `settings.report` |
| `LOCK_PATH` | `settings.lock_path` |
| `UI_PATH` | `settings.ui_fallback` |
| `TIER` | `settings.tier` |
| `IMAGE_MODE` | `settings.image_mode` |
| `PORT` | `settings.port` |
| `HOST` | `settings.host` |
| `TOKEN` | `settings.token` |
| `MAX_UPLOAD_BYTES` | `settings.max_upload_bytes` |
| `RUN_LOG` | `settings.run_log` |

Note `_resolve_within(root, relative)` already takes the root as an argument — pass `settings.input_dir` or `settings.output_dir` at each call site. `_safe_relative` is unaffected.

Also change `_input_documents()` to `_input_documents(settings)`, replacing its internal `INPUT_DIR` with `settings.input_dir`, and update its three callers: `api_start`, the `lifespan` adoption loop, and the `queued_in_input` field in `api_status`.

- [ ] **Step 6: Verify nothing was missed**

```bash
cd "$REPO" && ! grep -nE "^\s*(ROOT|INPUT_DIR|OUTPUT_DIR|RUNNER|REPORT|LOCK_PATH|UI_PATH|TIER|IMAGE_MODE|PORT|HOST|TOKEN|MAX_UPLOAD_BYTES|RUN_LOG)\s*=" batch_api.py \
  && "$PY" -c "import batch_api; print('module imports clean')"
```

Expected: `module imports clean` with no preceding grep output.

- [ ] **Step 7: Run the whole suite**

Run: `cd "$REPO" && "$PY" -m pytest tests -v`
Expected: 17 passed.

- [ ] **Step 8: Commit**

```bash
git add batch_settings.py batch_api.py tests/test_settings.py
git commit -m "refactor: resolve batch paths and parameters through a settings object"
```

---

### Task 4: `GET /api/documents` — the merged document table

**Files:**
- Modify: `batch_api.py` (add helpers and the route)
- Test: `tests/test_documents.py`

**Interfaces:**
- Consumes: `get_settings()`; the module-global `state: RunState` with `state.state`, `state.files`; `_input_documents() -> list[str]`.
- Produces: `GET /api/documents` returning
  `{"state": str, "counts": {str: int}, "files": [DocRow]}` where
  `DocRow = {path: str, status: str, pages: int|None, seconds: float|None, rate: float|None, bytes: int|None, error: str|None, has_input: bool, has_result: bool}`
  and `status ∈ {pending, queued, running, done, skipped, failed, converted}`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_documents.py`:

```python
"""The merged view is the console's only source of document state."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient


def _write_result(root: Path, relative: str, text: str = "# hi") -> Path:
    target = root / "ee-md" / relative
    target = target.with_suffix(".md")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")
    return target


def _write_input(root: Path, relative: str) -> Path:
    target = root / "ee-in" / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("pdf", encoding="utf-8")
    return target


def test_pending_when_only_the_input_exists(api: TestClient, tmp_path: Path) -> None:
    _write_input(tmp_path, "a.pdf")
    rows = {row["path"]: row for row in api.get("/api/documents").json()["files"]}
    assert rows["a.pdf"]["status"] == "pending"
    assert rows["a.pdf"]["has_input"] is True
    assert rows["a.pdf"]["has_result"] is False


def test_converted_when_only_the_result_exists(api: TestClient, tmp_path: Path) -> None:
    """A cleared input tree must not turn a converted document back into 'pending'."""
    _write_result(tmp_path, "a.pdf")
    rows = {row["path"]: row for row in api.get("/api/documents").json()["files"]}
    assert rows["a.pdf"]["status"] == "converted"
    assert rows["a.pdf"]["has_input"] is False
    assert rows["a.pdf"]["has_result"] is True


def test_report_metadata_is_joined(api: TestClient, tmp_path: Path) -> None:
    result = _write_result(tmp_path, "a.pdf")
    report = tmp_path / "ee-md" / "run-report.json"
    report.write_text(
        json.dumps(
            {
                "entries": [
                    {
                        "input": str(tmp_path / "ee-in" / "a.pdf"),
                        "output": str(result),
                        "status": "done",
                        "tier": "basic",
                        "seconds": 1.5,
                        "pages": 3,
                        "error": None,
                        "code": None,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    rows = {row["path"]: row for row in api.get("/api/documents").json()["files"]}
    assert rows["a.pdf"]["pages"] == 3
    assert rows["a.pdf"]["seconds"] == 1.5
    assert rows["a.pdf"]["bytes"] == result.stat().st_size


def test_live_run_state_wins_over_filesystem(api: TestClient, tmp_path: Path) -> None:
    import batch_api

    _write_input(tmp_path, "a.pdf")
    batch_api.state.state = "running"
    batch_api.state.row("a.pdf").update(status="running")
    rows = {row["path"]: row for row in api.get("/api/documents").json()["files"]}
    assert rows["a.pdf"]["status"] == "running"


def test_same_basename_in_different_directories_stays_distinct(api: TestClient, tmp_path: Path) -> None:
    _write_result(tmp_path, "a/report.pdf")
    _write_result(tmp_path, "b/report.pdf")
    paths = {row["path"] for row in api.get("/api/documents").json()["files"]}
    assert paths == {"a/report.md", "b/report.md"}


def test_counts_match_the_rows(api: TestClient, tmp_path: Path) -> None:
    _write_input(tmp_path, "a.pdf")
    _write_result(tmp_path, "b.pdf")
    payload = api.get("/api/documents").json()
    assert payload["counts"]["pending"] == 1
    assert payload["counts"]["converted"] == 1
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd "$REPO" && "$PY" -m pytest tests/test_documents.py -v`
Expected: FAIL — 404 for `/api/documents`.

- [ ] **Step 3: Write the merge and the route**

Add to `batch_api.py`, after `_input_documents`:

```python
def _result_index(settings: Any) -> dict[str, dict[str, Any]]:
    """Converted documents keyed by the input-relative path, joined with the run report.

    The key is the *input* relative path with its suffix replaced, because that is
    what a row is named by; the on-disk file is `.md`.
    """
    metadata: dict[str, dict[str, Any]] = {}
    if settings.report.is_file():
        try:
            for entry in json.loads(settings.report.read_text(encoding="utf-8")).get("entries", []):
                output = Path(entry.get("output", ""))
                try:
                    key = output.relative_to(settings.output_dir).as_posix()
                except ValueError:
                    continue
                metadata[key] = entry
        except (OSError, ValueError):
            pass

    results: dict[str, dict[str, Any]] = {}
    if not settings.output_dir.is_dir():
        return results
    for path in settings.output_dir.rglob("*.md"):
        if not path.is_file():
            continue
        key = path.relative_to(settings.output_dir).as_posix()
        info = metadata.get(key, {})
        results[key] = {
            "bytes": path.stat().st_size,
            "pages": info.get("pages"),
            "seconds": info.get("seconds"),
            "error": info.get("error"),
        }
    return results


def _document_rows(settings: Any) -> list[dict[str, Any]]:
    """One row per document, merged from the live run, the results tree, and ee-in."""
    results = _result_index(settings)
    inputs = set(_input_documents(settings))
    rows: dict[str, dict[str, Any]] = {}

    def blank(path: str) -> dict[str, Any]:
        return {
            "path": path,
            "status": "pending",
            "pages": None,
            "seconds": None,
            "rate": None,
            "bytes": None,
            "error": None,
            "has_input": False,
            "has_result": False,
        }

    for relative in inputs:
        rows[relative] = blank(relative)
        rows[relative]["has_input"] = True

    for relative, info in results.items():
        # A result is named "<stem>.md"; the input is "<stem>.<original suffix>", so the
        # row key is the result path — the console shows one row per converted document.
        row = rows.setdefault(relative, blank(relative))
        row["has_result"] = True
        row["bytes"] = info["bytes"]
        if row["status"] == "pending":
            row["status"] = "converted"
        if info["pages"] is not None:
            row["pages"] = info["pages"]
        if info["seconds"] is not None:
            row["seconds"] = info["seconds"]
            if info["pages"]:
                row["rate"] = round(info["pages"] / info["seconds"], 2)

    if state.state == "running":
        for relative, live in state.files.items():
            row = rows.setdefault(relative, blank(relative))
            row.update({k: v for k, v in live.items() if k != "name"})

    return sorted(rows.values(), key=lambda row: row["path"])
```

Then register the route next to `/api/status`:

```python
@app.get("/api/documents")
async def api_documents() -> dict[str, Any]:
    """Every document, merged from the live run, ee-md and ee-in."""
    settings = get_settings()
    rows = _document_rows(settings)
    counts: dict[str, int] = {}
    for row in rows:
        counts[row["status"]] = counts.get(row["status"], 0) + 1
    return {"state": state.state, "counts": counts, "files": rows}
```

> **Note for the implementer:** `_input_documents()` currently takes no arguments and reads the module constants. In Step 5 of Task 3 those became `settings` lookups — give it the signature `_input_documents(settings: Any) -> list[str]` and update its one existing caller (`api_start`) and the `lifespan` adoption loop. `Path` and `json` are already imported in `batch_api.py`.

- [ ] **Step 4: Run the tests**

Run: `cd "$REPO" && "$PY" -m pytest tests/test_documents.py -v`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add batch_api.py tests/test_documents.py
git commit -m "feat: add GET /api/documents merging run state, results and inputs"
```

---

### Task 5: `GET /api/results/content` and the static console mount

**Files:**
- Modify: `batch_api.py` (add the content route; replace the `GET /` handler and mount the built SPA)
- Test: `tests/test_content.py`

**Interfaces:**
- Consumes: `get_settings()`, `_resolve_within(root, relative)`.
- Produces: `GET /api/results/content?path=<relative>` → `text/markdown` body (no `Content-Disposition`); `GET /` → the built SPA when `settings.ui_dist/index.html` exists, else `batch_ui.html`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_content.py`:

```python
"""Content is served inline for the preview; download stays a download."""

from __future__ import annotations

import io
import zipfile
from pathlib import Path
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient


def _write_result(root: Path, relative: str, text: str) -> Path:
    target = (root / "ee-md" / relative).with_suffix(".md")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")
    return target


def test_content_returns_markdown_inline(api: TestClient, tmp_path: Path) -> None:
    _write_result(tmp_path, "a.pdf", "# Title\n\nbody")
    response = api.get("/api/results/content", params={"path": "a.md"})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/markdown")
    assert "attachment" not in response.headers.get("content-disposition", "")
    assert response.text == "# Title\n\nbody"


def test_content_404_for_missing(api: TestClient) -> None:
    assert api.get("/api/results/content", params={"path": "nope.md"}).status_code == 404


def test_content_refuses_traversal(api: TestClient) -> None:
    assert api.get("/api/results/content", params={"path": "../batch_api.py"}).status_code == 400


def test_content_refuses_non_markdown(api: TestClient, tmp_path: Path) -> None:
    target = tmp_path / "ee-md" / "a.pdf"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("x", encoding="utf-8")
    assert api.get("/api/results/content", params={"path": "a.pdf"}).status_code == 404


@pytest.mark.parametrize("name", ["a b.md", "q?x.md", "hash#x.md", "plus+x.md", "caf\u00e9.md"])
def test_content_round_trips_awkward_names(api: TestClient, tmp_path: Path, name: str) -> None:
    _write_result(tmp_path, name, "# ok")
    response = api.get("/api/results/content", params={"path": quote(name)})
    assert response.status_code == 200
    assert response.text == "# ok"


@pytest.mark.parametrize("name", ["a b.md", "q?x.md", "hash#x.md", "caf\u00e9.md"])
def test_download_round_trips_the_same_names(api: TestClient, tmp_path: Path, name: str) -> None:
    """The download route shares the guard, so it must agree with content on odd names."""
    _write_result(tmp_path, name, "# ok")
    response = api.get("/api/results/download", params={"path": quote(name)})
    assert response.status_code == 200
    assert response.text == "# ok"


def test_root_serves_the_fallback_when_no_build_exists(api: TestClient) -> None:
    """dist/ is gitignored, so an unbuilt deploy must degrade, not 500."""
    response = api.get("/")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]


def test_zip_preserves_relative_paths(api: TestClient, tmp_path: Path) -> None:
    """Bulk download keeps the mirrored tree, and survives awkward names, inside the archive."""
    _write_result(tmp_path, "papers/a b.pdf", "# ok")
    response = api.post("/api/results/zip", json={"paths": ["papers/a b.md"]})
    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert archive.namelist() == ["papers/a b.md"]
        assert archive.read("papers/a b.md").decode() == "# ok"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd "$REPO" && "$PY" -m pytest tests/test_content.py -v`
Expected: FAIL — 404 for `/api/results/content`.

- [ ] **Step 3: Add the content route**

```python
@app.get("/api/results/content")
async def api_result_content(path: str) -> Response:
    """One converted document, inline, for in-app preview."""
    settings = get_settings()
    target = _resolve_within(settings.output_dir, path)
    if target.suffix.lower() != ".md" or not target.is_file():
        raise HTTPException(status_code=404, detail=f"not a converted markdown file: {path}")
    return Response(content=target.read_text(encoding="utf-8"), media_type="text/markdown; charset=utf-8")
```

- [ ] **Step 4: Replace the `GET /` handler with the SPA mount**

Replace the existing `@app.get("/")` handler with:

```python
@app.get("/")
async def index() -> FileResponse:
    """Serve the built console; fall back to the single-file UI when it is absent."""
    settings = get_settings()
    built = settings.ui_dist / "index.html"
    if built.is_file():
        return FileResponse(built, media_type="text/html")
    if not settings.ui_fallback.is_file():
        raise HTTPException(status_code=500, detail="no console build and no fallback UI")
    return FileResponse(settings.ui_fallback, media_type="text/html")
```

Add at the end of `batch_api.py`, after the last route and before `main()`:

```python
def _mount_console(application: FastAPI) -> None:
    """Mount built assets under `/`, last, so `/api/*` routes keep precedence."""
    settings = get_settings()
    assets = settings.ui_dist / "assets"
    if assets.is_dir():
        application.mount("/assets", StaticFiles(directory=assets), name="assets")


_mount_console(app)
```

Extend the FastAPI imports with `StaticFiles`:

```python
from fastapi.staticfiles import StaticFiles
```

> Serving only `/assets` (not `/`) keeps this compatible with the fallback path and avoids a catch-all mount shadowing future routes. `index.html` is served by the `GET /` handler above.

- [ ] **Step 5: Run the tests**

Run: `cd "$REPO" && "$PY" -m pytest tests/test_content.py -v`
Expected: 15 passed.

- [ ] **Step 6: Commit**

```bash
git add batch_api.py tests/test_content.py
git commit -m "feat: serve converted markdown inline and mount the console build"
```

---

### Task 6: `POST /api/documents/delete`

**Files:**
- Modify: `batch_api.py`
- Test: `tests/test_delete.py`

**Interfaces:**
- Consumes: `get_settings()`, `_resolve_within`, `state.state`.
- Produces: `POST /api/documents/delete` with body `{"paths": [str], "delete_result": bool = true}` →
  `{"deleted": [{"path": str, "input": bool, "result": bool}], "missing": [str]}`; **409** when `state.state == "running"`; **400** on an unsafe path.

- [ ] **Step 1: Write the failing test**

Create `tests/test_delete.py`:

```python
"""Deleting a document removes its input and, by default, its result."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient


def _seed(root: Path, relative: str) -> tuple[Path, Path]:
    source = root / "ee-in" / relative
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_text("pdf", encoding="utf-8")
    result = (root / "ee-md" / relative).with_suffix(".md")
    result.parent.mkdir(parents=True, exist_ok=True)
    result.write_text("# hi", encoding="utf-8")
    return source, result


def test_delete_removes_input_and_result(api: TestClient, tmp_path: Path) -> None:
    source, result = _seed(tmp_path, "a.pdf")
    response = api.post("/api/documents/delete", json={"paths": ["a.md"]})
    assert response.status_code == 200
    assert not source.exists()
    assert not result.exists()
    assert response.json()["deleted"] == [{"path": "a.md", "input": True, "result": True}]


def test_delete_result_for_a_missing_input_still_works(api: TestClient, tmp_path: Path) -> None:
    _, result = _seed(tmp_path, "a.pdf")
    (tmp_path / "ee-in" / "a.pdf").unlink()
    response = api.post("/api/documents/delete", json={"paths": ["a.md"]})
    assert response.status_code == 200
    assert not result.exists()
    assert response.json()["deleted"][0]["input"] is False


def test_delete_can_keep_the_result(api: TestClient, tmp_path: Path) -> None:
    source, result = _seed(tmp_path, "a.pdf")
    response = api.post("/api/documents/delete", json={"paths": ["a.md"], "delete_result": False})
    assert response.status_code == 200
    assert not source.exists()
    assert result.exists()


def test_delete_refuses_while_running(api: TestClient, tmp_path: Path) -> None:
    import batch_api

    _seed(tmp_path, "a.pdf")
    batch_api.state.state = "running"
    response = api.post("/api/documents/delete", json={"paths": ["a.md"]})
    assert response.status_code == 409


def test_delete_refuses_traversal(api: TestClient) -> None:
    response = api.post("/api/documents/delete", json={"paths": ["../batch_api.py"]})
    assert response.status_code == 400


def test_delete_reports_missing_without_failing_the_batch(api: TestClient, tmp_path: Path) -> None:
    _seed(tmp_path, "a.pdf")
    response = api.post("/api/documents/delete", json={"paths": ["a.md", "gone.md"]})
    assert response.status_code == 200
    assert response.json()["missing"] == ["gone.md"]
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd "$REPO" && "$PY" -m pytest tests/test_delete.py -v`
Expected: FAIL — 404 for `/api/documents/delete`.

- [ ] **Step 3: Add the route**

```python
@app.post("/api/documents/delete")
async def api_delete_documents(request: Request) -> dict[str, Any]:
    """Remove selected documents: the input, and by default the converted result too.

    Refused entirely while a run is active, for the same reason /api/clear is: the runner's
    progress is derived from the queue it built at start, and mutating the tree underneath
    it would make "currently running" ambiguous.
    """
    settings = get_settings()
    if state.state == "running":
        raise HTTPException(status_code=409, detail="refusing to delete documents while a run is in progress")

    body = await request.json()
    paths = body.get("paths") if isinstance(body, dict) else None
    if not isinstance(paths, list) or not paths:
        raise HTTPException(status_code=400, detail="provide a non-empty list of paths")
    delete_result = bool(body.get("delete_result", True)) if isinstance(body, dict) else True

    deleted: list[dict[str, Any]] = []
    missing: list[str] = []
    for raw in paths:
        relative = str(raw)
        # Validate against both roots before touching anything: an unsafe path fails the
        # request rather than being skipped, because it means the caller is confused.
        result_target = _resolve_within(settings.output_dir, relative)
        input_target = _resolve_within(settings.input_dir, str(PurePosixPath(relative).with_suffix("")) + _input_suffix(settings, relative))

        removed_input = False
        removed_result = False
        if delete_result and result_target.is_file():
            result_target.unlink()
            removed_result = True
        if input_target.is_file():
            input_target.unlink()
            removed_input = True
        if removed_input or removed_result:
            deleted.append({"path": relative, "input": removed_input, "result": removed_result})
        else:
            missing.append(relative)

    return {"deleted": deleted, "missing": missing}
```

Add this helper next to `_input_documents`:

```python
def _input_suffix(settings: Any, result_relative: str) -> str:
    """The original suffix of the input that produced `result_relative`, or "" if unknown.

    A row is named after its result (`a.md`), but the input keeps its original extension
    (`a.pdf`). The run report is the only place that mapping exists; when it is missing we
    fall back to matching any input whose stem matches.
    """
    stem = PurePosixPath(result_relative).with_suffix("").as_posix()
    for relative in _input_documents(settings):
        if PurePosixPath(relative).with_suffix("").as_posix() == stem:
            return Path(relative).suffix
    return ""
```

- [ ] **Step 4: Run the tests**

Run: `cd "$REPO" && "$PY" -m pytest tests/test_delete.py -v`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add batch_api.py tests/test_delete.py
git commit -m "feat: add POST /api/documents/delete"
```

---

### Task 7: Server parameter records

**Files:**
- Modify: `batch_api.py` (extend `/api/status`)
- Test: `tests/test_settings_records.py`

**Interfaces:**
- Consumes: `get_settings()`; `mineru.config.config`, `mineru.config.get_config_source`, `mineru.config.get_config_file_path`, `mineru.config.get_config_file_exists`; `mineru.model.runtime.device.get_device`, `resolve_small_model_backend`.
- Produces: `GET /api/status` gains `config.records: [ConfigRecord]` where
  `ConfigRecord = {key: str, label: str, value: str|int|bool|None, source: str, env_var: str|None, config_file: str|None, effect: str}` and `effect ∈ {restart, next_run, read_only}`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_settings_records.py`:

```python
"""The settings panel renders whatever the server declares, so records must be complete."""

from __future__ import annotations

from fastapi.testclient import TestClient

REQUIRED_KEYS = {"key", "label", "value", "source", "env_var", "config_file", "effect"}
VALID_EFFECTS = {"restart", "next_run", "read_only"}


def _records(api: TestClient) -> dict[str, dict]:
    payload = api.get("/api/status").json()
    return {record["key"]: record for record in payload["config"]["records"]}


def test_service_parameters_are_declared(api: TestClient) -> None:
    records = _records(api)
    for key in ("tier", "image_mode", "host", "port", "root", "max_upload_bytes", "token_required"):
        assert key in records, key
        assert REQUIRED_KEYS <= set(records[key])
        assert records[key]["effect"] == "restart"


def test_tier_and_image_mode_report_live_values(api: TestClient) -> None:
    records = _records(api)
    assert records["tier"]["value"] == "basic"
    assert records["image_mode"]["value"] == "marker"


def test_mineru_parameters_declare_their_source_and_knob(api: TestClient) -> None:
    records = _records(api)
    for key in ("small_backend", "vlm_engine"):
        record = records[key]
        assert record["effect"] == "next_run"
        assert record["source"] in {"default", "file", "env"}
        assert record["env_var"].startswith("MINERU_")
        assert record["config_file"] is None or record["config_file"]


def test_token_value_is_never_exposed(api: TestClient, monkeypatch) -> None:
    monkeypatch.setenv("MINERU_BATCH_TOKEN", "super-secret")
    import batch_settings
    import batch_api
    from fastapi.testclient import TestClient as Client

    batch_settings.reset_settings()
    batch_api.state = batch_api.RunState()
    with Client(batch_api.app) as client:
        body = client.get("/api/status").text
    assert "super-secret" not in body
    batch_settings.reset_settings()


def test_environment_facts_are_present(api: TestClient) -> None:
    config = api.get("/api/status").json()["config"]
    assert config["environment"]["mineru_version"]
    assert config["environment"]["device"]
    assert config["environment"]["resolved_small_backend"] in {"onnx", "torch"}
    assert config["disk"]["free"] is not None
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd "$REPO" && "$PY" -m pytest tests/test_settings_records.py -v`
Expected: FAIL — `KeyError: 'records'`.

- [ ] **Step 3: Write the records builder**

Add to `batch_api.py`:

```python
def _config_records(settings: Any) -> list[dict[str, Any]]:
    """Server-declared parameters: value, where it came from, and how to change it.

    Each record carries enough for the console to explain the change without hard-coding
    any knowledge of this service, so the UI cannot drift from the server.
    """
    import mineru.config as mineru_config
    from mineru.model.runtime.device import get_device, resolve_small_model_backend

    def record(
        key: str,
        label: str,
        value: Any,
        *,
        env_var: str | None = None,
        source: str = "env",
        config_file: str | None = None,
        effect: str = "restart",
    ) -> dict[str, Any]:
        return {
            "key": key,
            "label": label,
            "value": value,
            "source": source,
            "env_var": env_var,
            "config_file": config_file,
            "effect": effect,
        }

    config_path = mineru_config.get_config_file_path() if mineru_config.get_config_file_exists() else None

    def mineru_record(key: str, label: str, path: str, env_var: str, value: Any) -> dict[str, Any]:
        return record(
            key,
            label,
            value,
            env_var=env_var,
            source=mineru_config.get_config_source(path),
            config_file=config_path,
            effect="next_run",
        )

    model_config = mineru_config.config.model
    resolved_backend = resolve_small_model_backend(model_config.small_backend)

    return [
        record("tier", "Parse tier", settings.tier, env_var="MINERU_BATCH_TIER"),
        record("image_mode", "Image mode", settings.image_mode, env_var="MINERU_BATCH_IMAGE_MODE"),
        record("host", "Bind host", settings.host, env_var="MINERU_BATCH_HOST"),
        record("port", "Bind port", settings.port, env_var="MINERU_BATCH_PORT"),
        record("root", "Storage root", str(settings.root), env_var="MINERU_BATCH_ROOT"),
        record("max_upload_bytes", "Max upload bytes", settings.max_upload_bytes, env_var="MINERU_BATCH_MAX_UPLOAD_BYTES"),
        record("token_required", "Authentication", bool(settings.token), env_var="MINERU_BATCH_TOKEN"),
        mineru_record("small_backend", "Small model backend", "model.small_backend", "MINERU_MODEL_SMALL_BACKEND", resolved_backend),
        mineru_record("vlm_engine", "VLM engine", "model.vlm.engine", "MINERU_MODEL_VLM_ENGINE", model_config.vlm.engine),
        record("mineru_home", "MinerU home", os.environ.get("MINERU_HOME", str(Path.home() / ".mineru")), env_var="MINERU_HOME"),
        record("device", "Device", get_device(), env_var="MINERU_DEVICE_MODE", effect="read_only"),
    ]
```

- [ ] **Step 4: Extend `/api/status`**

Replace the `payload["config"] = {...}` block with:

```python
    settings = get_settings()
    records = _config_records(settings)
    by_key = {record["key"]: record["value"] for record in records}
    usage = shutil.disk_usage(settings.root if settings.root.exists() else settings.root.parent)
    payload["config"] = {
        "records": records,
        "input_dir": str(settings.input_dir),
        "output_dir": str(settings.output_dir),
        "queued_in_input": len(_input_documents(settings)),
        "environment": {
            "mineru_version": importlib.metadata.version("mineru"),
            "python": sys.version.split()[0],
            "device": by_key["device"],
            "resolved_small_backend": by_key["small_backend"],
        },
        "disk": {"free": usage.free, "total": usage.total},
    }
```

Add the imports at the top of `batch_api.py`:

```python
import importlib.metadata
import shutil
```

- [ ] **Step 5: Run the tests**

Run: `cd "$REPO" && "$PY" -m pytest tests/test_settings_records.py -v`
Expected: 5 passed.

- [ ] **Step 6: Run the whole backend suite**

Run: `cd "$REPO" && "$PY" -m pytest tests -v`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add batch_api.py tests/test_settings_records.py
git commit -m "feat: declare server parameters with their source and change effect"
```

---

### Task 8: Generic units, environment file, and deploy script

**Files:**
- Modify: `mineru-batch-api.service`, `mineru-batch.service`
- Create: `batch.env.example`, `deploy.sh`, `.gitignore` (append)

**Interfaces:**
- Consumes: `batch_settings.py`'s env var names.
- Produces: an installable pair of units that read site specifics from `/etc/mineru-batch.env`.

- [ ] **Step 1: Write `batch.env.example`**

```bash
# Copy to /etc/mineru-batch.env (mode 0600) and edit. This file is NOT committed with
# real values: the repository is public.
MINERU_HOME=/home/<user>/.mineru
MINERU_BATCH_ROOT=/home/<user>/.mineru/batch
MINERU_BATCH_TIER=basic
MINERU_BATCH_IMAGE_MODE=marker
MINERU_BATCH_HOST=0.0.0.0
MINERU_BATCH_PORT=8090
# Set to require "Authorization: Bearer <token>" on every /api/ call.
MINERU_BATCH_TOKEN=
```

- [ ] **Step 2: Update both units**

In both `.service` files, replace the hard-coded `Environment=` lines with:

```ini
EnvironmentFile=-/etc/mineru-batch.env
```

and update the paths — `ExecStart` and `WorkingDirectory` point at this repository:

```ini
WorkingDirectory=/path/to/mineru-batch
ExecStart=/path/to/mineru-venv/bin/python /path/to/mineru-batch/batch_api.py
```

Remove `RequiresMountsFor=` for the old storage mount from both units, and drop the `--input` / `--output` / `--report` paths in favour of the settings module's defaults. Keep `ProtectHome=no` — the virtualenv and model weights live under the home directory — and add a comment saying why.

- [ ] **Step 3: Write `deploy.sh`**

```bash
#!/usr/bin/env bash
# Build the console, install the units, and restart the service.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO"

if [ ! -f batch_webui/package.json ]; then
  echo "batch_webui is not scaffolded yet; skipping the build" >&2
else
  (cd batch_webui && bun install --frozen-lockfile && bun run build)
fi

sudo install -m0644 mineru-batch-api.service /etc/systemd/system/
sudo install -m0644 mineru-batch.service /etc/systemd/system/
if [ ! -f /etc/mineru-batch.env ]; then
  echo "NOTE: /etc/mineru-batch.env does not exist; see batch.env.example" >&2
fi
sudo systemctl daemon-reload
sudo systemctl restart mineru-batch-api
systemctl status --no-pager mineru-batch-api
```

```bash
chmod +x "$REPO/deploy.sh"
printf 'batch_webui/dist/\n.env\n' >> "$REPO/.gitignore"
```

- [ ] **Step 4: Verify the units parse**

```bash
cd "$REPO" && systemd-analyze verify mineru-batch-api.service mineru-batch.service 2>&1 | grep -v "not found in PATH" || true
```

Expected: no errors other than executable-path warnings from the placeholders.

- [ ] **Step 5: Commit**

```bash
git add .gitignore mineru-batch-api.service mineru-batch.service batch.env.example deploy.sh
git commit -m "chore: generic service units, environment file, and deploy script"
```

---

# Phase 2 — Console core

### Task 9: Scaffold the SPA

**Files:**
- Create: `batch_webui/` (whole project), `batch_webui/vite.config.ts`, `batch_webui/src/index.css`

**Interfaces:**
- Consumes: nothing.
- Produces: `bun run dev` on `:5173` proxying `/api` to `127.0.0.1:8090`; `bun run build` writing `dist/`; `bun run test` running vitest.

- [ ] **Step 1: Scaffold and install**

```bash
cd "$REPO" && mkdir -p batch_webui && cd batch_webui
bun init -y
bun add react react-dom axios react-markdown remark-gfm remark-math rehype-katex katex \
        @radix-ui/react-dialog @radix-ui/react-checkbox @radix-ui/react-tabs @radix-ui/react-progress
bun add -d vite @vitejs/plugin-react typescript @types/react @types/react-dom \
        tailwindcss @tailwindcss/vite vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

If the registry is unreachable, stop and report — do not vendor dependencies by hand.

- [ ] **Step 2: Point the build at `dist/` and proxy the API**

Replace `batch_webui/vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:8090', changeOrigin: false } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test-setup.ts'] },
})
```

Create `batch_webui/src/test-setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 3: Add the scripts**

In `batch_webui/package.json`, set:

```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  }
```

- [ ] **Step 4: Create the entry points**

`batch_webui/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MinerU Batch Console</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`batch_webui/src/index.css`:

```css
@import 'tailwindcss';
@import 'katex/dist/katex.min.css';
```

`batch_webui/src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

`batch_webui/src/App.tsx` (placeholder; replaced in Task 14):

```tsx
export default function App() {
  return <main className="p-8 text-lg">MinerU Batch Console</main>
}
```

- [ ] **Step 5: Verify build and test both run**

```bash
cd "$REPO/batch_webui" && bun run build && bun run test -- --passWithNoTests
ls dist/index.html
```

Expected: `dist/index.html` exists.

- [ ] **Step 6: Commit**

```bash
cd "$REPO" && git add batch_webui && git commit -m "feat: scaffold the console SPA"
```

---

### Task 10: API client and types

**Files:**
- Create: `batch_webui/src/api/types.ts`, `batch_webui/src/api/client.ts`, `batch_webui/src/api/mineru.ts`

**Interfaces:**
- Consumes: the HTTP contract from Phase 1.
- Produces: `DocRow`, `DocumentsResponse`, `StatusResponse`, `ConfigRecord`; `getStatus()`, `getDocuments()`, `getContent(path)`, `uploadFiles(files, relativePaths, onProgress)`, `startRun()`, `stopRun()`, `clearInput()`, `deleteDocuments(paths, deleteResult)`, `resultDownloadUrl(path)`, `zipResults(paths)`.

- [ ] **Step 1: Write the types**

`batch_webui/src/api/types.ts`:

```ts
export type DocStatus = 'pending' | 'queued' | 'running' | 'done' | 'skipped' | 'failed' | 'converted'
export type RunState = 'idle' | 'running' | 'done' | 'failed'

export interface DocRow {
  path: string
  status: DocStatus
  pages: number | null
  seconds: number | null
  rate: number | null
  bytes: number | null
  error: string | null
  has_input: boolean
  has_result: boolean
}

export interface DocumentsResponse {
  state: RunState
  counts: Record<string, number>
  files: DocRow[]
}

export interface ConfigRecord {
  key: string
  label: string
  value: string | number | boolean | null
  source: 'default' | 'file' | 'env' | 'runtime'
  env_var: string | null
  config_file: string | null
  effect: 'restart' | 'next_run' | 'read_only'
}

export interface StatusResponse {
  state: RunState
  pid: number | null
  current_file: string | null
  window: string
  message: string
  returncode: number | null
  total: number
  started_at: number | null
  ended_at: number | null
  counts: Record<string, number>
  files: DocRow[]
  config: {
    records: ConfigRecord[]
    input_dir: string
    output_dir: string
    queued_in_input: number
    environment: Record<string, string>
    disk: { free: number; total: number }
  }
}
```

- [ ] **Step 2: Write the client**

`batch_webui/src/api/client.ts`:

```ts
import axios, { AxiosError } from 'axios'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export const http = axios.create({ baseURL: '/', timeout: 120_000 })

// FastAPI reports errors as {"detail": "..."}; surface that text rather than the status.
http.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail
    const message =
      typeof detail === 'string' ? detail : (error.message ?? 'request failed')
    return Promise.reject(new ApiError(message, error.response?.status ?? 0))
  },
)
```

- [ ] **Step 3: Write the endpoint wrappers**

`batch_webui/src/api/mineru.ts`:

```ts
import { http } from './client'
import type { DocumentsResponse, StatusResponse } from './types'

export const getStatus = async (): Promise<StatusResponse> =>
  (await http.get<StatusResponse>('/api/status')).data

export const getDocuments = async (): Promise<DocumentsResponse> =>
  (await http.get<DocumentsResponse>('/api/documents')).data

export const getContent = async (path: string): Promise<string> =>
  (await http.get<string>('/api/results/content', { params: { path }, responseType: 'text' })).data

export async function uploadFiles(
  files: File[],
  relativePaths: string[],
  onProgress?: (fraction: number) => void,
): Promise<{ count: number }> {
  const form = new FormData()
  files.forEach((file) => form.append('files', file, file.name))
  relativePaths.forEach((relative) => form.append('relative_paths', relative))
  const { data } = await http.post<{ count: number }>('/api/upload', form, {
    onUploadProgress: (event) => {
      if (onProgress && event.total) onProgress(event.loaded / event.total)
    },
  })
  return data
}

export const startRun = async (): Promise<{ started: boolean; documents: number }> =>
  (await http.post('/api/start')).data

export const stopRun = async (): Promise<void> => {
  await http.post('/api/stop')
}

export const clearInput = async (): Promise<{ removed: number }> => (await http.post('/api/clear')).data

export const deleteDocuments = async (paths: string[], deleteResult = true) =>
  (await http.post('/api/documents/delete', { paths, delete_result: deleteResult })).data

export const resultDownloadUrl = (path: string): string =>
  `/api/results/download?path=${encodeURIComponent(path)}`

export async function zipResults(paths: string[]): Promise<Blob> {
  const response = await http.post('/api/results/zip', { paths }, { responseType: 'blob' })
  return response.data as Blob
}
```

- [ ] **Step 4: Typecheck**

Run: `cd "$REPO/batch_webui" && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd "$REPO" && git add batch_webui/src/api && git commit -m "feat: add the console's typed API client"
```

---

### Task 11: Pure logic — status buckets, the upload chain, figure markers

**Files:**
- Create: `batch_webui/src/lib/buckets.ts`, `batch_webui/src/lib/uploadChain.ts`, `batch_webui/src/lib/figures.ts`
- Test: `batch_webui/src/lib/{buckets,uploadChain,figures}.test.ts`

**Interfaces:**
- Consumes: `DocStatus` from `api/types`.
- Produces: `type Bucket = 'all' | 'pending' | 'running' | 'converted' | 'failed'`; `bucketOf(status: DocStatus): Exclude<Bucket, 'all'>`; `matchesBucket(row: DocRow, bucket: Bucket): boolean`; `runUploadChain(items: UploadItem[], deps: UploadChainDeps, onProgress?): Promise<UploadChainResult>`; `shouldStartQueuedRun(armed: boolean, state: string, pendingCount: number): boolean`; `renderFigureMarkers(markdown: string): string`.

- [ ] **Step 1: Write the failing tests**

`batch_webui/src/lib/buckets.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { bucketOf } from './buckets'

describe('bucketOf', () => {
  it('folds both done and skipped into converted', () => {
    expect(bucketOf('done')).toBe('converted')
    expect(bucketOf('skipped')).toBe('converted')
    expect(bucketOf('converted')).toBe('converted')
  })

  it('treats queued as running, because it is behind an active run', () => {
    expect(bucketOf('queued')).toBe('running')
    expect(bucketOf('running')).toBe('running')
  })

  it('keeps pending and failed distinct', () => {
    expect(bucketOf('pending')).toBe('pending')
    expect(bucketOf('failed')).toBe('failed')
  })
})
```

`batch_webui/src/lib/figures.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { renderFigureMarkers } from './figures'

describe('renderFigureMarkers', () => {
  it('turns an omitted-figure comment into a visible note', () => {
    const out = renderFigureMarkers('before\n<!-- figure omitted: ImageBlock -->\nafter')
    expect(out).toContain('figure omitted')
    expect(out).not.toContain('<!--')
  })

  it('leaves ordinary text alone', () => {
    expect(renderFigureMarkers('plain **text**')).toBe('plain **text**')
  })

  it('handles several markers', () => {
    const out = renderFigureMarkers('<!-- figure omitted: ImageBlock --><!-- figure omitted: TableBlock -->')
    expect(out.match(/figure omitted/g)).toHaveLength(2)
  })
})
```

`batch_webui/src/lib/uploadChain.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { runUploadChain, shouldStartQueuedRun } from './uploadChain'

const file = () => new File(['x'], 'a.pdf')

describe('runUploadChain', () => {
  it('uploads then starts', async () => {
    const upload = vi.fn().mockResolvedValue({ count: 1 })
    const start = vi.fn().mockResolvedValue({ started: true, documents: 1 })
    const result = await runUploadChain([{ file: file(), relative: 'a.pdf' }], { upload, start })
    expect(result).toEqual({ uploaded: 1, started: true, queuedBehindRun: false })
    expect(upload).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('treats a 409 on start as queued, not as a failure', async () => {
    const upload = vi.fn().mockResolvedValue({ count: 1 })
    const start = vi.fn().mockRejectedValue(new ApiError('a run is already in progress', 409))
    const result = await runUploadChain([{ file: file(), relative: 'a.pdf' }], { upload, start })
    expect(result).toEqual({ uploaded: 1, started: false, queuedBehindRun: true })
  })

  it('propagates upload failures', async () => {
    const upload = vi.fn().mockRejectedValue(new ApiError('exceeds the limit', 413))
    const start = vi.fn()
    await expect(runUploadChain([{ file: file(), relative: 'a.pdf' }], { upload, start })).rejects.toThrow(
      'exceeds the limit',
    )
    expect(start).not.toHaveBeenCalled()
  })
})

describe('shouldStartQueuedRun', () => {
  it('starts only when armed, idle, and something is waiting', () => {
    expect(shouldStartQueuedRun(true, 'idle', 3)).toBe(true)
  })

  it('does not start while another run holds the lock', () => {
    expect(shouldStartQueuedRun(true, 'running', 3)).toBe(false)
  })

  it('does not start when nothing is pending', () => {
    expect(shouldStartQueuedRun(true, 'idle', 0)).toBe(false)
  })

  it('does not start unless a 409 armed it', () => {
    expect(shouldStartQueuedRun(false, 'idle', 3)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd "$REPO/batch_webui" && bun run test`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the three modules**

`batch_webui/src/lib/buckets.ts`:

```ts
import type { DocRow, DocStatus } from '../api/types'

export type Bucket = 'all' | 'pending' | 'running' | 'converted' | 'failed'

export const BUCKETS: Bucket[] = ['all', 'pending', 'running', 'converted', 'failed']

const BY_STATUS: Record<DocStatus, Exclude<Bucket, 'all'>> = {
  pending: 'pending',
  queued: 'running',
  running: 'running',
  done: 'converted',
  skipped: 'converted',
  converted: 'converted',
  failed: 'failed',
}

export function bucketOf(status: DocStatus): Exclude<Bucket, 'all'> {
  return BY_STATUS[status]
}

export function matchesBucket(row: DocRow, bucket: Bucket): boolean {
  return bucket === 'all' || bucketOf(row.status) === bucket
}
```

`batch_webui/src/lib/figures.ts`:

```ts
const FIGURE_MARKER = /<!--\s*figure omitted:\s*([A-Za-z0-9_]+)\s*-->/g

/**
 * The engine omits figures and leaves an HTML comment. React-markdown drops comments,
 * so without this the preview would silently lose all trace of a figure. Render a
 * visible, honest note instead.
 */
export function renderFigureMarkers(markdown: string): string {
  return markdown.replace(FIGURE_MARKER, (_match, kind: string) => `> _[figure omitted: ${kind}]_`)
}
```

`batch_webui/src/lib/uploadChain.ts`:

```ts
import { ApiError } from '../api/client'

export interface UploadItem {
  file: File
  relative: string
}

export interface UploadChainDeps {
  upload: (files: File[], relativePaths: string[], onProgress?: (fraction: number) => void) => Promise<{ count: number }>
  start: () => Promise<{ started: boolean; documents: number }>
}

export interface UploadChainResult {
  uploaded: number
  started: boolean
  queuedBehindRun: boolean
}

/**
 * The console's single action: choosing documents uploads them and starts the run.
 * A 409 means another run holds the lock — the documents are safely queued, not lost.
 */
export async function runUploadChain(
  items: UploadItem[],
  deps: UploadChainDeps,
  onProgress?: (fraction: number) => void,
): Promise<UploadChainResult> {
  const { count } = await deps.upload(
    items.map((item) => item.file),
    items.map((item) => item.relative),
    onProgress,
  )
  try {
    await deps.start()
    return { uploaded: count, started: true, queuedBehindRun: false }
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      return { uploaded: count, started: false, queuedBehindRun: true }
    }
    throw error
  }
}

/**
 * Whether a run the client was blocked out of should now be started. The caller clears
 * its armed flag before starting, so a batch is started exactly once.
 */
export function shouldStartQueuedRun(armed: boolean, state: string, pendingCount: number): boolean {
  return armed && state !== 'running' && pendingCount > 0
}
```

- [ ] **Step 4: Run the tests**

Run: `cd "$REPO/batch_webui" && bun run test`
Expected: 13 passed.

- [ ] **Step 5: Commit**

```bash
cd "$REPO" && git add batch_webui/src/lib && git commit -m "feat: add status buckets, upload chain, and figure-marker rendering"
```

---

### Task 12: The drop zone and the API hook

**Files:**
- Create: `batch_webui/src/hooks/useBatchApi.ts`, `batch_webui/src/components/DropZone.tsx`

**Interfaces:**
- Consumes: `runUploadChain`, the API client.
- Produces: `useBatchApi()` returning `{ status, documents, error, connected, refresh, submit(items), stop, clear, remove(paths), busy }`; `<DropZone onSubmit={(items: UploadItem[]) => void} busy={boolean} />`.

- [ ] **Step 1: Write the failing test**

`batch_webui/src/components/DropZone.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DropZone } from './DropZone'

describe('DropZone', () => {
  it('offers an upload button that opens the file picker', async () => {
    const onSubmit = vi.fn()
    render(<DropZone onSubmit={onSubmit} busy={false} />)
    const input = screen.getByTestId('file-input') as HTMLInputElement
    const click = vi.spyOn(input, 'click').mockImplementation(() => {})
    await userEvent.click(screen.getByRole('button', { name: /files/i }))
    expect(click).toHaveBeenCalled()
  })

  it('submits relative paths for a folder selection', async () => {
    const onSubmit = vi.fn()
    render(<DropZone onSubmit={onSubmit} busy={false} />)
    const input = screen.getByTestId('folder-input') as HTMLInputElement
    const file = new File(['x'], 'a.pdf')
    Object.defineProperty(file, 'webkitRelativePath', { value: 'papers/a.pdf' })
    Object.defineProperty(input, 'files', { value: [file] })
    await userEvent.upload(input, file)
    expect(onSubmit).toHaveBeenCalledWith([{ file, relative: 'papers/a.pdf' }])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd "$REPO/batch_webui" && bun run test src/components/DropZone.test.tsx`
Expected: FAIL — cannot resolve `./DropZone`.

- [ ] **Step 3: Implement the hook**

`batch_webui/src/hooks/useBatchApi.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from '../api/mineru'
import type { DocumentsResponse, StatusResponse } from '../api/types'
import { runUploadChain, shouldStartQueuedRun, type UploadItem } from '../lib/uploadChain'

const ACTIVE_INTERVAL_MS = 1500
const IDLE_INTERVAL_MS = 5000

export function useBatchApi() {
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [documents, setDocuments] = useState<DocumentsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(true)
  const [busy, setBusy] = useState(false)
  // Armed by a 409: documents landed while another run held the lock.
  const pendingStart = useRef(false)

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextDocuments] = await Promise.all([api.getStatus(), api.getDocuments()])
      setStatus(nextStatus)
      setDocuments(nextDocuments)
      setConnected(true)
      setError(null)
      if (shouldStartQueuedRun(pendingStart.current, nextStatus.state, nextDocuments.counts.pending ?? 0)) {
        // Clear the flag first, so a slow start cannot be issued twice.
        pendingStart.current = false
        setBusy(true)
        try {
          await api.startRun()
        } catch {
          // Another client may have won the race; the next poll shows the truth.
        } finally {
          setBusy(false)
        }
      }
    } catch (failure) {
      setConnected(false)
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    const tick = async () => {
      if (cancelled) return
      // A background tab must not compete with CPU-bound inference.
      if (document.visibilityState === 'visible') await refresh()
      if (cancelled) return
      const active = status?.state === 'running' || Boolean(documents?.counts.pending)
      timer = window.setTimeout(tick, active ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS)
    }

    void tick()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [refresh, status?.state, documents?.counts.pending])

  const submit = useCallback(
    async (items: UploadItem[]) => {
      setBusy(true)
      try {
        const result = await runUploadChain(items, { upload: api.uploadFiles, start: api.startRun })
        pendingStart.current = result.queuedBehindRun
        await refresh()
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure))
      } finally {
        setBusy(false)
      }
    },
    [refresh],
  )

  const stop = useCallback(async () => {
    await api.stopRun()
    await refresh()
  }, [refresh])

  const clear = useCallback(async () => {
    await api.clearInput()
    await refresh()
  }, [refresh])

  const remove = useCallback(
    async (paths: string[]) => {
      await api.deleteDocuments(paths)
      await refresh()
    },
    [refresh],
  )

  return { status, documents, error, connected, busy, refresh, submit, stop, clear, remove }
}
```

- [ ] **Step 4: Implement the drop zone**

`batch_webui/src/components/DropZone.tsx`:

```tsx
import { useRef, useState } from 'react'
import type { UploadItem } from '../lib/uploadChain'

interface Props {
  onSubmit: (items: UploadItem[]) => void
  busy: boolean
}

/** Walk a dropped directory entry, preserving each file's path relative to the drop. */
async function fromEntry(entry: any, prefix: string, out: UploadItem[]): Promise<void> {
  if (entry.isFile) {
    const file: File = await new Promise((resolve, reject) => entry.file(resolve, reject))
    out.push({ file, relative: `${prefix}${file.name}` })
    return
  }
  if (entry.isDirectory) {
    const reader = entry.createReader()
    const entries: any[] = await new Promise((resolve, reject) => reader.readEntries(resolve, reject))
    for (const child of entries) await fromEntry(child, `${prefix}${entry.name}/`, out)
  }
}

export function DropZone({ onSubmit, busy }: Props) {
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)

  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault()
    setDragging(false)
    const items: UploadItem[] = []
    const entries = Array.from(event.dataTransfer.items)
      .map((item) => (item.webkitGetAsEntry ? item.webkitGetAsEntry() : null))
      .filter(Boolean)
    if (entries.length) {
      for (const entry of entries) await fromEntry(entry, '', items)
    } else {
      for (const file of Array.from(event.dataTransfer.files)) items.push({ file, relative: file.name })
    }
    if (items.length) onSubmit(items)
  }

  const fromInput = (input: HTMLInputElement | null) => {
    if (!input?.files) return
    const items = Array.from(input.files).map((file) => ({
      file,
      relative: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    }))
    if (items.length) onSubmit(items)
  }

  return (
    <section
      data-testid="dropzone"
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`rounded-lg border-2 border-dashed p-8 text-center transition ${
        dragging ? 'border-blue-500 bg-blue-50' : 'border-slate-300'
      }`}
    >
      <p className="text-slate-600">Drop files or a folder here — conversion starts immediately.</p>
      <div className="mt-4 flex justify-center gap-2">
        <button type="button" disabled={busy} onClick={() => fileInput.current?.click()}
                className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50">
          Upload files
        </button>
        <button type="button" disabled={busy} onClick={() => folderInput.current?.click()}
                className="rounded border border-slate-300 px-4 py-2 disabled:opacity-50">
          Upload folder
        </button>
      </div>
      <input ref={fileInput} data-testid="file-input" type="file" multiple hidden onChange={(event) => fromInput(event.target)} />
      <input
        ref={folderInput}
        data-testid="folder-input"
        type="file"
        hidden
        multiple
        // @ts-expect-error non-standard but universally supported
        webkitdirectory=""
        onChange={(event) => fromInput(event.target)}
      />
    </section>
  )
}
```

- [ ] **Step 5: Run the tests**

Run: `cd "$REPO/batch_webui" && bun run test`
Expected: 15 passed.

- [ ] **Step 6: Commit**

```bash
cd "$REPO" && git add batch_webui/src/hooks batch_webui/src/components/DropZone.tsx batch_webui/src/components/DropZone.test.tsx
git commit -m "feat: add the drop zone and the polling API hook"
```

---

### Task 13: Run bar, filter tabs, and the documents table

**Files:**
- Create: `batch_webui/src/components/RunStatusBar.tsx`, `batch_webui/src/components/FilterTabs.tsx`, `batch_webui/src/components/DocumentsTable.tsx`
- Test: `batch_webui/src/components/DocumentsTable.test.tsx`

**Interfaces:**
- Consumes: `matchesBucket`, `Bucket`, `DocRow`.
- Produces: `<DocumentsTable rows selected onToggle onToggleAll onPreview onDelete />`; `<FilterTabs value onChange counts />`; `<RunStatusBar status onStop onClear />`.

- [ ] **Step 1: Write the failing test**

`batch_webui/src/components/DocumentsTable.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { DocRow } from '../api/types'
import { DocumentsTable } from './DocumentsTable'

const row = (over: Partial<DocRow>): DocRow => ({
  path: 'a.md',
  status: 'converted',
  pages: 2,
  seconds: 1,
  rate: 2,
  bytes: 10,
  error: null,
  has_input: true,
  has_result: true,
  ...over,
})

describe('DocumentsTable', () => {
  it('renders a row per document', () => {
    render(<DocumentsTable rows={[row({}), row({ path: 'b.md' })]} selected={new Set()} onToggle={() => {}} onToggleAll={() => {}} onPreview={() => {}} />)
    expect(screen.getAllByRole('row')).toHaveLength(3) // header + 2
  })

  it('asks to preview when a converted row is clicked', async () => {
    const onPreview = vi.fn()
    render(<DocumentsTable rows={[row({})]} selected={new Set()} onToggle={() => {}} onToggleAll={() => {}} onPreview={onPreview} />)
    await userEvent.click(screen.getByText('a.md'))
    expect(onPreview).toHaveBeenCalledWith('a.md')
  })

  it('does not preview a row with no result', async () => {
    const onPreview = vi.fn()
    render(<DocumentsTable rows={[row({ status: 'pending', has_result: false })]} selected={new Set()} onToggle={() => {}} onToggleAll={() => {}} onPreview={onPreview} />)
    await userEvent.click(screen.getByText('a.md'))
    expect(onPreview).not.toHaveBeenCalled()
  })

  it('shows a failure reason', () => {
    render(<DocumentsTable rows={[row({ status: 'failed', error: 'ValueError: bad pdf' })]} selected={new Set()} onToggle={() => {}} onToggleAll={() => {}} onPreview={() => {}} />)
    expect(screen.getByText(/ValueError/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd "$REPO/batch_webui" && bun run test src/components/DocumentsTable.test.tsx`
Expected: FAIL — cannot resolve `./DocumentsTable`.

- [ ] **Step 3: Implement the table**

`batch_webui/src/components/DocumentsTable.tsx`:

```tsx
import type { DocRow } from '../api/types'

interface Props {
  rows: DocRow[]
  selected: Set<string>
  onToggle: (path: string) => void
  onToggleAll: (checked: boolean) => void
  onPreview: (path: string) => void
}

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-700',
  queued: 'bg-amber-100 text-amber-800',
  running: 'bg-blue-100 text-blue-800',
  done: 'bg-green-100 text-green-800',
  skipped: 'bg-slate-100 text-slate-600',
  converted: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
}

export function DocumentsTable({ rows, selected, onToggle, onToggleAll, onPreview }: Props) {
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.path))
  return (
    <table className="w-full text-left text-sm">
      <thead className="border-b text-slate-500">
        <tr>
          <th className="p-2">
            <input type="checkbox" aria-label="Select all" checked={allSelected} onChange={(e) => onToggleAll(e.target.checked)} />
          </th>
          <th className="p-2">Document</th>
          <th className="p-2">Status</th>
          <th className="p-2">Pages</th>
          <th className="p-2">Seconds</th>
          <th className="p-2">Page/s</th>
          <th className="p-2">Error</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.path} className="border-b hover:bg-slate-50">
            <td className="p-2">
              <input type="checkbox" aria-label={`Select ${row.path}`} checked={selected.has(row.path)} onChange={() => onToggle(row.path)} />
            </td>
            <td className="p-2">
              <button
                type="button"
                disabled={!row.has_result}
                onClick={() => row.has_result && onPreview(row.path)}
                className={row.has_result ? 'text-blue-700 hover:underline' : 'text-slate-700'}
              >
                {row.path}
              </button>
            </td>
            <td className="p-2">
              <span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[row.status] ?? ''}`} title={row.status === 'skipped' ? 'already existed' : undefined}>
                {row.status}
              </span>
            </td>
            <td className="p-2">{row.pages ?? '—'}</td>
            <td className="p-2">{row.seconds != null ? row.seconds.toFixed(1) : '—'}</td>
            <td className="p-2">{row.rate ?? '—'}</td>
            <td className="p-2 text-red-700">{row.error ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

- [ ] **Step 4: Implement the tabs and the run bar**

`batch_webui/src/components/FilterTabs.tsx`:

```tsx
import { BUCKETS, type Bucket } from '../lib/buckets'

interface Props {
  value: Bucket
  counts: Record<string, number>
  onChange: (bucket: Bucket) => void
}

export function FilterTabs({ value, counts, onChange }: Props) {
  return (
    <div role="tablist" className="flex gap-1">
      {BUCKETS.map((bucket) => (
        <button
          key={bucket}
          role="tab"
          aria-selected={value === bucket}
          onClick={() => onChange(bucket)}
          className={`rounded px-3 py-1 text-sm capitalize ${
            value === bucket ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'
          }`}
        >
          {bucket}
          {bucket !== 'all' && counts[bucket] != null ? ` (${counts[bucket]})` : ''}
        </button>
      ))}
    </div>
  )
}
```

`batch_webui/src/components/RunStatusBar.tsx`:

```tsx
import type { StatusResponse } from '../api/types'

interface Props {
  status: StatusResponse | null
  onStop: () => void
  onClear: () => void
}

export function RunStatusBar({ status, onStop, onClear }: Props) {
  if (!status) return null
  const running = status.state === 'running'
  const done = status.counts.done ?? 0
  const failed = status.counts.failed ?? 0
  const total = status.total || 0
  return (
    <div className="flex flex-wrap items-center gap-4 rounded border bg-white p-3 text-sm">
      <span className={`rounded px-2 py-0.5 ${running ? 'bg-blue-100 text-blue-800' : 'bg-slate-100'}`}>{status.state}</span>
      <span>
        {done + failed}/{total} processed · {failed} failed
      </span>
      {status.current_file && (
        <span className="text-slate-600">
          converting {status.current_file} {status.window && `· ${status.window}`}
        </span>
      )}
      {status.message && <span className="text-slate-600">{status.message}</span>}
      <div className="ml-auto flex gap-2">
        <button type="button" disabled={!running} onClick={onStop} className="rounded border px-3 py-1 disabled:opacity-40">
          Stop
        </button>
        <button type="button" disabled={running} onClick={onClear} className="rounded border px-3 py-1 disabled:opacity-40">
          Clear input
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run the tests**

Run: `cd "$REPO/batch_webui" && bun run test`
Expected: 19 passed.

- [ ] **Step 6: Commit**

```bash
cd "$REPO" && git add batch_webui/src/components && git commit -m "feat: add the run bar, filter tabs, and documents table"
```

---

### Task 14: Assemble the console and verify it against a live server

**Files:**
- Modify: `batch_webui/src/App.tsx`
- Test: manual acceptance (Step 4)

**Interfaces:**
- Consumes: everything from Tasks 12–13.
- Produces: the running console.

- [ ] **Step 1: Write `App.tsx`**

```tsx
import { useMemo, useState } from 'react'
import { DocumentsTable } from './components/DocumentsTable'
import { DropZone } from './components/DropZone'
import { FilterTabs } from './components/FilterTabs'
import { RunStatusBar } from './components/RunStatusBar'
import { useBatchApi } from './hooks/useBatchApi'
import { matchesBucket, type Bucket } from './lib/buckets'

export default function App() {
  const { status, documents, error, busy, submit, stop, clear } = useBatchApi()
  const [bucket, setBucket] = useState<Bucket>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const rows = useMemo(
    () => (documents?.files ?? []).filter((row) => matchesBucket(row, bucket)),
    [documents, bucket],
  )

  const toggle = (path: string) =>
    setSelected((previous) => {
      const next = new Set(previous)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold">MinerU Batch Console</h1>
      <DropZone onSubmit={submit} busy={busy} />
      {error && <div className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">{error}</div>}
      <RunStatusBar status={status} onStop={stop} onClear={clear} />
      <FilterTabs value={bucket} counts={documents?.counts ?? {}} onChange={setBucket} />
      <DocumentsTable
        rows={rows}
        selected={selected}
        onToggle={toggle}
        onToggleAll={(checked) => setSelected(checked ? new Set(rows.map((row) => row.path)) : new Set())}
        onPreview={() => {}}
      />
    </main>
  )
}
```

- [ ] **Step 2: Typecheck and build**

Run: `cd "$REPO/batch_webui" && bunx tsc --noEmit && bun run build`
Expected: no errors; `dist/` repopulated.

- [ ] **Step 3: Run the server against a scratch root**

```bash
export MINERU_BATCH_ROOT=$(mktemp -d)
cd "$REPO" && "$PY" batch_api.py &
sleep 2 && curl -s localhost:8090/api/documents | head -c 200
```

Expected: `{"state":"idle","counts":{},"files":[]}`.

- [ ] **Step 4: Manual acceptance**

Open `http://localhost:8090/`, then verify:

1. Dropping one PDF starts the run with no further clicks.
2. Uploading one PDF via the **Upload files** button does the same.
3. Uploading a folder preserves the tree (check a nested row's path).
4. The table shows `pending` → `running` → `converted`.
5. `Stop` interrupts; `Clear input` empties the list.

- [ ] **Step 5: Commit**

```bash
cd "$REPO" && git add batch_webui/src/App.tsx && git commit -m "feat: assemble the console shell"
```

---

# Phase 3 — Console completion

### Task 15: Preview drawer

**Files:**
- Create: `batch_webui/src/components/PreviewDrawer.tsx`
- Modify: `batch_webui/src/App.tsx` (wire `onPreview`)

**Interfaces:**
- Consumes: `getContent(path)`, `renderFigureMarkers`, `resultDownloadUrl`.
- Produces: `<PreviewDrawer path={string | null} onClose={() => void} />`.

- [ ] **Step 1: Implement the drawer**

```tsx
import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { getContent } from '../api/mineru'
import { renderFigureMarkers } from '../lib/figures'

interface Props {
  path: string | null
  onClose: () => void
}

export function PreviewDrawer({ path, onClose }: Props) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!path) return
    let cancelled = false
    setText('')
    setError(null)
    getContent(path)
      .then((body) => {
        if (!cancelled) setText(renderFigureMarkers(body))
      })
      .catch((failure: Error) => {
        if (!cancelled) setError(failure.message)
      })
    return () => {
      cancelled = true
    }
  }, [path])

  if (!path) return null

  return (
    <aside
      role="complementary"
      aria-label="Preview"
      className="fixed inset-y-0 right-0 z-20 w-1/2 overflow-y-auto border-l bg-white p-6 shadow-xl"
    >
      <header className="mb-4 flex items-center gap-3">
        <h2 className="flex-1 truncate font-medium">{path}</h2>
        <a href={`/api/results/download?path=${encodeURIComponent(path)}`} className="text-sm text-blue-700 hover:underline">
          Download
        </a>
        <button type="button" onClick={() => void navigator.clipboard.writeText(text)} className="text-sm text-blue-700 hover:underline">
          Copy
        </button>
        <button type="button" onClick={onClose} aria-label="Close preview">
          ✕
        </button>
      </header>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <article className="prose prose-sm max-w-none">
        <Markdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
          {text}
        </Markdown>
      </article>
    </aside>
  )
}
```

- [ ] **Step 2: Wire it into `App.tsx`**

Add `const [previewing, setPreviewing] = useState<string | null>(null)`, pass `onPreview={setPreviewing}` to the table, and render:

```tsx
      <PreviewDrawer path={previewing} onClose={() => setPreviewing(null)} />
```

- [ ] **Step 3: Verify in the browser**

Convert a document containing a formula and at least one figure. Confirm: the formula renders typeset (not as raw `$…$`), and where a figure was dropped the note **"[figure omitted: …]"** appears where the comment used to be.

- [ ] **Step 4: Commit**

```bash
cd "$REPO" && git add batch_webui/src && git commit -m "feat: add the markdown preview drawer"
```

---

### Task 16: Downloads — single and bulk

**Files:**
- Create: `batch_webui/src/components/SelectionActions.tsx`
- Modify: `batch_webui/src/App.tsx`
- Test: `batch_webui/src/lib/download.test.ts`

**Interfaces:**
- Consumes: `resultDownloadUrl`, `zipResults`.
- Produces: `downloadBlob(blob: Blob, filename: string): void`; `<SelectionActions selected onDelete />`.

- [ ] **Step 1: Write the failing test**

`batch_webui/src/lib/download.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { downloadBlob } from './download'

describe('downloadBlob', () => {
  it('saves via an object URL and revokes it', () => {
    const createObjectURL = vi.fn(() => 'blob:xyz')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const click = vi.fn()
    vi.spyOn(document, 'createElement').mockReturnValue({ click, href: '', download: '' } as unknown as HTMLAnchorElement)

    downloadBlob(new Blob(['x']), 'out.zip')

    expect(createObjectURL).toHaveBeenCalled()
    expect(click).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:xyz')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd "$REPO/batch_webui" && bun run test src/lib/download.test.ts`
Expected: FAIL — cannot resolve `./download`.

- [ ] **Step 3: Implement**

`batch_webui/src/lib/download.ts`:

```ts
/** Save a fetched blob without navigating away, so progress and selection survive. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
```

`batch_webui/src/components/SelectionActions.tsx`:

```tsx
import { zipResults } from '../api/mineru'
import { downloadBlob } from '../lib/download'

interface Props {
  selected: string[]
  onDelete: () => void
  onClearSelection: () => void
}

export function SelectionActions({ selected, onDelete, onClearSelection }: Props) {
  if (selected.length === 0) return null

  const downloadSelected = async () => {
    const blob = await zipResults(selected)
    downloadBlob(blob, 'mineru-markdown.zip')
  }

  return (
    <div className="flex items-center gap-3 rounded border bg-slate-50 p-2 text-sm">
      <span>{selected.length} selected</span>
      <button type="button" onClick={downloadSelected} className="rounded bg-slate-900 px-3 py-1 text-white">
        Download selected
      </button>
      <button type="button" onClick={onDelete} className="rounded border border-red-300 px-3 py-1 text-red-700">
        Delete selected
      </button>
      <button type="button" onClick={onClearSelection} className="text-slate-600 hover:underline">
        Clear selection
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Run the tests and wire it in**

Run: `cd "$REPO/batch_webui" && bun run test`
Expected: 20 passed.

In `App.tsx`, render `<SelectionActions selected={[...selected]} onDelete={...} onClearSelection={() => setSelected(new Set())} />` between the tabs and the table.

- [ ] **Step 5: Commit**

```bash
cd "$REPO" && git add batch_webui/src && git commit -m "feat: add single and bulk markdown downloads"
```

---

### Task 17: Delete with confirmation

**Files:**
- Create: `batch_webui/src/components/ConfirmDialog.tsx`
- Modify: `batch_webui/src/App.tsx`

**Interfaces:**
- Consumes: `remove` from `useBatchApi`.
- Produces: `<ConfirmDialog open title body confirmLabel onConfirm onCancel />`.

- [ ] **Step 1: Implement the dialog**

```tsx
interface Props {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ open, title, body, confirmLabel, onConfirm, onCancel }: Props) {
  if (!open) return null
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-30 flex items-center justify-center bg-black/30">
      <div className="w-96 rounded-lg bg-white p-6 shadow-xl">
        <h2 className="text-lg font-medium">{title}</h2>
        <p className="mt-2 text-sm text-slate-600">{body}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded border px-4 py-2">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className="rounded bg-red-600 px-4 py-2 text-white">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire delete into `App.tsx`**

Add `const [confirming, setConfirming] = useState<null | 'delete' | 'clear'>(null)`, point `SelectionActions`' `onDelete` at `setConfirming('delete')`, point the run bar's `onClear` at `setConfirming('clear')`, and render:

```tsx
      <ConfirmDialog
        open={confirming !== null}
        title={confirming === 'clear' ? 'Clear the input directory?' : `Delete ${selected.size} document(s)?`}
        body={
          confirming === 'clear'
            ? 'Every file in ee-in is removed. Converted Markdown in ee-md is kept.'
            : 'The input file and its converted Markdown are both removed. This cannot be undone.'
        }
        confirmLabel={confirming === 'clear' ? 'Clear input' : 'Delete'}
        onCancel={() => setConfirming(null)}
        onConfirm={async () => {
          if (confirming === 'clear') await clear()
          else {
            await remove([...selected])
            setSelected(new Set())
          }
          setConfirming(null)
        }}
      />
```

- [ ] **Step 3: Verify against a live server**

Select two converted rows and delete them; confirm both the input and the `.md` disappear from disk. Then press **Stop** mid-run and confirm delete is refused with the server's 409 message shown in the error banner.

- [ ] **Step 4: Commit**

```bash
cd "$REPO" && git add batch_webui/src && git commit -m "feat: add document deletion with confirmation"
```

---

### Task 18: Server connection indicator

**Files:**
- Create: `batch_webui/src/components/ServerIndicator.tsx`
- Modify: `batch_webui/src/App.tsx`

**Interfaces:**
- Consumes: `connected: boolean` and `status` from `useBatchApi`.
- Produces: the fixed bottom-right indicator.

- [ ] **Step 1: Implement**

```tsx
import { useState } from 'react'
import type { StatusResponse } from '../api/types'

interface Props {
  connected: boolean
  status: StatusResponse | null
}

export function ServerIndicator({ connected, status }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <div className="fixed right-4 bottom-4 flex items-center gap-2 text-xs opacity-80 select-none">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex items-center gap-2">
        <span className={`h-3 w-3 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
        <span className="text-slate-500">{connected ? 'Connected' : 'Disconnected'}</span>
      </button>
      {open && status && (
        <div className="absolute right-4 bottom-8 w-72 rounded border bg-white p-3 text-left shadow-lg">
          <p>
            <strong>storage</strong> {status.config.output_dir}
          </p>
          <p>
            <strong>queued</strong> {status.config.queued_in_input}
          </p>
          <p>
            <strong>mineru</strong> {status.config.environment.mineru_version}
          </p>
          <p>
            <strong>device</strong> {status.config.environment.device}
          </p>
          <p>
            <strong>run</strong> {status.state}
          </p>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire into `App.tsx`**

```tsx
      <ServerIndicator connected={connected} status={status} />
```

Destructure `connected` from `useBatchApi()`.

- [ ] **Step 3: Verify**

Stop the API (`Ctrl-C` on the foreground server) and confirm the dot turns red within a poll interval; restart it and confirm it returns to green.

- [ ] **Step 4: Commit**

```bash
cd "$REPO" && git add batch_webui/src && git commit -m "feat: add the server connection indicator"
```

---

### Task 19: Settings panel

**Files:**
- Create: `batch_webui/src/components/SettingsPanel.tsx`
- Modify: `batch_webui/src/App.tsx`
- Test: `batch_webui/src/lib/settingsText.test.ts`

**Interfaces:**
- Consumes: `ConfigRecord`.
- Produces: `describeChange(record: ConfigRecord): string`; `<SettingsPanel records={ConfigRecord[]} />`.

- [ ] **Step 1: Write the failing test**

`batch_webui/src/lib/settingsText.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { ConfigRecord } from '../api/types'
import { describeChange } from './settingsText'

const base: ConfigRecord = {
  key: 'tier',
  label: 'Parse tier',
  value: 'basic',
  source: 'env',
  env_var: 'MINERU_BATCH_TIER',
  config_file: null,
  effect: 'restart',
}

describe('describeChange', () => {
  it('names the env var and the restart for service parameters', () => {
    expect(describeChange(base)).toContain('MINERU_BATCH_TIER')
    expect(describeChange(base)).toContain('restart')
  })

  it('names the config file and the next-run effect for MinerU parameters', () => {
    const text = describeChange({ ...base, key: 'small_backend', env_var: 'MINERU_MODEL_SMALL_BACKEND', config_file: '/home/x/.mineru/config.yaml', effect: 'next_run' })
    expect(text).toContain('MINERU_MODEL_SMALL_BACKEND')
    expect(text).toContain('/home/x/.mineru/config.yaml')
    expect(text).toContain('next run')
  })

  it('says a read-only value is not configurable', () => {
    expect(describeChange({ ...base, effect: 'read_only' })).toMatch(/detected|not configurable/i)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd "$REPO/batch_webui" && bun run test src/lib/settingsText.test.ts`
Expected: FAIL — cannot resolve `./settingsText`.

- [ ] **Step 3: Implement**

`batch_webui/src/lib/settingsText.ts`:

```ts
import type { ConfigRecord } from '../api/types'

/** How to change this value, in one line, derived only from what the server declared. */
export function describeChange(record: ConfigRecord): string {
  if (record.effect === 'read_only') {
    return 'Detected at runtime; not configurable here.'
  }
  const knobs: string[] = []
  if (record.env_var) knobs.push(`set ${record.env_var}`)
  if (record.config_file) knobs.push(`or edit ${record.config_file}`)
  const where = knobs.length ? knobs.join(' ') : 'edit the service environment'
  return record.effect === 'next_run'
    ? `${where} — takes effect on the next run`
    : `${where}, then systemctl restart mineru-batch-api`
}
```

`batch_webui/src/components/SettingsPanel.tsx`:

```tsx
import type { ConfigRecord } from '../api/types'
import { describeChange } from '../lib/settingsText'

export function SettingsPanel({ records }: { records: ConfigRecord[] }) {
  return (
    <table className="w-full text-left text-sm">
      <thead className="border-b text-slate-500">
        <tr>
          <th className="p-2">Parameter</th>
          <th className="p-2">Value</th>
          <th className="p-2">Source</th>
          <th className="p-2">How to change it</th>
        </tr>
      </thead>
      <tbody>
        {records.map((record) => (
          <tr key={record.key} className="border-b align-top">
            <td className="p-2 font-medium">{record.label}</td>
            <td className="p-2 font-mono text-xs">{String(record.value)}</td>
            <td className="p-2 text-slate-600">{record.source}</td>
            <td className="p-2 text-slate-600">{describeChange(record)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

- [ ] **Step 4: Wire into `App.tsx` behind a toggle**

```tsx
      <button type="button" onClick={() => setShowSettings((value) => !value)} className="self-start text-sm text-blue-700 hover:underline">
        {showSettings ? 'Hide server parameters' : 'Server parameters'}
      </button>
      {showSettings && status && <SettingsPanel records={status.config.records} />}
```

- [ ] **Step 5: Handle a token-protected server**

`MINERU_BATCH_TOKEN` is off by default, but when it is set the console would otherwise fail every call with a bare 401. Make the token a stored, user-supplied value rather than a build-time one: in `batch_webui/src/api/client.ts`, attach it when present —

```ts
http.interceptors.request.use((config) => {
  const token = localStorage.getItem('mineru-batch-token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})
```

and in `SettingsPanel`, when the `token_required` record's value is `true`, render a password field that writes to `localStorage` and reloads the page:

```tsx
{records.find((record) => record.key === 'token_required')?.value === true && (
  <label className="mt-4 flex items-center gap-2 text-sm">
    API token
    <input
      type="password"
      defaultValue={localStorage.getItem('mineru-batch-token') ?? ''}
      onChange={(event) => localStorage.setItem('mineru-batch-token', event.target.value)}
      className="rounded border px-2 py-1"
    />
  </label>
)}
```

- [ ] **Step 6: Run the tests**

Run: `cd "$REPO/batch_webui" && bun run test`
Expected: 23 passed.

- [ ] **Step 7: Commit**

```bash
cd "$REPO" && git add batch_webui/src && git commit -m "feat: add the read-only server parameters panel"
```

---

### Task 20: Full acceptance and deploy

**Files:**
- Modify: `README.md` (add run/deploy instructions)

- [ ] **Step 1: Run every automated check**

```bash
cd "$REPO" && "$PY" -m pytest tests -v
cd "$REPO/batch_webui" && bunx tsc --noEmit && bun run test && bun run build
```

Expected: all green; `dist/index.html` present.

- [ ] **Step 2: Walk the acceptance list from §9.4 of the spec**

1. Drop one file → conversion starts with no further clicks; same via the upload button, once multi-select and once with a folder.
2. Click the row → Markdown renders, formulas typeset.
3. Download the result; download a multi-select as a zip.
4. Drop a folder → a second run appends; relative paths preserved.
5. Multi-select delete removes input and result; refused while running.
6. Settings panel shows values, sources, the changing knob, and when it takes effect.
7. Kill the API mid-run, restart it → the run is adopted and progress restored.
8. Stop the API → the indicator turns red; start it → green again.

- [ ] **Step 3: Confirm no site specifics leaked into the repository**

```bash
cd "$REPO" && git grep -nE "/home/[a-z]+/|192\.168\.|/mnt/" -- . ':!docs/superpowers/specs' ':!batch.env.example' || echo "clean"
```

Expected: `clean`.

- [ ] **Step 4: Document and commit**

```bash
cd "$REPO" && git add README.md && git commit -m "docs: add run and deploy instructions"
```

---

## Notes for the executor

- **Never modify `batch-convert.py`.** If a task seems to need it, stop and raise it — that would be a spec change.
- **Never push.** The remote is configured; publishing is a separate, explicit decision by the repository owner.
- `dist/` is gitignored and built at deploy time. If a build is missing, `GET /` falls back to `batch_ui.html` — that fallback is intentional and must keep working.
