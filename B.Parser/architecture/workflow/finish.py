"""The Parser-owned finishing stage shared by decoded and OCR text.

Structural scoring precedes the parsing-only decision. OCR skips that rule
layer; both lanes then use the same clean and structural scan. The separate
post-output POS scan consumes Engine output, not this structural scan. Vector
repair is intentionally not implemented or called here.
"""
from __future__ import annotations

import re

from myangustis_parser.normalize import judgement, mm_score, scan
from myangustis_parser.normalize.detector import contains_myanmar
from myangustis_parser.normalize.beautify import arrange_zawcode_order, zawcode_slot_candidate
# PHASE 2's normalizer lives with the cleanup it belongs to: clean.cleanup's
# ``normalize_phase2`` -- the Engine's ``normalizeText`` copied there. It is not
# imported from the Engine, so the Engine keeps one owner of its own characters
# and this phase keeps one owner of its own.
from myangustis_parser.normalize.cleanup import cleanup_text, normalize_phase2, order_text
from myangustis_parser.normalize import legacy_ascii, legacy_order
from myangustis_parser.normalize.rabbit import Rabbit


def decide(text, *, source, parsing_path='font-cmap', zawgyi_codepage=False,
           already_zawcode=False, source_encoding='auto'):
    if source not in ('parse', 'ocr'):
        raise ValueError("source must be 'parse' or 'ocr'")
    if parsing_path not in ('font-cmap', 'legacy'):
        raise ValueError('Unknown parsing path')
    if source_encoding not in ('auto', 'unicode', 'zawgyi-one'):
        raise ValueError('Unknown source encoding')
    score = mm_score.score_text(text)
    if source == 'ocr':
        return 'ocr', score
    if source_encoding == 'unicode':
        return 'aligned', score
    if source_encoding == 'zawgyi-one':
        return 'rabbit', score
    if already_zawcode:
        return 'aligned', score  # font-scoped draft was ordered during extraction
    swap = (lambda value: value) if zawgyi_codepage else zawcode_slot_candidate
    evidence = judgement.judge_page_lines(text.split('\n'), swap)
    return judgement.select_page_decision(evidence, parsing_path, zawgyi_codepage), score


def apply_decision(text, decision, *, legacy_layout=None):
    """Apply the lane's own beautify rule to the text the decode stage produced.

    One slot, one rule per lane: the ZawCode lane gets ``arrange_zawcode_order``,
    the legacy lane gets ``legacy_order.arrange_legacy_order`` (a legacy page's
    visual order is a code-page fact, issued by the stem parser's instruction,
    never a font name), the Rabbit lane gets the conversion. ``aligned`` has no
    rule of its own and no follow-up either: an aligned reading ships as
    decoded. Legacy ASCII slots are repaired where the page's runs are joined,
    not here: this stage orders and cleans, and it must not carry a second pass
    that only one lane can see.
    """
    if decision == 'ocr':
        return text
    if decision == 'rabbit':
        return Rabbit.zg2uni(text)
    if decision == 'zawcode':
        return arrange_zawcode_order(text)
    if decision == 'legacy':
        # Two cases, chosen by the identified code page (see the rule's docstring):
        # 'wininnwa'/'ayar' take the plain slot order, None/'zawcode' the swap.
        return legacy_order.arrange_legacy_order(text, layout=legacy_layout)
    if decision == 'aligned':
        return text
    raise ValueError(f'Unknown Parser decision: {decision}')


def ordered(text):
    """Normalize alone -- the report's ``base`` column, never a page's output.

    ``base`` sits beside ``clean`` in the finalized-page record because
    ``n_changes`` is the difference between the two, and the JS oracle reaches
    that pair by passing a third argument, ``applyCleanup``, to
    ``convertFinalizedPageText``. This module has no such argument: the pair comes
    from :func:`finalized_output`, so no caller can hold a page's text back from
    its cleanup half. The JS flag is recorded in ``B.Parser/AUDIT.md`` as the
    mirror's own thing to delete.
    """
    return order_text(text)


