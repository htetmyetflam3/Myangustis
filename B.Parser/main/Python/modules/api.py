"""Bare JSON API (Flask) — meant to be called by a Node.js backend.

    GET  /health                                            -> {"ok": true}
    GET  /health                                            -> {"ok": true}
    POST /api/preview   multipart: file=<pdf|docx>          -> JSON preview
    GET  /api/content   query: job_id=..., apply=0|1        -> one full text
    POST /api/finalize  form: job_id=..., apply=0|1, fmt=txt|docx|pdf -> download

Engine handshake (the owner's two-web design — the ENGINE initiates the
connection and the praser RESPONDS WITH THE TEXT once parsing is done;
the binary itself is only ever touched here, never in the Site server
or the engine):

    POST /api/engine/bind     JSON: job_id + metadata{submitId, filename,
                              userId, sessionId, formId}
                              the uploader side (same web, port-to-port)
                              DECLARES the identity onto its job — once.
    POST /api/engine/collect  JSON: the same metadata, presented BY THE
                              ENGINE (cross-web). Cross-checked against
                              the bound identity: aligned -> the response
                              body IS the parsed text; misaligned -> 403
                              and the binding is burned; not-yet-parsed
                              -> 404 (the engine polls while encoding
                              finishes). One binding = one collect.

The preview returns the WHOLE extracted document as a single plain-text
``content`` field (no banner, no page markers, no HTML tags), plus per-page
detection info and a list of cleanup changes as plain original/suggested
lines.  Both server-side formats run the same detect -> Rabbit (ZAWGYI) /
cleanup (UNICODE) pipeline: .pdf through the PDF extractor, .docx through the docx paragraph
reader (the browser could never do the encoding half for either).  The
user's single apply/skip choice comes back to /api/finalize as apply=1|0,
or to /api/content when only the full text (base or cleaned) is needed.
DOCX jobs finalize to txt only — no layout is kept for them.
"""

import os
import uuid
import tempfile
import threading

from pipeline import (
    load_detector,
    process_bytes,
    build_final_pages,
    build_content,
    render_texts,
)

_JOBS = {}
_JOBS_LOCK = threading.Lock()
_JOBS_MAX = 50

# submitId -> job_id: the engine-handshake index. Filled ONLY by
# /api/engine/bind (the uploader side declaring the identity), read by
# /api/engine/collect (the engine presenting it). One binding per job.
_BOUND = {}

# identity fields both handshake endpoints must carry
_META_FIELDS = ("submitId", "filename", "userId", "sessionId", "formId")


def _meta_ok(m):
    return (
        isinstance(m, dict)
        and all(isinstance(m.get(k), str) and m.get(k) for k in _META_FIELDS)
        and m["filename"].startswith(m["submitId"])
    )


