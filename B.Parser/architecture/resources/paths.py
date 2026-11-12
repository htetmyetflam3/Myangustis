"""Path resolution for fonts, maps and input/output — the Python mirror of
``B.Parser/_path.js``.

Every path is resolved from this file's location, so the parser works from
any current working directory. The layout is the repository's, not a private
copy of it:

    <repo>/Junk/fonts/Unicode/         input-side Myanmar faces
    <repo>/Junk/fonts/used/            faces used to WRITE output
                                       (AnonymousPro-* + MyanmarSagar)
    <repo>/Junk/Parser/upload/pdf/     default input directory for PDFs
    <repo>/Junk/Parser/upload/docx/    default input directory for DOCX
    <repo>/Junk/Parser/output/txt/     default output directory for TXT
    <repo>/Junk/Parser/output/docx/    default output directory for DOCX
    <repo>/Junk/Parser/output/pdf/     default output directory for PDF
    <repo>/B.Parser/architecture/resources/maps_data/   bundled JSON maps

Environment overrides exist for deployment (`PRASER_FONT_DIR`,
`PRASER_OUTPUT_FONT_DIR`, `PRASER_UPLOAD_DIR`, `PRASER_OUTPUT_DIR`). No path
here points at a JavaScript file.
"""

import os
from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parents[1]
# In the checkout the package source is the architecture directory itself.
# Installed wheels use the normal myangustis_parser package directory instead.
PARSER_ROOT = (PACKAGE_DIR.parent if PACKAGE_DIR.name == "architecture"
               and PACKAGE_DIR.parent.name == "B.Parser" else PACKAGE_DIR.parents[1])
REPO_ROOT = PARSER_ROOT.parent
RUNTIME_ROOT = REPO_ROOT / "Junk" / "Parser"


def _first_dir(env_name, *candidates):
    """Environment override, else the first candidate that exists."""
    override = os.environ.get(env_name)
    if override:
        return Path(override)
    for candidate in candidates:
        if Path(candidate).is_dir():
            return Path(candidate)
    return Path(candidates[0])


# Input-side faces: the JS parser resolves the same directory (Junk/fonts).
FONT_DIR = _first_dir(
    "PRASER_FONT_DIR",
    REPO_ROOT / "Junk" / "fonts" / "Unicode",
    PARSER_ROOT / "fonts" / "Unicode",
)

# Faces used to WRITE output: Anonymous Pro (Latin) + MyanmarSagar (Burmese).
OUTPUT_FONT_DIR = _first_dir(
    "PRASER_OUTPUT_FONT_DIR",
    REPO_ROOT / "Junk" / "fonts" / "used",
    PARSER_ROOT / "fonts" / "output",
)
DEFAULT_MYANMAR_FONT = OUTPUT_FONT_DIR / "MyanmarSagar.ttf"

# Runtime directories under <repo>/Junk/Parser (matching B.Parser/_path.js).
# Created on demand; nothing is required to exist at import time.
UPLOAD_DIR = Path(os.environ.get("PRASER_UPLOAD_DIR") or (RUNTIME_ROOT / "upload"))
PDF_INPUT_DIR = UPLOAD_DIR / "pdf"
DOCX_INPUT_DIR = UPLOAD_DIR / "docx"
INPUT_DIR = UPLOAD_DIR / "input"

OUTPUT_DIR = Path(os.environ.get("PRASER_OUTPUT_DIR") or (RUNTIME_ROOT / "output"))
DEFAULT_OUTPUT_DIR = OUTPUT_DIR
TXT_OUTPUT_DIR = OUTPUT_DIR / "txt"
DOCX_OUTPUT_DIR = OUTPUT_DIR / "docx"
PDF_OUTPUT_DIR = OUTPUT_DIR / "pdf"


def input_dir_for(ext_or_kind):
    """Return the default upload directory for a file suffix or input kind."""
    token = str(ext_or_kind or "").strip().lower().lstrip(".")
    if token == "pdf":
        return PDF_INPUT_DIR
    if token in ("docx", "doc"):
        return DOCX_INPUT_DIR
    return UPLOAD_DIR


def output_dir_for(fmt):
    """Return the default output directory for ``txt``, ``docx``, or ``pdf``."""
    token = str(fmt or "").strip().lower().lstrip(".")
    if token == "txt":
        return TXT_OUTPUT_DIR
    if token == "docx":
        return DOCX_OUTPUT_DIR
    if token == "pdf":
        return PDF_OUTPUT_DIR
    raise ValueError(f"Unsupported output format {fmt!r} (use txt, docx or pdf)")

# Latin fallback candidates (for PDF output of non-Myanmar glyphs).
_LATIN_FONT_CANDIDATES = [
    OUTPUT_FONT_DIR / "AnonymousPro-Regular.ttf",
    FONT_DIR / "DejaVuSans.ttf",
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    Path("/usr/share/fonts/dejavu/DejaVuSans.ttf"),
    Path("C:/Windows/Fonts/arial.ttf"),
    Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
]


def find_myanmar_font():
    """Return an available Myanmar-capable TTF from the shipped font dir."""
    candidates = [
        DEFAULT_MYANMAR_FONT,                      # used/MyanmarSagar.ttf
        OUTPUT_FONT_DIR / "Aka02-Regular.ttf",
        FONT_DIR / "PYIDAUNGSU-2.5.2_REGULAR.TTF",
        FONT_DIR / "Padauk.ttf",
        FONT_DIR / "Ayar.ttf",
        FONT_DIR / "MyanmarThuriya.ttf",
        FONT_DIR / "YoeYar-One_Regular.ttf",
    ]
    for cand in candidates:
        if Path(cand).is_file():
            return Path(cand)
    if FONT_DIR.is_dir():
        for path in sorted(FONT_DIR.glob("*.ttf")):
            return path
    return DEFAULT_MYANMAR_FONT


def find_latin_font():
    """Return an available Latin fallback font, or ``None`` if none exist."""
    for cand in _LATIN_FONT_CANDIDATES:
        if Path(cand).is_file():
            return Path(cand)
    return None


def ensure_dirs():
    """Create the upload and output format directories on demand."""
    for directory in (
        PDF_INPUT_DIR,
        DOCX_INPUT_DIR,
        TXT_OUTPUT_DIR,
        DOCX_OUTPUT_DIR,
        PDF_OUTPUT_DIR,
    ):
        directory.mkdir(parents=True, exist_ok=True)
    return DEFAULT_OUTPUT_DIR
