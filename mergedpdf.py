#!/usr/bin/env python3
"""Merge PDF / TXT / DOCX files into one debug document. Standard library only.

Usage
-----
  uv run mergedpdf.py -- pdf --30 ./selected-pdf/
  uv run mergedpdf.py -- pdf ./selected-pdf/            # whole files
  uv run mergedpdf.py -- txt ./notes/
  uv run mergedpdf.py -- docx ./docs/
  uv run mergedpdf.py -- pdf --30 ./selected-pdf/ --output /tmp/all.pdf

Arguments
---------
  1. merge type: pdf | txt | docx
  2. optional page count: --30 (also -30, 30, --pages 30).  With it, only the
     first 30 pages of every PDF are merged.  Without it the full PDF is
     merged.  TXT and DOCX have no page geometry of their own (a DOCX is
     paginated by its renderer), so they are always merged in full.
  3. one or more locations: directories, files or globs.  Directories are
     scanned for the matching extension (non-recursive unless --recursive).

``--`` may appear anywhere (as in the examples) and is ignored; the page
count may be written --30, -30 or 30.  The default output is ``merged.pdf`` /
``merged.txt`` / ``merged.docx`` inside the first location, or use
``--output PATH``.  A file literally named ``merged.<ext>`` inside a scanned
directory is treated as an earlier output and skipped.  Other options:
``--recursive``, ``--no-separator`` (no label pages, no bookmarks),
``--quiet`` and ``--help``.

What a PDF merge looks like
---------------------------
    [ label page: 1681774700481.pdf ] [ page 1..30 of that PDF ]
    [ label page: 1704101675047.pdf ] [ page 1..30 of that PDF ]

Each label page is a real A-size PDF page (same MediaBox as the file it
precedes) that contains nothing but the file name.  Names are drawn with
Helvetica, so a non-Latin name shows "?" where the base-14 font has no glyph;
the bookmark still stores the exact name as UTF-16.  Every source page is
copied object-by-object: content streams, font programs, images and colour
spaces are written byte-for-byte as they were in the original, never
re-rendered or re-encoded, so fonts and glyph coverage stay identical.  The
page dictionary keeps MediaBox, CropBox, BleedBox, TrimBox, ArtBox, Rotate,
Resources, Annots, Group and UserUnit.

Document metadata survives too: the first PDF's /Info dictionary (Title,
Author, Subject, Keywords, Creator, Producer, dates, custom keys) and its XMP
/Metadata stream are carried over unchanged, and every source file becomes a
bookmark with its exact (UTF-16) file name.

Limitations: encrypted PDFs are refused (decryption needs a crypto library),
named destinations and the source outline trees are not carried over (link
annotations keep working only when they point inside the merged pages), and
PDF/A or tagged-PDF structure trees are dropped.  Everything a font-debugging
pass needs - text, fonts, encodings, glyphs, positions - is preserved.

TXT merging concatenates the files with a `===== file name =====` heading.
DOCX merging appends the body of every document under a page break and a
heading with the file name; images, hyperlinks, styles and numbering that a
document references are copied into the merged package, and a conflicting
style definition is renamed instead of overwriting the first one.
"""

from __future__ import annotations

import base64
import collections
import hashlib
import mmap
import os
import re
import sys
import time
import zipfile
import zlib
from pathlib import Path

WHITESPACE = b"\x00\t\n\x0c\r "
PDF_TYPES = ("pdf", "txt", "docx")


class PdfError(Exception):
    """A PDF could not be read or written."""


def starts_with(data, prefix: bytes, position: int = 0) -> bool:
    """``bytes.startswith`` for buffers such as ``mmap``."""
    return data[position:position + len(prefix)] == prefix


class Name(str):
    """A PDF name object (stored without the leading slash)."""

    __slots__ = ()

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return "/" + str(self)


class Ref:
    """An indirect reference: ``num gen R``."""

    __slots__ = ("num", "gen")

    def __init__(self, num: int, gen: int = 0) -> None:
        self.num = num
        self.gen = gen

    def __eq__(self, other: object) -> bool:
        return isinstance(other, Ref) and other.num == self.num and other.gen == self.gen

    def __hash__(self) -> int:
        return hash((self.num, self.gen))

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"{self.num} {self.gen} R"


class Stream:
    """A stream object: its dictionary and its still-encoded raw bytes."""

    __slots__ = ("dict", "raw")

    def __init__(self, dictionary: dict, raw: bytes) -> None:
        self.dict = dictionary
        self.raw = raw


# ---------------------------------------------------------------------------
# Object parser
# ---------------------------------------------------------------------------

_NUMBER_RE = re.compile(rb"[+-]?(?:\d+\.?\d*|\.\d+)")
_REF_RE = re.compile(rb"[\x00\t\n\x0c\r ]+(\d+)[\x00\t\n\x0c\r ]+R(?![A-Za-z0-9])")
_OBJ_HEADER_RE = re.compile(rb"(\d+)[\x00\t\n\x0c\r ]+(\d+)[\x00\t\n\x0c\r ]+obj")


