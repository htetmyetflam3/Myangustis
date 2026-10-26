"""Path resolution for models, fonts, input, and output.

All paths are resolved relative to this file (``module/paths.py``) so the
package works from any current working directory.

Layout — Praser is the SHARED root for both ports (Python and js), so the
centralized dirs live directly under it, NOT under a port dir:

    Praser/
      fonts/                 <- CENTRALIZED fonts (one dir, both ports)
        Unicode/             <- Myanmar faces, input side (YoeYar-One, Padauk, ...)
        output/              <- fonts used to WRITE output (Anonymous Pro + MyanmarSagar)
      upload/input/          <- CENTRALIZED input (docx/ pdf/ txt/)
      .output/               <- CENTRALIZED default output
      Python/module/         <- this package (model/ kept beside the code)
      js/module/             <- the Node port (model/ kept beside the code)

  - Zawgyi model : module/model/zawgyiUnicodeModel.dat  (or $ZAWGYI_MODEL)
  - Myanmar fonts: Praser/fonts/Unicode/
  - Output fonts : Praser/fonts/output/ (Anonymous Pro + MyanmarSagar)
  - Default output dir: Praser/.output/  (or pass an explicit output path)
"""

import os
from pathlib import Path

MODULE_DIR = Path(__file__).resolve().parent       # .../Praser/Python/module
PORT_DIR = MODULE_DIR.parent                       # .../Praser/Python
PRASER_ROOT = PORT_DIR.parent                      # .../Praser (shared root)

# Centralized input — samples and runtime uploads land here (docx/ pdf/ txt/).
UPLOAD_DIR = PRASER_ROOT / "upload"
INPUT_DIR = UPLOAD_DIR / "input"

# Zawgyi detection Markov model (zawgyiUnicodeModel.dat) — kept per port,
# beside the module code that loads it.
MODEL_DIR = MODULE_DIR / "model"
DEFAULT_MODEL_PATH = MODEL_DIR / "zawgyiUnicodeModel.dat"

# Myanmar Unicode fonts are centralized under Praser/fonts/Unicode/
FONT_DIR = PRASER_ROOT / "fonts" / "Unicode"

# Fonts used to WRITE output files (PDF & DOCX): Latin = Anonymous Pro,
# Burmese = MyanmarSagar. Both live in Praser/fonts/output/.
OUTPUT_FONT_DIR = PRASER_ROOT / "fonts" / "output"
DEFAULT_MYANMAR_FONT = OUTPUT_FONT_DIR / "MyanmarSagar.ttf"

# Default output directory when no output path is given on the CLI.
DEFAULT_OUTPUT_DIR = PRASER_ROOT / ".output"

# Latin fallback candidates (for PDF output of non-Myanmar glyphs).
_LATIN_FONT_CANDIDATES = [
    FONT_DIR / "DejaVuSans.ttf",
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    Path("/usr/share/fonts/dejavu/DejaVuSans.ttf"),
    Path("C:/Windows/Fonts/arial.ttf"),
    Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
]


def find_model_path():
    """Return the path to zawgyiUnicodeModel.dat (first existing candidate)."""
    candidates = [
        os.environ.get("ZAWGYI_MODEL"),
        MODULE_DIR / "model" / "zawgyiUnicodeModel.dat",  # module/model/ (actual location)
        MODULE_DIR / "zawgyiUnicodeModel.dat",            # beside detector.py
        PRASER_ROOT / "zawgyiUnicodeModel.dat",
    ]
    for cand in candidates:
        if cand and Path(cand).is_file():
            return str(Path(cand))
    return str(DEFAULT_MODEL_PATH)


def find_myanmar_font():
    """Return an available Myanmar-capable TTF from the shipped font dir."""
    candidates = [
        DEFAULT_MYANMAR_FONT,                      # output/MyanmarSagar.ttf
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
    # Fall back to the first .ttf found in the font dir.
    if FONT_DIR.is_dir():
        for f in sorted(FONT_DIR.glob("*.ttf")):
            return f
    return DEFAULT_MYANMAR_FONT


def find_latin_font():
    """Return an available Latin fallback font, or None if none exist."""
    for cand in _LATIN_FONT_CANDIDATES:
        if Path(cand).is_file():
            return Path(cand)
    return None
