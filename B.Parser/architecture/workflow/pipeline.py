"""Shared service layer (used by both the CLI and the Flask API).

Orchestrates the full pipeline: load the detector, extract pages from a PDF,
detect/convert encoding per page, compute cleanup candidates + preview changes,
and dispatch final output to the .txt/.docx/.pdf writers in :mod:`render`.

Two execution modes share the same building blocks:

  STREAMING (CLI, large documents):
      ``process_pdf_stream`` walks pages ONE AT A TIME — extract -> detect ->
      convert -> cleanup -> keep only the final text per page. A 7000-page
      book is a single pass; memory stays flat because raw/base/clean copies
      and per-line change lists are never accumulated.

  BATCH (API preview):
      ``process_pdf_bytes`` still builds the full per-page report list with
      inline change previews, because the frontend job store needs them.
"""

import os
import re
import difflib
import math
import tempfile

from myangustis_parser.extract.decrypt import (
    decrypt_pdf,
    expand_object_streams,
    has_object_streams,
    is_encrypted_pdf,
)
from myangustis_parser.normalize.rabbit import Rabbit
from myangustis_parser.normalize.detector import contains_myanmar, has_only_zawgyi_fonts
from myangustis_parser.normalize.cleanup import cleanup_text, order_text
from myangustis_parser.extract.docx_extract import extract_docx_paragraphs, strip_image_markers
from myangustis_parser.normalize.mm_score import score_text
from myangustis_parser.normalize.judgement import instruction_lane
from myangustis_parser.extract.pdf_fonts import FontResourceLoader, Ref, page_font_decoders
from myangustis_parser.extract.pdf_extract import (
    DocumentDecoding,
    parse_pdf_objects,
    get_stream,
    parse_tounicode_stream,
    parse_ttf_cmap,
    find_root_pages,
    collect_pages,
    extract_page_lines,
    page_has_images,
)
from myangustis_parser.output.render import _write_docx_layout, _write_pdf, write_docx_markup
from myangustis_parser.resources.font_names import has_only_unicode_fonts, legacy_font_family, legacy_layout_for_font
from myangustis_parser.output import markup
from myangustis_parser.normalize.unicode_evidence import preserve_regional_runs
from myangustis_parser.workflow import finish
from myangustis_parser.workflow.lane_log import LaneLog


def _norm_category(category):
    """Normalize detector categories to the pipeline's uppercase form.

    detector.detect() returns "ZAWGYI"/"UNICODE"/"UNKNOWN"; this also accepts
    lowercase variants ("zawgyi"/"unicode"/"other") from other detector
    generations, mapping "OTHER" to "UNKNOWN".
    """
    cat = str(category).upper()
    return "UNKNOWN" if cat == "OTHER" else cat


def _safe_prob(prob):
    """JSON-safe probability: detector returns -inf for UNKNOWN pages, which
    Flask would serialize as -Infinity (invalid strict JSON for browsers)."""
    return prob if math.isfinite(prob) else 0.0


def _is_myanmar_category(category):
    return _norm_category(category) in ("ZAWGYI", "UNICODE")


def load_detector():
    """Load the Zawgyi detector. Raises RuntimeError if unavailable."""
    try:
        from myangustis_parser.normalize.detector import ZawgyiDetector
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(
            f"Could not import detector.ZawgyiDetector ({e}). "
            "Place detector.py next to this script."
        )

    return ZawgyiDetector()


# ═══════════════════════════════════════════════════════════════════════════
#  STREAMING path — one page at a time, flat memory, single pass
# ═══════════════════════════════════════════════════════════════════════════

