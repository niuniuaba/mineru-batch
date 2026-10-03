#!/usr/bin/env python3
"""Control plane for the MinerU batch runner.

A thin HTTP wrapper around `batch-convert.py`, which stays the engine: this process
only accepts uploads, starts the runner as a child, relays its stdout as progress, and
serves the converted Markdown back. Nothing about the conversion path changes, so the
mirrored `.md` tree on disk remains the durable artifact and `rsync` still works.

Run it with the venv that owns MinerU:

    /home/wing/Apps/mineru/bin/python batch_api.py

Configuration is by environment variable (see `CONFIG` below); every path defaults to the
`/mnt/nas/media/mineru` layout the batch service uses.
"""

from __future__ import annotations

import asyncio
import fcntl
import json
import os
import re
import sys
import tempfile
import time
import zipfile
from contextlib import asynccontextmanager
from pathlib import Path, PurePosixPath
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.background import BackgroundTask

# Reuse the runner's own definitions of "parseable" and "Office lock file" so the queue we
# show can never drift from what the runner will actually pick up.
from batch_settings import get_settings
from mineru.filetypes import is_office_temp_lock_file
from mineru.kit.common import PARSEABLE_SUFFIXES

BASE = Path(__file__).resolve().parent


# The runner's per-document lines are the progress protocol; everything else on stdout
# (loguru banners, tqdm bars) is ignored.
RE_DOC_TOTAL = re.compile(r"^(\d+) document\(s\); tier=(\S+) image-mode=(\S+) pages=(\S+)$")
RE_DONE = re.compile(r"^\[(\d+)/(\d+)\] (.+?) (\d+)p ([\d.]+)s \(([\d.]+) page/s\)")
RE_FAILED = re.compile(r"^\[(\d+)/(\d+)\] FAILED (.+?)(?: code=(\S+))? (\S.*)$")
RE_SKIP = re.compile(r"^\[(\d+)/(\d+)\] skip \(exists\) (.+)$")
RE_SUMMARY = re.compile(r"^done: (\d+) converted, (\d+) skipped, (\d+) failed")
RE_WINDOW = re.compile(r"Hybrid processing window (\d+)/(\d+): pages (\S+?)/(\d+)")

# The run's stdout/stderr are redirected here and tailed, rather than read from a pipe.
# A pipe would break under the child if this process died, killing the conversion; a file
# lets the conversion outlive an API restart, and lets a restarted API replay progress.


def _pid_alive(pid: int | None) -> bool:
    """Whether a process still exists (used instead of waitpid for unattended runs)."""
    if not pid:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


class RunState:
    """Live state of the current or most recent run."""

    def __init__(self) -> None:
        self.state = "idle"  # idle | running | done | failed
        self.process: asyncio.subprocess.Process | None = None
        self.monitor: asyncio.Task[None] | None = None
        self.pid: int | None = None
        self.external = False  # running, but started by a previous API process
        self.started_at: float | None = None
        self.ended_at: float | None = None
        self.returncode: int | None = None
        self.total = 0
        self.current: str | None = None
        self.window = ""
        self.message = ""
        self.stopped = False
        self.files: dict[str, dict[str, Any]] = {}
        self.lock_handle: Any = None

    def reset(self) -> None:
        self.state = "running"
        self.external = False
        self.started_at = time.time()
        self.ended_at = None
        self.returncode = None
        self.total = 0
        self.current = None
        self.window = ""
        self.message = ""
        self.stopped = False
        self.files = {}

    def row(self, relative: str) -> dict[str, Any]:
        return self.files.setdefault(
            relative, {"name": relative, "status": "queued", "pages": None, "seconds": None, "rate": None, "error": None}
        )

    def summary(self) -> dict[str, Any]:
        # The runner prints a line only when a document *finishes*, so a long document
        # would otherwise leave the UI with nothing to name. It processes in the order we
        # queued them, so the head of the queue stands in for "running" — no engine change.
        if self.state == "running":
            for row in self.files.values():
                if row["status"] == "queued":
                    row["status"] = "running"
                    self.current = row["name"]
                    break

        counts = {"queued": 0, "running": 0, "done": 0, "skipped": 0, "failed": 0}
        for row in self.files.values():
            counts[row["status"]] = counts.get(row["status"], 0) + 1
        return {
            "state": self.state,
            "external": self.external,
            "pid": self.pid,
            "current_file": self.current,
            "window": self.window,
            "message": self.message,
            "returncode": self.returncode,
            "total": self.total or len(self.files),
            "started_at": self.started_at,
            "ended_at": self.ended_at,
            "counts": counts,
            "files": list(self.files.values()),
        }