class Parser:
    """Parses PDF objects out of a bytes-like buffer."""

    def __init__(self, data, pos: int = 0) -> None:
        self.data = data
        self.pos = pos

    # -- low level ---------------------------------------------------------
    def skip_space(self) -> None:
        data = self.data
        size = len(data)
        pos = self.pos
        while pos < size:
            char = data[pos]
            if char in WHITESPACE:
                pos += 1
            elif char == 0x25:  # '%' comment
                newline = data.find(b"\n", pos)
                pos = size if newline < 0 else newline + 1
            else:
                break
        self.pos = pos

    def token(self) -> bytes:
        """Return one bare token (a keyword, a number, an operator)."""
        self.skip_space()
        data = self.data
        size = len(data)
        start = pos = self.pos
        while pos < size and data[pos] not in WHITESPACE and data[pos] not in b"()<>[]{}/%":
            pos += 1
        if pos == start:
            raise PdfError(f"unexpected byte {data[start:start + 8]!r} at offset {start}")
        self.pos = pos
        return bytes(data[start:pos])

    def match(self, pattern: re.Pattern) -> re.Match | None:
        self.skip_space()
        return pattern.match(self.data, self.pos)

    # -- object values -----------------------------------------------------
    def value(self):
        self.skip_space()
        data = self.data
        if self.pos >= len(data):
            raise PdfError("unexpected end of file")
        char = data[self.pos]
        if char == 0x2F:  # '/'
            return self.name()
        if char == 0x28:  # '('
            return self.literal_string()
        if char == 0x3C:  # '<'
            if data[self.pos:self.pos + 2] == b"<<":
                return self.dictionary()
            return self.hex_string()
        if char == 0x5B:  # '['
            return self.array()
        if char in b"+-.0123456789":
            return self.number()
        keyword = self.token()
        if keyword == b"true":
            return True
        if keyword == b"false":
            return False
        if keyword == b"null":
            return None
        raise PdfError(f"unexpected keyword {keyword!r} at offset {self.pos}")

    def name(self) -> Name:
        self.pos += 1  # skip '/'
        data = self.data
        size = len(data)
        start = pos = self.pos
        while pos < size and data[pos] not in WHITESPACE and data[pos] not in b"()<>[]{}/%":
            pos += 1
        raw = bytes(data[start:pos])
        self.pos = pos
        if b"#" in raw:
            out = bytearray()
            index = 0
            while index < len(raw):
                if raw[index] == 0x23 and index + 2 < len(raw) + 0 and re.fullmatch(
                        rb"[0-9A-Fa-f]{2}", raw[index + 1:index + 3]):
                    out.append(int(raw[index + 1:index + 3], 16))
                    index += 3
                else:
                    out.append(raw[index])
                    index += 1
            raw = bytes(out)
        return Name(raw.decode("latin-1"))

    def number(self):
        match = _NUMBER_RE.match(self.data, self.pos)
        if not match:
            raise PdfError(f"bad number at offset {self.pos}")
        raw = match.group(0)
        self.pos = match.end()
        if b"." in raw:
            try:
                return float(raw)
            except ValueError:  # e.g. "--5"
                return 0.0
        try:
            number = int(raw)
        except ValueError:
            return 0
        if number >= 0:
            # An integer can be the start of an indirect reference.
            reference = _REF_RE.match(self.data, self.pos)
            if reference:
                self.pos = reference.end()
                return Ref(number, int(reference.group(1)))
        return number

    def literal_string(self) -> bytes:
        data = self.data
        size = len(data)
        pos = self.pos + 1
        depth = 1
        out = bytearray()
        while pos < size:
            char = data[pos]
            if char == 0x5C:  # backslash
                pos += 1
                if pos >= size:
                    break
                escape = data[pos]
                if escape in b"nrtbf":
                    out.append({0x6E: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12}[escape])
                    pos += 1
                elif 0x30 <= escape <= 0x37:
                    digits = bytes(data[pos:pos + 3])
                    octal = bytearray()
                    for byte in digits:
                        if 0x30 <= byte <= 0x37 and len(octal) < 3:
                            octal.append(byte)
                        else:
                            break
                    out.append(int(octal, 8) & 0xFF)
                    pos += len(octal)
                elif escape == 0x0D:  # escaped CR or CRLF = line continuation
                    pos += 1
                    if pos < size and data[pos] == 0x0A:
                        pos += 1
                elif escape == 0x0A:
                    pos += 1
                else:
                    out.append(escape)
                    pos += 1
            elif char == 0x28:  # '('
                depth += 1
                out.append(char)
                pos += 1
            elif char == 0x29:  # ')'
                depth -= 1
                pos += 1
                if depth == 0:
                    self.pos = pos
                    return bytes(out)
                out.append(char)
            else:
                out.append(char)
                pos += 1
        raise PdfError("unterminated literal string")

    def hex_string(self) -> bytes:
        data = self.data
        end = data.find(b">", self.pos + 1)
        if end < 0:
            raise PdfError("unterminated hex string")
        digits = re.sub(rb"[^0-9A-Fa-f]", b"", bytes(data[self.pos + 1:end]))
        if len(digits) % 2:
            digits += b"0"
        self.pos = end + 1
        return bytes.fromhex(digits.decode("ascii"))

    def array(self) -> list:
        self.pos += 1  # skip '['
        items = []
        while True:
            self.skip_space()
            if self.pos >= len(self.data):
                raise PdfError("unterminated array")
            if self.data[self.pos] == 0x5D:  # ']'
                self.pos += 1
                return items
            items.append(self.value())

    def dictionary(self) -> dict:
        self.pos += 2  # skip '<<'
        result: dict = {}
        while True:
            self.skip_space()
            if self.pos >= len(self.data):
                raise PdfError("unterminated dictionary")
            if self.data[self.pos:self.pos + 2] == b">>":
                self.pos += 2
                return result
            if self.data[self.pos] != 0x2F:
                # Tolerate junk: skip the offending byte rather than fail.
                self.pos += 1
                continue
            key = self.name()
            result[str(key)] = self.value()

    # -- streams -----------------------------------------------------------
    def indirect_object(self, resolve_length=None):
        """Parse ``num gen obj ... endobj`` at the current position."""
        header = self.match(_OBJ_HEADER_RE)
        if not header:
            raise PdfError(f"no object header at offset {self.pos}")
        number = int(header.group(1))
        self.pos = header.end()
        value = self.value()
        self.skip_space()
        if isinstance(value, dict) and starts_with(self.data, b"stream", self.pos):
            self.pos += 6
            if self.data[self.pos:self.pos + 2] == b"\r\n":
                self.pos += 2
            elif self.data[self.pos:self.pos + 1] in (b"\n", b"\r"):
                self.pos += 1
            value = Stream(value, self._stream_bytes(value, resolve_length))
        return number, value

    def _stream_bytes(self, dictionary: dict, resolve_length) -> bytes:
        data = self.data
        start = self.pos
        length = dictionary.get("Length")
        if isinstance(length, Ref) and resolve_length is not None:
            length = resolve_length(length)
        if isinstance(length, float):
            length = int(length)
        if isinstance(length, int) and 0 <= length <= len(data) - start:
            end = start + length
            if b"endstream" in data[end:end + 40]:
                self.pos = end
                return bytes(data[start:end])
        end = data.find(b"endstream", start)
        if end < 0:
            raise PdfError("unterminated stream")
        raw = bytes(data[start:end])
        self.pos = end
        while raw.endswith(b"\n") or raw.endswith(b"\r"):
            raw = raw[:-1]
        return raw


# ---------------------------------------------------------------------------
# Stream filters (only what xref streams and object streams need)
# ---------------------------------------------------------------------------

def _flate(data: bytes) -> bytes:
    try:
        return zlib.decompress(data)
    except zlib.error:
        # Truncated or trailing garbage: keep whatever inflates.
        for wbits in (zlib.MAX_WBITS, -zlib.MAX_WBITS):
            try:
                return zlib.decompressobj(wbits).decompress(data)
            except zlib.error:
                continue
        raise PdfError("corrupt FlateDecode stream") from None


