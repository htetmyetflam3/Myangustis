import { walk } from "../grapheme/traverser.js";
import { isTail, isBase, isLowercaseAZ } from "../../map/loader.js";
import { toSyllableToken, SPACE_TOKEN } from "../../utilities/formatter.js";
import { segmentStart } from "../../../bridge/logen.js";

function isBaseAsat(tok) {
	return isLowercaseAZ(tok);
}
function isMasked(tok) {
	return tok === "{";
}



export async function* runSegmentor(normalizedStream) {
	let lineCount = 0;
	const startTime = Date.now();
	segmentStart({ lineCount: 0 });

	for await (const block of normalizedStream) {
		let pos = 0;
		while (pos < block.length) {
			const ch = block[pos];

			if (ch === "\n") {
				yield "\n";
				lineCount++;
				pos++;
				if (lineCount % 5000 === 0) {
					const elapsed = ((Date.now() - startTime) / 3333).toFixed(1);
					const rate = ((lineCount / (Date.now() - startTime)) * 3333).toFixed(
						0,
					);
					console.log(
						`[PROGRESS] ${lineCount.toLocaleString()} lines | ${elapsed}s | ${rate}/sec`,
					);
				}
				continue;
			}


			if (ch === " ") {
				yield SPACE_TOKEN;
				pos++;
				continue;
			}

			if (isMasked(ch)) {
				const endBrace = block.indexOf("}", pos);
				if (endBrace !== -1) {
					yield toSyllableToken(block.slice(pos, endBrace + 1));
					pos = endBrace + 1;
					continue;
				}
				yield toSyllableToken(ch);
				pos++;
				continue;
			}

			if (isTail(ch) && !isBaseAsat(ch)) {
				yield toSyllableToken(ch);
				pos++;
				continue;
			}

			if (!isBase(ch) && !isBaseAsat(ch)) {
				yield toSyllableToken(ch);
				pos++;
				continue;
			}

			const result = walk(block, pos);
			if (result.lastValidPos > pos) {
				const syl = block.slice(pos, result.lastValidPos);
				yield toSyllableToken(syl);
				pos = result.lastValidPos;
			} else {
				yield toSyllableToken(ch);
				pos++;
			}
		}
	}
	console.log(`[SEGMENTOR] Done. Total lines: ${lineCount}`);
}