def stream_pdf_pages(pdf_path, detector=None, log=lambda m: None, *, text_layout=None, source_encoding="auto"):
    """Stream per-page layout: returns ``(metadata, npages, iterator)``.

    The iterator yields one dict per page, ONE PAGE AT A TIME:

        {"idx", "text", "lines": [(x, y, size, text)...], "wh": (w, h),
         "has_img": bool}

    ``metadata`` is always ``{}`` — the final pipeline does not scan PDF
    metadata (that full-object regex pass was pure overhead).

    Build page instructions and font verdicts at the stem before reading
    page content, then follow them when decoding each font resource. No
    mapping is borrowed from a different resource.
    """
    # Older Python-only draft profiles bypass the JS instruction path. Do not
    # silently run them when an old configuration is still present.
    setting = os.environ.get('PRASER_ZAWCODE_DRAFT', '').strip().lower()
    if text_layout == 'zawcode' or (text_layout is None and setting in ('1', 'true', 'yes', 'on')):
        raise ValueError('The Python-only ZawCode draft was removed; use automatic instruction routing')
    if text_layout not in (None, 'auto', 'off'):
        raise ValueError(f'Unsupported text layout: {text_layout}')
    with open(pdf_path, "rb") as f:
        raw = f.read()
    # Byte-level pre-processing (modules/decrypt.py, mirroring the JS
    # parser): restrictions-only encryption and /ObjStm object streams are
    # rewritten once with pypdf, or the object scan below cannot see the
    # page tree at all.
    if is_encrypted_pdf(raw):
        raw = decrypt_pdf(raw, log)
    if has_object_streams(raw):
        raw = expand_object_streams(raw, log)
    log(f"[+] PDF size: {len(raw):,} bytes")

    objects = parse_pdf_objects(raw)
    log(f"[+] Objects found: {len(objects)}")
    metadata = {}

    pages_obj = find_root_pages(objects)
    if not pages_obj:
        raise RuntimeError("No page tree found in the PDF.")
    all_pages = collect_pages(objects, pages_obj)
    npages = len(all_pages)
    log(f"[+] Total pages: {npages}")

    def _page(idx, code_to_uni):
        pnum, pgen = all_pages[idx]
        # A page carrying an /Image XObject used to be emitted EMPTY, on the
        # assumption that it was a scan. That is the wrong test: a page with a
        # logo, a rule, or a diagram alongside real text is completely
        # ordinary, and this discarded every word on it. Two of the sample
        # documents are HTML-to-PDF conversions where EVERY page carries an
        # image, so both came out entirely blank despite decoding perfectly.
        # Extract the text either way and keep the flag for the DOCX writer;
        # a genuine scan simply yields no text and is unaffected.
        has_img = page_has_images(objects, pnum, pgen)
        font_names = set()
        used_legacy_fonts = []
        images = []
        # Record only this page's actual resource decoding.
        lane_trace = []
        visual_state = {'changed': False, 'unresolved': False}
        def observe_visual(changed, unresolved):
            visual_state['changed'] |= changed
            visual_state['unresolved'] |= unresolved
        def observe(lane):
            if not lane_trace or lane_trace[-1] != lane:
                lane_trace.append(lane)
        previous_observer = code_to_uni.lane_observer
        previous_visual_observer = code_to_uni.visual_unicode_observer
        code_to_uni.lane_observer = observe
        code_to_uni.visual_unicode_observer = observe_visual
        try:
            lines, w, h = extract_page_lines(objects, pnum, pgen, code_to_uni,
                                             used_myanmar_fonts=font_names,
                                             used_legacy_fonts=used_legacy_fonts,
                                             image_records=images)
        finally:
            code_to_uni.lane_observer = previous_observer
            code_to_uni.visual_unicode_observer = previous_visual_observer
        return {
            "idx": idx,
            "lines": lines,
            "wh": (w, h),
            "text": "\n".join(line[3] for line in lines),
            "has_img": bool(images) or has_img,
            "images": images,
            # How the glyph ids became characters, carried to the report
            # because the cmap fork below needs it (JS: pg.decodeKind).
            "decode_kind": getattr(code_to_uni, "kind", None),
            "font_names": font_names,
            "used_legacy_fonts": used_legacy_fonts,
            "lane_trace": lane_trace,
            "warnings": ([{'code': 'unicode-glyph-recovery-needs-review', 'page': idx + 1}] if visual_state['changed'] else [])
                        + ([{'code': 'unicode-glyph-mapping-needs-review', 'page': idx + 1}] if visual_state['unresolved'] else []),
        }

    # Match the JS instruction/stem pass: collect dictionary facts for the
    # whole page tree before reading any page content, then settle the known
    # indirect font objects once. Inline fonts fall back to their own facts.
    instruction_loader = FontResourceLoader(objects, get_stream, parse_ttf_cmap, parse_tounicode_stream)
    page_instructions = []
    for pnum, pgen in all_pages:
        fonts = []
        for entry in instruction_loader.page_font_resources(pnum, pgen).values():
            font = instruction_loader.resolve(entry)
            if isinstance(font, dict):
                fonts.append({'baseFont': str(instruction_loader.resolve(font.get('BaseFont')) or ''),
                              'subtype': str(instruction_loader.resolve(font.get('Subtype')) or ''),
                              'toUnicode': isinstance(font.get('ToUnicode'), Ref),
                              'entry': entry})
        page_instructions.append({'fonts': fonts})

    stem_fonts = {}
    for instruction in page_instructions:
        for fact in instruction['fonts']:
            entry = fact['entry']
            if not isinstance(entry, Ref) or entry in stem_fonts:
                continue
            to_unicode = 'none'
            try:
                font = instruction_loader.resolve(entry)
                mapping = instruction_loader.tounicode_of(font, preserve_spaces=True)
                if mapping:
                    to_unicode = 'myanmar' if any(
                        any('\u1000' <= ch <= '\u109f' for ch in value)
                        for value in mapping.values()) else 'latin'
            except Exception:
                # Like JS, an unreadable map supplies no stem verdict; the
                # resource decoder still follows its own normal error path.
                pass
            family = legacy_font_family(fact['baseFont'])
            stem_fonts[entry] = {'baseFont': fact['baseFont'], 'toUnicode': to_unicode,
                                 'family': family, 'known': family is not None}

    shared = DocumentDecoding('font')
    shared.visual_unicode_enabled = source_encoding != 'zawgyi-one'
    legacy = DocumentDecoding('legacy')
    for strategy in (shared, legacy):
        strategy.loader = instruction_loader
        strategy.stem_fonts = stem_fonts
    # Current JS leaves legacy extraction untouched; its shared finish stage
    # orders the decoded text. Keep the old helper only for direct API callers.
    legacy.legacy_text_fix = False

    def normal_page(idx):
        choice = instruction_lane(page_instructions[idx], source_encoding)
        strategy = legacy if choice['parser'] == 'legacy' else shared
        page_key = all_pages[idx]
        unknown_fonts = []
        if strategy is legacy:
            shared_fonts = page_font_decoders(instruction_loader, *page_key, shared)
            for name, font in shared_fonts.items():
                clusters = sum(len(value) > 1 and contains_myanmar(value)
                               for value in (font.to_unicode or {}).values()) if not font.conflicting_space_map else 0
                if not font.is_cid and not legacy_layout_for_font(font.base_font)['known'] and clusters < 4:
                    unknown_fonts.append(font.base_font or name)
        try:
            item = _page(idx, strategy)
        finally:
            strategy._page_fonts.pop(page_key, None)
            shared._page_fonts.pop(page_key, None)
        if strategy is shared and item['used_legacy_fonts']:
            item['warnings'].append({'code': 'legacy-font-on-shared-page', 'page': idx + 1,
                                     'fonts': item['used_legacy_fonts']})
        if unknown_fonts:
            item['warnings'].append({'code': 'legacy-unknown-font', 'page': idx + 1,
                                     'fonts': unknown_fonts})
        item['lane_reason'] = choice['reason']
        return item

    def gen():
        log('[+] PDF decoding: stem instructions and per-resource font maps')
        for idx in range(npages):
            yield normal_page(idx)
            if (idx + 1) % 500 == 0:
                log(f"    ... extracted {idx + 1}/{npages} pages")

    return metadata, npages, gen()


