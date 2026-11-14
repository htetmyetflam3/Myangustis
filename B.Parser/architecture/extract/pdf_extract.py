"""Low-level PDF parsing and text-layout extraction.

Parses raw PDF bytes into objects/streams, reads embedded font streams
(``/FontFile``, ``/FontFile2``, ``/FontFile3``) and their ``cmap`` tables,
picks the font whose cmap actually contains Myanmar glyphs, reads ``/ToUnicode``
CMap streams (needed for OpenType/CFF and CID fonts that have no ``cmap``),
walks the page tree, and extracts text while preserving layout (line breaks from
text positioning).

Text decoding itself is NOT done here: the content stream is walked operator by
operator, the ``Tf`` operator selects one of the page's ``/Font`` resources, and
every shown string is handed to that resource's decoder in :mod:`pdf_fonts`.
That is what keeps a Latin ``/WinAnsiEncoding`` resource and a Myanmar
``/Identity-H`` resource apart even when they share one embedded font program.
"""

import re
import os
import math
import zlib

from myangustis_parser.normalize.mm_score import MARKS
from myangustis_parser.normalize.detector import contains_myanmar
from myangustis_parser.resources.font_names import is_unresolved_legacy_font
from myangustis_parser.extract.pdf_fonts import (
    CMapEncoding,
    CmapIdentityMap,
    DocumentDecoding,
    FontDecoder,
    FontResourceLoader,
    HexString,
    IDENTITY,
    Keyword,
    LegacyAyarMap,
    AYAR_LEGACY_CODE_PAGE,
    LEGACY_CODE_PAGES,
    ZAWCODE_LEGACY_CODE_PAGE,
    detect_legacy_layout_fonts,
    Lexer,
    Name,
    Ref,
    as_document_decoding,
    map_code,
    page_font_decoders,
    parse_object,
    usable_tounicode,
)

# Re-exported for callers that imported these from this module before the
# font-specific decoders were split out (pipeline.py, tests, the JS port docs).
_map_code = map_code

__all__ = [
    "CmapIdentityMap", "DocumentDecoding", "IDENTITY", "LegacyAyarMap",
    "ARLARWADE_AYAR_MAP", "AYAR_LEGACY_CODE_PAGE", "LEGACY_CODE_PAGES",
    "ZAWCODE_LEGACY_CODE_PAGE",
    "detect_legacy_layout_fonts", "MAX_STREAM_MB", "as_document_decoding",
    "collect_pages", "extract_metadata", "extract_page_lines",
    "extract_page_text_layout", "find_font_streams", "find_font_files2",
    "find_root_pages", "find_tounicode_maps", "get_page_mediabox",
    "get_stream", "iter_content_operations", "legacy_ayar_to_unicode",
    "fix_digit_consonant_confusion",
    "load_sidecar_map", "map_code", "page_font_decoders", "page_has_images",
    "parse_pdf_objects", "parse_tounicode_stream", "parse_ttf_cmap",
    "pick_embedded_font", "zlib_decompress_capped",
    "page_images", "decode_image", "page_image_bytes",
]

# ── decompression-bomb guard ─────────────────────────────────
# The praser is the ONLY component that opens containers, so it is the
# one that carries the cap: a tiny compressed stream must never be able
# to expand into gigabytes inside this process. Env-tunable.
def _positive_limit(name, default, maximum):
    raw = os.environ.get(name, str(default))
    if not re.fullmatch(r'[0-9]+', raw) or not 1 <= int(raw) <= maximum:
        raise ValueError(f'{name} must be between 1 and {maximum}')
    return int(raw)


MAX_STREAM_MB = _positive_limit('PRASER_MAX_STREAM_MB', 128, 512)
MAX_PDF_OBJECTS = _positive_limit('PRASER_MAX_OBJECTS', 250_000, 10_000_000)


def zlib_decompress_capped(b, limit_mb=None):
    """zlib.decompress with a hard output cap — bomb-safe."""
    limit = (MAX_STREAM_MB if limit_mb is None else limit_mb) * 1024 * 1024
    out = bytearray()
    dobj = zlib.decompressobj()
    data = b
    while data:
        out += dobj.decompress(data, 1 << 20)
        if len(out) > limit:
            raise ValueError(
                f"decompressed stream exceeds {MAX_STREAM_MB} MB cap "
                "(decompression bomb?)"
            )
        data = dobj.unconsumed_tail
        if dobj.eof:
            break
    out += dobj.flush()
    if len(out) > limit:
        raise ValueError(
            f"decompressed stream exceeds {MAX_STREAM_MB} MB cap "
            "(decompression bomb?)"
        )
    return bytes(out)
import struct


def parse_pdf_objects(raw):
    obj_pat = re.compile(rb'(\d+)\s+(\d+)\s+obj')
    objects = {}
    for m in obj_pat.finditer(raw):
        n, g = int(m.group(1)), int(m.group(2))
        start = m.end()
        end = raw.find(b'endobj', start)
        if end == -1:
            continue
        objects[(n, g)] = raw[start:end].strip()
        if len(objects) > MAX_PDF_OBJECTS:
            raise ValueError(f'PDF exceeds the {MAX_PDF_OBJECTS} object cap')
    return objects


def get_stream(objects, num, gen=0):
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
            return zlib_decompress_capped(b)
        except ValueError:
            raise  # bomb guard: refuse the document loudly, never silently
        except Exception:
            return None
    return b



def _page_content_stream(loader, ref):
    """Decode a content stream using its exact declared byte length.

    Other font/ToUnicode stream readers intentionally keep JS getStream's
    delimiter behavior, because subset-profile hashes depend on those bytes.
    """
    dictionary = loader.object_value(ref)
    raw = loader.objects.get((ref.num, ref.gen))
    if not isinstance(dictionary, dict) or raw is None:
        raise ValueError(f'Missing PDF content stream {ref.num} {ref.gen} R')
    length = loader.resolve(dictionary.get('Length'))
    if not isinstance(length, int) or length < 0:
        raise ValueError(f'Invalid PDF content stream length for {ref.num} {ref.gen} R')
    marker = raw.find(b'stream')
    if marker < 0:
        raise ValueError(f'Missing PDF content stream {ref.num} {ref.gen} R')
    start = marker + 6
    if raw[start:start + 1] == b'\r':
        start += 1
    if raw[start:start + 1] == b'\n':
        start += 1
    if start + length > len(raw):
        raise ValueError(f'Invalid PDF content stream length for {ref.num} {ref.gen} R')
    filters = loader.resolve(dictionary.get('Filter'))
    filters = filters if isinstance(filters, list) else ([] if filters is None else [filters])
    filters = [loader.resolve(item) for item in filters]
    if len(filters) > 1 or any(not isinstance(item, Name) or str(item) not in ('FlateDecode', 'Fl') for item in filters):
        raise ValueError(f'PDF content stream {ref.num} {ref.gen} R uses an unsupported filter')
    params = loader.resolve(dictionary.get('DecodeParms'))
    params = params if isinstance(params, list) else [params]
    for item in params:
        item = loader.resolve(item)
        predictor = loader.resolve(item.get('Predictor')) if isinstance(item, dict) else None
        if predictor is not None and predictor != 1:
            raise ValueError(f'PDF content stream {ref.num} {ref.gen} R uses an unsupported predictor')
    data = raw[start:start + length]
    if filters:
        if not data:
            raise ValueError(f'Invalid compressed PDF content stream {ref.num} {ref.gen} R')
        data = zlib_decompress_capped(data)
    if len(data) > MAX_STREAM_MB * 1024 * 1024:
        raise ValueError(f'PDF content stream exceeds the {MAX_STREAM_MB} MB cap')
    return data

def extract_metadata(objects):
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


# Matches an embedded font stream reference of any kind:
#   /FontFile    (Type 1)
#   /FontFile2   (TrueType)
#   /FontFile3   (OpenType/CFF, often subtype /OpenType or /CIDFontType0C)
_FONT_STREAM_RE = re.compile(r'/FontFile(?:2|3)?\s+(\d+)\s+(\d+)\s+R')


def find_font_streams(objects):
    """Return a list of all embedded font-stream object refs in the PDF.

    A PDF can embed many fonts (e.g. Zawgyi-One, Calibri, MS Gothic, Times New
    Roman), and they may be stored as ``/FontFile`` (Type 1), ``/FontFile2``
    (TrueType) or ``/FontFile3`` (OpenType/CFF). We collect every candidate so
    the caller can pick the font whose cmap actually contains Myanmar glyphs
    instead of blindly using the first.
    """
    refs = []
    for (n, g), d in objects.items():
        d_str = d.decode('latin-1', errors='replace')
        for m in _FONT_STREAM_RE.finditer(d_str):
            ref = (int(m.group(1)), int(m.group(2)))
            if ref not in refs:
                refs.append(ref)
    return refs


# Backwards-compatible alias (older callers looked for TrueType only).
find_font_files2 = find_font_streams


def _utf16be_to_str(hexstr):
    """Decode a UTF-16BE hex string (e.g. from a ToUnicode CMap) to text."""
    raw = bytes.fromhex(hexstr)
    return raw.decode('utf-16-be', errors='replace')


class ToUnicodeMap(dict):
    """ToUnicode entries retain source-code width as in the JS parser."""
    def __init__(self):
        super().__init__()
        self.by_width = {}