def _png_unpredict(data: bytes, columns: int, colors: int, bits: int) -> bytes:
    bpp = max(1, (colors * bits + 7) // 8)
    row_length = (columns * colors * bits + 7) // 8
    out = bytearray()
    previous = bytearray(row_length)
    pos = 0
    while pos + 1 + row_length <= len(data):
        kind = data[pos]
        row = bytearray(data[pos + 1:pos + 1 + row_length])
        pos += 1 + row_length
        if kind == 1:
            for i in range(bpp, row_length):
                row[i] = (row[i] + row[i - bpp]) & 0xFF
        elif kind == 2:
            for i in range(row_length):
                row[i] = (row[i] + previous[i]) & 0xFF
        elif kind == 3:
            for i in range(row_length):
                left = row[i - bpp] if i >= bpp else 0
                row[i] = (row[i] + ((left + previous[i]) >> 1)) & 0xFF
        elif kind == 4:
            for i in range(row_length):
                left = row[i - bpp] if i >= bpp else 0
                up = previous[i]
                upper_left = previous[i - bpp] if i >= bpp else 0
                estimate = left + up - upper_left
                pa, pb, pc = abs(estimate - left), abs(estimate - up), abs(estimate - upper_left)
                predictor = left if pa <= pb and pa <= pc else (up if pb <= pc else upper_left)
                row[i] = (row[i] + predictor) & 0xFF
        out += row
        previous = row
    return bytes(out)


def _tiff_unpredict(data: bytes, columns: int, colors: int, bits: int) -> bytes:
    if bits != 8:
        raise PdfError("unsupported TIFF predictor bit depth")
    row_length = columns * colors
    out = bytearray(data)
    for start in range(0, len(out) - row_length + 1, row_length):
        for i in range(colors, row_length):
            out[start + i] = (out[start + i] + out[start + i - colors]) & 0xFF
    return bytes(out)


def decode_stream(stream: Stream) -> bytes:
    """Decode a stream that the merger itself must inspect (xref / ObjStm)."""
    dictionary = stream.dict
    filters = dictionary.get("Filter")
    parms = dictionary.get("DecodeParms", dictionary.get("DP"))
    if filters is None:
        return stream.raw
    if not isinstance(filters, list):
        filters = [filters]
        parms = [parms]
    elif not isinstance(parms, list):
        parms = [parms] * len(filters)
    data = stream.raw
    for index, name in enumerate(filters):
        parameter = parms[index] if index < len(parms) else None
        parameter = parameter if isinstance(parameter, dict) else {}
        if name in ("FlateDecode", "Fl"):
            data = _flate(data)
            predictor = parameter.get("Predictor", 1)
            if isinstance(predictor, (int, float)) and predictor >= 10:
                data = _png_unpredict(
                    data,
                    int(parameter.get("Columns", 1)),
                    int(parameter.get("Colors", 1)),
                    int(parameter.get("BitsPerComponent", 8)),
                )
            elif predictor == 2:
                data = _tiff_unpredict(
                    data,
                    int(parameter.get("Columns", 1)),
                    int(parameter.get("Colors", 1)),
                    int(parameter.get("BitsPerComponent", 8)),
                )
        elif name in ("ASCIIHexDecode", "AHx"):
            digits = re.sub(rb"[^0-9A-Fa-f]", b"", data.split(b">")[0])
            if len(digits) % 2:
                digits += b"0"
            data = bytes.fromhex(digits.decode("ascii"))
        elif name in ("ASCII85Decode", "A85"):
            text = bytes(data.split(b"~>")[0])
            data = base64.a85decode(text, adobe=False, ignorechars=b" \t\n\r\x0b\x0c")
        elif name in ("RunLengthDecode", "RL"):
            out = bytearray()
            pos = 0
            while pos < len(data):
                length = data[pos]
                pos += 1
                if length == 128:
                    break
                if length < 128:
                    out += data[pos:pos + length + 1]
                    pos += length + 1
                else:
                    out += data[pos:pos + 1] * (257 - length)
                    pos += 1
            data = bytes(out)
        else:
            raise PdfError(f"cannot decode {name} stream without an external library")
    return data


# ---------------------------------------------------------------------------
# Document
# ---------------------------------------------------------------------------

_STARTXREF_RE = re.compile(rb"startxref[\x00\t\n\x0c\r ]+(\d+)")
_OBJ_SCAN_RE = re.compile(
    rb"(?<![0-9])(\d{1,10})[\x00\t\n\x0c\r ]+(\d{1,5})[\x00\t\n\x0c\r ]+obj\b")


class Document:
    """A read-only PDF file with lazy object access."""

    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self.handle = self.path.open("rb")
        try:
            self.data = mmap.mmap(self.handle.fileno(), 0, access=mmap.ACCESS_READ)
        except ValueError:
            self.handle.close()
            raise PdfError(f"{self.path.name}: empty file") from None
        if not starts_with(self.data, b"%PDF"):
            self.close()
            raise PdfError(f"{self.path.name}: not a PDF file (no %PDF header)")
        self.xref: dict[int, tuple] = {}
        self.trailer: dict = {}
        self.cache: dict[int, object] = {}
        self._objstm_cache: collections.OrderedDict[int, tuple] = collections.OrderedDict()
        self._page_list: list[tuple[int | None, dict, dict]] | None = None
        self._load_xref()

    # -- lifecycle ---------------------------------------------------------
    def close(self) -> None:
        self.cache.clear()
        self._objstm_cache.clear()
        self._page_list = None
        try:
            self.data.close()
        except (BufferError, ValueError):  # pragma: no cover
            pass
        self.handle.close()

    def __enter__(self) -> "Document":
        return self

    def __exit__(self, *exc_info) -> None:
        self.close()

    # -- cross reference ---------------------------------------------------
    def _load_xref(self) -> None:
        tail = self.data[max(0, len(self.data) - 4096):]
        match = None
        for match in _STARTXREF_RE.finditer(tail):
            pass
        failed = False
        if match:
            position = int(match.group(1))
            seen = set()
            while position is not None and position not in seen and not failed:
                seen.add(position)
                try:
                    entries, trailer = self._read_xref_section(position)
                except PdfError:
                    failed = True
                    break
                for number, entry in entries.items():
                    self.xref.setdefault(number, entry)
                for key, value in trailer.items():
                    self.trailer.setdefault(key, value)
                hybrid = trailer.get("XRefStm")
                if isinstance(hybrid, int):
                    try:
                        stream_entries, _ = self._read_xref_stream(hybrid)
                    except PdfError:
                        stream_entries = {}
                    for number, entry in stream_entries.items():
                        self.xref.setdefault(number, entry)
                previous = trailer.get("Prev")
                position = int(previous) if isinstance(previous, (int, float)) else None
        if failed or not self.xref or "Root" not in self.trailer or self._root() is None:
            self._recover()
        if "Encrypt" in self.trailer:
            raise PdfError(
                f"{self.path.name}: encrypted PDFs are not supported by the "
                "dependency-free merger")

    def _read_xref_section(self, position: int) -> tuple[dict, dict]:
        parser = Parser(self.data, position)
        parser.skip_space()
        if starts_with(self.data, b"xref", parser.pos):
            return self._read_xref_table(parser.pos + 4)
        entries, value = self._read_xref_stream(parser.pos)
        if not isinstance(value, dict):
            raise PdfError("xref stream has no dictionary")
        return entries, value

    def _read_xref_table(self, position: int) -> tuple[dict, dict]:
        parser = Parser(self.data, position)
        entries: dict[int, tuple] = {}
        while True:
            parser.skip_space()
            if starts_with(self.data, b"trailer", parser.pos):
                parser.pos += 7
                trailer = parser.value()
                if not isinstance(trailer, dict):
                    raise PdfError("bad trailer")
                return entries, trailer
            header = re.compile(rb"(\d+)[\x00\t\n\x0c\r ]+(\d+)").match(self.data, parser.pos)
            if not header:
                raise PdfError(f"bad xref table at offset {parser.pos}")
            start, count = int(header.group(1)), int(header.group(2))
            parser.pos = header.end()
            for index in range(count):
                parser.skip_space()
                entry = re.compile(
                    rb"(\d{1,10})[ ]+(\d{1,5})[ ]*([nf])").match(self.data, parser.pos)
                if not entry:
                    raise PdfError(f"bad xref entry at offset {parser.pos}")
                parser.pos = entry.end()
                if entry.group(3) == b"n":
                    entries.setdefault(start + index, ("n", int(entry.group(1))))
                else:
                    entries.setdefault(start + index, ("f", 0))

    def _read_xref_stream(self, position: int) -> tuple[dict, dict]:
        parser = Parser(self.data, position)
        _, value = parser.indirect_object(lambda ref: self.get(ref.num))
        if not isinstance(value, Stream):
            raise PdfError("expected an xref stream")
        dictionary = value.dict
        widths = [int(item) for item in dictionary.get("W", [])]
        if len(widths) != 3:
            raise PdfError("xref stream has a bad /W array")
        index = dictionary.get("Index")
        if not isinstance(index, list) or len(index) % 2:
            index = [0, int(dictionary.get("Size", 0))]
        payload = decode_stream(self._resolved_stream(value))
        entries: dict[int, tuple] = {}
        row_length = sum(widths)
        cursor = 0
        for pair in range(0, len(index), 2):
            start, count = int(index[pair]), int(index[pair + 1])
            for offset in range(count):
                if cursor + row_length > len(payload):
                    break
                fields = []
                for width in widths:
                    if width == 0:
                        fields.append(None)
                    else:
                        fields.append(int.from_bytes(payload[cursor:cursor + width], "big"))
                        cursor += width
                kind = fields[0] if fields[0] is not None else 1
                if kind == 0:
                    entries.setdefault(start + offset, ("f", 0))
                elif kind == 1:
                    entries.setdefault(start + offset, ("n", fields[1] or 0))
                elif kind == 2:
                    entries.setdefault(start + offset, ("c", fields[1] or 0, fields[2] or 0))
        return entries, dictionary

    def _recover(self) -> None:
        """Rebuild the xref by scanning, for PDFs with a damaged xref."""
        entries: dict[int, tuple] = {}
        for match in _OBJ_SCAN_RE.finditer(self.data):
            entries[int(match.group(1))] = ("n", match.start())
        self.xref = entries
        self.cache.clear()
        trailer: dict = {}
        for match in re.finditer(rb"trailer", self.data):
            try:
                value = Parser(self.data, match.end()).value()
            except PdfError:
                continue
            if isinstance(value, dict):
                trailer.update(value)
        self.trailer.update(trailer)
        if "Encrypt" in self.trailer:
            raise PdfError(f"{self.path.name}: encrypted PDF")
        if self._root() is None:
            for number in sorted(entries):
                value = self.get(number)
                if isinstance(value, dict) and value.get("Type") == "Catalog":
                    self.trailer["Root"] = Ref(number)
                    break
        if self._root() is None:
            raise PdfError(f"{self.path.name}: no document catalog found")
        # Objects that only exist inside object streams need expanding.
        extra: dict[int, tuple] = {}
        for number in list(entries):
            value = self.get(number)
            if isinstance(value, Stream) and value.dict.get("Type") == "ObjStm":
                for inner in self._objstm_numbers(value):
                    extra.setdefault(inner, ("c", number, 0))
        for number, entry in extra.items():
            self.xref.setdefault(number, entry)

    # -- object access -----------------------------------------------------
    def _resolved_stream(self, stream: Stream) -> Stream:
        """A copy of a stream whose filter entries are direct objects."""
        entries = stream.dict
        changes = {}
        for key in ("Filter", "DecodeParms", "DP"):
            if key in entries:
                value = self.resolve(entries[key])
                if isinstance(value, list):
                    value = [self.resolve(item) for item in value]
                changes[key] = value
        if not changes:
            return stream
        merged = dict(entries)
        merged.update(changes)
        return Stream(merged, stream.raw)

    def _resolve_length(self, ref: Ref):
        value = self.get(ref.num)
        return value if isinstance(value, int) else None

    def get(self, number: int):
        if number in self.cache:
            return self.cache[number]
        entry = self.xref.get(number)
        value = None
        if entry is not None:
            if entry[0] == "n":
                try:
                    parser = Parser(self.data, entry[1])
                    found, value = parser.indirect_object(self._resolve_length)
                    if found != number:
                        value = None
                except PdfError:
                    value = None
            elif entry[0] == "c":
                try:
                    value = self._from_object_stream(entry[1], number)
                except PdfError:
                    value = None
        self.cache[number] = value
        return value

    def resolve(self, value):
        """Follow references until a direct object is reached."""
        depth = 0
        while isinstance(value, Ref) and depth < 32:
            value = self.get(value.num)
            depth += 1
        return value

    def _object_stream_data(self, stream_number: int):
        if stream_number in self._objstm_cache:
            self._objstm_cache.move_to_end(stream_number)
            return self._objstm_cache[stream_number]
        stream = self.get(stream_number)
        if not isinstance(stream, Stream):
            raise PdfError(f"object stream {stream_number} is missing")
        payload = decode_stream(self._resolved_stream(stream))
        first = int(self.resolve(stream.dict.get("First", 0)) or 0)
        count = int(self.resolve(stream.dict.get("N", 0)) or 0)
        parser = Parser(payload)
        offsets: dict[int, int] = {}
        for _ in range(count):
            try:
                number = parser.value()
                offset = parser.value()
            except PdfError:
                break
            if isinstance(number, int) and isinstance(offset, int):
                offsets[number] = offset
        entry = (payload, first, offsets)
        self._objstm_cache[stream_number] = entry
        while len(self._objstm_cache) > 4:
            self._objstm_cache.popitem(last=False)
        return entry

    def _objstm_numbers(self, stream: Stream) -> list[int]:
        try:
            payload = decode_stream(self._resolved_stream(stream))
            count = int(self.resolve(stream.dict.get("N", 0)) or 0)
        except PdfError:
            return []
        parser = Parser(payload)
        numbers = []
        for _ in range(count):
            try:
                number = parser.value()
                parser.value()
            except PdfError:
                break
            if isinstance(number, int):
                numbers.append(number)
        return numbers

    def _from_object_stream(self, stream_number: int, number: int):
        payload, first, offsets = self._object_stream_data(stream_number)
        offset = offsets.get(number)
        if offset is None:
            raise PdfError(f"object {number} is not in object stream {stream_number}")
        return Parser(payload, first + offset).value()

    # -- pages -------------------------------------------------------------
    def _root(self) -> dict | None:
        root = self.trailer.get("Root")
        value = self.resolve(root)
        return value if isinstance(value, dict) else None

    @property
    def root(self) -> dict:
        value = self._root()
        if value is None:
            raise PdfError(f"{self.path.name}: no /Root catalog")
        return value

    def info(self):
        value = self.resolve(self.trailer.get("Info"))
        return value if isinstance(value, dict) else None

    def pages(self) -> list[tuple[int | None, dict, dict]]:
        """Return (object number, page dict, inherited attributes) per page."""
        if self._page_list is not None:
            return self._page_list
        found: list[tuple[int | None, dict, dict]] = []
        visited: set[int] = set()

        def walk(reference, inherited: dict, depth: int) -> None:
            if depth > 64:
                raise PdfError(f"{self.path.name}: page tree is too deep")
            number = None
            if isinstance(reference, Ref):
                number = reference.num
                if number in visited:
                    return
                visited.add(number)
                node = self.get(number)
            else:
                node = reference
            if not isinstance(node, dict):
                return
            attributes = dict(inherited)
            for key in ("Resources", "MediaBox", "CropBox", "Rotate"):
                if key in node:
                    attributes[key] = node[key]
            kids = self.resolve(node.get("Kids"))
            if isinstance(kids, list) and node.get("Type") != "Page":
                for kid in kids:
                    walk(kid, attributes, depth + 1)
            else:
                found.append((number, node, attributes))

        walk(self.root.get("Pages"), {}, 0)
        if not found:
            raise PdfError(f"{self.path.name}: page tree has no pages")
        self._page_list = found
        return found


# ---------------------------------------------------------------------------
# Writer
# ---------------------------------------------------------------------------

def pdf_number(value: float | int) -> bytes:
    if isinstance(value, bool):
        return b"true" if value else b"false"
    if isinstance(value, int):
        return b"%d" % value
    if value != value or value in (float("inf"), float("-inf")):
        return b"0"
    text = f"{value:.6f}".rstrip("0").rstrip(".")
    return (text or "0").encode("ascii")


_NAME_SAFE = set(range(0x21, 0x7F)) - set(b"()<>[]{}/%#")


def encode_name(name: str) -> bytes:
    out = bytearray(b"/")
    for byte in name.encode("latin-1", "replace"):
        if byte in _NAME_SAFE:
            out.append(byte)
        else:
            out += b"#%02X" % byte
    return bytes(out)


class Writer:
    """Writes objects to a PDF file and keeps the xref book-keeping."""

    def __init__(self, handle) -> None:
        self.handle = handle
        self.offset = 0
        self.next_number = 1
        self.offsets: dict[int, int] = {}

    def raw(self, data: bytes) -> None:
        self.handle.write(data)
        self.offset += len(data)

    def alloc(self) -> int:
        number = self.next_number
        self.next_number += 1
        return number

    def store(self, number: int, payload: bytes) -> None:
        self.offsets[number] = self.offset
        self.raw(b"%d 0 obj\n" % number)
        self.raw(payload)
        self.raw(b"\nendobj\n")

    def store_stream(self, number: int, dictionary: dict, data: bytes,
                     encoder=None) -> None:
        entries = dict(dictionary)
        entries["Length"] = len(data)
        payload = bytearray((encoder or serialize_direct)(entries))
        payload += b"\nstream\n"
        payload += data
        payload += b"\nendstream"
        self.store(number, bytes(payload))

    def finish(self, root: int, info: int | None, document_id: bytes | None) -> None:
        size = self.next_number
        missing = [number for number in range(1, size) if number not in self.offsets]
        if missing:
            raise PdfError(f"internal error: objects not written: {missing[:5]}")
        xref_offset = self.offset
        lines = [b"xref", b"0 %d" % size, b"0000000000 65535 f "]
        for number in range(1, size):
            lines.append(b"%010d 00000 n " % self.offsets[number])
        self.raw(b"\n".join(lines) + b"\n")
        trailer = bytearray(b"trailer\n<< /Size %d /Root %d 0 R" % (size, root))
        if info is not None:
            trailer += b" /Info %d 0 R" % info
        if document_id:
            trailer += b" /ID [<%s> <%s>]" % (document_id.hex().encode(), document_id.hex().encode())
        trailer += b" >>\n"
        self.raw(bytes(trailer))
        self.raw(b"startxref\n%d\n%%%%EOF\n" % xref_offset)


def serialize_direct(value) -> bytes:
    """Serialize a value that contains no indirect references."""
    out = bytearray()
    _serialize(value, out)
    return bytes(out)


def _serialize(value, out: bytearray) -> None:
    if value is None:
        out += b"null"
    elif value is True:
        out += b"true"
    elif value is False:
        out += b"false"
    elif isinstance(value, Name):
        out += encode_name(str(value))
    elif isinstance(value, Ref):
        out += b"%d %d R" % (value.num, value.gen)
    elif isinstance(value, (int, float)):
        out += pdf_number(value)
    elif isinstance(value, bytes):
        out += b"<" + value.hex().encode("ascii") + b">"
    elif isinstance(value, str):
        out += encode_name(value)
    elif isinstance(value, list):
        out += b"["
        for index, item in enumerate(value):
            if index:
                out += b" "
            _serialize(item, out)
        out += b"]"
    elif isinstance(value, Stream):
        entries = {key: item for key, item in value.dict.items() if key != "Length"}
        entries["Length"] = len(value.raw)
        _serialize(entries, out)
        out += b"\nstream\n" + value.raw + b"\nendstream"
    elif isinstance(value, dict):
        out += b"<<"
        for key, item in value.items():
            out += b" "
            out += encode_name(str(key))
            out += b" "
            _serialize(item, out)
        out += b" >>"
    else:  # pragma: no cover - defensive
        raise PdfError(f"cannot serialize {type(value).__name__}")


# ---------------------------------------------------------------------------
# Merging
# ---------------------------------------------------------------------------

PAGE_KEYS = ("MediaBox", "CropBox", "BleedBox", "TrimBox", "ArtBox", "Rotate",
             "Resources", "Contents", "Annots", "Group", "UserUnit")

# Standard Helvetica advance widths (1/1000 em) for ASCII 32..126.
HELVETICA_WIDTHS = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
]


