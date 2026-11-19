"""The call between WinInnwa and Ayar, with every signal it needs imported here.

(Legacy lane score) Asked by the instructor, once per face, on one page.

The lane gate (``resources/font_names.legacy_font_family``) names a family from
the stem parser's reading of the font. When it cannot, this module decides: the
instructor hands it the page's own shown strings for that resource and a decode
callback, and it reads them through each candidate code page and scores both.

It is a separate module rather than another arm of the parsing chain on purpose:
running the page twice through the chain would score the same bytes but leave a
reader unable to tell whether they were looking at a parse or at a decision, and
a decision that has been parsed twice can be applied twice. So the two readings
happen in here, none of them enters ``workflow/pipeline``, and everything the
score needs is imported rather than threaded: ``mm_score`` for structure,
``cleanup.order_text`` so a reading is judged in the order it would be kept in,
``scan`` for the seven pairs no real Burmese produces, ``legacy_order`` for the
shared glyph, and ``judgement.english_likeness`` for what a wrong table leaves
behind -- Latin junk that is not English either.

The thresholds are not restated here: they come from
``extract/legacy_judgement``, the mirrored scorer, which this module wraps so the
mirror's arithmetic and this module's extra signal cannot drift apart.
"""
from __future__ import annotations

from myangustis_parser.extract.legacy_judgement import (LEGACY_MODERN_CEILING,
                                                        LEGACY_QUALITY_FLOOR,
                                                        LEGACY_READABLE_FLOOR,
                                                        MIN_PROBE_MARKS,
                                                        decide_legacy_family)
import re

from myangustis_parser.normalize import mm_score
from myangustis_parser.normalize.judgement import english_likeness

__all__ = ["decide_lane", "trial_lane", "english_phrase_test", "ENGLISH_WEIGHT"]

#: How much of the quality a reading loses when its Latin side is junk rather
#: than English. A wrong legacy table decodes bridge bytes into Latin that has no
#: vowels and no spaces; a right one either has no Latin at all or has real
#: English (a heading, a URL) which must not be punished. See
#: ``normalize/judgement.english_likeness``: ``not-english`` is the signal, and
#: an abstention (``None``) is not evidence either way.
ENGLISH_WEIGHT = 0.25


def _english_penalty(reading):
    verdict = english_likeness(reading)
    if verdict['verdict'] != 'not-english' or not verdict['letters']:
        return 0.0, verdict
    # Weighted by how much Latin there is: one stray punctuation cluster should
    # not outvote the Burmese the reading got right.
    return ENGLISH_WEIGHT * min(1.0, verdict['letters'] / 40.0), verdict


#: An English phrase is spaced words. A run of letters that never sees a space is a
#: legacy keyboard's residue glued to the Burmese it failed to spell -- ``aမနေ့ကb`` --
#: and that must not be scored as English or against anything: the Burmese inside it
#: already says what the page is. So the test is run on the phrases alone.
#: ``judgement.english_likeness`` reaches the same conclusion from the other side
#: (an unbroken Latin run is answered ``not-english``), which is why it is called
#: here rather than changed: it stays the shared judge, this is the lane's reading of it.
_PHRASE_RE = re.compile("[A-Za-z][A-Za-z\u2019']*(?:[ ,.;:!?()\u2013\u2014/'-]+[A-Za-z][A-Za-z\u2019']*)+")
_MYANMAR_WORD_RE = re.compile(r"[\u1000-\u109f]{2,}")
_LATIN_WORD_RE = re.compile(r"[A-Za-z]{2,}")


def english_phrase_test(reading):
    """Separate a modern reading into English phrases and Burmese words, then score
    the phrases alone.

    Two things follow, and they are the whole of what the lane does with them. A real
    English sentence reads as English under EITHER lane -- a ZawCode page can carry a
    title in Latin, a Unicode page can carry a verse -- so "this is English" is not
    evidence that the page is modern. What is evidence is the pair: English phrases
    with no Burmese word anywhere on the page is a Latin page, and going legacy on it
    is the mistake this test exists to prevent. English phrases WITH Burmese words on
    the page is one sentence out of hundreds, and its score is downgraded by exactly
    that ratio, so it weighs as a penalty against the legacy lane without ever
    settling the page.
    """
    text = str(reading or "")
    phrases = _PHRASE_RE.findall(text)
    words = sum(len(_LATIN_WORD_RE.findall(phrase)) for phrase in phrases)
    burmese = len(_MYANMAR_WORD_RE.findall(text))
    verdict = english_likeness(" ".join(phrases)) if phrases else {"verdict": None, "score": 0,
                                                                   "letters": 0, "runs": 0,
                                                                   "hasSpaces": False,
                                                                   "violationRate": 0}
    penalty = 0.0
    if verdict.get("verdict") == "english":
        # Downgraded by the Burmese on the page: one sentence against many words.
        penalty = ENGLISH_WEIGHT / (1.0 + burmese) if burmese else ENGLISH_WEIGHT
    return {"phrases": len(phrases), "words": words, "burmeseWords": burmese,
            "verdict": verdict.get("verdict"), "score": round(verdict.get("score", 0), 4),
            "letters": verdict.get("letters", 0), "penalty": round(penalty, 4),
            # A Latin page: English phrases, and no Burmese word on the page at all.
            "englishPage": bool(verdict.get("verdict") == "english" and phrases and not burmese)}