def parse_tounicode_stream(data):
    """Parse a PDF ``/ToUnicode`` CMap stream into ``{int code: str unicode}``.

    Handles the ``bfchar`` (single mappings) and ``bfrange`` (scalar and array
    ranges) operators used by the common ``CMapType 2`` ToUnicode maps. This is
    the authoritative code→Unicode mapping for CID-keyed fonts (CFF/OpenType),
    which often have no usable ``cmap`` table.
    """
    try:
        text = data.decode('latin-1')
    except Exception:
        return {}

    mapping = ToUnicodeMap()

    # One book in the wild carries a bfrange wide enough to fill memory
    # (ယဲ့နင်: the uncapped loop got the process OOM-killed). The caps match
    # the JS parser's (read/pdf-extract.mjs): no range may mint more than
    # 0x10000 codes and one CMap may not mint more than 1<<20 entries.
    def _put(code, value, width):
        if len(mapping) >= (1 << 20):
            return False
        mapping[code] = value
        mapping.by_width.setdefault(width, {})[code] = value
        return True

    # bfchar: <src> <dst>  (dst is UTF-16BE)
    for m in re.finditer(r'beginbfchar(.*?)endbfchar', text, re.DOTALL):
        for p in re.finditer(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', m.group(1)):
            if not _put(int(p.group(1), 16), _utf16be_to_str(p.group(2)), (len(p.group(1)) + 1) // 2):
                return mapping

    # bfrange, scalar form: <lo> <hi> <start>
    for m in re.finditer(r'beginbfrange(.*?)endbfrange', text, re.DOTALL):
        body = m.group(1)
        for p in re.finditer(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', body):
            lo, hi = int(p.group(1), 16), int(p.group(2), 16)
            if hi < lo or hi - lo + 1 > 0x10000:
                continue
            # The destination is a UTF-16BE *byte string*, not a Unicode
            # scalar: chr() on the whole token crashes on valid surrogate
            # pairs such as <D83DDE00> and on multi-code-unit mappings
            # (this is the crash that ate whole books, e.g. ယဲ့နင်). PDF
            # specifies the byte string is incremented big-endian for each
            # source code. Mirrors Praser/parser/read/pdf-extract.mjs.
            dst_hex = p.group(3)
            if len(dst_hex) % 2:
                dst_hex += '0'
            dst = bytearray(bytes.fromhex(dst_hex))
            for code in range(lo, hi + 1):
                if not _put(code, bytes(dst).decode('utf-16-be', errors='replace'), (len(p.group(1)) + 1) // 2):
                    return mapping
                if code < hi:
                    for i in range(len(dst) - 1, -1, -1):
                        dst[i] = (dst[i] + 1) & 0xFF
                        if dst[i]:
                            break
                    else:
                        break  # destination overflowed its width; stop the range

    # bfrange, array form: <lo> <hi> [<d1> <d2> ...]
    for m in re.finditer(r'beginbfrange(.*?)endbfrange', text, re.DOTALL):
        body = m.group(1)
        for p in re.finditer(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[(.*?)\]', body, re.DOTALL):
            lo, hi = int(p.group(1), 16), int(p.group(2), 16)
            if hi < lo or hi - lo + 1 > 0x10000:
                continue
            items = re.findall(r'<([0-9A-Fa-f]+)>', p.group(3))
            for i, code in enumerate(range(lo, hi + 1)):
                if i < len(items):
                    if not _put(code, _utf16be_to_str(items[i]), (len(p.group(1)) + 1) // 2):
                        return mapping

    return mapping


def find_tounicode_maps(objects):
    """Collect every ``/ToUnicode`` CMap in the PDF into ``{code: unicode}``.

    Scans all objects for ``/ToUnicode N G R`` references, decompresses the
    referenced stream, and merges the resulting code→Unicode maps (first
    mapping wins for a given code).

    Copy-protected PDFs ship *blanked* ToUnicode maps (nearly every code maps
    to a space) as decoys. Those are detected (>90% space values) and only
    their non-space entries are kept, so they cannot poison the merge.
    """
    code_to_uni = {}
    seen = set()
    for (n, g), d in objects.items():
        d_str = d.decode('latin-1', errors='replace')
        if '/ToUnicode' not in d_str:
            continue
        for m in re.finditer(r'/ToUnicode\s+(\d+)\s+\d+\s+R', d_str):
            tn = int(m.group(1))
            if tn in seen:
                continue
            seen.add(tn)
            s = get_stream(objects, tn)
            if not s:
                continue
            mp = parse_tounicode_stream(s)
            if not mp:
                continue
            spaces = sum(1 for v in mp.values() if v == ' ')
            if spaces / len(mp) > 0.9:
                # blanked decoy: only its few non-space entries are real
                mp = {k: v for k, v in mp.items() if v != ' '}
            for code, uni in mp.items():
                code_to_uni.setdefault(code, uni)
    return code_to_uni


def load_sidecar_map(path=None):
    """Optional cross-volume cipher map (``@jason-map/cipher-map.json``).

    Some volumes ship only blanked ToUnicode maps; sibling volumes of the same
    series share the font cipher, so their valid maps (merged once into the
    sidecar JSON as ``{hex_code: unicode}``) can decode them. The document's
    own valid entries always take precedence (caller merges with setdefault).
    """
    import json
    from pathlib import Path
    from myangustis_parser.resources import maps
    p = Path(path) if path else maps.find_map("cipher-map.json")
    if p is None or not p.is_file():
        return {}
    try:
        return {int(k, 16): v for k, v in json.loads(p.read_text(encoding="utf-8")).items()}
    except Exception:
        return {}


def get_page_mediabox(objects, page_num, page_gen):
    """Return (width, height) of a page's MediaBox in PDF points.

    Walks up the /Parent chain (MediaBox is usually inherited from /Pages).
    Falls back to US Letter (612 x 792).
    """
    d = objects.get((page_num, page_gen), b'')
    for _ in range(8):
        m = re.search(rb'/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]', d)
        if m:
            x0, y0, x1, y1 = (float(v) for v in m.groups())
            if all(math.isfinite(v) for v in (x0, y0, x1, y1)) and x0 != x1 and y0 != y1:
                return abs(x1 - x0), abs(y1 - y0)
        pm = re.search(rb'/Parent\s+(\d+)\s+(\d+)\s+R', d)
        if not pm:
            break
        d = objects.get((int(pm.group(1)), int(pm.group(2))), b'')
    return 612.0, 792.0


def page_has_images(objects, page_num, page_gen):
    """True when the page's resources declare image XObjects (image pages).

    Resolves the full indirection chain: page -> /Resources (inline or ref)
    -> /XObject dict (inline or ref) -> its entries, which may be inline
    dicts or refs to the image-stream objects carrying /Subtype /Image.
    """
    def _get(ref_match):
        raw = objects.get((int(ref_match.group(1)), 0), b'')
        return raw.decode('latin-1', errors='replace')

    d = objects.get((page_num, page_gen), b'').decode('latin-1', errors='replace')
    res = d
    m = re.search(r'/Resources\s+(\d+)\s+\d+\s+R', d)
    if m:
        res = _get(m)
    if re.search(r'/Subtype\s*/Image', res):
        return True                       # inline image dict in resources
    mx = re.search(r'/XObject\s+(\d+)\s+\d+\s+R', res)
    xo = _get(mx) if mx else res          # XObject dict: indirect or inline
    if re.search(r'/Subtype\s*/Image', xo):
        return True
    for rm in re.finditer(r'(\d+)\s+\d+\s+R', xo):
        if re.search(r'/Subtype\s*/Image', _get(rm)):
            return True                   # image stream behind an entry ref
    return False


_MYA_RANGE = range(0x1000, 0x109F + 1)


def _has_myanmar_glyphs(cmap):
    """True if the cmap maps any Myanmar Unicode codepoint to a glyph."""
    return any(c in _MYA_RANGE for c in cmap)


def pick_embedded_font(objects, refs, log=lambda m: None):
    """Choose the embedded font whose cmap contains Myanmar glyphs.

    Falls back to the first candidate when none contains Myanmar glyphs, and
    returns (ref, ttf_bytes, cmap). ref/ttf/cmap are None/{} when nothing usable
    was found.
    """
    fallback = None
    for ref in refs:
        ttf = get_stream(objects, *ref)
        if not ttf:
            continue
        cmap = parse_ttf_cmap(ttf)
        if _has_myanmar_glyphs(cmap):
            log(f"[+] Chosen embedded font obj {ref[0]} (contains Myanmar glyphs)")
            return ref, ttf, cmap
        if fallback is None:
            fallback = (ref, ttf, cmap)

    if fallback is not None:
        ref, ttf, cmap = fallback
        log(f"[i] No Myanmar-glyph font found; using first font stream obj {ref[0]}")
        return ref, ttf, cmap

    return None, None, {}


def parse_ttf_cmap(data):
    """Read the highest-ranked usable cmap subtable, as current JS does."""
    if len(data) < 12:
        return {}
    num_tables = struct.unpack_from('>H', data, 4)[0]
    tables = {}
    for index in range(num_tables):
        offset = 12 + index * 16
        if offset + 16 > len(data):
            break
        tables[data[offset:offset + 4]] = struct.unpack_from('>I', data, offset + 8)[0]
    cmap_off = tables.get(b'cmap')
    if cmap_off is None or cmap_off + 4 > len(data):
        return {}
    cmap = data[cmap_off:]
    count = struct.unpack_from('>H', cmap, 2)[0]
    ranks = {(3, 10): 100, (0, 4): 95, (0, 6): 90, (3, 1): 85,
             (0, 3): 80, (0, 0): 70, (0, 1): 70, (0, 2): 70,
             (3, 0): 60, (1, 0): 30}
    subtables = []
    for index in range(count):
        pos = 4 + 8 * index
        if pos + 8 > len(cmap):
            break
        platform, encoding, sub_off = struct.unpack_from('>HHI', cmap, pos)
        if sub_off + 2 <= len(cmap):
            subtables.append((-ranks.get((platform, encoding), 10), index, sub_off))
    for _, _, sub_off in sorted(subtables):
        sub = cmap[sub_off:]
        fmt = struct.unpack_from('>H', sub)[0]
        mapping = {}
        if fmt == 4 and len(sub) >= 14:
            count = struct.unpack_from('>H', sub, 6)[0] // 2
            if len(sub) < 14 + count * 8:
                continue
            so, do = 14 + count * 2 + 2, 14 + count * 4 + 2
            ro = do + count * 2
            for i in range(count):
                end = struct.unpack_from('>H', sub, 14 + i * 2)[0]
                start = struct.unpack_from('>H', sub, so + i * 2)[0]
                delta = struct.unpack_from('>h', sub, do + i * 2)[0]
                offset = struct.unpack_from('>H', sub, ro + i * 2)[0]
                if start == 0xffff:
                    continue
                for code in range(start, end + 1):
                    if offset == 0:
                        gid = (code + delta) & 0xffff
                    else:
                        at = ro + offset + (code - start + i) * 2
                        if at + 2 > len(sub):
                            continue
                        gid = struct.unpack_from('>H', sub, at)[0]
                        if gid:
                            gid = (gid + delta) & 0xffff
                    if gid:
                        mapping[code] = gid
        elif fmt == 0 and len(sub) >= 14:
            for code, gid in enumerate(sub[6:6 + min(256, len(sub) - 6)]):
                if gid:
                    mapping[code] = gid
        elif fmt == 6 and len(sub) >= 10:
            first, count = struct.unpack_from('>HH', sub, 6)
            for i in range(count):
                if 12 + i * 2 > len(sub):
                    break
                gid = struct.unpack_from('>H', sub, 10 + i * 2)[0]
                if gid:
                    mapping[first + i] = gid
        elif fmt == 12 and len(sub) >= 16:
            groups = struct.unpack_from('>I', sub, 12)[0]
            for i in range(groups):
                pos = 16 + i * 12
                if pos + 12 > len(sub):
                    break
                start, end, gid = struct.unpack_from('>III', sub, pos)
                # Unicode scalars cannot exceed 10FFFF. Reject absurd ranges
                # rather than exhaust resources on malformed untrusted fonts.
                if end < start or end > 0x10ffff or end - start > 0x100000:
                    continue
                for code in range(start, end + 1):
                    mapping[code] = gid + code - start
        if mapping:
            return mapping
    return {}


def collect_pages(objects, page_num, gen=0):
    """Walk instruction-page references in order, retaining generations.

    A repeated leaf is emitted once; a cycle in the page tree is an error.
    """
    if isinstance(page_num, tuple):
        page_num, gen = page_num
    limit = _positive_limit('LOCAL_MAX_PAGES', 20_000, 1_000_000)
    pages, seen, visiting = [], set(), set()
    def walk(key):
        data = objects.get(key, b'')
        if re.search(rb'/Type\s*/Page(?!s)', data):
            if key not in seen:
                seen.add(key)
                pages.append(key)
                if len(pages) > limit:
                    raise ValueError(f'PDF exceeds the {limit} page cap')
            return
        if key in visiting:
            raise ValueError('Cycle found in PDF page tree')
        visiting.add(key)
        try:
            match = re.search(rb'/Kids\s*\[(.*?)\]', data, re.DOTALL)
            if match:
                for num, generation in re.findall(rb'(\d+)\s+(\d+)\s+R', match.group(1)):
                    walk((int(num), int(generation)))
        finally:
            visiting.remove(key)
    if page_num is not None:
        walk((page_num, gen))
    return pages


def find_root_pages(objects):
    for key in sorted(objects):
        data = objects[key]
        if re.search(rb'/Type\s*/Catalog', data):
            match = re.search(rb'/Pages\s+(\d+)\s+(\d+)\s+R', data)
            if match:
                num, gen = int(match.group(1)), int(match.group(2))
                # Preserve the historical int return for generation zero.
                return num if gen == 0 else (num, gen)
    return None


# ``IDENTITY``, ``CmapIdentityMap`` and ``LegacyAyarMap`` now live in
# pdf_fonts (they are decoding semantics, shared by every font decoder) and
# are re-exported above.

# Arlarwade is an old Ayar-compatible Myanmar font.  The embedded subsets in
# mm-grammar.pdf are not Unicode encoded: their PDF character codes 33..121
# select the same legacy glyph table used by Ayar.  The candidate Ayar font in
# fonts/Unicode is used as the visual reference; these are the resulting
# character-code -> Ayar/Unicode values.  Some entries are multi-character
# legacy glyphs (notably 81 = stacked ဒ္ဒ) and 92 is a zero-width/placeholder
# glyph that must be discarded rather than emitted as a raw backslash.
#
# Keep this as a code map, not a glyph-id map.  PDF TrueType subsets renumber
# glyph IDs independently, while the character codes remain stable across all
# Arlarwade subsets in the document.  (The ``LegacyAyarMap`` marker class it is
# wrapped in lives in pdf_fonts with the other decoding semantics.)
ARLARWADE_AYAR_MAP = {
    33: "ြ", 34: "ပ", 35: "ည", 36: "်", 37: "ေ", 38: "ထ",
    39: "ာ", 40: "င", 41: "စ", 42: "ု", 43: "သ", 44: "မ",
    45: "္မ", 46: "တ", 47: "န", 48: "န", 49: "ိ", 50: "ံ",
    51: "ရ", 52: "း", 53: "၀", 54: "ြ", 55: "က", 56: "ီ",
    57: "ဌ", 58: "အ", 59: "ဖ", 60: "ွ", 61: "ဲ", 62: "့",
    63: "ဥ", 64: "ဒ", 65: "ယ", 66: "ှ", 67: "ခ", 68: "၂",
    69: "၀", 70: "၁", 71: "၃", 72: "—", 73: "၊", 74: " ",
    75: "လ", 76: "ူ", 77: "။", 78: "က", 79: "ျ", 80: "ါ",
    81: "္ဒ", 82: "ါ", 83: "၅", 84: "ဇ", 85: "ံ", 86: "့",
    87: "ြ", 88: "ု", 89: "၂", 90: "၍", 91: "ဝ", 92: "",
    93: "ဉ", 94: "ဏ", 95: "ဆ", 96: "၉", 97: "၈", 98: "၄",
    99: "ဘ", 100: "၆", 101: "ဤ", 102: "ြ", 103: "ခ", 104: "ဂ",
    105: "", 106: "ဗ", 107: "ရ", 108: "(", 109: ")", 110: "ဃ",
    111: "၌", 112: "ဈ", 113: "ဍ", 114: "ဎ", 115: "၊", 116: "ဝ",
    117: "စ", 118: "ဗ", 119: "ဝ", 120: "ၺ", 121: "ပ",
}


def fix_digit_consonant_confusion(text):
    """Restore the consonant ``ဝ`` where a legacy face wrote the digit ``၀``.

    U+101D (the consonant wa) and U+1040 (digit zero) are the same shape, and
    legacy code pages routinely resolve the shared glyph to the digit. The
    disambiguation is structural: a digit cannot carry a dependent mark, so a
    ``၀`` wearing one is really the consonant.

    Two structural cases, and nothing else:

    1. a digit wearing a dependent MARK;
    2. a digit with a Myanmar letter or mark on BOTH sides -- it is inside a
       word, and a number is not. This is the common one: the neighbour in
       front is usually a mark, not a base (``ပါ၀င်`` ×327, ``တာ၀န်``, ``တာ၀တိံ``,
       ``သာ၀က``), so requiring a base in front finds nothing at all.

    A digit is never a letter or a mark, so a real number is untouched from
    either side: ``၁၀``, ``၅၀၊`` and a ``၀`` after a space stay digits.

    The same glyph runs the other way too: ``\u101b`` (ra) and ``\u1047`` (digit seven)
    are one shape, so a ``\u101b`` INSIDE a run of digits is the digit -- ``\u1041\u101b`` is
    17 and ``\u1043\u1048\u101b`` is 387. Never when a letter or mark follows, or ``\u1045\u101b\u1000\u103a``
    (five days) would lose its ``\u101b\u1000\u103a``.

    On a 445-page legacy grammar this takes orphan marks from 4.47% to 2.20%,
    and the later cases convert a further ~1,700 occurrences.
    """
    def letter_or_mark(ch):
        # ch may be "" at a string edge, and "" is `in` every string
        return bool(ch) and ("\u1000" <= ch <= "\u1021"
                             or ch in ("\u1025", "\u1027", "\u1039")
                             or ch in MARKS)

    def digit(ch):
        return bool(ch) and "\u1040" <= ch <= "\u1049"

    out = list(text)
    n = len(out)
    for i in range(n):
        after = out[i + 1] if i + 1 < n else ""
        before = out[i - 1] if i else ""
        if out[i] == "\u1040":
            # ၀ -> ဝ : the digit is wearing a mark, or sits inside a word
            if after in MARKS or (letter_or_mark(before) and letter_or_mark(after)):
                out[i] = "\u101d"
            # ...or it OPENS a word: a number does not run into a consonant
            elif not digit(before) and not letter_or_mark(before) \
                    and "\u1000" <= after <= "\u1021":
                out[i] = "\u101d"
    text = "".join(out)

    # ရ and ၇ are the same glyph, and the test is simply this: the shape is
    # ရ unless a digit sits next to it. ရက် always carries its က်, so a
    # following Myanmar letter or mark means ရ -- while a following digit, or
    # another ရ, keeps it numeric.
    #
    #   ၅ရက်   -> ၅ရက်    (five days; က follows, so it is the word)
    #   ရ၅ကတ္တား -> ၇၅ ကတ္တား  (index: the page number runs into the entry)
    #   ၃ရရ     -> ၃၇၇      (page 377)
    #   ၅၀ရာ    -> ၅၀ရာ     (ာ follows, so it is ရာ)
    #
    # Repeated to a fixed point so a run of ရ resolves from either end:
    # ရရ၅ needs the rightmost to become ၇ before the leftmost can see a digit.
    for _ in range(3):
        chars = list(text)
        changed = False
        for i, ch in enumerate(text):
            if ch != "\u101b":
                continue
            before = text[i - 1] if i else ""
            after = text[i + 1] if i + 1 < len(text) else ""
            if (digit(before) or digit(after)) and (
                    not letter_or_mark(after) or digit(after) or after == "\u101b"):
                chars[i] = "\u1047"
                changed = True
        text = "".join(chars)
        if not changed:
            break
    return text


_PREPOSED_RE = re.compile(
    r"((?:ေ?ြ[ွှ]+)|[ြေ]+)"         # preposed slots, including compound ra
    r"([က-အ၀၈၇])"                 # its base
    r"(င်္)?"                       # kinzi, written after the base
    r"((?:္[က-အ])*)"                # any stacked consonants
)


def _collapse_overprint(text):
    """Collapse a piece that is one short unit drawn twice (or three times).

    The faux-bold here is not only a second COPY of a run at a small offset
    (that is handled by the piece dedup); the producer also repeats the
    glyphs INSIDE one text-showing operation, so a single piece arrives as
    ``\u1019\u1019`` or ``\u103e\u103e`` or ``\u102c\u1038\u102c\u1038``. No piece-level comparison can see
    that -- there is only one piece.

    Deliberately narrow, because Burmese does repeat syllables for real
    (``\u1019\u103c\u1014\u103a\u1019\u103c\u1014\u103a``, ``\u1021\u101e\u102e\u1038\u101e\u102e\u1038``): the WHOLE piece must be the unit repeated,
    the unit at most 3 characters, and the piece at most 9 -- a real word
    does not arrive as its own isolated fragment.
    """
    n = len(text)
    if n < 2 or n > 9:
        return text
    for size in (1, 2, 3):
        if n % size or n // size < 2:
            continue
        unit = text[:size]
        if unit * (n // size) == text:
            return unit
    return text


def legacy_ayar_to_unicode(text, *, apply_aa_vowel_rule=True):
    """Put Ayar's visual/legacy order into normal Myanmar code-point order.

    This is intentionally small and conservative.  It mirrors the established
    Ayar -> Myanmar3 conversion rules: move preposed ြ/ေ after the base
    and move င်္ clusters into their Unicode order. Preserve zero-width text.
    """
    # A combined kinzi/vowel glyph can precede medials in legacy order.
    text = re.sub(r"([က-အ])(င်္)([ိီံ])([ျြွှ]+)", r"\1\2\4\3", text)
    # ONE left-to-right pass for the preposed vowels. Two passes cannot work:
    # the first would place သေကင်္တ correctly as သင်္ကေတ, and the second
    # would then see that same ေ sitting in front of တ and move it AGAIN,
    # giving သင်္ကတေ. Matching once and continuing past the replacement
    # is what keeps it put.
    #
    # The vowel clears the whole cluster, never landing inside it:
    #   base            ေက        -> ကေ
    #   stacked pair    ေဏ္ဏ     -> ဏ္ဏေ      (not ဏေ္ဏ)
    #   kinzi           ေကင်္    -> င်္ကေ     (kinzi leads the cluster)
    def reorder_preposed(match):
        vowel = match.group(1)
        if vowel.startswith("ေြ") and ("ွ" in vowel or "ှ" in vowel):
            vowel = vowel[1:] + "ေ"
        return (match.group(3) or "") + match.group(2) + (match.group(4) or "") + vowel

    text = _PREPOSED_RE.sub(reorder_preposed, text)

    # A kinzi that is NOT followed by a consonant cannot belong to one on its
    # right, so it belongs to the cluster on its left and moves in front of
    # it: သချင်္ာ -> သင်္ချာ. When a consonant DOES follow, the kinzi is
    # already where it belongs (ဝါစင်္ဂ) and is left alone -- 460 of those
    # here against 24 of the broken shape.
    #
    # This repairs the AUTHOR'S TYPING, not a decoding error. The raw stream
    # really holds \u101e \u1001 \u103b \u1004\u103a\u1039 \u102c (medial BEFORE kinzi) for all 24
    # occurrences -- the order the legacy input method does not accept. The
    # two encodings differ in how loudly they say so: Zawgyi renders that
    # order visibly wrong, while Unicode reorders on the fly and renders it
    # correctly, so in Unicode the same mistake is INVISIBLE and only the
    # code points show it. That is why the matching scanner check compares
    # code points and never shapes.
    #
    # It has to run AFTER the preposed vowel has been placed, and the group
    # it jumps must include that vowel. သေဘင်္ာ is သင်္ဘော: moving the
    # kinzi first leaves it sitting behind ေ, and the preposed rule then
    # splits it apart and destroys it (18 သင်္ဘော, 7 တနင်္ဂနွေ, 6 ခြင်္သေ့
    # were lost that way).
    text = re.sub(r"([\u1000-\u1021][\u102b-\u103e]*)"
                  r"(\u1004\u103a\u1039)(?![\u1000-\u1021])",
                  r"\2\1", text)
    # Pair medials with the base before ေ, including a combined ya/wa/ha.
    text = re.sub(r"([က-အ၀၇၈])ေ([ျြ]?)([ွှ]+)", r"\1\2\3ေ", text)
    text = re.sub(r"([က-အ၀၇၈])(ေ)([ျြ])", r"\1\3\2", text)
    text = re.sub(r"([က-အ])([က-အ])(င်္)", r"\1\3\2", text)
    # Ayar writes ဦး as ဦး in a number of older subsets.
    text = text.replace("ဦး", "ဦး")

    # Reorder-by-priority is NOT done here. It belongs to exactly one place,
    # cleanup.reorder_marks, which reads the single shared priority table;
    # a second implementation here drifted from it once already. What stays
    # is what only this function can do: the legacy font's visual order.
    #
    # The single-word substitution that used to live here (a ``ဲ``/``ွ`` mix-up
    # in one Arlarwade subset) is gone: per-resource decoding removed the
    # cause, and patching one word of one document was never a fix.
    # A digit cannot carry a mark; restore the consonant so the marks that
    # follow have a base to attach to.
    text = fix_digit_consonant_confusion(text)
    # In these legacy layouts, ya/ra uses ာ rather than ါ. Apply this only
    # after visual-order conversion, without moving the other marks.
    if apply_aa_vowel_rule:
        text = re.sub(r"([က-အ][ျြ][ျြွှ]*ေ?)ါ", r"\1ာ", text)
    return text


def _aa_vowel_rule_for_legacy(doc):
    page = doc.legacy_code_page
    return ((page is None and isinstance(doc.map, LegacyAyarMap)) or
            page is LEGACY_CODE_PAGES['ayar'] or page is LEGACY_CODE_PAGES['wininnwa'])


# ═══════════════════════════════════════════════════════════════════════════
#  Content-stream walking
# ═══════════════════════════════════════════════════════════════════════════

# An inline image's binary data is not PDF syntax, so the tokenizer must jump
# over it instead of trying to read it.  ``EI`` ends the image and is always
# preceded by whitespace.
_INLINE_IMAGE_END_RE = re.compile(rb"[\s\x00]EI(?=[\s\x00\[\]<>/%(]|$)")


def _skip_inline_image(data, pos):
    m = _INLINE_IMAGE_END_RE.search(data, pos)
    return m.end() if m else len(data)


def iter_content_operations(data):
    """Yield ``(operator, operands)`` of a content stream, in document order.

    A real (if small) PDF tokenizer, not a per-block regex: text-showing
    operators have to be seen in sequence with the ``Tf`` operators around
    them, because the active font persists across ``BT...ET`` blocks and one
    page routinely mixes a Latin resource with a Myanmar one.
    """
    lex = Lexer(data)
    operands = []
    containers = []
    while True:
        tok = lex.next_token()
        if tok is None:
            break
        kind, value = tok
        if kind == "aopen":
            containers.append(("a", len(operands)))
            continue
        if kind == "dopen":
            containers.append(("d", len(operands)))
            continue
        if kind in ("aclose", "dclose"):
            if not containers:
                continue
            ctype, mark = containers.pop()
            items = operands[mark:]
            del operands[mark:]
            if ctype == "a":
                operands.append(items)
            else:
                d = {}
                for i in range(0, len(items) - 1, 2):
                    if isinstance(items[i], Name):
                        d[str(items[i])] = items[i + 1]
                operands.append(d)
            continue
        if kind == "kw":
            if containers:                       # e.g. "n g R" inside an array
                operands.append(value)
                continue
            op = str(value)
            if op == "ID":                       # inline image data follows
                lex.pos = _skip_inline_image(data, lex.pos)
                operands = []
                continue
            yield op, operands
            operands = []
            continue
        operands.append(value)
        if not containers and len(operands) > 64:
            # Malformed stream guard: an operator never takes more than a
            # handful of operands. Only trimmed at the top level — a TJ array
            # legitimately holds hundreds of strings and kerning numbers.
            del operands[:-16]


class _UnsetFontDecoder(FontDecoder):
    """Decoder used for text shown before any ``Tf`` selects a resource.

    There is no font to ask, so the document-level map is applied straight to
    the codes — exactly what this parser did for every string before decoding
    became font-specific.  Hex strings keep their two-byte reading, literal
    strings their one-byte reading.
    """

    __slots__ = ()

    def decode(self, data, *, use_confirmed=True, stats=None):
        if not data:
            return ""
        if isinstance(data, HexString):
            out = []
            for i in range(0, len(data) - 1, 2):
                code = (data[i] << 8) | data[i + 1]
                text = self._doc_lookup(code)
                if text is None and stats is not None:
                    stats['unmapped_codes'] += 1
                out.append(text if text is not None else f"[{code:04X}]")
            return "".join(out)
        out = []
        for code in data:
            text = self._doc_lookup(code)
            if text is None:
                if stats is not None:
                    stats['fallback_bytes'] += 1
                text = chr(code)
            out.append(text)
        return "".join(out)


def _document_loader(doc, objects):
    """One :class:`FontResourceLoader` per document, cached on the strategy."""
    loader = doc.loader
    if loader is None or loader.objects is not objects:
        loader = FontResourceLoader(objects, get_stream, parse_ttf_cmap,
                                    parse_tounicode_stream)
        doc.loader = loader
        # Decoders are cached by object number, which only identifies a font
        # within one document.
        doc.reset_font_cache()
    return loader


def _shown_strings(op, operands):
    """Return the strings a text-showing operator draws (in order)."""
    if not operands:
        return []
    if op == "Tj" or op == "'":
        last = operands[-1]
        return [last] if isinstance(last, bytes) else []
    if op == '"':
        last = operands[-1]
        return [last] if isinstance(last, bytes) else []
    if op == "TJ":
        last = operands[-1]
        if isinstance(last, list):
            return [item for item in last if isinstance(item, bytes)]
    return []


def _line_font(ordered):
    """First non-empty base font name on an assembled line (JS ``line[4]``)."""
    for piece in ordered:
        if len(piece) > 4 and piece[4]:
            return piece[4]
    return None


def _join_draft_runs(pieces, order):
    """Order adjacent profiled runs together, never other font resources."""
    out, pending, selected = [], [], None
    for piece in pieces:
        text, runs = piece[2], piece[3]
        for is_draft, part in (runs if runs is not None else [(False, text)]):
            if not part:
                continue
            if selected is not None and selected != is_draft:
                value = ''.join(pending)
                out.append(order(value) if selected else value)
                pending = []
            selected = is_draft
            pending.append(part)
    value = ''.join(pending)
    out.append(order(value) if selected else value)
    return ''.join(out)



def _join_visual_runs(pieces, doc):
    """Join adjacent font runs before any witnessed visual reconstruction."""
    from myangustis_parser.extract.pdf_visual import decode_visual_unicode_run
    transformed, pending, raw_parts = [], [], []
    decoder, has_raw = None, True
    def flush():
        if decoder is None:
            if pending:
                transformed.append(''.join(pending))
            return
        text = ''.join(pending)
        if decoder.visual_unicode_glyphs and has_raw and raw_parts:
            unresolved = []
            actual = decode_visual_unicode_run(decoder, raw_parts,
                starts_at_boundary=not transformed, on_unresolved=lambda: unresolved.append(True))
            if doc.visual_unicode_observer and (actual != text or unresolved):
                doc.visual_unicode_observer(actual != text, bool(unresolved))
            text = actual
        transformed.append(text)
    for piece in pieces:
        for font, part, raw in (piece[3] if piece[3] is not None else [(None, piece[2], None)]):
            if font is not decoder:
                flush()
                decoder, pending, raw_parts, has_raw = font, [], [], True
            pending.append(part)
            if raw is None:
                has_raw = False
            else:
                raw_parts.append(raw)
    flush()
    return ''.join(transformed)


def _join_page_runs(pieces, doc):
    if doc.zawcode_order:
        return _join_draft_runs(pieces, doc.zawcode_order)
    if doc.kind == 'font' and doc.visual_unicode_enabled:
        return _join_visual_runs(pieces, doc)
    return ''.join(piece[2] for piece in pieces)

def extract_page_lines(objects, page_num, page_gen, decoding, detect_columns=False, *, used_myanmar_fonts=None, used_legacy_fonts=None, image_records=None, diagnostics=None):
    """Extract text lines WITH layout: ``(lines, page_w, page_h)``.

    ``lines`` is a top-to-bottom list of ``(x, y, size, text, font)`` where x/y are
    PDF points (y measured from the page BOTTOM, as in the PDF user space) and
    size is the Tf font size — everything the exact-layout DOCX writer needs
    to reproduce the page; ``font`` is the base font name of the line's first
    shown run, which the markup stage turns into bold/italic (JS ``line[4]``).
    Page size comes from the (inherited) MediaBox.

    ``detect_columns`` enables the multi-column splitter (the gutter guard
    below). OFF by default: paragraph rewrap (short first piece + long
    continuation piece on one baseline) mimics a gutter, and telling them
    apart needs tracked x-advances (line widths) the regex parser does not
    collect yet. Verified against a synthetic two-column page; tune against
    real samples before turning it on.

    ``decoding`` is the document-level fallback strategy
    (:class:`pdf_fonts.DocumentDecoding`); a bare map or the ``IDENTITY``
    sentinel is still accepted and wrapped. It is NOT applied to the page as a
    whole: each ``/Font`` resource of the page gets its own decoder and the
    ``Tf`` operator decides which one every shown string goes through.
    """
    doc = as_document_decoding(decoding)
    loader = _document_loader(doc, objects)
    decoders = page_font_decoders(loader, page_num, page_gen, doc)
    unset_font = _UnsetFontDecoder("", doc=doc)

    page = loader.resolve(Ref(page_num, page_gen))
    def content_refs(value, depth=0):
        if depth > 32:
            raise ValueError('PDF contents reference nesting is too deep')
        if isinstance(value, Ref):
            item = loader.object_value(value)
            if isinstance(item, list):
                yield from content_refs(item, depth + 1)
            else:
                yield value
        elif isinstance(value, list):
            for item in value:
                yield from content_refs(item, depth + 1)

    refs = list(content_refs(page.get('Contents') if isinstance(page, dict) else None))
    pieces = []  # list of (y, x, size, text, optional font runs)
    previous_diagnostic_run = None
    # Contents arrays form one logical stream, including mid-token boundaries.
    content = b''.join(_page_content_stream(loader, ref) for ref in refs)
    image_collector = None
    if image_records is not None:
        from myangustis_parser.extract.pdf_image_coverage import PageImageCollector
        image_collector = PageImageCollector(loader, page_num, page_gen, iter_content_operations)
    in_block = False
    active = None
    font_size = 12.0
    leading = 0.0
    line_matrix = (1., 0., 0., 1., 0., 0.)
    graphics = (1., 0., 0., 1., 0., 0.)
    saved_states = []
    block_texts, block_runs = [], []
    block_font = block_xy = block_size = None
    page_w, page_h = get_page_mediabox(objects, page_num, page_gen)
    media = page
    seen = set()
    page_left = 0.0
    for _ in range(32):
        if not isinstance(media, dict):
            break
        box = loader.resolve(media.get('MediaBox'))
        if (isinstance(box, list) and len(box) == 4
                and all(isinstance(v, (int, float)) for v in box)
                and box[0] != box[2] and box[1] != box[3]):
            page_left = min(box[0], box[2])
            break
        parent = media.get('Parent')
        if not isinstance(parent, Ref) or parent in seen:
            break
        seen.add(parent)
        media = loader.resolve(parent)
    grid_current, grid_pending, grid_rules = None, [], []
    has_table_rules = False

    def add_rule(target, a, b):
        low, high = sorted((a[1], b[1]))
        x = (a[0] + b[0]) / 2
        if (abs(a[0] - b[0]) <= 3 and high - low >= page_h * .2
                and page_left <= x <= page_left + page_w and len(target) < 32
                and not any(abs(rule[0] - x) < 3 for rule in target)):
            target.append((x, low, high))

    def consume_grid(op, operands):
        nonlocal grid_current, grid_pending, has_table_rules
        if has_table_rules or page_h <= 0 or page_w < page_h * 1.25:
            return
        def point(x, y):
            return (graphics[0]*x + graphics[2]*y + graphics[4],
                    graphics[1]*x + graphics[3]*y + graphics[5])
        if op == 're' and len(operands) >= 4 and all(isinstance(v, (int, float)) for v in operands[-4:]):
            x, y, w, h = operands[-4:]
            points = [point(x,y), point(x+w,y), point(x,y+h), point(x+w,y+h)]
            xs, ys = zip(*points)
            if max(xs) - min(xs) <= 3:
                add_rule(grid_pending, (min(xs), min(ys)), (max(xs), max(ys)))
        elif op in ('m', 'l') and len(operands) >= 2 and all(isinstance(v, (int, float)) for v in operands[-2:]):
            target = point(*operands[-2:])
            if op == 'l' and grid_current is not None:
                add_rule(grid_pending, grid_current, target)
            grid_current = target
        elif op in ('c', 'v', 'y'):
            grid_current = None
        elif op in ('n', 'S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*'):
            if op != 'n':
                for x, low, high in grid_pending:
                    add_rule(grid_rules, (x, low), (x, high))
                has_table_rules = any(sum(min(high, other[2]) - max(low, other[1]) >= page_h * .15
                                          for other in grid_rules) >= 4
                                      for _, low, high in grid_rules)
            grid_pending, grid_current = [], None

    def multiply(m, n):
        return (m[0]*n[0] + m[2]*n[1], m[1]*n[0] + m[3]*n[1],
                m[0]*n[2] + m[2]*n[3], m[1]*n[2] + m[3]*n[3],
                m[0]*n[4] + m[2]*n[5] + m[4], m[1]*n[4] + m[3]*n[5] + m[5])

    def position(matrix=None):
        matrix = line_matrix if matrix is None else matrix
        return (graphics[0]*matrix[4] + graphics[2]*matrix[5] + graphics[4],
                graphics[1]*matrix[4] + graphics[3]*matrix[5] + graphics[5])

    def flush_piece():
        nonlocal block_texts, block_runs, block_font, block_xy, block_size
        if block_texts and block_xy is not None:
            text = ''.join(block_texts)
            if doc.legacy_text_fix:
                text = _collapse_overprint(text)
            pieces.append((block_xy[1], block_xy[0], 12.0 if block_size is None else block_size,
                           text, block_runs if doc.zawcode_order or
                           (doc.kind == 'font' and doc.visual_unicode_enabled) else None,
                           block_font))
        block_texts, block_runs = [], []
        block_font = block_xy = block_size = None

    def move_line(next_matrix):
        nonlocal line_matrix
        if block_xy is not None:
            x, y = position(next_matrix)
            crosses_spread = (page_h > 0 and page_w >= page_h * 1.25
                              and (block_xy[0] < page_left + page_w / 2) != (x < page_left + page_w / 2))
            if abs(y - block_xy[1]) > 3 or crosses_spread:
                flush_piece()
        line_matrix = next_matrix

    def translate_line(dx, dy):
        a, b, c, d, e, f = line_matrix
        move_line((a, b, c, d, e + dx*a + dy*c, f + dx*b + dy*d))

    for op, operands in iter_content_operations(content):
        consume_grid(op, operands)
        if image_collector is not None:
            image_collector.consume(op, operands)
        # Flush before changing the graphics matrix, so old ink keeps its
        # original coordinates, just as in the JS content walker.
        if in_block and op in ('Q', 'cm'):
            flush_piece()
        if op == 'q':
            saved_states.append((graphics, active, font_size, leading))
            continue
        if op == 'Q':
            if saved_states:
                graphics, active, font_size, leading = saved_states.pop()
            continue
        if op == 'cm':
            if len(operands) >= 6 and all(isinstance(v, (int, float)) for v in operands[-6:]):
                graphics = multiply(graphics, tuple(float(v) for v in operands[-6:]))
            continue
        if op == 'Tf':
            if len(operands) >= 2 and isinstance(operands[-2], Name):
                active = decoders.get(str(operands[-2]))
            if operands and isinstance(operands[-1], (int, float)):
                font_size = float(operands[-1])
            continue
        if op == 'BT':
            if not in_block:
                in_block = True
                block_texts, block_runs = [], []
                block_font = block_xy = block_size = None
                line_matrix = (1., 0., 0., 1., 0., 0.)
            continue
        if not in_block:
            continue
        if op == 'Tm':
            if len(operands) >= 6 and all(isinstance(v, (int, float)) for v in operands[-6:]):
                move_line(tuple(float(v) for v in operands[-6:]))
            continue
        if op in ('Td', 'TD'):
            if len(operands) >= 2 and all(isinstance(v, (int, float)) for v in operands[-2:]):
                dx, dy = float(operands[-2]), float(operands[-1])
                if op == 'TD':
                    leading = -dy
                translate_line(dx, dy)
            continue
        if op == 'TL':
            if operands and isinstance(operands[-1], (int, float)):
                leading = float(operands[-1])
            continue
        if op == 'T*':
            translate_line(0, -leading)
            continue
        if op == 'ET':
            in_block = False
            flush_piece()
            continue
        if op in ('Tj', 'TJ', "'", '"'):
            if op in ("'", '"'):
                translate_line(0, -leading)
            decoder = active if active is not None else unset_font
            for shown in _shown_strings(op, operands):
                # JS records the original (unconfirmed) reading during
                # extraction; confirmed-run decoding remains available on
                # FontDecoder itself. Its current legacy page store does not
                # retain the confirmed alternative.
                stats = None
                if diagnostics is not None:
                    fonts = diagnostics['fonts']
                    # Resource names can be attacker-controlled; bound both count and length.
                    key = str(decoder.name or '<unset>')[:80]
                    if key not in fonts and len(fonts) >= 12:
                        key = '<other>'
                    stats = fonts.setdefault(key, {
                        'resource': key, 'base_font': str(decoder.base_font or '')[:120],
                        'subtype': str(decoder.subtype or '')[:40], 'cid': decoder.is_cid,
                        'to_unicode_entries': len(decoder.to_unicode or {}),
                        'encoding': decoder.has_encoding, 'own_gid_entries': len(decoder.own_gids or {}),
                        'legacy_map': bool(decoder.font_legacy_code_page),
                        'visual_recovery': bool(decoder.visual_unicode_glyphs),
                        'runs': 0, 'bytes': 0, 'decoded_chars': 0, 'myanmar_chars': 0, 'single_char_runs': 0,
                        'unmapped_codes': 0, 'fallback_bytes': 0, 'dropped_controls': 0})
                    stats['runs'] += 1
                    stats['bytes'] += len(shown)
                text = decoder.decode(shown, use_confirmed=False, stats=stats) if stats is not None else (
                    decoder.decode(shown, use_confirmed=False) if decoder.confirmed_raw_runs else decoder.decode(shown))
                if stats is not None:
                    stats['decoded_chars'] += len(text)
                    stats['myanmar_chars'] += sum('\u1000' <= c <= '\u109f' or '\uaa60' <= c <= '\uaa7f' or '\ua9e0' <= c <= '\ua9ff' for c in text)
                    stats['single_char_runs'] += len(text.strip()) == 1
                    if 4 <= len(text) <= 512 and previous_diagnostic_run == text:
                        diagnostics['adjacent_duplicate_runs'] += 1
                    previous_diagnostic_run = text if len(text) <= 512 else None
                    if diagnostics['sample_enabled']:
                        sample = diagnostics.get('decoded_sample', '')
                        diagnostics['decoded_sample'] = sample + text[:160 - len(sample)]
                if block_xy is None:
                    block_xy = position()
                effective_size = abs(font_size) * math.hypot(
                    graphics[0]*line_matrix[2] + graphics[2]*line_matrix[3],
                    graphics[1]*line_matrix[2] + graphics[3]*line_matrix[3])
                block_size = max(block_size or 0, effective_size)
                if (used_legacy_fonts is not None and text and
                        (decoder.font_legacy_code_page or decoder.confirmed_raw_runs
                         or is_unresolved_legacy_font(decoder.base_font))):
                    name = decoder.base_font or ''
                    if name not in used_legacy_fonts:
                        used_legacy_fonts.append(name)
                if used_myanmar_fonts is not None and (contains_myanmar(text)
                        or decoder.font_legacy_code_page or decoder.confirmed_raw_runs):
                    used_myanmar_fonts.add(decoder.base_font or '')
                if block_font is None and decoder.base_font:
                    block_font = decoder.base_font
                block_texts.append(text)
                if doc.zawcode_order:
                    block_runs.append((decoder.zawcode_glyphs is not None, text))
                elif doc.kind == 'font' and doc.visual_unicode_enabled:
                    block_runs.append((decoder, text, shown if decoder.visual_unicode_glyphs else None))

    if image_collector is not None:
        image_records.extend(image_collector.images)

    # PDF producers often draw the same glyph run several times with tiny
    # sub-point offsets to create a faux-bold/outline effect.  Those are visual
    # shadows, not five copies of the sentence.  Collapse exact decoded runs
    # that overlap, while retaining genuinely repeated text at different
    # locations.
    #
    # CONTAINMENT, not just equality. The overprint is not always a copy of
    # the whole run: this producer also re-draws a FRAGMENT of it, and a
    # fragment is not equal to anything, so it survived and was spliced back
    # into the middle of the line by the x-sort. One line carried
    #     x=306.72 'စပါး၏ ဆုိလုိရင်းအနက်မ'   x=403.26 'ှ'
    #     x=403.26 'ာ ‘ပူအုိက်စ'          x=306.92 'စပါး'  <- shadow
    # and assembled as အနက်မစပါးှာ instead of အနက်မှာ စပါး. The ±1pt box
    # still guards it: genuinely repeated text elsewhere on the line is
    # farther away than that.
    if diagnostics is not None:
        diagnostics['pieces_before_dedup'] = len(pieces)
        diagnostics['piece_chars_before_dedup'] = sum(len(p[3]) for p in pieces)
    unique_pieces = []
    for piece in pieces:
        y, x, size, text = piece[:4]
        drop = False
        # Empty but witnessed marks must survive deduplication.
        empty_visual = (not text and doc.kind == 'font' and doc.visual_unicode_enabled
                        and piece[4] and any(font.visual_unicode_glyphs and raw
                                             for font, _, raw in piece[4]))
        for k, existing in enumerate(unique_pieces):
            if empty_visual:
                break
            old_y, old_x, old_size, old_text = existing[:4]
            if abs(x - old_x) > 1.0 or abs(y - old_y) > 1.0:
                continue
            if text == old_text or text in old_text:
                drop = True            # same ink, or a fragment of it
                break
            if old_text and old_text in text:
                # the shadow arrived first: keep the longer, fuller run
                unique_pieces[k] = piece
                drop = True
                break
        if not drop:
            unique_pieces.append(piece)
    pieces = unique_pieces
    if diagnostics is not None:
        diagnostics['pieces_after_dedup'] = len(pieces)
        diagnostics['piece_chars_after_dedup'] = sum(len(p[3]) for p in pieces)

    page_w, page_h = get_page_mediabox(objects, page_num, page_gen)
    if not pieces:
        return [], page_w, page_h

    # ── multi-column guard ────────────────────────────────────────────────
    # A gutter only EXISTS where two columns share the same baseline band —
    # hanging indents and margin labels sit on their own baselines and are
    # already in reading order under the plain y-sort, so they must never
    # trigger a split. Gutter candidates therefore come ONLY from mixed
    # bands (left + right pieces on one baseline) with a wide internal gap;
    # a consistent candidate across enough mixed bands + balanced text mass
    # switches the page to column-major order. Every other page keeps the
    # single-column path below byte for byte.
    #
    # GATED OFF by default (detect_columns=False): paragraph rewrap produces
    # exactly this mixed-band pattern too, and without tracked x-advances
    # the two cannot be told apart reliably (test.pdf regressed). See the
    # docstring.
    bounds = []
    if not has_table_rules and page_h > 0 and page_w >= page_h * 1.25:
        middle = page_left + page_w / 2
        halves = [[], []]
        for piece in sorted(pieces, key=lambda p: (-p[0], p[1])):
            y, x, _, text = piece[:4]
            chars = len(text.strip(' '))
            if chars and page_left <= x <= page_left + page_w:
                half = halves[0 if x < middle else 1]
                if not half or abs(y - half[-1][0]) > 3:
                    half.append([y, 0])
                half[-1][1] += chars
        qualifying = [[y for y, chars in half if chars >= 20] for half in halves]
        if all(len(half) >= 5 and max(half) - min(half) >= page_h * .2 for half in qualifying):
            overlap = min(max(half) for half in qualifying) - max(min(half) for half in qualifying)
            if overlap >= page_h * .15:
                bounds = [middle]
    if detect_columns and not bounds:
        pieces.sort(key=lambda p: (-p[0], p[1]))
        mixed_bands = []
        cur, cur_y = [], pieces[0][0]
        for p in pieces:
            if abs(p[0] - cur_y) > 3:
                if len(cur) >= 2:
                    mixed_bands.append(cur)
                cur, cur_y = [], p[0]
            cur.append(p)
        if len(cur) >= 2:
            mixed_bands.append(cur)

        gutters = []
        for items in mixed_bands:
            items = sorted(items, key=lambda q: q[1])
            for a, b in zip(items, items[1:]):
                if b[1] - a[1] >= 14:
                    gutters.append((a[1] + b[1]) / 2)
        if gutters and len(mixed_bands) >= 5:
            gutters.sort()
            clusters = [[gutters[0]]]
            for g in gutters[1:]:
                if g - clusters[-1][-1] <= 15:
                    clusters[-1].append(g)
                else:
                    clusters.append([g])
            best = max(clusters, key=len)
            if len(best) >= max(5, int(0.5 * len(mixed_bands))):
                c = sum(best) / len(best)
                left = sum(len(piece[3]) for piece in pieces if piece[1] < c)
                right = sum(len(piece[3]) for piece in pieces if piece[1] >= c)
                tot = left + right
                if tot and 0.25 <= left / tot <= 0.75:
                    bounds = [c]

    if diagnostics is not None:
        diagnostics['columns'] = len(bounds) + 1
        diagnostics['table_rules'] = has_table_rules
    if bounds:
        lines = []
        for c in range(len(bounds) + 1):
            col_pieces = [p for p in pieces if sum(1 for b in bounds if p[1] >= b) == c]
            col_pieces.sort(key=lambda p: (-p[0], p[1]))
            cur_line, cur_y = [], None
            for y, x, size, text, runs, font in col_pieces:
                if cur_y is None or abs(y - cur_y) > 3:
                    if cur_line:
                        cur_line.sort(key=lambda p: p[0])   # x only; stable = stream order
                        _j = _join_page_runs(cur_line, doc)
                        if doc.legacy_text_fix:
                            _j = legacy_ayar_to_unicode(_j, apply_aa_vowel_rule=_aa_vowel_rule_for_legacy(doc))
                        lines.append((cur_line[0][0], cur_y,
                                      max(p[1] for p in cur_line), _j,
                                      _line_font(cur_line)))
                    cur_line, cur_y = [], y
                cur_line.append((x, size, text, runs, font))
            if cur_line:
                cur_line.sort(key=lambda p: p[0])   # x only; stable = stream order
                joined = _join_page_runs(cur_line, doc)
                if doc.legacy_text_fix:
                    joined = legacy_ayar_to_unicode(joined, apply_aa_vowel_rule=_aa_vowel_rule_for_legacy(doc))
                lines.append((cur_line[0][0], cur_y,
                              max(p[1] for p in cur_line), joined,
                              _line_font(cur_line)))
        return lines, page_w, page_h

    pieces.sort(key=lambda p: (-p[0], p[1]))

    lines = []          # (x, y, size, text), top-to-bottom
    current_y = pieces[0][0]
    current_line = []   # (x, size, text, optional font runs)

    def flush():
        # Sort by x ONLY, and rely on the sort being stable: two pieces drawn
        # at the same x keep content-stream order, which is the order the
        # producer wrote them in.
        #
        # This is what was dropping/moving medial ha (U+103E). The legacy face
        # draws a tall consonant's ha as its own BT..ET block placed at the x
        # of the NEXT block, so a line ends up as
        #     ... 'ရိ'(x=298) | 'ှ'(x=358) | 'သည်။'(x=358)
        # and a tie-break on the text put 'ှ' (U+103E) after 'သ' (U+101E),
        # stranding the ha at the end of the line: 'ရိသည်။ှ'. Stream order
        # puts it back on its base: 'ရှိသည်။'.
        ordered = sorted(current_line, key=lambda p: p[0])
        joined = _join_page_runs(ordered, doc)
        if doc.legacy_text_fix:
            joined = legacy_ayar_to_unicode(joined, apply_aa_vowel_rule=_aa_vowel_rule_for_legacy(doc))
        lines.append((ordered[0][0], current_y,
                      max(p[1] for p in ordered), joined, _line_font(ordered)))

    for y, x, size, text, runs, font in pieces:
        if abs(y - current_y) > 3:
            flush()
            current_line = []
            current_y = y
        current_line.append((x, size, text, runs, font))

    if current_line:
        flush()

    return lines, page_w, page_h


def extract_page_text_layout(objects, page_num, page_gen, decoding):
    """Extract text preserving PDF layout (line breaks from text positioning).

    Thin wrapper over :func:`extract_page_lines` returning just the joined
    text (identical output to the original implementation).
    """
    lines, _, _ = extract_page_lines(objects, page_num, page_gen, decoding)
    return '\n'.join(line[3] for line in lines)


# ═══════════════════════════════════════════════════════════════════════════
#  RASTER IMAGES — the OCR lane's input
# ═══════════════════════════════════════════════════════════════════════════
# A scanned page stores its pixels as an image XObject. Extracting that
# object is better than re-rendering the page: the scan is already at its
# native resolution, and rendering would resample it (and blur it) before
# OCR ever sees it.

def _dict_name(head: bytes, key: bytes):
    m = re.search(rb"/" + key + rb"\s*/([A-Za-z0-9._-]+)", head)
    return m.group(1).decode("latin-1") if m else None


def _dict_int(head: bytes, key: bytes, default=None):
    m = re.search(rb"/" + key + rb"\s+(\d+)", head)
    return int(m.group(1)) if m else default


def _dict_filters(head: bytes):
    m = re.search(rb"/Filter\s*(\[[^\]]*\]|/[A-Za-z0-9._-]+)", head)
    if not m:
        return []
    return [name.decode("latin-1") for name in re.findall(rb"/([A-Za-z0-9._-]+)", m.group(1))]


def _pdf_string(raw: bytes):
    """Decode a PDF literal or hex string (the /Indexed lookup table)."""
    raw = raw.strip()
    if raw.startswith(b"<"):
        digits = re.sub(rb"[^0-9A-Fa-f]", b"", raw)
        if len(digits) % 2:
            digits += b"0"
        return bytes.fromhex(digits.decode("ascii"))
    if raw.startswith(b"("):
        body = raw[1:raw.rfind(b")")]
        out, i = bytearray(), 0
        escapes = {b"n": 10, b"r": 13, b"t": 9, b"b": 8, b"f": 12,
                   b"(": 40, b")": 41, b"\\": 92}
        while i < len(body):
            ch = body[i:i + 1]
            if ch == b"\\" and i + 1 < len(body):
                nxt = body[i + 1:i + 2]
                if nxt in escapes:
                    out.append(escapes[nxt]); i += 2; continue
                octal = re.match(rb"[0-7]{1,3}", body[i + 1:])
                if octal:
                    out.append(int(octal.group(0), 8) & 0xFF); i += 1 + len(octal.group(0)); continue
                i += 2
                continue
            out.append(body[i]); i += 1
        return bytes(out)
    return b""


def _colorspace(head: bytes, objects):
    """``(kind, components, palette)`` for one image dictionary.

    ``kind`` is ``gray``/``rgb``/``cmyk``/``indexed``. Anything else returns
    ``None``: the OCR lane then falls back to rendering the page.
    """
    m = re.search(rb"/ColorSpace\s*(\[[^\]]*\]|/[A-Za-z0-9._-]+|\d+\s+\d+\s+R)", head)
    if not m:
        return None
    token = m.group(1).strip()

    if token.endswith(b"R"):
        ref = re.match(rb"(\d+)\s+(\d+)\s+R", token)
        target = objects.get((int(ref.group(1)), int(ref.group(2))), b"")
        target_head = target[:target.find(b"stream")] if b"stream" in target else target
        if re.search(rb"/ICCBased", target_head):
            n = _dict_int(target_head, b"N", 3)
            return ("gray", 1, None) if n == 1 else (
                ("rgb", 3, None) if n == 3 else ("cmyk", 4, None))
        return None

    if token.startswith(b"["):
        if re.search(rb"/Indexed", token):
            palette = _indexed_palette(token, objects)
            if palette is None:
                return None
            return ("indexed", 1, palette)
        if re.search(rb"/DeviceRGB", token):
            return ("rgb", 3, None)
        if re.search(rb"/DeviceGray", token):
            return ("gray", 1, None)
        if re.search(rb"/DeviceCMYK", token):
            return ("cmyk", 4, None)
        return None

    if b"DeviceGray" in token:
        return ("gray", 1, None)
    if b"DeviceRGB" in token:
        return ("rgb", 3, None)
    if b"DeviceCMYK" in token:
        return ("cmyk", 4, None)
    if b"CalRGB" in token:
        return ("rgb", 3, None)
    if b"CalGray" in token:
        return ("gray", 1, None)
    return None


def _indexed_palette(token: bytes, objects):
    """RGB palette bytes for an /Indexed colour space, or ``None``."""
    m = re.match(rb"\[\s*/Indexed\s+(\S+)\s+(\d+)\s+(<[^>]*>|\([\s\S]*\)|\d+\s+\d+\s+R)", token)
    if not m:
        return None
    base, _hival, lookup = m.group(1), int(m.group(2)), m.group(3)
    rgb = 3
    if base.startswith(b"/") and b"DeviceGray" in base:
        rgb = 1
    if lookup.endswith(b"R"):
        ref = re.match(rb"(\d+)\s+(\d+)\s+R", lookup)
        label = objects.get((int(ref.group(1)), int(ref.group(2))), b"")
        stream = get_stream(objects, int(ref.group(1)), int(ref.group(2))) or b""
        table = stream
    else:
        table = _pdf_string(lookup)
    if not table:
        return None
    if rgb == 3:
        return table
    # Gray palette -> replicate each entry across R, G and B.
    out = bytearray()
    for value in table:
        out += bytes((value, value, value))
    return bytes(out)


def page_images(objects, page_num, page_gen=0):
    """Raster image XObjects the page draws, largest pixel count first.

    Each entry is ``{"num", "gen", "width", "height", "bits", "filters",
    "colorspace"}``; the object body stays in ``objects`` so nothing is
    decompressed until :func:`decode_image` is asked for it.
    """
    page = objects.get((page_num, page_gen), b"")
    if not page:
        return []
    text = page.decode("latin-1", errors="replace")
    resources = text
    m = re.search(r"/Resources\s+(\d+)\s+\d+\s+R", text)
    if m:
        resources = objects.get((int(m.group(1)), 0), b"").decode("latin-1", errors="replace")
    mx = re.search(r"/XObject\s+(\d+)\s+\d+\s+R", resources)
    xobjects = (objects.get((int(mx.group(1)), 0), b"").decode("latin-1", errors="replace")
                if mx else resources)

    found = []
    for entry in re.finditer(r"/([A-Za-z0-9._-]+)\s+(\d+)\s+(\d+)\s+R", xobjects):
        num, gen = int(entry.group(2)), int(entry.group(3))
        body = objects.get((num, gen), b"")
        head = body[:body.find(b"stream")] if b"stream" in body else body
        if not re.search(rb"/Subtype\s*/Image", head):
            continue
        width = _dict_int(head, b"Width", 0)
        height = _dict_int(head, b"Height", 0)
        found.append({
            "name": entry.group(1),
            "num": num, "gen": gen,
            "width": width, "height": height,
            "bits": _dict_int(head, b"BitsPerComponent", 8),
            "filters": _dict_filters(head),
            "colorspace": _colorspace(head, objects),
        })
    found.sort(key=lambda item: item["width"] * item["height"], reverse=True)
    return found


def _ppm(kind, width, height, samples):
    """Wrap raw 8-bit samples as a binary PPM (P6) or PGM (P5)."""
    if kind == "gray":
        return b"P5\n%d %d\n255\n" % (width, height) + samples
    return b"P6\n%d %d\n255\n" % (width, height) + samples


def _cmyk_to_rgb(samples):
    out = bytearray()
    for i in range(0, len(samples) - 3, 4):
        c, m, y, k = samples[i], samples[i + 1], samples[i + 2], samples[i + 3]
        out += bytes(((255 - c) * (255 - k) // 255,
                      (255 - m) * (255 - k) // 255,
                      (255 - y) * (255 - k) // 255))
    return bytes(out)


def decode_image(objects, image, *, max_pixels=None):
    """Return ``(bytes, suffix)`` for an image XObject, or ``None``.

    DCT (JPEG) and JPX payloads pass through untouched — re-encoding a scan
    only loses quality. Flate/raw samples are wrapped as PPM/PGM. A filter
    this module cannot unwrap (CCITT, LZW, JBIG2) returns ``None`` so the
    caller can fall back to a page renderer.
    """
    width, height = image.get("width") or 0, image.get("height") or 0
    if width <= 0 or height <= 0:
        return None
    if max_pixels and width * height > max_pixels:
        raise ValueError(f"image is {width}x{height}; exceeds the {max_pixels} pixel cap")

    filters = [name.lower() for name in image.get("filters") or ()]
    if "dctdecode" in filters:
        data = get_stream(objects, image["num"], image["gen"])
        return (data, ".jpg") if data else None
    if "jpxdecode" in filters:
        data = get_stream(objects, image["num"], image["gen"])
        return (data, ".jp2") if data else None
    if any(name in filters for name in ("ccittfaxdecode", "jbig2decode", "lzwdecode")):
        return None

    colorspace = image.get("colorspace")
    if colorspace is None:
        return None
    kind, components, palette = colorspace
    if image.get("bits", 8) != 8:
        return None
    data = get_stream(objects, image["num"], image["gen"])
    if not data:
        return None

    if kind == "indexed":
        if palette is None:
            return None
        rgb = bytearray()
        for value in data:
            base = value * 3
            if base + 2 >= len(palette):
                break
            rgb += palette[base:base + 3]
        return _ppm("rgb", width, height, bytes(rgb[:width * height * 3])), ".ppm"

    needed = width * height * components
    samples = data[:needed]
    if len(samples) < needed:
        return None
    if kind == "cmyk":
        return _ppm("rgb", width, height, _cmyk_to_rgb(samples)), ".ppm"
    return _ppm("gray" if kind == "gray" else "rgb", width, height, samples), \
        ".pgm" if kind == "gray" else ".ppm"


def page_image_bytes(objects, page_num, page_gen=0, *, max_pixels=None, log=lambda m: None):
    """Best raster image for a page, decoded: ``(bytes, suffix)`` or ``None``."""
    for image in page_images(objects, page_num, page_gen):
        try:
            decoded = decode_image(objects, image, max_pixels=max_pixels)
        except ValueError:
            raise
        except Exception as exc:  # noqa: BLE001 - one bad image must not kill the page
            log(f"[i] image {image['name']} could not be decoded: {exc}")
            continue
        if decoded:
            return decoded
    return None