state = RunState()


def _safe_relative(relative: str) -> PurePosixPath:
    """Validate a client-supplied relative path, refusing anything absolute or escaping.

    This is the security boundary for both uploads (which write) and downloads (which
    read), so it rejects rather than rewrites: absolute paths, Windows drive letters,
    any `..` segment, and null bytes.
    """
    raw = (relative or "").replace("\\", "/").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="missing relative path")
    if "\x00" in raw:
        raise HTTPException(status_code=400, detail="null byte in path")
    posix = PurePosixPath(raw)
    if posix.is_absolute() or raw.startswith("/"):
        raise HTTPException(status_code=400, detail=f"absolute path not allowed: {relative}")
    if ":" in posix.parts[0]:
        raise HTTPException(status_code=400, detail=f"drive-qualified path not allowed: {relative}")
    if any(part == ".." for part in posix.parts):
        raise HTTPException(status_code=400, detail=f"parent traversal not allowed: {relative}")
    return posix


def _resolve_within(root: Path, relative: str) -> Path:
    """Resolve `relative` under `root`, guaranteeing the result stays inside it.

    `resolve()` also follows any symlink in the existing prefix, so a symlink pointing out
    of the tree is refused here too.
    """
    posix = _safe_relative(relative)
    root_real = root.resolve()
    target = (root_real / posix).resolve()
    if target != root_real and root_real not in target.parents:
        raise HTTPException(status_code=400, detail=f"path escapes {root.name}: {relative}")
    return target


def _input_documents() -> list[str]:
    """List what the runner will pick up, in exactly the order it will process them.

    The order is load-bearing: the runner prints a line only when a document *finishes*,
    so the head of this queue is what the UI shows as "running". It must therefore mirror
    `iter_documents` in batch-convert.py precisely — os.walk order (root before
    subdirectories, each level sorted), the same parseable suffixes, Office lock files
    skipped — and must not be re-sorted globally, which would put nested paths ahead of
    root ones and misattribute the running document.
    """
    if not get_settings().input_dir.is_dir():
        return []
    found: list[str] = []
    for dirpath, dirnames, filenames in os.walk(get_settings().input_dir):
        dirnames[:] = sorted(name for name in dirnames if not name.startswith("."))
        for name in sorted(filenames):
            if name.startswith("."):
                continue
            path = Path(dirpath) / name
            if not path.is_file():
                continue
            if path.suffix.lower() not in PARSEABLE_SUFFIXES:
                continue
            if is_office_temp_lock_file(path):
                continue
            found.append(path.relative_to(get_settings().input_dir).as_posix())
    return found


def _stem(relative: str) -> str:
    """A document's identity: its path with the extension dropped.

    A row is named after its converted file (`a.md`) while its input keeps the original
    suffix (`a.pdf`), so matching on the stem is what makes those one document instead
    of two unrelated rows.
    """
    return PurePosixPath(relative).with_suffix("").as_posix()


def _input_suffix(relative: str) -> str:
    """The original extension of the input behind `relative`, or "" when it is unknown.

    A row is named after its converted file (`a.md`) while the input keeps its own
    extension (`a.pdf`), and only the input tree knows what that was.
    """
    stem = _stem(relative)
    for candidate in _input_documents():
        if _stem(candidate) == stem:
            return Path(candidate).suffix
    return ""


def _result_index() -> dict[str, dict[str, Any]]:
    """Converted documents keyed by their path inside ee-md, joined with the run report."""
    settings = get_settings()
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
        }
    return results


def _blank_row(relative: str) -> dict[str, Any]:
    return {
        "path": relative,
        "status": "pending",
        "pages": None,
        "seconds": None,
        "rate": None,
        "bytes": None,
        "error": None,
        "has_input": False,
        "has_result": False,
    }


