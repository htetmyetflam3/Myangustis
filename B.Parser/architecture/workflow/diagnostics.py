"""Opt-in, bounded PDF stage diagnostics; never change parser output.

A run's log has to answer one question:

    *which document came out wrong, in what way, and what do I do about it?*

The previous format could not. Every page emitted a ~2 KB JSON line with six
counter blocks (``extraction``/``layout``/``finished``/``base``/``clean``/
``stream_output``) at the same level, so a page that produced **zero**
characters looked exactly as loud as a page that produced a page of text;
85 pages wrote 97 console lines and ~240 KB, and the file said
``decision: aligned category: UNKNOWN`` for a blank page. Finding out what
went wrong still meant copying the PDF out of the collection and re-running
it by hand, which is the cost this module exists to remove.

The format is now three layers:

``page``
    One compact line per page, **file only**, with the fields that decide
    whether the page is right: lane, decision, characters, Myanmar
    characters, residue, unmapped codes, warnings. Machine-readable and
    greppable.
``book``
    One record per book, on console *and* file: page counts, the
    **syndrome** (what actually went wrong, from evidence), a text example
    of the damage, and a **hint** naming the fonts and the code to look at.
    This is the line an operator reads.
``verbose``
    ``PARSER_DIAGNOSTICS_VERBOSE=on`` (or ``PARSER_DIAGNOSTIC_SAMPLES=on``)
    restores the full per-page JSON, stage blocks included, for the run
    where somebody is already looking at one page.

Nothing here changes parser output; diagnostics only observe.
"""
import os
import re
from collections import Counter

from myangustis_parser.normalize import legacy_ascii


def enabled():
    return os.environ.get('PARSER_DIAGNOSTICS', '').strip().lower() in ('1', 'true', 'yes', 'on')


def samples_enabled():
    return os.environ.get('PARSER_DIAGNOSTIC_SAMPLES', '').strip().lower() in ('1', 'true', 'yes', 'on')


def verbose_enabled():
    """The pre-verdict format, for the one run that needs the whole page."""
    return samples_enabled() or os.environ.get(
        'PARSER_DIAGNOSTICS_VERBOSE', '').strip().lower() in ('1', 'true', 'yes', 'on')


def text_metrics(text):
    lines = text.splitlines()
    nonempty = [line.strip() for line in lines if line.strip()]
    seen = Counter(nonempty)
    return {
        'chars': len(text), 'lines': len(lines), 'nonempty_lines': len(nonempty),
        'single_char_lines': sum(len(line) == 1 for line in nonempty),
        'adjacent_duplicate_lines': sum(a == b and len(a) >= 4 for a, b in zip(nonempty, nonempty[1:])),
        # Lines repeated anywhere on the page, not just next to each other: a
        # page that is one fragment over and over is a decoder loop, not a book.
        'repeated_lines': sum(count - 1 for count in seen.values() if count > 1),
        'myanmar_chars': sum('\u1000' <= c <= '\u109f' or '\uaa60' <= c <= '\uaa7f' or '\ua9e0' <= c <= '\ua9ff' for c in text),
        'replacement_chars': text.count('\ufffd'),
        # This is a visual pattern, not necessarily a decoder-generated placeholder.
        'hex_placeholder_patterns': len(re.findall(r'\[[0-9A-F]{2,8}\]', text)),
        'control_chars': sum(ord(c) < 32 and c not in '\n\r\t' for c in text),
        'detached_marks': len(_DETACHED_MARKS.findall(text)),
    }


#: A combining mark alone between spaces lost its base. ``နှင့်`` becoming
#: ``နှင် ့`` is the shape of it: the mark is right, its host run is gone.
_DETACHED_MARKS = re.compile(r'(?<=[\s\u200b])[\u102b-\u103e]+(?=[\s\u200b]|$)')


# ── page record ────────────────────────────────────────────────────────────

def _slot_counts(counts):
    """``{'A': 400, 'U': 27}`` -> ``'A:400,U:27'``: one field, one line."""
    return ','.join(f'{slot}:{count}' for slot, count in sorted(
        counts.items(), key=lambda item: (-item[1], item[0])))


def _sum_slots(values):
    """Add the ``A:400,U:27`` page fields into one counter."""
    total = Counter()
    for value in values:
        for item in filter(None, str(value or '').split(',')):
            slot, _, count = item.partition(':')
            total[slot] += int(count or 0)
    return dict(total)


