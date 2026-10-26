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
from pathlib import Path

from paths import find_model_path
from decrypt import (
    decrypt_pdf,
    expand_object_streams,
    has_object_streams,
    is_encrypted_pdf,
)
from rabbit import Rabbit
from cleanup import cleanup_text, order_text
from docx_extract import extract_docx_paragraphs
from mm_score import score_text
from pdf_extract import (
    CmapIdentityMap,
    DocumentDecoding,
    IDENTITY,
    ARLARWADE_AYAR_MAP,
    LegacyAyarMap,
    LEGACY_CODE_PAGES,
    detect_legacy_layout_fonts,
    parse_pdf_objects,
    find_font_streams,
    find_tounicode_maps,
    load_sidecar_map,
    pick_embedded_font,
    get_stream,
    parse_tounicode_stream,
    parse_ttf_cmap,
    find_root_pages,
    collect_pages,
    extract_page_lines,
    page_has_images,
    get_page_mediabox,
)
from render import _write_docx_layout, _write_pdf

# Pages probed with direct Identity-H decoding before deciding whether the
# document needs the ToUnicode / embedded-font-cmap fallback path.
_DETECT_PROBE_PAGES = 20


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


# A layout this document actually uses scores ~0.97; one it does not scores
# ~0.58 (measured on a 445-page legacy grammar, correct table vs wrong table).
# The floor sits between them, well clear of both.
LEGACY_QUALITY_FLOOR = 0.85

# Pages sampled when ranking layouts. Enough Myanmar to be decisive, few
# enough that trying every registered layout stays cheap.
_CODE_PAGE_PROBE_PAGES = 6



def _choose_code_page(objects, all_pages, legacy_map):
    """Pick the legacy layout that decodes this document best.

    A legacy code page belongs to a keyboard layout, not to a typeface, and
    nothing in the PDF records which one was used -- the font names lie. So
    every registered layout is tried on a sample of pages and scored on
    whether the result reads like Burmese (marks attached to bases, in a
    possible order). The winner is returned with its score, so the caller can
    warn when even the best one does not fit.

    Returns ``(table, name, score, ranking)``.

    The ZawCode slot table is deliberately absent: it is not a legacy
    byte-table candidate and must never be gated in by a font calling
    itself ZawCode (font names lie). ZawCode-stored text is identified by
    the readable result of the Unicode/cmap reading instead; the JS
    worker performs that split today (see TODO for the Python mirror).
    """
    candidates = dict(LEGACY_CODE_PAGES)
    ranking = []
    for name, table in candidates.items():
        strategy = DocumentDecoding("legacy", legacy_map, table)
        chunks = []
        for pnum, pgen in all_pages[:_CODE_PAGE_PROBE_PAGES]:
            try:
                plines, _, _ = extract_page_lines(objects, pnum, pgen, strategy)
            except Exception:
                continue
            chunks.append("\n".join(x[3] for x in plines))
        sample = "\n".join(chunks)
        # Score what the pipeline actually delivers. Reorder-by-priority is
        # no longer done at parse time -- it runs on every page later, in
        # order_text -- so a layout has to be judged on its ORDERED text or
        # every candidate is penalised for a typing order that is about to
        # be fixed. Imposter cleanup is deliberately not applied here: it is
        # the Unicode branch's step and the category is not known yet.
        result = score_text(order_text(sample))
        # A sample with almost no marks cannot be judged; treat it as unfit
        # rather than letting a near-empty decode win by default.
        ranking.append((name, result["score"] if result["marks"] >= 50 else 0.0))
    ranking.sort(key=lambda r: -r[1])
    best_name, best_score = ranking[0]
    return candidates[best_name], best_name, best_score, ranking



def _is_myanmar_category(category):
    return _norm_category(category) in ("ZAWGYI", "UNICODE")


