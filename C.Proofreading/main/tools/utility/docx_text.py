# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Extract the supplied Burmese DOCX prose into a plain UTF-8 text file.

This reads the DOCX ZIP/XML directly: it keeps prose, tabs and explicit breaks,
removes only the observed PDF/export wrappers (`# Source:`, `# Pages:`,
`# Detection:`, `--- Page N ---`, separators), and does not tag or normalize
Burmese text.

Default output is the matching text beside the DOCX input:
    content/source/ယဲ့နင်.docx -> content/source/ယဲ့နင်.txt

The original DOCX is never modified. The text preserves the translator's
existing quotation characters; it is not a quote-repair pass. Trailing spaces
left by the PDF-to-DOCX export are trimmed; no other whitespace is changed.
Detected chapter headings get a sequential `[[HCRAWLER MARKER N]]` line directly
above them; the number is independent of the printed chapter number.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
from xml.etree import ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parent.parent
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
# Same marker contract as HCrawler. The number is a chapter-unit counter, not
# the chapter number printed in the text.
MARKER = "[[HCRAWLER MARKER {number}]]"
CHAPTER_HEADING = re.compile(
    r"^(?:"
    r"Chapter\s*[-–—:：]?\s*\d+"
    r"|(?:အခန်း|အပိုင်း)\s*[-–—:：]?\s*[\(（]?\s*[0-9၀-၉]+"
    r")\s*[\)）]?(?:\s*[-–—:：]?\s*.*)?$",
    re.IGNORECASE,
)


def digest(path):
    with Path(path).open("rb") as stream:
        if hasattr(hashlib, "file_digest"):
            return hashlib.file_digest(stream, "sha256").hexdigest()
        return hashlib.sha256(stream.read()).hexdigest()


def mark_chapters(text):
    """Put an HCrawler marker immediately above each detected chapter heading."""
    lines = []
    count = 0
    for line in text.split("\n"):
        if CHAPTER_HEADING.fullmatch(line.strip()):
            count += 1
            lines.append(MARKER.format(number=count))
        lines.append(line)
    return "\n".join(lines), count


