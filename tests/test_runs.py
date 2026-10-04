"""Run-level behaviour the console depends on: queue state, failed documents, cleanup."""

from __future__ import annotations

import json
import tempfile as tempfile_module
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


def _write_result(root: Path, relative: str, text: str = "# ok") -> Path:
    target = (root / "ee-md" / relative).with_suffix(".md")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")
    return target


def _write_input(root: Path, relative: str) -> Path:
    target = root / "ee-in" / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("pdf", encoding="utf-8")
    return target


def _write_report(root: Path, entries: list[dict]) -> Path:
    report = root / "ee-md" / "run-report.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps({"entries": entries}), encoding="utf-8")
    return report


def _rows(api: TestClient) -> dict[str, dict]:
    return {row["path"]: row for row in api.get("/api/documents").json()["files"]}


def _entry(root: Path, stem: str, status: str, **over) -> dict:
    entry = {
        "input": str(root / "ee-in" / f"{stem}.pdf"),
        "output": str(root / "ee-md" / f"{stem}.md"),
        "status": status,
        "tier": "basic",
        "seconds": 1.0,
        "pages": 2 if status != "failed" else None,
        "error": None,
        "code": None,
    }
    entry.update(over)
    return entry


def test_summary_does_not_advance_the_queue() -> None:
    """Reading the state must not change it: the console polls this every 1.5 seconds."""
    import batch_api

    state = batch_api.RunState()
    state.state = "running"
    for name in ("a.pdf", "b.pdf", "c.pdf"):
        state.row(name)

    first = state.summary()
    second = state.summary()
    third = state.summary()

    assert [row["status"] for row in state.files.values()] == ["queued"] * 3
    assert first["current_file"] == second["current_file"] == third["current_file"] == "a.pdf"


def test_repeated_document_reads_leave_the_queue_alone(api: TestClient, tmp_path: Path) -> None:
    import batch_api

    for name in ("a.pdf", "b.pdf", "c.pdf"):
        _write_input(tmp_path, name)
    batch_api.state.state = "running"
    for name in ("a.pdf", "b.pdf", "c.pdf"):
        batch_api.state.row(name)

    for _ in range(5):
        payload = api.get("/api/documents").json()

    statuses = sorted(row["status"] for row in payload["files"])
    assert statuses == ["queued", "queued", "running"], "the head stands in for running; the rest must stay queued"
    assert [row["path"] for row in payload["files"] if row["status"] == "running"] == ["a.pdf"]


def test_a_failed_document_keeps_its_error_after_the_run(api: TestClient, tmp_path: Path) -> None:
    """Spec §6.5: a failed row carries the runner's message — and must keep carrying it."""
    _write_report(tmp_path, [_entry(tmp_path, "a", "failed", error="ValueError: boom")])
    rows = {row["path"]: row for row in api.get("/api/documents").json()["files"]}
    assert rows["a.md"]["status"] == "failed"
    assert rows["a.md"]["error"] == "ValueError: boom"


def test_a_skipped_document_reads_as_converted_after_the_run(api: TestClient, tmp_path: Path) -> None:
    _write_result(tmp_path, "a.pdf")
    _write_report(tmp_path, [_entry(tmp_path, "a", "skipped")])
    rows = {row["path"]: row for row in api.get("/api/documents").json()["files"]}
    assert rows["a.md"]["status"] == "converted"
    assert rows["a.md"]["has_result"] is True


def test_delete_is_all_or_nothing(api: TestClient, tmp_path: Path) -> None:
    """One unsafe path must not destroy the safe ones that preceded it in the request."""
    source = _write_input(tmp_path, "a.pdf")
    result = _write_result(tmp_path, "a.pdf")

    response = api.post("/api/documents/delete", json={"paths": ["a.md", "../evil.md"]})

    assert response.status_code == 400
    assert source.exists(), "the input was deleted even though the request was refused"
    assert result.exists(), "the result was deleted even though the request was refused"


def test_zip_leaves_no_temp_file_behind_on_failure(api: TestClient, tmp_path: Path, monkeypatch) -> None:
    created: list[str] = []
    real = tempfile_module.NamedTemporaryFile

    def spy(*args, **kwargs):
        handle = real(*args, **kwargs)
        created.append(handle.name)
        return handle

    import batch_api

    monkeypatch.setattr(batch_api.tempfile, "NamedTemporaryFile", spy)
    _write_result(tmp_path, "a.pdf")

    response = api.post("/api/results/zip", json={"paths": ["a.md", "../evil.md"]})

    assert response.status_code == 400
    assert created, "the zip was never created, so this test proves nothing"
    for name in created:
        assert not Path(name).exists(), f"leaked {name}"


def test_start_refuses_a_second_run(api: TestClient, tmp_path: Path) -> None:
    import batch_api

    _write_input(tmp_path, "a.pdf")
    batch_api.state.state = "running"
    assert api.post("/api/start").status_code == 409