def load_detector():
    """Load the Zawgyi detector. Raises RuntimeError if unavailable."""
    try:
        from detector import ZawgyiDetector
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(
            f"Could not import detector.ZawgyiDetector ({e}). "
            "Place detector.py next to this script."
        )

    model_path = find_model_path()
    if not Path(model_path).is_file():
        raise RuntimeError(
            f"Zawgyi model not found (searched: {model_path}). "
            "Expected zawgyiUnicodeModel.dat under module/model/ (or set ZAWGYI_MODEL)."
        )
    return ZawgyiDetector(model_path)


# ═══════════════════════════════════════════════════════════════════════════
#  STREAMING path — one page at a time, flat memory, single pass
# ═══════════════════════════════════════════════════════════════════════════

def stream_pdf_pages(pdf_path, detector=None, log=lambda m: None):
    """Stream per-page layout: returns ``(metadata, npages, iterator)``.

    The iterator yields one dict per page, ONE PAGE AT A TIME:

        {"idx", "text", "lines": [(x, y, size, text)...], "wh": (w, h),
         "has_img": bool}

    ``metadata`` is always ``{}`` — the final pipeline does not scan PDF
    metadata (that full-object regex pass was pure overhead).

    Decoding strategy (model-first, fonts only as a last resort):

    1. When a ``detector`` is supplied, the first ``_DETECT_PROBE_PAGES``
       pages are decoded directly (Identity-H: the content-stream code IS the
       code point) and scored. If any probe page is Myanmar, every page is
       streamed with direct decoding — no font file and no CMap are touched.

    2. Otherwise (subset/custom-encoded fonts, or no Burmese text at all) the
       PDF's ``/ToUnicode`` CMaps (blanked copy-protection decoys skipped)
       plus the cross-volume sidecar map, and if needed the embedded font's
       ``cmap`` table, are built ONCE and then every page is streamed through
       them.
    """
    with open(pdf_path, "rb") as f:
        raw = f.read()
    # Byte-level pre-processing (modules/decrypt.py, mirroring the JS
    # parser): restrictions-only encryption and /ObjStm object streams are
    # rewritten once with qpdf, or the object scan below cannot see the
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
        lines, w, h = extract_page_lines(objects, pnum, pgen, code_to_uni)
        return {
            "idx": idx,
            "lines": lines,
            "wh": (w, h),
            "text": "\n".join(t for _, _, _, t in lines),
            "has_img": has_img,
            # How the glyph ids became characters, carried to the report
            # because the cmap fork below needs it (JS: pg.decodeKind).
            "decode_kind": getattr(code_to_uni, "kind", None),
        }

    def gen():
        # --- Pass 1: model-first direct (Identity-H) decoding -------------
        # The codes ARE the code points; simple fonts on the same page still
        # go through their own declared encoding, so Latin resources are not
        # read as Myanmar code points.
        direct = DocumentDecoding("identity")
        if detector is not None:
            probe_n = min(_DETECT_PROBE_PAGES, npages)
            probe = [_page(idx, direct) for idx in range(probe_n)]
            has_myanmar = any(
                _is_myanmar_category(detector.detect(p["text"])[0]) for p in probe
            )
            if has_myanmar:
                log("[+] Identity-H direct decode — no font/CMap lookup needed")
                for p in probe:
                    yield p
                for idx in range(probe_n, npages):
                    yield _page(idx, direct)
                    if (idx + 1) % 500 == 0:
                        log(f"    ... extracted {idx + 1}/{npages} pages")
                return
            log("[i] No Myanmar found via direct decode; trying ToUnicode/font cmap")

        # --- Pass 2: truth-first decoding sources --------------------------
        # (a) Embedded font cmap, reversed (the original v1 "peek the font"
        #     method). For these books the font cmap is the GLYPH TRUTH; the
        #     /ToUnicode streams are copy-protection decoys (blanked or with
        #     scrubbed codepoints) and must never win while a cmap decodes.
        # (b) ToUnicode CMaps (+ cross-volume sidecar fill) — fallback for
        #     CFF/OpenType fonts with no usable cmap.
        # Each source is verified with the Markov model on probe pages.
        #
        # None of them is a page-wide decoder any more: a source is the
        # document-level FALLBACK that the per-resource decoders in pdf_fonts
        # consult for the symbolic Myanmar faces. A font resource that
        # declares a real encoding (/WinAnsiEncoding, /MacRomanEncoding, an
        # /Encoding dict) never reaches it, which is what stops Latin
        # character codes from being read as Myanmar glyph ids.
        probe_n2 = min(_DETECT_PROBE_PAGES, npages)

        def _decodes_myanmar(strategy):
            for i in range(probe_n2):
                pnum, pgen = all_pages[i]
                plines, _, _ = extract_page_lines(objects, pnum, pgen, strategy)
                t = "\n".join(x[3] for x in plines)
                if _is_myanmar_category(detector.detect(t)[0]):
                    return True
            return False

        cmap_map = {}
        conflicts = 0
        font_refs = find_font_streams(objects)
        if font_refs:
            log(f"[+] Embedded font-stream candidates: {len(font_refs)}")
            # Merge the cmap reversal of EVERY embedded font — the book
            # subsets the same base font per page batch, so glyph IDs are
            # shared but each subset's cmap only covers its own glyphs.
            # The Myanmar-glyph font goes first and wins any gid conflict.
            # Each font resource still prefers the cmap of the font program
            # IT points at; this merge only fills what that cannot cover.
            ff_ref, ttf0, cmap0 = pick_embedded_font(objects, font_refs)
            ordered = ([ff_ref] if ff_ref else []) + \
                      [r for r in font_refs if r != ff_ref]
            used = 0
            for ref in ordered:
                if ff_ref and ref == ff_ref:
                    ttf, cmap = ttf0, cmap0
                else:
                    ttf = get_stream(objects, *ref)
                    cmap = parse_ttf_cmap(ttf) if ttf else {}
                if not cmap:
                    continue
                used += 1
                for uni, gid in cmap.items():
                    if not gid:
                        continue
                    if gid in cmap_map:
                        if cmap_map[gid] != uni:
                            conflicts += 1
                        continue
                    cmap_map[gid] = uni
            log(f"[+] Merged font cmap entries: {len(cmap_map)} "
                f"from {used} font stream(s)"
                + (f"; {conflicts} gid conflict(s) (first font wins)"
                   if conflicts else ""))

        # Arlarwade subsets are old Ayar-compatible fonts.  Their cmap maps
        # the PDF character code to a *renumbered glyph id*, so reversing it
        # (the generic cmap path above) cannot recover the legacy code.  The
        # stable character-code table is the authoritative path for this
        # family and is checked before the generic glyph-id fallback.
        # Identification is structural, not by name: a simple font with no
        # /Encoding whose /ToUnicode returns non-Myanmar characters is an
        # ASCII-slot legacy face, whatever /BaseFont claims.
        legacy_fonts = detect_legacy_layout_fonts(
            objects, get_stream, parse_tounicode_stream)
        legacy_map = LegacyAyarMap(ARLARWADE_AYAR_MAP) if legacy_fonts else {}
        legacy_page = None
        if legacy_map:
            log(f"[+] Legacy-layout fonts: {len(legacy_fonts)}")
            legacy_page, legacy_page_name, legacy_quality, ranking = \
                _choose_code_page(objects, all_pages, legacy_map)
            for nm, sc in ranking:
                log(f"    layout {nm!r}: {sc:.3f}"
                    + ("  <- chosen" if nm == legacy_page_name else ""))
            if legacy_quality < LEGACY_QUALITY_FLOOR:
                # No registered layout fits, so do not decode as legacy at
                # all. The legacy strategy exists for faces whose /ToUnicode
                # is a copy-protection decoy, and it distrusts those maps
                # document-wide. Applying it to a document we cannot actually
                # decode throws away /ToUnicode maps that may be perfectly
                # genuine -- and because legacy subsets number their glyphs
                # from 0x01, the undecoded bytes are then dropped as control
                # characters and the page comes out EMPTY. Falling back costs
                # nothing when the layout is unknown and recovers the whole
                # document when the maps are real.
                log(f"[!] No registered legacy layout fits this document "
                    f"(best {legacy_page_name!r} scores {legacy_quality:.3f}, "
                    f"expected >= {LEGACY_QUALITY_FLOOR:.2f}). Falling back to "
                    f"each font's own /ToUnicode. If the Myanmar text is wrong, "
                    f"add this layout's code page to LEGACY_CODE_PAGES in "
                    f"pdf_fonts.py.")
                legacy_map = {}
                legacy_page = None

        # Document-wide ToUnicode merge (+ the cross-volume sidecar cipher).
        # Fonts consult their OWN /ToUnicode first; this merge is only the
        # last-resort fill for the codes their own map does not cover.
        tu_map = find_tounicode_maps(objects)
        own_tu = len(tu_map)
        sidecar = load_sidecar_map()
        for code, uni in sidecar.items():
            tu_map.setdefault(code, uni)
        if tu_map:
            log(f"[+] ToUnicode mappings: {own_tu}"
                + (f" (+{len(tu_map) - own_tu} from sidecar cipher map)" if sidecar else ""))

        decoding = None
        if detector is not None:
            if legacy_map and _decodes_myanmar(DocumentDecoding("legacy", legacy_map, legacy_page)):
                decoding = DocumentDecoding("legacy", legacy_map, legacy_page)
                log("[+] Decoding via Arlarwade/Ayar legacy character map")
            elif cmap_map and _decodes_myanmar(
                    DocumentDecoding("cmap", CmapIdentityMap(cmap_map))):
                # cmap is the glyph truth; CmapIdentityMap adds the two
                # decode truths: 0x0000 = tab/space, unmapped valid code
                # points = exact-Unicode fonts. ToUnicode NEVER fills gaps
                # here — it is the copy-protection decoy.
                decoding = DocumentDecoding("cmap", CmapIdentityMap(cmap_map))
                log("[+] Decoding via embedded font cmap (glyph truth) "
                    "+ identity fallback for exact-Unicode fonts")
            elif tu_map and _decodes_myanmar(DocumentDecoding("tounicode", tu_map)):
                decoding = DocumentDecoding("tounicode", tu_map)
                log("[+] Decoding via ToUnicode/sidecar map")
        if decoding is None:
            if legacy_map:
                decoding = DocumentDecoding("legacy", legacy_map, legacy_page)
            elif cmap_map:
                decoding = DocumentDecoding("cmap", cmap_map)
            elif tu_map:
                decoding = DocumentDecoding("tounicode", tu_map)
            else:
                decoding = DocumentDecoding("none")

        if decoding.kind == "none":
            log("[!] No font cmap and no ToUnicode map; "
                "unmapped codes will appear as [XXXX] placeholders")

        for idx in range(npages):
            yield _page(idx, decoding)
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
                       want_layout=False):
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
    metadata, npages, pages = stream_pdf_pages(pdf_path, detector=detector, log=log)

    def reports():
        for pg in pages:
            idx = pg["idx"]
            raw = pg["text"]
            category, prob = detector.detect(raw)
            cat = _norm_category(category)
            cat = _cmap_fork(cat, raw, pg.get("decode_kind"), idx, category, log)

            # Mark ordering is not a toggle and not a branch: every page
            # gets it, Zawgyi after Rabbit, Unicode as extracted, Unknown
            # too (where it is a no-op -- nothing to order outside Myanmar).
            if cat == "ZAWGYI":
                base = order_text(Rabbit.zg2uni(raw))
                log(f"    Page {idx + 1}: ZAWGYI (p={prob:.3f}) -> converted")
            elif cat == "UNICODE":
                base = order_text(raw)
                log(f"    Page {idx + 1}: UNICODE (p={prob:.3f}) -> kept")
            else:
                base = order_text(raw)
                log(f"    Page {idx + 1}: UNKNOWN -> passed through")
                rep = {"page": idx + 1, "category": cat, "prob": _safe_prob(prob),
                       "text": base, "n_changes": 0}
                if want_layout:
                    rep.update({"lines": _conv_lines(pg["lines"], None, None),
                                "wh": pg["wh"], "has_img": pg["has_img"]})
                yield rep
                continue

            clean = _cleanup_for(cat, base)
            n_changes = 0 if clean is None or clean == base \
                else _count_diff_lines(base, clean)
            text = clean if (apply_cleanup and clean is not None) else base
            rep = {"page": idx + 1, "category": cat, "prob": _safe_prob(prob),
                   "text": text, "n_changes": n_changes}
            if want_layout:
                rep.update({"lines": _conv_lines(pg["lines"], cat, apply_cleanup),
                            "wh": pg["wh"], "has_img": pg["has_img"]})
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
    if cat == "UNICODE" and apply_cleanup:
        return cleanup_text(t)
    return order_text(t)