def text_width(text: str, size: float) -> float:
    total = 0
    for character in text:
        code = ord(character)
        total += HELVETICA_WIDTHS[code - 32] if 32 <= code <= 126 else 556
    return total * size / 1000.0


def ascii_label(name: str) -> str:
    """Keep the file name readable in a base-14 font."""
    return "".join(character if 32 <= ord(character) <= 126 else "?" for character in name)


def wrap_label(name: str, size: float, maximum_width: float) -> list[str]:
    words = name.split(" ")
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if text_width(candidate, size) <= maximum_width or not current:
            if text_width(word, size) > maximum_width and current is not None:
                # Hard-break a single very long token.
                if current:
                    lines.append(current)
                    current = ""
                piece = ""
                for character in word:
                    if text_width(piece + character, size) > maximum_width and piece:
                        lines.append(piece)
                        piece = ""
                    piece += character
                current = piece
                continue
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines or [""]


def escape_pdf_text(text: str) -> bytes:
    out = bytearray()
    for character in text:
        if character in "()\\":
            out += b"\\" + character.encode("ascii")
        else:
            out += character.encode("ascii")
    return bytes(out)


def page_box(attributes: dict, resolve) -> tuple[float, float, float, float]:
    box = resolve(attributes.get("MediaBox"))
    if isinstance(box, list) and len(box) == 4:
        try:
            values = [float(resolve(item) or 0) for item in box]
        except (TypeError, ValueError):
            values = []
        if len(values) == 4:
            x0, y0, x1, y1 = values
            if x0 != x1 and y0 != y1:
                return (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))
    return (0.0, 0.0, 595.0, 842.0)