def _cmap_fork(cat, raw, decode_kind, idx, category, log):
    """The cmap fork, mirrored from the JS pipeline's processPageRecord.

    A page decoded through the font's own cmap or /ToUnicode that the
    detector calls Zawgyi is either a Unicode page in drawing order (the
    explicit "unicode" path) or a Zawgyi font whose own table names Zawgyi
    slots ("zawgyi-cmap"). The two readings compete on score_text: Rabbit
    must win by >= 0.03 on >= 50 marks to rewrite, else the page stays
    UNICODE. Any other decode kind follows the detector unchanged.
    """
    if cat != "ZAWGYI" or decode_kind not in ("cmap", "tounicode"):
        return cat
    as_unicode = score_text(order_text(raw))
    as_zawgyi = score_text(order_text(Rabbit.zg2uni(raw)))
    if as_unicode["marks"] >= 50 and as_zawgyi["score"] - as_unicode["score"] >= 0.03:
        log(f"    Page {idx + 1}: zawgyi-cmap path -- decoded from the font's own "
            f"{decode_kind} table but still Zawgyi: Rabbit reading scores "
            f"{as_zawgyi['score']:.3f} vs {as_unicode['score']:.3f} as Unicode")
        return "ZAWGYI"
    log(f"    Page {idx + 1}: unicode path -- {category} verdict overridden; "
        f"decoded from the font's own {decode_kind} table and reads as itself "
        f"({as_unicode['score']:.3f} vs {as_zawgyi['score']:.3f} converted), "
        f"so this is Unicode in drawing order, not Zawgyi")
    return "UNICODE"


