"""Read-only access to the Engine tagger, both views at once.

Engine/tag-text.mjs publishes only the word view (`{syllable:false,
rawPos:true}`). Quality work needs the smallest-unit view too, so this module
drives mt/quality/tag-both.mjs, which is the same pipeline with both writers
enabled. Nothing under Engine/ is written; each run gets a scratch WORK dir.

Word view vs unit view (this is the whole model, in one place):

  * The dictionary stores a word as its smallest units separated by TWO
    SPACES — `ရေ  တွင်း` (NOUN), `ရေ  တွက်` (VERB). One entry = one word.
  * The POS tree is built by splitting those entries on the two spaces and
    pushing the unit ids into a trie, so the tagger walks unit by unit and
    emits the family of the entry it matched. A multi-unit token therefore
    carries the entry's family, not a sum of its parts' families.
  * A single unit with several entries stays ambiguous (`ရေ{n,p}`).
  * There is no compound composition step: a space in the *input* is a hard
    boundary, so `ရေ တွင်း` and `ရေ  တွင်း` both come out as two tokens.
  * `Engine/Bridge/Ginit.js` is a pass-through kernel, so the compound
    sequences in the lower half of mainrules.js are not applied at runtime.

Usage as a library:

    from tag import tag_text
    sentences = tag_text("ရေတွင်း တစ်ခု။")
    sentences[0]["tokens"]        # [{"surface":…, "tags":[…], "syllables":[…]}]

Usage from the shell (dump the word view for a chapter):

    python3 mt/quality/tag.py --chapter 1
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SHIM = Path(__file__).resolve().with_name("tag-both.mjs")

TOKEN_RE = re.compile(r"^(?P<surface>.*?)\{(?P<tags>[^{}]*)\}$")
EOS = "<eos>"
FULLSTOP = "။"


class EngineError(RuntimeError):
    pass


def _split_tokens(segment: str) -> list[str]:
    """Tokens inside one <eos> segment are separated by exactly two spaces."""
    return [part for part in segment.split("  ") if part]


def _parse_word_view(text: str) -> list[list[dict]]:
    sentences: list[list[dict]] = []
    for segment in text.split(EOS):
        if not segment.strip():
            continue
        tokens: list[dict] = []
        for part in _split_tokens(segment.strip()):
            part = part.strip()
            if not part:
                continue
            match = TOKEN_RE.match(part)
            if match:
                tags = [tag for tag in match.group("tags").split(",") if tag]
                surface = match.group("surface")
            else:
                tags, surface = [], part
            if surface == FULLSTOP:
                continue
            tokens.append({"surface": surface, "tags": tags, "syllables": []})
        sentences.append(tokens)
    return sentences


def _parse_unit_view(text: str) -> list[list[str]]:
    sentences: list[list[str]] = []
    for segment in text.split(EOS):
        if not segment.strip():
            continue
        units = []
        for part in _split_tokens(segment.strip()):
            part = part.strip()
            if part and part != FULLSTOP:
                units.append(part)
        sentences.append(units)
    return sentences


def _attach_units(words: list[list[dict]], units: list[list[str]]) -> None:
    """Give every token the smallest units it is built from.

    Concatenating the units of a token reproduces its surface, so consume
    units until the buffer matches. A mismatch is not fatal (the caller can
    still count words) but it is recorded as `unit_mismatch`.
    """
    for word_sentence, unit_sentence in zip(words, units):
        cursor = 0
        buffer = ""
        for token in word_sentence:
            start = cursor
            buffer = ""
            while cursor < len(unit_sentence) and buffer != token["surface"]:
                buffer += unit_sentence[cursor]
                cursor += 1
            if buffer == token["surface"]:
                token["syllables"] = unit_sentence[start:cursor]
            else:
                # Resynchronise: keep whatever we consumed, flag the token.
                token["syllables"] = unit_sentence[start:cursor]
                token["unit_mismatch"] = True


def tag_text(text: str, work: Path | None = None, timeout: int = 300) -> list[dict]:
    """Tag `text`; returns one dict per `။`-terminated sentence."""
    scratch = None
    if work is None:
        scratch = Path(tempfile.mkdtemp(prefix="mt-quality-"))
        work = scratch
    work = Path(work)
    work.mkdir(parents=True, exist_ok=True)
    source = work / "source.txt"
    result_json = work / "result.json"
    source.write_text(text, encoding="utf-8")

    node = shutil.which("node")
    if not node:
        raise EngineError("node not found on PATH")
    # The shim reaches the engine through its own repo-relative Bridge facade,
    # so no cwd or external WASM guard is needed: one node process, one
    # BindEngine('proofreading') call, stats JSON written back.
    cmd = [node, str(SHIM), str(source), str(work / "engine"), str(result_json)]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if proc.returncode != 0 or not result_json.exists():
        raise EngineError(
            "tagger failed\n"
            f"  cmd: {' '.join(cmd)}\n"
            f"  exit: {proc.returncode}\n"
            f"  stderr: {proc.stderr.strip()[-2000:]}"
        )

    meta = json.loads(result_json.read_text(encoding="utf-8"))
    words = _parse_word_view(Path(meta["raw_pos_path"]).read_text(encoding="utf-8"))
    units = _parse_unit_view(Path(meta["syllable_path"]).read_text(encoding="utf-8"))
    if len(words) != len(units):
        raise EngineError(f"view mismatch: {len(words)} word sentences vs {len(units)} unit sentences")
    _attach_units(words, units)

    if scratch is not None and os.environ.get("MT_QUALITY_KEEP") != "1":
        shutil.rmtree(scratch, ignore_errors=True)

    return [
        {
            "index": sentence_index,
            "tokens": tokens,
            "sentence": "".join(token["surface"] for token in tokens) + FULLSTOP,
        }
        for sentence_index, tokens in enumerate(words)
    ]


def chapter_text(number: int, language: str = "my") -> tuple[str, str]:
    """Cleaned (title, body) for a chapter, 1-based, Burmese by default."""
    sys.path.insert(0, str(ROOT / "mt"))
    from translate import burmese_chapters, chinese_chapters  # noqa: WPS433

    chapters = burmese_chapters() if language == "my" else chinese_chapters()
    chapter = chapters[number - 1]
    body = re.sub(r"---\s*Page \d+\s*---", " ", chapter.body)
    body = re.sub(r"[ \t\u00a0]+", " ", body)
    # PDF rule lines (`.....`, `-----`) are page furniture, not prose.
    body = "\n".join(
        line for line in body.splitlines() if not re.fullmatch(r"[\s\-–—._=*]+", line)
    )
    body = re.sub(r"\n\s*\n+", "\n", body)
    return chapter.title.strip(), body.strip()


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args or args[0] in {"-h", "--help"}:
        print(__doc__.strip())
        return 0 if args else 2
    chapter = 1
    if args[0] == "--chapter":
        chapter = int(args[1])
        args = args[2:]
    title, body = chapter_text(chapter)
    print(f"# chapter {chapter}: {title}", file=sys.stderr)
    for sentence in tag_text(body):
        rendered = "  ".join(
            token["surface"] + "{" + ",".join(token["tags"]) + "}" for token in sentence["tokens"]
        )
        print(rendered + "  ။")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
