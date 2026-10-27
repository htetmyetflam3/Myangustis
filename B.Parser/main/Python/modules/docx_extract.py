"""DOCX text extraction — pure standard library (zipfile + ElementTree).

The browser cannot do this job: mammoth.js hands back the raw stored code
points, which for Burmese documents are Zawgyi/imposter-encoded exactly like
the PDF case. The extraction itself is trivial; the ENCODING work (detect ->
Rabbit convert -> cleanup) happens downstream in the same pipeline the PDFs
go through, which is the whole reason .docx uploads are parsed server-side.

Text is harvested from every part that can carry body text, in reading
order: section headers, then ``word/document.xml`` (body paragraphs in
document order, including paragraphs inside tables), then footnotes and
endnotes, then section footers. Anything with real Burmese text is captured
so the downstream detect/convert step never silently drops it.
"""

import os
import re
import zipfile
import xml.etree.ElementTree as ET

# Same bomb guard as the PDF side: a docx is a zip container, and one
# member ("42.zip" style) must never be allowed to explode in memory.
MAX_MEMBER_MB = int(os.environ.get("PRASER_MAX_MEMBER_MB", "256"))
MAX_MEMBER_RATIO = 200  # real document.xml compresses ~10-30x; bombs do 1000x

# wordprocessingml namespace: every content tag in document.xml is namespaced.
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

DOCUMENT_XML = "word/document.xml"

# word/header1.xml, header2.xml, ... and the footer equivalents.
_HEADER_RE = re.compile(r"^word/header\d*\.xml$")
_FOOTER_RE = re.compile(r"^word/footer\d*\.xml$")


def _read_member(z, name):
    """Read one zip member, refusing decompression bombs (same caps as PDF)."""
    info = z.getinfo(name)
    ratio = info.file_size / max(info.compress_size, 1)
    if info.file_size > MAX_MEMBER_MB * 1024 * 1024:
        raise ValueError(
            f"docx member {name!r} exceeds the "
            f"{MAX_MEMBER_MB} MB cap (decompression bomb?)"
        )
    if ratio > MAX_MEMBER_RATIO:
        raise ValueError(
            f"docx member {name!r} compresses "
            f"{info.compress_size} -> {info.file_size} bytes "
            f"(ratio {ratio:.0f}x) — decompression bomb, refused"
        )
    return z.read(name)


def _paragraphs_from_xml(xml_bytes):
    """Paragraphs from one wordprocessingml part (document/header/footer/notes).

    Within a paragraph, ``<w:t>`` runs are concatenated in order; ``<w:br/>``
    becomes a newline and ``<w:tab/>`` a tab. Empty paragraphs are kept —
    they carry the document's spacing.
    """
    root = ET.fromstring(xml_bytes)
    paragraphs = []
    for p in root.iter(f"{W}p"):
        parts = []
        for node in p.iter():
            if node.tag == f"{W}t":
                parts.append(node.text or "")
            elif node.tag == f"{W}br":
                parts.append("\n")
            elif node.tag == f"{W}tab":
                parts.append("\t")
        paragraphs.append("".join(parts))
    return paragraphs


def _ordered_parts(names):
    """Text-bearing members in reading order: headers, body, notes, footers."""
    ordered = []
    ordered += sorted(n for n in names if _HEADER_RE.match(n))
    if DOCUMENT_XML in names:
        ordered.append(DOCUMENT_XML)
    for n in ("word/footnotes.xml", "word/endnotes.xml"):
        if n in names:
            ordered.append(n)
    ordered += sorted(n for n in names if _FOOTER_RE.match(n))
    return ordered


def extract_docx_paragraphs(docx_path):
    """Return the document's paragraphs (all text parts) as plain strings.

    Harvests headers, the body, footnotes/endnotes and footers — not just
    ``word/document.xml`` — so Burmese text stored outside the body is
    detected and converted downstream instead of being dropped.
    """
    paragraphs = []
    with zipfile.ZipFile(docx_path) as z:
        names = set(z.namelist())
        for name in _ordered_parts(names):
            try:
                xml_bytes = _read_member(z, name)
            except KeyError:
                continue
            paragraphs.extend(_paragraphs_from_xml(xml_bytes))
    return paragraphs