def _conv_lines(lines, cat, apply_cleanup):
    """Per-line conversion mirroring the page-level transform (layout mode)."""
    return [(x, y, size, _convert_line(t, cat, apply_cleanup))
            for (x, y, size, t) in lines]


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
        pages.append({k: rep[k] for k in ("text", "lines", "wh", "has_img") if k in rep})
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


def build_content(job, apply_cleanup=False, kind=None):
    """Whole document body as ONE plain text string (API output).

    Every page's final text joined with a blank line — no metadata banner,
    no ``--- Page N ---`` markers, no HTML tags. This is what a caller that
    just wants the text (e.g. the Node backend feeding the grammar engine)
    consumes. ``apply_cleanup=True`` returns the cleaned variant.

    ``kind`` (or ``job['kind']``) picks the join: PDF page texts are joined
    with a blank line (page = block); DOCX page texts are chunked paragraph
    runs and join with a single newline (paragraph = line).
    """
    kind = (kind or job.get("kind") or "pdf").lower()
    sep = "\n" if kind == "docx" else "\n\n"
    parts = []
    for pg, rep in zip(job["pages"], job["reports"]):
        if apply_cleanup and rep.get("clean") is not None:
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

    if ext == ".txt":
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(header)
            for idx, txt in enumerate(texts):
                f.write(f"--- Page {idx+1} ---\n")
                f.write(txt if txt else "")
                f.write("\n\n")

    elif ext == ".docx":
        _write_docx_layout(out_path, pages, pdf_path)

    elif ext == ".pdf":
        _write_pdf(out_path, texts, {}, pdf_path, len(texts))

    else:
        raise ValueError(f"Unsupported output extension: {ext} (use .txt/.docx/.pdf)")

    return out_path