def test_start_reports_an_empty_input_directory(api: TestClient) -> None:
    response = api.post("/api/start")
    assert response.status_code == 400
    assert "nothing to convert" in response.json()["detail"]


def test_stop_refuses_when_nothing_is_running(api: TestClient) -> None:
    assert api.post("/api/stop").status_code == 409


def test_clear_empties_the_input_tree_only(api: TestClient, tmp_path: Path) -> None:
    _write_input(tmp_path, "sub/a.pdf")
    _write_result(tmp_path, "a.pdf")
    response = api.post("/api/clear")
    assert response.status_code == 200
    assert not any((tmp_path / "ee-in").rglob("*"))
    assert (tmp_path / "ee-md" / "a.md").exists()


def test_clear_is_refused_while_running(api: TestClient, tmp_path: Path) -> None:
    import batch_api

    _write_input(tmp_path, "a.pdf")
    batch_api.state.state = "running"
    assert api.post("/api/clear").status_code == 409


@pytest.mark.parametrize("relative", ["../outside.pdf", "/etc/passwd"])
def test_upload_refuses_an_escaping_path(api: TestClient, relative: str) -> None:
    response = api.post(
        "/api/upload",
        files={"files": ("a.pdf", b"data", "application/pdf")},
        data={"relative_paths": relative},
    )
    assert response.status_code == 400


def test_upload_preserves_nested_relative_paths(api: TestClient, tmp_path: Path) -> None:
    response = api.post(
        "/api/upload",
        files={"files": ("a.pdf", b"data", "application/pdf")},
        data={"relative_paths": "papers/sub/a.pdf"},
    )
    assert response.status_code == 200
    assert (tmp_path / "ee-in" / "papers" / "sub" / "a.pdf").read_bytes() == b"data"