def extract(docx, text_path, index_path, limit):
    """Write prose paragraphs and their offsets from a DOCX."""
    counts = Counter()
    char_offset = byte_offset = 0
    pdf_page = None
    with ZipFile(docx) as archive, archive.open("word/document.xml") as xml, \
            text_path.open("w", encoding="utf-8", newline="\n") as text_out, \
            index_path.open("w", encoding="utf-8") as index_out:
        for _, element in ET.iterparse(xml, events=("end",)):
            if element.tag != W + "p":
                continue
            counts["xml_paragraphs"] += 1
            parts = []
            for node in element.iter():
                if node.tag == W + "t":
                    parts.append(node.text or "")
                elif node.tag in (W + "br", W + "cr"):
                    parts.append("\n")
                elif node.tag == W + "tab":
                    parts.append("\t")
            value = "".join(parts)
            element.clear()
            if not value.strip():
                continue
            counts["nonempty_paragraphs_seen"] += 1
            stripped = value.strip()
            page = re.fullmatch(r"--- Page (\d+) ---", stripped)
            if page:
                pdf_page = int(page[1])
                counts["page_wrappers_removed"] += 1
                continue
            if stripped.startswith(("# Source:", "# Pages:", "# Detection:")) or re.fullmatch(r"#+", stripped):
                counts["metadata_wrappers_removed"] += 1
                continue
            if re.fullmatch(r"[-\s]{4,}", value):
                counts["separator_wrappers_removed"] += 1
                continue
            if limit is not None and counts["prose_paragraphs"] >= limit:
                break
            encoded = value.encode("utf-8")
            record = {
                "docx_paragraph": counts["xml_paragraphs"],
                "pdf_page": pdf_page,
                "char_start": char_offset,
                "char_end": char_offset + len(value),
                "byte_start": byte_offset,
                "byte_end": byte_offset + len(encoded),
            }
            text_out.write(value + "\n")
            index_out.write(json.dumps(record, ensure_ascii=False) + "\n")
            counts["prose_paragraphs"] += 1
            char_offset += len(value) + 1
            byte_offset += len(encoded) + 1
    if not counts["prose_paragraphs"]:
        raise ValueError("DOCX contains no nonempty prose")
    return dict(counts)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input", nargs="?", type=Path,
                        help="DOCX path; default: the single DOCX in content/source/")
    parser.add_argument("-o", "--output", type=Path,
                        help="Text path; default: content/source/<stem>.txt")
    parser.add_argument("--force", action="store_true", help="Overwrite an existing text output")
    parser.add_argument("--repair-damage", action="store_true",
                        help="Repair PDF-conversion vowel displacement (see repair_damage.py)")
    args = parser.parse_args(argv)

    temporary = None
    index_temporary = None
    try:
        docx = args.input
        if docx is None:
            candidates = list((ROOT / "content" / "source").glob("*.docx"))
            if len(candidates) != 1:
                raise ValueError("Specify a DOCX path (there is not exactly one DOCX in content/source/)")
            docx = candidates[0]
        docx = docx.resolve()
        if not docx.is_file():
            raise ValueError(f"Input DOCX does not exist: {docx}")
        destination = (args.output or (ROOT / "content" / "source" / (docx.stem + ".txt"))).resolve()
        if destination == docx:
            raise ValueError("Text output must not replace the DOCX")
        if destination.exists() and not args.force:
            raise ValueError(f"Output already exists: {destination}; use --force")
        destination.parent.mkdir(parents=True, exist_ok=True)

        original_hash = digest(docx)
        descriptor, temporary_name = tempfile.mkstemp(prefix=".docx-text-", suffix=".txt",
                                                      dir=destination.parent)
        os.close(descriptor)
        temporary = Path(temporary_name)
        descriptor, index_name = tempfile.mkstemp(prefix=".docx-index-", suffix=".jsonl",
                                                  dir=destination.parent)
        os.close(descriptor)
        index_temporary = Path(index_name)
        counts = extract(docx, temporary, index_temporary, None)
        if digest(docx) != original_hash:
            raise ValueError("Original DOCX was modified during extraction")

        text = temporary.read_text(encoding="utf-8")
        cleaned_lines = []
        trimmed_lines = 0
        for line in text.split("\n"):
            cleaned = line.rstrip(" \t\r")
            if cleaned != line:
                trimmed_lines += 1
            cleaned_lines.append(cleaned)
        cleaned = "\n".join(cleaned_lines)
        marked, marker_count = mark_chapters(cleaned)
        damage_summary = None
        if args.repair_damage:
            sys.path.insert(0, str(Path(__file__).resolve().parent))
            from repair_damage import Dictionary, MASTER, repair  # noqa: PLC0415
            marked, _details, damage_summary = repair(marked, Dictionary(MASTER))
        with temporary.open("w", encoding="utf-8", newline="") as stream:
            stream.write(marked)
        text = marked
        with temporary.open("r", encoding="utf-8", newline="") as stream:
            line_count = sum(1 for _ in stream)
        os.chmod(temporary, 0o644)
        os.replace(temporary, destination)
        temporary = None
        summary = {
            "input": str(docx),
            "output": str(destination),
            "output_sha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
            "output_bytes": destination.stat().st_size,
            "output_chars": len(text),
            "output_lines": line_count,
            "straight_quotes": text.count('"'),
            "curly_open_quotes": text.count("“"),
            "curly_close_quotes": text.count("”"),
            "trailing_whitespace_lines_trimmed": trimmed_lines,
            "chapter_markers": marker_count,
            "damage_repairs": (damage_summary or {}).get("repairs", 0),
            "damage_skipped": (damage_summary or {}).get("skipped", {}),
            "damage_changed": (damage_summary or {}).get("changed", {}),
            "chapter_marker_format": MARKER.replace("{number}", "N"),
            "marker_placement": "line immediately above each detected chapter heading",
            "docx_sha256": original_hash,
            "original_docx_unchanged": True,
            **counts,
        }
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError, KeyError, UnicodeError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
        if index_temporary is not None:
            index_temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    raise SystemExit(main())
