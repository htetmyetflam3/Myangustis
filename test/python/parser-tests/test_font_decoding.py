"""Regression tests: PDF text decoding must be FONT-SPECIFIC.

The bug these guard against: the parser used to reverse one embedded font's
``cmap`` into a single glyph-id -> Unicode map and decode every text run on
every page through it. A page that mixes a Myanmar ``/Identity-H`` resource
with a Latin ``/WinAnsiEncoding`` resource — which is normal, and happens even
when both resources point at the SAME embedded font program — then had its
Latin character codes reinterpreted as Myanmar glyph ids.

Run:  python3 -m unittest discover -s .bin/python/parser-tests -v
"""

import os
import sys
import unittest

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "Parser", "main", "Python", "modules"))
sys.path.insert(0, _HERE)

from pdfbuild import build_pdf, simple_page_pdf, truetype_with_cmap  # noqa: E402

import pdf_extract as PE
import cleanup                                                       # noqa: E402
import scan                                                          # noqa: E402
import pipeline                                                      # noqa: E402                                             # noqa: E402
from pdf_fonts import (                                              # noqa: E402
    LEGACY_CODE_PAGES,                                              # noqa: E402
    CmapIdentityMap,
    DocumentDecoding,
    FontResourceLoader,
    IDENTITY,
    LegacyAyarMap,
    Name,
    Ref,
    build_simple_encoding,
    glyph_name_to_unicode,
    page_font_decoders,
    parse_object,
    scan_literal_string,
)


TITLE = "God of Slaughter"


def extract(pdf_bytes, decoding, page_index=0):
    """Extract one page of a synthetic PDF; return its joined text."""
    objects = PE.parse_pdf_objects(pdf_bytes)
    pages = PE.collect_pages(objects, PE.find_root_pages(objects))
    pnum, pgen = pages[page_index]
    lines, _, _ = PE.extract_page_lines(objects, pnum, pgen, decoding)
    return "\n".join(t for _, _, _, t in lines)


def lines_of(pdf_bytes, decoding, page_index=0):
    objects = PE.parse_pdf_objects(pdf_bytes)
    pages = PE.collect_pages(objects, PE.find_root_pages(objects))
    pnum, pgen = pages[page_index]
    return PE.extract_page_lines(objects, pnum, pgen, decoding)[0]


# ── shared fixture pieces ────────────────────────────────────────────────
# One embedded font program shared by a Myanmar resource and a Latin one —
# the arrangement the sample book ships. Its cmap holds Latin glyphs at the
# LOW glyph ids and Myanmar glyphs at high ones, so the ASCII codes of 'G'
# (0x47 = 71) and 'S' (0x53 = 83) land exactly on the glyph ids of 'd' and
# 'p'. Reading a Latin code as a glyph id is what produced "dod of plaughter".
LATIN_GID = {"d": 71, "p": 83, "G": 42, "S": 50}
MYANMAR_GID = {"\u1000": 2072, "\u1001": 2073, "\u1015": 2074}

MYANMAR_CMAP = dict(
    [(ord(ch), gid) for ch, gid in LATIN_GID.items()] +
    [(ord(ch), gid) for ch, gid in MYANMAR_GID.items()]
)

# The document-level fallback the pipeline builds: the reversed cmap, keyed by
# GLYPH ID. Note it has entries at 71 and 83 — applying it to Latin character
# codes is precisely the corruption these tests guard against.
MYANMAR_GID_MAP = {gid: ord(ch) for ch, gid in
                   list(LATIN_GID.items()) + list(MYANMAR_GID.items())}

# A hostile variant: glyph ids 71 and 83 carry MYANMAR here, so a blanket
# "decode every code through this map" turns 'G'/'S' into Myanmar letters.
COLLIDING_GID_MAP = dict(MYANMAR_GID_MAP)
COLLIDING_GID_MAP[71] = 0x1000
COLLIDING_GID_MAP[83] = 0x1001

CID_K = b"0818"      # CID 2072 -> glyph 2072 -> \u1000
CID_KH = b"0819"     # CID 2073 -> glyph 2073 -> \u1001


def cmap_strategy(mapping=None):
    """A fresh "reversed embedded cmap" document strategy.

    Always a new instance: a DocumentDecoding caches decoders by PDF object
    number, which only identifies a font inside ONE document.
    """
    return DocumentDecoding(
        "cmap", CmapIdentityMap(MYANMAR_GID_MAP if mapping is None else mapping))


def _cid_font_objects(first=10, tounicode=None, cmap_mapping=None,
                      cid_to_gid=None):
    """Objects for a Type0 /Identity-H font (+ descendant + font program)."""
    objs = {
        first: (b"<< /Type /Font /Subtype /Type0 /BaseFont /AAAAAA+Test "
                b"/Encoding /Identity-H /DescendantFonts [%d 0 R] %s>>"
                % (first + 1,
                   b"/ToUnicode %d 0 R " % (first + 4) if tounicode else b"")),
        first + 1: (b"<< /Type /Font /Subtype /CIDFontType2 /BaseFont /AAAAAA+Test "
                    b"/CIDToGIDMap %s /FontDescriptor %d 0 R >>"
                    % (b"%d 0 R" % (first + 5) if cid_to_gid else b"/Identity",
                       first + 2)),
        first + 2: (b"<< /Type /FontDescriptor /FontName /AAAAAA+Test "
                    b"/FontFile2 %d 0 R >>" % (first + 3)),
        first + 3: (b"<< >>", truetype_with_cmap(cmap_mapping or MYANMAR_CMAP)),
    }
    if tounicode:
        objs[first + 4] = (b"<< >>", tounicode)
    if cid_to_gid:
        objs[first + 5] = (b"<< >>", cid_to_gid)
    return objs


def _simple_font(num, encoding=b"/WinAnsiEncoding", descriptor=None,
                 tounicode=None, extra=b""):
    body = (b"<< /Type /Font /Subtype /TrueType /BaseFont /AAAAAA+Test "
            + (b"/Encoding " + encoding + b" " if encoding else b"")
            + (b"/FontDescriptor %d 0 R " % descriptor if descriptor else b"")
            + (b"/ToUnicode %d 0 R " % tounicode if tounicode else b"")
            + extra + b">>")
    return {num: body}


class TwoResourcesOneCodeTest(unittest.TestCase):
    """1. The same numeric code must decode differently per active font."""

    def setUp(self):
        fonts = _cid_font_objects(10)
        fonts.update(_simple_font(20))
        # The SAME numeric code 0x47 twice: once inside a two-byte CID under
        # the Myanmar resource, once as the character code of 'G' under the
        # Latin one.
        content = (b"BT /F1 12 Tf 1 0 0 1 72 700 Tm <" + CID_K + b"> Tj ET\n"
                   b"BT /F2 12 Tf 1 0 0 1 72 680 Tm (G) Tj ET\n")
        self.pdf = simple_page_pdf({"F1": 10, "F2": 20}, content, fonts=fonts)

    def test_same_code_decodes_per_active_font(self):
        text = extract(self.pdf, cmap_strategy())
        myanmar_line, latin_line = text.split("\n")
        self.assertEqual(latin_line, "G")
        self.assertEqual(myanmar_line, "\u1000")
        self.assertNotEqual(myanmar_line, latin_line)

    def test_one_code_two_fonts_two_results(self):
        """Code 0x47 under each resource, byte for byte."""
        fonts = _cid_font_objects(10)
        fonts.update(_simple_font(20))
        content = (b"BT /F1 12 Tf 1 0 0 1 72 700 Tm <0047> Tj ET\n"
                   b"BT /F2 12 Tf 1 0 0 1 72 680 Tm (G) Tj ET\n")
        pdf = simple_page_pdf({"F1": 10, "F2": 20}, content, fonts=fonts)
        cid_line, latin_line = extract(pdf, cmap_strategy()).split("\n")
        self.assertEqual(latin_line, "G")
        # CID 0x47 is glyph 71 for the composite font: the Latin 'd' glyph.
        self.assertEqual(cid_line, "d")
        self.assertNotEqual(cid_line, latin_line)

    def test_latin_run_is_not_touched_by_the_myanmar_map(self):
        text = extract(self.pdf, cmap_strategy())
        self.assertNotIn("d", text)          # glyph 71 reversed = 'd'
        self.assertNotIn("p", text)          # glyph 83 reversed = 'p'


