#!/usr/bin/env python3
"""Group suspicious dataset excerpts and prepare a small, hash-based PDF request.

The groups describe observable text symptoms, not identified fonts, encodings,
PDF-byte mappings, or guaranteed errors. A book can appear in several groups.
Some character patterns are counted throughout each extracted text; other
heuristics examine only a few windows or the beginning. Neither proves the
original PDF, its fonts, or every visible problem have been covered.

Examples (PyArrow is needed only for ``scan``):
  python tools-box/python/dataset-mangled-books.py scan /path/to/books.parquet --requests mangled-pdfs.tsv
  python tools-box/python/dataset-mangled-books.py locate mangled-pdfs.tsv /path/to/uploaded-host.txt
  python tools-box/python/dataset-mangled-books.py verify mangled-pdfs.tsv /path/to/downloaded.pdf

The root-level download-mangled-pdfs.py uses the flat filename list and the
pinned dataset hashes to retrieve and verify PDFs. This analysis script itself
does not connect to a server or download files. A different dataset requires
updating the downloader's embedded hashes before using its generated list.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parents[2]
DATASET_SHA256 = "7014c9a29d2d61dcaa4b4dcbeb863ba9fb4c6b0d36ae19bcfbaf22e55c6d79e8"
DATASET_REVISION = "9a296cded8f0a267f4cb6b996c5bb37c6c60c9ee"
SHA256_RE = re.compile(r"[0-9a-fA-F]{64}\Z")
MYANMAR = re.compile(r"[\u1000-\u109f\ua9e0-\ua9ff\uaa60-\uaa7f]")
BASE = re.compile(r"[\u1000-\u102a]")
MARK = re.compile(r"[\u102b-\u103e]")
LATIN_EXTENDED = re.compile(r"[\u00c0-\u024f]")
LATIN_ADJACENT = re.compile(
    r"(?:[\u1000-\u109f][\u00c0-\u024f]|[\u00c0-\u024f][\u1000-\u109f])"
)
MARK_ORDER = re.compile(r"\u1031[\u1039\u103a\u103b\u103c\u103d\u103e\u102d\u102e\u102f\u1030]")
ASCII_AU = re.compile(
    r"(?<=[\u1000-\u109f])[AU](?=[\u1000-\u109f])|(?<![A-Za-z])[AU](?=[\u1000-\u109f])"
)
FOREIGN = re.compile(r"[\u0600-\u083f]")
GREEK_BETA = re.compile("\u0392")
GREEK = re.compile(r"[\u0370-\u03ff]")
PRIVATE_USE = re.compile(r"[\ue000-\uf8ff]")
CONTROL_OR_REPLACEMENT = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\ufffd]")
NUMBER = re.compile(r"[0-9\u1040-\u1049]+")
STRAY_MARK = re.compile(r"(?:^|[\s.,;:()\[\]{}])([\u102b-\u103e]{1,3})", re.M)
TINY_MYANMAR_TOKEN = re.compile(r"(?:^|\s)([\u1000-\u109f]{1,3})(?=\s|$)")
# The copies are on one line and are byte-for-byte the same Unicode text.
REPEATED = re.compile(
    r"(?P<unit>[\u1000-\u109f][\u1000-\u109f \t]{5,79}?)(?:[ \t]*(?P=unit)){2,}"
)
HEADER_TOKEN = re.compile(r"(?<![\w./])(?:[A-Za-z][A-Za-z0-9$&;@*\\\-']{7,})")
FOUR_IDENTICAL = re.compile(r"(.)\1{3,}")

# Ordered by visible symptom. The preferred examples refer only to the pinned
# public dataset; for other datasets the first detected candidate is selected.
GROUPS = {
    "duplicate": (
        "Adjacent repeated Burmese phrases",
        "Three or more consecutive copies in the first 12,000 characters; "
        "repeated song lyrics, tables and intentional emphasis are possible.",
        "1704101675047",
    ),
    "latin-mixed": (
        "Dense extended-Latin characters mixed into Burmese",
        "Many extended-Latin characters immediately touch Myanmar characters; "
        "this is a visible extraction symptom, not a confirmed font encoding.",
        "1681774700481",
    ),
    "mark-order": (
        "Suspicious Myanmar mark ordering",
        "Repeated occurrences of selected U+1031/mark sequences; this is a "
        "review heuristic, not a complete Myanmar grammar or a correction.",
        "1706300888234",
    ),
    "missing-marks": (
        "Very few Myanmar vowel/medial marks, without dense extended Latin",
        "A low mark-to-base ratio in the samples or full text; some text may "
        "be in another language or omit marks intentionally, so review the excerpts.",
        "-1708528931770",
    ),
    "ascii-au": (
        "Repeated A/U embedded next to Burmese",
        "Repeated A or U directly adjacent to Myanmar characters; some books "
        "also have duplicated headings or other kinds of corruption.",
        "1704101675047",
    ),
    "foreign-script": (
        "Other-script characters in or near Burmese",
        "U+0600–U+083F or Greek characters in the text; "
        "multilingual content and intentional symbols are possible.",
        "-1758614468061",
    ),
    "private-use": (
        "Private-use characters",
        "A private-use character needs the original font or other evidence "
        "to interpret; it is not automatically an unknown glyph.",
        "1706303571424",
    ),
    "fragmented": (
        "Fragmented or disordered Burmese",
        "Many very short Myanmar tokens plus isolated marks, a broad review "
        "signal that can also occur in verse, tables or OCR/layout extraction.",
        "-1707218535397",
    ),
    "ascii-heading": (
        "Unusual ASCII strings near the beginning",
        "Keyboard-like strings, repeated letters, or low-vowel mixed-case "
        "strings in the first 3,000 characters; code, names and English may "
        "also match. The body may be readable.",
        "1702975118935",
    ),
    "latin-paired": (
        "Paired accented-Latin markers",
        "At least 25 each of Ò and Ó, or of Ô and Õ; some occur around Burmese "
        "passages like quotation marks. They could also be intentional text or decoration.",
        "1712821408320",
    ),
    "control-chars": (
        "Repeated control or replacement characters",
        "At least 30 C0/C1 control characters or U+FFFD, excluding tabs, CR "
        "and LF; a form feed can be an intentional page break.",
        "applied-hvac-system-in-marine-offshore-1703603560839",
    ),
    "numbered-layout": (
        "Long numbered contents-like line",
        "A long line near the start containing the Burmese contents label, "
        "many Myanmar letters and numbers; it may be an ordinary contents "
        "list rather than a reading-order problem.",
        "1693107457569",
    ),
}

# Curated from the pinned dataset after comparing visible subtypes, rather than
# assuming one symptom group implies one font. Order spreads groups across
# small --limit batches. Descriptions are observations, not identified causes.
REPRESENTATIVE_TARGETS = (
    ("1704101675047", "Repeated heading plus A/U next to Myanmar characters."),
    ("1681774700481", "Dense é/è/â/à-like characters mixed with Myanmar."),
    ("-1708528931770", "Very few Myanmar marks and frequent adjacent B/D/R/A-style letters."),
    ("-1758614468061", "Other-script characters in a short title followed by readable Burmese."),
    ("1706303571424", "Long repeated run of private-use characters in a page header."),
    ("-1707218535397", "Many short, fragmented Myanmar tokens and isolated marks."),
    ("1702975118935", "Keyboard-like ASCII heading, repeated title and embedded A/U."),
    ("1712821408320", "Frequent Ò/Ó around Burmese passages."),
    ("applied-hvac-system-in-marine-offshore-1703603560839", "Technical text with many C1 controls in a garbled-looking passage."),
    ("1693107457569", "Numbered contents-like lines with text and page numbers apparently interleaved."),
    ("1706300888234", "Many selected pre-vowel/mark sequences, including ေ် and ေိ."),
    ("36-short-stories-of-jue-1708877870919", "A/E/I/U adjacent to Myanmar, not only A/U."),
    ("curiosity-science-magazine-year-2-issue-2-1696435557299", "Dense ǻ/Ǯ/Ǻ/ǳ-style characters mixed with Myanmar."),
    ("1706118392082", "Doubled individual characters in a heading and C0 controls."),
    ("best-theory-of-physical-education-1693147797764", "Arabic-range ھ repeatedly embedded in Myanmar text."),
    ("1699176399227", "Private-use U+F22F inside Myanmar words, unlike a private-use heading."),
    ("-1758614352663", "Particularly dense short-token fragmentation and isolated marks."),
    ("1705152502270", "A long multiword heading repeated without separators."),
    ("1706119141337", "Frequent Ô/Õ around Burmese dialogue, distinct from Ò/Ó."),
    ("anawrahta-the-founder-of-the-bagan-empire-1783991149510", "Dense Samaritan/NKo-range characters mixed with keyboard-like ASCII."),
    ("-1759341726906", "Frequent mark sequences, controls and a long numbered contents line."),
    ("curiosity-science-magazine-year-2-issue-4-1696435591836", "Both ǻ-series and é-series text, plus a private-use name."),
    ("1792041524361", "Mark-poor text with repeated fragments and mixed ASCII characters."),
    ("1693064173472", "Greek capital Β repeatedly inserted between Myanmar words."),
    ("1706118210298", "Fourfold individual letters and an eightfold repeated Burmese heading."),
    ("1784999368188", "C1 controls within Burmese text alongside unusual mark sequences."),
    ("1708961902669", "An extended-Latin mixture with comparatively prominent ß/è."),
    ("chinese-stories-part-3-4-1705386897174", "Spaced repeated heading and varied pre-vowel/mark sequences."),
    ("at-away-1681716501732", "Greek and CJK-like characters in repeated page/footer material."),
    ("1689959710117", "Isolated U+F0B7 private-use markers in Myanmar contents-like text."),
    ("-1758699987420", "Fragmented Myanmar tokens with a sampled mark-order signal."),
    ("100-short-stories-1783992392966", "Fragmented text beginning with isolated and short Myanmar tokens."),
    ("1706302190221", "A separate long example of the é/è extended-Latin mixture."),
    ("-1706804477315", "Short-token fragmentation with a different opening and isolated marks."),
    ("1785661897658", "Eightfold individual letters in a heading and repeated Burmese names."),
    ("1693245630110", "A different balance of pre-vowel and vowel/mark sequences."),
    ("1784274916692", "A complete multiword title repeated with spaces between copies."),
    ("1706085249444", "Repeated keyboard-like ASCII and a template marker; may be intentional."),
    ("1693904077870", "Form-feed/C1 controls in a header alongside keyboard-like ASCII."),
)


@dataclass
class Book:
    index: int
    name: str
    author: str
    sha256: str
    lines: list[tuple[int, str]]
    groups: dict[str, tuple[str, int | None, str]]
    focus_examples: list[tuple[str, int, str]] = field(default_factory=list)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def excerpt(text: str, start: int, end: int, before: int = 28, after: int = 56) -> str:
    """Return an unchanged substring; JSON quoting makes controls visible later."""
    return text[max(0, start - before):min(len(text), end + after)]


def first_nonempty_lines(text: str, limit: int = 3) -> list[tuple[int, str]]:
    result = []
    # Split only on the actual LF separator, not on other control characters.
    for number, line in enumerate(text.split("\n"), 1):
        if line.strip():
            result.append((number, line))
            if len(result) == limit:
                break
    return result


def windows(text: str) -> list[tuple[int, str]]:
    # Five 2,000-character windows including the start, spaced across the book.
    starts = sorted({0, *(int(max(0, len(text) - 2000) * i / 5) for i in range(1, 5))})
    return [(start, text[start:start + 2000]) for start in starts]


def first_match(text: str, parts: list[tuple[int, str]], pattern: re.Pattern[str]) -> tuple[int | None, str]:
    for start, part in parts:
        match = pattern.search(part)
        if match:
            left, right = start + match.start(), start + match.end()
            return left, excerpt(text, left, right)
    return None, ""


def first_full_match(text: str, pattern: re.Pattern[str]) -> tuple[int | None, str]:
    match = pattern.search(text)
    if not match:
        return None, ""
    return match.start(), excerpt(text, match.start(), match.end())


def numbered_contents_line(text: str) -> tuple[int | None, str]:
    offset = 0
    for line in text[:12000].split("\n"):
        if (len(line) >= 250 and "မာတိကာ" in line and
                len(NUMBER.findall(line)) >= 12 and len(BASE.findall(line)) >= 100):
            return offset, excerpt(text, offset, offset + min(len(line), 120), before=0)
        offset += len(line) + 1
    return None, ""


def find_repeated(text: str) -> tuple[int | None, str]:
    for match in REPEATED.finditer(text[:12000]):
        unit = match.group("unit")
        if len(set(unit)) >= 4 and len(BASE.findall(unit)) >= 2:
            # This is only a preview of the literal match; the original line is
            # separately retained in the excerpt list when it occurs there.
            return match.start(), match.group()[:300]
    return None, ""


def find_header_token(text: str) -> tuple[int | None, str]:
    for match in HEADER_TOKEN.finditer(text[:3000]):
        token = match.group()
        lower = token.lower()
        letters = sum(ch.isalpha() for ch in token)
        vowels = sum(ch in "aeiouAEIOU" for ch in token)
        punctuation = sum(not ch.isalnum() for ch in token)
        if not letters or "http" in lower or "www" in lower:
            continue
        if (FOUR_IDENTICAL.search(token) or "qwerty" in lower or
                (letters >= 9 and vowels / letters < 0.16 and
                 (any(ch.isupper() for ch in token) or punctuation))):
            return match.start(), excerpt(text, match.start(), match.end())
    return None, ""


def classify(text: str) -> dict[str, tuple[str, int | None, str]]:
    parts = windows(text)
    sample = "\n".join(part for _, part in parts)
    n_myanmar = len(MYANMAR.findall(sample))
    n_latin = len(LATIN_EXTENDED.findall(sample))
    n_adjacent = len(LATIN_ADJACENT.findall(sample))
    n_bases = len(BASE.findall(sample))
    n_marks = len(MARK.findall(sample))
    n_order = len(MARK_ORDER.findall(sample))
    n_au = len(ASCII_AU.findall(sample))
    n_foreign = len(FOREIGN.findall(sample))
    n_beta = len(GREEK_BETA.findall(sample))
    n_private = len(PRIVATE_USE.findall(sample))
    n_stray = len(STRAY_MARK.findall(sample))
    n_tiny = len(TINY_MYANMAR_TOKEN.findall(sample))
    groups: dict[str, tuple[str, int | None, str]] = {}

    offset, example = find_repeated(text)
    if offset is not None:
        groups["duplicate"] = ("at least 3 consecutive copies", offset, example)
    dense = n_latin >= 200 and n_adjacent >= 100 and n_adjacent / max(n_myanmar, 1) >= 0.05
    if dense:
        offset, example = first_match(text, parts, LATIN_ADJACENT)
        groups["latin-mixed"] = (f"{n_adjacent} Myanmar/extended-Latin adjacencies in samples", offset, example)
    if n_order >= 8 and n_order / max(n_myanmar, 1) >= 0.001:
        offset, example = first_match(text, parts, MARK_ORDER)
        groups["mark-order"] = (f"{n_order} selected mark sequences in samples", offset, example)
    if n_bases >= 200 and n_marks / max(n_bases, 1) < 0.15 and not dense:
        groups["missing-marks"] = (f"{n_marks} marks / {n_bases} bases in samples", 0, text[:120])
    if n_au >= 12 and n_myanmar >= 500:
        offset, example = first_match(text, parts, ASCII_AU)
        groups["ascii-au"] = (f"{n_au} adjacent A/U occurrences in samples", offset, example)
    if n_foreign >= 10 or n_beta >= 100:
        pattern = FOREIGN if n_foreign >= 10 else GREEK_BETA
        offset, example = first_match(text, parts, pattern)
        groups["foreign-script"] = (f"{n_foreign} other-script and {n_beta} Greek beta characters in samples", offset, example)
    if n_private >= 10:
        offset, example = first_match(text, parts, PRIVATE_USE)
        groups["private-use"] = (f"{n_private} private-use characters in samples", offset, example)
    if n_myanmar >= 300 and n_tiny >= 140 and n_stray >= 7:
        offset, example = first_match(text, parts, STRAY_MARK)
        groups["fragmented"] = (f"{n_tiny} short Myanmar tokens and {n_stray} isolated marks in samples", offset, example)
    offset, example = find_header_token(text)
    if offset is not None:
        groups["ascii-heading"] = ("unusual ASCII string in first 3,000 characters", offset, example)

    # Complement the window scan with whole-text character counts. These are
    # still narrow heuristics, not a complete assessment of the extracted text.
    full_myanmar = len(MYANMAR.findall(text))
    full_latin = len(LATIN_EXTENDED.findall(text))
    full_adjacent = len(LATIN_ADJACENT.findall(text))
    full_bases = len(BASE.findall(text))
    full_marks = len(MARK.findall(text))
    full_order = len(MARK_ORDER.findall(text))
    full_au = len(ASCII_AU.findall(text))
    full_foreign = len(FOREIGN.findall(text))
    full_beta = len(GREEK_BETA.findall(text))
    full_greek = len(GREEK.findall(text))
    full_private = len(PRIVATE_USE.findall(text))
    dense_full = (full_latin >= 200 and full_adjacent >= 100 and
                  full_adjacent / max(full_myanmar, 1) >= 0.05)
    if dense_full and "latin-mixed" not in groups:
        offset, example = first_full_match(text, LATIN_ADJACENT)
        groups["latin-mixed"] = (f"{full_adjacent} Myanmar/extended-Latin adjacencies in full text", offset, example)
    if (full_order >= 8 and full_order / max(full_myanmar, 1) >= 0.001 and
            "mark-order" not in groups):
        offset, example = first_full_match(text, MARK_ORDER)
        groups["mark-order"] = (f"{full_order} selected mark sequences in full text", offset, example)
    if (full_bases >= 200 and full_marks / max(full_bases, 1) < 0.15 and
            not dense_full and "missing-marks" not in groups):
        groups["missing-marks"] = (f"{full_marks} marks / {full_bases} bases in full text", 0, text[:120])
    if (full_myanmar >= 5000 and full_au >= 50 and
            full_au / full_myanmar >= 0.003 and "ascii-au" not in groups):
        offset, example = first_full_match(text, ASCII_AU)
        groups["ascii-au"] = (f"{full_au} adjacent A/U occurrences in full text", offset, example)
    if ((full_foreign >= 30 or full_beta >= 100 or (full_greek >= 100 and full_myanmar >= 100))
            and "foreign-script" not in groups):
        pattern = FOREIGN if full_foreign >= 30 else GREEK
        offset, example = first_full_match(text, pattern)
        groups["foreign-script"] = (
            f"{full_foreign} Arabic/Samaritan-range and {full_greek} Greek characters in full text",
            offset, example,
        )
    if full_private >= 10 and "private-use" not in groups:
        offset, example = first_full_match(text, PRIVATE_USE)
        groups["private-use"] = (f"{full_private} private-use characters in full text", offset, example)

    pairs = (text.count("Ò"), text.count("Ó"), text.count("Ô"), text.count("Õ"))
    if min(pairs[0], pairs[1]) >= 25 or min(pairs[2], pairs[3]) >= 25:
        # Show the dominant qualifying pair, not a stray character from the
        # other pair earlier in the book.
        pattern = re.compile(r"[ÒÓ]") if min(pairs[0], pairs[1]) >= min(pairs[2], pairs[3]) else re.compile(r"[ÔÕ]")
        offset, example = first_full_match(text, pattern)
        groups["latin-paired"] = (
            f"full-text counts Ò/Ó={pairs[0]}/{pairs[1]}, Ô/Õ={pairs[2]}/{pairs[3]}", offset, example,
        )
    n_control = len(CONTROL_OR_REPLACEMENT.findall(text))
    if n_control >= 30:
        offset, example = first_full_match(text, CONTROL_OR_REPLACEMENT)
        groups["control-chars"] = (f"{n_control} controls or replacement characters in full text", offset, example)
    offset, example = numbered_contents_line(text)
    if offset is not None:
        groups["numbered-layout"] = ("long numbered contents-like line in first 12,000 characters", offset, example)
    return groups


# Focused evidence supplements broad group examples where an example has two
# visibly different signatures in the same text. All offsets are in that text.
FOCUS_PATTERNS = {
    "36-short-stories-of-jue-1708877870919": (
        ("E adjacent to Myanmar", re.compile(r"(?<=[\u1000-\u109f])E|E(?=[\u1000-\u109f])")),
        ("I adjacent to Myanmar", re.compile(r"(?<=[\u1000-\u109f])I|I(?=[\u1000-\u109f])")),
    ),
    "curiosity-science-magazine-year-2-issue-4-1696435591836": (
        ("é/è-series beside Myanmar", re.compile(r"[\u1000-\u109f][éè]|[éè][\u1000-\u109f]")),
        ("ǻ-series beside Myanmar", re.compile(r"[\u1000-\u109f]ǻ|ǻ[\u1000-\u109f]")),
    ),
    "1706300888234": (("ေိ sequence", re.compile("ေိ")),),
    "1693245630110": (("ေိ sequence", re.compile("ေိ")), ("ေူ sequence", re.compile("ေူ"))),
}


def focused_examples(name: str, text: str) -> list[tuple[str, int, str]]:
    examples = []
    for label, pattern in FOCUS_PATTERNS.get(name, ()):
        match = pattern.search(text)
        if match:
            examples.append((label, match.start(), excerpt(text, match.start(), match.end())))
    return examples


def json_string(value: str) -> str:
    # JSON already escapes C0 controls; explicitly escape C1 controls as well.
    quoted = json.dumps(value, ensure_ascii=False)
    return re.sub(r"[\x7f-\x9f]", lambda match: f"\\u{ord(match.group()):04x}", quoted)


def book_details(book: Book, include_evidence: bool) -> list[str]:
    lines = [
        f"Book: {json_string(book.name)}",
        f"Dataset row: {book.index}",
        f"PDF SHA-256: {book.sha256 or '[missing]'}",
        "Groups: " + (", ".join(key for key in GROUPS if key in book.groups) or "not flagged by these heuristics"),
    ]
    if book.author:
        lines.append(f"Author: {json_string(book.author)}")
    for number, line in book.lines:
        lines.append(f"Text line {number}: {json_string(line)}")
    if include_evidence:
        for key in GROUPS:
            if key not in book.groups:
                continue
            reason, offset, snippet = book.groups[key]
            where = f"; character offset {offset}" if offset is not None else ""
            lines.append(f"Signal [{key}]: {reason}{where}")
            if snippet:
                lines.append(f"  Sample: {json_string(snippet)}")
    return lines


def choose_samples(books: list[Book], dataset_sha: str, grouped: dict[str, list[Book]]) -> list[tuple[Book, str]]:
    selected: list[tuple[Book, str]] = []
    seen: set[str] = set()
    if dataset_sha == DATASET_SHA256:
        by_name: dict[str, list[Book]] = defaultdict(list)
        for book in books:
            by_name[book.name].append(book)
        for name, focus in REPRESENTATIVE_TARGETS:
            matches = by_name[name]
            if len(matches) != 1:
                raise ValueError(f"expected exactly one dataset row for representative {name!r}")
            book = matches[0]
            digest = book.sha256.lower()
            if not SHA256_RE.fullmatch(digest) or digest in seen or not book.groups:
                raise ValueError(f"representative {name!r} has an invalid/duplicate hash or no detected group")
            selected.append((book, focus))
            seen.add(digest)
    else:
        # Another dataset has not been curated: offer one per detected group,
        # without claiming the pinned dataset's finer selection applies to it.
        for key, (title, _, preferred) in GROUPS.items():
            candidates = [book for book in grouped[key] if SHA256_RE.fullmatch(book.sha256)]
            if not candidates:
                continue
            book = next((book for book in candidates if book.name == preferred), candidates[0])
            if book.sha256.lower() not in seen:
                selected.append((book, f"Uncurated fallback for {title}."))
                seen.add(book.sha256.lower())
    if dataset_sha == DATASET_SHA256:
        for key in GROUPS:
            if grouped[key] and not any(key in book.groups for book, _ in selected):
                raise ValueError(f"detected group {key!r} has no selected representative")
    return selected


def write_requests(path: Path, selected: list[tuple[Book, str]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
        writer.writerow(("group", "book", "pdf_sha256", "dataset_row"))
        for book, _ in selected:
            for group in GROUPS:
                if group in book.groups:
                    writer.writerow((group, book.name, book.sha256, book.index))


def write_type_samples(path: Path, selected: list[tuple[Book, str]],
                       grouped: dict[str, list[Book]], dataset_sha: str) -> None:
    covered = sum(any(group in book.groups for book, _ in selected) for group in GROUPS)
    lines = [
        "REPRESENTATIVE PDFS — MULTIPLE VISIBLE SUBTYPES, NOT VERIFIED FONT TYPES",
        f"Dataset SHA-256: {dataset_sha}",
        f"{len(selected)} distinct PDFs selected across {covered} overlapping review groups.",
        "The group index covers detected text signals, not every possible problem in every PDF.",
        "Similar symptoms do not prove identical fonts, mappings or causes; inspecting originals is necessary.",
        "Some repetition, foreign scripts, private-use characters or unusual headings can be intentional.",
        "PDF filenames append .pdf to dataset names; the original extension case is not verified.",
        "The SHA-256 is from the dataset; the original PDFs have not been downloaded or verified here.",
        "Text lines are the first three non-empty LF-delimited lines, JSON quoted without spelling changes.",
        "",
        "DETECTED-GROUP COVERAGE (candidate counts overlap)",
    ]
    for group, (title, _, _) in GROUPS.items():
        examples = [book.name for book, _ in selected if group in book.groups]
        lines.append(f"  [{group}] {title}: {len(grouped[group])} detected books; {len(examples)} selected")
        lines.append("    " + ", ".join(json_string(name) for name in examples))
    lines.extend(["", "SELECTED PDF DETAILS", ""])
    for index, (book, focus) in enumerate(selected, 1):
        lines.append(f"{index}. PDF: {json_string(book.name + '.pdf')}")
        lines.append(f"   PDF SHA-256: {book.sha256}")
        lines.append(f"   Dataset book name: {json_string(book.name)} (row {book.index})")
        lines.append(f"   Selected for: {focus}")
        for label, offset, snippet in book.focus_examples:
            lines.append(f"   Focus evidence [{label}] at character offset {offset}: {json_string(snippet)}")
        for group in GROUPS:
            if group not in book.groups:
                continue
            title, explanation, _ = GROUPS[group]
            reason, offset, snippet = book.groups[group]
            where = f"; character offset {offset}" if offset is not None else ""
            lines.append(f"   Signal [{group}]: {title}")
            lines.append(f"     {explanation}")
            lines.append(f"     Observed: {reason}{where}")
            if snippet:
                lines.append(f"     Sample: {json_string(snippet)}")
        for number, text in book.lines:
            lines.append(f"   Text line {number}: {json_string(text)}")
        lines.append("")
    path.write_text("\n".join(lines).rstrip("\n") + "\n", encoding="utf-8")


def scan(args: argparse.Namespace) -> int:
    try:
        import pyarrow.parquet as pq
    except ImportError:
        print("scan requires PyArrow: python -m pip install pyarrow", file=sys.stderr)
        return 2
    source = args.parquet
    digest = sha256_file(source)
    parquet = pq.ParquetFile(source)
    required = {"book", "text", "sha256"}
    missing = required - set(parquet.schema_arrow.names)
    if missing:
        raise ValueError(f"Parquet is missing columns: {', '.join(sorted(missing))}")
    columns = ["book", "text", "sha256"]
    if "author" in parquet.schema_arrow.names:
        columns.append("author")
    books = []
    for batch in parquet.iter_batches(batch_size=8, columns=columns):
        for row in batch.to_pylist():
            text = row.get("text") or ""
            name = row.get("book") or ""
            sha = row.get("sha256") or ""
            if not all(isinstance(value, str) for value in (text, name, sha)):
                raise ValueError(f"row {len(books)} has a non-string book, text or sha256")
            author = row.get("author") or ""
            books.append(Book(len(books), name, author, sha, first_nonempty_lines(text),
                              classify(text), focused_examples(name, text)))

    grouped = {key: [book for book in books if key in book.groups] for key in GROUPS}
    selected = choose_samples(books, digest, grouped)
    flagged = [book for book in books if book.groups]
    invalid_hashes = sum(not SHA256_RE.fullmatch(book.sha256) for book in books)
    unique_pdf_count = len(selected)

    header = [
        "MANGLED-BOOK REVIEW — GROUPED BY VISIBLE TEXT SYMPTOM",
        f"Dataset SHA-256: {digest}",
        f"Rows inspected: {len(books)}; flagged for review: {len(flagged)}; invalid/missing PDF hashes: {invalid_hashes}.",
    ]
    if digest == DATASET_SHA256:
        header.append(f"Source: htetmyetflam3/scraper, revision {DATASET_REVISION} (verified file hash).")
    header.extend([
        "A flagged passage does not mean the whole book is broken. Unflagged books are not certified clean.",
        "Groups can overlap. Similar symptoms do not prove the same font, PDF bytes, or cause.",
        "No original PDFs were inspected or verified by this report; the PDF hashes come from the dataset.",
        "Method: whole extracted texts are counted for selected Latin, Myanmar-mark, A/U, other-script,",
        "private-use, paired-Latin and control patterns. Other rules use five 2,000-character windows,",
        "the first 12,000 characters for repetition/numbered layout, or the first 3,000 for ASCII headings.",
        "This is not an exhaustive detector for every possible problem or a font/encoding classification.",
        "Text lines below are up to the first three non-empty LF-delimited lines, JSON quoted to preserve spaces",
        "and expose control characters; line numbers refer to the original text. No spelling is changed.",
        "",
        f"CURATED PDF SELECTION ({unique_pdf_count} distinct hashes across visible subtypes)",
        "The groups are represented, not proven equivalent: other PDFs can use different fonts or need separate checks.",
    ])
    if digest != DATASET_SHA256:
        header.append("Different dataset: the selection is an uncurated one-per-group fallback.")
    for book, focus in selected:
        tags = ", ".join(key for key in GROUPS if key in book.groups)
        header.append(f"  {json_string(book.name)} | {book.sha256} | {tags} | {focus}")
    header.extend([
        "",
        f"See representative-pdf-types.txt for all {unique_pdf_count} selected PDFs, hashes and excerpts.",
        "representative-pdf-names.txt is the bounded selection; mangled-pdf-names.txt is the larger review index,",
        "not a list of confirmed errors or mandatory downloads. The index appends .pdf to dataset book names;",
        "original extension case is unverified. The downloader verifies the dataset hash after transfer.",
        "It reads SSH_HOST, SSH_USER, SSH_PORT, SSH_KEY and SSH_DIR from your existing .env.",
        "SSH_DIR is searched recursively; no fixed VPS directory or SSH alias is assumed.",
        f"By default it requests the {unique_pdf_count} selected PDFs outside the repository and never uses Git:",
        "  python3 download-mangled-pdfs.py --env /path/to/.env",
        "Use --limit 10 for the first batch, --offset 10 --limit 10 for the next, or --book=NAME for one PDF.",
        "Use --sizes-only to check located candidates' sizes without downloading; paths are not hash-verified.",
        "Use --all only if you explicitly want the entire review index. Actual PDF sizes are unknown here.",
        "If names were changed, use --ledger /path/to/uploaded-host.txt or --search-by-hash; the latter",
        "reads every remote PDF and may be slow, but transfers only hashes before downloading matches.",
        "The downloader verifies PDF SHA-256 and never overwrites existing files. A ledger entry is not",
        "proof that a remote file still exists. The VPS connection has not been tested in this sandbox.",
        "",
        "GROUP INDEX",
    ])
    for key, (title, explanation, _) in GROUPS.items():
        members = grouped[key]
        header.extend(["", f"[{key}] {title} ({len(members)} books)", explanation])
        for book in members:
            header.append(f"  row {book.index}: {json_string(book.name)} | {book.sha256 or '[missing PDF hash]'}")
    header.extend(["", "BOOK DETAILS — FIRST THREE NON-EMPTY LINES AND OBSERVED SIGNALS", ""])
    for book in flagged:
        header.extend(book_details(book, include_evidence=True))
        header.append("")
    filenames: dict[str, str] = {}
    for book in flagged:
        if not book.name or any(ch in book.name for ch in "/\\\n\r\x00"):
            raise ValueError(f"row {book.index} has an unsafe or empty book name")
        if book.name in filenames and filenames[book.name] != book.sha256:
            raise ValueError(f"multiple PDF hashes share the book name {book.name!r}")
        filenames[book.name] = book.sha256
    args.report.write_text("\n".join(header).rstrip("\n") + "\n", encoding="utf-8")
    args.names.write_text("".join(name + ".pdf\n" for name in filenames), encoding="utf-8")
    args.selection.write_text("".join(book.name + ".pdf\n" for book, _ in selected), encoding="utf-8")
    write_type_samples(args.samples, selected, grouped, digest)
    if args.requests:
        write_requests(args.requests, selected)

    if args.all_snippets:
        lines = [
            "ALL DATASET BOOKS — UP TO THE FIRST THREE NON-EMPTY TEXT LINES",
            f"Dataset SHA-256: {digest}; rows: {len(books)}.",
            "Groups are review signals, not proof; no flag does not guarantee clean text.",
            "Text lines are JSON quoted without changing spelling; numbers refer to LF-delimited lines.",
            "",
        ]
        for book in books:
            lines.extend(book_details(book, include_evidence=False))
            lines.append("")
        args.all_snippets.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"Scanned {len(books)} rows; {len(flagged)} books have at least one review signal.")
    for key in GROUPS:
        print(f"  {key}: {len(grouped[key])}")
    print(f"Selected PDFs: {unique_pdf_count} distinct hashes; selection: {args.selection}; samples: {args.samples}; "
          f"report: {args.report}; review names: {args.names}")
    if args.requests:
        print(f"Representative request manifest: {args.requests}")
    if args.all_snippets:
        print(f"All-book snippets: {args.all_snippets}")
    return 0


def read_requests(path: Path) -> dict[str, dict[str, set[str]]]:
    requests: dict[str, dict[str, set[str]]] = {}
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        required = {"group", "book", "pdf_sha256"}
        if not reader.fieldnames or not required.issubset(reader.fieldnames):
            raise ValueError(f"{path} must have group, book, and pdf_sha256 TSV columns")
        for row in reader:
            sha = (row.get("pdf_sha256") or "").strip().lower()
            if not SHA256_RE.fullmatch(sha):
                raise ValueError(f"invalid SHA-256 in {path}, line {reader.line_num}")
            item = requests.setdefault(sha, {"books": set(), "groups": set()})
            item["books"].add(row.get("book") or "")
            item["groups"].add(row.get("group") or "")
    return requests


def locate(args: argparse.Namespace) -> int:
    requests = read_requests(args.requests)
    found: dict[str, list[tuple[str, str, str]]] = defaultdict(list)
    with args.ledger.open(encoding="utf-8") as handle:
        for line in handle:
            parts = line.rstrip("\r\n").split("\t")
            if len(parts) < 4:
                continue
            sha, name, remote_path, size = parts[:4]
            sha = sha.strip().lower()
            entry = (name, remote_path, size)
            if sha in requests and remote_path and entry not in found[sha]:
                found[sha].append(entry)
    writer = csv.writer(sys.stdout, delimiter="\t", lineterminator="\n")
    writer.writerow(("pdf_sha256", "groups", "dataset_books", "status", "ledger_name", "remote_path", "bytes"))
    missing = 0
    for sha, details in requests.items():
        prefix = (sha, ",".join(sorted(details["groups"])), ",".join(sorted(details["books"])))
        if not found[sha]:
            writer.writerow((*prefix, "NOT_IN_LEDGER", "", "", ""))
            missing += 1
        for name, path, size in found[sha]:
            writer.writerow((*prefix, "RECORDED_NOT_REVERIFIED", name, path, size))
    print(f"{len(requests) - missing}/{len(requests)} requested hashes found in ledger; remote availability not checked.", file=sys.stderr)
    return 1 if missing else 0


def verify(args: argparse.Namespace) -> int:
    requests = read_requests(args.requests)
    matched: set[str] = set()
    failed = False
    for path in args.pdfs:
        try:
            digest = sha256_file(path)
        except OSError as error:
            print(f"ERROR\t{path}\t{error}")
            failed = True
            continue
        if digest in requests:
            matched.add(digest)
            print(f"MATCH\t{path}\t{digest}\t{','.join(sorted(requests[digest]['groups']))}")
        else:
            failed = True
            print(f"NOT_REQUESTED\t{path}\t{digest}")
    print(f"Verified {len(matched)}/{len(requests)} distinct requested PDF hashes; others were not supplied.")
    return 1 if failed else 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    p_scan = sub.add_parser("scan", help="scan extracted Parquet texts and write review reports")
    p_scan.add_argument("parquet", type=Path)
    p_scan.add_argument("--report", type=Path, default=ROOT / "mangled-books-report.txt")
    p_scan.add_argument("--names", type=Path, default=ROOT / "mangled-pdf-names.txt")
    p_scan.add_argument("--selection", type=Path, default=ROOT / "representative-pdf-names.txt")
    p_scan.add_argument("--samples", type=Path, default=ROOT / "representative-pdf-types.txt")
    p_scan.add_argument("--requests", type=Path, help="optional TSV of representative PDF hashes")
    p_scan.add_argument("--all-snippets", type=Path, help="optional first-line index for every dataset row")
    p_scan.set_defaults(run=scan)
    p_locate = sub.add_parser("locate", help="match representative PDF hashes against the scraper upload ledger")
    p_locate.add_argument("requests", type=Path)
    p_locate.add_argument("ledger", type=Path)
    p_locate.set_defaults(run=locate)
    p_verify = sub.add_parser("verify", help="verify downloaded PDFs against the representative hashes")
    p_verify.add_argument("requests", type=Path)
    p_verify.add_argument("pdfs", type=Path, nargs="+")
    p_verify.set_defaults(run=verify)
    return parser


def main(argv: Iterable[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.run(args)
    except (OSError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
