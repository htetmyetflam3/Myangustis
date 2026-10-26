#!/usr/bin/env python3
"""
Description: Myanmar/Burmese PDF text extractor with Zawgyi→Unicode conversion,
mark-reordering preview with violation highlighting, and approval-based output.
Reads: PDF files with embedded CID fonts.
Processes: PDF parsing, TTF cmap extraction, layout-preserving text extraction,
           Zawgyi detection, Rabbit conversion, mark-reordering with space/tab
           handling within mark sequences, approval flow (terminal or frontend).
Outputs: .txt, .docx, or .pdf based on file extension.

Usage:
  python myanmar_pdf_tool.py <input.pdf> [output_path]
  python myanmar_pdf_tool.py input.pdf out.txt
  python myanmar_pdf_tool.py input.pdf out.docx
  python myanmar_pdf_tool.py input.pdf out.pdf
  python myanmar_pdf_tool.py input.pdf out.txt --admin
"""

import sys
import os
import re
import zlib
import struct
import argparse
import asyncio
from pathlib import Path
from typing import List, Tuple, Callable, Optional, Dict, Any

# ── External dependency: ZawgyiDetector ──
# Install: pip install myanmar-language-tools  (or your detector package)
# If not available, falls back to naive heuristic.
try:
    from detector import ZawgyiDetector
    HAS_DETECTOR = True
except ImportError:
    HAS_DETECTOR = False

# ── External dependency: FPDF for PDF output ──
try:
    from fpdf import FPDF
    HAS_FPDF = True
except ImportError:
    HAS_FPDF = False


# ═══════════════════════════════════════════════════════════════════════
#  RABBIT: Zawgyi → Unicode converter (embedded rules)
# ═══════════════════════════════════════════════════════════════════════