def process_pdf_stream(pdf_path, detector, apply_cleanup, log=lambda m: None,
                       want_layout=False, *, text_layout=None, source_encoding="auto",
                       book_name=None):
    """Single-pass streaming pipeline. Returns ``(metadata, npages, iterator)``.

    The iterator yields one dict per page and keeps only ONE page alive at a
    time:

        {"page", "category", "prob", "text", "n_changes",
         "lines", "wh", "has_img"}      # layout fields only when want_layout

    ``text`` is the final text for that page (Zawgyi already converted via
    Rabbit; cleanup applied or not per ``apply_cleanup``, and only ever on a
    UNICODE page); ``n_changes`` is how many lines the cleanup step altered
    (counted, not stored) -- always 0 for ZAWGYI and UNKNOWN.

    ``want_layout=True`` (DOCX output) additionally carries the per-line
    x/y/font-size and the page MediaBox so the writer can reproduce the page
    exactly; for .txt/.pdf those fields are dropped to keep memory minimal.
    """
    metadata, npages, pages = stream_pdf_pages(pdf_path, detector=detector, log=log,
                                                text_layout=text_layout, source_encoding=source_encoding)

    lane_log = LaneLog(book_name or os.path.basename(pdf_path))

    def reports():
        try:
            yield from _reports()
        finally:
            lane_log.flush()

    def _reports():
        for pg in pages:
            idx = pg["idx"]
            raw = pg["text"]
            lane_log.stem(idx + 1, pg.get("lane_trace", ()))
            named_zawgyi = has_only_zawgyi_fonts(pg.get("font_names"))
            parsing_path = 'legacy' if pg.get('decode_kind') == 'legacy' else 'font-cmap'
            result = finish.finish_pdf_page(raw, parsing_path=parsing_path,
                                            zawgyi_codepage=named_zawgyi,
                                            source_encoding=source_encoding)
            base, cleaned = result['base'], result['clean']
            cat = result['category']
            rep = {'page': idx + 1, 'category': cat, 'prob': 1.0 if cat == 'ZAWGYI' else 0.0,
                   'text': cleaned if apply_cleanup else base,
                   'base': base, 'clean': cleaned, 'decision': result['decision'],
                   'scan': result['scan'], 'n_changes': _count_diff_lines(base, cleaned)}
            if result['decision'] == 'zawcode':
                rep['text_path'] = 'zawcode'
            if pg.get('warnings'):
                rep['warnings'] = pg['warnings']
            if want_layout:
                lines = []
                finished_lines = result['finished'].split('\n')
                if len(finished_lines) == len(pg['lines']):
                    for line, finished_line in zip(pg['lines'], finished_lines):
                        value = finish.finalize_pdf_output(finished_line, result['decision'], apply_cleanup)
                        lines.append((*line[:3], value, line[4] if len(line) > 4 else None))
                rep.update({'lines': lines, 'wh': pg['wh'], 'has_img': pg['has_img'],
                            'images': pg.get('images', [])})
            lane_log.finish_page(idx + 1, result['decision'])
            yield rep

    return metadata, npages, reports()


def _cleanup_for(cat, text):
    """Imposter cleanup for a page of category ``cat``, or ``None``.

    IMPOSTER replacement is the UNICODE extraction branch's step only: a
    ZAWGYI page is Rabbit's output and its Zawgyi code points have already
    been converted, so re-reading them as imposters would edit a conversion
    this module does not own. UNKNOWN has no conversion to trust either way.

    Ordering is NOT decided here -- ``order_text`` has already run on every
    page. ``text`` therefore arrives ordered, and the only difference this
    function can produce is an imposter replacement (plus the re-order its
    expansion needs).
    """
    return cleanup_text(text) if cat == "UNICODE" else None