def process_pdf_bytes(data, detector, filename="upload.pdf", log=lambda m: None):
    """Run the streaming pipeline on raw PDF bytes (API preview job).

    Single pass, layout kept: the job carries per-page reports (base/clean
    for the preview diff) AND the page layout (lines/wh/has_img) so finalize
    can render the exact-layout DOCX. No metadata scan.
    """
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name
    try:
        # apply_cleanup=False here: the apply decision comes at finalize time.
        metadata, npages, reports_iter = process_pdf_stream(
            tmp_path, detector, False, log=log, want_layout=True)
        reports = []
        pages = []
        counts = {"ZAWGYI": 0, "UNICODE": 0, "UNKNOWN": 0}
        for rep in reports_iter:
            cat = rep["category"]
            base = rep["text"]          # converted base (no cleanup yet)
            clean = _cleanup_for(cat, base)   # UNICODE only
            reports.append({"page": rep["page"], "category": cat,
                            "prob": rep["prob"], "base": base, "clean": clean})
            pages.append({"text": base, "lines": rep["lines"], "wh": rep["wh"],
                          "has_img": rep["has_img"]})
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
    }


# ═══════════════════════════════════════════════════════════════════════════
#  DOCX input — same pipeline, different container
# ═══════════════════════════════════════════════════════════════════════════

