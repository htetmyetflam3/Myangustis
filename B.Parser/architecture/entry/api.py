"""Flask API for the standalone Python parser.

Conversion runs in this process through :mod:`manager` (pipeline + render +
OCR). No JavaScript parser or Engine child process is used.
Cross-parser callers use the JSON job contract instead (:mod:`interop`).
"""

import io
import os
import uuid
import tempfile
import threading
from pathlib import Path

from myangustis_parser.entry.manager import dispatch_bytes

_JOBS = {}
_JOBS_LOCK = threading.Lock()
_JOBS_MAX = 50

def create_app():
    from flask import Flask, request, jsonify, send_file

    app = Flask(__name__)
    # ── machine-boundary lock ────────────────────────────────────
    # This service is UNAUTHENTICATED by design: it trusts its own web.
    # "Its own web" means its own MACHINE — a caller whose source address
    # is not loopback (a port-forward, a proxy, a stray container) must
    # carry X-Praser-Key matching PRASER_KEY. With no key configured,
    # non-loopback callers are refused entirely (fail closed). The site
    # and the engine both dial 127.0.0.1, so the normal flow never sees
    # this — it exists so an exposed port forward serves nothing.
    PRASER_KEY = os.environ.get("PRASER_KEY", "")
    LOOPBACK = {"127.0.0.1", "::1"}

    @app.before_request
    def _machine_boundary():
        if request.remote_addr in LOOPBACK:
            return None
        if not PRASER_KEY:
            app.logger.warning("refused non-loopback call with no PRASER_KEY set")
            return jsonify({"error": "refused: this service only serves "
                                     "its own machine"}), 403
        if request.headers.get("X-Praser-Key") != PRASER_KEY:
            return jsonify({"error": "refused: bad X-Praser-Key"}), 403
        return None

    def _store_job(job):
        jid = uuid.uuid4().hex
        with _JOBS_LOCK:
            _JOBS[jid] = job
            # keep only the newest _JOBS_MAX jobs
            if len(_JOBS) > _JOBS_MAX:
                for old in list(_JOBS.keys())[:- _JOBS_MAX]:
                    _JOBS.pop(old, None)
        return jid

    @app.get("/health")
    def health():
        return jsonify({"ok": True})

    @app.post("/api/preview")
    def preview():
        f = request.files.get("file")
        if f is None or not f.filename:
            return jsonify({"error": "multipart field 'file' is required"}), 400
        name = f.filename.lower()
        if name.endswith(".pdf"):
            kind = "pdf"
        elif name.endswith((".docx", ".doc")):
            kind = "docx"
        elif name.endswith((".png", ".jpg", ".jpeg", ".tif", ".tiff",
                            ".webp", ".gif", ".bmp")):
            kind = "ocr"          # a bare image: one page of OCR text
        else:
            return jsonify({"error": "only .pdf, .docx and image files are supported"}), 400

        data = f.read()
        method = (request.form.get("method") or ("manual" if kind == "pdf" else "default")).lower()
        if method not in ("manual", "default"):
            return jsonify({"error": "method must be manual or default"}), 400
        source_encoding = (request.form.get("source_encoding") or "auto").lower()
        if source_encoding not in ("auto", "unicode", "zawgyi-one"):
            return jsonify({"error": "source_encoding must be auto, unicode, or zawgyi-one"}), 400
        try:
            with tempfile.TemporaryDirectory(prefix="myangustis-preview-") as directory:
                result = dispatch_bytes(data, f.filename, Path(directory) / "preview.txt",
                                        kind=kind, method=method,
                                        include_preview=True, source_encoding=source_encoding)
        except Exception as e:  # noqa: BLE001
            return jsonify({"error": str(e)}), 400

        job = {
            "filename": os.path.basename(f.filename), "kind": kind, "data": data,
            "method": method, "source_encoding": source_encoding,
            "content": result.get("text", ""),
            "pages": result.get("pages", 0), "counts": result.get("counts") or {},
            "metadata": result.get("metadata") or {}, "changes": result.get("changes") or [],
            "ocr_pages": result.get("ocrPages", []), "encoding_path": result.get("encodingPath"),
        }
        jid = _store_job(job)
        return jsonify({
            "job_id": jid,
            "filename": job["filename"],
            "kind": job["kind"],
            "content": job["content"],
            "pages": job["pages"],
            "counts": job["counts"],
            "metadata": job["metadata"],
            "total_changes": len(job["changes"]),
            "changes": job["changes"],
            "ocr_pages": job["ocr_pages"],
            "encoding_path": job["encoding_path"],
        })

    @app.route("/api/content", methods=["GET", "POST"])
    def content():
        """One full text for a stored job — no HTML, no decoration."""
        if request.method == "GET":
            jid = (request.args.get("job_id") or "").strip()
        else:
            payload = request.get_json(silent=True) or {}
            jid = (request.form.get("job_id") or payload.get("job_id") or "").strip()

        with _JOBS_LOCK:
            job = _JOBS.get(jid)
        if job is None:
            return jsonify({"error": "unknown or expired job_id"}), 404

        return jsonify({
            "job_id": jid,
            "filename": job["filename"],
            "kind": job.get("kind"),
            "content": job["content"],
        })

    @app.post("/api/finalize")
    def finalize():
        jid = (request.form.get("job_id") or "").strip()
        fmt = (request.form.get("fmt") or "txt").strip().lower().lstrip(".")

        with _JOBS_LOCK:
            job = _JOBS.get(jid)
        if job is None:
            return jsonify({"error": "unknown or expired job_id"}), 404
        if fmt not in ("txt", "docx", "pdf"):
            return jsonify({"error": "fmt must be one of txt|docx|pdf"}), 400

        base = os.path.splitext(job["filename"])[0] or "output"
        try:
            with tempfile.TemporaryDirectory(prefix="myangustis-finalize-") as directory:
                target = Path(directory) / f"output.{fmt}"
                dispatch_bytes(job["data"], job["filename"], target, kind=job["kind"],
                               method=job["method"], include_text=False,
                               source_encoding=job["source_encoding"])
                payload = target.read_bytes()
        except Exception as e:  # noqa: BLE001
            return jsonify({"error": str(e)}), 400

        return send_file(io.BytesIO(payload), as_attachment=True,
                         download_name=f"{base}_cleaned.{fmt}")

    return app
