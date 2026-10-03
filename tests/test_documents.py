"""The merged view is the console's only source of document state."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient


def _write_result(root: Path, relative: str, text: str = "# hi") -> Path:
    target = (root / "ee-md" / relative).with_suffix(".md")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")
    return target


def _write_input(root: Path, relative: str) -> Path:
    target = root / "ee-in" / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("pdf", encoding="utf-8")
    return target


def _rows(api: TestClient) -> dict[str, dict]:
    return {row["path"]: row for row in api.get("/api/documents").json()["files"]}


def test_pending_when_only_the_input_exists(api: TestClient, tmp_path: Path) -> None:
    _write_input(tmp_path, "a.pdf")
    row = _rows(api)["a.pdf"]
    assert row["status"] == "pending"
    assert row["has_input"] is True
    assert row["has_result"] is False


def test_converted_when_only_the_result_exists(api: TestClient, tmp_path: Path) -> None:
    """A cleared input tree must not turn a converted document back into 'pending'."""
    _write_result(tmp_path, "a.pdf")
    row = _rows(api)["a.md"]
    assert row["status"] == "converted"
    assert row["has_input"] is False
    assert row["has_result"] is True


def test_input_and_result_are_one_row(api: TestClient, tmp_path: Path) -> None:
    """A document is named by its result; the input is matched by stem, not by path."""
    _write_input(tmp_path, "a.pdf")
    _write_result(tmp_path, "a.pdf")
    files = api.get("/api/documents").json()["files"]
    assert [row["path"] for row in files] == ["a.md"]
    assert files[0]["has_input"] is True
    assert files[0]["has_result"] is True
    assert files[0]["status"] == "converted"


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
    row = _rows(api)["a.md"]
    assert row["pages"] == 3
    assert row["seconds"] == 1.5
    assert row["bytes"] == result.stat().st_size
    assert row["rate"] == 2.0


def test_live_run_state_wins_over_filesystem(api: TestClient, tmp_path: Path) -> None:
    import batch_api

    _write_input(tmp_path, "a.pdf")
    batch_api.state.state = "running"
    batch_api.state.row("a.pdf").update(status="running")
    assert _rows(api)["a.pdf"]["status"] == "running"


def test_live_run_state_matches_a_converted_document_by_stem(api: TestClient, tmp_path: Path) -> None:
    import batch_api

    _write_input(tmp_path, "a.pdf")
    _write_result(tmp_path, "a.pdf")
    batch_api.state.state = "running"
    batch_api.state.row("a.pdf").update(status="running")
    payload = api.get("/api/documents").json()
    assert [row["path"] for row in payload["files"]] == ["a.md"]
    assert payload["files"][0]["status"] == "running"


def test_same_basename_in_different_directories_stays_distinct(api: TestClient, tmp_path: Path) -> None:
    _write_result(tmp_path, "a/report.pdf")
    _write_result(tmp_path, "b/report.pdf")
    assert set(_rows(api)) == {"a/report.md", "b/report.md"}


def test_counts_match_the_rows(api: TestClient, tmp_path: Path) -> None:
    _write_input(tmp_path, "a.pdf")
    _write_result(tmp_path, "b.pdf")
    payload = api.get("/api/documents").json()
    assert payload["counts"]["pending"] == 1
    assert payload["counts"]["converted"] == 1


def test_empty_root_is_idle_with_no_rows(api: TestClient) -> None:
    payload = api.get("/api/documents").json()
    assert payload == {"state": "idle", "counts": {}, "files": []}
