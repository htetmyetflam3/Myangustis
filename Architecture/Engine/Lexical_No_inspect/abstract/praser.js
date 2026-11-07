import {
	// eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
	StyleSets,
	// eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
	QS_Bridge,
	_particleToClass,
	Templates,
} from "../../knowledge/isTreasure/template.js";

/* ═══════════════════════════════════════════════════════════════
   PARSER
   Knows: particles (wibat/pyitsi/thanbanda), Templates, STRules
   Trusts: single rawPos from tagger (100% match, no ask)
   Asks:  only when rawPos.length > 1 (ambiguous)
   ═══════════════════════════════════════════════════════════════ */

export const STRules = {
	/* ... same ... */
};
// eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
export function fixLogic(taggedTokens, finalParticleToken) {
	/* ... same ... */
}

/* ── Ambiguity resolver (only called when needed) ── */
// eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
function resolvePos(token, expectedFamilies, ctx) {
	// If single tag, trust it blindly
	if (token.rawPos?.length === 1) return token.rawPos[0];

	// If ambiguous, check if any expected family matches raw candidates
	for (const fam of expectedFamilies) {
		if (token.rawPos?.includes(fam)) return fam;
	}
	// Fallback: first raw pos
	return token.rawPos?.[0] || "n";
}

/* ── Myanmar Parser ── */
export class MyanmarParser {
	constructor() {
		this.whWords = new Set([
			"ဘယ်သူ",
			"မည်သူ",
			"ဘယ်",
			"မည်မျှ",
			"ဘယ်နှယောက်",
			"ဘယ်တော့",
			"မည်သည့်",
			"ဘာ",
		]);
	}

