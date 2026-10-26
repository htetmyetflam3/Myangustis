# /// script
# requires-python = ">=3.10"
# dependencies = ["ctranslate2>=4", "sentencepiece>=0.1.99"]
# ///
"""Run the Chinese/English translation routes and write them to `content/mtranslate`.

    zh-en   Chinese -> English   offline model (installed by mt/fetch_engine.py)
    en-zh   English -> Chinese   offline model

That is the whole local set. There is no machine translation to or from
Burmese. The human Burmese source is retained for contextual reading but has
known encoding damage; API-generated Burmese outputs have been removed from the
current workflow. These routes let a local agent read the Chinese in English and
reverse-check that reading. Chinese -> Burmese was dropped deliberately — see
`MT.md`.

Engines are resolved in this order:

1. `--engine offline` — the locally installed Argos/OPUS model for that route.
   `mt/fetch_engine.py --check` lists what exists.
2. `--engine azure` — Azure Translator v3. Only runs when the environment already
   holds `AZURE_TRANSLATOR_KEY` and `AZURE_TRANSLATOR_REGION` (plus
   `AZURE_TRANSLATOR_ENDPOINT` if the resource is not global). The key is read
   from the environment and never written to disk or printed.
3. `--engine cmd` — any translator installed as a command; see `--cmd-template`.

Default output layout, when `--one-file` is used:

    content/mtranslate/zh-en.txt   all Chinese -> English chapters in one file
    content/mtranslate/en-zh.txt   all English -> Chinese chapters in one file

The older multi-file/report mode remains available for explicit legacy runs.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

CHINESE = ROOT / "content" / "source" / "chinese-0511241012-from-8011_1.txt"
BURMESE = ROOT / "content" / "source" / "ယဲ့နင်.txt"
OUTPUT = ROOT / "content" / "mtranslate"

ROUTES = {
    "zh-en": ("zh", "en"),
    "en-zh": ("en", "zh"),
}

# ---------------------------------------------------------------- chapters


@dataclass
class Chapter:
    number: int
    title: str
    body: str
    source: str


# Crawler OCR damage: katakana ー for 一, ハ for 八, 意 for 章 (第六四意),
# plus inline titles glued inside an unsplit section.
_CN_NUMERALS = "一二三四五六七八九十百千零〇ーハ"
_CN_TITLE = re.compile(r"第([" + _CN_NUMERALS + r"]+)[章意]")
_CN_GARBLED = str.maketrans({"ー": "一", "ハ": "八"})
# One mid-body OCR heading for chapter 241 uses `自` for `百` and `卓` for
# `章`. Do not accept `卓` globally: it is also a repeated page header and
# would split otherwise complete chapters into fragments.
_CN_241_TITLE = re.compile(r"第二自四十一卓")
_CN_DIGIT = {"〇": 0, "零": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
             "六": 6, "七": 7, "八": 8, "九": 9}


def _cn_label(numerals: str) -> int:
    numerals = numerals.translate(_CN_GARBLED)
    if not any(unit in numerals for unit in "十百千"):
        total = 0
        for char in numerals:
            total = total * 10 + _CN_DIGIT[char]
        return total
    return chinese_number(numerals)


def _chinese_boundaries(lines: list[str]) -> list[tuple[int, int, int, int, str]]:
    bounds: list[tuple[int, int, int, int, str]] = []
    for index, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("===== "):
            title = stripped.strip("= ").strip()
            match = _CN_TITLE.match(title)
            bare = re.fullmatch(r"\d+", title)
            if match:
                bounds.append((index, 0, len(line), _cn_label(match.group(1)), title))
            elif bare:
                bounds.append((index, 0, len(line), int(bare.group()), title))
        elif not stripped.startswith("[[KMTCRAWLER"):
            for match in _CN_TITLE.finditer(line):
                bounds.append((index, match.start(), match.end(),
                               _cn_label(match.group(1)), match.group(0).strip()))
            for match in _CN_241_TITLE.finditer(line):
                bounds.append((index, match.start(), match.end(), 241,
                               match.group(0).strip()))
    return bounds


def chinese_chapters(path: Path = CHINESE) -> list[Chapter]:
    lines = path.read_text(encoding="utf-8").split("\n")
    bounds = _chinese_boundaries(lines)
    chapters: list[Chapter] = []
    for order, (index, start_cut, end_cut, number, title) in enumerate(bounds, 1):
        if order < len(bounds):
            end_line, end_start = bounds[order][0], bounds[order][1]
        else:
            end_line, end_start = len(lines), 0
        if start_cut or end_cut:
            segment = [lines[index][end_cut:]] + lines[index + 1:end_line]
        else:
            segment = lines[index + 1:end_line]
        if end_start and segment:
            segment[-1] = segment[-1][:end_start]
        chapters.append(Chapter(number, title, "\n".join(segment).strip(), "chinese"))
    return chapters


@dataclass
class BurmeseChapter(Chapter):
    marker: int = 0


def english_chapters(route_dir: Path) -> list[Chapter]:
    """Chapters of an earlier zh-en run, used as the source for en-zh."""
    chapters: list[Chapter] = []
    for path in sorted((route_dir / "chapters").glob("ch*.en.txt")):
        match = re.match(r"ch(\d+)\.en\.txt$", path.name)
        if not match:
            continue
        lines = path.read_text(encoding="utf-8").split("\n")
        title = lines[0].strip() if lines else ""
        body = "\n".join(lines[2:]).strip()
        chapters.append(Chapter(int(match.group(1)), title, body, "english"))
    return chapters


# ---------------------------------------------------------------- one-file MT

MT_MARK = "===== Chapter {number} — {title} ====="
_MT_MARK = re.compile(r"^===== Chapter (\d+)(?: — (.*))? =====$", re.MULTILINE)
DEFAULT_MT_FILES = {
    "zh-en": OUTPUT / "zh-en.txt",
    "en-zh": OUTPUT / "en-zh.txt",
}


def select_unique_chapters(chapters: list[Chapter]) -> list[Chapter]:
    """Keep the longest parsed body per chapter, then return number order.

    The crawl can promote a running page header to a new chapter boundary.
    For those duplicate chapter numbers, the longest body is the full chapter;
    choosing it avoids translating a short header fragment.
    """
    grouped: dict[int, list[Chapter]] = {}
    for chapter in chapters:
        grouped.setdefault(chapter.number, []).append(chapter)
    selected: dict[int, Chapter] = {}
    for number, candidates in grouped.items():
        if number == 241 and len(candidates) > 1:
            # This OCR title is glued into the preceding chapter and repeated as
            # a page header. The parser therefore yields one fragment per page;
            # concatenate distinct fragments in source order instead of losing
            # all but the longest page. Remove the repeated page-title prefix
            # and crawler marker, while retaining the established longest-body
            # rule for every other duplicated chapter.
            fragments = []
            seen = set()
            for candidate in candidates:
                body_lines = candidate.body.splitlines()
                if body_lines and body_lines[0].lstrip().startswith((":", "：")):
                    body_lines = body_lines[1:]
                body_lines = [line for line in body_lines
                              if not line.startswith("[[KMTCRAWLER MARKER")]
                body = "\n".join(body_lines).strip()
                if body and body not in seen:
                    fragments.append(body)
                    seen.add(body)
            selected[number] = Chapter(number, "第二百四十一章",
                                       "\n".join(fragments), "chinese")
            continue
        selected[number] = max(candidates, key=lambda item: len(item.body))
    return [selected[number] for number in sorted(selected)]


def read_onefile(path: Path) -> list[Chapter]:
    """Read the chapter blocks from a local machine-translation text file."""
    if not path.is_file():
        raise FileNotFoundError(f"one-file translation input not found: {path}")
    text = path.read_text(encoding="utf-8")
    _, complete_end = scan_onefile(text)
    if complete_end < len(text):
        text = text[:complete_end]
    marks = list(_MT_MARK.finditer(text))
    if not marks:
        if text.strip():
            raise ValueError(f"{path} has text but no '===== Chapter N — title =====' headings")
        return []
    chapters = []
    for index, match in enumerate(marks):
        end = marks[index + 1].start() if index + 1 < len(marks) else len(text)
        body = text[match.end():end].strip("\r\n")
        # The serialized block has a blank line between the heading and body,
        # and two trailing newlines between chapters. Keep blank lines inside.
        body = body.lstrip("\r\n").rstrip("\r\n")
        chapters.append(Chapter(int(match.group(1)), match.group(2) or "",
                                body, "english"))
    return chapters


def scan_onefile(text: str) -> tuple[list[int], int]:
    """Return complete chapter numbers and the byte/text offset to resume at."""
    marks = [(match.start(), match.end(), int(match.group(1)))
             for match in _MT_MARK.finditer(text)]
    if not marks:
        if text.strip():
            raise ValueError("one-file output has content but no Chapter headings")
        return [], 0
    done: list[int] = []
    for index, (start, end, number) in enumerate(marks):
        block_end = marks[index + 1][0] if index + 1 < len(marks) else len(text)
        body = text[end:block_end].strip()
        if not body:
            return done, start
        if index == len(marks) - 1 and not text.endswith("\n\n"):
            return done, start
        done.append(number)
    return done, len(text)


class MachineOneFile:
    """Resumable single-output sink. It writes no cache, chapter files or report."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        existing = path.read_text(encoding="utf-8") if path.is_file() else ""
        self.done, cut = scan_onefile(existing)
        if cut < len(existing):
            path.write_text(existing[:cut], encoding="utf-8")
        self.handle = path.open("a", encoding="utf-8")

    def add(self, chapter: Chapter, translated: list[str]) -> None:
        heading = MT_MARK.format(number=chapter.number, title=chapter.title)
        self.handle.write(f"{heading}\n\n" + "\n".join(translated) + "\n\n")
        self.handle.flush()
        os.fsync(self.handle.fileno())
        self.done.append(chapter.number)

    def close(self) -> None:
        if not self.handle.closed:
            self.handle.close()

    def __enter__(self) -> "MachineOneFile":
        return self

    def __exit__(self, *exc) -> None:
        self.close()