def create_app():
    from flask import Flask, request, jsonify, send_file

    app = Flask(__name__)
    # door-size cap: bombs and junk die here, before any parsing
    MAX_UPLOAD_MB = int(os.environ.get("PRASER_MAX_UPLOAD_MB", "64"))
    app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024

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

    detector = load_detector()

    @app.errorhandler(413)
    def _upload_too_large(_e):
        return jsonify({"error": f"upload too large (max {MAX_UPLOAD_MB} MB)"}), 413

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
        else:
            return jsonify({"error": "only .pdf and .docx files are supported"}), 400

        try:
            job = process_bytes(f.read(), kind, detector, filename=f.filename,
                                log=lambda m: None)
        except Exception as e:  # noqa: BLE001
            return jsonify({"error": str(e)}), 400

        jid = _store_job(job)
        return jsonify({
            "job_id": jid,
            "filename": job["filename"],
            "kind": job.get("kind"),
            "content": build_content(job),   # whole body, one plain text
            "pages": len(job["reports"]),
            "counts": job["counts"],
            "metadata": job["metadata"],
            "total_changes": len(job["changes"]),
            "changes": job["changes"],
        })

    @app.route("/api/content", methods=["GET", "POST"])
    def content():
        """One full text for a stored job — no HTML, no decoration."""
        if request.method == "GET":
            jid = (request.args.get("job_id") or "").strip()
            apply_raw = (request.args.get("apply") or "0").strip().lower()
        else:
            payload = request.get_json(silent=True) or {}
            jid = (request.form.get("job_id") or payload.get("job_id") or "").strip()
            apply_raw = (request.form.get("apply") or payload.get("apply") or "0")
            apply_raw = str(apply_raw).strip().lower()
        apply_cleanup = apply_raw in ("1", "true", "yes", "y", "apply")

        with _JOBS_LOCK:
            job = _JOBS.get(jid)
        if job is None:
            return jsonify({"error": "unknown or expired job_id"}), 404

        return jsonify({
            "job_id": jid,
            "filename": job["filename"],
            "kind": job.get("kind"),
            "apply": apply_cleanup,
            "content": build_content(job, apply_cleanup),
        })

    @app.post("/api/finalize")
    def finalize():
        jid = (request.form.get("job_id") or "").strip()
        apply_raw = (request.form.get("apply") or "0").strip().lower()
        fmt = (request.form.get("fmt") or "txt").strip().lower().lstrip(".")
        apply_cleanup = apply_raw in ("1", "true", "yes", "y", "apply")

        with _JOBS_LOCK:
            job = _JOBS.get(jid)
        if job is None:
            return jsonify({"error": "unknown or expired job_id"}), 404
        if fmt not in ("txt", "docx", "pdf"):
            return jsonify({"error": "fmt must be one of txt|docx|pdf"}), 400
        if job.get("kind") == "docx" and fmt != "txt":
            return jsonify({"error": "docx jobs carry no layout - use fmt=txt"}), 400

        base = os.path.splitext(job["filename"])[0] or "output"
        tmp = tempfile.NamedTemporaryFile(suffix=f".{fmt}", delete=False)
        tmp.close()
        try:
            pages = build_final_pages(job, apply_cleanup)
            render_texts(tmp.name, pages, job["counts"], job["filename"])
        except Exception as e:  # noqa: BLE001
            try:
                os.unlink(tmp.name)
            except OSError:
                pass
            return jsonify({"error": str(e)}), 400

        download_name = f"{base}_cleaned.{'docx' if fmt == 'docx' else fmt}"
        return send_file(tmp.name, as_attachment=True, download_name=download_name)

    # ── engine handshake: uploader side declares ─────────────────
    @app.post("/api/engine/bind")
    def engine_bind():
        payload = request.get_json(silent=True) or {}
        jid = (payload.get("job_id") or "").strip()
        meta = payload.get("metadata")
        if not jid or not _meta_ok(meta):
            return jsonify({"error": "job_id and full metadata "
                                     "(submitId, filename, userId, "
                                     "sessionId, formId) are required; "
                                     "filename must be the frontend-"
                                     "created {submitId}{ext}"}), 400
        with _JOBS_LOCK:
            job = _JOBS.get(jid)
            if job is None:
                return jsonify({"error": "unknown or expired job_id"}), 404
            if jid in _BOUND or any(
                v == jid for v in _BOUND.values()
            ):
                return jsonify({"error": "job already bound"}), 403
            _BOUND[meta["submitId"]] = jid
            job["engine_meta"] = dict(meta)
        return jsonify({"bound": True, "submitId": meta["submitId"]})

    # ── engine handshake: the ENGINE presents, praser responds with text ──
    @app.post("/api/engine/collect")
    def engine_collect():
        meta = request.get_json(silent=True) or {}
        if not _meta_ok(meta):
            return jsonify({"error": "metadata (submitId, filename, "
                                     "userId, sessionId, formId) "
                                     "required"}), 400
        with _JOBS_LOCK:
            jid = _BOUND.get(meta["submitId"])
            job = _JOBS.get(jid) if jid else None
            if job is None:
                # the engine polls while parsing/forwarding is still
                # running — 404 means "not ready yet", nothing echoed
                return jsonify({"error": "not ready"}), 404
            stored = job.get("engine_meta")
            if stored != dict(meta):
                # burned: a misaligned presentation kills the binding —
                # nothing honest can collect under it afterwards
                _BOUND.pop(meta["submitId"], None)
                job.pop("engine_meta", None)
                return jsonify({"error": "rejected: presented metadata "
                                         "does not align with the bound "
                                         "identity"}), 403
            # one binding = one collect: drop the binding, keep the job
            # for the site's own job_id flows until its TTL
            _BOUND.pop(meta["submitId"], None)
            job.pop("engine_meta", None)
        return jsonify({
            "job_id": jid,
            "filename": job["filename"],
            "kind": job.get("kind"),
            "pages": len(job["reports"]),
            "content": build_content(job),
        })

    return app