	/* Tokenize: keep rawPos from tagger, enrich particles from registry */
	parseTokens(line) {
		const out = [];
		for (const part of line.trim().split(/\s+/)) {
			if (!part) continue;
			const m = part.match(/^(.+?)\{([^}]+)\}$/);
			let val, rawPosTag;
			if (m) {
				val = m[1];
				rawPosTag = m[2];
			} else {
				val = part;
				rawPosTag = null;
			}

			// Boundary
			if (rawPosTag === "eos" || val === "<EOS>") {
				out.push({
					type: "boundary",
					value: val,
					posFamily: "eos",
					pos: "eos",
				});
				continue;
			}
			if (rawPosTag === "pan" || /^[။၊!?]+$/.test(val)) {
				out.push({
					type: "boundary",
					value: val,
					posFamily: "punctuation",
					pos: "pan",
				});
				continue;
			}

			// Particle: parser KNOWS this directly from registry
			const cls = _particleToClass.get(val);
			if (cls) {
			out.push({
				value: val,
				posFamily: "particle",
				pos: cls.category, // wibat / pyitsi / thanbanda
				ls: cls.ls, // LSE / LSN / BOTH
				category: cls.category,
				family: cls.family, // e.g. "subject-marker"
				type: cls.type,
				rawPos: ["ps", "wi", "cj"], // all particle types it could be
			});
				continue;
			}

			// Content word: trust tagger, keep rawPos
			const t = {
				type: "token",
				value: val,
				rawPos: rawPosTag ? [rawPosTag] : ["n", "v", "pn"],
			};

			const T = rawPosTag ? rawPosTag.toUpperCase() : "";
			if (T === "VERBS") {
				t.posFamily = "verb";
				t.pos = "main-verb";
				t.rawPos = ["v"];
			} else if (T === "NOUNS") {
				t.posFamily = "noun";
				t.pos = "common-noun";
				t.rawPos = ["n"];
			} else if (T === "PRONOUNS") {
				t.posFamily = "pronoun";
				t.pos = "pronoun";
				t.rawPos = ["pn"];
			} else if (T === "NUMBERS") {
				t.posFamily = "number";
				t.pos = "number";
				t.rawPos = ["num"];
			} else if (T === "ADJS" || T === "ADJ") {
				t.posFamily = "adjective";
				t.pos = "adjective";
				t.rawPos = ["dj"];
			} else if (T === "ADVS" || T === "ADV") {
				t.posFamily = "adverb";
				t.pos = "adverb";
				t.rawPos = ["adv"];
			} else if (this.whWords.has(val)) {
				t.posFamily = "pronoun";
				t.pos = "wh-word";
				t.rawPos = ["pn"];
			} else {
				// Tagger gave single letter code
				t.posFamily = this._familyFromCode(t.rawPos[0]);
				t.pos = this._posFromCode(t.rawPos[0]);
			}
			out.push(t);
		}
		return out;
	}

	_familyFromCode(c) {
		const map = {
			n: "noun",
			v: "verb",
			pn: "pronoun",
			dj: "adjective",
			ps: "particle",
			wi: "particle",
			cj: "particle",
			num: "number",
			adv: "adverb",
		};
		return map[c] || "noun";
	}
	_posFromCode(c) {
		const map = {
			n: "common-noun",
			v: "main-verb",
			pn: "pronoun",
			dj: "adjective",
			ps: "pyitsi",
			wi: "wibat",
			cj: "thanbanda",
			num: "number",
			adv: "adverb",
		};
		return map[c] || "common-noun";
	}

	/* ── Main parse: template-driven, right-to-left ── */
	parse(line) {
		const tagged = this.parseTokens(line);

		// 1. Find end (rightmost non-boundary)
		let endIdx = tagged.length - 1;
		while (endIdx >= 0 && tagged[endIdx].type === "boundary") endIdx--;
		if (endIdx < 0)
			return { sentence: line, templateId: null, classification: "empty" };

		const finalToken = tagged[endIdx];
		const finalPE = finalToken.posFamily === "particle" ? finalToken : null;

		// 2. Pick candidates from final particle
		const candidates = this._pickTemplates(finalPE);

		// 3. Walk each candidate template right-to-left
		for (const tplId of candidates) {
			const tpl = Templates[tplId];
			if (!tpl) continue;

			const match = this._matchTemplate(tagged, endIdx, tpl);
			if (match) {
				const ctx = {
					finalParticle: finalPE?.value || "",
					prevIsQS: false,
					isStativeVerb: false,
					hasPreVerb: (p) =>
						match.slots.some((s) => s.slot === "V" && s.preVerb === p),
					matchesMSP01Suffix: () => false,
				};

				const st = STRules[tplId] ? this._resolveST(STRules[tplId], ctx) : "c";
				const fixResult = finalPE ? fixLogic(tagged, finalPE) : null;
				const ls = fixResult ? fixResult.lockedLs : finalPE?.ls || "N";

				return {
					sentence: line,
					templateId: tplId,
					classification: `Ls-${ls}.Fof-Fs.St-${st}`,
					ls,
					family: "Fs",
					st,
					head: match.head,
					tail: match.tail,
					fix: fixResult,
					tokens: tagged,
					slots: match.slots,
				};
			}
		}

		// 4. No template matched
		return {
			sentence: line,
			templateId: null,
			classification: "unknown",
			ls: "N",
			family: "Fs",
			st: "c",
			head: null,
			tail: null,
			fix: null,
			tokens: tagged,
			slots: [],
		};
	}

	/* ── Template matching engine ── */
	_matchTemplate(tagged, endIdx, tpl) {
		const seq = [...tpl.seq].reverse(); // right-to-left: v, then n
		const slots = [];
		let i = endIdx; // start at final token (already matched as anchor)

		// Final token must be compatible with last seq slot
		if (!this._slotAccepts(seq[0], tagged[endIdx])) return null;
		slots.push({ slot: this._slotName(seq[0]), token: tagged[endIdx] });
		i--;

		// Walk remaining slots
		for (let s = 1; s < seq.length; s++) {
			const expected = seq[s];

			// Skip particles between slots (they glue slots together)
			while (i >= 0 && tagged[i].posFamily === "particle") {
				slots.push({ slot: "PE", token: tagged[i] });
				i--;
			}
			if (i < 0) return null;

			const tok = tagged[i];
			if (!this._slotAccepts(expected, tok)) return null;

			slots.push({ slot: this._slotName(expected), token: tok });
			i--;
		}

		// Build head/tail from matched slots
		const head = this._buildHead(slots, tpl);
		const tail =
			tpl.parser === "tail-only" ? this._buildTail(tagged, endIdx) : null;

		return { head, tail, slots };
	}

	_slotAccepts(expected, token) {
		// Particle slot: token must be particle, parser KNOWS particles
		if (expected === "pt") return token.posFamily === "particle";

		// Noun slot: token must be noun-family. If ambiguous, resolve.
		if (expected === "n") {
			if (token.posFamily === "noun" || token.posFamily === "pronoun")
				return true;
			if (token.rawPos?.length === 1)
				return token.rawPos[0] === "n" || token.rawPos[0] === "pn";
			return token.rawPos?.includes("n") || token.rawPos?.includes("pn");
		}

		// Verb slot
		if (expected === "v") {
			if (token.posFamily === "verb") return true;
			if (token.rawPos?.length === 1) return token.rawPos[0] === "v";
			return token.rawPos?.includes("v");
		}

		return false;
	}

	_slotName(expected) {
		return { n: "N", v: "V", pt: "PT" }[expected] || expected.toUpperCase();
	}

	_pickTemplates(finalPE) {
		if (!finalPE) return ["msp-02"];
		const v = finalPE.value;
		if (/(သာတည်း|တည်း)$/.test(v)) return ["msp-05"];
		if (/(သည်|တယ်|ပြီ|မည်|လိမ့်မည်)$/.test(v))
			return ["msp-01", "msp-03", "msp-04", "msp-06", "msp-07"];
		return ["msp-01", "msp-03", "msp-06", "msp-07"];
	}

	_resolveST(branches, ctx) {
		for (const b of branches) if (b.must && b.must(ctx)) return b.st;
		const def = branches.find((b) => b.default);
		return def ? def.st : "c";
	}

	// eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
	_buildHead(slots, tpl) {
		const v = slots.find((s) => s.slot === "V");
		if (!v) return null;
		return {
			type: "Head",
			verb: v.token,
			particles: slots
				.filter((s) => s.slot === "PE")
				.map((p) => ({
					type: "pe",
					token: p.token,
					noun: null,
				})),
			nouns: slots.filter((s) => s.slot === "N").map((n) => n.token),
		};
	}

	_buildTail(tagged, endIdx) {
		const nouns = [];
		for (let i = 0; i < endIdx; i++) {
			const t = tagged[i];
			if (
				t.type !== "boundary" &&
				(t.posFamily === "noun" || t.posFamily === "pronoun")
			)
				nouns.push(t);
		}
		return nouns.length ? { type: "Tail", nouns } : null;
	}
}
