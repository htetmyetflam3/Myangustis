"""The Ayar-or-WinInnwa decision, mirrored from ``@core/pdf/legacy-judgement.js``.

(Legacy judgement) Legacy lane, no chain position -- the legacy lane's own
judgement layer, for a face whose name is unknown.

This layer does not decode Unicode and it does not decode the legacy lane. It
only decides between Ayar and WinInnwa: the caller decodes the same page sample
under each code page, and this layer scores which reading is real Burmese and
returns the winning page. It is called only when the name gate could not name
the family (``font_names.legacy_font_family`` -> ``None``) -- a known name never
reaches here -- and no lane is chosen here: the font is already inside the
legacy lane when this runs.

The JS header records that this was restored from a lost ``extend/`` helper, and
that the vector-layout and logging parts of the original were not restored. The
Python port keeps the pure scorer here and puts its two callers where the design
already puts the rest of the legacy lane: the sample is collected by the page
reader (``extract/pdf_extract._settle_legacy_families``) and applied to the face
by the decoder (``extract/pdf_fonts.FontDecoder.settle_legacy_family``), because
this module owns neither content nor tables.

One deliberate difference from JS: the ranking puts the documented default first,
so a tie keeps the face on that table. Two readings that score the same are not
evidence for either, and JS's stable sort would have handed the tie to whichever
table its Map happened to list first.
"""

from __future__ import annotations

from myangustis_parser.normalize import legacy_order, mm_score, scan
from myangustis_parser.normalize.cleanup import order_text

__all__ = ["LEGACY_QUALITY_FLOOR", "LEGACY_READABLE_FLOOR", "LEGACY_MODERN_CEILING",
              "MIN_PROBE_MARKS", "STRUCTURAL_WEIGHT", "decide_legacy_family"]

#: A reading has to clear THIS before either legacy table may be chosen. 0.4, not
#: the mirror's 0.85: measured on the books, the floor above was never reachable
#: (part-4's 63 probes topped out at 0.7158, part-1's 136 accepted none) because
#: it charged a not-yet-beautified page for its own table's mark order -- see
#: ``legacy_order.visual_order``. The mirror's number stays declared above for the
#: JS comparison, and ``decide_lane`` still records it beside its own verdict.
LEGACY_READABLE_FLOOR = 0.4

#: At or below this, the reading is not Burmese: say so and let the caller hand
#: the page to the modern lane, whose beautify deals with it at the final stage
#: on its own. The band between the two numbers is treated as "below": 0.4 is the
#: gate a reading has to be ABOVE, so nothing sits in the band by accident.
LEGACY_MODERN_CEILING = 0.3

#: The mirror's own floor, kept for the JS comparison and for the record.
#: Below the floor the face stays on its default, because a page that reads
#: badly under both tables says nothing about which one it was written for.
LEGACY_QUALITY_FLOOR = 0.85

#: A reading with fewer dependent marks than this is not evidence. The score is
#: a rate, so a two-glyph sample reaches 1.0 as easily as it reaches nothing.
MIN_PROBE_MARKS = 50

#: One mark's worth of quality, per shared glyph the table resolved the wrong
#: way. Both readings come from the same bytes, so a digit inside a syllable run
#: on one side and not the other is two tables disagreeing about a glyph they
#: share -- worth about one mark of the score, not a whole category.
STRUCTURAL_WEIGHT = 1.0