def parse_chapter_range(spec: str) -> tuple[int, int]:
    try:
        low_text, high_text = spec.replace(" ", "").split("-", 1)
        low, high = int(low_text), int(high_text)
    except (ValueError, TypeError):
        raise ValueError("--chapters must be a range such as 1-408") from None
    if low < 1 or high < low:
        raise ValueError("--chapters must be a positive ascending range")
    return low, high


def run_onefile(route: str, *, engine_name: str, output: Path, chapters: list[Chapter],
                max_range: tuple[int, int], cmd_template: str | None = None) -> dict:
    """Translate one full range into exactly one text file, without sidecars."""
    source, target = ROUTES[route]
    engine = resolve(engine_name, source, target, cmd_template)
    available, detail = engine.available()
    if not available:
        raise RuntimeError(f"{route} engine unavailable: {detail}")
    low, high = max_range
    chosen = [chapter for chapter in chapters if low <= chapter.number <= high]
    if not chosen:
        raise ValueError(f"no parsed chapters in {low}-{high}")
    totals = {"route": route, "engine": engine.name, "range": [low, high],
              "parsed_chapters": len(chosen), "translated": 0, "skipped": 0,
              "sentences": 0, "empty": 0, "output": str(output)}
    try:
        with MachineOneFile(output) as sink:
            done = set(sink.done)
            totals["skipped"] = sum(ch.number in done for ch in chosen)
            wanted = [chapter for chapter in chosen if chapter.number not in done]
            for position, chapter in enumerate(wanted, 1):
                source_lines = sentences(chapter.body)
                result = engine.translate(source_lines, source, target)
                if len(result) != len(source_lines):
                    raise RuntimeError(f"{route} returned {len(result)} lines for "
                                       f"{len(source_lines)} source sentences in chapter {chapter.number}")
                sink.add(chapter, result)
                totals["translated"] += 1
                totals["sentences"] += len(source_lines)
                totals["empty"] += sum(not item.strip() for item in result)
                print(f"[mt-one-file] {position}/{len(wanted)} chapter {chapter.number}: "
                      f"{len(source_lines)} sentence(s)", flush=True)
            totals["chapters_in_file"] = len(sink.done)
    finally:
        close = getattr(engine, "close", None)
        if close:
            close()
    return totals


