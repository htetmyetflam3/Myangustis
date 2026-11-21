"""Finishing helpers for parsed and OCR text."""
from __future__ import annotations

import re

from myangustis_parser.normalize import judgement, mm_score, scan
from myangustis_parser.normalize.detector import contains_myanmar
from myangustis_parser.normalize.beautify import arrange_zawcode_order, zawcode_slot_candidate
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
        return 'pass-through', score
    if source_encoding == 'zawgyi-one':
        return 'rabbit', score
    if already_zawcode:
        return 'pass-through', score  # font-scoped draft was ordered during extraction
    swap = (lambda value: value) if zawgyi_codepage else zawcode_slot_candidate
    evidence = judgement.judge_page_lines(text.split('\n'), swap)
    return judgement.select_page_decision(evidence, parsing_path, zawgyi_codepage), score


def apply_decision(text, decision, *, legacy_layout=None):
    """Apply the selected text transformation."""
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
    if decision == 'pass-through':
        return text
    raise ValueError(f'Unknown Parser decision: {decision}')


def ordered(text):
    """Apply the ordering function to text."""
    return order_text(text)


def clean_page(text):
    """Apply normalize_phase2 to text."""
    return normalize_phase2(text)


def clean(text):
    """Apply ordering and cleanup to text."""
    return cleanup_text(ordered(text))


def finish_text(text, *, source, parsing_path='font-cmap', zawgyi_codepage=False,
                already_zawcode=False, source_encoding='auto'):
    """Return both preview variants and the structural scan of cleaned output."""
    decision, score = decide(text, source=source, parsing_path=parsing_path,
                             zawgyi_codepage=zawgyi_codepage,
                             already_zawcode=already_zawcode, source_encoding=source_encoding)
    converted = apply_decision(text, decision)
    base = converted
    cleaned = clean_page(converted)
    return {'decision': decision, 'score': score, 'base': base,
            'clean': cleaned, 'scan': scan.scan_text(cleaned)}


def finalized_output(text, decision):
    """Return the original and cleaned text."""
    return text, clean_page(text)


def finalize_pdf_output(text, decision):
    """:func:`finalized_output`'s second half, for one line at a time."""
    return finalized_output(text, decision)[1]


def finish_pdf_page(text, *, parsing_path='font-cmap', zawgyi_codepage=False,
                    source_encoding='auto', legacy_layout=None):
    """Finish a decoded PDF page."""
    if parsing_path not in ('font-cmap', 'legacy'):
        raise ValueError('Unknown parsing path')
    if source_encoding not in ('auto', 'unicode', 'zawgyi-one'):
        raise ValueError('Unknown source encoding')
    swap = (lambda value: value) if zawgyi_codepage else zawcode_slot_candidate
    evidence = judgement.judge_page_lines(text.split('\n'), swap)
    decision = judgement.select_page_decision(evidence, parsing_path, zawgyi_codepage)
    if decision == 'pass-through':
        finished = text
    elif decision == 'legacy':
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