# Paragraphs per detection/conversion chunk. The detector is a Markov model
# over Myanmar codepoint sequences: it needs a run of text to be confident,
# but a whole 300-page novel in one string would slow the per-chunk Rabbit
# pass for no gain. 80 paragraphs ≈ one book page — same granularity the PDF
# path detects at.
_DOCX_CHUNK_PARAGRAPHS = 80


def _chunk_paragraphs(paragraphs, per_chunk=_DOCX_CHUNK_PARAGRAPHS):
    """Group paragraphs into detection chunks (list[str] -> list[str])."""
    if not paragraphs:
        return [""]
    return ["\n".join(paragraphs[i:i + per_chunk])
            for i in range(0, len(paragraphs), per_chunk)]


def process_docx_bytes(data, detector, filename="upload.docx", log=lambda m: None):
    """Run the SAME detect -> Rabbit -> cleanup pipeline on raw DOCX bytes.

    The docx container only stores text, so extraction is trivial (see
    :mod:`docx_extract`); the ENCODING work is what the browser could never
    do and the reason .docx is parsed server-side. No layout is kept — DOCX
    finalize supports txt output only.
    """
    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name
    try:
        paragraphs = extract_docx_paragraphs(tmp_path)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    reports = []
    pages = []
    counts = {"ZAWGYI": 0, "UNICODE": 0, "UNKNOWN": 0}
    for idx, chunk in enumerate(_chunk_paragraphs(paragraphs)):
        category, prob = detector.detect(chunk)
        cat = _norm_category(category)

        # Same rule as the PDF path: ordering on every chunk, whatever the
        # category; imposter cleanup only where the Unicode branch allows it.
        if cat == "ZAWGYI":
            base = order_text(Rabbit.zg2uni(chunk))
        else:
            base = order_text(chunk)  # UNICODE kept, UNKNOWN passed through

        clean = _cleanup_for(cat, base)   # UNICODE only
        reports.append({"page": idx + 1, "category": cat,
                        "prob": _safe_prob(prob), "base": base, "clean": clean})
        pages.append({"text": base})
        counts[cat] = counts.get(cat, 0) + 1

    return {
        "filename": filename,
        "kind": "docx",
        "reports": reports,
        "counts": counts,
        "metadata": {},
        "changes": collect_changes(reports),
        "pages": pages,
    }


