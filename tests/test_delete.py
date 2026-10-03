"""Deleting a document removes its input and, by default, its result."""

from __future__ import annotations

import os
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


def test_delete_of_a_pending_document_removes_only_the_input(api: TestClient, tmp_path: Path) -> None:
    source = tmp_path / "ee-in" / "queued.pdf"
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_text("pdf", encoding="utf-8")
    response = api.post("/api/documents/delete", json={"paths": ["queued.pdf"]})
    assert response.status_code == 200
    assert not source.exists()
    assert response.json()["deleted"] == [{"path": "queued.pdf", "input": True, "result": False}]


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
    assert api.post("/api/documents/delete", json={"paths": ["a.md"]}).status_code == 409


def test_delete_refuses_traversal(api: TestClient) -> None:
    assert api.post("/api/documents/delete", json={"paths": ["../batch_api.py"]}).status_code == 400


def test_delete_refuses_a_symlink_out_of_the_tree(api: TestClient, tmp_path: Path) -> None:
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.md").write_text("secret", encoding="utf-8")
    (tmp_path / "ee-md").mkdir(exist_ok=True)
    os.symlink(outside, tmp_path / "ee-md" / "link")

    response = api.post("/api/documents/delete", json={"paths": ["link/secret.md"]})
    assert response.status_code == 400
    assert (outside / "secret.md").exists()


def test_delete_requires_a_non_empty_list(api: TestClient) -> None:
    assert api.post("/api/documents/delete", json={"paths": []}).status_code == 400
    assert api.post("/api/documents/delete", json={}).status_code == 400


def test_delete_reports_missing_without_failing_the_batch(api: TestClient, tmp_path: Path) -> None:
    _seed(tmp_path, "a.pdf")
    response = api.post("/api/documents/delete", json={"paths": ["a.md", "gone.md"]})
    assert response.status_code == 200
    assert response.json()["missing"] == ["gone.md"]