class Rabbit:
    """Zawgyi to Myanmar Unicode converter using embedded regex rules."""

    _RULES = [
        { "from": u"(\u103d|\u1087)", "to": u"\u103e" },
        { "from": u"\u103c", "to": u"\u103d" },
        { "from": u"(\u103b|\u107e|\u107f|\u1080|\u1081|\u1082|\u1083|\u1084)", "to": u"\u103c" },
        { "from": u"(\u103a|\u107d)", "to": u"\u103b" },
        { "from": u"\u1039", "to": u"\u103a" },
        { "from": u"\u106a", "to": u"\u1009" },
        { "from": u"\u106b", "to": u"\u100a" },
        { "from": u"\u106c", "to": u"\u1039\u100b" },
        { "from": u"\u106d", "to": u"\u1039\u100c" },
        { "from": u"\u106e", "to": u"\u100d\u1039\u100d" },
        { "from": u"\u106f", "to": u"\u100d\u1039\u100e" },
        { "from": u"\u1070", "to": u"\u1039\u100f" },
        { "from": u"(\u1071|\u1072)", "to": u"\u1039\u1010" },
        { "from": u"\u1060", "to": u"\u1039\u1000" },
        { "from": u"\u1061", "to": u"\u1039\u1001" },
        { "from": u"\u1062", "to": u"\u1039\u1002" },
        { "from": u"\u1063", "to": u"\u1039\u1003" },
        { "from": u"\u1065", "to": u"\u1039\u1005" },
        { "from": u"\u1068", "to": u"\u1039\u1007" },
        { "from": u"\u1069", "to": u"\u1039\u1008" },
        { "from": u"/(\u1073|\u1074)/g", "to": u"\u1039\u1011" },
        { "from": u"\u1075", "to": u"\u1039\u1012" },
        { "from": u"\u1076", "to": u"\u1039\u1013" },
        { "from": u"\u1077", "to": u"\u1039\u1014" },
        { "from": u"\u1078", "to": u"\u1039\u1015" },
        { "from": u"\u1079", "to": u"\u1039\u1016" },
        { "from": u"\u107a", "to": u"\u1039\u1017" },
        { "from": u"\u107c", "to": u"\u1039\u1019" },
        { "from": u"\u1085", "to": u"\u1039\u101c" },
        { "from": u"\u1033", "to": u"\u102f" },
        { "from": u"\u1034", "to": u"\u1030" },
        { "from": u"\u103f", "to": u"\u1030" },
        { "from": u"\u1086", "to": u"\u103f" },
        { "from": u"\u1036\u1088", "to": u"\u1088\u1036" },
        { "from": u"\u1088", "to": u"\u103e\u102f" },
        { "from": u"\u1089", "to": u"\u103e\u1030" },
        { "from": u"\u108a", "to": u"\u103d\u103e" },
        { "from": u"([\u1000-\u1021])\u1064", "to": u"\u1004\u103a\u1039\\1" },
        { "from": u"([\u1000-\u1021])\u108b", "to": u"\u1004\u103a\u1039\\1\u102d" },
        { "from": u"([\u1000-\u1021])\u108c", "to": u"\u1004\u103a\u1039\\1\u102e" },
        { "from": u"([\u1000-\u1021])\u108d", "to": u"\u1004\u103a\u1039\\1\u1036" },
        { "from": u"\u108e", "to": u"\u102d\u1036" },
        { "from": u"\u108f", "to": u"\u1014" },
        { "from": u"\u1090", "to": u"\u101b" },
        { "from": u"\u1091", "to": u"\u100f\u1039\u1091" },
        { "from": u"\u1019\u102c(\u107b|\u1093)", "to": u"\u1019\u1039\u1018\u102c" },
        { "from": u"(\u107b|\u1093)", "to": u"\u103a\u1018" },
        { "from": u"(\u1094|\u1095)", "to": u"\u1037" },
        { "from": u"\u1096", "to": u"\u1039\u1010\u103d" },
        { "from": u"\u1097", "to": u"\u100b\u1039\u100b" },
        { "from": u"\u103c([\u1000-\u1021])([\u1000-\u1021])?", "to": u"\\1\u103c\\2" },
        { "from": u"([\u1000-\u1021])\u103c\u103a", "to": u"\u103c\\1\u103a" },
        { "from": u"\u1031([\u1000-\u1021])(\u103e)?(\u103b)?", "to": u"\\1\\2\\3\u1031" },
        { "from": u"([\u1000-\u1021])\u1031([\u103b\u103c\u103d\u103e]+)", "to": u"\\1\\2\u1031" },
        { "from": u"\u1032\u103d", "to": u"\u103d\u1032" },
        { "from": u"\u103d\u103b", "to": u"\u103b\u103d" },
        { "from": u"\u103a\u1037", "to": u"\u1037\u103a" },
        { "from": u"\u102f(\u102d|\u102e|\u1036|\u1037)\u102f", "to": u"\u102f\\1" },
        { "from": u"\u102f\u102f", "to": u"\u102f" },
        { "from": u"(\u102f|\u1030)(\u102d|\u102e)", "to": u"\\2\\1" },
        { "from": u"(\u103e)(\u103b|\u1037)", "to": u"\\2\\1" },
        { "from": u"\u1025(\u103a|\u102c)", "to": u"\u1009\\1" },
        { "from": u"\u1025\u102e", "to": u"\u1026" },
        { "from": u"\u1005\u103b", "to": u"\u1008" },
        { "from": u"\u1036(\u102f|\u1030)", "to": u"\\1\u1036" },
        { "from": u"\u1031\u1037\u103e", "to": u"\u103e\u1031\u1037" },
        { "from": u"\u1031\u103e\u102c", "to": u"\u103e\u1031\u102c" },
        { "from": u"\u105a", "to": u"\u102b\u103a" },
        { "from": u"\u1031\u103b\u103e", "to": u"\u103b\u103e\u1031" },
        { "from": u"(\u102d|\u102e)(\u103d|\u103e)", "to": u"\\2\\1" },
        { "from": u"\u102c\u1039([\u1000-\u1021])", "to": u"\u1039\\1\u102c" },
        { "from": u"\u103c\u1004\u103a\u1039([\u1000-\u1021])", "to": u"\u1004\u103a\u1039\\1\u103c" },
        { "from": u"\u1039\u103c\u103a\u1039([\u1000-\u1021])", "to": u"\u103a\u1039\\1\u103c" },
        { "from": u"\u103c\u1039([\u1000-\u1021])", "to": u"\u1039\\1\u103c" },
        { "from": u"\u1036\u1039([\u1000-\u1021])", "to": u"\u1039\\1\u1036" },
        { "from": u"\u1092", "to": u"\u100b\u1039\u100c" },
        { "from": u"\u104e", "to": u"\u104e\u1004\u103a\u1038" },
        { "from": u"\u1040(\u102b|\u102c|\u1036)", "to": u"\u101d\\1" },
        { "from": u"\u1025\u1039", "to": u"\u1009\u1039" },
        { "from": u"([\u1000-\u1021])\u103c\u1031\u103d", "to": u"\\1\u103c\u103d\u1031" },
        { "from": u"([\u1000-\u1021])\u103d\u1031\u103b", "to": u"\\1\u103b\u103d\u1031" },
    ]

    @classmethod
    def zg2uni(cls, text: str) -> str:
        for rule in cls._RULES:
            text = re.sub(rule["from"], rule["to"], text)
        return text


# ═══════════════════════════════════════════════════════════════════════
#  MARK REORDERING: Pure preview + apply, with space/tab handling
# ═══════════════════════════════════════════════════════════════════════

# The priority table is NOT defined here. There is exactly one in the project
# -- mm_score.MARK_ORDER, the grammar engine's -- and this standalone tool
# reads it too, so it can never drift from the package under modules/.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "modules"))
from mm_score import MARK_ORDER as _PRIORITY, MARKS as _MARKS_SET   # noqa: E402

_WHITESPACE = {' ', '\t'}


def _is_consonant(ch: str) -> bool:
    cp = ord(ch)
    return (0x1000 <= cp <= 0x102A) or cp == 0x103F


def _is_mark(ch: str) -> bool:
    return ch in _MARKS_SET


