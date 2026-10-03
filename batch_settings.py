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