class WinAnsiLiteralStringTest(unittest.TestCase):
    """2. Latin /WinAnsiEncoding text written as a literal string."""

    def test_literal_string_decodes_exactly(self):
        fonts = _cid_font_objects(10)
        fonts.update(_simple_font(20))
        content = (b"BT /F2 12 Tf 1 0 0 1 72 700 Tm (" +
                   TITLE.encode("ascii") + b") Tj ET\n")
        pdf = simple_page_pdf({"F1": 10, "F2": 20}, content, fonts=fonts)
        self.assertEqual(extract(pdf, cmap_strategy()), TITLE)

    def test_literal_strings_are_still_font_decoded_not_copied(self):
        """A custom-encoded literal string must NOT be passed through raw."""
        fonts = _simple_font(20, encoding=(
            b"<< /Type /Encoding /BaseEncoding /WinAnsiEncoding "
            b"/Differences [71 /uni1000 83 /uni1001] >>"))
        content = b"BT /F2 12 Tf 1 0 0 1 72 700 Tm (GS) Tj ET\n"
        pdf = simple_page_pdf({"F2": 20}, content, fonts=fonts)
        # Codes 71 and 83 ARE 'G' and 'S' in WinAnsi, but this font overrides
        # them: a literal string is decoded through the font, never copied.
        self.assertEqual(extract(pdf, cmap_strategy()), "\u1000\u1001")


class WinAnsiHexStringTest(unittest.TestCase):
    """3. The same Latin text written as a hexadecimal string."""

    def test_hex_string_decodes_exactly(self):
        fonts = _cid_font_objects(10)
        fonts.update(_simple_font(20))
        hexed = TITLE.encode("ascii").hex().upper().encode()
        content = (b"BT /F2 12 Tf 1 0 0 1 72 700 Tm <" + hexed + b"> Tj ET\n")
        pdf = simple_page_pdf({"F1": 10, "F2": 20}, content, fonts=fonts)
        self.assertEqual(extract(pdf, cmap_strategy()), TITLE)

    def test_simple_font_hex_is_one_byte_per_code(self):
        """<47> under a simple font is 'G', not CID 0x47xx."""
        fonts = _simple_font(20)
        content = b"BT /F2 12 Tf 1 0 0 1 72 700 Tm <4753> Tj ET\n"
        pdf = simple_page_pdf({"F2": 20}, content, fonts=fonts)
        self.assertEqual(extract(pdf, cmap_strategy()), "GS")


class CollidingGlyphIdsTest(unittest.TestCase):
    """4. A Myanmar cmap with glyph ids 71 and 83 must not move Latin G/S."""

    def test_collision_is_present_in_the_fixture(self):
        # The glyph ids of 'd' and 'p' are the numeric values of 'G' and 'S'.
        self.assertEqual(LATIN_GID["d"], ord("G"))         # 71
        self.assertEqual(LATIN_GID["p"], ord("S"))         # 83
        self.assertIn(71, MYANMAR_GID_MAP)
        self.assertIn(83, MYANMAR_GID_MAP)
        self.assertEqual(COLLIDING_GID_MAP[71], 0x1000)
        self.assertEqual(COLLIDING_GID_MAP[83], 0x1001)

    def test_latin_survives_the_colliding_map(self):
        """Glyph ids 71/83 carry Myanmar; 'G' and 'S' must still be 'G','S'."""
        fonts = _cid_font_objects(10)
        fonts.update(_simple_font(20))
        content = (b"BT /F1 12 Tf 1 0 0 1 72 700 Tm <" + CID_K + CID_KH +
                   b"> Tj ET\n"
                   b"BT /F2 12 Tf 1 0 0 1 72 680 Tm (GS) Tj ET\n")
        pdf = simple_page_pdf({"F1": 10, "F2": 20}, content, fonts=fonts)
        strategy = cmap_strategy(COLLIDING_GID_MAP)
        myanmar_line, latin_line = extract(pdf, strategy).split("\n")
        self.assertEqual(latin_line, "GS")
        # ...and the Myanmar resource still recovers Myanmar.
        self.assertEqual(myanmar_line, "\u1000\u1001")

    def test_document_map_alone_would_have_corrupted_it(self):
        """The fixture really does reproduce the original failure mode."""
        from pdf_fonts import map_code
        blanket = CmapIdentityMap(MYANMAR_GID_MAP)
        self.assertEqual(map_code(blanket, ord("G")), "d")
        self.assertEqual(map_code(blanket, ord("S")), "p")
        self.assertEqual(
            "".join(map_code(blanket, c) for c in b"God of Slaughter"),
            "dod of plaughter")


class Type0MyanmarTest(unittest.TestCase):
    """5. The CID paths still recover Myanmar text."""

    def test_identity_h_via_reversed_font_cmap(self):
        fonts = _cid_font_objects(10)
        content = (b"BT /F1 12 Tf 1 0 0 1 72 700 Tm <" + CID_K + CID_KH +
                   b"> Tj ET\n")
        pdf = simple_page_pdf({"F1": 10}, content, fonts=fonts)
        self.assertEqual(extract(pdf, cmap_strategy()), "\u1000\u1001")

    def test_identity_h_uses_the_resource_own_font_program(self):
        """Two CID resources, two font programs, same CID -> two results."""
        fonts = _cid_font_objects(10, cmap_mapping={0x1000: 5})
        fonts.update(_cid_font_objects(20, cmap_mapping={0x1015: 5}))
        content = (b"BT /F1 12 Tf 1 0 0 1 72 700 Tm <0005> Tj ET\n"
                   b"BT /F2 12 Tf 1 0 0 1 72 680 Tm <0005> Tj ET\n")
        pdf = simple_page_pdf({"F1": 10, "F2": 20}, content, fonts=fonts)
        first, second = extract(pdf, cmap_strategy({})).split("\n")
        self.assertEqual(first, "\u1000")
        self.assertEqual(second, "\u1015")

    def test_identity_h_via_font_own_tounicode(self):
        tu = (b"/CIDInit /ProcSet findresource begin begincmap\n"
              b"1 begincodespacerange <0000> <FFFF> endcodespacerange\n"
              b"2 beginbfchar <0005> <1000> <0006> <1001> endbfchar\n"
              b"endcmap end")
        fonts = _cid_font_objects(10, tounicode=tu)
        content = b"BT /F1 12 Tf 1 0 0 1 72 700 Tm <00050006> Tj ET\n"
        pdf = simple_page_pdf({"F1": 10}, content, fonts=fonts)
        # 'tounicode' strategy trusts the font's own map.
        self.assertEqual(extract(pdf, DocumentDecoding("tounicode", {})),
                         "\u1000\u1001")

    def test_identity_h_direct_decode(self):
        fonts = _cid_font_objects(10)
        content = b"BT /F1 12 Tf 1 0 0 1 72 700 Tm <10001001> Tj ET\n"
        pdf = simple_page_pdf({"F1": 10}, content, fonts=fonts)
        self.assertEqual(extract(pdf, DocumentDecoding("identity")),
                         "\u1000\u1001")

    def test_cid_to_gid_map_stream_is_respected(self):
        # CID 1 -> GID 2072, CID 2 -> GID 2073
        cid2gid = b"\x00\x00\x08\x18\x08\x19"
        fonts = _cid_font_objects(10, cid_to_gid=cid2gid)
        content = b"BT /F1 12 Tf 1 0 0 1 72 700 Tm <00010002> Tj ET\n"
        pdf = simple_page_pdf({"F1": 10}, content, fonts=fonts)
        self.assertEqual(extract(pdf, cmap_strategy()), "\u1000\u1001")

    def test_unmapped_cid_becomes_placeholder(self):
        fonts = _cid_font_objects(10)
        content = b"BT /F1 12 Tf 1 0 0 1 72 700 Tm <0001> Tj ET\n"
        pdf = simple_page_pdf({"F1": 10}, content, fonts=fonts)
        self.assertEqual(extract(pdf, DocumentDecoding("cmap", {})), "[0001]")

    def test_embedded_cmap_stream_sets_the_code_width(self):
        cmap_stream = (b"/CIDInit /ProcSet findresource begin begincmap\n"
                       b"1 begincodespacerange <00> <FF> endcodespacerange\n"
                       b"1 begincidrange <41> <42> 2072 endcidrange\n"
                       b"endcmap end")
        fonts = {
            10: (b"<< /Type /Font /Subtype /Type0 /BaseFont /AAAAAA+Test "
                 b"/Encoding 16 0 R /DescendantFonts [11 0 R] >>"),
            11: (b"<< /Type /Font /Subtype /CIDFontType2 /CIDToGIDMap /Identity "
                 b"/FontDescriptor 12 0 R >>"),
            12: b"<< /Type /FontDescriptor /FontFile2 13 0 R >>",
            13: (b"<< >>", truetype_with_cmap(MYANMAR_CMAP)),
            16: (b"<< /Type /CMap >>", cmap_stream),
        }
        content = b"BT /F1 12 Tf 1 0 0 1 72 700 Tm <4142> Tj ET\n"
        pdf = simple_page_pdf({"F1": 10}, content, fonts=fonts)
        # ONE-byte codes, as the codespacerange declares: 0x41 -> CID 2072,
        # 0x42 -> CID 2073. Read as two-byte codes this would be a single
        # CID 0x4142 and decode to nothing.
        self.assertEqual(extract(pdf, cmap_strategy()), "\u1000\u1001")