def _convert_line(t, cat, apply_cleanup):
    """Apply the same per-page transform to one extracted line."""
    if cat == "ZAWGYI":
        return order_text(Rabbit.zg2uni(t))     # ordered, never imposter-fixed
    if cat == "UNICODE":
        # Regional (Mon/extended) runs keep their marks: ordering and cleanup
        # are Burmese-only rules and must not rewrite them.
        return (preserve_regional_runs(t, cleanup_text) if apply_cleanup
                else preserve_regional_runs(t, order_text))
    return order_text(t)


def _conv_lines(lines, cat, apply_cleanup):
    """Per-line conversion mirroring the page-level transform (layout mode).

    The font name (5th element) rides along untouched: it is evidence for
    the markup stage, not text, so no conversion may rewrite it.
    """
    out = []
    for line in lines:
        x, y, size, text = line[:4]
        font = line[4] if len(line) > 4 else None
        out.append((x, y, size, _convert_line(text, cat, apply_cleanup), font))
    return out


def page_markup(page, text=None):
    """One finished page as a marked-up string (``markup.pageToMarkup``).

    Pages that still carry geometry get heading/bold/italic from the line
    evidence; text-only pages (DOCX, OCR, Engine rewrites) get one paragraph
    per source paragraph. A page whose text already carries ``<b>``/``<i>``
    (DOCX runs) keeps those tags.
    """
    page = dict(page or {})
    if text is not None:
        page["text"] = text
    lines = page.get("lines")
    if isinstance(lines, (list, tuple)) and lines:
        marked = markup.lines_to_markup(lines)
        if marked:
            return marked
    text = page.get("text") or ""
    return markup.marked_text_to_markup(text) if page.get("marked") \
        else markup.text_to_markup(text)


def _count_diff_lines(base, clean):
    """Number of lines the cleanup changed (without building change records)."""
    bl = base.split("\n")
    cl = clean.split("\n")
    n = max(len(bl), len(cl))
    return sum(1 for i in range(n)
               if (bl[i] if i < len(bl) else "") != (cl[i] if i < len(cl) else ""))


def collect_stream_results(pdf_path, detector, apply_cleanup, log=lambda m: None,
                           want_layout=False):
    """Convenience: run the streaming pipeline, keep final pages + counts.

    Returns ``(pages, counts, total_changes, metadata)`` where each page is
    ``{"text", "lines"?, "wh"?, "has_img"?}`` ready for :func:`render_texts`.
    """
    metadata, npages, reports = process_pdf_stream(pdf_path, detector,
                                                   apply_cleanup, log=log,
                                                   want_layout=want_layout)
    counts = {"ZAWGYI": 0, "UNICODE": 0, "UNKNOWN": 0}
    pages = []
    total_changes = 0
    for rep in reports:
        counts[rep["category"]] = counts.get(rep["category"], 0) + 1
        page = {k: rep[k] for k in ("text", "lines", "wh", "has_img", "images") if k in rep}
        page["marked"] = page_markup(page)
        pages.append(page)
        total_changes += rep["n_changes"]
    return pages, counts, total_changes, metadata


# ═══════════════════════════════════════════════════════════════════════════
#  BATCH path — full per-page reports with inline change previews (API)
# ═══════════════════════════════════════════════════════════════════════════

def collect_changes(reports):
    """
    Build the list of lines that the cleanup would change (preview data).
    Line numbers refer to the cleaned/base text of each page.

    Plain text only: ``original`` / ``suggested`` carry the raw lines, no
    server-rendered HTML. Any highlighting is the client's decision.
    """
    changes = []
    for rep in reports:
        if rep["clean"] is None:
            continue
        base_lines = rep["base"].split("\n")
        clean_lines = rep["clean"].split("\n")
        for li in range(max(len(base_lines), len(clean_lines))):
            bl = base_lines[li] if li < len(base_lines) else ""
            cl = clean_lines[li] if li < len(clean_lines) else ""
            if bl != cl:
                changes.append({
                    "id": f"p{rep['page']}-l{li+1}",
                    "page": rep["page"],
                    "line": li + 1,
                    "category": rep["category"],
                    "original": bl,
                    "suggested": cl,
                })
    return changes