def decide_legacy_family(decode_sample, code_pages=None, *, default=None):
    """Rank the candidate code pages by how well the same sample reads.

    ``decode_sample(page, name)`` returns the sample text decoded through that
    code page -- the caller owns all decoding, so the two readings are the
    font's own reading path with nothing but the table swapped.

    Returns ``{'codePage', 'name', 'score', 'accepted', 'ranking', 'samples',
    'evidence'}`` (the JS keys plus the per-candidate counts, so a diff against
    the module reads line for line). ``name``
    and ``score`` describe the best reading whether or not it was accepted;
    ``codePage`` is ``None`` when it was not, so a caller can tell "decided"
    from "looked, and could not tell" without re-reading the ranking.
    """
    if code_pages is None:
        # Lazy: the tables live in the extract layer, which imports this module.
        from myangustis_parser.extract.pdf_fonts import LEGACY_CODE_PAGES
        code_pages = LEGACY_CODE_PAGES
    if default not in code_pages:
        default = next(iter(code_pages), None)
    # The default first, then the rest: a tie is not evidence, so it keeps the
    # face where it started instead of sliding to whichever entry came first.
    order, seen = [], set()
    for name in (default, *code_pages):
        if name in code_pages and name not in seen:
            seen.add(name)
            order.append(name)
    ranking, samples, evidence = [], {}, {}
    for name in order:
        try:
            sample = str(decode_sample(code_pages[name], name) or "")
        except Exception:
            sample = ""
        samples[name] = sample
        # The reading is scored in the ZawCode visual order. This sample has not
        # been through beautify -- the lane is being chosen, not finished -- so its
        # marks sit at their table's slots, and ``orphan``/``disorder`` charge for
        # exactly that. Lifting the charge is the whole point of the flip: a wrong
        # table still loses, because a wrong table loses on the LETTERS it produced,
        # and those are what ``impossible``, ``number_in_word_sites`` and
        # ``english_likeness`` look at -- all three kept on the RAW reading below, so
        # the flip may excuse an order, it may not buy back a pair no real Burmese
        # produces. ``storedOrder`` records what the unflipped reading scored, so the
        # difference the flip makes stays auditable instead of being blended in.
        result = mm_score.score_text(order_text(legacy_order.visual_order(sample)))
        marks = result['marks']
        quality = 0.0 if marks < MIN_PROBE_MARKS else result['score']
        # Two structural signals, each consulted only here -- see
        # ``normalize/scan.py`` for why the scanner keeps them out of decisions.
        #
        # ``impossible`` is a veto, not a weight: each of the seven pairs was
        # found by reading a wrong byte, so a reading that contains one is a
        # mis-decoding however fluently it scores. Sorting structurally-clean
        # readings first makes the veto lexicographic, which means no weight can
        # be tuned until it buys a broken page back.
        broken = len(scan.impossible_hits(sample))
        # The shared glyph is worth one mark each: ၀ inside a word says this
        # table resolved the code to the numeral, and a run of pure digits says
        # nothing at all. See ``legacy_order.number_in_word_sites``.
        sites = len(legacy_order.number_in_word_sites(sample))
        if quality:
            quality = max(0.0, quality - STRUCTURAL_WEIGHT * sites / max(marks, 1))
        evidence[name] = {'marks': marks, 'score': result['score'], 'quality': quality,
                          'impossible': broken, 'homoglyphSites': sites,
                          'storedOrder': mm_score.score_text(order_text(sample))['score']}
        ranking.append((name, quality))
    # Clean first, then by quality; the default already sits first in ``order``,
    # so a tie between two clean readings keeps the face where it started.
    ranking.sort(key=lambda item: (evidence[item[0]]['impossible'] > 0, -item[1]))
    if not ranking:
        return {'codePage': None, 'name': None, 'score': 0.0, 'accepted': False,
                'ranking': [], 'samples': samples, 'evidence': evidence}
    name, score = ranking[0]
    # The judge, swapped for the two parallel readings: a readable Burmese score
    # above the floor, on a sample that carries Burmese at all. ``marks`` is the
    # "no Burmese at all" test -- a page of Latin or of nothing is refused here and
    # goes to the modern lane, which is where its own map belongs.
    accepted = bool(score > LEGACY_READABLE_FLOOR and evidence[name]['marks'] > 0)
    return {'codePage': code_pages[name] if accepted else None,
            'name': name if accepted else None,
            'score': score,
            'accepted': accepted,
            'ranking': ranking,
            'samples': samples,
            'evidence': evidence}
