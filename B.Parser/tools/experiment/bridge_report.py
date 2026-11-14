"""Experiment only - no decode path is touched.

Reports, per embedded font of a PDF, the code->key bridge the file carries
(``/ToUnicode``), how many of those keys each legacy code page defines, and how
many bytes of the page streams each code accounts for.  Run it to get numbers;
nothing here is wired into the parser.
"""
from __future__ import annotations

import collections
import hashlib
import re
import sys

from pypdf import PdfReader

sys.path.insert(0, 'B.Parser/architecture')
from myangustis_parser.extract.pdf_fonts import LEGACY_CODE_PAGES  # noqa: E402

PAIR = re.compile(r'<([0-9A-Fa-f]{2,4})>\s*<([0-9A-Fa-f]{4,})>')
RANGE = re.compile(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>')


def tounicode(font):
    """code -> value, from the font's own /ToUnicode (bfchar + bfrange)."""
    stream = font.get('/ToUnicode')
    if stream is None:
        return {}
    text = stream.get_object().get_data().decode('latin-1')
    out = {int(a, 16): b for a, b in PAIR.findall(text)}
    for block in re.findall(r'beginbfrange(.*?)endbfrange', text, re.S):
        for lo, hi, dst in RANGE.findall(block):
            base = int(dst, 16)
            for i, code in enumerate(range(int(lo, 16), int(hi, 16) + 1)):
                out.setdefault(code, f'{base + i:04X}')
    return out


def page_bytes(reader, limit=40):
    """Byte histogram over the shown strings of the first pages."""
    hist = collections.Counter()

    def unescape(raw):
        out, i = bytearray(), 0
        while i < len(raw):
            if raw[i] == 0x5C and i + 1 < len(raw):
                nxt = raw[i + 1]
                simple = {0x6E: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12}
                if nxt in simple:
                    out.append(simple[nxt]); i += 2; continue
                if 0x30 <= nxt <= 0x37:
                    j, oct_ = i + 1, ''
                    while j < len(raw) and 0x30 <= raw[j] <= 0x37 and len(oct_) < 3:
                        oct_ += chr(raw[j]); j += 1
                    out.append(int(oct_, 8) & 0xFF); i = j; continue
                out.append(nxt); i += 2; continue
            out.append(raw[i]); i += 1
        return bytes(out)

    for page in reader.pages[:limit]:
        contents = page.get_contents()
        if contents is None:
            continue
        data = contents.get_data()
        for match in re.finditer(rb'\((?:\\.|[^\\()])*\)', data):
            hist.update(unescape(match.group()[1:-1]))
        for match in re.finditer(rb'<([0-9A-Fa-f\s]+)>', data):
            digits = re.sub(rb'\s', b'', match.group()[1:-1])
            if len(digits) % 2:
                digits += b'0'
            try:
                hist.update(bytes.fromhex(digits.decode()))
            except ValueError:
                continue
    return hist


def report(path):
    reader = PdfReader(path)
    hist = page_bytes(reader)
    print(f'=== {path}  pages {len(reader.pages)}  distinct bytes shown {len(hist)}')
    seen = set()
    for page in reader.pages:
        try:
            fonts = page['/Resources']['/Font'].get_object()
        except Exception:
            continue
        for _, ref in fonts.items():
            font = ref.get_object()
            base = str(font.get('/BaseFont'))
            desc = font.get('/FontDescriptor')
            if desc is None or base in seen:
                continue
            seen.add(base)
            files = [k for k in ('/FontFile', '/FontFile2', '/FontFile3') if k in desc.get_object()]
            sha = ''
            if files:
                sha = hashlib.sha256(desc.get_object()[files[0]].get_object().get_data()).hexdigest()[:12]
            bridge = tounicode(font)
            keys = {chr(int(v, 16)) for v in bridge.values() if v.startswith('00')}
            print(f'  {base}  program {sha or "-"}  ToUnicode {len(bridge)} entries')
            if not keys:
                continue
            print(f'    bridge keys {len(keys)}, of which non-printable codes: '
                  f'{sum(1 for c in bridge if c < 0x20)}')
            for name, table in LEGACY_CODE_PAGES.items():
                have = sum(1 for key in keys if ord(key) in table)
                print(f'    {name:>9}: {have}/{len(keys)} keys defined'
                      f'{"  <-- full" if have == len(keys) else ""}')
            with_bytes = sum(hist.get(code, 0) for code in bridge)
            print(f'    bytes behind this bridge in the sampled streams: {with_bytes}'
                  f' of {sum(hist.values())}')


if __name__ == '__main__':
    for arg in sys.argv[1:]:
        report(arg)
