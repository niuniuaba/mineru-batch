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