def trial_lane(readings, modern_reading):
    """Which lane a page belongs to: the winner of the two legacy readings, or modern.

    (Lane trial) Asked by the instructor once per page, at the lane decision -- the
    spot where the page is still on both sides of the fork.

    ``readings`` is ``{"ayar": text, "wininnwa": text}``: one page's shown strings,
    read through each legacy table, both produced and neither thrown away. They are
    handed in already decoded, because the trial is not a parse -- nothing here
    re-reads the content stream or joins a page, and the lane is still being chosen.
    ``modern_reading`` is what the face's own map made of those same bytes.

    The rule is the judge's, with the two legacy tables run against each other in
    parallel instead of one map being trusted first: the better of the two readings
    has to clear ``LEGACY_READABLE_FLOOR``, and it is judged in the ZawCode visual
    order, because at this point beautify has not run and a mark sitting at its
    table's slot is correct Burmese, not damage (see ``legacy_order.visual_order``).
    The page then goes to the legacy method only when the map reading it would
    otherwise keep is ASCII junk -- ``english_likeness`` true, and not real English.
    Anything at or below ``LEGACY_MODERN_CEILING``, a sample too short to move a
    page, and any readable map reading: the modern lane, whose beautify handles it
    at the final stage, on its own.
    """
    tables = {name: None for name in readings}
    probe = decide_legacy_family(lambda table, name: readings.get(name, ""), tables,
                                 default="wininnwa")
    names = [name for name, _score in probe["ranking"]]
    best = names[0] if names else None
    evidence = probe["evidence"]
    score = probe["score"]
    marks = (evidence.get(best) or {}).get("marks", 0) if best else 0
    broken = (evidence.get(best) or {}).get("impossible", 0) if best else 0
    readable = bool(probe["accepted"]) and not broken
    modern = english_phrase_test(modern_reading)
    modern_score = mm_score.score_text(modern_reading or "")
    penalty = modern["penalty"]
    # The penalty is read in the OPPOSITE direction to the way an English-likeness
    # test is usually spent. It is not a requirement that the map's reading be junk
    # before the legacy side may be taken -- that asked the weakest signal to open
    # the door, and on a book whose Latin headings are real headings it never opens.
    # It is a bar the legacy reading has to clear, in two pieces: a page of English
    # with no Burmese word on it is a Latin page and is not moved at all
    # (``englishPage``), and elsewhere the English sentence costs the legacy reading
    # its share of the page, downgraded by the Burmese it stands next to.
    quality = max(0.0, score - penalty)
    readable = bool(readable and quality > LEGACY_READABLE_FLOOR)
    # And the winner has to beat what the map already gave, not merely clear a floor:
    # a page whose own map reads as aligned Burmese needs no table, and no legacy
    # reading of it will out-score it. This is what keeps a Unicode book alone.
    beats_map = quality > max(LEGACY_READABLE_FLOOR, modern_score["score"])
    if not names or not marks:
        reason = "no-burmese"
    elif marks < MIN_PROBE_MARKS:
        # Too little on THIS page to move it. The page is not sent anywhere on a
        # 17-mark sample; a page that really is legacy fills 50 marks by itself.
        reason = "short-page"
    elif not readable:
        reason = ("impossible-pair" if broken else
                  "modern-ceiling" if score <= LEGACY_MODERN_CEILING else "below-floor")
    elif modern["englishPage"]:
        reason = "english-page"
    elif not beats_map:
        reason = "map-reads-burmese"
    else:
        reason = "legacy-readable"
    lane = "legacy" if reason == "legacy-readable" else "modern"
    return {"lane": lane, "family": best if lane == "legacy" else None,
            "score": round(score, 4), "marks": marks, "reason": reason,
            "floor": LEGACY_READABLE_FLOOR, "ceiling": LEGACY_MODERN_CEILING,
            "quality": round(quality, 4),
            "modernScore": round(modern_score["score"], 4),
            "modernMyanmar": round(modern_score["myanmar_ratio"], 4),
            "modernEnglish": modern, "modernPenalty": round(penalty, 4),
            "ranking": [[name, round(item, 4)] for name, item in probe["ranking"]]}


