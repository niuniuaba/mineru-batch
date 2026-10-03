"""Content is served inline for the preview; download stays a download."""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

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


@pytest.mark.parametrize("name", ["a b.md", "q?x.md", "hash#x.md", "plus+x.md", "café.md"])
def test_content_round_trips_awkward_names(api: TestClient, tmp_path: Path, name: str) -> None:
    _write_result(tmp_path, name, "# ok")
    response = api.get("/api/results/content", params={"path": name})
    assert response.status_code == 200
    assert response.text == "# ok"


@pytest.mark.parametrize("name", ["a b.md", "q?x.md", "hash#x.md", "café.md"])
def test_download_round_trips_the_same_names(api: TestClient, tmp_path: Path, name: str) -> None:
    """The download route shares the guard, so it must agree with content on odd names."""
    _write_result(tmp_path, name, "# ok")
    response = api.get("/api/results/download", params={"path": name})
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
