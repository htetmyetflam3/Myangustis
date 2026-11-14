#!/usr/bin/env python3
"""Exercise the staged ``python`` branch engine on deliberately wrong spelling.

The staging copy in ``Junk/staging/main`` is the ``python`` branch head
(8a4424b) extracted with ``git archive`` — no working-tree edits, no
``__pycache__``, no ``.git``.

What the engine's *actual* flags are, from
``A.Engine/architecture/myangustis_engine/init/bridge.py``:

    bind_engine({'sourceText': str, 'flag': 'syllable'|'pos'|'template',
                 'log': bool = True, 'debug': bool = False, 'quiet': bool = False},
                logger=Logen(...))

  * ``log``   — bool; when True and a logger is supplied, SEGMENT/TAGGER
                records are emitted to it. ``api.collect`` hard-codes
                ``log: False``, so the convenience helpers never log.
  * ``debug`` — bool, but only False is accepted: True raises
                ``NotImplementedError('The bridge debug path is intentionally
                not mirrored')``. So "debug off" is the only usable setting.

Round 1 runs with ``log=True`` (records captured to ``engine.log``), round 2
with ``log=False`` (same text, same everything else). Both rounds write their
segmentation and POS output so they can be compared.
"""

from __future__ import annotations

import asyncio
import contextlib
import io
import json
import sys
import traceback
from argparse import ArgumentParser
from pathlib import Path

HERE = Path(__file__).resolve().parent
STAGED_ENGINE = HERE / "main" / "A.Engine" / "architecture"
sys.path.insert(0, str(STAGED_ENGINE))

import myangustis_engine                                            # noqa: E402
from myangustis_engine.init.bridge import bind_engine               # noqa: E402
from myangustis_engine.logen import Logen                           # noqa: E402

if not str(Path(myangustis_engine.__file__).resolve()).startswith(str(STAGED_ENGINE)):
    raise SystemExit(
        "refusing to run: imported "
        f"{myangustis_engine.__file__} instead of the staged copy {STAGED_ENGINE}"
    )


async def _collect(request, logger):
    return [item async for item in bind_engine(request, logger=logger)]


def run_flag(text, flag, *, log, debug, logger):
    request = {"sourceText": text, "flag": flag, "log": log, "debug": debug}
    return asyncio.run(_collect(request, logger))


def one_round(text, out_dir, *, log, debug, label):
    out_dir.mkdir(parents=True, exist_ok=True)
    log_file = out_dir / "engine.log"
    log_file.unlink(missing_ok=True)
    console = []
    logger = Logen(file=log_file, console=console.append)

    # Anything the engine prints directly (outside the logger) is captured too,
    # so "logging off" really means nothing was written anywhere.
    captured = io.StringIO()
    with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
        syllables = run_flag(text, "syllable", log=log, debug=debug, logger=logger)
        units = run_flag(text, "pos", log=log, debug=debug, logger=logger)
    (out_dir / "stdout.txt").write_text(captured.getvalue(), encoding="utf-8")

    (out_dir / "segmentation.txt").write_text(
        "\n".join(syllables) + ("\n" if syllables else ""), encoding="utf-8")
    (out_dir / "pos.syllable.txt").write_text(
        "\n".join(unit["syllable"] for unit in units) + ("\n" if units else ""), encoding="utf-8")
    (out_dir / "pos.raw.txt").write_text(
        "\n".join(unit["rawPos"] for unit in units) + ("\n" if units else ""), encoding="utf-8")
    (out_dir / "console.txt").write_text(
        "\n".join(console) + ("\n" if console else ""), encoding="utf-8")
    if not log_file.exists():
        log_file.write_text("", encoding="utf-8")   # an honest, empty sink

    # What actually happens when the debug switch is switched on.
    debug_attempt = out_dir / "debug-true-attempt.txt"
    debug_attempt.unlink(missing_ok=True)
    try:
        run_flag(text, "syllable", log=log, debug=True, logger=logger)
        debug_attempt.write_text("debug=True ran without an error\n", encoding="utf-8")
    except Exception:                                   # noqa: BLE001 - evidence
        debug_attempt.write_text(traceback.format_exc(), encoding="utf-8")

    summary = {
        "round": label,
        "flags": {"log": log, "debug": debug},
        "engine_file": str(Path(myangustis_engine.__file__).resolve()),
        "engine_commit": "8a4424b",
        "source_chars": len(text),
        "source_lines": len(text.splitlines()),
        "syllable_units": len(syllables),
        "pos_units": len(units),
        "log_bytes": log_file.stat().st_size,
        "log_lines": len(log_file.read_text(encoding="utf-8").splitlines()),
        "console_lines": len(console),
        "stdout_lines": len(captured.getvalue().splitlines()),
    }
    (out_dir / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return summary


def main(argv=None):
    parser = ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input", default=str(HERE / "input.txt"))
    parser.add_argument("--runs", default=str(HERE / "runs"))
    args = parser.parse_args(argv)

    text = Path(args.input).read_text(encoding="utf-8")
    runs = Path(args.runs)
    summaries = [
        one_round(text, runs / "round-1-log-on", log=True, debug=False,
                  label="log=True, debug=False"),
        one_round(text, runs / "round-2-log-off", log=False, debug=False,
                  label="log=False, debug=False"),
    ]

    for summary in summaries:
        print(json.dumps(summary, ensure_ascii=False))
    same = all(
        (runs / "round-1-log-on" / name).read_text(encoding="utf-8")
        == (runs / "round-2-log-off" / name).read_text(encoding="utf-8")
        for name in ("segmentation.txt", "pos.syllable.txt", "pos.raw.txt")
    )
    print(f"segmentation/POS identical across rounds: {same}")
    return 0 if same else 1


if __name__ == "__main__":
    raise SystemExit(main())