def decide_lane(decode_reading, code_pages=None, *, default=None):
    """Score every candidate reading of one page and return the winning lane.

    ``decode_reading(page, name)`` returns that code page's reading of the page,
    produced by the caller -- the face's own decode with nothing but the table
    swapped -- so this module never has to know how a font is read.

    The mirrored scorer ranks the readings; the English-likeness test then breaks
    or confirms the tie it cannot see. The keys, and the meaning of each, are the
    mirror's: ``codePage`` and ``name`` are ``None`` when nothing was accepted, so
    a caller can tell "decided" from "looked, and could not tell" without reading
    the ranking. Acceptance is relative -- the better of the two readings, on a
    sample with enough marks to compare -- and ``insufficient`` says why a "no"
    was a short look rather than a tie. ``mirror`` carries what the mirrored
    scorer alone decided, its absolute floor included, so the difference between
    the two rules stays auditable instead of being blended in.
    """
    if code_pages is None:
        # Lazy: the tables live in the extract layer, which imports this module.
        from myangustis_parser.extract.pdf_fonts import LEGACY_CODE_PAGES
        code_pages = LEGACY_CODE_PAGES
    probe = decide_legacy_family(decode_reading, code_pages, default=default)
    samples = probe.get('samples') or {}
    ranking, evidence = [], {}
    for name, quality in probe['ranking']:
        penalty, verdict = _english_penalty(samples.get(name, ''))
        broken = probe['evidence'].get(name, {}).get('impossible', 0)
        # The mirror's veto is lexicographic and stays that way: a reading with a
        # pair no real Burmese produces is not bought back by any weight.
        ranking.append((name, 0.0 if quality and broken else quality - penalty))
        evidence[name] = {'penalty': round(penalty, 4), 'english': verdict,
                          'mirror': probe['evidence'].get(name, {})}
    ranking.sort(key=lambda item: -item[1])
    mirror = {'name': probe['name'], 'score': probe['score'],
              'accepted': probe['accepted'], 'floor': LEGACY_QUALITY_FLOOR,
              'minMarks': MIN_PROBE_MARKS}
    if not ranking:
        return {'codePage': None, 'name': None, 'score': 0.0, 'marks': 0,
                'accepted': False, 'insufficient': True, 'floor': LEGACY_QUALITY_FLOOR,
                'ranking': [], 'samples': samples, 'evidence': evidence, 'mirror': mirror}
    name, score = ranking[0]
    # Acceptance is RELATIVE, and this is the correction the books demanded. The
    # question this module is asked is "which of these two readings of the SAME
    # bytes is real Burmese", not "is this reading clean". Measured on real books
    # the absolute floor cannot be met at all: part-4's 63 probes topped out at
    # 0.7158 and part-1's 136 accepted none, because a legacy page legitimately
    # carries its marks in the order its own table wrote them, and mm-score's
    # ``1 - max(orphan, disorder)`` charges for exactly that. An absolute floor
    # therefore decided nothing except to abstain, the face kept the table it was
    # handed, and the lane's repair never saw a better reading.
    #
    # Two things are still required, because they are the two that make a
    # comparison meaningful rather than a coin toss: a sample with enough marks to
    # judge (``MIN_PROBE_MARKS``, the mirror's own gate -- below it the caller may
    # try again on a later page, see ``FontDecoder.settle_legacy_family``), and a
    # winner. A tie is not evidence, so the default is first in the ranking and a
    # tie keeps the face where the name gate left it.
    marks = (probe['evidence'].get(name) or {}).get('marks', 0)
    enough = marks >= MIN_PROBE_MARKS
    accepted = bool(enough)
    return {'codePage': code_pages[name] if accepted else None,
            'name': name if accepted else None,
            'score': score, 'marks': marks, 'accepted': accepted,
            'insufficient': not enough, 'floor': LEGACY_QUALITY_FLOOR,
            'ranking': ranking, 'samples': samples, 'evidence': evidence,
            'mirror': mirror}