def _reorder_syllable(chars: List[str], start: int, end: int) -> Tuple[List[str], bool, str]:
    """
    Reorder marks within one syllable span [start, end).
    Handles spaces/tabs within the mark sequence: strips trailing whitespace
    from marks, preserves leading whitespace before consonant.

    Returns: (reordered_chars, has_violation, original_syllable_text)
    """
    if start >= end:
        return chars[start:end], False, ""

    # Find actual end: strip trailing spaces/tabs that sit inside mark sequence
    actual_end = end
    while actual_end > start and chars[actual_end - 1] in _WHITESPACE:
        actual_end -= 1

    if actual_end <= start:
        # Only whitespace — return as-is (shouldn't happen at syllable level)
        return chars[start:end], False, ""

    consonant = chars[start]
    marks = chars[start + 1:actual_end]
    trailing_ws = chars[actual_end:end]  # spaces/tabs after marks, before next char

    if not marks:
        # Consonant only (or consonant + trailing ws) — no marks to reorder
        result = [consonant] + trailing_ws
        return result, False, ""

    # Check current order vs canonical order
    current_priorities = [_PRIORITY[m] for m in marks if m in _MARKS_SET]

    # Build canonical order (deduplicate by priority)
    seen = set()
    canonical_marks = []
    for m in marks:
        if m not in _MARKS_SET:
            continue
        p = _PRIORITY[m]
        if p not in seen:
            seen.add(p)
            canonical_marks.append(m)
    canonical_marks.sort(key=lambda c: _PRIORITY[c])
    canonical_priorities = [_PRIORITY[m] for m in canonical_marks]

    has_violation = current_priorities != canonical_priorities
    original_syllable = "".join(chars[start:actual_end])

    result = [consonant] + canonical_marks + trailing_ws
    return result, has_violation, original_syllable if has_violation else ""


def preview_reorder(text: str) -> Tuple[str, List[str]]:
    """
    Preview what reordering would look like WITHOUT modifying the original.
    Spaces/tabs within mark sequences are stripped from the marks and
    appended after the reordered marks (preserving original formatting intent).

    Returns: (preview_text, list_of_violation_syllables)
    """
    if not text:
        return text, []

    chars = list(text)
    result = []
    violations = []
    i = 0

    # Leading non-consonants (preserve all, including spaces/tabs)
    while i < len(chars) and not _is_consonant(chars[i]):
        result.append(chars[i])
        i += 1

    while i < len(chars):
        ch = chars[i]
        if _is_consonant(ch):
            # Find end of this syllable:
            # marks + optional spaces/tabs within marks + boundary
            j = i + 1
            while j < len(chars):
                nxt = chars[j]
                if _is_consonant(nxt):
                    break
                if nxt in _WHITESPACE:
                    # Peek ahead: if more marks follow, this space is "within" marks
                    k = j + 1
                    while k < len(chars) and chars[k] in _WHITESPACE:
                        k += 1
                    if k < len(chars) and _is_mark(chars[k]):
                        # Space/tab is within mark sequence — include it
                        j += 1
                        continue
                    else:
                        # Space/tab is genuine delimiter — stop here
                        break
                if nxt not in _MARKS_SET:
                    break
                j += 1

            reordered, has_violation, syllable = _reorder_syllable(chars, i, j)
            result.extend(reordered)
            if has_violation:
                violations.append(syllable)
            i = j
        else:
            result.append(ch)
            i += 1

    return "".join(result), violations


def apply_reorder(text: str) -> str:
    """Actually apply reordering."""
    preview, _ = preview_reorder(text)
    return preview


# ═══════════════════════════════════════════════════════════════════════
#  HIGHLIGHT: Wrap violation syllables for frontend display
# ═══════════════════════════════════════════════════════════════════════

HIGHLIGHT_OPEN = "[[VIOLATE:"
HIGHLIGHT_CLOSE = "]]"


def highlight_violations(text: str, violations: List[str]) -> str:
    """Highlight violation syllables in text with markers."""
    if not violations:
        return text
    highlighted = text
    for syllable in violations:
        highlighted = highlighted.replace(syllable, f"{HIGHLIGHT_OPEN}{syllable}{HIGHLIGHT_CLOSE}")
    return highlighted


# ═══════════════════════════════════════════════════════════════════════
#  ENCODING DETECTION
# ═══════════════════════════════════════════════════════════════════════

class EncodingResult:
    ZAWGYI = "zawgyi"
    UNICODE = "unicode"
    OTHER = "other"


def detect_encoding(text: str) -> Tuple[str, float]:
    """Detect if text is Zawgyi, Unicode, or other. Returns (category, prob)."""
    if HAS_DETECTOR:
        detector = ZawgyiDetector()
        return detector.detect(text)

    # Naive fallback heuristic
    has_zawgyi = any(0x1060 <= ord(c) <= 0x1097 for c in text)
    if has_zawgyi:
        return EncodingResult.ZAWGYI, 0.95
    has_myanmar = any(_is_consonant(c) for c in text)
    if has_myanmar:
        return EncodingResult.UNICODE, 0.95
    return EncodingResult.OTHER, 0.0