# Native PDF headings ("Chapter 1:", "အခန်း (၅)", "အပိုင်း ၅၁", split parts,
# Arabic-digit and OCR ရ-for-၇ variants); used when the text has no crawler markers.
_BURMESE_HEADING = re.compile(
    r"^Chapter\s*[\-\u2013:]?\s*(?P<cn>\d+)\b"
    r"|^(?:အခန်း|အပိုင်း)\s*[\-\u2013（(]?\s*"
    r"(?P<bn>[၀-၉0-9ရ]+)\s*[）)]?(?:\s*(?P<part>[၁၂]))?\s*$"
)


def _burmese_native_heads(lines: list[str]) -> list[tuple[int, int | None, str]]:
    heads: list[tuple[int, int | None, str]] = []
    for index, line in enumerate(lines):
        match = _BURMESE_HEADING.match(line.strip())
        if not match:
            continue
        if match.group("cn"):
            label: int | None = int(match.group("cn"))
        else:
            digit_map = {chr(0x1040 + i): str(i) for i in range(10)}
            digits = "".join(digit_map.get(char, char) for char in match.group("bn"))
            found = re.search(r"\d+", digits)
            label = int(found.group()) if found else None
        heads.append((index, label, line.strip()))
    for order, (index, label, title) in enumerate(heads):
        if label is None:
            previous = heads[order - 1][1] if order else None
            upcoming = next((item[1] for item in heads[order + 1:] if item[1] is not None), None)
            if previous is not None and upcoming == previous + 2:
                heads[order] = (index, previous + 1, title)
    return heads


