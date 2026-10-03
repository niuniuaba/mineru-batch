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
