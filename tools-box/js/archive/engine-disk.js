











import fs from "fs";
import { TREE_DIR } from "../../../Architecture/Engine/MonoSyllabism/main/grapheme/cache-integrity.js";
import { getLogen } from "../../../Architecture/Engine/_path.js";
const { writerStart, writerEnd, writerWrote, getDateTimeHash, readerStart, readerEnd, readerFail } = (await getLogen()).legacyLog;
import { OutputFile, joinPath } from "../../../Architecture/Engine/_path.js";
import { toSyllableLine } from "../../../Architecture/Engine/MonoSyllabism/utilities/formatter.js";
import { toLineStrings } from "../../../Architecture/Engine/MonoSyllabism/generators/SfomatterForP.js";


let _sessionHash = null;

function getHash() {
	if (!_sessionHash) _sessionHash = getDateTimeHash();
	return _sessionHash;
}

export function resetHash() {
	_sessionHash = null;
}

export function setHash(hash) {
	_sessionHash = hash;
}


export function createStreamWriter(outputDir = OutputFile(), suffix = "", flushLines = 1000, { exclusive = false } = {}) {
	const ts = getHash();
	const suffixPart = suffix ? `_${suffix}` : "";
	const outputPath = joinPath(outputDir, `segmented_${ts}${suffixPart}.txt`);
	let lineCount = 0;
	let buffer = "";

	fs.mkdirSync(outputDir, { recursive: true });
	fs.writeFileSync(outputPath, "", { encoding: "utf8", flag: exclusive ? "wx" : "w" });
	writerStart({ outputDir, lineCount: 0 });

	function flush() {
		if (buffer.length === 0) return;
		fs.appendFileSync(outputPath, buffer, "utf8");
		buffer = "";
	}

	function writeLine(syllables) {
		buffer += syllables.join("  ") + "\n";
		lineCount++;
		if (lineCount % flushLines === 0) flush();
	}



	async function consumeSyllable(seg) {
		let n = 0;
		for await (const lineStr of toLineStrings(seg)) {
			writeLine([toSyllableLine(lineStr)]);
			n++;
		}
		return n;
	}

	return {
		outputPath,
		writeLine,
		consumeSyllable,
		flush,
		close() {
			flush();
			writerWrote({ path: outputPath, lines: lineCount });
			writerEnd({ path: outputPath });
			return outputPath;
		},
	};
}


export function writeTreeToDir(treeData, treeDir = TREE_DIR) {
	const filePath = joinPath(treeDir, "syllable.tree.json");
	fs.writeFileSync(filePath, JSON.stringify(treeData, null, 2), "utf8");
	return filePath;
}

export function writeMappedToDir(lines, treeDir = TREE_DIR) {
	const filePath = joinPath(treeDir, "syllable.mapped.txt");
	fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf8");
	return filePath;
}

export function writeRtlToDir(rtlData, treeDir = TREE_DIR) {
	const filePath = joinPath(treeDir, "rtl-tree.json");
	fs.writeFileSync(filePath, JSON.stringify(rtlData, null, 2), "utf8");
	return filePath;
}

export function writeRefToDir(refData, treeDir = TREE_DIR) {
	const filePath = joinPath(treeDir, "ref-syllables.json");
	fs.writeFileSync(filePath, JSON.stringify(refData, null, 2), "utf8");
	return filePath;
}


export function readFile(filePath, encoding = "utf8") {
	if (!fs.existsSync(filePath)) return null;
	return fs.readFileSync(filePath, encoding);
}

export function fileExists(filePath) {
	return fs.existsSync(filePath);
}

export function writeFile(filePath, content, encoding = "utf8") {
	fs.writeFileSync(filePath, content, encoding);
	return filePath;
}

export function writeJson(filePath, data, space = 2) {
	fs.writeFileSync(filePath, JSON.stringify(data, null, space), "utf8");
	return filePath;
}

export function appendFile(filePath, content, encoding = "utf8") {
	fs.appendFileSync(filePath, content, encoding);
	return filePath;
}

export function readLines(filePath) {
	const raw = readFile(filePath);
	if (!raw || typeof raw !== "string") return [];
	return raw
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
}

export function readInput(filePath) {
	readerStart({ filePath });
	const text = readFile(filePath);
	if (!text || typeof text !== "string") {
		readerFail({ filePath, reason: "not found or empty" });
		return null;
	}
	readerEnd({ filePath, length: text.length });
	return text;
}
