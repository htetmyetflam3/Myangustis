"""Which subset table a legacy face was written for, answered by the page itself.

The two hand-built tables (Ayar, WinInnwa) disagree on 92 of the 109 slots they
share, so reading a face through the wrong one is not a cosmetic slip: nine codes
in ten change meaning. The file usually says which table by its font name, and a
witnessed resource profile says it more precisely -- both stay the pin. What was
missing is the case the name cannot answer: ``@core/pdf/legacy-judgement.js``
existed to settle it (probe the same sample under each table, score which reading
is Burmese, accept only above a floor) and the Python port never gave it a
caller, so an unnamed face silently took the WinInnwa default.

These tests put the scorer and the caller under the same door as the rest of the
lane: the decoder for a synthetic PDF's second font, and the pipeline for the page.
"""
import hashlib
import unittest
from pathlib import Path

from myangustis_parser.extract.legacy_judgement import (
    LEGACY_QUALITY_FLOOR, MIN_PROBE_MARKS, decide_legacy_family)
from myangustis_parser.extract.pdf_extract import (
    _settle_legacy_families, extract_page_lines, parse_pdf_objects)
from myangustis_parser.extract.pdf_fonts import DocumentDecoding, FontDecoder, LEGACY_CODE_PAGES
from myangustis_parser.normalize import mm_score
from myangustis_parser.normalize.cleanup import order_text

from pdfbuild import simple_page_pdf
from myangustis_parser.extract.pdf_extract import lane_trial
from myangustis_parser.extract.pdf_fonts import Ref
from test_pdf_page_routing import pages

#: A single-glyph base followed by its mark, over and over: a sample the two
#: tables can disagree about one syllable at a time. Built from the tables
#: themselves, so it stays valid if an entry is corrected, and long enough that
#: the score is about the reading rather than about two syllables.
BASES = 'ကခဂဃငစဆဇဈဉညတဒနပဖဗမယရလဝသဟအဤဥဦဧ'
MARKS = 'ာိီုူေ့း်'


def _syllables(page, rounds=2):
    """``(codes, text)`` for as many base+mark clusters as `page` defines."""
    inverse = {}
    for code, glyph in page.items():
        if isinstance(glyph, str) and len(glyph) == 1 and code < 256:
            inverse.setdefault(glyph, code)
    usable = [(base, mark) for base in BASES if base in inverse
               for mark in MARKS if mark in inverse]
    pairs = [usable[index % len(usable)] for index in range(len(usable) * rounds)]
    codes = bytes(inverse[glyph] for pair in pairs for glyph in pair)
    return codes, ''.join(glyph for pair in pairs for glyph in pair)


SAMPLE, SAMPLE_TEXT = _syllables(LEGACY_CODE_PAGES['ayar'])
# The separation this whole mechanism rests on, asserted here so a table edit
# that removes it fails loudly instead of leaving a passing test that proves
# nothing: one reading is Burmese, the other one is not.
_ayar_score = mm_score.score_text(order_text(SAMPLE_TEXT))
_wininnwa_score = mm_score.score_text(order_text(
    ''.join(LEGACY_CODE_PAGES['wininnwa'].get(code) or chr(code) for code in SAMPLE)))


class SampleSeparationTests(unittest.TestCase):
    def test_the_two_readings_of_the_same_bytes_are_not_equally_good(self):
        self.assertGreaterEqual(_ayar_score['marks'], MIN_PROBE_MARKS)
        self.assertGreaterEqual(_ayar_score['score'], LEGACY_QUALITY_FLOOR)
        self.assertLess(_wininnwa_score['score'], _ayar_score['score'])
        if _wininnwa_score['marks'] >= MIN_PROBE_MARKS:
            self.assertLess(_wininnwa_score['score'], LEGACY_QUALITY_FLOOR)


