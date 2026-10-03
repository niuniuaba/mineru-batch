"""The path guard is the security boundary for uploads, downloads and deletes."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi import HTTPException

import batch_api


@pytest.mark.parametrize(
    "relative",
    [
        "/etc/passwd",
        "C:/Windows/system32",
        "../outside.md",
        "a/../../outside.md",
        "nested/../../outside.md",
        "",
        "   ",
        "null\x00byte.md",
    ],
)
def test_safe_relative_refuses_escaping_paths(relative: str) -> None:
    with pytest.raises(HTTPException) as caught:
        batch_api._safe_relative(relative)
    assert caught.value.status_code == 400


def test_safe_relative_accepts_nested_relative_paths() -> None:
    assert batch_api._safe_relative("a/b/c.pdf").as_posix() == "a/b/c.pdf"


def test_resolve_within_refuses_symlink_escape(tmp_path: Path) -> None:
    root = tmp_path / "root"
    root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.md").write_text("secret", encoding="utf-8")
    os.symlink(outside, root / "link")

    with pytest.raises(HTTPException) as caught:
        batch_api._resolve_within(root, "link/secret.md")
    assert caught.value.status_code == 400


def test_resolve_within_stays_inside_root(tmp_path: Path) -> None:
    root = tmp_path / "root"
    (root / "sub").mkdir(parents=True)
    resolved = batch_api._resolve_within(root, "sub/file.md")
    assert resolved == (root / "sub" / "file.md").resolve()
