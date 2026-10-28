









import fs from "node:fs";
import { resolvePath } from "../../_path.js";







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






export function getReadChunkSize(fileSizeBytes) {
	const sizeMB = fileSizeBytes / (1024 * 1024);
	if (sizeMB < 2) return 256 * 1024;
	if (sizeMB < 5) return 512 * 1024;
	if (sizeMB < 10) return 256 * 1024;
	return 1024 * 1024;
}














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

	if (sizeMB === null) return 1000;
	if (sizeMB < 0.02) return Infinity;
	if (sizeMB < 2) return 1000;
	if (sizeMB < 10) return 2500;
	return 5000;
}
