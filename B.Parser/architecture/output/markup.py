"""Markup strings, mirrored from two JS modules.

``prised/@core/runtime/markup.js`` -- the parsed result's shape: one
marked-up string per page. Parsing converts geometry and font evidence into
this string once, then coordinates are dropped; nothing downstream
preserves layout boundaries. Marks: ``<b>`` bold, ``<i>`` italic,
``<h1>``/``<h2>`` heading (by font-size jump), ``\\n`` line break,
``\\n\\n`` paragraph break. Content escapes ``& < >``.

``@output/helper/markup.js`` -- reading those strings back: strip for the
plain-text writer, parse into ``{tag, lines: [[run, ...], ...]}`` for the
DOCX/PDF writers.

Both halves live here because they are one contract: whatever
``lines_to_markup`` emits, ``parse_markup`` must read. Splitting them into
two files (as the JS tree does) invites the two escaping rules to drift.
"""

from __future__ import annotations

import re

__all__ = [
    "escape_markup_text",
    "wrap_font",
    "lines_to_markup",
    "text_to_markup",
    "marked_text_to_markup",
    "page_to_markup",
    "unescape_markup",
    "strip_markup",
    "parse_runs",
    "parse_markup",
]

_MARKUP_TAG = re.compile(r"</?(?:b|i|h1|h2)>")
_TAG_TOKEN = re.compile(r"<(/?)(b|i|h1|h2)>")
_HEADING = re.compile(r"^<h([12])>([\s\S]*)</h\1>$")
_BOLD_FACE = re.compile(r"bold|black|heavy|semibold|demibold")
_ITALIC_FACE = re.compile(r"italic|oblique")
_MARK_TAGS = frozenset(("<b>", "</b>", "<i>", "</i>"))
_MARK_SPLIT = re.compile(r"(</?[bi]>)")


def escape_markup_text(text) -> str:
    return (str(text if text is not None else "")
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;"))


def wrap_font(text: str, font_name) -> str:
    name = str(font_name if font_name else "").lower()
    out = text
    if _ITALIC_FACE.search(name):
        out = f"<i>{out}</i>"
    if _BOLD_FACE.search(name):
        out = f"<b>{out}</b>"
    return out


def _row(line):
    """Accept the JS tuple, a Python list/tuple, or a dict of named fields."""
    if isinstance(line, dict):
        return (line.get("x"), line.get("y"), line.get("size"),
                line.get("text"), line.get("font"))
    if isinstance(line, (list, tuple)):
        values = list(line) + [None] * 5
        return tuple(values[:5])
    return None


def lines_to_markup(lines) -> str:
    """Geometry + font evidence -> one marked-up string.

    ``lines`` are ``[x, y, size, text, font?]`` in reading order. ``y`` grows
    upward in PDF space: a baseline drop much larger than the line height is
    a paragraph break, not a line break.
    """
    rows = [row for row in (_row(line) for line in (lines if isinstance(lines, (list, tuple)) else []))
            if row is not None and str(row[3] if row[3] is not None else "").strip() != ""]
    if not rows:
        return ""
    sizes = sorted(float(row[2] or 0) for row in rows if float(row[2] or 0) > 0)
    median = sizes[len(sizes) // 2] if sizes else 0
    out = []
    prev_y = None
    prev_size = 0.0
    for y, size, text, font in ((row[1], row[2], row[3], row[4]) for row in rows):
        line_size = float(size or median or 11)
        if prev_y is not None:
            base_y = float(y) if y is not None else prev_y
            gap = prev_y - base_y
            out.append("\n\n" if gap > max(prev_size, line_size) * 2.2 else "\n")
        marked = escape_markup_text(str(text).strip())
        if median > 0 and line_size >= median * 1.6:
            marked = f"<h1>{marked}</h1>"
        elif median > 0 and line_size >= median * 1.3:
            marked = f"<h2>{marked}</h2>"
        else:
            marked = wrap_font(marked, font)
        out.append(marked)
        prev_y = float(y) if y is not None else prev_y
        prev_size = line_size
    return "".join(out)


def text_to_markup(text) -> str:
    """Plain text (DOCX chunks, OCR): every source paragraph is a paragraph."""
    paragraphs = []
    for para in re.split(r"\n{2,}", str(text if text is not None else "")):
        joined = "\n".join(line.strip() for line in escape_markup_text(para).split("\n"))
        if joined != "":
            paragraphs.append(joined)
    return "\n\n".join(paragraphs)


def marked_text_to_markup(text) -> str:
    """Plain text already carrying DOCX inline marks: escape, keep <b>/<i>."""

    def escape_parts(line: str) -> str:
        return "".join(part if part in _MARK_TAGS else escape_markup_text(part)
                       for part in _MARK_SPLIT.split(line))

    paragraphs = []
    for para in re.split(r"\n{2,}", str(text if text is not None else "")):
        joined = "\n".join(escape_parts(line.strip()) for line in para.split("\n"))
        if joined != "":
            paragraphs.append(joined)
    return "\n\n".join(paragraphs)


def page_to_markup(page) -> str:
    """A finished page -- string, or dict with ``lines``/``text`` -- as markup."""
    if isinstance(page, str):
        return text_to_markup(page)
    if isinstance(page, dict):
        lines = page.get("lines")
        if isinstance(lines, (list, tuple)) and lines:
            marked = lines_to_markup(lines)
            if marked:
                return marked
        return text_to_markup(page.get("text") or "")
    return text_to_markup(page)


# ── the reading half (@output/helper/markup.js) ────────────────────────────

def unescape_markup(text) -> str:
    return (str(text if text is not None else "")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&amp;", "&"))


def strip_markup(text) -> str:
    return unescape_markup(_MARKUP_TAG.sub("", str(text if text is not None else "")))


def parse_runs(text) -> list:
    """One line -> ``[{text, bold, italic}, ...]`` (empty runs dropped)."""
    runs = []
    bold = False
    italic = False
    last = 0
    for match in _TAG_TOKEN.finditer(text):
        if match.start() > last:
            runs.append({"text": unescape_markup(text[last:match.start()]),
                         "bold": bold, "italic": italic})
        closing = match.group(1) == "/"
        if match.group(2) == "b":
            bold = not closing
        elif match.group(2) == "i":
            italic = not closing
        last = match.end()
    if last < len(text):
        runs.append({"text": unescape_markup(text[last:]),
                     "bold": bold, "italic": italic})
    return [run for run in runs if run["text"] != ""]


def parse_markup(text) -> list:
    """Marked-up page -> ``[{tag: "h1"|"h2"|"p", lines: [[run, ...], ...]}]``."""
    blocks = []
    for raw_block in re.split(r"\n{2,}", str(text if text is not None else "")):
        block = raw_block.strip()
        if not block:
            continue
        tag = "p"
        inner = block
        heading = _HEADING.match(block)
        if heading:
            tag = "h" + heading.group(1)
            inner = heading.group(2)
        blocks.append({
            "tag": tag,
            "lines": [parse_runs(line) for line in inner.split("\n")],
        })
    return blocks