def _fonts(pg):
    fonts = (pg.get('diagnostics') or {}).get('fonts') or {}
    ranked = sorted(fonts.values(),
                    key=lambda font: (-(font.get('myanmar_chars') or 0), -(font.get('bytes') or 0)))
    return [(font.get('base_font') or font.get('resource') or '?', font.get('myanmar_chars') or 0)
            for font in ranked]


def page_record(page, pg, result, output, cleanup):
    """The compact, per-page evidence: scalars only, one line, ~200 bytes."""
    metrics = text_metrics(result['clean'])
    found = text_metrics(pg['text'])
    residue = result.get('residue') or {}
    proven = {slot: count for slot, count in residue.items() if slot in legacy_ascii.RESIDUE_SLOTS}
    unproven = {slot: count for slot, count in residue.items() if slot not in legacy_ascii.RESIDUE_SLOTS}
    fonts = (pg.get('diagnostics') or {}).get('fonts') or {}
    unmapped = sum(font.get('unmapped_codes') or 0 for font in fonts.values())
    fallback = sum(font.get('fallback_bytes') or 0 for font in fonts.values())
    warnings = [str(w.get('code', 'unknown'))[:40] for w in pg.get('warnings', [])[:4]]
    # ``repaired`` is not ``ok``: the page was wrong and something fixed it.
    # Keeping them apart is what lets the verdict count the damage a run took.
    # ``fallback_bytes`` does not decide this per-page status: Latin fallback
    # is exactly right on a Latin page, and only the book knows whether the
    # book was Myanmar (see BookReport._status).
    status = ('empty' if not metrics['chars'] else
              'degraded' if (unproven or metrics['replacement_chars'] or unmapped or
                             found['hex_placeholder_patterns'] or found['detached_marks'] or
                             (found['repeated_lines'] * 2 > found['nonempty_lines'] and
                              found['nonempty_lines'] >= 10)) else
              'repaired' if proven else 'ok')
    return {
        'book': page.get('book'), 'page': page.get('page'),
        'lane': pg.get('decode_kind'), 'lane_reason': pg.get('lane_reason'),
        'decision': result['decision'], 'category': result['category'],
        'image_present': bool(pg.get('has_img')),
        'chars': found['chars'], 'myanmar': found['myanmar_chars'],
        'nonempty_lines': found['nonempty_lines'],
        'single_char_lines': found['single_char_lines'],
        'residue': _slot_counts(proven), 'residue_total': sum(residue.values()),
        'residue_unproven': _slot_counts(unproven),
        'unmapped_codes': unmapped, 'fallback_bytes': fallback,
        'replacement_chars': metrics['replacement_chars'],
        'hex_placeholders': found['hex_placeholder_patterns'],
        'detached_marks': found['detached_marks'],
        'duplicate_lines': metrics['adjacent_duplicate_lines'],
        'repeated_lines': found['repeated_lines'],
        'warnings': ','.join(warnings), 'cleanup_applied': bool(cleanup),
        'changed': 'yes' if metrics['chars'] and (result['finished'] != pg['text']) else 'no',
        'status': status,
    }


# ── syndrome ───────────────────────────────────────────────────────────────

def _plural(count, one, many):
    return f'{count} {one if count == 1 else many}'