# ═══════════════════════════════════════════════════════════════════════
#  APPROVAL API: Terminal (admin) + Frontend callback
# ═══════════════════════════════════════════════════════════════════════

ApprovalCallback = Callable[[str, List[str]], Any]  # returns bool or Future[bool]


async def _terminal_approval(highlighted_text: str, violations: List[str]) -> bool:
    """Admin terminal: blocks and waits for Y/N input."""
    print("\n" + "=" * 60)
    print("  MYANMAR TEXT REORDERING — ADMIN APPROVAL")
    print("=" * 60)
    print(f"  Violations found: {len(violations)}")
    if violations:
        print("  Sample violations:")
        for v in violations[:5]:
            print(f"    • {repr(v)}")
        if len(violations) > 5:
            print(f"    ... and {len(violations) - 5} more")
    print(f"\n  Preview (first 300 chars):")
    print(f"  {highlighted_text[:300]}...")
    print("=" * 60)

    while True:
        try:
            choice = input("\nApply reordering? [Y/n]: ").strip().lower()
            if choice in ("y", "yes", ""):
                return True
            if choice in ("n", "no"):
                return False
            print("  Please enter Y or N.")
        except (EOFError, KeyboardInterrupt):
            print("\n  Defaulting to NO (reject).")
            return False


# ═══════════════════════════════════════════════════════════════════════
#  PUBLIC API: Full pipeline per page
# ═══════════════════════════════════════════════════════════════════════

async def process_page(
    text: str,
    page_idx: int,
    *,
    is_admin: bool = False,
    approval_callback: Optional[ApprovalCallback] = None,
) -> Dict[str, Any]:
    """
    Process one page through detection → conversion → preview → approval → output.

    Returns dict:
        page: page number
        encoding: "zawgyi" | "unicode" | "other"
        converted: text after Zawgyi->Unicode (if applicable)
        preview: reordered preview text
        highlighted: text with [[VIOLATE:...]] markers
        violations: list of syllables that violate ordering
        approved: bool — whether reordering was applied
        output: final text after all processing
    """
    result = {
        "page": page_idx + 1,
        "encoding": None,
        "converted": text,
        "preview": text,
        "highlighted": text,
        "violations": [],
        "approved": False,
        "output": text,
    }

    # ── Step 1: Detect encoding ──
    category, prob = detect_encoding(text)
    result["encoding"] = category

    # ── Step 2: Convert if Zawgyi ──
    working_text = text
    if category == EncodingResult.ZAWGYI:
        working_text = Rabbit.zg2uni(text)
        result["converted"] = working_text
        print(f"    Page {page_idx+1}: ZAWGYI (p={prob:.3f}) → converted")
    elif category == EncodingResult.UNICODE:
        print(f"    Page {page_idx+1}: UNICODE (p={prob:.3f}) → skipped conversion")
    else:
        print(f"    Page {page_idx+1}: OTHER → passed through")
        return result

    # ── Step 3: Preview reordering (pure, no side effects) ──
    preview_text, violations = preview_reorder(working_text)
    highlighted = highlight_violations(working_text, violations)

    result["preview"] = preview_text
    result["highlighted"] = highlighted
    result["violations"] = violations

    # ── Step 4: Await approval ──
    approved = False
    if violations:
        if is_admin:
            approved = await _terminal_approval(highlighted, violations)
        elif approval_callback is not None:
            cb_result = approval_callback(highlighted, violations)
            if asyncio.isfuture(cb_result) or asyncio.iscoroutine(cb_result):
                approved = await cb_result
            else:
                approved = bool(cb_result)
        else:
            # No approval mechanism — default to safe: NO reordering
            approved = False
    else:
        # No violations — auto-approve (nothing to reorder)
        approved = True

    result["approved"] = approved

    # ── Step 5: Apply or skip ──
    if approved:
        result["output"] = preview_text
    else:
        result["output"] = working_text

    return result


# ═══════════════════════════════════════════════════════════════════════
#  BATCH API: Process all pages
# ═══════════════════════════════════════════════════════════════════════

async def process_all_pages(
    all_texts: List[str],
    *,
    is_admin: bool = False,
    approval_callback: Optional[ApprovalCallback] = None,
) -> List[Dict[str, Any]]:
    """Process all pages and return full result objects."""
    results = []
    for idx, text in enumerate(all_texts):
        res = await process_page(
            text, idx,
            is_admin=is_admin,
            approval_callback=approval_callback,
        )
        results.append(res)
    return results


def process_all_pages_sync(
    all_texts: List[str],
    *,
    is_admin: bool = False,
    approval_callback: Optional[ApprovalCallback] = None,
) -> List[Dict[str, Any]]:
    """Synchronous wrapper."""
    return asyncio.run(process_all_pages(
        all_texts,
        is_admin=is_admin,
        approval_callback=approval_callback,
    ))


# ═══════════════════════════════════════════════════════════════════════
#  OUTPUT WRITERS
# ═══════════════════════════════════════════════════════════════════════

