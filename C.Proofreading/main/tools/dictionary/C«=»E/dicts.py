# /// script
# requires-python = ">=3.10"
# dependencies = ["jieba>=0.42", "OpenCC>=1.1"]
# ///
"""Bilingual lookups for the chapter merge.

    Chinese -> English   Engine/knowledge/dicts/cc-cedict.tsv   (118,840 entries)
    English -> Burmese   Engine/knowledge/dicts/en-my.sqlite     (21,984 headwords)

Install the data with `uv run format/fetch_dicts.py`. The Chinese side accepts
both scripts: CC-CEDICT stores a traditional and a simplified form per entry, and
OpenCC normalises the running text before segmentation.

Nothing here guesses: a word with no entry returns nothing, and the callers must
treat an empty result as "unknown" rather than as a translation.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Iterator

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
STORE = ROOT / "Engine" / "knowledge" / "dicts"
CEDICT = STORE / "cc-cedict.tsv"
ENMY = STORE / "en-my.sqlite"

_PUNCT = re.compile(r"[\s，。！？、；：「」『』（）《》〈〉…—－,.!?;:\"'“”‘’()\[\]<>/\\|]+")
_HAN = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")


def installed() -> bool:
    return CEDICT.is_file() and ENMY.is_file()


@dataclass(frozen=True)
class Entry:
    traditional: str
    simplified: str
    pinyin: str
    glosses: tuple[str, ...]

    @property
    def gloss(self) -> str:
        return "; ".join(self.glosses)


class Cedict:
    """CC-CEDICT in memory. Traditional and simplified forms both index the entry."""

    def __init__(self, path: Path = CEDICT) -> None:
        self.by_traditional: dict[str, list[Entry]] = {}
        self.by_simplified: dict[str, list[Entry]] = {}
        self.entries: list[Entry] = []
        with path.open("r", encoding="utf-8") as stream:
            for line in stream:
                if not line.strip() or line.startswith("#"):
                    continue
                parts = line.rstrip("\n").split("\t")
                if len(parts) != 4:
                    continue
                traditional, simplified, pinyin, glosses = parts
                entry = Entry(traditional, simplified, pinyin, tuple(g for g in glosses.split("/") if g))
                self.entries.append(entry)
                self.by_traditional.setdefault(traditional, []).append(entry)
                self.by_simplified.setdefault(simplified, []).append(entry)
        self.maxlen = max((len(form) for form in self.by_simplified), default=1)
        self._converter = None

    # -- normalization -------------------------------------------------
    @property
    def converter(self):
        if self._converter is None:
            try:
                from opencc import OpenCC  # noqa: PLC0415
                self._converter = OpenCC("t2s")
            except Exception:  # pragma: no cover - optional dependency
                self._converter = False
        return self._converter

    def to_simplified(self, text: str) -> str:
        converter = self.converter
        return converter.convert(text) if converter else text

    # -- lookup --------------------------------------------------------
    def lookup(self, word: str) -> list[Entry]:
        simplified = self.to_simplified(word)
        return self.by_simplified.get(simplified) or self.by_traditional.get(word) or []

    def longest(self, text: str, index: int) -> str:
        """Longest dictionary form at `index` in text that is already simplified."""
        limit = min(self.maxlen, len(text) - index)
        for size in range(limit, 0, -1):
            candidate = text[index:index + size]
            if candidate in self.by_simplified:
                return candidate
        return ""

    def segment(self, text: str) -> Iterator[str]:
        """Dictionary-first segmentation of already simplified text.

        jieba is used when available because it knows modern compounds that
        CC-CEDICT lists only as separate characters; the result is then trimmed
        to the longest dictionary form so every yielded word has an entry.
        """
        try:
            import jieba  # noqa: PLC0415
            jieba.setLogLevel(60)
            pieces: Iterable[str] = jieba.cut(text)
        except Exception:  # pragma: no cover - optional dependency
            pieces = (text[i:i + 1] for i in range(len(text)))
        buffer = ""
        for piece in pieces:
            if not _HAN.search(piece):
                if buffer:
                    yield buffer
                    buffer = ""
                continue
            buffer += piece
        if buffer:
            yield buffer

    def terms(self, text: str, *, min_length: int = 2) -> dict[str, list[Entry]]:
        """Dictionary words found in a Chinese text, longest match first.

        Returns `{word: [Entry, ...]}` for words of at least `min_length`
        characters. Single characters are skipped because they are usually
        particles and their glosses are too generic to align chapters.
        """
        simplified = self.to_simplified(text)
        found: dict[str, list[Entry]] = {}
        index = 0
        while index < len(simplified):
            if not _HAN.match(simplified[index]):
                index += 1
                continue
            word = self.longest(simplified, index)
            if word and len(word) >= min_length:
                found.setdefault(word, self.by_simplified[word])
                index += len(word)
            else:
                index += 1
        return found


class EnMy:
    """English-Myanmar headwords, looked up case-insensitively."""

    def __init__(self, path: Path = ENMY) -> None:
        import sqlite3  # noqa: PLC0415
        self.connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row

    def lookup(self, word: str) -> list[sqlite3.Row]:
        key = word.strip().lower()
        if not key:
            return []
        return self.connection.execute(
            "SELECT word, definition FROM entry WHERE key = ? ORDER BY length(word) LIMIT 5", (key,)
        ).fetchall()

    def burmese(self, word: str) -> str:
        rows = self.lookup(word)
        return rows[0]["definition"] if rows else ""

    def search(self, word: str) -> list[sqlite3.Row]:
        return self.connection.execute(
            "SELECT word, definition FROM entry WHERE key LIKE ? ORDER BY length(word) LIMIT 10",
            (word.strip().lower() + "%",),
        ).fetchall()


_STOP = {
    "a", "an", "the", "to", "of", "in", "on", "at", "for", "and", "or", "is", "are",
    "be", "it", "this", "that", "with", "as", "by", "from", "his", "her", "their",
    "he", "she", "they", "you", "i", "we", "not", "no", "used", "etc", "surname",
    "variant", "see", "also", "lit", "fig", "archaic", "dialect", "coll", "abbr",
}


def gloss_keys(entry: Entry) -> list[str]:
    """English headwords worth asking the English-Myanmar dictionary for."""
    keys: list[str] = []
    for gloss in entry.glosses:
        cleaned = re.sub(r"\([^)]*\)", " ", gloss)
        cleaned = re.sub(r"\[[^\]]*\]", " ", cleaned)
        for piece in re.split(r"[;,/]| or | and ", cleaned):
            piece = piece.strip().lower()
            piece = re.sub(r"^(to|a|an|the)\s+", "", piece)
            if not piece or len(piece) < 2 or piece in _STOP:
                continue
            if not re.fullmatch(r"[a-z][a-z' -]*", piece):
                continue
            keys.append(piece)
    seen: set[str] = set()
    unique = []
    for key in keys:
        if key not in seen:
            seen.add(key)
            unique.append(key)
    return unique


def load() -> tuple[Cedict, EnMy]:
    if not installed():
        raise SystemExit("dictionaries missing: run `uv run format/fetch_dicts.py` first")
    return Cedict(), EnMy()


def main(argv: list[str] | None = None) -> int:
    import argparse
    parser = argparse.ArgumentParser(description="Look up the installed dictionaries")
    parser.add_argument("word", nargs="+", help="Chinese or English word")
    parser.add_argument("--zh", action="store_true", help="treat the word as Chinese")
    parser.add_argument("--en", action="store_true", help="treat the word as English")
    args = parser.parse_args(argv)

    cedict, enmy = load()
    for word in args.word:
        if args.en or (not args.zh and not _HAN.search(word)):
            print(f"{word}: {enmy.burmese(word)[:200] or '(not in en-my)'}")
        else:
            entries = cedict.lookup(word)
            if not entries:
                print(f"{word}: (not in cc-cedict)")
                continue
            for entry in entries[:3]:
                keys = gloss_keys(entry)
                print(f"{word}: {entry.pinyin} | {entry.gloss}")
                for key in keys[:4]:
                    burmese = enmy.burmese(key)
                    print(f"    {key:<18} {burmese.splitlines()[0][:90] if burmese else '(no en-my entry)'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
