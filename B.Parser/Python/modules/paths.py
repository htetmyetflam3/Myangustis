"""Path resolution for fonts, maps and output — the Python mirror of
``B.Parser/_path.js``.

Every path is resolved from this file's location, so the parser works from
any current working directory. The layout is the repository's, not a private
copy of it:

    <repo>/Junk/fonts/Unicode/     input-side Myanmar faces
    <repo>/Junk/fonts/used/        faces used to WRITE output
                                   (AnonymousPro-* + MyanmarSagar)
    <repo>/B.Parser/@jason-map/    shared JSON maps (see :mod:`maps`)
    <repo>/B.Parser/.output/       default output directory

Environment overrides exist for deployment (`PRASER_FONT_DIR`,
`PRASER_OUTPUT_FONT_DIR`, `PRASER_OUTPUT_DIR`). No path here points at a
JavaScript file.
"""

import os
from pathlib import Path

MODULE_DIR = Path(__file__).resolve().parent        # .../B.Parser/Python/modules
PYTHON_DIR = MODULE_DIR.parent                      # .../B.Parser/Python
PARSER_ROOT = PYTHON_DIR.parent                     # .../B.Parser
REPO_ROOT = PARSER_ROOT.parent                      # repository root


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

# Runtime directories. ``upload`` and ``.output`` are created on demand by the
# CLI/API; nothing is required to exist at import time.
UPLOAD_DIR = Path(os.environ.get("PRASER_UPLOAD_DIR") or (PARSER_ROOT / "upload"))
INPUT_DIR = UPLOAD_DIR / "input"
DEFAULT_OUTPUT_DIR = Path(os.environ.get("PRASER_OUTPUT_DIR")
                          or (PARSER_ROOT / ".output"))

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
    """Create the output/upload directories this parser writes into."""
    DEFAULT_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    return DEFAULT_OUTPUT_DIR