# ══════════════════════════════════════════════════════════════════════════
# THE GATE -- normalize, called after the page's parsing finishes.
#
# Every page of every lane comes through this function: the Unicode lane, the
# Zawgyi lane (after Rabbit), the legacy lane, OCR, and UNKNOWN. It is internal
# routing and it has no switch -- nothing may pass a flag to skip a half of it,
# no lane has its own variant, and there is no second copy of the ordering
# anywhere else in the parser. When this returns, the page's parsing is finished
# and the page leaves the parsing chain: nothing downstream re-opens its text.
#
# JS's own words for this place, which is why the gate is one step and not two:
#   "@postprocess/beautify/zawcode-order.js"  These rules rewrite text; deciding
#       stays in @rule/judgement.js... beautify is the parsing chain, repair is a
#       later runtime stage.
#   "@rule/mm-score.js"  Broken text is rejected here... This module never
#       rewrites text.  /  "@rule/judgement.js"  ...which this module asks for
#       evidence. Nothing here rewrites text.
#   "@core/runtime/finalized-cmap.js"  Every beautify rule layer gets clean.js as
#       its follow-up here, then the page is finished... Do not add a blanket
#       second ordering pass behind this finish.  And for this lane: "Legacy pages
#       are written as decoded, then given the one shared ordering every lane gets
#       at page finish. There is no legacy-specific reorder rule: extraction only
#       decodes."  -- that last sentence describes the MIRROR. This tree's legacy
#       slot is filled: `normalize/legacy_order.arrange_legacy_order` runs in the
#       `legacy` branch below, in one of its two cases, and the difference against
#       JS is the documented parity gap (AUDIT.md, "The legacy ordering rule: two
#       cases, chosen by the code page").
#
# WHICH NORMALIZE. Two things are called by that name and they are not the same
# pass. (1) ``cleanup.order_text``/``cleanup_text`` -- ``clean.js``'s ordering and
# imposter step -- are the follow-up of the beautify rule and run here, beside
# mm-score and the ZawCode swap: that pair is (2)'s neighbour, never its
# container. (2) the FINAL gate -- and it has no module of its own, by design: the
# deleted ``B.Parser/main/parser/text/normalize.js`` says "There is deliberately no
# normalize.py -- this module has NO Python counterpart", and names ``cleanup.py``
# as the owner of the five functions and ``mm_score.py`` as the owner of MARKS (so
# neither ``clean.py`` nor a parser ``normalize.py`` has ever existed here). The
# gate: the parser must NOT call the Engine's normalize as a second, separate
# pass. The chain reaches the Engine once, at its end -- ``normalize/pos_scan.py``
# hands the finished lines to the bind-engine api (``myangustis_engine.api.collect``)
# -- and the Engine's own ``normalize`` already runs behind that call, as the FIRST
# thing it does with the text it is handed. Traced, so this is not an assumption:
#
#   JS  @postprocess/bind-engine.js       bindEngine(request) -> BindEngine(request)
#       A.Engine/.../init/bridge.js:12    async function* Engine({ sourceText, flag, log })
#       A.Engine/.../init/bridge.js:19    readFromApi(sourceText)
#       .../MonoSyllabism/generators/input.js   for await (block of collectFromText(text)):
#                                                cleaned = normalize(block); mapperStr(cleaned)
#   Py  myangustis_engine/api.py:6-8      collect -> bind_engine({'sourceText', 'flag', 'log'})
#       myangustis_engine/init/bridge.py:17,42   bind_engine(request) -> read_from_api(source, mapper)
#       .../MonoSyllabism/generators/input.py:3-5  yield runtime.mapperNormalize(block)
#       .../MonoSyllabism/map/normalize.py:95,89   mapperNormalize = mapperStr(reorderAndWrap(normalize(t)))
#                                                 normalize = NFC -> from_utf16 -> Glue strip -> cleanImposters
#
# Two consequences, both rules. (a) A normalize on the parser's side is the same
# pass twice, run on the wrong side of the door. (b) It is not a repair either:
# what comes back from bind is tagged analysis OF the normalized text, and the
# normalized text is never written back over the file -- so a mark that survives
# into a finished page is a bug in (1) above, never something to pre-normalize
# around. Removing the parser's copy therefore loses nothing and changes no byte.
#
# The plumbing that made a separate call possible (``normalize_page_lines`` /
# ``normalize_output_text``, the TEXT KEEPING section inherited from the deleted
# ``normalize.js``) is therefore **deleted** here, together with the two
# ``test_mirror.py`` pins that were its only callers. Nothing else in the tree
# reached it, and nothing may add it back: a normalize beside the gate is a second
# owner of the same characters, invisible to every lane that does not call it.
# There is likewise no protected or preserved character set -- characters the chain
# does not itself handle flow through its transforms naturally, which is what the
# inherited header said and what this gate relies on.
#
# The pinned JS is in the same state and takes the same verdict, as a NOTE rather
# than an edit: at ``67f02845`` the only code that fetches the Engine normalize
# separately is ``test/parser-test/zawcode-order.test.js``, through the orphaned
# ``@rule/judgement.js`` ``normalizePageLines``/``normalizeOutputText`` and the
# ``getEngineNormalize`` re-export in ``B.Parser/_path.js`` / ``index-path.js`` --
# production chain: no caller. Deleting those is main's action, recorded in
# ``B.Parser/AUDIT.md``, "The separate Engine-normalize call is deleted; bind
# engine is the only door".
#
# REMINDER, because this is where the temptation sits: if a page still shows a
# mark out of place, the rule is missing from (1) or (2) above, or the code page
# the page was decoded through was the wrong one -- fix it there. Do not add a
# pass here, in the extraction join, or in a lane-specific helper "for the legacy
# case": a repair beside the gate is invisible to every other lane, unparitable
# with the JS chain, and it leaves the next reader unable to tell which of the
# two the text went through.
# ══════════════════════════════════════════════════════════════════════════
def clean_page(text):
    """PHASE 2 -- ``clean.py``'s cleanup half, and nothing else.

    The normalizer is ``clean.normalize_phase2``, the copy of the Engine's
    ``normalizeText``: the Engine's ``normalize`` -- NFC -> glue strip ->
    cleanImposters -- then ``reorderAndWrap``'s middle step only, the mark run
    sorted by ``Priority``, then the spaces in front of a detached
    ``base + asat`` head removed. The mapper's wrapping and ``mapperStr`` are
    not part of it. ``mapperNormalize``
    itself is ``mapperStr(reorderAndWrap(normalize(t)))`` and is never written
    back -- that is the Engine's reading input. It carries no pre-base movement
    -- ``pipeline.py:750`` says so in as many words ("JS's cleanup follow-up
    does not perform pre-base mark movement") -- because moving a pre-base mark
    is a lane's repair, and this phase is the follow-up every lane gets after
    its own stage 1.1, not a repair of its own.

    Two passes, in this order and no others, both in ``clean.normalize_phase2``:

        pass 1  normalize, then the mark run sorted by ``Priority``
        pass 2  spaces in front of a detached ``base + asat [U+1038 | U+1037]``
                head removed -- that pattern only

    This is the phase that used to run ``order_text`` instead, which is how a
    page with no rule applied still had characters moved: ``order_text`` ends in
    ``move_prebase_marks``, a per-cluster rewrite that consults the syllable
    inventory and re-attaches a `ေ` to a consonant it never belonged to.
    """
    return normalize_phase2(text)