def build_content(job, apply_cleanup=True, kind=None):
    """Whole document body as ONE plain text string (API output).

    Every page's final text joined with a blank line — no metadata banner,
    no ``--- Page N ---`` markers, no HTML tags. This is what a caller that
    just wants the text (e.g. the Node backend feeding the grammar engine)
    consumes.

    ``kind`` (or ``job['kind']``) picks the join: PDF page texts are joined
    with a blank line (page = block); DOCX page texts are chunked paragraph
    runs and join with a single newline (paragraph = line).
    """
    kind = (kind or job.get("kind") or "pdf").lower()
    sep = "\n" if kind == "docx" else "\n\n"
    parts = []
    finished_pages = (build_final_pages(job, apply_cleanup)
                      if kind == 'docx' or (kind == 'pdf' and any(pg.get('_ocr_supplied') for pg in job['pages']))
                      else None)
    for index, (pg, rep) in enumerate(zip(job["pages"], job["reports"])):
        if finished_pages is not None and (kind == 'docx' or pg.get('_ocr_supplied')):
            parts.append(finished_pages[index]['text'])
        elif apply_cleanup and rep.get("clean") is not None:
            parts.append(rep["clean"])
        else:
            parts.append(pg["text"])
    return sep.join(parts)


def build_meta_header(pdf_path, reports, counts, metadata):
    npages = len(reports) if reports is not None else 0
    lines = [
        f"# Source: {pdf_path}",
        f"# Pages: {npages}",
        f"# Detection: {counts.get('ZAWGYI',0)} Zawgyi, "
        f"{counts.get('UNICODE',0)} Unicode, {counts.get('UNKNOWN',0)} unknown",
    ]
    for k, v in (metadata or {}).items():
        lines.append(f"# {k}: {v}")
    lines.append("#" * 50)
    return "\n".join(lines) + "\n\n"


def render_texts(out_path, pages, counts, pdf_path):
    """Write .txt / .docx / .pdf from streamed pages (streaming-friendly).

    ``pages`` is a list of dicts with at least ``"text"``; when they also
    carry ``"lines"``/``"wh"`` (want_layout runs) the DOCX writer reproduces
    the exact PDF page layout (MediaBox size + per-line x/y + font sizes).
    """
    ext = os.path.splitext(out_path)[1].lower()
    if ext == "":
        ext = ".txt"
        out_path += ".txt"

    texts = [p["text"] if isinstance(p, dict) else p for p in pages]
    header = build_meta_header(pdf_path, texts, counts, {})
    marked = [(page['marked'] if isinstance(page.get('marked'), str) else page_markup(page, text))
              if isinstance(page, dict) else markup.text_to_markup(text)
              for page, text in zip(pages, texts)]

    if ext == ".txt":
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(header)
            for idx, txt in enumerate(texts):
                f.write(f"--- Page {idx+1} ---\n")
                f.write(txt if txt else "")
                f.write("\n\n")

    elif ext == ".docx":
        # Markup is the mirrored behaviour (same document shape as the JS
        # writer). PRASER_DOCX_LAYOUT=1 keeps the exact-layout writer for
        # callers who want the source page reproduced.
        if os.environ.get("PRASER_DOCX_LAYOUT", "").lower() in ("1", "true", "yes", "on"):
            _write_docx_layout(out_path, pages, pdf_path)
        else:
            write_docx_markup(out_path, iter(marked), len(marked))

    elif ext == ".pdf":
        _write_pdf(out_path, iter(marked), {}, pdf_path, len(marked))

    else:
        raise ValueError(f"Unsupported output extension: {ext} (use .txt/.docx/.pdf)")

    return out_path


def render_and_scan(out_path, pages, counts, filename):
    """Render first, scan its text with Engine POS, then atomically publish.

    A failed render or POS scan leaves any existing destination untouched.
    The scratch output has the same suffix and filesystem as the destination.
    """
    from pathlib import Path
    from myangustis_parser.normalize import pos_scan

    target = Path(out_path)
    if not target.suffix:
        target = target.with_name(target.name + '.txt')
    fd, scratch = tempfile.mkstemp(prefix='.' + target.stem + '-', suffix=target.suffix,
                                    dir=target.parent)
    os.close(fd)
    try:
        render_texts(scratch, pages, counts, filename)
        report = pos_scan.scan_pages_sync(pages)
        os.replace(scratch, target)
    finally:
        if os.path.exists(scratch):
            os.unlink(scratch)
    return str(target), report


