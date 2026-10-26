import {
	taggerStart,
	taggerEnd,
	tagTokenReceived,
	tagWordCount,
} from "../../../bridge/logen.js";

import { walkPos } from "../grapheme/traverser.js";
import { PUNCTUATION, ALL_DIGITS } from "../../map/loader.js";
import { burmeseToId } from "../../generators/idmap.js";
import { classifyNumber } from "./classify-number.js";
import { splitSyllables, asEos, mergedIds } from "../../utilities/formatter.js";

const BURMESE_FULLSTOP = "။";

function isWhitespace(tok) {
	return tok === " " || tok === "\t" || tok === "\r" || tok === "\n";
}

function isNumber(tok) {
	if (!tok) return false;
	let hasDigit = false;
	for (const ch of tok) {
		if (ALL_DIGITS.has(ch)) {
			hasDigit = true;
			continue;
		}
		if (ch === " " || ch === "-" || ch === "/" || ch === "." || ch === ",") continue;
		return false;
	}
	return hasDigit;
}

function isPunctuation(tok) {
	return PUNCTUATION.has(tok);
}

function isEnglishBlock(tok) {
	return tok && tok.startsWith("{") && tok.endsWith("}");
}

function isTreeId(id) {
	if (!id || id.length !== 4) return false;
	/* No /^\d{4}$/ branch: ids were 4 numeric digits in the old scheme
	   (1500/1000 were literal standalones). They are prefix + 3 digits
	   now, standalones have π, so a bare 4-digit id cannot occur — the
	   branch could only ever collide with a caller's own number. */
	if (/^[A-Z¶£¥¦§¨©ª«¬®¯°±²³]\d{3}$/.test(id)) return true;
	if (/^π\d{3}$/.test(id)) return true;
	return false;
}

function classifyToken(tok) {
	if (isWhitespace(tok)) return null;
	if (isNumber(tok)) return classifyNumber(tok);
	if (tok === BURMESE_FULLSTOP) return { rawPos: ["pan"] };
	if (isPunctuation(tok)) return { rawPos: ["pan"] };
	if (isEnglishBlock(tok)) return { rawPos: ["en"] };
	return { rawPos: ["?"] };
}

function* walkLine(burmeseTokens, idTokens) {
	let pos = 0;

	while (pos < idTokens.length) {
		const burmeseTok = burmeseTokens[pos];
		const idTok = idTokens[pos];

		/* Fullstop never walks the tree — skip it, keep the surface,
		   and suffix <eos> directly behind (the way the segmentor
		   suffixes √ behind each syllable). No tag, ever. */
		if (burmeseTok === BURMESE_FULLSTOP) {
			yield {
				syllables: [asEos(BURMESE_FULLSTOP)],
				ids: [idTok],
				rawPos: ["eos"],
			};
			pos++;
			continue;
		}

		if (!isTreeId(idTok)) {
			const classified = classifyToken(burmeseTok);
			if (classified) {
				yield {
					syllables: [burmeseTok],
					ids: [idTok],
					rawPos: classified.rawPos,
				};
			}
			pos++;
			continue;
		}

		const result = walkPos(idTokens, pos);
		if (!result) {
			pos++;
			continue;
		}

		const nextPos = result.lastValidPos;
		const consumedBurmese = burmeseTokens.slice(pos, nextPos);
		const consumedIds = idTokens.slice(pos, nextPos);

		if (consumedBurmese.length > 0) {
			yield {
				syllables: consumedBurmese,
				ids: [mergedIds(consumedIds)],
				rawPos: result.rawPos,
			};
		}
		pos = nextPos;
	}
}

export async function* runTagger(unitGen, hash) {
	taggerStart({ hash });

	const startTime = Date.now();
	let tokenCount = 0;
	let wordCount = 0;

	for await (const lineStr of unitGen) {
		const burmeseTokens = splitSyllables(lineStr);
		const idTokens = burmeseTokens.map((t) => burmeseToId(t) ?? t);

		const lastTok = burmeseTokens[burmeseTokens.length - 1];
		const hasFullStop = lastTok === BURMESE_FULLSTOP;

		const lineTokens = [];
		for (const token of walkLine(burmeseTokens, idTokens)) {
			lineTokens.push(token);
			tokenCount++;
			const tag = token.rawPos[0];
			if (
				tag !== "?" &&
				tag !== "pan" &&
				tag !== "eos" &&
				tag !== "en" &&
				tag !== "count" &&
				tag !== "phone" &&
				tag !== "addr" &&
				tag !== "year" &&
				tag !== "exactdate"
			) {
				wordCount++;
			}
		}

		yield {
			tokens: lineTokens,
			isEos: hasFullStop,
		};
	}

	tagTokenReceived(tokenCount);
	tagWordCount(wordCount);

	const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
	taggerEnd({ tokenCount, wordCount, elapsedSec: elapsed });
}

export default { runTagger };