def clean(text):
    """Both halves, for the callers that ask for the ordered reading as well."""
    return cleanup_text(ordered(text))


def finish_text(text, *, source, parsing_path='font-cmap', zawgyi_codepage=False,
                already_zawcode=False, source_encoding='auto'):
    """Return both preview variants and the structural scan of cleaned output."""
    decision, score = decide(text, source=source, parsing_path=parsing_path,
                             zawgyi_codepage=zawgyi_codepage,
                             already_zawcode=already_zawcode, source_encoding=source_encoding)
    converted = apply_decision(text, decision)
    # Same chain as the PDF finish: stage 1.1's result is `base`, phase 2 is
    # `clean`. A legacy page takes the follow-up too -- it is cleanup, not an
    # ordering rule, so no lane is exempt from it and no lane gets more.
    base = converted
    cleaned = clean_page(converted)
    return {'decision': decision, 'score': score, 'base': base,
            'clean': cleaned, 'scan': scan.scan_text(cleaned)}


# JS's FINAL_UNICODE_DECISIONS: the lanes the finalized-page step owns.
FINALIZED_OUTPUT_DECISIONS = ('aligned', 'zawcode', 'unaligned-unicode', 'rabbit')


def finalized_output(text, decision):
    """The finalized page's ``(base, clean)`` pair, from JS's output step.

    Legacy was ordered earlier, and a decision outside JS's final set is handed on
    as supplied in both columns. Both halves come from here so the two columns can
    never disagree about what the gate was, and the pair cannot be split into a
    mode where a page ships ordered-but-uncleaned.
    """
    if decision not in FINALIZED_OUTPUT_DECISIONS:
        return text, text
    # PHASE 2 for every lane, aligned included: clean.py's cleanup half is the
    # follow-up each lane gets, and it is not a rule. `base` is the page exactly
    # as phase 1 left it -- stage 1.1's rule applied, or nothing for aligned.
    return text, clean_page(text)


