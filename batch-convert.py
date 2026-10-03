#!/usr/bin/env python3
"""Batch-convert a document tree to Markdown, resumably and in one process.

Why this exists instead of `mineru-kit parse`:

* `mineru-kit parse` writes a flat output tree (duplicate stems across subdirectories
  are a hard error), does not recurse, has no resume, and calls `exit_with_message`
  on the first failing file, which aborts the entire batch. Over a multi-hour run
  across a heavy corpus, a single malformed PDF would waste the whole run.

This runner mirrors the input tree, skips documents already converted, isolates
per-file failures, and reports a rate per file so a slow tier is visible immediately.

Run it from the venv that owns MinerU, e.g.:

    /home/wing/Apps/mineru/bin/python batch-convert.py --input ~/ee-in --output ~/ee-md

Markdown is rendered in-process, so the local models load once for the whole batch
(see `model/runtime/hybrid.py`: the model singletons are module-level caches).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterator

from mineru.filetypes import batch_effective_parse_tier, is_office_temp_lock_file
from mineru.kit.common import OUTPUT_FILE_SUFFIXES, PARSEABLE_SUFFIXES
from mineru.parser.mineru_parser import MinerUParser
from mineru.types import validate_tier
from mineru.utils.logger import configure_global_log_level

IMAGE_MODES = ("marker", "drop", "inline")
SKIPPED = "skipped"
DONE = "done"
FAILED = "failed"


def log(message: str) -> None:
    """Write a progress line straight through, so it reaches journald immediately."""
    print(message, flush=True)


def iter_documents(root: Path) -> Iterator[Path]:
    """Yield parseable documents under root, depth-first and in sorted order.

    Dot-directories are pruned and Office lock files (`~$...`) are skipped, matching
    the behaviour of the built-in scanners.
    """
    if root.is_file():
        yield root
        return

    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(name for name in dirnames if not name.startswith("."))
        for name in sorted(filenames):
            if name.startswith("."):
                continue
            candidate = Path(dirpath) / name
            if candidate.suffix.lower() not in PARSEABLE_SUFFIXES:
                continue
            if is_office_temp_lock_file(candidate):
                continue
            yield candidate


def build_image_renderer(mode: str) -> Callable[[Any], str] | None:
    """Return the `ImageRenderer` hook for --image-mode, or None for inline data URIs.

    On a fresh (un-materialized) parse every figure carries `image_base64`, and
    `resolve_image_source` falls through to it, so the default `markdown()` output
    embeds figures as `data:image/jpeg;base64,...`. Those blobs are huge and are pure
    noise in an LLM context window, so the default here replaces the reference with a
    short positional marker. Either way the renderer still emits the text recognised
    inside the figure (see `_render_details` in the markdown internals).
    """
    if mode == "inline":
        return None
    if mode == "drop":
        return lambda block: ""

    def marker(block: Any) -> str:
        return f"\n<!-- figure omitted: {type(block).__name__} -->\n"

    return marker


@dataclass
class Entry:
    """Outcome of one document."""

    input: str
    output: str
    status: str
    tier: str
    seconds: float | None = None
    pages: int | None = None
    error: str | None = None
    code: str | None = None


@dataclass
class Totals:
    """Running totals for the summary and the end-of-run report."""

    entries: list[Entry] = field(default_factory=list)

    def count(self, status: str) -> int:
        return sum(1 for entry in self.entries if entry.status == status)

    @property
    def pages(self) -> int:
        return sum(entry.pages or 0 for entry in self.entries)

    @property
    def seconds(self) -> float:
        return sum(entry.seconds or 0.0 for entry in self.entries)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input", required=True, type=Path, help="Input file or directory tree")
    parser.add_argument("--output", required=True, type=Path, help="Output directory for mirrored .md files")
    parser.add_argument("--tier", default="standard", help="Parse tier: flash, basic, standard, advanced")
    parser.add_argument("--ocr-mode", default="auto", choices=("auto", "txt", "ocr"), help="OCR mode")
    parser.add_argument("--pages", default="", help="PDF page range, e.g. '1-5,8'. Empty means all pages")
    parser.add_argument("--image-mode", default="marker", choices=IMAGE_MODES, help="How figures appear in the .md")
    parser.add_argument("--force", action="store_true", help="Re-convert even if the .md already exists")
    parser.add_argument("--limit", type=int, default=0, help="Stop after N documents (0 = no limit)")
    parser.add_argument("--report", type=Path, default=None, help="Write a JSON run report to this path")
    parser.add_argument(
        "--no-image-analysis",
        dest="image_analysis",
        action="store_false",
        help="Disable image analysis (only affects the advanced tier)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    configure_global_log_level()

    tier = validate_tier(args.tier)
    renderer = build_image_renderer(args.image_mode)
    parsers: dict[str, MinerUParser] = {}

    def parser_for(effective_tier: str) -> MinerUParser:
        """Reuse one parser per tier; model loading is cached in the shared singletons."""
        if effective_tier not in parsers:
            parsers[effective_tier] = MinerUParser(
                tier=effective_tier,  # type: ignore[arg-type]
                parse_mode=args.ocr_mode,
                image_analysis=args.image_analysis,
            )
        return parsers[effective_tier]

    if not args.input.exists():
        log(f"input not found: {args.input}")
        return 2

    documents = list(iter_documents(args.input))
    if args.limit > 0:
        documents = documents[: args.limit]
    if not documents:
        log(f"no parseable documents under {args.input}")
        return 2

    totals = Totals()
    failures_path = args.output / "failures.txt"
    started_at = time.perf_counter()
    log(f"{len(documents)} document(s); tier={tier} image-mode={args.image_mode} pages={args.pages or 'all'}")

    for index, source in enumerate(documents, start=1):
        try:
            relative = source.relative_to(args.input) if args.input.is_dir() else Path(source.name)
        except ValueError:
            relative = Path(source.name)
        destination = (args.output / relative).with_suffix(OUTPUT_FILE_SUFFIXES["markdown"])

        if destination.exists() and not args.force:
            totals.entries.append(Entry(str(source), str(destination), SKIPPED, tier))
            log(f"[{index}/{len(documents)}] skip (exists) {relative}")
            continue

        # Flash-only formats (Office/HTML/EPUB/OFD/CSV) cannot use a quality tier;
        # this returns "flash" for them and never raises.
        effective_tier = batch_effective_parse_tier(tier, source)
        entry = Entry(str(source), str(destination), FAILED, effective_tier)
        began = time.perf_counter()
        try:
            result = parser_for(effective_tier).parse(source, page_range=args.pages)
            markdown = result.markdown(image_renderer=renderer)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(markdown, encoding="utf-8")
            entry.status = DONE
            entry.pages = len(result.pages)
        except Exception as exc:  # isolate one bad document; never abort the batch
            entry.error = f"{type(exc).__name__}: {exc}"
            entry.code = getattr(exc, "code", None)
        entry.seconds = time.perf_counter() - began
        totals.entries.append(entry)

        if entry.status == DONE:
            rate = f"{entry.pages / entry.seconds:.2f} page/s" if entry.seconds else "n/a"
            elapsed = time.perf_counter() - started_at
            remaining = len(documents) - index
            eta = f" eta~{remaining * totals.seconds / max(index - totals.count(SKIPPED), 1):.0f}s" if remaining else ""
            log(
                f"[{index}/{len(documents)}] {relative} {entry.pages}p "
                f"{entry.seconds:.1f}s ({rate}) elapsed={elapsed:.0f}s{eta}"
            )
        else:
            code = f" code={entry.code}" if entry.code else ""
            log(f"[{index}/{len(documents)}] FAILED {relative}{code} {entry.error}")

    failures_path.parent.mkdir(parents=True, exist_ok=True)
    failed = [entry for entry in totals.entries if entry.status == FAILED]
    if failed:
        failures_path.write_text("\n".join(f"{entry.input}\t{entry.error}" for entry in failed) + "\n", encoding="utf-8")

    summary = {
        "input": str(args.input),
        "output": str(args.output),
        "tier": tier,
        "image_mode": args.image_mode,
        "pages_range": args.pages or "all",
        "documents": len(totals.entries),
        "done": totals.count(DONE),
        "skipped": totals.count(SKIPPED),
        "failed": len(failed),
        "pages": totals.pages,
        "seconds": round(totals.seconds, 3),
        "pages_per_second": round(totals.pages / totals.seconds, 4) if totals.seconds else None,
        "wall_seconds": round(time.perf_counter() - started_at, 3),
        "failures_file": str(failures_path) if failed else None,
        "entries": [entry.__dict__ for entry in totals.entries],
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    log(
        f"done: {summary['done']} converted, {summary['skipped']} skipped, {summary['failed']} failed; "
        f"{summary['pages']} pages in {summary['seconds']:.1f}s "
        f"({summary['pages_per_second'] or 0:.2f} page/s)"
    )
    if failed:
        log(f"failures written to {failures_path}")
    return 1 if failed else 0


if __name__ == "__main__":
    # The VLM path (tier standard) can segfault inside native-library teardown at
    # interpreter shutdown — after every file has been written and the report flushed.
    # That surfaces as exit 139, which would report a *successful* chunk as failed to
    # systemd. Flush explicitly, then bypass destructors entirely via os._exit.
    code = main()
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(code)
