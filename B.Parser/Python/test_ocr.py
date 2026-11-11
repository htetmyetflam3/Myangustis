#!/usr/bin/env python3
"""OCR lane checks — no real Tesseract needed.

The lane calls the Tesseract CLI (``PRASER_TESSERACT_BIN``). These tests put a
tiny stand-in on ``PATH`` that returns text derived from the input bytes, so
the *plumbing* is what gets tested:

* an image-only PDF page is recognised and its text replaces the empty page
* a page with real text is never OCR'd
* ``PRASER_MAX_OCR_PAGES`` refuses a document with too many image pages
* ``PRASER_OCR=off`` leaves pages as they were (and never leaks placeholders)
* a bare image file is one page of OCR text
* a DOCX picture is replaced by its recognised text, or removed when OCR is off

The parser itself never needs the stub: with no Tesseract installed the lane
reports itself unavailable and every text lane behaves as before.

    python3 B.Parser/Python/test_ocr.py
"""

from __future__ import annotations

import os
import sys
import tempfile
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "modules"))

import manager  # noqa: E402
import ocr  # noqa: E402

STUB = """#!/bin/sh
input="$1"; output="$2"
[ -f "$input" ] || { echo "stub: missing input" >&2; exit 1; }
[ -s "$input" ] || { echo "stub: empty input" >&2; exit 1; }
size=$(wc -c < "$input" | tr -d ' ')
if [ "$output" = "stdout" ]; then printf 'OCR-PAGE-%s\\n' "$size"; else printf 'OCR-PAGE-%s\\n' "$size" > "$output.txt"; fi
"""


def make_stub(directory: Path) -> Path:
    binary = directory / "tesseract"
    binary.write_text(STUB, encoding="utf-8")
    binary.chmod(0o755)
    return binary


def jpeg_bytes() -> bytes:
    """A tiny valid JPEG (2x2, grey) so no binary asset is committed."""
    # Baseline 2x2 JPEG produced once; bytes are stable and self-contained.
    return bytes.fromhex(
        "ffd8ffe000104a46494600010100000100010000ffdb0043000806060706"
        "05080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c"
        "20242e2720222c231c1c2837292c30313434341f27393d38323c2e3334"
        "32ffc0000b080002000201011100ffc4001f0000010501010101010100"
        "0000000000000102030405060708090a0bffc400b51000020103030204"
        "03050504040000017d0102030004110512213141061351610722711432"
        "8191a20823b1c109233352f0156272d10a162434e125f11718191a2627"
        "28292a35363738393a434445464748494a535455565758595a63646566"
        "6768696a737475767778797a82838485868788898a9293949596979899"
        "9aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9ca"
        "d2d3d4d5d6d7d8d9dae2e3e4e5e6e7e8e9eaf2f3f4f5f6f7f8f9faff"
        "da0008010100003f00fbf8a28a2dffd9"
    )


def _pdf(objects: list[str], path: Path) -> None:
    out = "%PDF-1.4\n"
    offsets = []
    for number, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n{body}\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n"
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n"
    out += (f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
            f"startxref\n{xref}\n%%EOF\n")
    path.write_bytes(out.encode("latin-1"))