def burmese_chapters(path: Path = BURMESE) -> list[Chapter]:
    lines = path.read_text(encoding="utf-8").split("\n")
    marks = [i for i, line in enumerate(lines) if line.startswith("[[HCRAWLER MARKER")]
    if marks:
        chapters = []
        for order, index in enumerate(marks):
            end = marks[order + 1] if order + 1 < len(marks) else len(lines)
            title = lines[index + 1].strip() if index + 1 < len(lines) else ""
            chapters.append(BurmeseChapter(order + 1, title, "\n".join(lines[index + 2:end]).strip(),
                                           "burmese", marker=order + 1))
        return chapters
    heads = _burmese_native_heads(lines)
    chapters: list[BurmeseChapter] = []
    for order, (index, label, title) in enumerate(heads):
        end = heads[order + 1][0] if order + 1 < len(heads) else len(lines)
        body = "\n".join(lines[index + 1:end]).strip()
        if chapters and chapters[-1].number == label:
            previous = chapters[-1]
            chapters[-1] = BurmeseChapter(previous.number, previous.title,
                                          previous.body + "\n\n" + body, "burmese",
                                          marker=previous.marker)
        else:
            chapters.append(BurmeseChapter(label, title, body, "burmese", marker=len(chapters) + 1))
    return chapters


_DIGITS = {"〇": 0, "零": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}


