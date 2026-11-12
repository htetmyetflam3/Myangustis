"""Output writers for .txt / .docx / .pdf, mirrored from ``@output/``.

The parsed result is one marked-up string per page (``modules/markup.py``):
``<b>``/``<i>`` inline, ``<h1>``/``<h2>`` heading lines, ``\n`` line break,
``\n\n`` paragraph break. The DOCX and PDF writers render those blocks --
headings, bold and italic come from the markup, never from preserved layout
-- exactly as ``@output/docx/write.js`` and ``@output/pdf/write.js`` do.

``_write_docx_layout`` is the exact-layout writer this tree had before the
mirror: one DOCX section per PDF page, every line at its PDF x/y. It is
still available (``PRASER_DOCX_LAYOUT=1``) because it reproduces the source
page, which the markup writer cannot -- the JS design deliberately drops
coordinates. The markup writer is the default so both parsers produce the
same document shape.

Fonts: Anonymous Pro (Latin) + MyanmarSagar (Burmese) only.
"""

import os

from myangustis_parser.output import markup
from myangustis_parser.output.fonts import (
    ANONYMOUS_PRO_FILES,
    BURMESE_FONTS,
    DEFAULT_BURMESE_KEY,
    FONT_ROLES,
    _apply_pdf_role,
    _docx_family,
    _register_pdf_fonts,
)
from myangustis_parser.resources.paths import OUTPUT_FONT_DIR

_BURMESE_DOCX_NAME = BURMESE_FONTS[DEFAULT_BURMESE_KEY]["docx"]


def _esc(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
             .replace('"', "&quot;"))


def _pdf_line_height(pdf, role):
    """Line height (document units) for the currently-active font of a role."""
    cfg = FONT_ROLES[role]
    return pdf.font_size_pt * cfg["line_spacing"] / pdf.k


def _write_pdf(out_path, texts, metadata, pdf_path, npages):
    try:
        from fpdf import FPDF
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"PDF output needs the fpdf package (pip install fpdf). {e}")

    eng_reg = ANONYMOUS_PRO_FILES.get("")
    if eng_reg is None or not eng_reg.is_file():
        raise RuntimeError(
            f"Anonymous Pro font not found in {OUTPUT_FONT_DIR} "
            "(required for PDF output)."
        )

    class _PageNumPDF(FPDF):
        def footer(self):
            # Page number in its own role/font, centered at the bottom.
            self.set_y(-15)
            _apply_pdf_role(self, "page_number")
            self.cell(0, _pdf_line_height(self, "page_number"),
                      str(self.page_no()), align="C")

    pdf = _PageNumPDF()
    pdf.set_auto_page_break(auto=True, margin=20)
    _register_pdf_fonts(pdf)

    left, top = 18, 18

    def render_header():
        pdf.set_xy(left, top)
        _apply_pdf_role(pdf, "title")
        pdf.cell(0, _pdf_line_height(pdf, "title"), f"Source: {pdf_path}",
                 new_x="LMARGIN", new_y="NEXT")
        _apply_pdf_role(pdf, "meta")
        meta_items = [("Pages", npages)] + list((metadata or {}).items())
        for k, v in meta_items:
            pdf.cell(0, _pdf_line_height(pdf, "meta"), f"{k}: {v}",
                     new_x="LMARGIN", new_y="NEXT")
        pdf.ln(5)

    for idx, txt in enumerate(texts):
        pdf.add_page()
        pdf.set_xy(left, top)
        if idx == 0:
            render_header()
            pdf.ln(3)

        # Marked-up page string: headings and paragraph breaks come from the
        # markup; bold/italic apply per line (a line wholly wrapped in <b>/<i>
        # takes that role -- mixed runs take the paragraph role).
        for block in markup.parse_markup(txt):
            for runs in block["lines"]:
                line = "".join(run["text"] for run in runs)
                if not line.strip():
                    continue
                if block["tag"] == "h1":
                    role = "title"
                elif block["tag"] == "h2":
                    role = "heading"
                elif runs and all(run["bold"] for run in runs):
                    role = "bold"
                elif runs and all(run["italic"] for run in runs):
                    role = "italic"
                else:
                    role = "paragraph"
                _apply_pdf_role(pdf, role)
                pdf.cell(0, _pdf_line_height(pdf, role), line,
                         new_x="LMARGIN", new_y="NEXT",
                         align=FONT_ROLES[role]["align"])
            pdf.ln(_pdf_line_height(pdf, "paragraph") * 0.5)

    pdf.output(out_path)
    _linearize_pdf(out_path)