def write_txt(out_path: str, pdf_path: str, all_texts: List[str], metadata: Dict[str, str]) -> None:
    meta_lines = [f"# Source: {pdf_path}", f"# Pages: {len(all_texts)}"]
    if metadata:
        for k, v in metadata.items():
            meta_lines.append(f"# {k}: {v}")
    meta_lines.append("#" * 50)
    meta_header = '\n'.join(meta_lines) + '\n\n'

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(meta_header)
        for idx, txt in enumerate(all_texts):
            f.write(f"--- Page {idx+1} ---\n")
            f.write(txt if txt else "")
            f.write("\n\n")
    print(f"[+] Saved TXT: {out_path}")


def write_docx(out_path: str, pdf_path: str, all_texts: List[str], metadata: Dict[str, str]) -> None:
    import zipfile
    with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr('[Content_Types].xml',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            '</Types>')
        zf.writestr('_rels/.rels',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            '</Relationships>')
        body = []
        body.append(f'<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Source: {pdf_path}</w:t></w:r></w:p>')
        body.append(f'<w:p><w:r><w:t>Pages: {len(all_texts)}</w:t></w:r></w:p>')
        for k, v in metadata.items():
            body.append(f'<w:p><w:r><w:t>{k}: {v}</w:t></w:r></w:p>')
        for idx, txt in enumerate(all_texts):
            body.append(f'<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Page {idx+1}</w:t></w:r></w:p>')
            for line in (txt or "").split('\n'):
                line_esc = line.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace('"',"&quot;")
                body.append(f'<w:p><w:r><w:t xml:space="preserve">{line_esc}</w:t></w:r></w:p>')
        doc = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            f'<w:body>{"".join(body)}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>'
            '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body>'
            '</w:document>'
        )
        zf.writestr('word/document.xml', doc)
    print(f"[+] Saved DOCX: {out_path}")


def write_pdf(out_path: str, pdf_path: str, all_texts: List[str], metadata: Dict[str, str]) -> None:
    if not HAS_FPDF:
        print("[-] fpdf not installed. Cannot write PDF output.")
        print("    pip install fpdf")
        return

    script_dir = Path(__file__).parent
    # Output fonts: Praser/fonts/output/ (shared with module/ and the js port)
    font_dir = script_dir.parent / "fonts" / "output"
    preferred = font_dir / "MyanmarSagar.ttf"
    fallback = None
    if font_dir.exists():
        ttf_files = sorted(font_dir.glob("*.ttf"))
        if ttf_files:
            fallback = ttf_files[0]

    myanmar_font = preferred if preferred.exists() else fallback
    if myanmar_font is None:
        print("[-] No Myanmar Unicode TTF font found in Praser/fonts/output/")
        print(f"    Place MyanmarSagar.ttf (or any .ttf) in: {font_dir}")
        return

    print(f"[+] Embedding font: {myanmar_font.name}")
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_font("Myanmar", "", str(myanmar_font), uni=True)
    pdf.set_font("Myanmar", "", 11)

    for idx, txt in enumerate(all_texts):
        pdf.add_page()
        pdf.set_xy(10, 10)
        if idx == 0:
            pdf.set_font("Myanmar", "", 9)
            pdf.set_text_color(100, 100, 100)
            pdf.cell(0, 5, f"Source: {pdf_path}", ln=True)
            pdf.cell(0, 5, f"Pages: {len(all_texts)}", ln=True)
            for k, v in metadata.items():
                pdf.cell(0, 5, f"{k}: {v}", ln=True)
            pdf.ln(5)
            pdf.set_text_color(0, 0, 0)
            pdf.set_font("Myanmar", "", 11)
        for line in (txt or "").split("\n"):
            pdf.cell(0, 5, line, ln=True)
    pdf.output(out_path)
    print(f"[+] Saved PDF: {out_path}")


# ═══════════════════════════════════════════════════════════════════════
#  PDF PARSING (from your original code)
# ═══════════════════════════════════════════════════════════════════════

def parse_pdf_objects(raw: bytes) -> Dict[Tuple[int, int], bytes]:
    obj_pat = re.compile(rb'(\d+)\s+(\d+)\s+obj')
    objects = {}
    for m in obj_pat.finditer(raw):
        n, g = int(m.group(1)), int(m.group(2))
        start = m.end()
        end = raw.find(b'endobj', start)
        if end == -1:
            continue
        objects[(n, g)] = raw[start:end].strip()
    return objects


def get_stream(objects: Dict[Tuple[int, int], bytes], num: int, gen: int = 0) -> Optional[bytes]:
    d = objects.get((num, gen), b'')
    i = d.find(b'stream')
    if i == -1:
        return None
    j = i + 6
    if j < len(d) and d[j:j+1] == b'\r':
        j += 1
    if j < len(d) and d[j:j+1] == b'\n':
        j += 1
    k = d.rfind(b'endstream')
    if k == -1:
        return None
    b = d[j:k]
    if b'/FlateDecode' in d[:i]:
        try:
            return zlib.decompress(b)
        except Exception:
            return None
    return b


