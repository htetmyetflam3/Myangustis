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
from myangustis_parser.normalize.beautify import arrange_zawcode_order
from myangustis_parser.normalize.cleanup import cleanup_text, order_text
from myangustis_parser.normalize.rabbit import Rabbit
from myangustis_parser.normalize.unicode_evidence import preserve_regional_runs


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
    swap = (lambda value: value) if zawgyi_codepage else arrange_zawcode_order
    evidence = judgement.judge_page_lines(text.split('\n'), swap)
    return judgement.select_page_decision(evidence, parsing_path, zawgyi_codepage), score


def apply_decision(text, decision):
    if decision == 'rabbit':
        return Rabbit.zg2uni(text)
    if decision == 'zawcode':
        return arrange_zawcode_order(text)
    if decision in ('ocr', 'legacy', 'aligned'):
        return text
    raise ValueError(f'Unknown Parser decision: {decision}')


def clean(text, *, apply_cleanup=True):
    # Preserve regional-script runs just as the Parser's Unicode lane does.
    ordered = preserve_regional_runs(text, order_text)
    return preserve_regional_runs(ordered, cleanup_text) if apply_cleanup else ordered


def finish_text(text, *, source, parsing_path='font-cmap', zawgyi_codepage=False,
                already_zawcode=False, source_encoding='auto'):
    """Return both preview variants and the structural scan of cleaned output."""
    decision, score = decide(text, source=source, parsing_path=parsing_path,
                             zawgyi_codepage=zawgyi_codepage,
                             already_zawcode=already_zawcode, source_encoding=source_encoding)
    converted = apply_decision(text, decision)
    base = clean(converted, apply_cleanup=False)
    # JS legacy pages receive shared ordering only, not the Unicode cleanup
    # applied to rule-converted pages.
    cleaned = base if decision == 'legacy' else clean(converted, apply_cleanup=True)
    return {'decision': decision, 'score': score, 'base': base,
            'clean': cleaned, 'scan': scan.scan_text(cleaned)}


def finalize_pdf_output(text, decision, apply_cleanup=True):
    """The JS finalized-page output step; legacy was ordered earlier."""
    if decision not in ('aligned', 'zawcode', 'unaligned-unicode', 'rabbit'):
        return text
    return clean(text, apply_cleanup=apply_cleanup)


def finish_pdf_page(text, *, parsing_path='font-cmap', zawgyi_codepage=False,
                    source_encoding='auto'):
    """Finish a decoded PDF page using the JS PDF page decision and output steps.

    Source encoding selects the PDF instruction lane and suppresses a world
    spelling correction for Unicode; it does not force this finish decision.
    """
    if parsing_path not in ('font-cmap', 'legacy'):
        raise ValueError('Unknown parsing path')
    if source_encoding not in ('auto', 'unicode', 'zawgyi-one'):
        raise ValueError('Unknown source encoding')
    swap = (lambda value: value) if zawgyi_codepage else arrange_zawcode_order
    evidence = judgement.judge_page_lines(text.split('\n'), swap)
    decision = judgement.select_page_decision(evidence, parsing_path, zawgyi_codepage)
    if decision == 'legacy':
        # JS orders each legacy line once while finalizing the page spool.
        finished = '\n'.join(clean(line, apply_cleanup=False) for line in text.split('\n'))
    else:
        finished = apply_decision(text, decision)
        if decision == 'rabbit' and source_encoding != 'unicode':
            finished = re.sub(r'က(?:မၻာ|မ်ဘာ)', 'ကမ္ဘာ', finished)
    category = ('UNKNOWN' if not contains_myanmar(finished) else
                'ZAWGYI' if decision == 'rabbit' else 'UNICODE')
    base = finalize_pdf_output(finished, decision, False)
    cleaned = finalize_pdf_output(finished, decision, True)
    return {'decision': decision, 'category': category, 'finished': finished,
            'base': base, 'clean': cleaned, 'scan': scan.scan_text(cleaned)}
