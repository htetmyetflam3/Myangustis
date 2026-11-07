










import fs from "node:fs";
import { resolvePath } from "../../_path.js";
import { splitBuffer, getReadChunkSize } from "./buffer.js";









export async function* collector(filePath, highWaterMark = null) {


	let knownBytes;
	try {
		knownBytes = fs.statSync(resolvePath(filePath)).size;
	} catch {
		knownBytes = undefined;
	}
	const hwm = highWaterMark ?? getReadChunkSize(knownBytes);
	const resolved = resolvePath(filePath);

	const stream = fs.createReadStream(resolved, {
		encoding: "utf8",
		highWaterMark: hwm,
	});

	let buffer = "";
	for await (const chunk of stream) {
		buffer += chunk;
		const { lines, remainder } = splitBuffer(buffer);
		if (lines !== null) {
			yield lines;
			buffer = remainder;
		}
	}

	if (buffer.length > 0) {
		yield buffer;
	}
}






export async function readFileContent(filePath) {
	let text = "";
	for await (const chunk of collector(filePath)) {
		text += chunk;
	}
	return text;
}














export async function* collectFromText(sourceText, highWaterMark = null) {
	let buffer = String(sourceText ?? "");
	const hwm = highWaterMark ?? getReadChunkSize(Buffer.byteLength(buffer, "utf8"));

	while (buffer.length > 0) {
		const window = buffer.length > hwm ? buffer.slice(0, hwm) : buffer;
		const { lines, remainder } = splitBuffer(window);
		if (lines === null) {


			yield window;
			buffer = buffer.slice(window.length);
			continue;
		}
		yield lines;
		buffer = remainder + buffer.slice(window.length);
	}
}