def image_pdf(path: Path, pages: int = 1, *, with_text: bool = False) -> None:
    """A PDF whose pages carry a JPEG image and (optionally) real text."""
    jpeg = jpeg_bytes()
    width, height = ocr.image_size(jpeg)
    image_num = 3 + pages * 2
    objects = ["<< /Type /Catalog /Pages 2 0 R >>"]
    objects.append(f"<< /Type /Pages /Kids "
                   f"[{' '.join(f'{3 + i * 2} 0 R' for i in range(pages))}] "
                   f"/Count {pages} >>")
    for index in range(pages):
        content_num = 4 + index * 2
        text = " BT /F1 10 Tf 20 20 Td (real text on this page) Tj ET" if with_text else ""
        content = f"q 595 0 0 842 0 0 cm /Im0 Do Q{text}"
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
            f"/Resources << /XObject << /Im0 {image_num} 0 R >> "
            f"/Font << /F1 {3 + pages * 2 + 1} 0 R >> >> "
            f"/Contents {content_num} 0 R >>")
        objects.append(f"<< /Length {len(content)} >>\nstream\n{content}\nendstream")
    objects.append(
        f"<< /Type /XObject /Subtype /Image /Width {width} /Height {height} "
        f"/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode "
        f"/Length {len(jpeg)} >>\nstream\n" + jpeg.decode("latin-1") + "\nendstream")
    objects.append("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    _pdf(objects, path)


def image_docx(path: Path, jpeg: bytes) -> None:
    w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    a = "http://schemas.openxmlformats.org/drawingml/2006/main"
    r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("[Content_Types].xml",
                   '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/'
                   'package/2006/content-types"><Default Extension="xml" '
                   'ContentType="application/xml"/><Default Extension="jpg" '
                   'ContentType="image/jpeg"/><Override PartName="/word/document.xml" '
                   'ContentType="application/vnd.openxmlformats-officedocument.'
                   'wordprocessingml.document.main+xml"/></Types>')
        z.writestr("_rels/.rels",
                   '<?xml version="1.0"?><Relationships xmlns="http://schemas.'
                   'openxmlformats.org/package/2006/relationships"><Relationship '
                   'Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/'
                   '2006/relationships/officeDocument" Target="word/document.xml"/>'
                   '</Relationships>')
        z.writestr("word/document.xml",
                   f'<?xml version="1.0"?><w:document xmlns:w="{w}" xmlns:a="{a}" '
                   f'xmlns:r="{r}"><w:body>'
                   '<w:p><w:r><w:t>Before</w:t></w:r></w:p>'
                   '<w:p><w:r><w:drawing><a:blip r:embed="rId9"/></w:drawing></w:r></w:p>'
                   '<w:p><w:r><w:t>After</w:t></w:r></w:p>'
                   '</w:body></w:document>')
        z.writestr("word/_rels/document.xml.rels",
                   '<?xml version="1.0"?><Relationships xmlns="http://schemas.'
                   'openxmlformats.org/package/2006/relationships"><Relationship '
                   'Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/'
                   '2006/relationships/image" Target="media/pic.jpg"/>'
                   '</Relationships>')
        z.writestr("word/media/pic.jpg", jpeg)


def main() -> int:
    checks, failures = [], 0

    def check(name, ok, detail=""):
        nonlocal failures
        checks.append((name, ok, detail))
        if not ok:
            failures += 1

    with tempfile.TemporaryDirectory(prefix="python-ocr-test-") as tmp:
        work = Path(tmp)
        binary = make_stub(work)
        saved = {k: os.environ.get(k) for k in
                 ("PATH", "PRASER_TESSERACT_BIN", "PRASER_OCR",
                  "PRASER_MAX_OCR_PAGES")}
        os.environ["PATH"] = str(work) + os.pathsep + os.environ.get("PATH", "")
        os.environ["PRASER_TESSERACT_BIN"] = str(binary)
        os.environ["PRASER_OCR_LANG"] = "mya"
        try:
            check("engine detected", ocr.available(), ocr.describe())

            scan = work / "scan.pdf"
            image_pdf(scan, 1)
            result = manager.dispatch_path(scan, work / "scan.txt",
                                           include_text=True)
            check("image-only page OCR'd", result["ocrPages"] == [1],
                  str(result["ocrPages"]))
            check("OCR text replaced the empty page",
                  "OCR-PAGE-" in result["text"], repr(result["text"]))

            real = work / "text.pdf"
            image_pdf(real, 1, with_text=True)
            result = manager.dispatch_path(real, work / "text.txt",
                                           include_text=True)
            check("text page is never OCR'd", result["ocrPages"] == [],
                  str(result["ocrPages"]))
            check("text page kept its text",
                  "real text on this page" in result["text"], repr(result["text"]))

            many = work / "many.pdf"
            image_pdf(many, 2)
            os.environ["PRASER_MAX_OCR_PAGES"] = "1"
            try:
                manager.dispatch_path(many, work / "many.txt")
                check("page cap refuses too many scans", False, "no error")
            except manager.ManagerError as exc:
                check("page cap refuses too many scans",
                      "at most 1" in str(exc), str(exc))
            os.environ.pop("PRASER_MAX_OCR_PAGES", None)

            os.environ["PRASER_OCR"] = "off"
            result = manager.dispatch_path(scan, work / "off.txt",
                                           include_text=True)
            check("OCR off leaves the page alone",
                  result["ocrPages"] == [] and not result["text"].strip(),
                  repr(result["text"]))
            os.environ.pop("PRASER_OCR", None)

            image = work / "page.jpg"
            image.write_bytes(jpeg_bytes())
            result = manager.dispatch_path(image, work / "image.txt",
                                           include_text=True)
            check("bare image is one OCR page",
                  result["from"] == "ocr" and result["ocrPages"] == [1],
                  f"{result['from']} {result['ocrPages']}")
            check("bare image produced text", "OCR-PAGE-" in result["text"],
                  repr(result["text"]))

            docx = work / "with-image.docx"
            image_docx(docx, jpeg_bytes())
            result = manager.dispatch_path(docx, work / "docx.txt",
                                           include_text=True)
            check("DOCX picture OCR'd", result["ocrPages"] == ["0001"],
                  str(result["ocrPages"]))
            check("DOCX marker replaced in place",
                  "Before\nOCR-PAGE-" in result["text"] and
                  result["text"].strip().endswith("After"),
                  repr(result["text"]))

            os.environ["PRASER_OCR"] = "off"
            result = manager.dispatch_path(docx, work / "docx-off.txt",
                                           include_text=True)
            check("DOCX placeholder removed when OCR is off",
                  "\uE000" not in result["text"] and
                  "Before" in result["text"] and "After" in result["text"],
                  repr(result["text"]))
        finally:
            for key, value in saved.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

    width = max(len(name) for name, _ok, _detail in checks)
    for name, ok, detail in checks:
        print(f"{name:<{width}}  {'ok' if ok else 'FAIL'}"
              + (f"   {detail}" if detail and not ok else ""))
    print(f"\n{len(checks) - failures}/{len(checks)} checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