class ActiveFontStateTest(unittest.TestCase):
    """6. Tf persists across BT...ET; a title block need not repeat it."""

    def test_font_selected_in_an_earlier_block_still_applies(self):
        fonts = _cid_font_objects(10)
        fonts.update(_simple_font(20))
        content = (b"BT /F1 14 Tf 1 0 0 1 72 720 Tm <" + CID_K + b"> Tj ET\n"
                   b"BT /F2 14 Tf 1 0 0 1 200 720 Tm ( ) Tj ET\n"
                   b"BT 1 0 0 1 72 700 Tm (" + TITLE.encode() + b") Tj ET\n")
        pdf = simple_page_pdf({"F1": 10, "F2": 20}, content, fonts=fonts)
        text = extract(pdf, cmap_strategy())
        self.assertIn(TITLE, text)
        self.assertNotIn("dod of plaughter", text)

    def test_font_state_survives_a_content_stream_boundary(self):
        fonts = _cid_font_objects(10)
        fonts.update(_simple_font(20))
        objects = {
            1: b"<< /Type /Catalog /Pages 2 0 R >>",
            2: b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            3: (b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
                b"/Resources << /Font << /F1 10 0 R /F2 20 0 R >> >> "
                b"/Contents [4 0 R 5 0 R] >>"),
            4: (b"<< >>", b"BT /F2 12 Tf 1 0 0 1 72 720 Tm (a) Tj ET\n"),
            5: (b"<< >>", b"BT 1 0 0 1 72 700 Tm (" + TITLE.encode() +
                b") Tj ET\n"),
        }
        objects.update(fonts)
        pdf = build_pdf(objects)
        self.assertIn(TITLE, extract(pdf, cmap_strategy()))

    def test_text_before_any_tf_keeps_the_document_level_reading(self):
        fonts = _cid_font_objects(10)
        content = b"BT 1 0 0 1 72 700 Tm <10001001> Tj ET\n"
        pdf = simple_page_pdf({"F1": 10}, content, fonts=fonts)
        self.assertEqual(extract(pdf, DocumentDecoding("identity")),
                         "\u1000\u1001")


class TJArrayTest(unittest.TestCase):
    """7. TJ arrays mixing strings and kerning numbers."""

    def test_kerning_numbers_are_ignored_and_strings_joined(self):
        fonts = _simple_font(20)
        content = (b"BT /F2 12 Tf 1 0 0 1 72 700 Tm "
                   b"[(Go)-3(d)6( )-2(o)-3(f)10( )-2(Sla)3(ught)12(e)-3(r)] TJ ET\n")
        pdf = simple_page_pdf({"F2": 20}, content, fonts=fonts)
        self.assertEqual(extract(pdf, cmap_strategy()), TITLE)

    def test_tj_array_mixes_hex_and_literal_strings(self):
        fonts = _simple_font(20)
        content = (b"BT /F2 12 Tf 1 0 0 1 72 700 Tm "
                   b"[<476F64> -50 ( of ) 25 <536C61756768746572>] TJ ET\n")
        pdf = simple_page_pdf({"F2": 20}, content, fonts=fonts)
        self.assertEqual(extract(pdf, cmap_strategy()), TITLE)

    def test_tj_array_may_contain_a_closing_bracket_in_a_string(self):
        fonts = _simple_font(20)
        content = (b"BT /F2 12 Tf 1 0 0 1 72 700 Tm "
                   b"[(a]b) -10 (c)] TJ ET\n")
        pdf = simple_page_pdf({"F2": 20}, content, fonts=fonts)
        self.assertEqual(extract(pdf, cmap_strategy()), "a]bc")

    def test_long_tj_array_is_not_truncated(self):
        fonts = _simple_font(20)
        items = b" ".join(b"(x) -25" for _ in range(200))
        content = (b"BT /F2 12 Tf 1 0 0 1 72 700 Tm [" + items + b"] TJ ET\n")
        pdf = simple_page_pdf({"F2": 20}, content, fonts=fonts)
        self.assertEqual(extract(pdf, cmap_strategy()), "x" * 200)

    def test_quote_operators_show_text(self):
        fonts = _simple_font(20)
        content = (b"BT /F2 12 Tf 1 0 0 1 72 700 Tm (a) Tj (b) ' "
                   b"3 4 (c) \" ET\n")
        pdf = simple_page_pdf({"F2": 20}, content, fonts=fonts)
        self.assertEqual(extract(pdf, cmap_strategy()), "abc")


class LiteralEscapeTest(unittest.TestCase):
    """8. Literal-string escape handling."""

    def test_escapes(self):
        cases = [
            (rb"a\(b\)c", "a(b)c"),
            (rb"a\\b", "a\\b"),
            (rb"a\tb", "a\tb"),
            (rb"a\nb", "a\nb"),
            (rb"a\rb", "a\rb"),
            (rb"a\101b", "aAb"),          # octal
            (rb"a\1011b", "aA1b"),        # 3-digit octal then a literal '1'
            (rb"a\qb", "aqb"),            # unknown escape drops the backslash
            (b"a(nested)b", "a(nested)b"),
            (b"a\\\nb", "ab"),            # line continuation
            (b"a\r\nb", "a\nb"),          # raw EOL normalises to \n
        ]
        fonts = _simple_font(20)
        for raw, expected in cases:
            with self.subTest(raw=raw):
                content = (b"BT /F2 12 Tf 1 0 0 1 72 700 Tm (" + raw +
                           b") Tj ET\n")
                pdf = simple_page_pdf({"F2": 20}, content, fonts=fonts)
                self.assertEqual(extract(pdf, cmap_strategy()), expected)

    def test_scanner_reports_the_end_of_the_string(self):
        data = rb"(a\)b) Tj"
        body, end = scan_literal_string(data, 1)
        self.assertEqual(body, b"a)b")
        self.assertEqual(data[end:], b" Tj")