def syndrome(totals):
    """Name what went wrong, from the evidence, with the action to take.

    Order is by how much of the text the defect destroys, and by how little
    the operator can guess from the output alone. The first match is the
    headline; the others ride along in ``also`` so one book can carry two
    problems without a second run.
    """
    found = []
    pages = totals['pages']
    if totals['myanmar_chars'] == 0 and totals['pages_with_text']:
        # Nothing Myanmar reached the output at all. Whether that is a defect
        # or simply a non-Myanmar book cannot be told from the text alone, so
        # it is reported as information, not as damage.
        found.append((
            'no-myanmar-text', 'info',
            f'no Myanmar characters on any of {pages} pages that produced text',
            'the book is not Myanmar text, or the script never reached the '
            'decoder; check the detector lane before repairing fonts'))
    if pages and totals['pages_with_text'] == 0 and totals['pages_with_image']:
        found.append((
            'no-text-layer', 'no-text',
            f'all {pages} pages are images with no extractable text',
            'this book needs the OCR lane (REMOTE_OCR_DIR); the font lane cannot see it'))
    if totals['residue_total']:
        slots = totals['residue']
        residue = _slot_counts(slots)
        unmapped_slots = totals['residue_unproven']
        left = '' if not unmapped_slots else (
            f'; {_slot_counts(unmapped_slots)} had no witnessed reading and stayed Latin')
        found.append((
            'legacy-ascii-residue', 'text-corrupted',
            f'{_slot_counts(slots)} Latin slots in Myanmar context on '
            f'{_plural(totals["pages_with_residue"], "page", "pages")} '
            f'(font {totals["top_font"] or "?"}){left}',
            'a legacy ASCII layout (A=အ, U=ဥ, O=ဩ, E=ဧ) reached the text through a '
            '/ToUnicode bridge; proven slots are repaired in '
            'normalize/legacy_ascii.py, so add the layout table for the rest'))
    if totals['replacement_chars'] or totals['unmapped_codes']:
        found.append((
            'unmapped-glyphs', 'text-lossy',
            f'{totals["unmapped_codes"]} codes had no mapping and '
            f'{totals["replacement_chars"]} characters are U+FFFD/marks lost '
            f'(font {totals["top_font"] or "?"})',
            'the font\'s /ToUnicode or cmap has gaps; extend the font map '
            'rather than re-running the PDF'))
    if totals['fallback_bytes'] and totals['myanmar_chars']:
        found.append((
            'latin-fallback', 'text-lossy',
            f'{totals["fallback_bytes"]} bytes came through Latin fallback '
            f'(fonts {totals["fallback_fonts"] or "?"})',
            'check whether those runs are Latin labels; if a page should be '
            'Myanmar, its text is unrecoverable without a font map'))
    if totals['detached_marks']:
        found.append((
            'detached-marks', 'text-corrupted',
            f'{totals["detached_marks"]} combining marks sit alone between spaces '
            f'(the shape of "နှင့်" written as "နှင် ့")',
            'a mark lost the run it was drawn with; the fault is in how pieces '
            'are joined, not in the ordering that follows it'))
    if totals['hex_placeholders']:
        found.append((
            'hex-placeholders', 'text-corrupted',
            f'{totals["hex_placeholders"]} codes printed as placeholders like '
            f'[00E5] (font {totals["top_font"] or "?"})',
            'the font\'s cmap names no glyph for those codes, so the text is a '
            'code dump; a font map is needed, re-running will not help'))
    if totals['repeated_pages']:
        found.append((
            'repeated-text', 'text-corrupted',
            f'{totals["repeated_lines"]} repeated lines on '
            f'{_plural(totals["repeated_pages"], "page", "pages")}',
            'one fragment is emitted over and over; the decoder is looping on '
            'a glyph run, and the output is not readable as text'))
    if totals['fragmented_lines']:
        found.append((
            'fragmented-lines', 'text-corrupted',
            f'{totals["single_char_lines"]} single-character lines on '
            f'{_plural(totals["fragmented_lines"], "page", "pages")} '
            f'({totals["chars_per_line"]:.1f} chars per non-empty line)',
            'layout split the text one glyph per line; this is a text-layout '
            'decision, not a font problem'))
    if totals['duplicate_lines']:
        found.append((
            'duplicated-text', 'text-duplicated',
            f'{totals["duplicate_lines"]} adjacent duplicate lines',
            'the same run is emitted twice; check the content-stream walk'))
    if not found:
        found.append(('ok', 'ok',
                      f'{_plural(totals["pages_with_text"], "page", "pages")} produced readable text',
                      'nothing to repair'))
    headline = found[0]
    return {'symptom': headline[0], 'severity': headline[1],
            'evidence': headline[2], 'hint': headline[3],
            'also': ','.join(item[0] for item in found[1:]) or None}


