"""Synthetic GSUB fixtures: local font recovery, not cross-font guessing."""
import struct
import unittest
from pdfbuild import truetype_with_cmap, simple_page_pdf
from myangustis_parser.extract.ttf_gsub import parse_gsub, resolve_shaped_glyphs
from myangustis_parser.extract.pdf_fonts import FontResourceLoader, Ref
from myangustis_parser.extract.pdf_extract import parse_ttf_cmap


def u16(*values):
    return struct.pack('>' + 'H' * len(values), *values)


def coverage(glyphs):
    return u16(1, len(glyphs), *glyphs)


def single(inputs, outputs):
    return u16(2, 6 + len(outputs) * 2, len(outputs), *outputs) + coverage(inputs)


def ligature(first, result, components):
    # one covered base; one set; one ligature
    item = u16(result, len(components) + 1, *components)
    ligset = u16(1, 4) + item
    return u16(1, 8 + len(ligset), 1, 8) + ligset + coverage([first])


def multiple(base, variants):
    # One lookup subtable, one sequence per same base; encoded as separate
    # subtables by the caller, as coverage glyphs are unique per subtable.
    seq = u16(len(variants), *variants)
    return u16(1, 8 + len(seq), 1, 8) + seq + coverage([base])


def font_with_gsub(lookups):
    lookup_entries = []
    for kind, subtables in lookups:
        offset = 6 + 2 * len(subtables)
        offsets = []
        for sub in subtables:
            offsets.append(offset)
            offset += len(sub)
        lookup_entries.append(u16(kind, 0, len(subtables), *offsets) + b''.join(subtables))
    offset = 2 + 2 * len(lookup_entries)
    offsets = []
    for lookup in lookup_entries:
        offsets.append(offset)
        offset += len(lookup)
    listing = u16(len(lookup_entries), *offsets) + b''.join(lookup_entries)
    gsub = struct.pack('>IHHH', 0x00010000, 0, 0, 10) + listing
    # Single-table sfnt; the GSUB parser needs no glyph outlines.
    return struct.pack('>IHHHH', 0x10000, 1, 16, 0, 0) + b'GSUB' + struct.pack('>III', 0, 28, len(gsub)) + gsub


def with_cmap(gsub_font, mapping):
    cmap_font = truetype_with_cmap(mapping)
    cmap = cmap_font[28:]
    gsub = gsub_font[28:]
    header = struct.pack('>IHHHH', 0x10000, 2, 32, 1, 0)
    start = 12 + 2 * 16
    return (header + b'cmap' + struct.pack('>III', 0, start, len(cmap))
            + b'GSUB' + struct.pack('>III', 0, start + len(cmap), len(gsub))
            + cmap + gsub)


class GsubTests(unittest.TestCase):
    def test_single_and_ligature_chain(self):
        font = font_with_gsub([(1, [single([1], [3])]), (4, [ligature(3, 4, [2])])])
        reverse, variants = parse_gsub(font)
        self.assertEqual(reverse, {4: [3, 2], 3: [1]})
        self.assertEqual(variants, [])
        self.assertEqual(resolve_shaped_glyphs(font, {1: 0x1000, 2: 0x103a})[4], 'က်')

    def test_variant_propagates_only_when_unambiguous(self):
        font = font_with_gsub([(1, [single([1], [3])]),
            (2, [multiple(1, [1, 10]), multiple(1, [1, 11])])])
        _, variants = parse_gsub(font)
        self.assertEqual(variants, [[10, 11]])
        table = resolve_shaped_glyphs(font, {1: 0x1000, 10: 0x103b})
        self.assertEqual(table[11], 0x103b)

    def test_synthetic_pdf_decodes_shaped_glyph_from_its_font(self):
        from test_pdf_page_routing import pages
        program = with_cmap(font_with_gsub([(1, [single([1], [3])]),
                                           (4, [ligature(3, 4, [2])])]),
                            {0x1000: 1, 0x103a: 2})
        fonts = {10: b'<< /Type /Font /Subtype /Type0 /BaseFont /Test /Encoding /Identity-H /DescendantFonts [11 0 R] >>',
                 11: b'<< /Type /Font /Subtype /CIDFontType2 /CIDToGIDMap /Identity /FontDescriptor 12 0 R >>',
                 12: b'<< /Type /FontDescriptor /FontFile2 13 0 R >>',
                 13: (b'<< >>', program)}
        content = b'BT /F 12 Tf 1 0 0 1 10 700 Tm <0004> Tj ET'
        output, _ = pages(simple_page_pdf({'F': 10}, content, fonts=fonts))
        self.assertEqual(output[0]['text'], 'က်')

    def test_no_evidence_or_a_cycle_does_not_invent_a_value(self):
        font = font_with_gsub([(1, [single([1, 3], [3, 1])])])
        self.assertEqual(resolve_shaped_glyphs(font, {}), {})
        self.assertEqual(resolve_shaped_glyphs(b'not a font', {1: 65}), {1: 65})

    def test_loader_uses_gsub_from_its_own_embedded_resource(self):
        # Inject cmap parser to exercise the real resource-loader integration.
        font = font_with_gsub([(1, [single([1], [3])]), (4, [ligature(3, 4, [2])])])
        loader = FontResourceLoader({}, lambda objects, num, gen: font,
                                    lambda data: {0x1000: 1, 0x103a: 2}, lambda data: {})
        table = loader.reversed_font_cmap({'FontFile2': Ref(8, 0)})
        self.assertEqual(table[4], 'က်')
        self.assertNotIn(4, table.direct)


if __name__ == '__main__': unittest.main()
