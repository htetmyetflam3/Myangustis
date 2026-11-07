"""Current proofreading source locations for the historical MT tests."""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3] / "C.Proofreading" / "main"
TOOLS = ROOT / "tools"

# The former flat mt/ directory is now split by responsibility.  Add only
# real module directories; missing modules should still fail normally.
MODULE_DIRS = (
    ROOT,
    ROOT / "translate",
    TOOLS,
    TOOLS / "api",
    TOOLS / "quickread",
    TOOLS / "installer",
    TOOLS / "dictionary" / "Burmese",
    TOOLS / "formatting",
    TOOLS / "utility",
)
for directory in MODULE_DIRS:
    if str(directory) not in sys.path:
        sys.path.insert(0, str(directory))


def subprocess_env(env=None):
    """Give child test processes the same module paths without changing os.environ."""
    result = dict(os.environ if env is None else env)
    existing = result.get("PYTHONPATH", "")
    result["PYTHONPATH"] = os.pathsep.join(
        [*(str(path) for path in MODULE_DIRS), *([existing] if existing else [])]
    )
    return result