class BookReport:
    """Collect page records for one book and state the verdict once, at the end."""

    def __init__(self, tracker):
        self.tracker = tracker
        self.records = []
        self.font_chars = Counter()
        self.font_fallback = Counter()

    def page(self, record, fonts=()):
        self.records.append(record)
        for name, chars in fonts:
            self.font_chars[name] += chars
        return record

    @staticmethod
    def _status(record, myanmar_book):
        """The book-level status: per-page status, plus Latin fallback.

        A Latin page decoded through Latin fallback is correct; the same
        fallback inside a Myanmar book means the Myanmar text of that page is
        gone. Only the book can tell the two apart.
        """
        if not record['chars']:
            return 'empty'
        if record['status'] == 'degraded':
            return 'degraded'
        if record['fallback_bytes'] and myanmar_book:
            return 'degraded'
        return record['status']

    def totals(self):
        records = self.records
        # A proven slot is repaired in normalize/legacy_ascii.py; any other
        # letter in Myanmar context is a layout nobody has written down yet,
        # and has to stay visible in the log.
        residue = _sum_slots(record.get('residue') for record in records)
        residue_unproven = _sum_slots(record.get('residue_unproven') for record in records)
        residue_total = sum(residue.values()) + sum(residue_unproven.values())
        single_char_lines = sum(record['single_char_lines'] for record in records)
        chars = sum(record['chars'] for record in records)
        nonempty = sum(record['chars'] for record in records if record['chars'])
        lines = sum(1 for record in records if record['chars'])
        myanmar_chars = sum(record['myanmar'] for record in records)
        statuses = Counter(self._status(record, myanmar_chars > 0) for record in records)
        return {
            'pages': len(records),
            'ok': statuses['ok'],
            'repaired': statuses['repaired'],
            'degraded': statuses['degraded'],
            'empty': statuses['empty'],
            'pages_with_text': sum(record['chars'] > 0 for record in records),
            'myanmar_chars': myanmar_chars,
            'pages_with_image': sum(record['image_present'] for record in records),
            'pages_with_residue': sum(
                bool(record['residue']) or bool(record['residue_unproven']) for record in records),
            'residue': dict(residue),
            'residue_total': residue_total,
            'residue_unproven': dict(residue_unproven),
            'unmapped_codes': sum(record['unmapped_codes'] for record in records),
            'fallback_bytes': sum(record['fallback_bytes'] for record in records),
            'replacement_chars': sum(record['replacement_chars'] for record in records),
            'single_char_lines': single_char_lines,
            # The ``parsed-books.txt`` symptom: the layout ran the text one
            # glyph per line, so the page is a column of single characters.
            'fragmented_lines': sum(
                record['single_char_lines'] >= 3 and
                record['single_char_lines'] * 4 >= max(record.get('nonempty_lines') or 0, 1)
                for record in records),
            'chars_per_line': (chars / lines) if lines else 0.0,
            'duplicate_lines': sum(record['duplicate_lines'] for record in records),
            'repeated_lines': sum(record.get('repeated_lines') or 0 for record in records),
            'hex_placeholders': sum(record.get('hex_placeholders') or 0 for record in records),
            'detached_marks': sum(record.get('detached_marks') or 0 for record in records),
            'repeated_pages': sum(
                (record.get('repeated_lines') or 0) * 2 > (record.get('nonempty_lines') or 0)
                and (record.get('nonempty_lines') or 0) >= 10 for record in records),
            'top_font': self.font_chars.most_common(1)[0][0] if self.font_chars else None,
            'fallback_fonts': self.font_fallback.most_common(2),
        }

    def verdict(self):
        totals = self.totals()
        data = {'book': self.tracker.book, **{key: totals[key] for key in (
            'pages', 'ok', 'repaired', 'degraded', 'empty')}}
        data.update(syndrome(totals))
        data['detail'] = '; '.join(
            f'{key}={totals[key]}' for key in (
                'residue_total', 'unmapped_codes', 'fallback_bytes',
                'replacement_chars', 'single_char_lines', 'duplicate_lines'))
        return data

    def flush(self):
        self.tracker.verdict(self.verdict())


def page_log(tracker, page, pg, result, output, cleanup):
    """Record one page. Powers no decisions; a diagnostic never changes text."""
    if isinstance(tracker, BookReport):
        report, lane_log = tracker, tracker.tracker
    else:                                    # a bare LaneLog: one page, no verdict
        report, lane_log = BookReport(tracker), tracker
    record = page_record({'book': lane_log.book, 'page': page}, pg, result, output, cleanup)
    fonts = _fonts(pg)
    report.page(record, fonts)
    if verbose_enabled():
        lane_log.file_event('page', _verbose_page(record, pg, result, output))
    else:
        lane_log.file_event('page', record)
    return record


def _verbose_page(record, pg, result, output):
    """The old full page payload, on request only."""
    data = dict(record)
    data.update({
        'extraction': pg.get('diagnostics', {}),
        'layout': text_metrics(pg['text']),
        'finished': text_metrics(result['finished']),
        'base': text_metrics(result['base']),
        'clean': text_metrics(result['clean']),
        'stream_output': text_metrics(output),
    })
    if samples_enabled():
        data['samples'] = {name: text[:160] for name, text in (
            ('layout', pg['text']), ('finished', result['finished']),
            ('base', result['base']), ('clean', result['clean']), ('stream_output', output))}
    return data


def segmentation_log(book, text, segmented):
    # Import lazily to avoid loading a second logger unless requested.
    from myangustis_parser.workflow.lane_log import LaneLog
    tracker = LaneLog(book)
    tracker.logger.emit_log('PDFDIAG', 'info', 'segmentation', {
        'book': tracker.book, 'input': text_metrics(text), 'segmented': text_metrics(segmented),
        'changed': text != segmented,
        'note': 'segmented is a separate parquet field; txt and parquet text use input'})