def _pdf():
    """One page, two legacy faces: a named one and a nameless one.

    ``/EAAAAA+WinInnwa`` draws the base+mark cluster the WinInnwa table reads at
    ``<0102>``... its own way; ``/EAAAAA+CustomSubset`` draws 27 clusters whose
    codes are Ayar's. Only the first face can be named, so only the first is
    pinned -- and the lane needs a legacy face on the page to exist at all, which
    is what the named one provides.
    """
    win = LEGACY_CODE_PAGES['wininnwa']
    keys = {}
    for code, glyph in win.items():
        if isinstance(glyph, str) and glyph in 'ာကိသ':
            keys.setdefault(glyph, code)
    pairs = [(f'{keys[g]:02X}', chr(keys[g]).encode('utf-16-be').hex().upper()) for g in sorted(keys)]
    cmap = ('begincmap\n%d beginbfchar\n' % len(pairs)
            + '\n'.join('<%s> <%s>' % p for p in pairs)
            + '\nendbfchar\nendcmap').encode('latin-1')
    fonts = {10: b'<< /Type /Font /BaseFont /EAAAAA+WinInnwa /ToUnicode 11 0 R >>',
             11: (b'<< >>', cmap),
             12: b'<< /Type /Font /Subtype /TrueType /BaseFont /EAAAAA+CustomSubset >>'}
    named = bytes(keys[g] for g in 'ာက').hex().upper().encode()
    nameless = SAMPLE.hex().upper().encode()
    content = (b'BT /F1 12 Tf 1 0 0 1 10 750 Tm <' + named + b'> Tj ET\n'
               b'BT /F2 12 Tf 1 0 0 1 10 700 Tm <' + nameless + b'> Tj ET')
    return simple_page_pdf({'F1': 10, 'F2': 12}, content, fonts=fonts)


class UnnamedFaceDoorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pdf = _pdf()
        # The instruction the lane actually runs under: `pipeline` builds the
        # legacy strategy with the obsolete page rewrite left off, so the decode
        # shows the file's order (see
        # test_legacy_extraction_does_not_apply_obsolete_page_rewrite).
        cls.doc = DocumentDecoding('legacy')
        # The page is object 3 of what pdfbuild writes, as in every other door test.
        cls.lines, _, _ = extract_page_lines(parse_pdf_objects(cls.pdf), 3, 0, cls.doc)
        cls.decoders = {decoder.name: decoder for decoder in cls.doc._decoders.values()}

    def _text_of(self, index):
        return self.lines[index][3]

    def test_the_page_goes_to_the_legacy_lane_for_the_named_face_alone(self):
        out = pages(self.pdf)[0][0]
        self.assertEqual(out['decode_kind'], 'legacy')
        self.assertEqual(out['text'].split('\n')[0], 'ာက')

    def test_the_page_itself_names_the_table_of_the_unnamed_face(self):
        """The Ayar codes come out as Ayar, not as the WinInnwa default."""
        self.assertEqual(self._text_of(1), SAMPLE_TEXT)

    def test_the_probe_is_recorded_on_the_face_not_buried_in_the_text(self):
        probe = self.decoders['F2'].family_probe
        self.assertIsNotNone(probe, 'the unnamed face was never asked')
        self.assertEqual(probe['family'], 'ayar')
        self.assertTrue(probe['accepted'])
        self.assertIn('wininnwa', [name for name, _score in probe['ranking']])
        self.assertEqual(probe['pagesAsked'], 1)
        self.assertEqual(probe['pagesUsed'], 1)
        self.assertEqual(probe['pagesFailed'], 0)
        self.assertEqual(set(probe['candidates']), {'ayar', 'wininnwa'})

    def test_a_pinned_name_is_never_asked(self):
        """JS's rule, kept: the name gate answers first, the probe only follows silence."""
        self.assertIsNone(self.decoders['F1'].family_probe)
        self.assertTrue(self.decoders['F1'].family_pinned)
        self.assertIs(self.decoders['F1'].font_legacy_code_page, LEGACY_CODE_PAGES['wininnwa'])
        self.assertEqual(self._text_of(0), 'ာက')

    def test_the_named_face_and_the_probed_face_keep_separate_answers(self):
        """Two faces of one page, two tables: no borrowing between them."""
        self.assertIs(self.decoders['F2'].font_legacy_code_page, LEGACY_CODE_PAGES['ayar'])
        self.assertIs(self.decoders['F1'].font_legacy_code_page, LEGACY_CODE_PAGES['wininnwa'])

    def test_a_face_the_page_cannot_answer_reads_exactly_like_the_default(self):
        """A sample too short to judge is no decision and no damage -- and it is retried.

        The control is the same page with the same codes on a face the name gate
        *does* pin: if an undecided sample ever changed the reading, the two
        pages would part. Codes neither table claims (``0x7F`` up) are in the
        sample on purpose -- they keep the mark count under ``MIN_PROBE_MARKS``,
        which is the one gate that still abstains: there is nothing to compare.
        The attempt is recorded, and the face is left open for a later page.
        """
        # Deliberately a mouthful too small to judge: 12 codes cannot carry the
        # MIN_PROBE_MARKS marks a comparison needs, whatever the tables make of them.
        codes = bytes(range(0x30, 0x30 + 12))
        content = b'BT /F1 12 Tf 1 0 0 1 10 700 Tm <' + codes.hex().upper().encode() + b'> Tj ET'

        def decode(name):
            doc = DocumentDecoding('legacy')
            pdf = simple_page_pdf({'F1': 10}, content, fonts={
                10: b'<< /Type /Font /Subtype /TrueType /BaseFont /' + name + b' >>'})
            lines, _, _ = extract_page_lines(parse_pdf_objects(pdf), 3, 0, doc)
            return lines, next(iter(doc._decoders.values()))

        probed, probed_decoder = decode(b'EAAAAA+CustomSubset')
        pinned, pinned_decoder = decode(b'EAAAAA+WinInnwa')
        self.assertIsNone(pinned_decoder.family_probe, 'a pinned name was asked anyway')
        self.assertTrue(pinned_decoder.family_pinned)
        self.assertFalse(probed_decoder.family_pinned)
        self.assertTrue(probed_decoder.selected_legacy and pinned_decoder.selected_legacy)
        probe = probed_decoder.family_probe or probed_decoder.family_short
        self.assertIsNotNone(probe, 'a face with no answer must still record the attempt')
        self.assertFalse(probe['accepted'])
        self.assertIsNone(probe['family'])
        self.assertTrue(probe['insufficient'], 'a short sample must say it was short')
        self.assertEqual(probe['attempts'], 1)
        self.assertEqual(probe['pagesAsked'], 1)
        self.assertEqual(probe['pagesUsed'], 1)
        self.assertEqual(probe['pagesFailed'], 0)
        self.assertEqual(probe['zeroedForFewMarks'], 2)
        self.assertTrue(all(candidate['zeroedForFewMarks']
                            for candidate in probe['candidates'].values()))
        self.assertIsNone(probed_decoder.family_probe,
                          'a short look must leave the face open for a later page')
        self.assertEqual([line[3] for line in probed], [line[3] for line in pinned])
        # The bound: the same face may be looked at PROBE_MAX_ATTEMPTS times in a
        # book, and then it closes with its record kept. No more, and no fewer --
        # an unbounded retry would re-read the whole book for one stubborn font.
        chunks = [codes]
        for expected in (2, 3):
            probed_decoder.family_probe = None      # as a later page would find it
            probed_decoder.settle_legacy_family(chunks)
            self.assertEqual(probed_decoder.family_attempts, expected)
        self.assertIsNotNone(probed_decoder.family_probe, 'the bound must close the face')
        closed_at = probed_decoder.family_attempts
        probed_decoder.settle_legacy_family(chunks)
        self.assertEqual(probed_decoder.family_attempts, closed_at,
                         'past the bound the face is not looked at again')


