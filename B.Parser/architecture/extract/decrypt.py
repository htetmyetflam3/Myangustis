"""Prepare encrypted and object-stream PDFs with the Python pypdf library.

No qpdf executable (or qpdf library) is needed. Empty-password/restrictions
only encryption is removed; PDFs requiring a user password fail explicitly.
Rewriting also expands compressed object streams for the parser's object scan.
"""
from io import BytesIO

from pypdf import PdfReader, PdfWriter
from pypdf.errors import PdfReadError, WrongPasswordError

_ENCRYPT_MARK = b"/Encrypt"
_OBJSTM_MARK = b"/ObjStm"


def is_encrypted_pdf(data):
    return _ENCRYPT_MARK in bytes(data)


def has_object_streams(data):
    return _OBJSTM_MARK in bytes(data)


def _rewrite(data):
    try:
        reader = PdfReader(BytesIO(bytes(data)), strict=False)
        if reader.is_encrypted and not reader.decrypt(""):
            raise RuntimeError("This PDF needs a password to open; supply an unprotected copy.")
        writer = PdfWriter()
        writer.clone_document_from_reader(reader)
        out = BytesIO()
        writer.write(out)
        return out.getvalue()
    except WrongPasswordError as exc:
        raise RuntimeError("This PDF needs a password to open; supply an unprotected copy.") from exc
    except (PdfReadError, ValueError) as exc:
        raise RuntimeError(f"Could not prepare PDF: {exc}") from exc


def decrypt_pdf(data, log=lambda m: None):
    if not is_encrypted_pdf(data):
        return data
    out = _rewrite(data)
    log(f"[+] PDF was encrypted; decrypted with pypdf ({len(data):,} -> {len(out):,} bytes)")
    return out


def expand_object_streams(data, log=lambda m: None):
    if not has_object_streams(data):
        return data
    out = _rewrite(data)
    log(f"[+] PDF uses object streams; expanded with pypdf ({len(data):,} -> {len(out):,} bytes)")
    return out