def process_pdf_bytes(data, detector, filename="upload.pdf", log=lambda m: None, *, text_layout=None, source_encoding="auto"):
    """Run the streaming pipeline on raw PDF bytes (API preview job).

    Single pass, layout kept: the job carries per-page reports (base/clean
    for the preview diff) AND the page layout (lines/wh/has_img) so finalize
    can render the exact-layout DOCX. No metadata scan.
    """
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name
    try:
        # Keep pg["text"] at base here so reports retain base vs clean diffs;
        # build_final_pages / build_content apply cleanup unconditionally.
        metadata, npages, reports_iter = process_pdf_stream(
            tmp_path, detector, False, log=log, want_layout=True, text_layout=text_layout,
            source_encoding=source_encoding, book_name=filename)
        reports = []
        pages = []
        counts = {"ZAWGYI": 0, "UNICODE": 0, "UNKNOWN": 0}
        encoding_path = None
        for rep in reports_iter:
            cat = rep["category"]
            base = rep["text"]
            path = rep.get('text_path')
            clean = rep['clean']
            if path:
                encoding_path = path
            reports.append({"page": rep["page"], "category": cat,
                            "prob": rep["prob"], "base": base, "clean": clean,
                            "decision": rep["decision"], "scan": rep["scan"],
                            **({'warnings': rep['warnings']} if rep.get('warnings') else {}),
                            **({'text_path': path} if path else {})})
            pages.append({"text": base, "lines": rep["lines"], "wh": rep["wh"],
                          "has_img": rep["has_img"], "images": rep.get("images", [])})
            counts[cat] = counts.get(cat, 0) + 1
        changes = collect_changes(reports)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    return {
        "filename": filename,
        "kind": "pdf",
        "reports": reports,
        "counts": counts,
        "metadata": {},
        "changes": changes,
        "pages": pages,
        **({'encoding_path': encoding_path} if encoding_path else {}),
    }


# ═══════════════════════════════════════════════════════════════════════════
#  DOCX input — same pipeline, different container
# ═══════════════════════════════════════════════════════════════════════════

# Keep bounded chunks for conversion and output.
_DOCX_CHUNK_PARAGRAPHS = 80


def _chunk_paragraphs(paragraphs, per_chunk=_DOCX_CHUNK_PARAGRAPHS):
    """Group paragraphs into detection chunks (list[str] -> list[str])."""
    if not paragraphs:
        return [""]
    return ["\n".join(paragraphs[i:i + per_chunk])
            for i in range(0, len(paragraphs), per_chunk)]


def process_docx_bytes(data, detector, filename="upload.docx", log=lambda m: None,
                       *, image_dir=None, source_encoding="auto"):
    """Extract DOCX chunks, classify from encoding/font evidence, and finish.

    With ``image_dir`` set, embedded pictures are extracted and replaced by
    OCR markers for the manager. Unknown text stays in stored order; direct
    run bold/italic marks are retained. Coordinates are not retained, but
    finished pages can be written as TXT, DOCX or PDF.
    """
    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name
    image_files = [] if image_dir is not None else None
    fonts_by_paragraph = []
    try:
        paragraphs = extract_docx_paragraphs(tmp_path, image_dir=image_dir,
                                             image_files=image_files,
                                             font_names_by_paragraph=fonts_by_paragraph)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    chunks = _chunk_paragraphs(paragraphs)

    reports = []
    pages = []
    counts = {"ZAWGYI": 0, "UNICODE": 0, "UNKNOWN": 0}
    for idx, chunk in enumerate(chunks):
        # OCR placeholders are internal; they are not evidence about the
        # document's encoding or keyboard.
        fonts = set().union(*fonts_by_paragraph[idx * _DOCX_CHUNK_PARAGRAPHS:
                                                (idx + 1) * _DOCX_CHUNK_PARAGRAPHS])
        text = strip_image_markers(chunk)
        category, prob = detector.detect(text, source_encoding=source_encoding, font_names=fonts)
        if source_encoding == 'auto' and contains_myanmar(text) and has_only_unicode_fonts(fonts):
            category = 'UNICODE'
        cat = _norm_category(category)
        # Explicit or direct DOCX font evidence selects the encoding. Missing
        # or mixed font declarations never count as a Zawgyi face.
        chosen = ('zawgyi-one' if cat == 'ZAWGYI' else
                  'unicode' if cat == 'UNICODE' else source_encoding)
        if cat == 'UNKNOWN':
            # DOCX source.js does not infer a page decision or reorder unknown
            # text; missing/mixed font evidence leaves the stored text alone.
            base, clean, decision = chunk, None, 'unknown'
            scan_result = finish.scan.scan_text(base)
        elif cat == 'UNICODE' and source_encoding == 'auto' and has_only_unicode_fonts(fonts):
            # A direct known Unicode face keeps the stored base text; JS's
            # cleanup follow-up does not perform pre-base mark movement.
            base, clean, decision = chunk, preserve_regional_runs(chunk, cleanup_text), 'aligned'
            scan_result = finish.scan.scan_text(clean)
        else:
            # The pinned JS currently throws ReferenceError in these two
            # branches (missing orderZawgyi/orderUnicode bindings). Keep the
            # existing Python conversion operational; this is a known gap.
            finished = finish.finish_text(chunk, source='parse', source_encoding=chosen)
            base, clean, decision, scan_result = (finished['base'], finished['clean'],
                                                   finished['decision'], finished['scan'])
        reports.append({"page": idx + 1, "category": cat,
                        "prob": _safe_prob(prob), "base": base, "clean": clean,
                        "decision": decision, "scan": scan_result})
        pages.append({"text": base, "marked": True})
        counts[cat] = counts.get(cat, 0) + 1

    job = {
        "filename": filename,
        "kind": "docx",
        "reports": reports,
        "counts": counts,
        "metadata": {},
        "changes": collect_changes(reports),
        "pages": pages,
    }
    if image_files is not None:
        job["image_files"] = image_files
    return job