def process_bytes(data, kind, detector, filename=None, log=lambda m: None):
    """One entry for both server-side formats: kind = 'pdf' | 'docx'."""
    kind = (kind or "").lower()
    if kind == "pdf":
        return process_pdf_bytes(data, detector,
                                 filename=filename or "upload.pdf", log=log)
    if kind == "docx":
        return process_docx_bytes(data, detector,
                                  filename=filename or "upload.docx", log=log)
    raise ValueError(f"Unsupported kind: {kind!r} (use 'pdf' or 'docx')")


def build_final_pages(job, apply_cleanup):
    """Assemble final render pages from a stored job (API finalize).

    Lines already hold the CONVERTED base text — cleanup is applied per line
    when approved; Rabbit is never re-run (no double conversion).

    DOCX jobs carry no layout (``lines``/``wh``/``has_img`` absent) — those
    pages render txt-only; api.py refuses layout formats for them.
    """
    out = []
    for pg, rep in zip(job["pages"], job["reports"]):
        if "lines" not in pg:
            out.append({"text": rep["clean"]
                        if (apply_cleanup and rep.get("clean") is not None)
                        else pg["text"]})
            continue
        # ``clean`` is only ever set for a UNICODE page, so this per-line
        # pass cannot reach a Rabbit-converted (ZAWGYI) one.
        if apply_cleanup and rep["clean"] is not None:
            lines = [(x, y, s, cleanup_text(t)) for (x, y, s, t) in pg["lines"]]
            text = rep["clean"]
        else:
            lines = pg["lines"]
            text = pg["text"]
        out.append({"text": text, "lines": lines,
                    "wh": pg["wh"], "has_img": pg["has_img"]})
    return out
