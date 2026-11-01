"""Output font profiles for PDF & DOCX.

FINAL RULE: only two fonts are ever used to WRITE output —
  * Anonymous Pro  (Latin/English, monospace)  ./fonts/output/
  * MyanmarSagar   (Burmese)                    ./fonts/output/

Roles still control size/spacing/alignment, but every role resolves to the
same two faces. Both the PDF (fpdf) and DOCX writers go through this module,
so the two outputs always agree.
"""

import re

from paths import OUTPUT_FONT_DIR

# ---- Latin (English) font: Anonymous Pro -------------------------------------
ANONYMOUS_PRO_FILES = {   # style -> file
    "":   OUTPUT_FONT_DIR / "AnonymousPro-Regular.ttf",
    "B":  OUTPUT_FONT_DIR / "AnonymousPro-Bold.ttf",
    "I":  OUTPUT_FONT_DIR / "AnonymousPro-Italic.ttf",
    "BI": OUTPUT_FONT_DIR / "AnonymousPro-BoldItalic.ttf",
}

# ---- Burmese font: MyanmarSagar, nothing else ---------------------------------
# MyanmarSagar is the only user-favourite face with FULL Myanmar base-block
# coverage (160/160, U+1000-109F), so it replaces YoeYar-One (85/160) as the
# Burmese output face. Ships a single regular weight — no bold file, so bold
# Burmese falls back to the same regular face (weight is not preserved anyway).
BURMESE_FONTS = {
    "MyanmarSagar": {
        "files": {"": "MyanmarSagar.ttf"},
        "docx": "Myanmar Sagar",
    },
}

DEFAULT_BURMESE_KEY = "MyanmarSagar"

# role -> formatting. english = (AnonymousPro style). size in pt.
FONT_ROLES = {
    "title": {
        "english_style": "B", "burmese": DEFAULT_BURMESE_KEY,
        "bold": True, "size": 14, "char_spacing": 0.2, "line_spacing": 1.4,
        "color": (40, 40, 40), "align": "L",
    },
    "heading": {
        "english_style": "B", "burmese": DEFAULT_BURMESE_KEY,
        "bold": True, "size": 12, "char_spacing": 0.15, "line_spacing": 1.5,
        "color": (60, 60, 60), "align": "L",
    },
    "paragraph": {
        "english_style": "", "burmese": DEFAULT_BURMESE_KEY, "bold": False,
        "size": 11, "char_spacing": 0.35, "line_spacing": 1.7,
        "color": (0, 0, 0), "align": "L",
    },
    "bold": {
        "english_style": "B", "burmese": DEFAULT_BURMESE_KEY, "bold": True,
        "size": 11, "char_spacing": 0.3, "line_spacing": 1.7,
        "color": (0, 0, 0), "align": "L",
    },
    "italic": {
        "english_style": "I", "burmese": DEFAULT_BURMESE_KEY, "bold": False,
        "size": 11, "char_spacing": 0.3, "line_spacing": 1.7,
        "color": (0, 0, 0), "align": "L",
    },
    "page_number": {
        "english_style": "", "burmese": DEFAULT_BURMESE_KEY, "bold": False,
        "size": 9, "char_spacing": 0.2, "line_spacing": 1.4,
        "color": (120, 120, 120), "align": "C",
    },
    "meta": {
        "english_style": "", "burmese": DEFAULT_BURMESE_KEY, "bold": False,
        "size": 8, "char_spacing": 0.15, "line_spacing": 1.4,
        "color": (100, 100, 100), "align": "L",
    },
}

_PAGE_MARKER_RE = re.compile(r'^\s*---\s*Page\s+\d+\s*---\s*$')


def classify_text_role(line, prev_blank=True):
    """Heuristically pick a FONT_ROLES key for a body text line."""
    s = line.strip()
    if not s:
        return "blank"
    if _PAGE_MARKER_RE.match(s):
        return "page_number"
    no_punct = not re.search(r"[.!?\u104a\u104b,;:]+$", s)
    if prev_blank and 2 <= len(s) <= 60 and no_punct:
        return "heading"
    return "paragraph"


def burmese_font_key(role):
    """Every role resolves to MyanmarSagar."""
    return DEFAULT_BURMESE_KEY


def _register_pdf_fonts(pdf):
    """Register Anonymous Pro + MyanmarSagar (the only two output fonts)."""
    for style, path in ANONYMOUS_PRO_FILES.items():
        if path.is_file():
            pdf.add_font("AnonymousPro", style, str(path), uni=True)
    for key, spec in BURMESE_FONTS.items():
        for style, fname in spec["files"].items():
            path = OUTPUT_FONT_DIR / fname
            if path.is_file():
                pdf.add_font(key, style, str(path), uni=True)


def _apply_pdf_role(pdf, role, use_english=True):
    """Set current PDF font (AnonymousPro primary + MyanmarSagar fallback)."""
    cfg = FONT_ROLES[role]
    eng_style = cfg["english_style"]
    if use_english:
        pdf.set_font("AnonymousPro", eng_style, cfg["size"])
    else:
        pdf.set_font(DEFAULT_BURMESE_KEY, "", cfg["size"])
    pdf.set_fallback_fonts([DEFAULT_BURMESE_KEY])
    pdf.set_char_spacing(cfg["char_spacing"])
    if cfg["color"]:
        pdf.set_text_color(*cfg["color"])


def _docx_family(role):
    """(english_family, burmese_family, bold, italic, size_halfpt, cs, ls)."""
    cfg = FONT_ROLES[role]
    eng = "Anonymous Pro"
    bm = BURMESE_FONTS[DEFAULT_BURMESE_KEY]["docx"]
    bold = cfg["bold"]
    italic = cfg["english_style"] in ("I", "BI")
    size = round(cfg["size"] * 2)  # half-points
    return eng, bm, bold, italic, size, cfg["char_spacing"], cfg["line_spacing"]