def _document_rows() -> list[dict[str, Any]]:
    """One row per document, merged from the live run, the results tree, and ee-in."""
    rows: dict[str, dict[str, Any]] = {}

    for relative in _input_documents():
        row = _blank_row(relative)
        row["has_input"] = True
        rows.setdefault(_stem(relative), row)

    for relative, info in _result_index().items():
        stem = _stem(relative)
        row = rows.get(stem) or _blank_row(relative)
        row["path"] = relative
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
        rows[stem] = row

    if state.state == "running":
        for relative, live in state.files.items():
            stem = _stem(relative)
            row = rows.get(stem) or _blank_row(relative)
            row.update({key: value for key, value in live.items() if key != "name"})
            rows[stem] = row

    return sorted(rows.values(), key=lambda row: row["path"])


def _handle_line(line: str) -> None:
    """Translate one runner/MinerU output line into a state update."""
    line = line.strip()
    if not line:
        return

    match = RE_WINDOW.search(line)
    if match:
        state.window = f"window {match.group(1)}/{match.group(2)} (pages {match.group(3)}/{match.group(4)})"
        return

    match = RE_DOC_TOTAL.match(line)
    if match:
        state.total = int(match.group(1))
        return

    match = RE_DONE.match(line)
    if match:
        relative = match.group(3)
        row = state.row(relative)
        row.update(
            status="done",
            pages=int(match.group(4)),
            seconds=float(match.group(5)),
            rate=float(match.group(6)),
            error=None,
        )
        state.current = None
        state.window = ""
        return

    match = RE_FAILED.match(line)
    if match:
        relative = match.group(3)
        row = state.row(relative)
        row.update(status="failed", error=match.group(5), pages=None, seconds=None, rate=None)
        state.current = None
        state.window = ""
        return

    match = RE_SKIP.match(line)
    if match:
        state.row(match.group(3)).update(status="skipped")
        state.current = None
        state.window = ""
        return

    match = RE_SUMMARY.match(line)
    if match:
        state.state = "done"
        state.message = line
        state.current = None
        state.window = ""
        return
    # Anything else (loguru banners, tqdm bars) carries no progress we need.


async def _tail_run(log_path: Path, pid: int | None, process: asyncio.subprocess.Process | None) -> None:
    """Follow the run log until the run finishes, updating state from its lines.

    Replaying from the start is safe and intentional: every recognised line is an
    idempotent state update, so a restarted API rebuilds the same picture rather than
    losing progress. Completion is the runner's summary line, or the process exiting.
    """
    handle = open(log_path, "rb")
    buffer = ""
    try:
        while True:
            chunk = handle.read()
            if chunk:
                buffer += chunk.decode("utf-8", "replace")
                parts = re.split(r"[\r\n]", buffer)  # tqdm separates with bare CR
                buffer = parts.pop()
                for part in parts:
                    _handle_line(part)
                if state.state == "done":
                    break
                continue
            if not _pid_alive(pid):
                remainder = handle.read()
                if remainder:
                    buffer += remainder.decode("utf-8", "replace")
                break
            await asyncio.sleep(0.5)
    finally:
        if buffer.strip():
            for part in re.split(r"[\r\n]", buffer):
                _handle_line(part)
        handle.close()

        if process is not None:
            try:
                state.returncode = await process.wait()
            except Exception:
                state.returncode = None

        state.ended_at = time.time()
        if state.stopped:
            state.state = "done"
            state.message = "stopped by request; completed documents were kept"
        elif state.state != "done":
            state.state = "failed"
            state.message = (
                "the runner rejected its input (exit 2)"
                if state.returncode == 2
                else f"the run ended without a summary line — see {log_path}"
            )

        # On a normal finish every document carries a terminal status. Anything still
        # queued means the run ended early, and those files were never attempted — so they
        # stay "queued" rather than being mislabelled as skipped; a re-run resumes them.
        pending = [row for row in state.files.values() if row["status"] in ("queued", "running")]
        for row in pending:
            row["status"] = "queued"
        if pending:
            state.current = None
            state.message = f"{state.message}; {len(pending)} document(s) were not processed"
        state.process = None
        _release_lock()