def extract_metadata(objects: Dict[Tuple[int, int], bytes]) -> Dict[str, str]:
    metadata = {}
    for (n, g), d in objects.items():
        d_str = d.decode('latin-1', errors='replace')
        if re.search(r'/Type\s*/Catalog', d_str):
            info_m = re.search(r'/Info\s+(\d+)\s+\d+\s+R', d_str)
            if info_m:
                info_n = int(info_m.group(1))
                info_d = objects.get((info_n, 0), b'').decode('latin-1', errors='replace')
                for kv in re.finditer(r'/([^\s/\[\]<>()]+)\s*\(([^)]*)\)', info_d):
                    metadata[kv.group(1)] = kv.group(2)
            break
    return metadata


def find_font_file2(objects: Dict[Tuple[int, int], bytes]) -> Optional[Tuple[int, int]]:
    for (n, g), d in objects.items():
        d_str = d.decode('latin-1', errors='replace')
        if '/FontFile2' in d_str:
            m = re.search(r'/FontFile2\s+(\d+)\s+(\d+)\s+R', d_str)
            if m:
                return int(m.group(1)), int(m.group(2))
    return None


def parse_ttf_cmap(data: bytes) -> Dict[int, int]:
    if len(data) < 12:
        return {}
    num_tables = struct.unpack('>H', data[4:6])[0]
    tbls = {}
    off = 12
    for _ in range(num_tables):
        if off + 16 > len(data):
            break
        tag = data[off:off+4].decode('ascii', errors='replace')
        tbl_offset = struct.unpack('>I', data[off+8:off+12])[0]
        tbls[tag] = tbl_offset
        off += 16
    if 'cmap' not in tbls:
        return {}
    cmap_off = tbls['cmap']
    if cmap_off + 4 > len(data):
        return {}
    cmap = data[cmap_off:]
    num_sub = struct.unpack('>H', cmap[2:4])[0]
    mappings = {}
    off = 4
    for _ in range(num_sub):
        if off + 8 > len(cmap):
            break
        plat, enc = struct.unpack('>HH', cmap[off:off+4])
        sub_off = struct.unpack('>I', cmap[off+4:off+8])[0]
        off += 8
        if sub_off + 2 > len(cmap):
            continue
        sub = cmap[sub_off:]
        if len(sub) < 2:
            continue
        fmt = struct.unpack('>H', sub[0:2])[0]
        if fmt == 4:
            if len(sub) < 14:
                continue
            seg_count = struct.unpack('>H', sub[6:8])[0] // 2
            if len(sub) < 14 + seg_count * 8:
                continue
            ends = [struct.unpack('>H', sub[14+i*2:16+i*2])[0] for i in range(seg_count)]
            so = 14 + seg_count * 2 + 2
            starts = [struct.unpack('>H', sub[so+i*2:so+2+i*2])[0] for i in range(seg_count)]
            do = so + seg_count * 2
            deltas = [struct.unpack('>h', sub[do+i*2:do+2+i*2])[0] for i in range(seg_count)]
            ro = do + seg_count * 2
            ranges = [struct.unpack('>H', sub[ro+i*2:ro+2+i*2])[0] for i in range(seg_count)]
            for j in range(seg_count):
                if starts[j] == 0xFFFF:
                    continue
                for c in range(starts[j], ends[j] + 1):
                    if ranges[j] == 0:
                        gid = (c + deltas[j]) & 0xFFFF
                    else:
                        idx = ranges[j] // 2 + (c - starts[j]) + j - seg_count
                        if ro + idx * 2 + 2 > len(sub):
                            continue
                        gid = struct.unpack('>H', sub[ro + idx*2:ro + idx*2 + 2])[0]
                        if gid:
                            gid = (gid + deltas[j]) & 0xFFFF
                    if gid:
                        mappings[c] = gid
        elif fmt == 6:
            if len(sub) < 10:
                continue
            first_code = struct.unpack('>H', sub[6:8])[0]
            entry_count = struct.unpack('>H', sub[8:10])[0]
            for j in range(entry_count):
                if 10 + j * 2 + 2 > len(sub):
                    break
                gid = struct.unpack('>H', sub[10+j*2:12+j*2])[0]
                if gid:
                    mappings[first_code + j] = gid
        elif fmt == 12:
            if len(sub) < 16:
                continue
            num_groups = struct.unpack('>I', sub[12:16])[0]
            go = 16
            for _ in range(num_groups):
                if go + 12 > len(sub):
                    break
                sc, ec, sg = struct.unpack('>III', sub[go:go+12])
                go += 12
                for c in range(sc, ec + 1):
                    mappings[c] = sg + (c - sc)
    return mappings


def collect_pages(objects: Dict[Tuple[int, int], bytes], page_num: int, gen: int = 0) -> List[Tuple[int, int]]:
    d = objects.get((page_num, gen), b'')
    d_str = d.decode('latin-1', errors='replace')
    if re.search(r'/Type\s*/Page(?!s)', d_str):
        return [(page_num, gen)]
    if re.search(r'/Type\s*/Pages', d_str):
        pages = []
        km = re.search(rb'/Kids\s*\[(.*?)\]', d, re.DOTALL)
        if km:
            kids_text = km.group(1).decode('latin-1', errors='replace')
            for ref in re.findall(r'(\d+)\s+\d+\s+R', kids_text):
                pages.extend(collect_pages(objects, int(ref)))
        return pages
    return []


