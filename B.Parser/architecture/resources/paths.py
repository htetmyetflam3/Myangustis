"""Path resolution for fonts, maps and input/output — the Python mirror of
``B.Parser/_path.js``.

Every default path is resolved from this file's location, so the parser works
from any current working directory. The layout is the repository's, not a
private copy of it:

    <repo>/Junk/fonts/Unicode/         input-side Myanmar faces
    <repo>/Junk/fonts/used/            faces used to WRITE output
                                       (AnonymousPro-* + MyanmarSagar)
    <repo>/Junk/Parser/upload/pdf/     default input directory for PDFs
    <repo>/Junk/Parser/upload/docx/    default input directory for DOCX
    <repo>/Junk/Parser/output/txt/     default output directory for TXT
    <repo>/Junk/Parser/output/docx/    default output directory for DOCX
    <repo>/Junk/Parser/output/pdf/     default output directory for PDF
    <repo>/B.Parser/architecture/resources/maps_data/   bundled JSON maps

Environment overrides exist for deployment (``PARSER_INPUT_DIR``,
``PARSER_OCR_INPUT_DIR``, ``PRASER_FONT_DIR``, ``PRASER_OUTPUT_FONT_DIR``,
``PRASER_UPLOAD_DIR``, ``PRASER_OUTPUT_DIR``, ``PARSER_LOG_FILE``,
``PRASER_MAP_DIR``). Each one is *anchored to the project root*, never to the
filesystem root: a value such as ``/Junk/Parser/upload/`` or ``./output/``
lands inside the checkout, so ``/output/`` is ``<repo>/Junk/output`` and
``/Junk/Parser/upload`` is ``<repo>/Junk/Parser/upload``.

Anchoring rules (shared with ``index-path.py``, which also loads the root
``.env`` for library callers):

    ""             -> not set, the built-in default is used
    "~/dir"        -> the user's home directory (explicit escape)
    "abs:/dir"     -> a real host path (also file:/dir and path:/dir)
    "C:\\dir"       -> a Windows drive path, taken as written
    "/dir"         -> <project>/dir, or the real host location when /dir (or
                      its nearest existing ancestor) is not the filesystem root
    "dir", "./dir" -> <project>/dir

No path here points at a JavaScript file.
"""

import importlib.util
import os
from pathlib import Path
import re
import sys

PACKAGE_DIR = Path(__file__).resolve().parents[1]
# In the checkout the package source is the architecture directory itself.
# Installed wheels use the normal myangustis_parser package directory instead.
PARSER_ROOT = (PACKAGE_DIR.parent if PACKAGE_DIR.name == "architecture"
               and PACKAGE_DIR.parent.name == "B.Parser" else PACKAGE_DIR.parents[1])
REPO_ROOT = PARSER_ROOT.parent
JUNK_ROOT = REPO_ROOT / "Junk"
RUNTIME_ROOT = JUNK_ROOT / "Parser"
DEFAULT_LOG_FILE = PARSER_ROOT / "logs" / "lane-decisions.log"

_ABSOLUTE_PREFIXES = ("abs:", "file:", "path:")
_PATH_ROOT_ENV = ("PRASER_PATH_ROOT", "MYANGUSTIS_PATH_ROOT")
_WINDOWS_DRIVE = re.compile(r"^[A-Za-z]:[\\/]")


# ── shared workspace environment ─────────────────────────────────────────
def env_module():
    """The workspace ``index-path`` module, so `.env` is read once per process.

    The parser shares the repository root `.env` with every other tool here;
    it is not an isolated copy. When the parser is installed without the
    checkout the module is absent and anchoring still works from this file.
    """
    module = sys.modules.get("index-path")
    if module is not None:
        return module
    path = REPO_ROOT / "index-path.py"
    if not path.is_file():
        return None
    spec = importlib.util.spec_from_file_location("index-path", path)
    if spec is None or spec.loader is None:
        return None
    module = importlib.util.module_from_spec(spec)
    sys.modules["index-path"] = module
    try:
        spec.loader.exec_module(module)  # loads the root .env, environment first
    except (OSError, ValueError, ImportError):
        sys.modules.pop("index-path", None)
        return None
    return module


def load_workspace_env():
    """Load the repository root `.env` (process environment keeps precedence)."""
    module = env_module()
    loader = getattr(module, "load_root_env", None)
    return loader() if callable(loader) else {"sources": [], "applied": []}


WORKSPACE_ENV = load_workspace_env()


# ── anchoring ────────────────────────────────────────────────────────────
def anchor_base():
    """The directory .env paths are anchored to (default: project root)."""
    for name in _PATH_ROOT_ENV:
        raw = (os.environ.get(name) or "").strip()
        if raw:
            return _anchor(raw, REPO_ROOT)
    return REPO_ROOT


def host_location(path) -> bool:
    """True when an absolute value names a real place on this host.

    A value whose nearest existing ancestor is the filesystem root is a project
    path written with a leading slash (``/Junk/...``, ``/log/``), not a host
    location — that is the whole point of anchoring: nothing may silently
    resolve against ``/``.
    """
    current = Path(path)
    while True:
        if current.exists():
            return current != Path(current.anchor)
        if current == Path(current.anchor):
            return False
        current = current.parent


def _anchor(value, base):
    text = str(value).strip()
    lowered = text.lower()
    for prefix in _ABSOLUTE_PREFIXES:
        if lowered.startswith(prefix):
            return Path(text[len(prefix):].strip()).expanduser()
    if text.startswith("~"):
        return Path(text).expanduser()
    if _WINDOWS_DRIVE.match(text):
        return Path(text)
    candidate = Path(text)
    if candidate.is_absolute():
        # A real host path that exists is a deployment location; anything
        # already inside the project stays exactly where it points; everything
        # else is a project path written with a leading slash.
        if host_location(candidate) or candidate.is_relative_to(base):
            return candidate
        return base / str(candidate).lstrip("/\\")
    return base / candidate