class ProbeLedgerTests(unittest.TestCase):
    """The per-face ledger counts the actual bounded probe, not decoded text."""

    @staticmethod
    def _decoder():
        doc = DocumentDecoding('legacy')
        decoder = FontDecoder(
            'F2', subtype='TrueType', base_font='EAAAAA+CustomSubset', doc=doc,
            font_legacy_code_page=LEGACY_CODE_PAGES['wininnwa'],
            selected_legacy=True, family_pinned=False)
        return doc, decoder

    @staticmethod
    def _content(data):
        return (b'BT /F2 12 Tf <' + data.hex().upper().encode('ascii')
                + b'> Tj ET')

    def test_short_page_then_useful_page_is_counted_and_keeps_the_same_answer(self):
        doc, decoder = self._decoder()
        first_page = SAMPLE[:24]  # twelve dependent marks: below the 50-mark floor
        second_page = SAMPLE[24:]

        first_events = _settle_legacy_families(
            self._content(first_page), {'F2': decoder}, doc, page_key=(30, 0))
        self.assertEqual(len(first_events), 1)
        first = first_events[0]['ledger']
        self.assertFalse(first['complete'])
        self.assertEqual(first['pagesAsked'], 1)
        self.assertEqual(first['pagesUsed'], 1)
        self.assertEqual(first['pagesFailed'], 0)
        self.assertGreater(first['zeroedForFewMarks'], 0)

        second_events = _settle_legacy_families(
            self._content(second_page), {'F2': decoder}, doc, page_key=(31, 0))
        self.assertEqual(len(second_events), 1)
        final = second_events[0]['ledger']
        self.assertTrue(final['complete'])
        self.assertTrue(final['accepted'])
        self.assertEqual(final['family'], 'ayar')
        self.assertEqual(final['pagesAsked'], 2)
        self.assertEqual(final['pagesUsed'], 2)
        self.assertEqual(final['pagesFailed'], 0)
        self.assertEqual(set(final['candidates']), {'ayar', 'wininnwa'})
        self.assertEqual(final['candidates']['ayar']['pagesAsked'], 2)
        self.assertEqual(final['candidates']['ayar']['pagesUsed'], 2)
        self.assertGreater(final['candidates']['ayar']['marks'], 50)
        self.assertNotIn('samples', final)
        self.assertNotIn('decoded_text', final)

    def test_decode_failure_is_counted_without_recording_the_exception_message(self):
        from unittest.mock import patch

        doc, decoder = self._decoder()
        original_decode = FontDecoder.decode

        def fail_ayar(self, data, *, use_confirmed=True, stats=None):
            if self is decoder and self.font_legacy_code_page is LEGACY_CODE_PAGES['ayar']:
                raise RuntimeError('private PDF string must not enter the ledger')
            return original_decode(self, data, use_confirmed=use_confirmed, stats=stats)

        with patch.object(FontDecoder, 'decode', new=fail_ayar):
            events = _settle_legacy_families(
                self._content(SAMPLE), {'F2': decoder}, doc, page_key=(32, 0))

        ledger = events[0]['ledger']
        ayar = ledger['candidates']['ayar']
        self.assertTrue(ayar['decodeError'])
        self.assertEqual(ayar['decodeErrorType'], 'RuntimeError')
        self.assertEqual(ayar['pagesFailed'], 1)
        self.assertEqual(ayar['pagesUsed'], 0)
        self.assertEqual(ledger['pagesFailed'], 1)
        self.assertNotIn('private PDF string', repr(ledger))