def label_content(name: str, box: tuple[float, float, float, float]) -> bytes:
    x0, y0, x1, y1 = box
    width, height = x1 - x0, y1 - y0
    label = ascii_label(name)
    size = 24.0
    lines = wrap_label(label, size, width * 0.8)
    while size > 7 and (len(lines) * size * 1.4 > height * 0.7
                        or any(text_width(line, size) > width * 0.8 for line in lines)):
        size -= 1.0
        lines = wrap_label(label, size, width * 0.8)
    leading = size * 1.35
    top = y0 + (height + leading * len(lines)) / 2.0 - size
    content = bytearray(b"BT\n")
    content += b"/Label %s Tf\n" % pdf_number(size)
    for index, line in enumerate(lines):
        baseline = top - index * leading
        left = x0 + (width - text_width(line, size)) / 2.0
        content += b"1 0 0 1 %s %s Tm\n" % (pdf_number(left), pdf_number(baseline))
        content += b"(" + escape_pdf_text(line) + b") Tj\n"
    content += b"ET\n"
    return bytes(content)


class Copier:
    """Copies the object graph reachable from a source page into the output."""

    def __init__(self, writer: Writer, document: Document, pages_in_output: set[int]) -> None:
        self.writer = writer
        self.document = document
        self.map: dict[int, int] = {}
        self.pending: collections.deque[int] = collections.deque()
        self.pages_in_output = pages_in_output
        self.page_objects = {number for number, _, _ in document.pages() if number is not None}

    def remap(self, number: int):
        """Return the output object number for a source object, or None."""
        if number in self.map:
            return self.map[number]
        if number in self.page_objects and number not in self.pages_in_output:
            # A link to a page that is not part of this merge: drop it rather
            # than dragging in the entire page tree.
            return None
        new_number = self.writer.alloc()
        self.map[number] = new_number
        self.pending.append(number)
        return new_number

    def drain(self) -> None:
        while self.pending:
            number = self.pending.popleft()
            value = self.document.get(number)
            self.writer.store(self.map[number], self.serialize(value))

    def serialize(self, value) -> bytes:
        out = bytearray()
        self._write(value, out, depth=0)
        return bytes(out)

    def _write(self, value, out: bytearray, depth: int) -> None:
        if depth > 96:
            out += b"null"
            return
        if isinstance(value, Ref):
            new_number = self.remap(value.num)
            out += b"null" if new_number is None else b"%d 0 R" % new_number
        elif isinstance(value, Stream):
            entries = {key: item for key, item in value.dict.items() if key != "Length"}
            entries["Length"] = len(value.raw)
            self._write(entries, out, depth + 1)
            out += b"\nstream\n" + value.raw + b"\nendstream"
        elif isinstance(value, dict):
            out += b"<<"
            for key, item in value.items():
                out += b" " + encode_name(str(key)) + b" "
                self._write(item, out, depth + 1)
            out += b" >>"
        elif isinstance(value, list):
            out += b"["
            for index, item in enumerate(value):
                if index:
                    out += b" "
                self._write(item, out, depth + 1)
            out += b"]"
        else:
            _serialize(value, out)