def project_path(value, *, default=None):
    """An .env path anchored to the project root (logs, maps, fonts, keys).

    ``/log/`` becomes ``<repo>/log``; ``./output/`` becomes ``<repo>/output``.
    Returns ``default`` for an empty value.
    """
    if value is None or not str(value).strip():
        return default
    return _anchor(value, anchor_base())


def working_path(value, *, base=None, default=None):
    """A parser input/output path anchored under ``<repo>/Junk``.

    Relative and slash-leading values live inside the working tree, which is
    what the parser writes to and reads from:

        output/             -> <repo>/Junk/output
        /output/            -> <repo>/Junk/output
        Junk/Parser/upload  -> <repo>/Junk/Parser/upload
        /Junk/Parser/upload -> <repo>/Junk/Parser/upload
        abs:/srv/parser     -> /srv/parser
        ~/parser            -> ~/parser

    A genuinely existing host directory is honoured as a deployment location.
    """
    if value is None or not str(value).strip():
        return default
    project = Path(base) if base is not None else anchor_base()
    text = str(value).strip()
    lowered = text.lower()
    for prefix in _ABSOLUTE_PREFIXES:
        if lowered.startswith(prefix):
            return Path(text[len(prefix):].strip()).expanduser()
    if text.startswith("~"):
        return Path(text).expanduser()
    if _WINDOWS_DRIVE.match(text):
        return Path(text)
    candidate = Path(text)
    if candidate.is_absolute():
        first = candidate.parts[1].lower() if len(candidate.parts) > 1 else ""
        inside_project = candidate.is_relative_to(project)
        if first != "junk" and (host_location(candidate) or inside_project):
            return candidate
        relative = str(candidate).lstrip("/\\")
    else:
        relative = text
    parts = [part for part in Path(relative).parts if part not in ("", ".")]
    if parts and parts[0].lower() == "junk":
        return project.joinpath(*parts)
    return project.joinpath("Junk", *parts)


def _runtime_dir(value, default):
    """A parser runtime directory: env override, else the built-in default."""
    return working_path(value, default=default)


def input_dir_from_env(mode="parse"):
    """``PARSER_INPUT_DIR`` / ``PARSER_OCR_INPUT_DIR``, project-anchored."""
    name = "PARSER_OCR_INPUT_DIR" if str(mode).lower() == "ocr" else "PARSER_INPUT_DIR"
    return working_path(os.environ.get(name))


def log_file_path():
    """``PARSER_LOG_FILE``, anchored to the project root.

    A value that ends with a separator, or that names an existing directory,
    is a directory: the default decision-log filename is used inside it.
    """
    raw = os.environ.get("PARSER_LOG_FILE")
    path = project_path(raw, default=DEFAULT_LOG_FILE)
    if raw is not None and str(raw).strip() and (
            str(raw).strip().endswith(("/", "\\")) or path.is_dir()):
        path = path / DEFAULT_LOG_FILE.name
    return path


def resolve_input(value):
    """Resolve a caller-supplied input file or directory.

    Order: the value as a project/working path, then a bare filename in the
    default upload directory for its suffix. The returned path may not exist;
    callers report the miss with this resolved path in the message.
    """
    text = str(value or "").strip()
    if not text:
        raise ValueError("an input file is required")
    bare = Path(text)
    has_dir = ("/" in text) or ("\\" in text) or bare.is_absolute() or text.startswith("~")
    candidate = working_path(text)
    project = project_path(text)
    if not has_dir:
        # A bare filename means "the default upload folder for this type".
        upload = input_dir_for(bare.suffix.lower()) / bare.name
        if upload.exists():
            return upload
    for option in (candidate, project):
        if option is not None and option.exists():
            return option
    if not has_dir:
        return upload  # report the miss against the default upload folder
    return candidate if candidate is not None else project


def _first_dir(env_name, *candidates):
    """Environment override, else the first candidate that exists."""
    override = project_path(os.environ.get(env_name))
    if override is not None:
        return override
    for candidate in candidates:
        if Path(candidate).is_dir():
            return Path(candidate)
    return Path(candidates[0])


# Input-side faces: the JS parser resolves the same directory (Junk/fonts).
FONT_DIR = _first_dir(
    "PRASER_FONT_DIR",
    JUNK_ROOT / "fonts" / "Unicode",
    PARSER_ROOT / "fonts" / "Unicode",
)

# Faces used to WRITE output: Anonymous Pro (Latin) + MyanmarSagar (Burmese).
OUTPUT_FONT_DIR = _first_dir(
    "PRASER_OUTPUT_FONT_DIR",
    JUNK_ROOT / "fonts" / "used",
    PARSER_ROOT / "fonts" / "output",
)
DEFAULT_MYANMAR_FONT = OUTPUT_FONT_DIR / "MyanmarSagar.ttf"

# Runtime directories under <repo>/Junk/Parser (matching B.Parser/_path.js).
# Created on demand; nothing is required to exist at import time.
UPLOAD_DIR = _runtime_dir(os.environ.get("PRASER_UPLOAD_DIR"), RUNTIME_ROOT / "upload")
PDF_INPUT_DIR = UPLOAD_DIR / "pdf"
DOCX_INPUT_DIR = UPLOAD_DIR / "docx"
INPUT_DIR = UPLOAD_DIR / "input"

OUTPUT_DIR = _runtime_dir(os.environ.get("PRASER_OUTPUT_DIR"), RUNTIME_ROOT / "output")
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