class SimpleFontEncodingTest(unittest.TestCase):
    """7(b). WinAnsi / MacRoman / Differences / ToUnicode for simple fonts."""

    def test_winansi_high_codes(self):
        table, declared = build_simple_encoding(Name("WinAnsiEncoding"),
                                                lambda v: v)
        self.assertTrue(declared)
        self.assertEqual(table[0x92], "\u2019")     # right single quote
        self.assertEqual(table[0x80], "\u20AC")     # Euro
        self.assertEqual(table[0xE9], "\u00E9")     # e acute

    def test_macroman_high_codes(self):
        table, declared = build_simple_encoding(Name("MacRomanEncoding"),
                                                lambda v: v)
        self.assertTrue(declared)
        self.assertEqual(table[0xC9], "\u2026")     # ellipsis
        self.assertEqual(table[0x8E], "\u00E9")     # e acute
        self.assertEqual(table[0xDB], "\u00A4")     # PDF: currency, not Euro

    def test_macroman_font_in_a_document(self):
        fonts = _simple_font(20, encoding=b"/MacRomanEncoding")
        content = b"BT /F2 12 Tf 1 0 0 1 72 700 Tm <C9> Tj ET\n"
        pdf = simple_page_pdf({"F2": 20}, content, fonts=fonts)
        self.assertEqual(extract(pdf, cmap_strategy()), "\u2026")

    def test_differences_override_the_base_encoding(self):
        fonts = _simple_font(20, encoding=(
            b"<< /Type /Encoding /BaseEncoding /WinAnsiEncoding "
            b"/Differences [65 /eacute /Zcaron] >>"))
        content = b"BT /F2 12 Tf 1 0 0 1 72 700 Tm (ABC) Tj ET\n"
        pdf = simple_page_pdf({"F2": 20}, content, fonts=fonts)
        self.assertEqual(extract(pdf, cmap_strategy()), "\u00E9\u017DC")

    def test_glyph_name_resolution(self):
        self.assertEqual(glyph_name_to_unicode("eacute"), "\u00E9")
        self.assertEqual(glyph_name_to_unicode("uni1000"), "\u1000")
        self.assertEqual(glyph_name_to_unicode("u1015"), "\u1015")
        self.assertEqual(glyph_name_to_unicode("a.sc"), "a")
        self.assertIsNone(glyph_name_to_unicode(".notdef"))

    def test_font_own_tounicode_beats_the_encoding(self):
        tu = (b"begincmap 1 beginbfchar <41> <1000> endbfchar endcmap")
        fonts = _simple_font(20, tounicode=21)
        fonts[21] = (b"<< >>", tu)
        content = b"BT /F2 12 Tf 1 0 0 1 72 700 Tm (A) Tj ET\n"
        pdf = simple_page_pdf({"F2": 20}, content, fonts=fonts)
        self.assertEqual(extract(pdf, DocumentDecoding("tounicode", {})),
                         "\u1000")

    def test_unencoded_simple_font_uses_the_document_map(self):
        """Symbolic legacy faces (no /Encoding) keep the old behaviour."""
        fonts = _simple_font(20, encoding=None)
        content = b"BT /F2 12 Tf 1 0 0 1 72 700 Tm (!\") Tj ET\n"
        pdf = simple_page_pdf({"F2": 20}, content, fonts=fonts)
        legacy = DocumentDecoding("legacy",
                                  LegacyAyarMap({33: "\u103C", 34: "\u1015"}))
        self.assertEqual(extract(pdf, legacy), "\u1015\u103C")  # reordered

    def test_control_bytes_are_dropped_not_emitted(self):
        fonts = _simple_font(20)
        content = b"BT /F2 12 Tf 1 0 0 1 72 700 Tm (a\\000b) Tj ET\n"
        pdf = simple_page_pdf({"F2": 20}, content, fonts=fonts)
        self.assertEqual(extract(pdf, cmap_strategy()), "ab")


class ResourceResolutionTest(unittest.TestCase):
    """2(b). /Resources and /Font: inherited and indirect."""

    def _loader(self, pdf):
        objects = PE.parse_pdf_objects(pdf)
        return objects, FontResourceLoader(
            objects, PE.get_stream, PE.parse_ttf_cmap, PE.parse_tounicode_stream)

    def test_indirect_resources_and_font_dicts(self):
        fonts = _simple_font(20)
        objects = {
            1: b"<< /Type /Catalog /Pages 2 0 R >>",
            2: b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            3: (b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
                b"/Resources 6 0 R /Contents 4 0 R >>"),
            4: (b"<< >>", b"BT /F2 12 Tf 1 0 0 1 72 700 Tm (" +
                TITLE.encode() + b") Tj ET\n"),
            6: b"<< /Font 7 0 R >>",
            7: b"<< /F2 20 0 R >>",
        }
        objects.update(fonts)
        pdf = build_pdf(objects)
        self.assertEqual(extract(pdf, cmap_strategy()), TITLE)

    def test_resources_inherited_from_the_page_tree(self):
        fonts = _simple_font(20)
        objects = {
            1: b"<< /Type /Catalog /Pages 2 0 R >>",
            2: (b"<< /Type /Pages /Kids [3 0 R] /Count 1 "
                b"/Resources << /Font << /F2 20 0 R >> >> >>"),
            3: (b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
                b"/Contents 4 0 R >>"),
            4: (b"<< >>", b"BT /F2 12 Tf 1 0 0 1 72 700 Tm (" +
                TITLE.encode() + b") Tj ET\n"),
        }
        objects.update(fonts)
        pdf = build_pdf(objects)
        self.assertEqual(extract(pdf, cmap_strategy()), TITLE)

    def test_font_resources_are_listed_for_the_page(self):
        fonts = _cid_font_objects(10)
        fonts.update(_simple_font(20))
        pdf = simple_page_pdf({"F1": 10, "F2": 20}, b"", fonts=fonts)
        objects, loader = self._loader(pdf)
        pages = PE.collect_pages(objects, PE.find_root_pages(objects))
        decoders = page_font_decoders(loader, pages[0][0], pages[0][1],
                                      cmap_strategy())
        self.assertEqual(sorted(decoders), ["F1", "F2"])
        self.assertTrue(decoders["F1"].is_cid)
        self.assertFalse(decoders["F2"].is_cid)
        # Same embedded program, different decoding rules.
        self.assertEqual(decoders["F1"].base_font, decoders["F2"].base_font)
        self.assertTrue(decoders["F2"].has_encoding)

    def test_shared_font_program_is_parsed_once(self):
        fonts = _cid_font_objects(10)
        fonts.update(_simple_font(20, descriptor=12))
        pdf = simple_page_pdf({"F1": 10, "F2": 20}, b"", fonts=fonts)
        objects, loader = self._loader(pdf)
        pages = PE.collect_pages(objects, PE.find_root_pages(objects))
        decoders = page_font_decoders(loader, pages[0][0], pages[0][1],
                                      cmap_strategy())
        self.assertIs(decoders["F1"].own_gids, decoders["F2"].own_gids)


