#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   api-server.js — express wrapper around the engine (production stage)

   The public API does NOT hand back ready-made segmented text. It hands
   back POSITIONS and the caller writes the segmentation into its OWN
   original string. See init/initS.js → invokeSyllableWithHash().

   express only — the engine itself stays importable; the server boots on
   `node Bridge/api-server.js` (or `npm run api`).

   Endpoints (the owner's two-web design — the ENGINE initiates):
     GET  /health   → { ok: true } — liveness, open
     POST /fsm      → hidden.js delivers the submission metadata into the
                      pre-receive cache (holds ≥20 records, TTL). THE KEYED
                      ENDPOINT: X-API-Key + IP + origin gate. Delivery
                      TRIGGERS the engine-initiated handshake below.
     GET  /result/:hash → keyed poll target for the Site server:
                      { done, engineHash, syllableCount }.
     POST /process  → srcPath only (engine-local file, e.g. your pdf
                      project's extracted .txt). Keyed.
     (outbound)     → after /fsm delivery the engine CONNECTS to the PDF
                      praser (PRASER_ENDPOINT, default :5055) and performs
                      the handshake: it PRESENTS the delivered metadata at
                      /api/engine/collect; the praser cross-checks it
                      against the identity the uploader side bound and
                      RESPONDS WITH THE TEXT once parsing finishes. The
                      engine never touches binaries; the praser never
                      needs a key — the delivered metadata IS the key.

   Request body (POST /process):
     {
       text:    "…raw text…",     // full text in one body
       srcPath: "…optional path…",// text already on the server machine
       hash:    "…caller id…",    // optional — names outputs segmented_{hash}_*
       writeSyllable: true,       // WRITE_SYLLABLE
       segmentedMode: "fromdisk",   // SEGMENTED_MODE
       debugMode:     false       // DEBUG_MODE
     }

   Auth (handshake gate — fail closed): the KEY validates the hidden.js
   → engine connection (POST /fsm, GET /result/:hash, POST /process):
   X-API-Key matching the root .env key (FSM_KEY / ENGINE_KEY / API_KEY),
   a caller IP on the allowlist and, when the caller sends Origin/Referer,
   a host on the origin allowlist. No key configured = the engine refuses
   everything. The OUTBOUND handshake to the praser carries no key — the
   praser is validated by the metadata cross-check, not by a shared
   secret. /health is open. Body cap: MAX_PAYLOAD_MB (256).

   Run:
     node Engine-backup/api-server.js            # port 9000 (or PORT env)
   ═══════════════════════════════════════════════════════════════ */

import express from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { configure, grammarPipeline } from "../architecture/init/cli.js";
import { invokeSyllableWithHash, hashKind } from "../init/initS.js";
import { getDateTimeHash } from "../Bridge/logen.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const TMP_DIR = path.join(MODULE_DIR, "File", ".api");
const PORT = parseInt(process.env.PORT || process.env.API_PORT || "9000", 10);
const MAX_PAYLOAD = parseInt(process.env.MAX_PAYLOAD_MB || "256", 10) * 1024 * 1024;

/* ── handshake gate — key + caller IP + origin, fail closed ────
   "Key validating must exist before handshake success": the key is the
   one from the root .env (the same FSM_KEY the Site bridge sends). The
   engine resolves it at boot and refuses /metadata + /process unless
   ALL of these hold:
     1. X-API-Key equals the configured key (timing-safe compare). If the
        engine has NO key configured it rejects everything — a gate that
        cannot validate must not open.
     2. Caller IP (socket) is allow-listed. Dev placeholders: loopback +
        every DEV_BYPASS_IP entry from .env (ENGINE_ALLOWED_IPS overrides).
     3. Origin/Referer, when the caller sends one, resolves to a host on
        the origin allowlist (dev placeholder: localhost:3000 via
        ENGINE_ALLOWED_ORIGINS). Server-to-server fetches send neither —
        key + IP still gate them. /health stays open (liveness only). */
const ROOT_ENV = path.resolve(MODULE_DIR, "..", "..", ".env");

/* .env reader that KEEPS duplicate keys as arrays (DEV_BYPASS_IP is listed
   more than once in the file — every entry is a valid dev IP). */
function readEnvFileMulti(p) {
	const out = {};
	try {
		for (const line of fs.readFileSync(p, "utf8").split("\n")) {
			const t = line.trim();
			if (!t || t.startsWith("#") || t.startsWith("//")) continue;
			const eq = t.indexOf("=");
			if (eq === -1) continue;
			const k = t.slice(0, eq).trim();
			const v = t.slice(eq + 1).trim();
			if (!(k in out)) out[k] = v;
			else if (Array.isArray(out[k])) out[k].push(v);
			else out[k] = [out[k], v];
		}
	} catch {
		/* no .env — process env only */
	}
	return out;
}

const FILE_ENV = readEnvFileMulti(ROOT_ENV);
const asList = (v) =>
	v === undefined || v === null || v === ""
		? []
		: (Array.isArray(v) ? v : [v])
				.flatMap((x) => String(x).split(","))
				.map((x) => x.trim())
				.filter(Boolean);
const firstOf = (env, k) => {
	const v = env[k];
	return Array.isArray(v) ? v[0] : v;
};

const API_KEY =
	process.env.API_KEY ||
	process.env.ENGINE_KEY ||
	firstOf(FILE_ENV, "ENGINE_KEY") ||
	firstOf(FILE_ENV, "FSM_KEY") ||
	"";

const LOOPBACK = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
/* Explicit ENGINE_ALLOWED_IPS wins verbatim (the operator decides, even if
   that excludes loopback). Otherwise: .env DEV_BYPASS_IP entries + loopback. */
const ALLOWED_IPS = new Set(
	process.env.ENGINE_ALLOWED_IPS
		? asList(process.env.ENGINE_ALLOWED_IPS)
		: [
				...asList(FILE_ENV.DEV_BYPASS_IP),
				...asList(FILE_ENV.ENGINE_ALLOWED_IPS),
				...LOOPBACK,
			],
);
const ALLOWED_ORIGINS = new Set(
	process.env.ENGINE_ALLOWED_ORIGINS
		? asList(process.env.ENGINE_ALLOWED_ORIGINS)
		: firstOf(FILE_ENV, "ENGINE_ALLOWED_ORIGINS")
			? asList(firstOf(FILE_ENV, "ENGINE_ALLOWED_ORIGINS"))
			: ["localhost:3000", "localhost", "127.0.0.1:3000"],
);

function timingSafeEq(a, b) {
	const ba = Buffer.from(String(a), "utf8");
	const bb = Buffer.from(String(b), "utf8");
	if (ba.length !== bb.length) return false;
	return crypto.timingSafeEqual(ba, bb);
}

function originHost(req) {
	const raw = req.headers.origin || req.headers.referer || "";
	if (!raw) return null; // server-to-server fetch: no domain header sent
	try {
		return new URL(raw).host;
	} catch {
		return String(raw).replace(/^https?:\/\//, "").split("/")[0];
	}
}

function gate(req) {
	// 1) key — the handshake does not exist without it
	if (!API_KEY) {
		return { ok: false, reason: "rejected: engine has no API key configured (fail closed)" };
	}
	if (!timingSafeEq(req.headers["x-api-key"] || "", API_KEY)) {
		return { ok: false, reason: "rejected: API key missing or wrong" };
	}
	// 2) caller IP — socket address, not spoofable headers
	const ip = req.socket?.remoteAddress || "";
	const ipOk = [...ALLOWED_IPS].some((a) => ip === a || ip === "::ffff:" + a);
	if (!ipOk) {
		return { ok: false, reason: "rejected: caller ip not allowed" };
	}
	// 3) domain — validated when the caller actually sends one
	const host = originHost(req);
	if (host !== null && ![...ALLOWED_ORIGINS].some((a) => host === a)) {
		return { ok: false, reason: "rejected: origin/domain not allowed" };
	}
	return { ok: true };
}

/* ── hidden-delivered metadata — strong validator, no chaining ─
   The metadata cache is filled ONLY by hidden.js (POST /fsm, keyed):
   the trusted DB side tells the engine, ahead of time, what each
   submission must look like — submitId, filename (the frontend-created
   name), userId, sessionId, formId; sha256/bytes when the Site server
   already holds the parsed text. Delivery TRIGGERS the engine-side
   handshake: the engine connects to the PDF praser, presents exactly
   this metadata, and the praser — after cross-checking it against the
   identity the uploader bound — RESPONDS WITH THE TEXT. Anything
   misaligned is rejected at the praser (403 + burn) or at the engine
   (delivered sha/bytes mismatch → burn). One delivered record = at
   most one collect, one processing run. No chaining, no retries
   against a different path. */
const PRE_RECEIVED = new Map();
const PRE_RECEIVED_MAX = parseInt(process.env.PRE_RECEIVED_MAX || "500", 10);
const PRE_RECEIVED_TTL_MS = parseInt(
	process.env.PRE_RECEIVED_TTL_MS || String(10 * 60 * 1000),
	10,
);

/* Collected + processed results, keyed by submitId — the Site server
   polls GET /result/:hash (keyed) for these. */
const COLLECTED = new Map();

/* The PDF praser service (same web as the frontend, different port in
   dev; https cross-web in prod). The ENGINE initiates every connection. */
const PRASER_ENDPOINT = (
	process.env.PRASER_ENDPOINT || "http://127.0.0.1:5055"
).replace(/\/$/, "");
const COLLECT_TIMEOUT_MS = parseInt(
	process.env.ENGINE_COLLECT_TIMEOUT_MS || String(120 * 1000),
	10,
);
const COLLECT_RETRY_MS = parseInt(
	process.env.ENGINE_COLLECT_RETRY_MS || "500",
	10,
);

function sha256Hex(s) {
	return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

function storePreReceived(record) {
	// TTL prune on insert; the cap bounds memory regardless
	const now = Date.now();
	for (const [id, rec] of PRE_RECEIVED) {
		if (now - rec.receivedAt > PRE_RECEIVED_TTL_MS) PRE_RECEIVED.delete(id);
	}
	while (PRE_RECEIVED.size >= PRE_RECEIVED_MAX) {
		PRE_RECEIVED.delete(PRE_RECEIVED.keys().next().value);
	}
	PRE_RECEIVED.set(record.submitId, record);
}

/* The engine-initiated handshake, owner design: connect to the PDF
   praser, PRESENT the hidden-delivered metadata, and let the praser
   RESPOND WITH THE TEXT once parsing finishes (404 = not ready yet →
   keep waiting; 403 = misaligned → record burned, no retry). When
   hidden delivered a sha, the responded text is verified against it —
   the expectation still comes from the trusted side, never from the
   text's own transport. On success the text is staged into the engine
   workspace and processed with the caller's id (segmented_{submitId}_*).
   Fail closed: every failure burns the record. */
async function collectFromPraser(record) {
	const deadline = Date.now() + COLLECT_TIMEOUT_MS;
	let lastErr = "";
	while (Date.now() < deadline) {
		let res;
		try {
			res = await fetch(`${PRASER_ENDPOINT}/api/engine/collect`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					submitId: record.submitId,
					filename: record.filename,
					userId: String(record.userId ?? ""),
					sessionId: record.sessionId,
					formId: record.formId,
				}),
				signal: AbortSignal.timeout(30000),
			});
		} catch (err) {
			lastErr = err.message;
			await new Promise((r) => setTimeout(r, COLLECT_RETRY_MS));
			continue;
		}
		if (res.status === 404) {
			// praser has no bound job for this id YET — encoding/forwarding
			// still in flight; this is the "engine waits" half of the design
			await new Promise((r) => setTimeout(r, COLLECT_RETRY_MS));
			continue;
		}
		if (res.status === 403) {
			lastErr = "praser rejected the presented metadata (403, binding burned)";
			break;
		}
		if (!res.ok) {
			lastErr = `praser collect ${res.status}`;
			break;
		}
		const payload = await res.json();
		const content = String(payload.content ?? "");
		if (record.textSha256 && sha256Hex(content) !== record.textSha256) {
			lastErr = "collected text does not match the delivered textSha256";
			break;
		}
		if (
			(record.textBytes !== null && record.textBytes !== undefined) &&
			Buffer.byteLength(content, "utf8") !== Number(record.textBytes)
		) {
			lastErr = "collected text does not match the delivered textBytes";
			break;
		}
		// process: stage into the engine's own workspace, then the normal
		// pipeline — streamline.js (FSM stream, \n-boundary) does the file
		// reading; outputs land as segmented_{submitId}_*
		let tmpFile = null;
		try {
			fs.mkdirSync(TMP_DIR, { recursive: true });
			tmpFile = path.join(TMP_DIR, `api_${getDateTimeHash()}.txt`);
			fs.writeFileSync(tmpFile, content, "utf8");
			configure({
				srcPath: tmpFile,
				writeSyllable: true,
				segmentedMode: "jsonbody",
				debugMode: false,
			});
			const results = await grammarPipeline({ srcPath: tmpFile, hash: record.submitId });
			const hash = results[0]?.hash ?? null;
			const syllable = hash ? await invokeSyllableWithHash(hash) : [];
			COLLECTED.set(record.submitId, {
				done: true,
				engineHash: hash,
				syllableCount: Array.isArray(syllable) ? syllable.length : 0,
				collectedAt: Date.now(),
			});
			console.log(
				`[api-server] collected ${record.submitId} from praser — hash ${hash} (${syllable.length} syllables)`,
			);
		} catch (err) {
			COLLECTED.set(record.submitId, {
				done: false,
				error: err.message,
				collectedAt: Date.now(),
			});
			console.error(`[api-server] collect processing failed:`, err.message);
		} finally {
			if (tmpFile) {
				try {
					fs.unlinkSync(tmpFile);
				} catch {
					/* best-effort cleanup */
				}
			}
			PRE_RECEIVED.delete(record.submitId);
		}
		return;
	}
	COLLECTED.set(record.submitId, {
		done: false,
		error: lastErr || "collect timed out",
		collectedAt: Date.now(),
	});
	PRE_RECEIVED.delete(record.submitId);
	console.error(`[api-server] collect failed for ${record.submitId}: ${lastErr}`);
}

/* ── express plumbing ────────────────────────────────────────── */

function sendJson(res, status, data) {
	res.status(status).json(data);
}

/* gate as middleware — same fail-closed semantics as before */
function gated(req, res, next) {
	const g = gate(req);
	if (!g.ok) return sendJson(res, 403, { error: g.reason });
	next();
}

export function createApp() {
	const app = express();
	app.disable("x-powered-by");
	app.use(
		express.json({
			limit: MAX_PAYLOAD,
			/* Content-Type must be JSON — anything else stays unparsed,
			   which the validators then refuse as missing fields. */
		}),
	);

	/* ── GET /health — liveness, OPEN ────────────────────────────── */
	app.get("/health", (req, res) =>
		sendJson(res, 200, { ok: true, engine: "fsmgr-syllable", port: PORT }),
	);

	/* ── POST /fsm — hidden.js delivers the metadata (KEYED) ───────
	   The trusted DB side tells the engine, ahead of time, what the
	   submission must look like. This is the ONLY endpoint that may
	   create a cache record, and it sits behind the full handshake
	   gate (key + IP + origin). Payload = hidden.js's exact shape
	   (fileName, fileUrl, status …) + optional textSha256/textBytes.
	   With fileUrl and no sha the engine pulls the raw txt NOW and
	   computes the expectations from the authoritative file. */
	app.post("/fsm", gated, (req, res) => {
		const body = req.body ?? {};
		const records = body.records ?? [body];
		const stored = [];
		for (const b of records) {
			const record = {
				submitId: b.submitId,
				filename: b.filename || b.fileName,
				userId: b.userId,
				sessionId: b.sessionId,
				formId: b.formId,
				source: b.source ?? null,
				originalName: b.originalName ?? b.originalFileName ?? null,
				status: b.status ?? null,
				fileUrl: b.fileUrl ?? null,
				textSha256: b.textSha256 ?? null,
				textBytes: b.textBytes ?? null,
				receivedAt: Date.now(),
			};
			const required = ["submitId", "filename", "userId", "sessionId", "formId"];
			const missing = required.filter(
				(k) => record[k] === undefined || record[k] === null || record[k] === "",
			);
			if (missing.length) {
				return sendJson(res, 400, {
					error: `/fsm missing required validators: ${missing.join(", ")}`,
				});
			}
			if (!hashKind(record.submitId)) {
				return sendJson(res, 400, { error: "/fsm: unusable submitId shape" });
			}
			if (!String(record.filename).startsWith(String(record.submitId))) {
				return sendJson(res, 400, {
					error:
						"/fsm: filename is not the frontend-created name ({submitId}{ext})",
				});
			}
			// sha/bytes are OPTIONAL now: hidden (DB side) cannot compute
			// them — when the Site server already holds the parsed text it
			// delivers them, and the collected text is verified against
			// them. fileUrl is stored for reference only; the text ALWAYS
			// arrives via the engine-initiated praser handshake.
			storePreReceived(record);
			stored.push(record.submitId);
		}
		// The handshake starts HERE — the engine initiates the connection
		// to the praser and waits for the response text. Not awaited: the
		// Site polls GET /result/:hash for the outcome.
		for (const id of stored) {
			const rec = PRE_RECEIVED.get(id);
			if (rec) collectFromPraser(rec).catch((err) => {
				console.error("[api-server] collect crashed:", err.message);
				PRE_RECEIVED.delete(id);
				COLLECTED.set(id, { done: false, error: err.message, collectedAt: Date.now() });
			});
		}
		return sendJson(res, 200, {
			stored: stored.length,
			submitIds: stored,
			pending: PRE_RECEIVED.size,
		});
	});

	/* ── POST /process — srcPath only (engine-local file) ─────────
	   Keyed like the other hidden-side routes. Body-text pushes are
	   GONE: file text arrives exclusively through the engine-initiated
	   praser handshake (see collectFromPraser). srcPath stays for the
	   engine-local path (e.g. your pdf project's extracted .txt on the
	   same machine). */
	app.post("/process", gated, async (req, res) => {
		const { srcPath, ...rest } = req.body ?? {};
		if (!srcPath) {
			return sendJson(res, 400, {
				error:
					"srcPath required — body-text pushes were removed; text arrives via the engine-initiated praser handshake",
			});
		}
		/* Absolute caller path (pdf project) is used directly; a relative path
		   is resolved against the SERVER cwd — same machine test setup. */
		let input = srcPath;
		if (!path.isAbsolute(srcPath)) {
			input = path.resolve(process.cwd(), srcPath);
		}
		try {
			/* Same flag names the CLI uses — one row per flag, no registry.
			   `hash` (optional) is the CALLER's id (server branch: submitId).
			   runMain() validates the shape (engine ts / uuid / 32-hex session)
			   and names the outputs segmented_{hash}_* — so the caller reads
			   them back with invokeWithHash(its own id). Forwarded ONLY when
			   present; without it the engine mints its own timestamp hash. */
			const pipeOpts = { srcPath: input };
			if (rest.hash !== undefined) pipeOpts.hash = rest.hash;
			configure({
				srcPath: input,
				writeSyllable: rest.writeSyllable,
				segmentedMode: rest.segmentedMode,
				debugMode: rest.debugMode,
			});
			const results = await grammarPipeline(pipeOpts);
			/* Public API returns POSITIONS, not ready-made segmented text.
			   The caller writes the segmentation itself from its own input. */
			const hash = results[0]?.hash ?? null;
			const syllable = hash ? await invokeSyllableWithHash(hash) : [];
			return sendJson(res, 200, { hash, syllable });
		} catch (err) {
			return sendJson(res, 500, { error: err.message });
		}
	});

	/* ── GET /result/:hash — keyed poll target for the Site server ──
	   The outcome of the engine-initiated collect for this id. */
	app.get("/result/:hash", gated, (req, res) => {
		const hash = req.params.hash;
		if (!hash || !hashKind(hash)) {
			return sendJson(res, 400, { error: "unusable hash shape" });
		}
		const outcome = COLLECTED.get(hash);
		return sendJson(res, 200, outcome ?? { done: false, hash });
	});

	/* JSON body-parse errors (bad JSON, over MAX_PAYLOAD) → 400s,
	   not the default HTML page. Everything else → 404. */
	app.use((err, req, res, next) => {
		if (err) return sendJson(res, err.status ?? 400, { error: err.message });
		next();
	});
	app.use((req, res) => sendJson(res, 404, { error: "Not found" }));

	return app;
}

/* ── start (production stage) ────────────────────────────────── */

export function startServer(port = PORT) {
	const app = createApp();
	const server = app.listen(port, "0.0.0.0", () => {
		console.log(`[api-server] listening on http://0.0.0.0:${port}`);
		console.log("[api-server] routes: POST /fsm (keyed) - GET /result/:hash (keyed) - POST /process (keyed, srcPath only) - GET /health (open)");
		if (API_KEY) {
			console.log(
				`[api-server] handshake gate ON — key ${API_KEY.slice(0, 6)}…(${API_KEY.length} chars) from ${
					process.env.API_KEY || process.env.ENGINE_KEY ? "env" : ".env"
				}, ips: ${[...ALLOWED_IPS].join(" ")}, origins: ${[...ALLOWED_ORIGINS].join(" ")}`,
			);
		} else {
			console.log(
				"[api-server] handshake gate FAIL-CLOSED — no key in env/.env; /fsm refuses everything",
			);
		}
		console.log(`[api-server] praser handshake target: ${PRASER_ENDPOINT}/api/engine/collect (engine initiates)`);
	});
	return server;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) startServer();