def _linearize_pdf(out_path):
    """Rewrite ``out_path`` in place as a linearized ("fast web view") PDF.

    fpdf2 emits a plain PDF; linearization (page-ordered objects + a
    ``/Linearized`` dict + hint tables) is a whole-document, two-pass rewrite,
    so it can only run AFTER ``pdf.output`` — it cannot be streamed.

    Kept OPTIONAL to honour the flask+fpdf2-only default install: when pikepdf
    is not importable the (valid) non-linearized file is left untouched and a
    note is printed — never a hard failure. Install ``pikepdf`` (the
    ``pdf-linearize`` extra) to guarantee linearized output. Returns True only
    when the file on disk ends up linearized.
    """
    try:
        import pikepdf
    except Exception:  # noqa: BLE001
        print("[i] pikepdf not installed; PDF written but NOT linearized "
              "(pip install pikepdf to enable fast web view).")
        return False
    import os
    import tempfile
    tmp_fd, tmp_path = tempfile.mkstemp(
        suffix=".pdf", dir=os.path.dirname(out_path) or ".")
    os.close(tmp_fd)
    try:
        with pikepdf.open(out_path) as pdf:
            pdf.save(tmp_path, linearize=True)
        os.replace(tmp_path, out_path)   # atomic; never a half-written output
        return True
    except Exception as e:  # noqa: BLE001 - keep the already-written file
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        print(f"[i] linearization skipped ({e}); non-linearized PDF kept.")
        return False



# ═══════════════════════════════════════════════════════════════════════════
#  EXACT-LAYOUT DOCX — 1 PDF page = 1 DOCX page, same size, same positions
# ═══════════════════════════════════════════════════════════════════════════
#
# Each PDF page becomes its own DOCX section whose w:pgSz equals the page's
# MediaBox (twips = pt * 20, margins zeroed), and every extracted line is
# placed at its PDF coordinates: x -> w:ind w:left, y (converted from the
# PDF bottom-up user space to top-down) -> cumulative w:spacing w:before
# with exact line heights. Fonts: Myanmar runs get MyanmarSagar (cs), Latin
# runs Anonymous Pro, size from the content stream's Tf.

_TWIPS = 20          # twips per point
_LH = 1.2            # line-height factor for exact line rules


def _has_myanmar(text):
    return any(0x1000 <= ord(c) <= 0x109F for c in text)


def _layout_para(x_tw, before_tw, size, text):
    half = max(1, round(size * 2))
    line_tw = max(1, round(size * _LH * _TWIPS))
    bm = _BURMESE_DOCX_NAME if _has_myanmar(text) else "Anonymous Pro"
    rpr = (f'<w:rPr><w:rFonts w:ascii="Anonymous Pro" w:hAnsi="Anonymous Pro" '
           f'w:cs="{bm}"/><w:sz w:val="{half}"/><w:szCs w:val="{half}"/></w:rPr>')
    ppr = (f'<w:pPr><w:spacing w:before="{max(0, round(before_tw))}" w:after="0" '
           f'w:line="{line_tw}" w:lineRule="exact"/>'
           f'<w:ind w:left="{max(0, round(x_tw))}" w:right="0" w:firstLine="0"/>'
           f'<w:jc w:val="left"/></w:pPr>')
    return f'<w:p>{ppr}<w:r>{rpr}<w:t xml:space="preserve">{_esc(text)}</w:t></w:r></w:p>'


def _sect_pr(w_pt, h_pt):
    return (f'<w:sectPr><w:pgSz w:w="{round(w_pt * _TWIPS)}" w:h="{round(h_pt * _TWIPS)}"/>'
            f'<w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" '
            f'w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>')


def _write_docx_layout(out_path, pages, pdf_path):
    """DOCX replica of the PDF: identical page sizes and text positions.

    Streams document.xml into the zip page-by-page — memory stays constant
    no matter how many pages the book has.
    """
    import zipfile
    n = len(pages)
    head = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>')

    with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr('[Content_Types].xml',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            '</Types>')
        zf.writestr('_rels/.rels',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            '</Relationships>')
        with zf.open('word/document.xml', 'w') as doc:
            doc.write(head.encode('utf-8'))
            for i, pg in enumerate(pages):
                chunk = []
                w_pt, h_pt = pg.get("wh") or (612.0, 792.0)
                lines = pg.get("lines") or []
                if lines:
                    # PDF input: reproduce the exact per-line x/y/size layout.
                    prev_base = None
                    prev_h = 0.0
                    for line in lines:
                        x, y, size, text = line[:4]
                        if not text:
                            continue
                        base_top = h_pt - y       # baseline, measured from page top
                        if prev_base is None:
                            before = max(0.0, base_top - size)
                        else:
                            before = max(0.0, base_top - prev_base - prev_h)
                        prev_base, prev_h = base_top, size * _LH
                        chunk.append(_layout_para(x * _TWIPS, before * _TWIPS, size, text))
                elif pg.get("text"):
                    # No geometry (DOCX input carries text only): flow the text
                    # as simple paragraphs. Same rule as the PDF image-page fix —
                    # take the text rather than emit an empty page.
                    for line in pg["text"].split("\n"):
                        chunk.append(_layout_para(0.0, 0.0, 11.0, line) if line else "<w:p/>")
                elif pg.get("has_img"):
                    chunk.append(_layout_para(20 * _TWIPS, 20 * _TWIPS, 10, "[image-only page]"))
                if i < n - 1:
                    chunk.append(f'<w:p><w:pPr>{_sect_pr(w_pt, h_pt)}</w:pPr></w:p>')
                else:
                    chunk.append(_sect_pr(w_pt, h_pt))
                doc.write("".join(chunk).encode('utf-8'))
            if n == 0:
                doc.write(_sect_pr(612.0, 792.0).encode('utf-8'))
            doc.write(b'</w:body></w:document>')