def chinese_number(text: str) -> int:
    total = 0
    digit = 0
    for char in text:
        if char in _DIGITS:
            digit = _DIGITS[char]
        elif char == "十":
            total += (digit or 1) * 10
            digit = 0
        elif char == "百":
            total += (digit or 1) * 100
            digit = 0
        elif char == "千":
            total += (digit or 1) * 1000
            digit = 0
    return total + digit


# ---------------------------------------------------------------- sentences

_SENT = re.compile(r"[^。！？!?…\n]+[。！？!?…]*")


def sentences(text: str) -> list[str]:
    out: list[str] = []
    for match in _SENT.finditer(text):
        piece = match.group(0).strip()
        if piece:
            out.append(piece)
    return out


# ---------------------------------------------------------------- engines


def detokenize(pieces: list[str]) -> str:
    """Join sentencepiece pieces without dropping unknown ones.

    `SentencePieceProcessor.decode` leaves the `▁` word marker in place for
    tokens it cannot map back, so the pieces are joined directly.
    """
    text = "".join(pieces).replace("\u2581", " ")
    return re.sub(r"\s+", " ", text).strip()


class Engine:
    name = "engine"
    detail = ""

    def translate(self, texts: list[str], source: str, target: str) -> list[str]:
        raise NotImplementedError

    def available(self) -> tuple[bool, str]:
        raise NotImplementedError


class OfflineEngine(Engine):
    """Argos/OPUS-MT checkpoint read directly with ctranslate2 + sentencepiece.

    Argos' own `translate` wrapper pulls in stanza for sentence splitting and
    tries to download its resources from raw.githubusercontent.com, which this
    machine cannot reach. The model itself needs neither: the sentences are
    split here and fed to the checkpoint.
    """

    name = "offline"

    def __init__(self, source: str, target: str) -> None:
        self.pair = f"{source}-{target}"
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
        self.path = base / "argos-translate" / "packages" / f"translate-{source}_{target}-1_0"
        self.detail = str(self.path)
        self._translator = None
        self._sp = None

    def available(self) -> tuple[bool, str]:
        if not (self.path / "model" / "model.bin").is_file():
            return False, (f"no offline model installed for {self.pair} "
                           f"(python3 mt/fetch_engine.py --install {self.pair})")
        return True, str(self.path)

    def _load(self):
        if self._translator is None:
            import ctranslate2  # noqa: PLC0415
            import sentencepiece as spm  # noqa: PLC0415
            self._translator = ctranslate2.Translator(str(self.path / "model"), device="cpu", compute_type="int8")
            self._sp = spm.SentencePieceProcessor(model_file=str(self.path / "sentencepiece.model"))
        return self._translator, self._sp

    def translate(self, texts: list[str], source: str, target: str) -> list[str]:
        import sentencepiece as spm  # noqa: F401, PLC0415
        translator, sp = self._load()
        results: list[str] = []
        batch_size = 24
        for start in range(0, len(texts), batch_size):
            chunk = texts[start:start + batch_size]
            tokens = [sp.encode(text, out_type=str) for text in chunk]
            outputs = translator.translate_batch(tokens, beam_size=2, max_batch_size=batch_size)
            results.extend(detokenize(item.hypotheses[0]) for item in outputs)
        return results


