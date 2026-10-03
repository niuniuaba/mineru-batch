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