def test_upload_refuses_an_oversize_file(api: TestClient, tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("MINERU_BATCH_MAX_UPLOAD_BYTES", "10")
    import batch_settings

    batch_settings.reset_settings()
    try:
        response = api.post(
            "/api/upload",
            files={"files": ("big.pdf", b"x" * 100, "application/pdf")},
            data={"relative_paths": "big.pdf"},
        )
        assert response.status_code == 413
        assert not (tmp_path / "ee-in" / "big.pdf").exists(), "a rejected upload must not be left on disk"
    finally:
        batch_settings.reset_settings()


# ── Review findings ─────────────────────────────────────────────────────────


@pytest.mark.parametrize("path", [".", "./", "..", "../x", "/etc/passwd"])
def test_degenerate_paths_are_refused_with_400_not_500(api: TestClient, path: str) -> None:
    """`.` has no parts, so indexing parts[0] raised IndexError behind the security guard."""
    assert api.get("/api/results/content", params={"path": path}).status_code == 400


def test_a_failed_line_with_spaces_is_attributed_to_the_right_document(monkeypatch) -> None:
    """Document names in real corpora contain spaces; the (path)(error) split is ambiguous."""
    import batch_api

    state = batch_api.RunState()
    state.state = "running"
    state.row("my report.pdf")
    state.row("other.pdf")
    monkeypatch.setattr(batch_api, "state", state)

    batch_api._handle_line("[1/2] FAILED my report.pdf ValueError: bad")

    assert state.files["my report.pdf"]["status"] == "failed"
    assert state.files["my report.pdf"]["error"] == "ValueError: bad"
    assert "my" not in state.files, "the ambiguous split created a bogus row"


def test_a_failed_line_with_a_code_suffix_is_parsed(monkeypatch) -> None:
    import batch_api

    state = batch_api.RunState()
    state.state = "running"
    state.row("my report.pdf")
    monkeypatch.setattr(batch_api, "state", state)

    batch_api._handle_line("[1/2] FAILED my report.pdf code=unsupported FileNotFoundError: gone")

    assert state.files["my report.pdf"]["status"] == "failed"
    assert state.files["my report.pdf"]["error"] == "FileNotFoundError: gone"


def test_start_releases_the_lock_when_the_spawn_fails(api: TestClient, tmp_path: Path, monkeypatch) -> None:
    """A failed spawn must not leave the service reporting a run it never started."""
    import batch_api

    _write_input(tmp_path, "a.pdf")

    async def boom(*args, **kwargs):
        raise OSError("cannot execute")

    monkeypatch.setattr(batch_api.asyncio, "create_subprocess_exec", boom)
    # TestClient re-raises the server exception; the cleanup is what is under test.
    with pytest.raises(OSError):
        api.post("/api/start")

    assert batch_api.state.state != "running"
    assert batch_api.state.lock_handle is None, "the run lock was left held"
    assert batch_api._probe_lock() is False


def test_documents_reads_the_report_once(api: TestClient, tmp_path: Path, monkeypatch) -> None:
    import batch_api

    _write_result(tmp_path, "a.pdf")
    _write_report(tmp_path, [_entry(tmp_path, "a", "done")])
    calls = {"n": 0}
    real = batch_api._report_entries

    def counting():
        calls["n"] += 1
        return real()

    monkeypatch.setattr(batch_api, "_report_entries", counting)
    api.get("/api/documents")
    assert calls["n"] <= 1, f"the run report was parsed {calls['n']} times in one request"


# ── issues.md items 4 and 5 ─────────────────────────────────────────────────


def test_a_deleted_document_disappears_from_the_list(api: TestClient, tmp_path: Path) -> None:
    """A stale run-report entry must not resurrect a document the user just deleted."""
    _write_input(tmp_path, "a.pdf")
    _write_result(tmp_path, "a.pdf")
    _write_report(tmp_path, [_entry(tmp_path, "a", "done")])
    assert {row["path"] for row in api.get("/api/documents").json()["files"]} == {"a.md"}

    api.post("/api/documents/delete", json={"paths": ["a.md"]})

    assert api.get("/api/documents").json()["files"] == [], "the deleted document came back"


def test_a_failed_document_with_no_output_still_appears(api: TestClient, tmp_path: Path) -> None:
    """The counterpart: a failure leaves no output by design, so it must still be listed."""
    _write_report(tmp_path, [_entry(tmp_path, "a", "failed", error="ValueError: boom")])
    rows = {row["path"]: row for row in api.get("/api/documents").json()["files"]}
    assert rows["a.md"]["status"] == "failed"


def test_delete_prunes_the_directories_it_empties(api: TestClient, tmp_path: Path) -> None:
    """Deleting the last document under a folder used to leave the folder skeleton behind."""
    _write_input(tmp_path, "x/y/a.pdf")
    _write_result(tmp_path, "x/y/a.pdf")

    api.post("/api/documents/delete", json={"paths": ["x/y/a.md"]})

    assert not any((tmp_path / "ee-md").rglob("*")), "empty folders survived in the output tree"
    assert not any((tmp_path / "ee-in").rglob("*")), "empty folders survived in the input tree"


def test_delete_keeps_directories_that_still_hold_something(api: TestClient, tmp_path: Path) -> None:
    _write_input(tmp_path, "x/a.pdf")
    _write_result(tmp_path, "x/a.pdf")
    _write_result(tmp_path, "x/keep.pdf")

    api.post("/api/documents/delete", json={"paths": ["x/a.md"]})

    assert (tmp_path / "ee-md" / "x" / "keep.md").exists()
    assert (tmp_path / "ee-md" / "x").is_dir()


def test_a_resume_keeps_the_measurements_the_first_run_recorded(api: TestClient, tmp_path: Path) -> None:
    """The runner records an already-converted document as skipped, with no measurements.

    Re-running used to overwrite the report and lose the page counts and timings, which is
    what a resume does routinely.
    """
    _write_result(tmp_path, "a.pdf")
    _write_report(tmp_path, [_entry(tmp_path, "a", "done", pages=7, seconds=3.5)])
    assert _rows(api)["a.md"]["pages"] == 7

    # Snapshot the first run's report, then let the second run report it as skipped.
    import shutil

    shutil.copy2(tmp_path / "ee-md" / "run-report.json", tmp_path / "run-report.previous.json")
    _write_report(tmp_path, [_entry(tmp_path, "a", "skipped", pages=None, seconds=None)])

    row = _rows(api)["a.md"]
    assert row["pages"] == 7, "the page count was lost by re-running"
    assert row["seconds"] == 3.5
    assert row["status"] == "converted"


def test_start_snapshots_the_report_it_is_about_to_replace(api: TestClient, tmp_path: Path, monkeypatch) -> None:
    import batch_api

    _write_input(tmp_path, "a.pdf")
    _write_result(tmp_path, "a.pdf")
    _write_report(tmp_path, [_entry(tmp_path, "a", "done", pages=5)])

    class FakeProcess:
        pid = 999_999

        async def wait(self) -> int:
            return 0

        def terminate(self) -> None:
            """The client's shutdown calls this; nothing is really running."""

    async def fake_spawn(*args, **kwargs):
        return FakeProcess()

    monkeypatch.setattr(batch_api.asyncio, "create_subprocess_exec", fake_spawn)
    # The monitor task would poll a pid that does not exist; keep it from running.
    monkeypatch.setattr(batch_api.asyncio, "create_task", lambda coro: coro.close() or None)

    api.post("/api/start")

    previous = tmp_path / "run-report.previous.json"
    assert previous.is_file(), "the report was not snapshotted, so a resume would lose it"
    assert json.loads(previous.read_text(encoding="utf-8"))["entries"][0]["pages"] == 5
