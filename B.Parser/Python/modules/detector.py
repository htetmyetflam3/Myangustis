"""Encoding evidence without a statistical model.

Myanmar-script code points overlap, so unlabelled text stays UNKNOWN.
Only an explicit source encoding or the faces actually used by the text can
establish a Zawgyi-One source.
"""

import re

_MYANMAR = re.compile(r"[\u1000-\u109f\ua9e0-\ua9ff\uaa60-\uaa7f]")


def contains_myanmar(text):
    return bool(_MYANMAR.search(text or ""))


def is_zawgyi_one_font(name):
    value = re.sub(r"#([0-9A-Fa-f]{2})", lambda m: chr(int(m.group(1), 16)), str(name or ""))
    value = re.sub(r"^[A-Z]{6}\+", "", value)
    value = re.sub(r"[^a-z0-9]", "", value.lower())
    return value in {"zawgyione", "zawgyi"}


def has_only_zawgyi_fonts(font_names):
    names = list(font_names or ())
    return bool(names) and all(is_zawgyi_one_font(name) for name in names)


class ZawgyiDetector:
    # The numeric field is an evidence flag, not a statistical probability.
    def detect(self, text, *, source_encoding="auto", font_names=None):
        if not contains_myanmar(text):
            return "UNKNOWN", 0.0
        if source_encoding == "zawgyi-one":
            return "ZAWGYI", 1.0
        if source_encoding == "unicode":
            return "UNICODE", 0.0
        if has_only_zawgyi_fonts(font_names):
            return "ZAWGYI", 1.0
        return "UNKNOWN", 0.0