class ToUnicodeTrustTest(unittest.TestCase):
    """8(b). Copy-protection decoys and sidecar scoping."""

    def test_blanked_tounicode_is_filtered(self):
        blank = [b"<%04X> <0020>" % c for c in range(40)]
        tu = (b"begincmap %d beginbfchar " % len(blank) + b" ".join(blank) +
              b" <0028> <1000> endbfchar endcmap")
        mapping = PE.parse_tounicode_stream(tu)
        from pdf_fonts import usable_tounicode
        kept = usable_tounicode(mapping)
        self.assertEqual(kept, {0x28: "\u1000"})

    def test_cmap_strategy_ignores_a_misleading_font_tounicode(self):
        """A decoy that maps CIDs to other Latin letters must not win."""
        tu = (b"begincmap 2 beginbfchar <0818> <0064> <0819> <0070> "
              b"endbfchar endcmap")
        fonts = _cid_font_objects(10, tounicode=tu)
        content = (b"BT /F1 12 Tf 1 0 0 1 72 700 Tm <" + CID_K + CID_KH +
                   b"> Tj ET\n")
        pdf = simple_page_pdf({"F1": 10}, content, fonts=fonts)
        # The decoy claims these CIDs are 'd' and 'p'; the verified cmap wins.
        self.assertEqual(extract(pdf, cmap_strategy()), "\u1000\u1001")

    def test_tounicode_strategy_scopes_maps_to_their_own_font(self):
        """Two resources, two different ToUnicode maps, same code."""
        tu_a = b"begincmap 1 beginbfchar <0001> <1000> endbfchar endcmap"
        tu_b = b"begincmap 1 beginbfchar <0001> <1015> endbfchar endcmap"
        fonts = _cid_font_objects(10, tounicode=tu_a)
        fonts.update(_cid_font_objects(20, tounicode=tu_b))
        content = (b"BT /F1 12 Tf 1 0 0 1 72 700 Tm <0001> Tj ET\n"
                   b"BT /F2 12 Tf 1 0 0 1 72 680 Tm <0001> Tj ET\n")
        pdf = simple_page_pdf({"F1": 10, "F2": 20}, content, fonts=fonts)
        first, second = extract(pdf, DocumentDecoding("tounicode", {})).split("\n")
        self.assertEqual(first, "\u1000")
        self.assertEqual(second, "\u1015")

    def test_document_map_fills_what_the_font_map_lacks(self):
        tu = b"begincmap 1 beginbfchar <0001> <1000> endbfchar endcmap"
        fonts = _cid_font_objects(10, tounicode=tu)
        content = b"BT /F1 12 Tf 1 0 0 1 72 700 Tm <00010002> Tj ET\n"
        pdf = simple_page_pdf({"F1": 10}, content, fonts=fonts)
        # 0x0002 comes from the document-level (sidecar-filled) map.
        strategy = DocumentDecoding("tounicode", {2: "\u1015"})
        self.assertEqual(extract(pdf, strategy), "\u1000\u1015")

    def test_bfrange_destination_is_a_byte_string_not_a_scalar(self):
        """A scalar bfrange destination is UTF-16BE bytes incremented
        big-endian: chr() on the whole token crashes on surrogate pairs
        and multi-code-unit destinations (the ယဲ့နင် crash)."""
        # U+1F600/U+1F601 as surrogate pairs <D83DDE00>/<D83DDE01>.
        tu = (b"begincmap 1 beginbfrange <0001> <0002> <D83DDE00> "
              b"endbfrange endcmap")
        mapping = PE.parse_tounicode_stream(tu)
        self.assertEqual(mapping[1], "\U0001F600")
        self.assertEqual(mapping[2], "\U0001F601")

        # Multi-code-unit destination ("fi" ligature spelled out).
        tu = (b"begincmap 1 beginbfrange <0001> <0002> <00660069> "
              b"endbfrange endcmap")
        mapping = PE.parse_tounicode_stream(tu)
        self.assertEqual(mapping[1], "fi")
        self.assertEqual(mapping[2], "fj")

        # Plain BMP ranges keep working exactly as before.
        tu = (b"begincmap 1 beginbfrange <0001> <0003> <1000> "
              b"endbfrange endcmap")
        mapping = PE.parse_tounicode_stream(tu)
        self.assertEqual([mapping[c] for c in (1, 2, 3)],
                         ["\u1000", "\u1001", "\u1002"])

    def test_bfrange_width_is_capped(self):
        """A range wider than 0x10000 codes is skipped whole instead of
        minting entries until the process runs out of memory."""
        tu = (b"begincmap 1 beginbfrange <00000000> <0010FFFF> <1000> "
              b"endbfrange endcmap")
        self.assertEqual(PE.parse_tounicode_stream(tu), {})


class ExistingBehaviourTest(unittest.TestCase):
    """9. Behaviour that existed before the fix and must keep working."""

    def test_line_grouping_coordinates_and_sizes(self):
        fonts = _simple_font(20)
        content = (b"BT /F2 14.04 Tf 1 0 0 1 72.024 703.66 Tm (a) Tj ET\n"
                   b"BT /F2 14.04 Tf 1 0 0 1 100.5 703.66 Tm (b) Tj ET\n"
                   b"BT /F2 9 Tf 1 0 0 1 72.024 667.3 Tm (c) Tj ET\n")
        pdf = simple_page_pdf({"F2": 20}, content, fonts=fonts)
        lines = lines_of(pdf, cmap_strategy())
        self.assertEqual([t for _, _, _, t in lines], ["ab", "c"])
        self.assertAlmostEqual(lines[0][0], 72.024, places=3)
        self.assertAlmostEqual(lines[0][1], 703.66, places=2)
        self.assertEqual(lines[0][2], 14.04)
        self.assertEqual(lines[1][2], 9.0)

    def test_block_without_tf_keeps_the_default_size(self):
        fonts = _simple_font(20)
        content = (b"BT /F2 14.04 Tf 1 0 0 1 72 720 Tm (a) Tj ET\n"
                   b"BT 1 0 0 1 72 700 Tm (b) Tj ET\n")
        pdf = simple_page_pdf({"F2": 20}, content, fonts=fonts)
        lines = lines_of(pdf, cmap_strategy())
        self.assertEqual(lines[0][2], 14.04)
        self.assertEqual(lines[1][2], 12.0)

    def test_block_without_tm_is_skipped(self):
        fonts = _simple_font(20)
        content = (b"BT /F2 12 Tf (ignored) Tj ET\n"
                   b"BT /F2 12 Tf 1 0 0 1 72 700 Tm (kept) Tj ET\n")
        pdf = simple_page_pdf({"F2": 20}, content, fonts=fonts)
        self.assertEqual(extract(pdf, cmap_strategy()), "kept")

    def test_shadow_duplicates_are_collapsed(self):
        fonts = _simple_font(20)
        content = (b"BT /F2 12 Tf 1 0 0 1 72 700 Tm (bold) Tj ET\n"
                   b"BT /F2 12 Tf 1 0 0 1 72.3 700.2 Tm (bold) Tj ET\n")
        pdf = simple_page_pdf({"F2": 20}, content, fonts=fonts)
        self.assertEqual(extract(pdf, cmap_strategy()), "bold")

    def test_page_ordering_and_mediabox(self):
        fonts = _simple_font(20)
        objects = {
            1: b"<< /Type /Catalog /Pages 2 0 R >>",
            2: b"<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
            3: (b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
                b"/Resources << /Font << /F2 20 0 R >> >> /Contents 4 0 R >>"),
            4: (b"<< >>", b"BT /F2 12 Tf 1 0 0 1 72 700 Tm (one) Tj ET\n"),
            5: (b"<< /Type /Page /Parent 2 0 R "
                b"/Resources << /Font << /F2 20 0 R >> >> /Contents 6 0 R >>"),
            6: (b"<< >>", b"BT /F2 12 Tf 1 0 0 1 72 700 Tm (two) Tj ET\n"),
        }
        objects.update(fonts)
        pdf = build_pdf(objects)
        parsed = PE.parse_pdf_objects(pdf)
        pages = PE.collect_pages(parsed, PE.find_root_pages(parsed))
        self.assertEqual(len(pages), 2)
        self.assertEqual(extract(pdf, cmap_strategy(), 0), "one")
        self.assertEqual(extract(pdf, cmap_strategy(), 1), "two")
        self.assertEqual(PE.get_page_mediabox(parsed, *pages[0]), (595.0, 842.0))
        # inherited MediaBox falls back to the /Pages default (US Letter here)
        self.assertEqual(PE.get_page_mediabox(parsed, *pages[1]), (612.0, 792.0))

    def test_flate_content_stream(self):
        fonts = _simple_font(20)
        objects = {
            1: b"<< /Type /Catalog /Pages 2 0 R >>",
            2: b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            3: (b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
                b"/Resources << /Font << /F2 20 0 R >> >> /Contents 4 0 R >>"),
            4: (b"<< >>", b"BT /F2 12 Tf 1 0 0 1 72 700 Tm (" +
                TITLE.encode() + b") Tj ET\n"),
        }
        objects.update(fonts)
        pdf = build_pdf(objects, compress=True)
        self.assertEqual(extract(pdf, cmap_strategy()), TITLE)

    def test_decompression_guard_still_refuses_bombs(self):
        import zlib
        bomb = zlib.compress(b"\x00" * (4 * 1024 * 1024))
        with self.assertRaises(ValueError):
            PE.zlib_decompress_capped(bomb, limit_mb=1)
        self.assertEqual(PE.zlib_decompress_capped(zlib.compress(b"ok")), b"ok")

    def test_inline_image_data_is_skipped(self):
        fonts = _simple_font(20)
        content = (b"BT /F2 12 Tf 1 0 0 1 72 700 Tm (a) Tj ET\n"
                   b"q BI /W 2 /H 2 /BPC 8 /CS /G ID \x00(\\xff BT junk\x01 EI Q\n"
                   b"BT /F2 12 Tf 1 0 0 1 72 680 Tm (b) Tj ET\n")
        pdf = simple_page_pdf({"F2": 20}, content, fonts=fonts)
        self.assertEqual(extract(pdf, cmap_strategy()), "a\nb")

    def test_legacy_ayar_reordering_is_still_applied(self):
        fonts = _simple_font(20, encoding=None)
        content = b"BT /F2 12 Tf 1 0 0 1 72 700 Tm (!\") Tj ET\n"
        pdf = simple_page_pdf({"F2": 20}, content, fonts=fonts)
        legacy = DocumentDecoding("legacy",
                                  LegacyAyarMap(PE.ARLARWADE_AYAR_MAP))
        out = extract(pdf, legacy)
        self.assertEqual(out, "\u1015\u103C")

    def test_bare_maps_are_still_accepted(self):
        """Older callers passed a raw map or the IDENTITY sentinel."""
        fonts = _cid_font_objects(10)
        content = (b"BT /F1 12 Tf 1 0 0 1 72 700 Tm <10001001> Tj ET\n")
        pdf = simple_page_pdf({"F1": 10}, content, fonts=fonts)
        self.assertEqual(extract(pdf, IDENTITY), "\u1000\u1001")
        content2 = (b"BT /F1 12 Tf 1 0 0 1 72 700 Tm <" + CID_K + CID_KH +
                    b"> Tj ET\n")
        pdf2 = simple_page_pdf({"F1": 10}, content2, fonts=fonts)
        self.assertEqual(extract(pdf2, PE.CmapIdentityMap(MYANMAR_GID_MAP)),
                         "\u1000\u1001")

    def test_object_parser_reads_nested_structures(self):
        body = (b"<< /A [1 2 R /Name (str) <414243> [3]] /B << /C 4 >> "
                b"/D true /E null /F -1.5 >>")
        value = parse_object(body)
        self.assertEqual(value["B"], {"C": 4})
        self.assertEqual(value["A"][0], Ref(1, 2))
        self.assertEqual(value["A"][2], b"str")
        self.assertEqual(value["A"][3], b"ABC")
        self.assertIs(value["D"], True)
        self.assertEqual(value["F"], -1.5)

    def test_extract_page_text_layout_wrapper(self):
        fonts = _simple_font(20)
        content = b"BT /F2 12 Tf 1 0 0 1 72 700 Tm (" + TITLE.encode() + b") Tj ET\n"
        pdf = simple_page_pdf({"F2": 20}, content, fonts=fonts)
        objects = PE.parse_pdf_objects(pdf)
        pages = PE.collect_pages(objects, PE.find_root_pages(objects))
        self.assertEqual(
            PE.extract_page_text_layout(objects, pages[0][0], pages[0][1],
                                        cmap_strategy()), TITLE)


