/* buffer.js — the BUFFER AND SIZE event: how big the stream is and where a
   buffer gets cut. One canonical copy of every table — these used to exist
   three times (S.loaded.js, the stream reader, the old memory dump), all
   slightly different. Now a size question has exactly one place to ask.

   Nothing in this file formats or streams: it answers numbers and splits
   buffers. stream.js reads its tier from here; the bridge asks its flush
   cadence from here; S.loaded.js (the tree loader) no longer carries copies.
*/

import fs from "node:fs";
import { resolvePath } from "../../bridge/path.js";

/**
 * Split a buffer at its last newline — prevents slicing multi-byte Burmese
 * characters mid-glyph on a chunk edge.
 * @param {string} buffer
 * @returns {{ lines: string|null, remainder: string }}
 */
export function splitBuffer(buffer) {
	const lastNewline = buffer.lastIndexOf("\n");
	if (lastNewline === -1) {
		return { lines: null, remainder: buffer };
	}
	return {
		lines: buffer.slice(0, lastNewline + 1),
		remainder: buffer.slice(lastNewline + 1),
	};
}

/* Read-stream chunk tier — the file-reader size table (HALVED). This is the
   ONLY place chunk size lives: the stream reader is a pure generator that
   knows nothing about size and pulls the tier from here. When a line spans a
   chunk boundary the reader pulls a SECOND chunk before yielding — so one
   yield carries at most two tier-sized blocks. */
export function getReadChunkSize(fileSizeBytes) {
	const sizeMB = fileSizeBytes / (1024 * 1024);
	if (sizeMB < 2) return 256 * 1024;
	if (sizeMB < 5) return 512 * 1024;
	if (sizeMB < 10) return 256 * 1024;
	return 1024 * 1024;
}

/*
 * Optimal lines-per-flush for the downstream tagger/rule engine writers.
 * Accepts either a file path string or a raw byte count (from API headers).
 *
 * Sane Burmese line density tiers:
 *   - < 20 KB (queries, short text): Infinity (1-pass in RAM)
 *   - 20 KB – 2 MB (~30k lines):   1,000 lines/flush (~25 clean flushes)
 *   - 2 MB – 10 MB:                2,500 lines/flush
 *   - > 10 MB:                     5,000 lines/flush
 *
 * @param {string|number|null} source - file path or known byte size
 * @returns {number} lines-per-flush count
 */
export function getFlushLines(source) {
	let sizeMB = null;

	if (typeof source === "number") {
		sizeMB = source / (1024 * 1024);
	} else if (typeof source === "string") {
		try {
			const stats = fs.statSync(resolvePath(source));
			sizeMB = stats.size / (1024 * 1024);
		} catch {
			sizeMB = null;
		}
	}

	if (sizeMB === null) return 1000; // unknown streams / pipes
	if (sizeMB < 0.02) return Infinity; // < 20 KB: instant single pass in RAM
	if (sizeMB < 2) return 1000; // 20 KB – 2 MB
	if (sizeMB < 10) return 2500; // 2 MB – 10 MB
	return 5000; // > 10 MB
}
