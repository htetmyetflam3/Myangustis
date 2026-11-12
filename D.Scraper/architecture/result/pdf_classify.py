"""Route PDFs by their content, not by font, spelling or text quality.

Only an image-only PDF is sent to ``scanned/``. If there is a text-showing
operation (including in a Form XObject), or inspection is inconclusive, the
PDF goes to the text Parser. This deliberately does not decode or score words,
fonts, encodings, or old-era PDFs.
"""
from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
import sys
from pathlib import Path

from pypdf import PdfReader
from pypdf.generic import ContentStream


@dataclass
class ClassifyResult:
    category: str
    pages: int = 0
    detail: str = ''
    encoding: str | None = None
    decode: str = 'none'
    text: str | None = None

    @property
    def folder(self):
        return self.category


def _nonempty(value):
    if isinstance(value, (str, bytes)):
        return bool(value.strip())
    if isinstance(value, (list, tuple)):
        return any(_nonempty(part) for part in value)
    return False


def _content_flags(stream, resources, reader, active):
    """Return (image, text); follow drawn Form XObjects, without decoding fonts."""
    if stream is None:
        return False, False
    image = text = False
    resources = resources.get_object() if resources else {}
    xobjects = resources.get('/XObject', {})
    xobjects = xobjects.get_object() if xobjects else {}
    for operands, op in ContentStream(stream, reader).operations:
        if op in (b'Tj', b'TJ', b"'", b'"') and _nonempty(operands):
            text = True
        elif op == b'INLINE IMAGE':
            image = True
        elif op == b'Do' and operands:
            ref = xobjects.get(operands[0])
            if ref is None:
                # An unresolved XObject is not evidence of an image-only page.
                text = True
                continue
            obj = ref.get_object()
            subtype = obj.get('/Subtype')
            if subtype == '/Image':
                image = True
            elif subtype == '/Form':
                key = getattr(ref, 'idnum', id(obj))
                if key in active:
                    text = True  # ambiguous/cyclic: send to Parser
                    continue
                nested = obj.get('/Resources') or resources
                sub_image, sub_text = _content_flags(obj, nested, reader, active | {key})
                image |= sub_image
                text |= sub_text
            else:
                text = True
    return image, text


def classify_pdf(data: bytes) -> ClassifyResult:
    """Detect an image-only PDF; defer every other PDF to the Parser."""
    try:
        reader = PdfReader(BytesIO(data), strict=False)
        if reader.is_encrypted and not reader.decrypt(''):
            return ClassifyResult('convertable', detail='password required; defer to Parser')
        pages = len(reader.pages)
        has_image = False
        for page in reader.pages:
            image, text = _content_flags(page.get_contents(), page.get('/Resources'), reader, set())
            has_image |= image
            if text:
                return ClassifyResult('convertable', pages=pages, detail='text layer present')
        if has_image:
            return ClassifyResult('scanned', pages=pages, detail='image-only PDF')
        return ClassifyResult('convertable', pages=pages, detail='no image-only evidence; defer to Parser')
    except Exception as exc:  # an uncertain probe must not discard a text PDF
        return ClassifyResult('convertable', detail=f'inspection inconclusive; defer to Parser: {exc}')


def main(argv):
    if not argv:
        print('usage: pdf_classify.py FILE.pdf [FILE.pdf ...]')
        return 2
    for name in argv:
        result = classify_pdf(Path(name).read_bytes())
        print(f'{name}: {result.category} pages={result.pages} {result.detail}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