def finalize_pdf_output(text, decision):
    """:func:`finalized_output`'s second half, for one line at a time."""
    return finalized_output(text, decision)[1]


def finish_pdf_page(text, *, parsing_path='font-cmap', zawgyi_codepage=False,
                    source_encoding='auto', legacy_layout=None):
    """Finish a decoded PDF page using the JS PDF page decision and output steps.

    Source encoding selects the PDF instruction lane and suppresses a world
    spelling correction for Unicode; it does not force this finish decision.
    """
    if parsing_path not in ('font-cmap', 'legacy'):
        raise ValueError('Unknown parsing path')
    if source_encoding not in ('auto', 'unicode', 'zawgyi-one'):
        raise ValueError('Unknown source encoding')
    # PHASE 1 -- parsing. The decode already happened upstream; stage 1 is the
    # text it produced. Everything below is stage 1.1: decide the lane, then
    # apply that lane's rule. An aligned reading passes through with no rule;
    # only an unaligned one is asked whether it is ZawCode or Rabbit.
    swap = (lambda value: value) if zawgyi_codepage else zawcode_slot_candidate
    evidence = judgement.judge_page_lines(text.split('\n'), swap)
    decision = judgement.select_page_decision(evidence, parsing_path, zawgyi_codepage)
    if decision == 'aligned':
        # Stage 1.1, aligned branch: nothing is applied. No swap, no Rabbit, no
        # ordering. Phase 2 is the only thing this page still meets.
        finished = text
    elif decision == 'legacy':
        # Stage 1.1, legacy branch: the lane's own rule, per line, in one of its
        # two cases -- ``legacy_layout`` is the code page the face was read through
        # ('wininnwa'/'ayar' plain slots, None/'zawcode' the swap). Phase 2 then
        # gives it the same cleanup follow-up every lane gets. JS's legacy branch
        # has no such rule (``@core/runtime/finalized-cmap.js``: "There is no
        # legacy-specific reorder rule: extraction only decodes"), so this is the
        # parser leading the mirror; see B.Parser/AUDIT.md, "The legacy ordering
        # rule: two cases, chosen by the code page".
        finished = '\n'.join(apply_decision(line, 'legacy', legacy_layout=legacy_layout)
                             for line in text.split('\n'))
    else:
        finished = apply_decision(text, decision)
        if decision == 'rabbit' and source_encoding != 'unicode':
            finished = re.sub(r'က(?:မၻာ|မ်ဘာ)', 'ကမ္ဘာ', finished)
    category = ('UNKNOWN' if not contains_myanmar(finished) else
                'ZAWGYI' if decision == 'rabbit' else 'UNICODE')
    base, cleaned = finalized_output(finished, decision)
    return {'decision': decision, 'category': category, 'finished': finished,
            'base': base, 'clean': cleaned, 'scan': scan.scan_text(cleaned),
            # Latin slots found in Myanmar context, by letter: the evidence the
            # diagnostics log reports as ``legacy-ascii-residue``.
            'residue': legacy_ascii.scan(text)}