class LaneScoreModuleTests(unittest.TestCase):
    """The boss call: same contract as the mirrored scorer, one signal more."""

    def test_english_junk_costs_a_reading_and_real_english_does_not(self):
        from myangustis_parser.extract.legacy_lane_score import _english_penalty
        junk = ' '.join(['zqxjv', 'kpftw', 'bndms'] * 3)          # no vowels, spaced
        prose = 'the agricultural research department released the report'
        self.assertGreater(_english_penalty(junk)[0], 0.0, 'Latin junk must cost quality')
        self.assertEqual(_english_penalty(prose)[0], 0.0, 'real English must not be punished')
        self.assertEqual(_english_penalty('\u1000\u1014\u102c\u1038')[0], 0.0,
                         'a reading with no Latin at all is not evidence either way')

    def test_the_module_keeps_the_mirrors_return_shape(self):
        from myangustis_parser.extract.legacy_lane_score import decide_lane
        pages = {'ayar': '', 'wininnwa': ''}

        def decode(page, name):
            return pages[name]
        out = decide_lane(decode, pages, default='wininnwa')
        for key in ('codePage', 'name', 'score', 'marks', 'accepted', 'insufficient',
                    'floor', 'ranking', 'samples', 'evidence', 'mirror'):
            self.assertIn(key, out)
        self.assertIsNone(out['codePage'], 'no marks at all is not a comparison')
        self.assertIsNone(out['name'], 'an undecided face reports no family, not a guess')
        self.assertFalse(out['accepted'])
        self.assertTrue(out['insufficient'])

    def test_the_better_reading_wins_even_when_neither_clears_the_floor(self):
        """The rule the books forced: acceptance is relative, not absolute.

        Both readings below are damaged -- deliberately, one more than the other --
        so the mirrored scorer's absolute floor (0.85) refuses both and the face
        would keep the table it was handed. On part-4 that was every probe in the
        book (63 looked, 0 accepted; best 0.7158), and on part-1 (136 looked, 0
        accepted). What the lane actually needs is the better of the two, because
        a legacy page is *supposed* to look damaged to a Unicode-shaped ruler.
        """
        from myangustis_parser.extract.legacy_judgement import (LEGACY_QUALITY_FLOOR,
                                                                decide_legacy_family)
        from myangustis_parser.extract.legacy_lane_score import decide_lane
        # A base with a mark after it is clean; a mark standing alone in its own
        # field is an orphan the score charges for. 60 clean clusters and 12 orphans
        # is the *better* side, and it still lands under 0.85 -- which is what a
        # legacy page looks like to a Unicode-shaped ruler.
        clean, orphan = '\u1000\u102d', '\u102d'
        # Both readings sit at or below ``LEGACY_MODERN_CEILING`` (0.4), which is where
        # the judge sends a page to the modern lane: the orphan run is most of the marks
        # on either side, so neither is "readable Burmese" however they rank together.
        pages = {'wininnwa': clean * 20 + ' ' + orphan * 60,   # damaged, less so
                 'ayar': clean * 10 + ' ' + orphan * 60}        # damaged, worse
        out = decide_lane(lambda page, name: pages[name], pages, default='ayar')
        self.assertGreaterEqual(out['marks'], 50, 'the sample must be judgeable')
        self.assertLess(out['score'], LEGACY_QUALITY_FLOOR,
                        'this test is only about the sub-floor case')
        self.assertTrue(out['accepted'], 'the better reading must be taken')
        self.assertEqual(out['name'], 'wininnwa')
        self.assertIs(out['codePage'], pages['wininnwa'])
        self.assertFalse(out['mirror']['accepted'],
                         'the mirror still abstains -- the difference is the point, and it is recorded')
        # A tie is not evidence: same text on both sides keeps the default.
        tie = decide_lane(lambda page, name: pages['wininnwa'], pages, default='ayar')
        self.assertEqual(tie['name'], 'ayar', 'a tie must not slide to whichever table came first')

    def test_the_instructor_calls_the_module_not_the_mirrored_scorer(self):
        src = (Path(__file__).resolve().parents[2]
               / 'B.Parser/architecture/extract/pdf_fonts.py').read_text()
        self.assertIn('legacy_lane_score import decide_lane', src)
        self.assertIn('decide_lane(decode_sample', src)