class AzureEngine(Engine):
    """Azure Translator v3. Guidance only: the key comes from the environment."""

    name = "azure"
    ENDPOINT = "https://api.cognitive.microsofttranslator.com"

    def __init__(self) -> None:
        self.key = os.environ.get("AZURE_TRANSLATOR_KEY", "")
        self.region = os.environ.get("AZURE_TRANSLATOR_REGION", "")
        self.endpoint = os.environ.get("AZURE_TRANSLATOR_ENDPOINT", self.ENDPOINT).rstrip("/")
        self.detail = f"{self.endpoint} (key {'set' if self.key else 'missing'})"

    def available(self) -> tuple[bool, str]:
        if not self.key:
            return False, "AZURE_TRANSLATOR_KEY is not set; export it in your shell (never commit it)"
        if not self.region:
            return False, "AZURE_TRANSLATOR_REGION is not set"
        return True, self.detail

    def translate(self, texts: list[str], source: str, target: str) -> list[str]:
        import requests  # noqa: PLC0415
        headers = {
            "Ocp-Apim-Subscription-Key": self.key,
            "Ocp-Apim-Subscription-Region": self.region,
            "Content-Type": "application/json",
        }
        params = {"api-version": "3.0", "from": source, "to": target}
        results: list[str] = []
        for start in range(0, len(texts), 25):
            chunk = texts[start:start + 25]
            response = requests.post(self.endpoint + "/translate", params=params, headers=headers,
                                     json=[{"text": item} for item in chunk], timeout=60)
            response.raise_for_status()
            results.extend(item["translations"][0]["text"] for item in response.json())
        return results


class CommandEngine(Engine):
    """Any installed translator, driven by a shell command template.

    The official Argos index has no Burmese package, so a zh->my or en->my
    engine has to be installed separately. Rather than hard-code whichever one
    was installed last, this engine runs a command you supply and records it in
    the report. The template gets the text on stdin and must answer on stdout:

        --cmd-template "my-translator --from {source} --to {target}"

    `{text}` may be used instead of stdin; it is replaced with the text and the
    process is run without a pipe. `{source}` and `{target}` are substituted
    with the route's language codes.
    """

    name = "cmd"
    TIMEOUT = 120

    def __init__(self, source: str, target: str, template: str | None = None) -> None:
        self.source = source
        self.target = target
        self.template = template or os.environ.get("MT_ENGINE_COMMAND", "")
        self.detail = self.template or "MT_ENGINE_COMMAND is not set"

    def available(self) -> tuple[bool, str]:
        if not self.template.strip():
            return False, ("no command template: pass --cmd-template or export "
                           "MT_ENGINE_COMMAND (see mt/MT-RESTORE.md)")
        return True, self.template

    def _render(self, text: str) -> str:
        return (self.template
                .replace("{source}", self.source)
                .replace("{target}", self.target)
                .replace("{text}", shlex.quote(text)))

    def translate(self, texts: list[str], source: str, target: str) -> list[str]:
        results: list[str] = []
        for text in texts:
            command = self._render(text)
            if "{text}" in self.template:
                completed = subprocess.run(command, shell=True, capture_output=True,
                                           text=True, timeout=self.TIMEOUT)
            else:
                completed = subprocess.run(command, shell=True, input=text,
                                           capture_output=True, text=True,
                                           timeout=self.TIMEOUT)
            if completed.returncode != 0:
                raise RuntimeError(f"{command} exited {completed.returncode}: "
                                   f"{completed.stderr.strip()[:200]}")
            results.append(completed.stdout.strip())
        return results


def resolve(engine: str, source: str, target: str,
            cmd_template: str | None = None) -> Engine:
    if engine == "azure":
        return AzureEngine()
    if engine == "cmd":
        return CommandEngine(source, target, cmd_template)
    return OfflineEngine(source, target)


# ---------------------------------------------------------------- running


@dataclass
class Report:
    route: str
    engine: str
    chapters: int = 0
    sentences: int = 0
    empty: int = 0
    skipped: int = 0
    tokens: int = 0
    unresolved: int = 0
    started: float = 0.0
    seconds: float = 0.0
    status: str = "ok"
    detail: str = ""
    files: list[str] = field(default_factory=list)


