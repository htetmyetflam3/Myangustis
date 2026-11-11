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
import posixpath
import re
import uuid
import zipfile
import xml.etree.ElementTree as ET

# Same bomb guard as the PDF side: a docx is a zip container, and one
# member ("42.zip" style) must never be allowed to explode in memory.
# The zip package judgement, shared with @entry/helper/validator.js via the
# same env-tunable caps in limit.js: member size, member count and total
# uncompressed size, plus the compression ratio.
import limits

MAX_MEMBER_MB = limits.MAX_DOCX_MEMBER_MB
MAX_MEMBER_RATIO = limits.MAX_DOCX_RATIO
MAX_ENTRIES = limits.MAX_DOCX_ENTRIES
MAX_TOTAL_MB = limits.MAX_DOCX_TOTAL_MB

# wordprocessingml namespace: every content tag in document.xml is namespaced.
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
# DrawingML picture (<a:blip r:embed>), legacy VML (<v:imagedata r:id>) and the
# package relationship namespace. An image run becomes a private marker that
# the OCR lane replaces with recognised text (or with nothing).
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
V = "{urn:schemas-microsoft-com:vml}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
MARKER_OPEN = "\uE000OCR-"
MARKER_CLOSE = "\uE001"
_MARKER_RE = re.compile(MARKER_OPEN + r"[0-9a-f-]{36}-\d+" + MARKER_CLOSE)

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


def _paragraphs_from_xml(xml_bytes, resolve_image=None):
    """Paragraphs from one wordprocessingml part (document/header/footer/notes).

    Within a paragraph, ``<w:t>`` runs are concatenated in order; ``<w:br/>``
    becomes a newline and ``<w:tab/>`` a tab. Empty paragraphs are kept —
    they carry the document's spacing.

    ``resolve_image(rel_id)`` returns an OCR placeholder for a picture run.
    The placeholder is a private-use marker, so it survives detection and
    cleanup untouched and is replaced once OCR has the text.
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
            elif resolve_image is not None and node.tag in (f"{A}blip", f"{V}imagedata"):
                rel = node.get(f"{R}embed") or node.get(f"{R}id")
                if rel:
                    marker = resolve_image(rel)
                    if marker:
                        parts.append(marker)
        paragraphs.append("".join(parts))
    return paragraphs


def _rels_name(part):
    """``word/document.xml`` -> ``word/_rels/document.xml.rels``."""
    directory, name = posixpath.split(part)
    return posixpath.join(directory, "_rels", name + ".rels")


def _image_relationships(z, part):
    """``{rId: zip member}`` for the part's internal image relationships."""
    rels = _rels_name(part)
    try:
        xml_bytes = _read_member(z, rels)
    except KeyError:
        return {}
    out = {}
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return {}
    for node in root.iter():
        if not node.tag.endswith("Relationship"):
            continue
        target = node.get("Target") or ""
        rel_id = node.get("Id")
        kind = node.get("Type") or ""
        if not rel_id or not target or not kind.endswith("/image"):
            continue
        if (node.get("TargetMode") or "").lower() == "external":
            continue
        if "://" in target or "\\" in target or "\0" in target:
            continue
        target = target.split("#", 1)[0]
        member = (posixpath.normpath(target).lstrip("/") if target.startswith("/")
                  else posixpath.normpath(posixpath.join(posixpath.dirname(part), target)))
        if member.startswith("../") or member not in z.namelist():
            continue
        out[rel_id] = member
    return out


def strip_image_markers(text):
    """Drop OCR placeholders (used when OCR is off or fails)."""
    return _MARKER_RE.sub("", text or "")


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


def extract_docx_paragraphs(docx_path, *, image_dir=None, image_files=None):
    """Return the document's paragraphs (all text parts) as plain strings.

    Harvests headers, the body, footnotes/endnotes and footers — not just
    ``word/document.xml`` — so Burmese text stored outside the body is
    detected and converted downstream instead of being dropped.

    With ``image_dir`` set, embedded pictures are written there and replaced by
    private OCR markers; ``image_files`` receives
    ``{"id", "path", "marker"}`` entries so the OCR lane can recognise each
    one and swap its text back in. Without ``image_dir`` the document is read
    exactly as before (pictures are simply not represented).
    """
    if image_dir is not None and image_files is None:
        raise TypeError("image_files must be provided with image_dir")
    paragraphs = []
    written = {}
    with zipfile.ZipFile(docx_path) as z:
        infos = z.infolist()
        if len(infos) > MAX_ENTRIES:
            raise ValueError(
                f"docx has {len(infos)} entries; the cap is {MAX_ENTRIES}")
        total = sum(info.file_size for info in infos)
        if total > MAX_TOTAL_MB * 1024 * 1024:
            raise ValueError(
                f"docx expands to {total} bytes; the cap is "
                f"{MAX_TOTAL_MB} MB")
        members = set(z.namelist())
        prefix = f"{MARKER_OPEN}{uuid.uuid4()}-" if image_dir is not None else ""

        def resolve_image(rel_id, rels):
            member = rels.get(rel_id)
            if not member:
                return ""
            if member in written:
                return written[member]
            image_id = str(len(image_files) + 1).zfill(4)
            name = re.sub(r"[^A-Za-z0-9._-]", "_", posixpath.basename(member))
            os.makedirs(image_dir, exist_ok=True)
            target = os.path.join(image_dir, f"{image_id}-{name}")
            with open(target, "xb") as handle:
                handle.write(_read_member(z, member))
            marker = f"{prefix}{image_id}{MARKER_CLOSE}"
            image_files.append({"id": image_id, "member": member,
                                "path": target, "marker": marker})
            written[member] = marker
            return marker

        for name in _ordered_parts(members):
            try:
                xml_bytes = _read_member(z, name)
            except KeyError:
                continue
            if image_dir is None:
                paragraphs.extend(_paragraphs_from_xml(xml_bytes))
            else:
                rels = _image_relationships(z, name)
                resolver = (lambda rel_id, relationships=rels: resolve_image(rel_id, relationships))
                paragraphs.extend(_paragraphs_from_xml(xml_bytes, resolver))
    return paragraphs
