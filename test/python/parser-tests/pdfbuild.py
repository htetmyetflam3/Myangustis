"""Tiny synthetic-PDF builder used by the parser tests.

Real PDF bytes go in, so the tests exercise the whole chain the CLI uses:
``parse_pdf_objects`` -> page tree -> ``/Resources`` -> ``/Font`` ->
per-resource decoder -> content-stream walk.

Nothing here is specific to any sample document: the caller describes the
objects it wants and gets a byte string back.
"""

import struct
import zlib


def build_pdf(objects, root=1, compress=False):
    """Serialise ``{obj number: body}`` into a loadable PDF byte string.

    ``body`` is either ``bytes`` (a raw object body) or a
    ``(dict_bytes, stream_bytes)`` pair, which is written as a stream object.
    """
    out = bytearray(b"%PDF-1.7\n")
    for num in sorted(objects):
        body = objects[num]
        out += b"%d 0 obj\n" % num
        if isinstance(body, tuple):
            head, data = body
            if compress:
                data = zlib.compress(data)
                head = head.rstrip()[:-2] + b" /Filter /FlateDecode >>"
            head = head.rstrip()[:-2] + b" /Length %d >>" % len(data)
            out += head + b"\nstream\n" + data + b"\nendstream"
        else:
            out += body
        out += b"\nendobj\n"
    out += b"trailer\n<< /Root %d 0 R >>\n%%%%EOF\n" % root
    return bytes(out)


def simple_page_pdf(font_objects, content, fonts=None, extra=None,
                    mediabox=b"[0 0 612 792]", compress=False):
    """One-page PDF whose ``/Font`` resource dict points at ``font_objects``.

    ``font_objects`` maps a resource name (``"F1"``) to an object number;
    ``fonts`` maps object numbers to object bodies.
    """
    res = b" ".join(b"/%s %d 0 R" % (name.encode(), num)
                    for name, num in font_objects.items())
    objects = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        2: b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        3: (b"<< /Type /Page /Parent 2 0 R /MediaBox " + mediabox +
            b" /Resources << /Font << " + res + b" >> >> /Contents 4 0 R >>"),
        4: (b"<< >>", content),
    }
    objects.update(fonts or {})
    objects.update(extra or {})
    return build_pdf(objects)


def truetype_with_cmap(mapping):
    """A minimal TrueType font program carrying only a format-4 ``cmap``.

    ``mapping`` is ``{unicode code point: glyph id}`` — exactly what
    ``parse_ttf_cmap`` reads back, and therefore what the parser reverses into
    its glyph-id -> Unicode map.
    """
    codes = sorted(c for c in mapping if 0 <= c <= 0xFFFE)
    segs = [(c, c, (mapping[c] - c) & 0xFFFF) for c in codes]
    segs.append((0xFFFF, 0xFFFF, 1))
    seg_count = len(segs)

    sub = bytearray()
    sub += struct.pack(">HHH", 4, 16 + seg_count * 8, 0)
    entry_selector = max(0, (seg_count.bit_length() - 1))
    sub += struct.pack(">HHHH", seg_count * 2, (2 ** entry_selector) * 2,
                       entry_selector, seg_count * 2 - (2 ** entry_selector) * 2)
    sub += b"".join(struct.pack(">H", e) for _, e, _ in segs)
    sub += struct.pack(">H", 0)
    sub += b"".join(struct.pack(">H", s) for s, _, _ in segs)
    sub += b"".join(struct.pack(">h", d - 0x10000 if d > 0x7FFF else d)
                    for _, _, d in segs)
    sub += b"".join(struct.pack(">H", 0) for _ in segs)

    cmap = bytearray(struct.pack(">HHHHI", 0, 1, 3, 1, 12))
    cmap += sub

    num_tables = 1
    header = struct.pack(">IHHHH", 0x00010000, num_tables, 16, 0, 0)
    table_off = len(header) + 16 * num_tables
    record = b"cmap" + struct.pack(">III", 0, table_off, len(cmap))
    return bytes(header + record + bytes(cmap))
