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