class BookFixtureTest(unittest.TestCase):
    """End-to-end check against the tracked 100-page sample, when present."""

    FIXTURE = os.path.join(_HERE, "..", "..", "File", "upload", "pdf",
                           "sample.pdf")

    @classmethod
    def setUpClass(cls):
        if not os.path.isfile(cls.FIXTURE):
            raise unittest.SkipTest("sample.pdf fixture not present")

    def test_first_page_title_author_and_translator(self):
        from pipeline import stream_pdf_pages
        _, npages, pages = stream_pdf_pages(self.FIXTURE, detector=None)
        self.assertEqual(npages, 100)
        first = next(iter(pages))
        self.assertIn(TITLE, first["text"])
        self.assertNotIn("dod of plaughter", first["text"])
        self.assertIn("Ni Cang Tian", first["text"])
        self.assertIn("Soe Paing Hmue", first["text"])

    def test_two_resources_share_one_font_program(self):
        objects = PE.parse_pdf_objects(open(self.FIXTURE, "rb").read())
        loader = FontResourceLoader(objects, PE.get_stream, PE.parse_ttf_cmap,
                                    PE.parse_tounicode_stream)
        pages = PE.collect_pages(objects, PE.find_root_pages(objects))
        strategy = DocumentDecoding("cmap", CmapIdentityMap({}))
        decoders = page_font_decoders(loader, pages[0][0], pages[0][1], strategy)
        self.assertGreaterEqual(len(decoders), 2)
        cid = [d for d in decoders.values() if d.is_cid]
        simple = [d for d in decoders.values() if not d.is_cid]
        self.assertTrue(cid and simple)
        self.assertEqual(cid[0].base_font, simple[0].base_font)
        self.assertTrue(simple[0].has_encoding)


class CanonicalMarkOrderTests(unittest.TestCase):
    """The ONE reorder authority: cleanup.reorder_marks, reading the one
    priority table in mm_score. Parse time no longer reorders at all."""

    def test_reorders_marks_into_canonical_sequence(self):
        # U+102F typed before U+102D; Unicode stores them the other way round.
        self.assertEqual(cleanup.reorder_marks("\u1000\u102f\u102d"), "\u1000\u102d\u102f")

    def test_asat_sorts_before_dot_below(self):
        # The engine's order: U+103A is 14, U+1037 is 15.
        self.assertEqual(cleanup.reorder_marks("\u1014\u1037\u103a"), "\u1014\u103a\u1037")
        self.assertEqual(cleanup.reorder_marks("\u1014\u103a\u1037"), "\u1014\u103a\u1037")

    def test_leaves_correct_text_untouched(self):
        for good in ("\u1014\u102c\u1019\u103a",            # namea
                     "\u101b\u103e\u102e\u101a\u1014\u103a\u1037",  # a transliterated name
                     "\u1000\u103b\u103d\u1014\u103a"):
            self.assertEqual(cleanup.reorder_marks(good), good)

    def test_drops_a_mark_repeated_on_one_base(self):
        self.assertEqual(cleanup.reorder_marks("\u1000\u102d\u102d"), "\u1000\u102d")

    def test_does_not_move_marks_that_have_no_base(self):
        # Reordering cannot invent the missing base, and moving the mark would
        # only hide the damage.
        self.assertEqual(cleanup.reorder_marks("\u103c\u1000"), "\u103c\u1000")

    def test_a_space_is_part_of_the_run_and_sorts_to_the_end_of_it(self):
        # The engine's Priority has " "=17 and "\n"=18, so a space joins the
        # cluster and sorts behind every real mark.
        self.assertEqual(cleanup.reorder_marks("\u1000 \u102d"), "\u1000\u102d ")
        # ...and the dedup applies to it like any other priority.
        self.assertEqual(cleanup.reorder_marks("\u1000  \u1001"), "\u1000 \u1001")

    def test_a_digit_is_not_a_base(self):
        # index() is U+1000..U+1021 plus U+1025/U+1027: marks after a digit
        # are left exactly where they are.
        self.assertEqual(cleanup.reorder_marks("\u1040\u102f\u102d"),
                         "\u1040\u102f\u102d")
        self.assertEqual(cleanup.reorder_marks("\u1025\u102f\u102d"),
                         "\u1025\u102d\u102f")

    def test_imposter_matching_is_longest_first(self):
        trie = cleanup._build_imposter_trie([("\u1009\u102c", "\u1025"),
                                             ("\u1009", "\u1014")])
        self.assertEqual(trie["\u1009"]["\u102c"][cleanup._REPLACEMENT], "\u1025")

    def test_a_character_outside_the_table_passes_through_and_ends_the_run(self):
        # U+1039 is not in the priority table: never moved, never dropped, and
        # the marks after it belong to the next base.
        self.assertEqual(cleanup.reorder_marks("\u1000\u1039\u1000\u102f\u102d"),
                         "\u1000\u1039\u1000\u102d\u102f")

    def test_glue_is_stripped_before_anything_else(self):
        # A zero width space between a base and its marks must not split the
        # cluster, and must not survive into the output.
        self.assertEqual(cleanup.cleanup_text("\u1000\u200b\u102f\u102d"),
                         "\u1000\u102d\u102f")

    def test_each_base_keeps_its_own_marks(self):
        self.assertEqual(cleanup.reorder_marks("\u1000\u102f\u102d\u1014\u102f\u102d"),
                         "\u1000\u102d\u102f\u1014\u102d\u102f")

    def test_parse_time_no_longer_reorders(self):
        # legacy_ayar_to_unicode keeps only the legacy font's visual->logical
        # moves; priority ordering happens once, in the cleanup step.
        self.assertEqual(PE.legacy_ayar_to_unicode("\u1000\u102f\u102d"),
                         "\u1000\u102f\u102d")