def _release_lock() -> None:
    if state.lock_handle is not None:
        try:
            fcntl.flock(state.lock_handle, fcntl.LOCK_UN)
            state.lock_handle.close()
        except OSError:
            pass
        state.lock_handle = None


def _acquire_lock() -> bool:
    """Take the exclusive run lock and hold it for the run. False if a run holds it.

    The lock represents *a run in progress*, never this process's lifetime: flock treats
    separate file descriptors in the same process as independent lockers, so holding it
    from startup would make every later `start` fail against ourselves. `api_start` also
    passes this descriptor to the conversion, so the lock outlives this process.
    """
    get_settings().root.mkdir(parents=True, exist_ok=True)
    handle = open(get_settings().lock_path, "a+")
    try:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        return False
    handle.seek(0)
    handle.truncate()
    handle.write(f"{os.getpid()}\n")
    handle.flush()
    state.lock_handle = handle
    return True


def _probe_lock() -> bool:
    """Report whether another process currently holds the run lock, without holding it."""
    if not get_settings().lock_path.exists():
        return False
    handle = open(get_settings().lock_path, "a+")
    try:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        return True  # genuinely held elsewhere => a run is in progress
    fcntl.flock(handle, fcntl.LOCK_UN)
    handle.close()
    return False


@asynccontextmanager
async def lifespan(_: FastAPI):
    get_settings().input_dir.mkdir(parents=True, exist_ok=True)
    get_settings().output_dir.mkdir(parents=True, exist_ok=True)
    if _probe_lock():
        # A previous API process left a run going. Adopt it: take its pid, rebuild the
        # queue, and resume tailing the run log from the start so progress is restored
        # rather than lost with the previous process.
        try:
            state.pid = int(get_settings().lock_path.read_text().split()[0])
        except (OSError, ValueError, IndexError):
            state.pid = None
        state.state = "running"
        state.external = True
        state.message = "adopted a run started by a previous API process"
        for relative in _input_documents():
            state.row(relative)
        if get_settings().run_log.is_file():
            state.monitor = asyncio.create_task(_tail_run(get_settings().run_log, state.pid, None))
    yield
    if state.process is not None:
        state.process.terminate()
    _release_lock()


app = FastAPI(title="MinerU batch control plane", lifespan=lifespan)


@app.middleware("http")
async def check_token(request: Request, call_next):
    if get_settings().token and request.url.path.startswith("/api/"):
        if request.headers.get("authorization") != f"Bearer {get_settings().token}":
            return JSONResponse({"detail": "invalid token"}, status_code=401)
    return await call_next(request)


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


@app.get("/api/status")
async def api_status() -> dict[str, Any]:
    payload = state.summary()
    payload["config"] = {
        "tier": get_settings().tier,
        "image_mode": get_settings().image_mode,
        "input_dir": str(get_settings().input_dir),
        "output_dir": str(get_settings().output_dir),
        "queued_in_input": len(_input_documents()),
    }
    return payload


@app.get("/api/documents")
async def api_documents() -> dict[str, Any]:
    """Every document, merged from the live run, ee-md and ee-in."""
    rows = _document_rows()
    counts: dict[str, int] = {}
    for row in rows:
        counts[row["status"]] = counts.get(row["status"], 0) + 1
    return {"state": state.state, "counts": counts, "files": rows}


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
    delete_result = bool(body.get("delete_result", True))

    deleted: list[dict[str, Any]] = []
    missing: list[str] = []
    for raw in paths:
        relative = str(raw)
        # Validate against both roots before touching anything: an unsafe path fails the
        # request rather than being skipped, because it means the caller is confused.
        result_target = _resolve_within(settings.output_dir, relative)
        input_target = _resolve_within(settings.input_dir, _stem(relative) + _input_suffix(relative))

        removed_result = False
        removed_input = False
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