def merge_pdfs(files: list[Path], output: Path, page_limit: int | None,
               separators: bool, quiet: bool = False) -> None:
    started = time.time()
    temporary = output.with_name(output.name + ".part")
    page_refs: list[int] = []
    outline_titles: list[tuple[bytes, int]] = []
    total_source_pages = 0

    with temporary.open("wb") as handle:
        writer = Writer(handle)
        writer.raw(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
        pages_number = writer.alloc()
        label_font = writer.alloc()
        writer.store(label_font, serialize_direct({
            "Type": Name("Font"), "Subtype": Name("Type1"),
            "BaseFont": Name("Helvetica"), "Encoding": Name("WinAnsiEncoding"),
        }))
        info_number: int | None = None
        metadata_number: int | None = None
        identifier: bytes | None = None

        for position, path in enumerate(files, 1):
            document = Document(path)
            try:
                pages = document.pages()
                chosen = pages[:page_limit] if page_limit else pages
                total_source_pages += len(chosen)
                if not quiet:
                    limit_note = "" if not page_limit or page_limit >= len(pages) else f" (of {len(pages)})"
                    print(f"[{position}/{len(files)}] {path.name}: "
                          f"{len(chosen)} page{'s' if len(chosen) != 1 else ''}{limit_note}",
                          flush=True)
                page_numbers = {number for number, _, _ in chosen if number is not None}
                copier = Copier(writer, document, page_numbers)

                if separators:
                    box = page_box(chosen[0][2], document.resolve)
                    content = label_content(path.name, box)
                    content_number = writer.alloc()
                    writer.store_stream(content_number, {}, content)
                    label_number = writer.alloc()
                    writer.store(label_number, serialize_direct({
                        "Type": Name("Page"),
                        "Parent": Ref(pages_number),
                        "MediaBox": [round(value, 4) for value in box],
                        "Resources": {"Font": {"Label": Ref(label_font)}},
                        "Contents": Ref(content_number),
                    }))
                    page_refs.append(label_number)
                    title = b"\xfe\xff" + path.name.encode("utf-16-be")
                    outline_titles.append((title, label_number))

                for number, page, attributes in chosen:
                    new_number = writer.alloc()
                    if number is not None:
                        copier.map[number] = new_number
                    page_dictionary = {
                        "Type": Name("Page"),
                        "Parent": Ref(pages_number),
                        "MediaBox": attributes.get("MediaBox", [0, 0, 595, 842]),
                    }
                    for key in PAGE_KEYS:
                        if key == "MediaBox":
                            continue
                        if key in page:
                            page_dictionary[key] = page[key]
                        elif key in attributes and key in ("CropBox", "Rotate", "Resources"):
                            page_dictionary[key] = attributes[key]
                    writer.store(new_number, copier.serialize(page_dictionary))
                    page_refs.append(new_number)
                    copier.drain()

                if position == 1:
                    info = document.info()
                    if info is not None:
                        if isinstance(document.trailer.get("Info"), Ref):
                            info_number = copier.remap(document.trailer["Info"].num)
                        else:
                            info_number = writer.alloc()
                            writer.store(info_number, copier.serialize(info))
                    metadata = document.resolve(document.root.get("Metadata"))
                    if isinstance(metadata, Stream):
                        metadata_number = writer.alloc()
                        entries = {key: item for key, item in metadata.dict.items()
                                   if key != "Length"}
                        entries["Length"] = len(metadata.raw)
                        payload = (bytes(copier.serialize(entries))
                                   + b"\nstream\n" + metadata.raw + b"\nendstream")
                        writer.store(metadata_number, payload)
                    trailer_id = document.resolve(document.trailer.get("ID"))
                    if isinstance(trailer_id, list) and trailer_id:
                        first = document.resolve(trailer_id[0])
                        if isinstance(first, bytes):
                            identifier = first
                copier.drain()
            finally:
                document.close()

        # Outline tree: one entry per source file.
        outlines_number = 0
        if separators and outline_titles:
            outlines_number = writer.alloc()
            item_numbers = [writer.alloc() for _ in outline_titles]
            for index, (title, page_number) in enumerate(outline_titles):
                entry = {
                    "Title": title,
                    "Parent": Ref(outlines_number),
                    "Dest": [Ref(page_number), Name("Fit")],
                }
                if index:
                    entry["Prev"] = Ref(item_numbers[index - 1])
                if index + 1 < len(item_numbers):
                    entry["Next"] = Ref(item_numbers[index + 1])
                writer.store(item_numbers[index], serialize_direct(entry))
            writer.store(outlines_number, serialize_direct({
                "Type": Name("Outlines"),
                "First": Ref(item_numbers[0]),
                "Last": Ref(item_numbers[-1]),
                "Count": len(item_numbers),
            }))

        writer.store(pages_number, serialize_direct({
            "Type": Name("Pages"),
            "Kids": [Ref(number) for number in page_refs],
            "Count": len(page_refs),
        }))
        catalog_number = writer.alloc()
        catalog = {
            "Type": Name("Catalog"),
            "Pages": Ref(pages_number),
        }
        if outlines_number:
            catalog["Outlines"] = Ref(outlines_number)
            catalog["PageMode"] = Name("UseOutlines")
        if metadata_number:
            catalog["Metadata"] = Ref(metadata_number)
        writer.store(catalog_number, serialize_direct(catalog))
        if identifier is None:
            digest = hashlib.md5()
            digest.update(b"mergedpdf")
            digest.update(str(len(page_refs)).encode())
            digest.update(str(time.time()).encode())
            identifier = digest.digest()
        writer.finish(catalog_number, info_number, identifier)

    os.replace(temporary, output)
    elapsed = time.time() - started
    size = output.stat().st_size
    if not quiet:
        print(f"merged {len(files)} file(s), {total_source_pages} source pages "
              f"+ {len(page_refs) - total_source_pages} label pages "
              f"-> {len(page_refs)} pages, {size / 1048576:.2f} MiB "
              f"in {elapsed:.1f}s -> {output}")


# ---------------------------------------------------------------------------
# TXT merging
# ---------------------------------------------------------------------------

def merge_txt(files: list[Path], output: Path, quiet: bool = False) -> None:
    with output.open("w", encoding="utf-8", errors="replace", newline="") as handle:
        for path in files:
            text = path.read_text(encoding="utf-8", errors="replace")
            if not quiet:
                print(f"adding {path.name}: {len(text)} characters", flush=True)
            handle.write(f"===== {path.name} =====\n")
            handle.write(text)
            if not text.endswith("\n"):
                handle.write("\n")
            handle.write("\n")
    if not quiet:
        print(f"merged {len(files)} text file(s) -> {output}")



# ---------------------------------------------------------------------------
# DOCX merging
# ---------------------------------------------------------------------------

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
NUMBERING_TYPE = ("http://schemas.openxmlformats.org/officeDocument/2006/"
                  "relationships/numbering")
IMAGE_CONTENT_TYPES = {
    "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif",
    "bmp": "image/bmp", "tif": "image/tiff", "tiff": "image/tiff", "emf": "image/x-emf",
    "wmf": "image/x-wmf", "svg": "image/svg+xml",
}


def docx_body(xml: bytes) -> bytes:
    match = re.search(rb"<w:body\b[^>]*>(.*)</w:body>", xml, re.S)
    if not match:
        raise PdfError("word/document.xml has no <w:body>")
    return re.sub(rb"<w:sectPr\b.*?</w:sectPr>\s*$", b"", match.group(1), flags=re.S)


def docx_styles(xml: bytes) -> dict[str, bytes]:
    styles: dict[str, bytes] = {}
    for match in re.finditer(rb"<w:style\b[^>]*>.*?</w:style>", xml, re.S):
        element = match.group(0)
        identifier = re.search(rb'w:styleId="([^"]+)"', element)
        if identifier:
            styles[identifier.group(1).decode("utf-8")] = element
    return styles


def docx_relationships(xml: bytes) -> list[tuple[str, str, str, str]]:
    relationships = []
    for match in re.finditer(rb"<Relationship\b[^>]*/?>", xml):
        element = match.group(0)

        def attribute(name: bytes) -> str:
            found = re.search(rb'%s="([^"]*)"' % name, element)
            return found.group(1).decode("utf-8") if found else ""

        relationships.append((attribute(b"Id"), attribute(b"Type"),
                              attribute(b"Target"), attribute(b"TargetMode")))
    return relationships


def _rewrite_ids(pattern: bytes, xml: bytes, mapping: dict[str, str]) -> bytes:
    if not mapping:
        return xml

    def replace(match: re.Match) -> bytes:
        value = match.group(2).decode("utf-8")
        return match.group(1) + mapping.get(value, value).encode("utf-8") + match.group(3)

    return re.sub(pattern, replace, xml)


STYLE_REF_PATTERN = rb'(<w:(?:pStyle|rStyle|tblStyle|numStyle)\b[^>]*w:val=")([^"]+)(")'
STYLE_LINK_PATTERN = rb'(<w:(?:basedOn|next|link)\b[^>]*w:val=")([^"]+)(")'
REL_REF_PATTERN = rb'(r:(?:id|embed|link)=")([^"]+)(")'
NUM_REF_PATTERN = rb'(<w:numId\b[^>]*w:val=")(\d+)(")'
STYLE_IDS = rb'<w:(?:pStyle|rStyle|tblStyle|numStyle)\b[^>]*w:val="([^"]+)"'
REL_IDS = rb'r:(?:id|embed|link)="([^"]+)"'
NUM_IDS = rb'<w:numId\b[^>]*w:val="(\d+)"'


def _ids(pattern: bytes, xml: bytes) -> set[str]:
    """Every id captured by ``pattern`` (whose first group is the id)."""
    return {match.group(1).decode("utf-8") for match in re.finditer(pattern, xml)}


def _unique_part(package: dict[str, bytes], wanted: str) -> str:
    candidate = wanted
    stem, suffix = os.path.splitext(wanted)
    counter = 1
    while candidate in package:
        candidate = f"{stem}_{counter}{suffix}"
        counter += 1
    return candidate


def _page_break_heading(name: str) -> bytes:
    escaped = (name.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
               .encode("utf-8"))
    return (b'<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
            b'<w:p><w:pPr><w:spacing w:before="240" w:after="240"/></w:pPr>'
            b'<w:r><w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr>'
            b'<w:t xml:space="preserve">' + escaped + b"</w:t></w:r></w:p>")


def _next_number(xml: bytes, pattern: bytes) -> int:
    values = [int(match.group(1)) for match in re.finditer(pattern, xml)]
    return max(values, default=0) + 1


def merge_docx(files: list[Path], output: Path, quiet: bool = False) -> None:
    package: dict[str, bytes] = {}
    order: list[str] = []
    with zipfile.ZipFile(files[0]) as archive:
        for item in archive.infolist():
            package[item.filename] = archive.read(item.filename)
            order.append(item.filename)
    document_name = "word/document.xml"
    rels_name = "word/_rels/document.xml.rels"
    styles_name = "word/styles.xml"
    numbering_name = "word/numbering.xml"
    if document_name not in package:
        raise PdfError(f"{files[0].name}: not a Word document (no {document_name})")
    base_document = package[document_name]
    base_rels = package.get(rels_name, b"")
    styles_xml = package.get(styles_name)
    styles = docx_styles(styles_xml) if styles_xml else {}
    numbering_xml = package.get(numbering_name, b"")
    relationships = docx_relationships(base_rels)
    content_types = package.get("[Content_Types].xml", b"")
    next_relationship = 1
    used_relationship_ids = {relationship[0] for relationship in relationships}

    def new_relationship_id() -> str:
        nonlocal next_relationship
        while True:
            candidate = f"rIdMerged{next_relationship}"
            next_relationship += 1
            if candidate not in used_relationship_ids:
                used_relationship_ids.add(candidate)
                return candidate

    new_relationships: list[tuple[str, str, str, str]] = []
    merged_body = bytearray()

    for index, path in enumerate(files, 1):
        with zipfile.ZipFile(path) as archive:
            names = set(archive.namelist())
            if document_name not in names:
                raise PdfError(f"{path.name}: not a Word document (no {document_name})")
            document = archive.read(document_name)
            body = docx_body(document)
            document_rels = (docx_relationships(archive.read(rels_name))
                             if rels_name in names else [])
            document_styles = (docx_styles(archive.read(styles_name))
                               if styles_name in names else {})
            document_numbering = (archive.read(numbering_name)
                                  if numbering_name in names else b"")
            parts = {name: archive.read(name) for name in names
                     if not name.endswith(".rels") and not name.startswith("[")}

        if index > 1:
            # Relationships referenced by this body: copy their targets in.
            used = _ids(REL_IDS, body)
            relationship_mapping: dict[str, str] = {}
            for relationship_id, relationship_type, target, mode in document_rels:
                if relationship_id not in used:
                    continue
                new_id = new_relationship_id()
                relationship_mapping[relationship_id] = new_id
                if mode == "External" or not target or ":" in target.split("/")[0]:
                    new_relationships.append((new_id, relationship_type, target, mode))
                    continue
                source = target[1:] if target.startswith("/") else os.path.normpath(
                    f"word/{target}").replace("\\", "/")
                if source not in parts:
                    new_relationships.append((new_id, relationship_type, target, mode))
                    continue
                folder = "word/media" if source.startswith("word/media/") else "word/merged"
                unique = _unique_part(package,
                                      f"{folder}/merged{index}_{os.path.basename(source)}")
                package[unique] = parts[source]
                new_relationships.append((new_id, relationship_type,
                                          os.path.relpath(unique, "word"), ""))
            body = _rewrite_ids(REL_REF_PATTERN, body, relationship_mapping)

            # Styles: add what is missing, rename what clashes.
            style_mapping: dict[str, str] = {}
            for identifier, element in document_styles.items():
                if identifier in styles:
                    if styles[identifier] != element:
                        new_identifier = f"{identifier}_merged{index}"
                        while new_identifier in styles:
                            new_identifier += "_"
                        style_mapping[identifier] = new_identifier
                        styles[new_identifier] = element.replace(
                            f'w:styleId="{identifier}"'.encode(),
                            f'w:styleId="{new_identifier}"'.encode(), 1)
                else:
                    styles[identifier] = element
            if style_mapping:
                for identifier in list(style_mapping):
                    renamed = styles[style_mapping[identifier]]
                    renamed = _rewrite_ids(STYLE_LINK_PATTERN, renamed, style_mapping)
                    styles[style_mapping[identifier]] = _rewrite_ids(
                        STYLE_REF_PATTERN, renamed, style_mapping)
                body = _rewrite_ids(STYLE_REF_PATTERN, body, style_mapping)

            # Numbering: give every used list a fresh definition.
            if document_numbering:
                numbering_mapping: dict[str, str] = {}
                abstract_mapping: dict[str, str] = {}
                for num_id in sorted(_ids(NUM_IDS, body), key=int):
                    definition = re.search(
                        rb'<w:num\b[^>]*w:numId="' + num_id.encode() + rb'"[^>]*>.*?</w:num>',
                        document_numbering, re.S)
                    if not definition:
                        continue
                    abstract = re.search(rb'<w:abstractNumId\b[^>]*w:val="(\d+)"',
                                         definition.group(0))
                    if not abstract:
                        continue
                    old_abstract = abstract.group(1).decode()
                    if old_abstract not in abstract_mapping:
                        abstract_definition = re.search(
                            rb'<w:abstractNum\b[^>]*w:abstractNumId="' + abstract.group(1)
                            + rb'"[^>]*>.*?</w:abstractNum>', document_numbering, re.S)
                        if not abstract_definition:
                            continue
                        new_abstract = str(_next_number(
                            numbering_xml, rb'<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"'))
                        numbering_xml += abstract_definition.group(0).replace(
                            f'w:abstractNumId="{old_abstract}"'.encode(),
                            f'w:abstractNumId="{new_abstract}"'.encode(), 1)
                        abstract_mapping[old_abstract] = new_abstract
                    new_num = str(_next_number(numbering_xml, rb'<w:num\b[^>]*w:numId="(\d+)"'))
                    numbering_xml += definition.group(0).replace(
                        f'w:numId="{num_id}"'.encode(), f'w:numId="{new_num}"'.encode(), 1).replace(
                        f'w:val="{old_abstract}"'.encode(),
                        f'w:val="{abstract_mapping[old_abstract]}"'.encode(), 1)
                    numbering_mapping[num_id] = new_num
                if numbering_mapping:
                    body = _rewrite_ids(NUM_REF_PATTERN, body, numbering_mapping)

        merged_body += _page_break_heading(path.name) + body
        if not quiet:
            print(f"[{index}/{len(files)}] {path.name}: body appended", flush=True)

    def replace_body(match: re.Match) -> bytes:
        original = match.group(2)
        section = re.search(rb"<w:sectPr\b.*?</w:sectPr>", original, re.S)
        return (b"<w:body" + match.group(1) + b">" + bytes(merged_body)
                + (section.group(0) if section else b"") + b"</w:body>")

    new_document = re.sub(rb"<w:body([^>]*)>(.*)</w:body>", replace_body,
                          base_document, count=1, flags=re.S)
    package[document_name] = new_document

    if styles_xml is not None and styles:
        base_style_ids = set(docx_styles(styles_xml))
        added = b"".join(element for identifier, element in styles.items()
                         if identifier not in base_style_ids)
        if added:
            package[styles_name] = re.sub(rb"</w:styles>", added + b"</w:styles>",
                                          styles_xml, count=1)
    elif styles_xml is None and styles:
        if not quiet:
            print("note: the first document has no styles part; "
                  "only direct formatting is kept.", file=sys.stderr)

    if numbering_xml and numbering_xml != package.get(numbering_name, b""):
        if numbering_name not in package:
            package[numbering_name] = (
                b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                b'<w:numbering xmlns:w="' + W_NS.encode() + b'">'
                + numbering_xml + b"</w:numbering>")
            new_relationships.append(
                (new_relationship_id(), NUMBERING_TYPE, "numbering.xml", ""))
            override = (b'<Override PartName="/word/numbering.xml" ContentType="application/'
                        b'vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>')
            package["[Content_Types].xml"] = re.sub(
                rb"</Types>", override + b"</Types>",
                package.get("[Content_Types].xml", b""), count=1)
        else:
            base_numbering = package[numbering_name]
            extra = numbering_xml[len(base_numbering):] if numbering_xml.startswith(
                base_numbering) else b""
            if extra:
                package[numbering_name] = re.sub(
                    rb"</w:numbering>", extra + b"</w:numbering>", base_numbering, count=1)

    if new_relationships:
        body_parts = []
        for relationship_id, relationship_type, target, mode in new_relationships:
            body_parts.append(
                f'<Relationship Id="{relationship_id}" Type="{relationship_type}" '
                f'Target="{target}"'
                + (' TargetMode="External"' if mode == "External" else "") + "/>")
        existing = package.get(rels_name, (
            b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            b'<Relationships xmlns="' + REL_NS.encode() + b'"></Relationships>'))
        package[rels_name] = re.sub(rb"</Relationships>",
                                    "".join(body_parts).encode("utf-8") + b"</Relationships>",
                                    existing, count=1)

    # Declare content types for any media we copied in.
    missing_defaults = []
    for name in package:
        if name.startswith("word/media/"):
            suffix = os.path.splitext(name)[1].lstrip(".").lower()
            if suffix and suffix in IMAGE_CONTENT_TYPES and not re.search(
                    rb'Extension="%s"' % suffix.encode(), content_types, re.I):
                missing_defaults.append(suffix)
    if missing_defaults:
        additions = "".join(
            f'<Default Extension="{suffix}" '
            f'ContentType="{IMAGE_CONTENT_TYPES[suffix]}"/>'
            for suffix in dict.fromkeys(missing_defaults))
        package["[Content_Types].xml"] = re.sub(
            rb"</Types>", additions.encode() + b"</Types>", content_types, count=1)

    written = set()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in order:
            if name in package and name not in written:
                archive.writestr(name, package[name])
                written.add(name)
        for name, data in package.items():
            if name not in written:
                archive.writestr(name, data)
                written.add(name)
    if not quiet:
        print(f"merged {len(files)} document(s) -> {output}")

# ---------------------------------------------------------------------------
# Command line
# ---------------------------------------------------------------------------

USAGE = __doc__


def natural_key(path: Path):
    return [int(part) if part.isdigit() else part.lower()
            for part in re.split(r"(\d+)", path.name)]


class Options:
    def __init__(self) -> None:
        self.kind: str | None = None
        self.page_limit: int | None = None
        self.locations: list[str] = []
        self.output: Path | None = None
        self.recursive = False
        self.separators = True
        self.quiet = False


VALUE_OPTIONS = {"--pages": "page_limit", "--page-count": "page_limit",
                 "--pagecount": "page_limit", "-p": "page_limit",
                 "--output": "output", "-o": "output"}
FLAG_OPTIONS = {"--recursive": ("recursive", True),
                "--no-separator": ("separators", False),
                "--no-separators": ("separators", False),
                "--quiet": ("quiet", True), "-q": ("quiet", True)}


def parse_arguments(argv: list[str]) -> Options:
    """Parse the small command line grammar documented at the top of the file."""
    options = Options()
    positional: list[str] = []
    index = 0
    while index < len(argv):
        argument = argv[index]
        index += 1
        if argument == "--":
            continue
        name, equals, inline = argument.partition("=")
        if name in ("--help", "-h"):
            print(USAGE)
            raise SystemExit(0)
        if argument in FLAG_OPTIONS and not equals:
            attribute, value = FLAG_OPTIONS[argument]
            setattr(options, attribute, value)
            continue
        if name in VALUE_OPTIONS:
            if equals:
                raw = inline
            elif index < len(argv):
                raw = argv[index]
                index += 1
            else:
                raise SystemExit(f"error: {name} needs a value")
            attribute = VALUE_OPTIONS[name]
            if attribute == "page_limit":
                if not re.fullmatch(r"\d+", raw):
                    raise SystemExit(f"error: {name} needs a page number, not {raw!r}")
                options.page_limit = int(raw)
            else:
                options.output = Path(raw).expanduser()
            continue
        if re.fullmatch(r"--?\d+", argument) and options.page_limit is None:
            options.page_limit = int(argument.lstrip("-"))
            continue
        positional.append(argument)

    for item in positional:
        lowered = item.lower().lstrip("-")
        if options.kind is None and lowered in PDF_TYPES:
            options.kind = lowered
        elif options.page_limit is None and re.fullmatch(r"\d+", item):
            options.page_limit = int(item)
        else:
            options.locations.append(item)
    if options.kind is None:
        raise SystemExit("error: first argument must be a merge type: pdf, txt or docx\n\n" + USAGE)
    if not options.locations:
        raise SystemExit("error: no input location given\n\n" + USAGE)
    return options


def collect_files(options: Options, output: Path) -> list[Path]:
    files: list[Path] = []
    suffix = "." + options.kind
    for location in options.locations:
        path = Path(location).expanduser()
        if path.is_dir():
            pattern = "**/*" if options.recursive else "*"
            matches = []
            for item in path.glob(pattern):
                if not item.is_file() or item.suffix.lower() != suffix:
                    continue
                if item.stem == "merged":
                    continue  # a previous output of this script
                matches.append(item)
            files.extend(sorted(matches, key=natural_key))
        elif path.is_file():
            files.append(path)
        else:
            raise SystemExit(f"error: location not found: {location}")
    unique: list[Path] = []
    seen = set()
    for path in files:
        resolved = path.resolve()
        if resolved == output.resolve() or resolved in seen:
            continue
        seen.add(resolved)
        unique.append(path)
    return unique


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv:
        print(USAGE)
        return 2
    options = parse_arguments(argv)
    locations = [Path(item).expanduser() for item in options.locations]
    base_directory = locations[0].parent if locations[0].is_file() else locations[0]
    if not base_directory.exists():
        base_directory = Path.cwd()
    output = options.output or (base_directory / f"merged.{options.kind}")
    files = collect_files(options, output)
    if not files:
        print(f"error: no {options.kind} files found in {', '.join(options.locations)}",
              file=sys.stderr)
        return 2
    if not options.quiet:
        print(f"merging {len(files)} {options.kind} file(s) into {output}"
              + ("" if options.page_limit is None else f" (first {options.page_limit} pages each)"))
    try:
        if options.kind == "pdf":
            merge_pdfs(files, output, options.page_limit, options.separators, options.quiet)
        elif options.kind == "txt":
            if options.page_limit is not None and not options.quiet:
                print("note: TXT files have no pages; merging them whole.")
            merge_txt(files, output, options.quiet)
        else:
            if options.page_limit is not None and not options.quiet:
                print("note: DOCX pagination belongs to the renderer; merging whole documents.")
            merge_docx(files, output, options.quiet)
    except PdfError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    except (OSError, KeyError, ValueError, zipfile.BadZipFile) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