class FaceIdentityTests(unittest.TestCase):
    """(Face identity) a code-space answer is a fact about a program, not a label.

    The pool of hand-cut subset profiles --
    ``resources/maps_data/legacy-subset-profiles.json``, 22 entries -- is keyed by the
    sha256 of the embedded font program, and that hash is the only thing a
    ``/BaseFont`` name can be paired with at all. Measured over the two books in
    ``Junk/Parser/upload/pdf``: part-4 names 29 faces, 5 of them with no program in the
    file, and exactly one name pairs (``wininnwa``) -- where the same label answers to
    FIVE embedded programs (FirstChar/LastChar 0-105, 0-113, 0-114, 0-127, 0-64).
    part-1 names 65 faces and pairs with none; ``zawgyione`` alone covers 60 different
    embedded programs plus 1,032 unembedded references.

    So a name cannot carry a decision. The lane ledger is keyed by the program hash,
    and a face the file gives no program for is committed to nothing -- the
    instructor's side of the fork stands.
    """

    #: ``{obj: body}`` for one simple font whose program is object 7. ``descriptor``
    #: False is the unembedded case, which is most of what these books reference.
    @staticmethod
    def _objects(base='AungZeyar', descriptor=True, program=b'subset program #1'):
        # Keyed as ``parse_pdf_objects`` keys them, because that is what the loader
        # reads: ``(num, gen)``.
        objects = {(5, 0): (b'<< /Type /Font /Subtype /TrueType /BaseFont /' + base.encode()
                            + b' /FirstChar 0 /LastChar 255'
                            + (b' /FontDescriptor 6 0 R >>' if descriptor else b'>>'))}
        if descriptor:
            objects[(6, 0)] = b'<< /Type /FontDescriptor /FontFile2 7 0 R >>'
            objects[(7, 0)] = (b'<< /Length ' + str(len(program)).encode() + b' >>\nstream\n'
                               + program + b'\nendstream')
        return objects

    def _decoder(self, objects, doc=None):
        from myangustis_parser.extract import pdf_extract as PE
        from myangustis_parser.extract.pdf_fonts import FontResourceLoader, build_font_decoder
        loader = FontResourceLoader(objects, PE.get_stream, PE.parse_ttf_cmap,
                                    PE.parse_tounicode_stream)
        return build_font_decoder(loader, 'F', Ref(5, 0), doc or DocumentDecoding('legacy'))

    def test_the_face_identity_is_the_embedded_program(self):
        from myangustis_parser.extract import pdf_extract as PE
        objects = self._objects()
        program = PE.get_stream(objects, 7)
        self.assertTrue(program.startswith(b'subset program'))
        digest = hashlib.sha256(program).hexdigest()
        decoder = self._decoder(objects)
        self.assertEqual(decoder.program_sha256, digest)
        self.assertTrue(decoder.pairable)

    def test_the_identity_covers_a_cff_or_type1_program_too(self):
        """The pool was cut from TrueType; identity is not a TrueType question."""
        objects = self._objects(program=b'\x01\x00\x04\x00cff-ish header')
        objects[(6, 0)] = objects[(6, 0)].replace(b'/FontFile2', b'/FontFile3')
        from myangustis_parser.extract import pdf_extract as PE
        self.assertEqual(self._decoder(objects).program_sha256,
                         hashlib.sha256(PE.get_stream(objects, 7)).hexdigest())

    def test_the_profile_pool_pairing_stays_true_type_only(self):
        """A pool entry describes ``/FontFile2`` bytes; a CFF face must not pair.

        The 22 profiles in ``legacy-subset-profiles.json`` were cut from TrueType
        subsets, so the identity is broad (any program) while the pairing is narrow
        (FontFile2 only). Same digest, different file: no match.
        """
        from unittest.mock import patch
        from myangustis_parser.resources import maps
        from myangustis_parser.extract import pdf_extract as PE
        objects = self._objects(program=b'\x01\x00\x04\x00cff face')
        objects[(6, 0)] = objects[(6, 0)].replace(b'/FontFile2', b'/FontFile3')
        digest = hashlib.sha256(PE.get_stream(objects, 7)).hexdigest()
        profile = {'baseFont': 'aungzeyar', 'toUnicodeSha256': 'x', 'firstChar': 0,
                   'lastChar': 255, 'codePage': 'ayar', 'rawRuns': None}
        decoder = None
        with patch.object(maps, 'load_map', return_value={'profiles': {digest: profile}}):
            decoder = self._decoder(objects)
        self.assertEqual(decoder.program_sha256, digest, 'the face still has an identity')
        self.assertIsNone(decoder.confirmed_raw_runs)
        self.assertIsNot(decoder.font_legacy_code_page, LEGACY_CODE_PAGES['ayar'])

    def test_a_face_without_a_program_has_no_identity(self):
        decoder = self._decoder(self._objects(descriptor=False))
        self.assertIsNone(decoder.program_sha256)
        self.assertFalse(decoder.pairable)

    def test_a_lane_answer_is_honoured_only_for_its_own_program(self):
        """Same label, different cut: the pin follows the bytes, not the name."""
        from myangustis_parser.extract import pdf_extract as PE
        objects = self._objects()
        digest = hashlib.sha256(PE.get_stream(objects, 7)).hexdigest()
        doc = DocumentDecoding('legacy')
        doc.lane_trial = {digest: {'family': 'ayar'}}
        self.assertIs(self._decoder(objects, doc).font_legacy_code_page,
                      LEGACY_CODE_PAGES['ayar'])
        other = self._decoder(self._objects(program=b'a different cut of the same face'), doc)
        self.assertIsNot(other.font_legacy_code_page, LEGACY_CODE_PAGES['ayar'])
        self.assertFalse(other.family_pinned,
                         'an unpaired face is still the page itself to answer')

    def test_the_trial_commits_nothing_for_a_face_it_cannot_pair(self):
        """No program in the file -- no hash to pair -- so nothing is recorded."""
        pdf = simple_page_pdf({'F': 5}, self._content(), fonts={5: self._font_body()})
        legacy, shared = DocumentDecoding('legacy'), DocumentDecoding('font')
        self.assertFalse(lane_trial(self._loader(pdf), (3, 0), shared, legacy))
        self.assertEqual(legacy.lane_trial, {})

    def test_stem_instruction_and_zawgyi_trial_run_on_font_change_not_every_page(self):
        """Contiguous pages sharing a font set compute stem instruction and Zawgyi trial once."""
        import tempfile
        from unittest.mock import patch
        from pdfbuild import build_pdf
        from myangustis_parser.extract import legacy_lane_score
        from myangustis_parser.workflow import pipeline

        zg = 'ေျမန္မာႏိုင္ငံသားမ်ားအတြက္ ပညာေရးႏွင့္က်န္းမာေရး '
        chars = sorted(set(zg))
        bf = '\n'.join(f'<{i+33:02X}> <{ord(c):04X}>' for i, c in enumerate(chars)).encode()
        cmap = b'begincmap\n' + str(len(chars)).encode() + b' beginbfchar\n' + bf + b'\nendbfchar\nendcmap'
        codes = {c: i + 33 for i, c in enumerate(chars)}
        shown = (bytes(codes[c] for c in zg) * 5).hex().encode()
        content = b'BT /F 12 Tf 1 0 0 1 10 700 Tm <' + shown + b'> Tj ET'
        objects = {
            1: b'<< /Type /Catalog /Pages 2 0 R >>',
            2: b'<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R 6 0 R 7 0 R] /Count 5 >>',
            3: b'<< /Type /Page /Parent 2 0 R /Resources << /Font << /F 10 0 R >> >> /Contents 20 0 R >>',
            4: b'<< /Type /Page /Parent 2 0 R /Resources << /Font << /F 10 0 R >> >> /Contents 20 0 R >>',
            5: b'<< /Type /Page /Parent 2 0 R /Resources << /Font << /F 10 0 R >> >> /Contents 20 0 R >>',
            6: b'<< /Type /Page /Parent 2 0 R /Resources << /Font << /F 14 0 R >> >> /Contents 20 0 R >>',
            7: b'<< /Type /Page /Parent 2 0 R /Resources << /Font << /F 14 0 R >> >> /Contents 20 0 R >>',
            10: b'<< /Type /Font /Subtype /TrueType /BaseFont /SubA+ZawgyiOne /FirstChar 32 /LastChar 255 /Encoding << /Type /Encoding /Differences [33 /g33] >> /FontDescriptor 11 0 R /ToUnicode 13 0 R >>',
            11: b'<< /Type /FontDescriptor /FontFile2 12 0 R >>',
            12: (b'<< >>', b'\x00\x01\x00\x00subset-a-bytes'),
            13: (b'<< >>', cmap),
            14: b'<< /Type /Font /Subtype /TrueType /BaseFont /SubB+ZawgyiOne /FirstChar 32 /LastChar 255 /Encoding << /Type /Encoding /Differences [33 /g33] >> /FontDescriptor 15 0 R /ToUnicode 13 0 R >>',
            15: b'<< /Type /FontDescriptor /FontFile2 16 0 R >>',
            16: (b'<< >>', b'\x00\x01\x00\x00subset-b-bytes'),
            20: (b'<< >>', content),
        }
        with tempfile.TemporaryDirectory() as tmp:
            pdf_path = Path(tmp) / 'batch.pdf'
            pdf_path.write_bytes(build_pdf(objects))
            with patch.object(pipeline, 'instruction_lane', wraps=pipeline.instruction_lane) as inst, \
                 patch.object(legacy_lane_score, 'trial_lane', wraps=legacy_lane_score.trial_lane) as trial:
                _, npages, pages = pipeline.stream_pdf_pages(pdf_path, text_layout='off')
                extracted = list(pages)
            self.assertEqual((npages, len(extracted)), (5, 5))
            self.assertEqual(inst.call_count, 2, 'stem instruction must run once per distinct font set')
            self.assertEqual(trial.call_count, 2, 'lane_trial must settle each Zawgyi font program once')

    # -- helpers for the page-level door --------------------------------------
    @staticmethod
    def _font_body(descriptor=False):
        return (b'<< /Type /Font /Subtype /TrueType /BaseFont /AungZeyar'
                b' /FirstChar 0 /LastChar 255'
                + (b' /FontDescriptor 6 0 R' if descriptor else b'') + b' >>')

    @staticmethod
    def _content():
        return (b'BT /F 12 Tf 1 0 0 1 10 700 Tm <' + SAMPLE.hex().upper().encode() + b'> Tj ET')

    @staticmethod
    def _loader(pdf):
        from myangustis_parser.extract import pdf_extract as PE
        from myangustis_parser.extract.pdf_extract import FontResourceLoader
        return FontResourceLoader(parse_pdf_objects(pdf), PE.get_stream, PE.parse_ttf_cmap,
                                  PE.parse_tounicode_stream)


if __name__ == '__main__':
    unittest.main()
