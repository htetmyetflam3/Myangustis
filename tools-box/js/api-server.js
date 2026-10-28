#!/usr/bin/env node




















































import express from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { ENV_RESULT } from "../../index-path.js";
import { BindEngine } from "../_path.js";

const PORT = parseInt(process.env.PORT || process.env.API_PORT || "9000", 10);
const MAX_PAYLOAD = parseInt(process.env.MAX_PAYLOAD_MB || "256", 10) * 1024 * 1024;







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


const FILE_ENV = {};
for (const f of ENV_RESULT.sources) {
	for (const [k, v] of Object.entries(readEnvFileMulti(f))) {
		if (!(k in FILE_ENV)) FILE_ENV[k] = v;
	}
}
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
	if (!raw) return null;
	try {
		return new URL(raw).host;
	} catch {
		return String(raw).replace(/^https?:\/\//, "").split("/")[0];
	}
}

function gate(req) {

	if (!API_KEY) {
		return { ok: false, reason: "rejected: engine has no API key configured (fail closed)" };
	}
	if (!timingSafeEq(req.headers["x-api-key"] || "", API_KEY)) {
		return { ok: false, reason: "rejected: API key missing or wrong" };
	}

	const ip = req.socket?.remoteAddress || "";
	const ipOk = [...ALLOWED_IPS].some((a) => ip === a || ip === "::ffff:" + a);
	if (!ipOk) {
		return { ok: false, reason: "rejected: caller ip not allowed" };
	}

	const host = originHost(req);
	if (host !== null && ![...ALLOWED_ORIGINS].some((a) => host === a)) {
		return { ok: false, reason: "rejected: origin/domain not allowed" };
	}
	return { ok: true };
}














const PRE_RECEIVED = new Map();
const PRE_RECEIVED_MAX = parseInt(process.env.PRE_RECEIVED_MAX || "500", 10);
const PRE_RECEIVED_TTL_MS = parseInt(
	process.env.PRE_RECEIVED_TTL_MS || String(10 * 60 * 1000),
	10,
);



const COLLECTED = new Map();



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

function hashKind(value) {
	return typeof value === "string" && value !== "." && /^[A-Za-z0-9._-]{1,128}$/.test(value) && !value.includes("..");
}

function bridgeHash(value) {
	return hashKind(value) && value.length === 72 ? value : crypto.randomBytes(36).toString("hex");
}

async function positionsFromText(sourceText, hash) {
	return Array.fromAsync(BindEngine({ flag: "syllable", hash, sourceText }));
}

function storePreReceived(record) {

	const now = Date.now();
	for (const [id, rec] of PRE_RECEIVED) {
		if (now - rec.receivedAt > PRE_RECEIVED_TTL_MS) PRE_RECEIVED.delete(id);
	}
	while (PRE_RECEIVED.size >= PRE_RECEIVED_MAX) {
		PRE_RECEIVED.delete(PRE_RECEIVED.keys().next().value);
	}
	PRE_RECEIVED.set(record.submitId, record);
}










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



		try {
			const hash = bridgeHash(record.submitId);
			const syllable = await positionsFromText(content, hash);
			COLLECTED.set(record.submitId, {
				done: true,
				engineHash: hash,
				syllableCount: syllable.length,
				collectedAt: Date.now(),
			});
			console.log(`[api-server] collected ${record.submitId} from praser — hash ${hash} (${syllable.length} syllables)`);
		} catch (err) {
			COLLECTED.set(record.submitId, { done: false, error: err.message, collectedAt: Date.now() });
			console.error(`[api-server] collect processing failed:`, err.message);
		} finally {
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



function sendJson(res, status, data) {
	res.status(status).json(data);
}


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


		}),
	);


	app.get("/health", (req, res) =>
		sendJson(res, 200, { ok: true, engine: "fsmgr-syllable", port: PORT }),
	);









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





			storePreReceived(record);
			stored.push(record.submitId);
		}



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







	app.post("/process", gated, async (req, res) => {
		const { srcPath, hash: requestedHash, debugMode = false } = req.body ?? {};
		if (typeof srcPath !== "string" || !srcPath) {
			return sendJson(res, 400, { error: "srcPath required — body-text pushes are not accepted" });
		}
		if (requestedHash !== undefined && (!hashKind(requestedHash) || requestedHash.length !== 72)) {
			return sendJson(res, 400, { error: "hash must be 72 safe characters" });
		}
		if (typeof debugMode !== "boolean") {
			return sendJson(res, 400, { error: "debugMode must be a boolean" });
		}
		const input = path.resolve(srcPath);
		try {
			let sourceText = "";
			for await (const chunk of fs.createReadStream(input, { encoding: "utf8" })) sourceText += chunk;
			const hash = requestedHash ?? crypto.randomBytes(36).toString("hex");
			if (debugMode) {
				const debug = await BindEngine({ flag: "syllable", hash, sourceText, debug: true });
				return sendJson(res, 200, { hash, debug });
			}
			const syllable = await positionsFromText(sourceText, hash);
			return sendJson(res, 200, { hash, syllable });
		} catch (err) {
			return sendJson(res, err.code === "ENOENT" ? 404 : 500, { error: err.message });
		}
	});


	app.get("/result/:hash", gated, (req, res) => {
		const hash = req.params.hash;
		if (!hash || !hashKind(hash)) {
			return sendJson(res, 400, { error: "unusable hash shape" });
		}
		const outcome = COLLECTED.get(hash);
		return sendJson(res, 200, outcome ?? { done: false, hash });
	});



	app.use((err, req, res, next) => {
		if (err) return sendJson(res, err.status ?? 400, { error: err.message });
		next();
	});
	app.use((req, res) => sendJson(res, 404, { error: "Not found" }));

	return app;
}



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