# ═══════════════════════════════════════════════════════════════════════════
#  MARKUP DOCX — @output/docx/write.js
# ═══════════════════════════════════════════════════════════════════════════
# Pages arrive as marked-up strings; paragraphs, headings and bold/italic
# runs come from the markup, never from preserved layout. document.xml is
# streamed into the zip as it is generated.

_HEADING_SIZE = {"h1": 16, "h2": 13, "p": 11}

_CONTENT_TYPES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    '</Types>')
_RELS = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    '</Relationships>')
_DOC_HEAD = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>')


def _markup_run_xml(run, size):
    bm = _BURMESE_DOCX_NAME if _has_myanmar(run["text"]) else "Anonymous Pro"
    rpr = ('<w:rPr><w:rFonts w:ascii="Anonymous Pro" w:hAnsi="Anonymous Pro" '
           f'w:cs="{bm}"/>' + ("<w:b/>" if run["bold"] else "")
           + ("<w:i/>" if run["italic"] else "")
           + f'<w:sz w:val="{size * 2}"/><w:szCs w:val="{size * 2}"/></w:rPr>')
    return f'<w:r>{rpr}<w:t xml:space="preserve">{_esc(run["text"])}</w:t></w:r>'


def _markup_para_xml(block):
    size = _HEADING_SIZE.get(block["tag"], 11)
    line_tw = max(1, round(size * _LH * _TWIPS))
    ppr = (f'<w:pPr><w:spacing w:before="0" w:after="120" '
           f'w:line="{line_tw}" w:lineRule="auto"/><w:jc w:val="left"/></w:pPr>')
    parts = []
    for index, runs in enumerate(block["lines"]):
        if index:
            parts.append("<w:r><w:br/></w:r>")
        for run in runs:
            if block["tag"] != "p":
                run = {**run, "bold": True}
            parts.append(_markup_run_xml(run, size))
    return f'<w:p>{ppr}{"".join(parts)}</w:p>'


def write_docx_markup(out_path, marked_pages, page_count=None):
    """Render marked-up page strings into a DOCX, one page break between.

    ``marked_pages`` may be a generator: pages are rendered and written one
    at a time, so a whole book never sits in memory (the JS writer streams
    ``word/document.xml`` the same way).
    """
    import zipfile
    if page_count is None:
        marked_pages = list(marked_pages)
        page_count = len(marked_pages)
    page_count = int(page_count)
    written = 0
    with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr('[Content_Types].xml', _CONTENT_TYPES)
        zf.writestr('_rels/.rels', _RELS)
        with zf.open('word/document.xml', 'w') as doc:
            doc.write(_DOC_HEAD.encode('utf-8'))
            for marked in marked_pages:
                written += 1
                chunk = [_markup_para_xml(block) for block in markup.parse_markup(marked)]
                if written < page_count:
                    chunk.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
                doc.write("".join(chunk).encode('utf-8'))
            if written != page_count:
                raise ValueError("Page count changed while writing DOCX")
            doc.write(_sect_pr(612.0, 792.0).encode('utf-8'))
            doc.write(b'</w:body></w:document>')
    return out_path


# ═══════════════════════════════════════════════════════════════════════════
#  Plain DOCX writer — text in, simple paragraphs out (no PDF layout)
# ═══════════════════════════════════════════════════════════════════════════

def write_docx_plain(out_path, text):
    """Write ``text`` as a plain DOCX: one paragraph per line.

    The result-rewrite path (Engine output -> .docx) has no PDF layout to
    reproduce — no per-line x/y or font sizes — so unlike _write_docx_layout
    this makes NO claim of being a page replica. Streams in chunks so a
    whole-book result stays constant-memory.
    """
    import zipfile

    head = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/'
            'wordprocessingml/2006/main"><w:body>')

    with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr('[Content_Types].xml',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            '</Types>')
        zf.writestr('_rels/.rels',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            '</Relationships>')
        with zf.open('word/document.xml', 'w') as doc:
            doc.write(head.encode('utf-8'))
            lines = (text or '').split('\n')
            step = 2000  # paragraphs per zip write — constant memory
            for i in range(0, len(lines), step):
                chunk = []
                for line in lines[i:i + step]:
                    if line:
                        chunk.append(_layout_para(0.0, 0.0, 11.0, line))
                    else:
                        chunk.append('<w:p/>')
                doc.write(''.join(chunk).encode('utf-8'))
            doc.write(_sect_pr(612.0, 792.0).encode('utf-8'))
            doc.write(b'</w:body></w:document>')
    return out_path
