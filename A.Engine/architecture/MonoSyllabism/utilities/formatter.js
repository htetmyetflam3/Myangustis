











import { toBurmeseStr } from "../../MonoSyllabism/map/loader.js";


export const DELIM = "  ";


export const SYLLABLE_SUFFIX = "√";

export const SPACE_TOKEN = " √";

export function toSyllableToken(text) {
	return toBurmeseStr(text) + SYLLABLE_SUFFIX;
}

export function splitSyllables(line) {
	return line.split(SYLLABLE_SUFFIX).filter((t) => t);
}

export function toSyllableLine(lineStr) {
	return lineStr
		.split(SYLLABLE_SUFFIX)
		.filter((t) => t.trim())
		.join(DELIM);
}


export const EOS_MARK = "<eos>";

export function asEos(surface) {
	return surface + EOS_MARK;
}
export function isEosToken(surface) {
	return surface.endsWith(EOS_MARK);
}


export function tokenBurmese(t) {
	return (t.syllables ?? []).join("");
}


export function mergedIds(ids) {
	return (ids ?? []).join("");
}

export function tokenId(t) {
	return mergedIds(t.ids) || tokenBurmese(t);
}


export function tokenIsBoundary(t) {
	return isEosToken(tokenBurmese(t));
}




export function toBurmeseLine(lineResult) {
	const parts = [];
	for (const token of lineResult.tokens ?? []) {
		parts.push(...(token.syllables ?? []));
	}
	return parts.join(DELIM);
}


export function toBurmeseLineWithPos(lineResult, posField = "finalPos") {
	return (lineResult.tokens ?? [])
		.map((t) => (tokenIsBoundary(t) ? tokenBurmese(t) : `${tokenBurmese(t)}{${t[posField] ?? "?"}}`))
		.join(DELIM);
}






export function toIdsLineWithPos(lineResult, posField = "rawPos") {
	return (lineResult.tokens ?? [])
		.map((t) => (tokenIsBoundary(t) ? tokenId(t) : `${tokenId(t)}{${t[posField]}}`))
		.join(DELIM);
}


export function toIdMapperLine(lineResult, idOf = (s) => s) {
	const out = [];
	for (const t of lineResult.tokens ?? []) {
		for (const s of t.syllables ?? []) {
			const core = s.endsWith("<eos>") ? s.slice(0, -5) : s;
			out.push(idOf(core));
		}
	}
	return out.join(DELIM);
}


export function toIdMergedLine(lineResult) {
	return (lineResult.tokens ?? []).map((t) => tokenId(t)).join(DELIM);
}




export function isBase(ch) {
	const cp = ch.codePointAt(0);
	return (cp >= 0x1000 && cp <= 0x1021) || cp === 0x1025 || cp === 0x1027;
}





export function toPositions(line) {
	const tokens = line
		.split(DELIM)
		.map((t) => t.trim())
		.filter((t) => t.length > 0);
	const burmese = tokens.filter((t) => isBase(Array.from(t)[0] ?? ""));
	if (burmese.length === 0) return null;
	return {
		index: Array.from(burmese[0])[0],
		syllable: burmese.map((t) => String(Array.from(t).length - 1)),
	};
}