@app.post("/api/upload")
async def api_upload(
    files: list[UploadFile] = File(...),
    relative_paths: list[str] = Form(default=[]),
) -> dict[str, Any]:
    """Store uploaded files under the input directory, preserving relative paths."""
    get_settings().input_dir.mkdir(parents=True, exist_ok=True)
    saved: list[dict[str, Any]] = []
    for index, upload in enumerate(files):
        relative = relative_paths[index] if index < len(relative_paths) else (upload.filename or "")
        target = _resolve_within(get_settings().input_dir, relative)
        target.parent.mkdir(parents=True, exist_ok=True)
        size = 0
        with open(target, "wb") as handle:
            while chunk := await upload.read(1024 * 1024):
                size += len(chunk)
                if size > get_settings().max_upload_bytes:
                    handle.close()
                    target.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=413,
                        detail=f"{upload.filename} exceeds the {get_settings().max_upload_bytes // (1024 * 1024)} MB per-file limit",
                    )
                handle.write(chunk)
        saved.append({"path": target.relative_to(get_settings().input_dir).as_posix(), "bytes": size})
    return {"saved": saved, "count": len(saved)}


@app.post("/api/start")
async def api_start() -> dict[str, Any]:
    documents = _input_documents()
    if not documents:
        raise HTTPException(status_code=400, detail=f"nothing to convert in {get_settings().input_dir}")
    if state.state == "running":
        raise HTTPException(status_code=409, detail="a run is already in progress")
    if not _acquire_lock():
        raise HTTPException(status_code=409, detail="a run is already in progress in another process")

    state.reset()
    for relative in documents:
        state.row(relative)
    command = [
        sys.executable,
        str(get_settings().runner),
        "--input", str(get_settings().input_dir),
        "--output", str(get_settings().output_dir),
        "--tier", get_settings().tier,
        "--image-mode", get_settings().image_mode,
        "--report", str(get_settings().report),
    ]
    # The conversion inherits the run-lock descriptor. An flock belongs to the open file
    # description, so passing it on makes the lock last exactly as long as the conversion
    # rather than as long as this API process. Without it, killing the API would release
    # the lock while the conversion kept running, and a restarted API would see a free
    # lock and start a SECOND run over the same output tree.
    lock_fd = state.lock_handle.fileno() if state.lock_handle is not None else None

    # Truncate the run log so this run's output stands alone, then hand the file to the
    # child directly: a file survives an API restart, a pipe would not.
    log_handle = open(get_settings().run_log, "wb")
    try:
        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=log_handle,
            stderr=log_handle,
            cwd=str(BASE),
            pass_fds=([lock_fd] if lock_fd is not None else []),
        )
    finally:
        log_handle.close()

    state.process = process
    state.pid = process.pid
    # Record the CONVERSION's pid (not ours) so a restarted API can tell whether the run
    # is still alive.
    if state.lock_handle is not None:
        state.lock_handle.seek(0)
        state.lock_handle.truncate()
        state.lock_handle.write(f"{process.pid}\n")
        state.lock_handle.flush()
    state.monitor = asyncio.create_task(_tail_run(get_settings().run_log, process.pid, process))
    return {"started": True, "documents": len(documents), "pid": process.pid}


@app.post("/api/stop")
async def api_stop() -> dict[str, Any]:
    if state.state != "running":
        raise HTTPException(status_code=409, detail="no run in progress")
    pid = state.pid
    state.stopped = True
    if state.process is not None:
        state.process.terminate()
        state.message = "stopped by request; completed files are kept"
    elif pid:
        try:
            os.kill(pid, 15)
        except ProcessLookupError:
            _release_lock()
            state.state = "done"
            state.message = "the unattended run had already finished"
            state.external = False
            return {"stopped": True, "note": state.message}
        state.message = "signalled the unattended run to stop; completed files are kept"
    return {"stopped": True, "pid": pid}


@app.post("/api/clear")
async def api_clear() -> dict[str, Any]:
    if state.state == "running":
        raise HTTPException(status_code=409, detail="refusing to clear the input directory while a run is in progress")
    removed = 0
    for path in sorted(get_settings().input_dir.rglob("*"), reverse=True):
        if path.is_file():
            path.unlink()
            removed += 1
        elif path.is_dir():
            path.rmdir()
    return {"removed": removed}