class DigitConsonantConfusionTests(unittest.TestCase):
    """U+101D (wa) and U+1040 (digit zero) share one glyph."""

    def test_marked_digit_becomes_the_consonant(self):
        self.assertEqual(PE.fix_digit_consonant_confusion("\u1040\u102d"),
                         "\u101d\u102d")

    def test_unmarked_digit_is_left_alone(self):
        # Genuinely ambiguous; guessing would corrupt page numbers.
        self.assertEqual(PE.fix_digit_consonant_confusion("\u1040"), "\u1040")
        self.assertEqual(PE.fix_digit_consonant_confusion("\u1041\u1040\u1042"),
                         "\u1041\u1040\u1042")

    def test_other_digits_are_not_touched(self):
        self.assertEqual(PE.fix_digit_consonant_confusion("\u1045\u102d"),
                         "\u1045\u102d")

    def test_the_legacy_fix_gives_the_marks_a_base(self):
        # The digit becomes the consonant so the marks are no longer orphans;
        # putting them in priority order is the cleanup step's job.
        out = PE.legacy_ayar_to_unicode("\u1040\u102f\u102d")
        self.assertEqual(out, "\u101d\u102f\u102d")
        self.assertEqual(cleanup.reorder_marks(out), "\u101d\u102d\u102f")


class LegacyLayoutSelectionTests(unittest.TestCase):
    """A legacy code page belongs to a keyboard layout, and the PDF does not
    say which one was used. So every registered layout is tried and scored."""

    def _shuffled(self, table, seed=7):
        import random
        vals = list(table.values())
        random.Random(seed).shuffle(vals)
        return dict(zip(table.keys(), vals))

    def test_scoring_separates_a_right_layout_from_a_wrong_one(self):
        # Same glyph inventory, wrong slots: the scorer must still tell them
        # apart, because only structure differs, not the character set.
        from mm_score import score_text
        good = score_text("\u1014\u102c\u1019\u103a\u1005\u102c\u1038"
                          "\u1000\u102d\u102f\u101e\u100a\u103a")
        bad = score_text("\u102c\u1019\u103a\u102d\u1038\u102f\u1014\u1005")
        self.assertGreater(good["score"], bad["score"])

    def test_quality_floor_sits_between_a_fitting_and_a_wrong_layout(self):
        # Measured: a layout the document uses scores ~0.97, one it does not
        # scores ~0.58-0.67. The floor must separate those two populations.
        self.assertGreater(pipeline.LEGACY_QUALITY_FLOOR, 0.70)
        self.assertLess(pipeline.LEGACY_QUALITY_FLOOR, 0.95)

    def test_registry_is_keyed_by_layout_not_typeface(self):
        # Unrelated typefaces share one layout, so the registry must not be
        # keyed on a font name.
        for name in LEGACY_CODE_PAGES:
            self.assertNotIn("+", name)
            self.assertEqual(name, name.lower())

    def test_every_registered_code_page_maps_bytes_to_text(self):
        for name, table in LEGACY_CODE_PAGES.items():
            self.assertTrue(table, f"{name} is empty")
            for code, out in table.items():
                self.assertIsInstance(code, int, f"{name}: non-int key")
                self.assertIsInstance(out, str, f"{name}: non-str value")


class TwoLayoutSelectionTests(unittest.TestCase):
    """With more than one layout registered, selection must actually choose."""

    def test_registry_holds_more_than_one_layout(self):
        self.assertGreaterEqual(len(LEGACY_CODE_PAGES), 2)

    def test_layouts_genuinely_disagree(self):
        # If two registered layouts agreed, one would be redundant and
        # selection between them would be meaningless.
        ayar = LEGACY_CODE_PAGES["ayar"]
        winn = LEGACY_CODE_PAGES["wininnwa"]
        shared = set(ayar) & set(winn)
        self.assertTrue(shared, "layouts share no codes at all")
        differ = sum(1 for c in shared if ayar[c] != winn[c])
        self.assertGreater(differ / len(shared), 0.5,
                           "layouts agree too closely to be distinct keyboards")

    def test_wininnwa_decodes_its_known_anchor(self):
        # 'emrfpm;' is နာမ်စား (pronoun) in the WinInnwa layout -- the same
        # word mm-grammar.pdf spells through the Ayar layout.
        winn = LEGACY_CODE_PAGES["wininnwa"]
        got = "".join(winn.get(ord(c), c) for c in "emrfpm;")
        self.assertEqual(PE.legacy_ayar_to_unicode(got), "\u1014\u102c\u1019\u103a\u1005\u102c\u1038")

    def test_ayar_does_not_decode_the_wininnwa_anchor(self):
        ayar = LEGACY_CODE_PAGES["ayar"]
        got = "".join(ayar.get(ord(c), c) for c in "emrfpm;")
        self.assertNotEqual(PE.legacy_ayar_to_unicode(got),
                            "\u1014\u102c\u1019\u103a\u1005\u102c\u1038")


class OrderingAndCleanupReachTests(unittest.TestCase):
    """Ordering runs everywhere; imposter cleanup is the Unicode branch's."""

    def test_ordering_is_not_behind_the_toggle_or_a_category(self):
        scrambled = "\u1000\u102f\u102d"
        ordered = "\u1000\u102d\u102f"
        self.assertEqual(cleanup.order_text(scrambled), ordered)
        for cat in ("ZAWGYI", "UNICODE", "UNKNOWN"):
            self.assertEqual(
                pipeline._convert_line(scrambled, cat, apply_cleanup=False),
                ordered, f"{cat} line was not ordered")

    def test_imposter_cleanup_only_offered_for_unicode(self):
        imposter = "\u1000\u1088"              # U+1088 -> U+103E U+102F
        self.assertIsNone(pipeline._cleanup_for("ZAWGYI", imposter))
        self.assertIsNone(pipeline._cleanup_for("UNKNOWN", imposter))
        self.assertEqual(pipeline._cleanup_for("UNICODE", imposter),
                         "\u1000\u103e\u102f")

    def test_order_text_leaves_imposters_alone(self):
        # The always-on step must not silently do the toggleable one.
        self.assertEqual(cleanup.order_text("\u1000\u1088"), "\u1000\u1088")


