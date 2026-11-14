"""Opt-in, bounded PDF stage diagnostics; never change parser output."""
import os
import re


def enabled():
    return os.environ.get('PARSER_DIAGNOSTICS', '').strip().lower() in ('1', 'true', 'yes', 'on')


def samples_enabled():
    return os.environ.get('PARSER_DIAGNOSTIC_SAMPLES', '').strip().lower() in ('1', 'true', 'yes', 'on')


def text_metrics(text):
    lines = text.splitlines()
    nonempty = [line.strip() for line in lines if line.strip()]
    return {
        'chars': len(text), 'lines': len(lines), 'nonempty_lines': len(nonempty),
        'single_char_lines': sum(len(line) == 1 for line in nonempty),
        'adjacent_duplicate_lines': sum(a == b and len(a) >= 4 for a, b in zip(nonempty, nonempty[1:])),
        'myanmar_chars': sum('\u1000' <= c <= '\u109f' or '\uaa60' <= c <= '\uaa7f' or '\ua9e0' <= c <= '\ua9ff' for c in text),
        'replacement_chars': text.count('\ufffd'),
        # This is a visual pattern, not necessarily a decoder-generated placeholder.
        'hex_placeholder_patterns': len(re.findall(r'\[[0-9A-F]{2,8}\]', text)),
        'control_chars': sum(ord(c) < 32 and c not in '\n\r\t' for c in text),
    }


def page_log(tracker, page, pg, result, output, cleanup):
    data = {'book': tracker.book, 'page': page,
            'lane': pg.get('decode_kind'), 'lane_reason': pg.get('lane_reason'),
            'decision': result['decision'], 'category': result['category'],
            'cleanup_applied': bool(cleanup),
            'warning_codes': [str(w.get('code', 'unknown'))[:80] for w in pg.get('warnings', [])[:16]],
            'warning_count': len(pg.get('warnings', [])),
            'image_present': pg.get('has_img', False),
            'extraction': pg.get('diagnostics', {}),
            'layout': text_metrics(pg['text']), 'finished': text_metrics(result['finished']),
            'base': text_metrics(result['base']), 'clean': text_metrics(result['clean']),
            'stream_output': text_metrics(output),
            'layout_to_finished_changed': pg['text'] != result['finished'],
            'finished_to_base_changed': result['finished'] != result['base'],
            'base_to_clean_changed': result['base'] != result['clean']}
    if samples_enabled():
        data['samples'] = {name: text[:160] for name, text in (
            ('layout', pg['text']), ('finished', result['finished']),
            ('base', result['base']), ('clean', result['clean']), ('stream_output', output))}
    tracker.logger.emit_log('PDFDIAG', 'info', 'page', data)


def segmentation_log(book, text, segmented):
    # Import lazily to avoid loading a second logger unless requested.
    from myangustis_parser.workflow.lane_log import LaneLog
    tracker = LaneLog(book)
    tracker.logger.emit_log('PDFDIAG', 'info', 'segmentation', {
        'book': tracker.book, 'input': text_metrics(text), 'segmented': text_metrics(segmented),
        'changed': text != segmented,
        'note': 'segmented is a separate parquet field; txt and parquet text use input'})