@app.get("/api/results")
async def api_results() -> dict[str, Any]:
    """Converted documents, from the filesystem so it also covers earlier runs."""
    metadata: dict[str, dict[str, Any]] = {}
    if get_settings().report.is_file():
        try:
            for entry in json.loads(get_settings().report.read_text(encoding="utf-8")).get("entries", []):
                output = Path(entry.get("output", ""))
                try:
                    key = output.relative_to(get_settings().output_dir).as_posix()
                except ValueError:
                    continue
                metadata[key] = entry
        except (OSError, ValueError):
            pass

    documents: list[dict[str, Any]] = []
    for path in sorted(get_settings().output_dir.rglob("*.md")):
        if not path.is_file():
            continue
        key = path.relative_to(get_settings().output_dir).as_posix()
        info = metadata.get(key, {})
        stat = path.stat()
        documents.append(
            {
                "path": key,
                "bytes": stat.st_size,
                "modified": stat.st_mtime,
                "pages": info.get("pages"),
                "seconds": info.get("seconds"),
                "status": info.get("status", "unknown"),
            }
        )
    return {"documents": documents, "count": len(documents), "total_bytes": sum(d["bytes"] for d in documents)}


@app.get("/api/results/content")
async def api_result_content(path: str) -> Response:
    """One converted document, inline, for in-app preview."""
    target = _resolve_within(get_settings().output_dir, path)
    if target.suffix.lower() != ".md" or not target.is_file():
        raise HTTPException(status_code=404, detail=f"not a converted markdown file: {path}")
    return Response(content=target.read_text(encoding="utf-8"), media_type="text/markdown; charset=utf-8")


@app.get("/api/results/download")
async def api_download(path: str) -> FileResponse:
    target = _resolve_within(get_settings().output_dir, path)
    if target.suffix.lower() != ".md" or not target.is_file():
        raise HTTPException(status_code=404, detail=f"not a converted markdown file: {path}")
    return FileResponse(target, media_type="text/markdown", filename=target.name)


@app.post("/api/results/zip")
async def api_zip(request: Request) -> FileResponse:
    """Zip the selected documents, preserving their relative paths inside the archive."""
    body = await request.json()
    paths = body.get("paths") if isinstance(body, dict) else None
    if not isinstance(paths, list) or not paths:
        raise HTTPException(status_code=400, detail="provide a non-empty list of paths")

    handle = tempfile.NamedTemporaryFile(prefix="mineru-batch-", suffix=".zip", delete=False)
    added = 0
    try:
        with zipfile.ZipFile(handle, "w", zipfile.ZIP_DEFLATED) as archive:
            for relative in paths:
                # Each entry is validated independently; one bad path fails the request.
                target = _resolve_within(get_settings().output_dir, str(relative))
                if target.suffix.lower() != ".md" or not target.is_file():
                    continue
                archive.write(target, arcname=target.relative_to(get_settings().output_dir.resolve()).as_posix())
                added += 1
    finally:
        handle.close()
    if not added:
        Path(handle.name).unlink(missing_ok=True)
        raise HTTPException(status_code=404, detail="none of the selected paths are converted markdown files")

    name = f"mineru-markdown-{time.strftime('%Y%m%d-%H%M%S')}.zip"
    temp_path = handle.name
    return FileResponse(
        temp_path,
        media_type="application/zip",
        filename=name,
        background=BackgroundTask(lambda: Path(temp_path).unlink(missing_ok=True)),
    )


def _mount_console(application: FastAPI) -> None:
    """Mount built assets under `/assets`, last, so `/api/*` routes keep precedence.

    Serving only the hashed asset directory — rather than mounting the whole build at `/`
    — keeps the fallback path working and leaves room for future routes.
    """
    assets = get_settings().ui_dist / "assets"
    if assets.is_dir():
        application.mount("/assets", StaticFiles(directory=assets), name="assets")


_mount_console(app)


def main() -> None:
    import uvicorn

    if not get_settings().runner.is_file():
        print(f"runner not found: {get_settings().runner}", file=sys.stderr, flush=True)
        raise SystemExit(2)
    print(f"batch control plane on http://{get_settings().host}:{get_settings().port}/  tier={get_settings().tier} image-mode={get_settings().image_mode}", flush=True)
    print(f"  input  {get_settings().input_dir}", flush=True)
    print(f"  output {get_settings().output_dir}", flush=True)
    print(f"  auth   {'bearer token required' if get_settings().token else 'none (LAN-open)'}", flush=True)
    uvicorn.run(app, host=get_settings().host, port=get_settings().port, log_level="warning")


if __name__ == "__main__":
    main()