class ScannerTests(unittest.TestCase):
    """scan.py -- the detector that found the bytes the score could not see."""

    def _hits(self, text, rule):
        return scan.scan_text(text)[rule]["total"]

    def test_orphan_mark_is_reported_with_its_cluster(self):
        # a mark with no base: this is the signal that exposed 0x4F, where
        # ှု was decoding as a comma and left ိ stranded in နှိုင်း
        r = scan.scan_text("\u1014\u104a\u102d\u1004\u103a\u1038")
        self.assertEqual(r["orphan"]["total"], 1)
        cluster = r["orphan"]["clusters"][0][0]
        self.assertIn("\u102d", cluster)          # the cluster, not the bare mark
        self.assertGreater(len(cluster), 1)

    def test_independent_vowel_counts_as_a_base(self):
        # ဦး is ordinary text; the engine's index() stops at U+1021, but the
        # SCANNER must not call that visarga an orphan
        self.assertEqual(self._hits("\u1026\u1038", "orphan"), 0)

    def test_impossible_pair(self):
        self.assertEqual(self._hits("\u1019\u103c\u1004\u1036\u103a", "impossible"), 1)
        self.assertEqual(self._hits("\u1019\u103c\u1004\u103a\u1037", "impossible"), 0)

    def test_kinzi_with_nothing_to_sit_on(self):
        # The renderer hides this one: သချင်္ာ and သင်္ချာ draw the SAME shape,
        # so it is invisible on screen and only the code points show it.
        bad = "\u101e\u1001\u103b\u1004\u103a\u1039\u102c"          # သ ခ ျ ⟨kinzi⟩ ာ
        good = "\u101e\u1004\u103a\u1039\u1001\u103b\u102c"         # သ ⟨kinzi⟩ ခ ျ ာ
        self.assertEqual(self._hits(bad, "impossible"), 1)
        self.assertEqual(self._hits(good, "impossible"), 0)
        # and a kinzi that DOES have its consonant is never flagged
        self.assertEqual(self._hits("\u101d\u102b\u1005\u1004\u103a\u1039\u1002", "impossible"), 0)

    def test_stray_mark_token(self):
        self.assertEqual(self._hits("\u1000\u102d \u103e\u103e \u1001", "stray"), 1)

    def test_repeat_needs_three(self):
        # two is ordinary reduplication (မြန်မြန်), three is shadow collapse
        self.assertEqual(self._hits("\u1019\u103c\u1014\u103a\u1019\u103c\u1014\u103a", "repeat"), 0)
        self.assertEqual(self._hits("\u1016\u102f\u1036\u1016\u102f\u1036\u1016\u102f\u1036", "repeat"), 1)

    def test_digit_inside_a_word_only(self):
        # က၂န် is ကျွန်; ၁၀ is a number
        self.assertEqual(self._hits("\u1000\u1042\u1014\u103a", "digit"), 1)
        self.assertEqual(self._hits("\u1041\u1040", "digit"), 0)
        self.assertEqual(self._hits("\u1040", "digit"), 0)

    def test_dictionary_marks_unknown_words_only(self):
        words = {"\u1019\u103c\u1014\u103a\u1019\u102c", "\u1005\u102c"}      # မြန်မာ, စာ
        text = "\u1019\u103c\u1014\u103a\u1019\u102c\u1005\u102c \u1000\u1015\u1015\u1015"   # a compound, then nonsense
        counts, _first, total = scan.unknown_words(text, words)
        self.assertEqual(total, 2)
        self.assertEqual(list(counts), ["\u1000\u1015\u1015\u1015"])   # compound splits, nonsense does not

    def test_sentence_terminator_is_not_part_of_the_token(self):
        # U+104B lives in the Myanmar block; gluing it on made every token
        # unknown and the segmentation backtrack for minutes
        words = {"\u1016\u103c\u1005\u103a\u101e\u100a\u103a"}
        counts, _f, total = scan.unknown_words("\u1016\u103c\u1005\u103a\u101e\u100a\u103a\u104b", words)
        self.assertEqual(total, 1)
        self.assertEqual(sum(counts.values()), 0)

    def test_dictionary_does_not_shadow_the_token_list(self):
        # scan_text(words=...) must reach unknown_words, not be overwritten
        r = scan.scan_text("\u1019\u103c\u1014\u103a\u1019\u102c", words={"\u1019\u103c\u1014\u103a\u1019\u102c"})
        self.assertIn("unknown", r)
        self.assertEqual(r["unknown"]["total"], 0)
        self.assertEqual(r["unknown"]["tokens"], 1)

    def test_report_is_writable_text(self):
        body = scan.format_report(scan.scan_text("\u1000\u102d"), source="x", total_chars=2)
        self.assertIn("praser scan", body)
        self.assertIn("orphan", body)


if __name__ == "__main__":
    unittest.main(verbosity=2)


class CmapForkTest(unittest.TestCase):
    """The cmap fork: unicode path vs zawgyi-cmap, scored not vetoed.

    Mirrors Praser/parser/test/zawgyi-cmap.test.mjs.
    """

    UNICODE_LINE = "သူ့တစ်ကိုယ်လုံးနာကျင်နေသည်ကို ရှီယန်သတိထားမိလိုက်သည်။ "

    def test_unicode_page_is_never_rewritten(self):
        logs = []
        cat = pipeline._cmap_fork(
            "ZAWGYI", self.UNICODE_LINE * 6, "tounicode", 0, "ZAWGYI",
            logs.append)
        self.assertEqual(cat, "UNICODE")
        self.assertTrue(any("unicode path" in line for line in logs))

    def test_mark_thin_page_stays_unicode(self):
        cat = pipeline._cmap_fork(
            "ZAWGYI", self.UNICODE_LINE, "cmap", 0, "ZAWGYI",
            lambda m: None)
        self.assertEqual(cat, "UNICODE")

    def test_non_cmap_decodes_bypass_the_fork(self):
        cat = pipeline._cmap_fork(
            "ZAWGYI", self.UNICODE_LINE * 6, "legacy", 0, "ZAWGYI",
            lambda m: None)
        self.assertEqual(cat, "ZAWGYI")

    def test_real_sample_first_page_takes_zawgyi_cmap(self):
        fixture = os.path.join(_HERE, "..", "..", "File", "upload", "pdf",
                               "sample.pdf")
        if not os.path.isfile(fixture):
            raise unittest.SkipTest("sample.pdf fixture not present")
        from pipeline import stream_pdf_pages, load_detector
        det = load_detector()
        _, _, pages = stream_pdf_pages(fixture, detector=det)
        first = next(iter(pages))
        self.assertEqual(first["decode_kind"], "cmap")
        category, _ = det.detect(first["text"])
        logs = []
        cat = pipeline._cmap_fork(
            pipeline._norm_category(category), first["text"],
            first["decode_kind"], 0, category, logs.append)
        self.assertEqual(cat, "ZAWGYI")
        self.assertTrue(any("zawgyi-cmap path" in line for line in logs))


class ObjectStreamTest(unittest.TestCase):
    """decrypt.py detection + expansion wiring (fake qpdf, like the JS suite)."""

    OBJSTM = (b"%PDF-1.5\n5 0 obj<</Type/ObjStm/N 1/First 4/Length 4>>stream\n"
              b"xxxx\nendstream\nendobj\n%%EOF\n")
    PLAIN = b"%PDF-1.4\ntrailer<</Size 1>>\n%%EOF\n"

    def test_detection_is_by_marker(self):
        import decrypt
        self.assertTrue(decrypt.has_object_streams(self.OBJSTM))
        self.assertFalse(decrypt.has_object_streams(self.PLAIN))
        self.assertEqual(decrypt.expand_object_streams(self.PLAIN), self.PLAIN)

    def test_expansion_invokes_qpdf_with_disable(self):
        import decrypt
        import stat
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            log = os.path.join(tmp, "args.txt")
            exe = os.path.join(tmp, "qpdf")
            with open(exe, "w") as f:
                f.write("#!/usr/bin/env python3\n"
                        "import os, shutil, sys\n"
                        "open(os.environ['FAKE_QPDF_LOG'], 'w').write(' '.join(sys.argv[1:]))\n"
                        "shutil.copyfile(sys.argv[-2], sys.argv[-1])\n")
            os.chmod(exe, os.stat(exe).st_mode | stat.S_IEXEC)
            old = os.environ.get("PRASER_QPDF_BIN")
            os.environ["PRASER_QPDF_BIN"] = exe
            os.environ["FAKE_QPDF_LOG"] = log
            try:
                messages = []
                out = decrypt.expand_object_streams(self.OBJSTM, messages.append)
                self.assertEqual(out, self.OBJSTM)  # the double copies through
                with open(log) as f:
                    self.assertIn("--object-streams=disable", f.read())
                self.assertTrue(any("object streams; expanded" in m for m in messages))
            finally:
                if old is None:
                    del os.environ["PRASER_QPDF_BIN"]
                else:
                    os.environ["PRASER_QPDF_BIN"] = old
                del os.environ["FAKE_QPDF_LOG"]