def find_root_pages(objects: Dict[Tuple[int, int], bytes]) -> Optional[int]:
    for (n, g), d in objects.items():
        d_str = d.decode('latin-1', errors='replace')
        if re.search(r'/Type\s*/Catalog', d_str):
            pm = re.search(r'/Pages\s+(\d+)\s+\d+\s+R', d_str)
            if pm:
                return int(pm.group(1))
    return None


def extract_page_text_layout(objects: Dict[Tuple[int, int], bytes], page_num: int, page_gen: int,
                              gid_to_uni: Dict[int, int]) -> str:
    pd = objects.get((page_num, page_gen), b'')
    pd_str = pd.decode('latin-1', errors='replace')
    streams = []
    cm = re.search(r'/Contents\s+(\d+)\s+\d+\s+R', pd_str)
    if cm:
        streams = [int(cm.group(1))]
    else:
        ca = re.search(r'/Contents\s*\[(.*?)\]', pd_str, re.DOTALL)
        if ca:
            streams = [int(x) for x in re.findall(r'(\d+)\s+\d+\s+R', ca.group(1))]

    pieces = []
    for sn in streams:
        s = get_stream(objects, sn)
        if not s:
            continue
        content = s.decode('latin-1', errors='replace')
        blocks = re.findall(r'BT\s+(.*?)\s+ET', content, re.DOTALL)
        for block in blocks:
            tm_match = re.search(r'([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+Tm', block)
            if not tm_match:
                continue
            x = float(tm_match.group(5))
            y = float(tm_match.group(6))
            block_texts = []

            for tj in re.finditer(r'\[(.*?)\]\s*TJ', block):
                arr = tj.group(1)
                i = 0
                arr_text = ""
                while i < len(arr):
                    while i < len(arr) and arr[i] in ' \t\n\r':
                        i += 1
                    if i >= len(arr):
                        break
                    if arr[i] == '<':
                        j = arr.find('>', i)
                        if j == -1:
                            break
                        hex_str = arr[i+1:j]
                        for k in range(0, len(hex_str), 4):
                            cid_hex = hex_str[k:k+4]
                            if len(cid_hex) < 4:
                                continue
                            cid = int(cid_hex, 16)
                            uni = gid_to_uni.get(cid)
                            if uni:
                                arr_text += chr(uni)
                            else:
                                arr_text += f"[{cid_hex}]"
                        i = j + 1
                    elif arr[i] == '(':
                        depth = 1
                        j = i + 1
                        while j < len(arr) and depth > 0:
                            if arr[j] == '\\' and j + 1 < len(arr):
                                j += 2
                                continue
                            if arr[j] == '(':
                                depth += 1
                            elif arr[j] == ')':
                                depth -= 1
                            j += 1
                        s_text = arr[i+1:j-1]
                        s_text = s_text.replace('\\n', '\n').replace('\\r', '\r').replace('\\t', '\t')
                        s_text = s_text.replace('\\(', '(').replace('\\)', ')').replace('\\\\', '\\')
                        arr_text += s_text
                        i = j
                    elif arr[i] == '-':
                        j = i + 1
                        while j < len(arr) and (arr[j].isdigit() or arr[j] == '.'):
                            j += 1
                        i = j
                    else:
                        j = i
                        while j < len(arr) and (arr[j].isdigit() or arr[j] == '.'):
                            j += 1
                        i = j
                block_texts.append(arr_text)

            for tj in re.finditer(r'<([0-9A-Fa-f]+)>\s*Tj', block):
                hex_str = tj.group(1)
                t = ""
                for k in range(0, len(hex_str), 4):
                    cid_hex = hex_str[k:k+4]
                    if len(cid_hex) < 4:
                        continue
                    cid = int(cid_hex, 16)
                    uni = gid_to_uni.get(cid)
                    if uni:
                        t += chr(uni)
                    else:
                        t += f"[{cid_hex}]"
                block_texts.append(t)

            for tj in re.finditer(r'\((.*?)\)\s*Tj', block):
                s_text = tj.group(1)
                s_text = s_text.replace('\\n', '\n').replace('\\r', '\r').replace('\\t', '\t')
                s_text = s_text.replace('\\(', '(').replace('\\)', ')').replace('\\\\', '\\')
                block_texts.append(s_text)

            if block_texts:
                pieces.append((y, x, ''.join(block_texts)))

    if not pieces:
        return ""

    pieces.sort(key=lambda p: (-p[0], p[1]))
    lines = []
    current_y = pieces[0][0]
    current_line = []
    for y, x, text in pieces:
        if abs(y - current_y) > 3:
            lines.append(''.join(t for _, t in sorted(current_line)))
            current_line = []
            current_y = y
        current_line.append((x, text))
    if current_line:
        lines.append(''.join(t for _, t in sorted(current_line)))
    return '\n'.join(lines)