def run_route(route: str, engine_name: str, limit: int | None, out_dir: Path,
              chapters: list[Chapter], resume: bool = False,
              cmd_template: str | None = None,
              engine_note: str | None = None) -> Report:
    source, target = ROUTES[route]
    engine = resolve(engine_name, source, target, cmd_template)
    ok, detail = engine.available()
    if engine_name == "cmd" and engine_note:
        detail = f"{detail}  [# {engine_note}]"
    report = Report(route=route, engine=engine.name, detail=detail)
    out_dir.mkdir(parents=True, exist_ok=True)
    if not ok:
        report.status = "unavailable"
        (out_dir / "report.json").write_text(json.dumps(report.__dict__, indent=2) + "\n", encoding="utf-8")
        print(f"[mt] {route}: unavailable — {detail}")
        return report

    chosen = chapters[:limit] if limit else chapters
    book: list[str] = []
    report.started = time.time()
    for chapter in chosen:
        name = f"ch{chapter.number:04d}.{target}.txt"
        existing = out_dir / "chapters" / name
        if resume and existing.is_file() and existing.stat().st_size > 0:
            report.chapters += 1
            report.skipped += 1
            book.append("\n\n===== " + chapter.title + " =====\n" + existing.read_text(encoding="utf-8").split("\n", 2)[-1])
            continue
        lines = sentences(chapter.body)
        translated = engine.translate(lines, source, target)
        report.chapters += 1
        report.sentences += len(lines)
        report.empty += sum(1 for item in translated if not item.strip())
        title = chapter.title if not hasattr(chapter, "marker") else f"[HCRAWLER MARKER {chapter.marker}] {chapter.title}"
        body = "\n".join(translated)
        text = f"{title}\n{'=' * len(title)}\n{body}\n"
        (out_dir / "chapters").mkdir(parents=True, exist_ok=True)
        (out_dir / "chapters" / name).write_text(text, encoding="utf-8")
        try:
            report.files.append(str((out_dir / "chapters" / name).relative_to(ROOT)))
        except ValueError:
            report.files.append(str(out_dir / "chapters" / name))
        book.append(f"\n\n===== {title} =====\n")
        book.append(body)
    report.seconds = round(time.time() - report.started, 1)
    (out_dir / f"book.{target}.txt").write_text("".join(book).lstrip() + "\n", encoding="utf-8")
    (out_dir / "report.json").write_text(json.dumps(report.__dict__, indent=2, ensure_ascii=False) + "\n",
                                         encoding="utf-8")
    print(f"[mt] {route}: {report.chapters} chapters, {report.sentences} sentences, "
          f"{report.seconds}s -> {out_dir}")
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--route", action="append", choices=sorted(ROUTES), default=[],
                        help="route to run; repeatable, default: both")
    parser.add_argument("--engine", choices=["offline", "azure", "cmd"], default="offline")
    parser.add_argument("--cmd-template", default=None,
                        help="shell command for --engine cmd; {text} or stdin")
    parser.add_argument("--engine-note", default=None,
                        help="model id/version recorded in report.json, e.g. "
                             "'argos zh-en 1.0'")
    parser.add_argument("--source-file", type=Path, default=None,
                        help="Chinese text; default content/source/chinese-0511241012-from-8011_1.txt")
    parser.add_argument("--limit", type=int, default=None, help="only the first N chapters")
    parser.add_argument("--only", action="append", default=[], help="chapter number to include")
    parser.add_argument("--out-dir", type=Path, default=OUTPUT)
    parser.add_argument("--list", action="store_true", help="show route availability and exit")
    parser.add_argument("--resume", action="store_true", help="skip chapters that already have output")
    parser.add_argument("--cascade", action="store_true",
                        help="run zh-en first, then en-zh, which reads the zh-en output")
    parser.add_argument("--one-file", nargs="?", const="", default=None, metavar="PATH",
                        help="write/resume a single text file only; use --route and --chapters")
    parser.add_argument("--input-file", type=Path, default=None,
                        help="one-file input for en-zh; defaults to content/mtranslate/zh-en.txt")
    parser.add_argument("--chapters", default="1-408", metavar="LOW-HIGH",
                        help="chapter range for --one-file (default: 1-408)")
    args = parser.parse_args(argv)

    if args.list:
        print(f"{'route':<8}{'engine':<10}{'available':<11}detail")
        for route in ROUTES:
            source, target = ROUTES[route]
            ok, detail = resolve("offline", source, target).available()
            print(f"{route:<8}{'offline':<10}{str(ok):<11}{detail}")
        for route in ROUTES:
            ok, detail = AzureEngine().available()
            print(f"{route:<8}{'azure':<10}{str(ok):<11}{detail}")
        return 0

    if args.one_file is not None:
        if len(args.route) != 1:
            parser.error("--one-file requires exactly one explicit --route")
        if args.cascade:
            parser.error("--one-file cannot be combined with --cascade; run each route separately")
        if args.limit is not None or args.only:
            parser.error("--one-file uses --chapters LOW-HIGH instead of --limit/--only")
        route = args.route[0]
        route_files = {name: Path(args.out_dir) / default.name
                       for name, default in DEFAULT_MT_FILES.items()}
        output = Path(args.one_file) if args.one_file else route_files[route]
        if route == "zh-en" and args.input_file is not None:
            parser.error("--input-file is only used with --route en-zh")
        try:
            chapter_range = parse_chapter_range(args.chapters)
            if route == "zh-en":
                source_path = args.source_file or CHINESE
                chapters = select_unique_chapters(chinese_chapters(source_path))
            else:
                input_path = args.input_file or route_files["zh-en"]
                if output.resolve() == input_path.resolve():
                    raise ValueError("en-zh output must not overwrite its zh-en input")
                chapters = select_unique_chapters(read_onefile(input_path))
            result = run_onefile(route, engine_name=args.engine, output=output,
                                 chapters=chapters, max_range=chapter_range,
                                 cmd_template=args.cmd_template)
            present = {chapter.number for chapter in chapters
                       if chapter_range[0] <= chapter.number <= chapter_range[1]}
            result["missing_chapter_numbers"] = sorted(set(range(
                chapter_range[0], chapter_range[1] + 1)) - present)
            print(json.dumps(result, indent=2, ensure_ascii=False))
            return 0
        except (OSError, ValueError, RuntimeError) as exc:
            print(f"[mt-one-file] {exc}", file=sys.stderr)
            return 2

    chapters = chinese_chapters(args.source_file or CHINESE)
    wanted_filters: list[set[int]] = []
    filters = wanted_filters
    feeds = {"en-zh": lambda: english_chapters(args.out_dir / "zh-en")}
    if args.only:
        wanted = set()
        for item in args.only:
            for piece in str(item).replace(" ", "").split(","):
                if piece:
                    wanted.add(int(piece))
        filters.append(wanted)
    if not chapters:
        print("[mt] no chapters selected", file=sys.stderr)
        return 2

    routes = ["zh-en", "en-zh"] if args.cascade else (args.route or sorted(ROUTES))
    reports = []
    for route in routes:
        out_dir = args.out_dir / route
        route_chapters = feeds[route]() if route in feeds else chapters
        if wanted_filters:
            route_chapters = [c for c in route_chapters if c.number in wanted_filters[0]]
        if route in feeds and not route_chapters:
            print(f"[mt] {route}: no input yet — run --route zh-en first")
            reports.append(Report(route=route, engine=args.engine, status="no_input",
                                  detail="run --route zh-en first"))
            continue
        reports.append(run_route(route, args.engine, args.limit, out_dir,
                                 route_chapters, args.resume, args.cmd_template,
                                 args.engine_note))

    summary = {
        "engine": args.engine,
        "routes": {report.route: {"status": report.status, "detail": report.detail,
                                  "chapters": report.chapters, "sentences": report.sentences,
                                  "seconds": report.seconds} for report in reports},
    }
    args.out_dir.mkdir(parents=True, exist_ok=True)
    (args.out_dir / "manifest.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n",
                                                encoding="utf-8")
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