def process_bytes(data, kind, detector, filename=None, log=lambda m: None, *, text_layout=None, source_encoding="auto"):
    """One entry for both server-side formats: kind = 'pdf' | 'docx'."""
    kind = (kind or "").lower()
    if kind == "pdf":
        return process_pdf_bytes(data, detector,
                                 filename=filename or "upload.pdf", log=log, text_layout=text_layout, source_encoding=source_encoding)
    if kind == "docx":
        return process_docx_bytes(data, detector,
                                  filename=filename or "upload.docx", log=log, source_encoding=source_encoding)
    raise ValueError(f"Unsupported kind: {kind!r} (use 'pdf' or 'docx')")


def build_final_pages(job, apply_cleanup=True):
    """Assemble final render pages from a job.

    Lines already hold the CONVERTED base text — cleanup runs internally
    as part of finishing; Rabbit is never re-run (no double conversion).
    """
    out = []
    for pg, rep in zip(job["pages"], job["reports"]):
        if job.get('kind') == 'pdf' and pg.get('_ocr_supplied'):
            # JS finalizes the original geometry ahead of OCR text when any
            # extractable lines remain; OCR text itself is not PDF-finished.
            page = {"text": pg["text"], "lines": pg.get("lines", []),
                    "wh": pg["wh"], "has_img": pg["has_img"], "images": pg.get("images", [])}
            page["marked"] = page_markup(page)
            page["text"] = markup.strip_markup(page["marked"])
            out.append(page)
            continue
        if "lines" not in pg:
            text = (rep["clean"]
                    if (apply_cleanup and rep.get("clean") is not None)
                    else pg["text"])
            marked = (markup.marked_text_to_markup(text) if pg.get('marked')
                      else markup.text_to_markup(text))
            page = {"text": markup.strip_markup(marked), "marked": marked}
            out.append(page)
            continue
        if apply_cleanup and rep["clean"] is not None:
            if job.get('kind') == 'pdf':
                # PDF base lines have already passed the one output ordering.
                # Legacy pages must not receive Unicode cleanup at all.
                transform = ((lambda value: value) if rep.get('decision') == 'legacy'
                             else lambda value: preserve_regional_runs(value, cleanup_text))
            else:
                transform = finish.clean
            lines = [(line[0], line[1], line[2], transform(line[3]),
                      line[4] if len(line) > 4 else None) for line in pg["lines"]]
            text = rep["clean"]
        else:
            lines = pg["lines"]
            text = pg["text"]
        page = {"text": text, "lines": lines,
                "wh": pg["wh"], "has_img": pg["has_img"], "images": pg.get("images", [])}
        page["marked"] = page_markup(page)
        out.append(page)
    return out