# ═══════════════════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════════════════

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract Burmese text from PDF, convert Zawgyi→Unicode, "
                    "preview mark-reordering with approval flow."
    )
    parser.add_argument("pdf", help="Input PDF file path")
    parser.add_argument("out", nargs="?", default="", help="Output file/dir path (.txt/.docx/.pdf)")
    parser.add_argument("--admin", action="store_true", help="Admin mode: terminal approval for reordering")
    parser.add_argument("--auto-approve", action="store_true", help="Auto-approve all reordering (no approval)")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    pdf_path = args.pdf

    # 1. Read PDF
    with open(pdf_path, "rb") as f:
        raw = f.read()
    print(f"[+] PDF size: {len(raw):,} bytes")

    # 2. Parse objects
    objects = parse_pdf_objects(raw)
    print(f"[+] Objects found: {len(objects)}")

    # 3. Metadata
    metadata = extract_metadata(objects)
    if metadata:
        print(f"[+] Metadata: {metadata}")
    else:
        print("[+] No metadata found")

    # 4. Extract embedded TTF
    ff2_ref = find_font_file2(objects)
    if not ff2_ref:
        print("[-] No embedded FontFile2 found. Exiting.")
        sys.exit(1)
    print(f"[+] FontFile2 at obj {ff2_ref[0]}")

    ttf = get_stream(objects, *ff2_ref)
    if not ttf:
        print("[-] Failed to extract font stream. Exiting.")
        sys.exit(1)
    print(f"[+] TTF size: {len(ttf):,} bytes")

    # 5. Parse cmap
    cmap_uni_to_gid = parse_ttf_cmap(ttf)
    gid_to_uni = {gid: uni for uni, gid in cmap_uni_to_gid.items() if gid}
    print(f"[+] cmap entries: {len(cmap_uni_to_gid)}, reverse: {len(gid_to_uni)}")

    # 6. Collect pages
    pages_obj = find_root_pages(objects)
    if not pages_obj:
        print("[-] No page tree found. Exiting.")
        sys.exit(1)
    all_pages = collect_pages(objects, pages_obj)
    print(f"[+] Total pages: {len(all_pages)}")

    # 7. Extract text from all pages
    all_texts = []
    for idx, (pnum, pgen) in enumerate(all_pages):
        txt = extract_page_text_layout(objects, pnum, pgen, gid_to_uni)
        all_texts.append(txt)
        if (idx + 1) % 500 == 0:
            print(f"    ... processed {idx+1}/{len(all_pages)} pages")

    total_chars = sum(len(t) for t in all_texts)
    print(f"[+] Total characters: {total_chars:,}")

    # 8. Process all pages: detection → conversion → preview → approval → output
    print("[+] Processing pages (detection, conversion, reordering preview)...")

    if args.auto_approve:
        # Auto-approve: no callback, no admin — just apply reordering
        results = process_all_pages_sync(all_texts, is_admin=False, approval_callback=None)
        # Override: force approve
        for r in results:
            if r["violations"]:
                r["approved"] = True
                r["output"] = r["preview"]
    elif args.admin:
        # Admin mode: terminal blocking approval
        results = process_all_pages_sync(all_texts, is_admin=True, approval_callback=None)
    else:
        # Default: no approval mechanism — safe mode, no reordering applied
        results = process_all_pages_sync(all_texts, is_admin=False, approval_callback=None)

    # Collect final output texts
    final_texts = [r["output"] for r in results]

    # Summary
    zg_count = sum(1 for r in results if r["encoding"] == EncodingResult.ZAWGYI)
    uc_count = sum(1 for r in results if r["encoding"] == EncodingResult.UNICODE)
    unk_count = sum(1 for r in results if r["encoding"] == EncodingResult.OTHER)
    approved_count = sum(1 for r in results if r["approved"])
    rejected_count = sum(1 for r in results if not r["approved"] and r["violations"])
    print(f"[+] Summary: {zg_count} Zawgyi, {uc_count} Unicode, {unk_count} unknown")
    print(f"[+] Reordering: {approved_count} approved, {rejected_count} rejected, "
          f"{len(results) - approved_count - rejected_count} no-violation (auto)")

    # 9. Resolve output path
    out_arg = args.out
    if not out_arg:
        out_arg = "."
    out_ext = os.path.splitext(out_arg)[1].lower()
    base_name = os.path.splitext(os.path.basename(pdf_path))[0]

    if out_ext in ('.txt', '.docx', '.pdf'):
        out_path = out_arg
    else:
        os.makedirs(out_arg, exist_ok=True)
        out_path = os.path.join(out_arg, base_name + '.txt')
        out_ext = '.txt'

    out_dir = os.path.dirname(os.path.abspath(out_path))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    # 10. Write output
    if out_ext == '.txt':
        write_txt(out_path, pdf_path, final_texts, metadata)
    elif out_ext == '.docx':
        write_docx(out_path, pdf_path, final_texts, metadata)
    elif out_ext == '.pdf':
        write_pdf(out_path, pdf_path, final_texts, metadata)

    print("[+] Done.")


if __name__ == "__main__":
    main()
