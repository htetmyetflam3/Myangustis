/**
 * classify-number.js — number classification for the tagger.
 *
 * Moved verbatim from Linga/main/tagger.js so all number shaping lives
 * in one file. isNumber() itself stays with the caller (phonology.js);
 * everything that SHAPES a number token into a rawPos is here.
 *
 * Tags produced: phone | exactdate | year | addr | count.
 */

/* Years worth recognising: Burmese era and Gregorian. A bare 4-digit
   number outside these is a quantity, not a year — which is what keeps
   "1500 ကျပ်" a count. Edit these two rows to widen or narrow it. */
const YEAR_RANGES = [
	[1200, 1400], // Burmese era (current is ~1386)
	[1900, 2100], // Gregorian
];

const DATE_SEP = /[.\-/]/;

/** Digit groups, separator-agnostic. "2024.12.25" → ["2024","12","25"] */
function numGroups(tok) {
	return tok.split(/[.\-/,]/).filter((g) => g.length > 0);
}

function toArabic(s) {
	return Number(s.replace(/[၀-၉]/g, (d) => "၀၁၂၃၄၅၆၇၈၉".indexOf(d)));
}

function isYear(s) {
	if (!/^[0-9၀-၉]{4}$/.test(s)) return false;
	const n = toArabic(s);
	return YEAR_RANGES.some(([lo, hi]) => n >= lo && n <= hi);
}

export function classifyNumber(tok) {
	const t = tok.trim();
	const digitsOnly = t.replace(/[^0-9၀-၉]/g, "");

	/* phone first — most specific shape */
	if (/^(၀၉|09)/.test(digitsOnly) && digitsOnly.length >= 8 && digitsOnly.length <= 11) {
		return { rawPos: ["phone"] };
	}

	const groups = numGroups(t);
	const allNumeric = groups.every((g) => /^[0-9၀-၉]+$/.test(g));

	/* three numeric groups joined by . - / is a date: 2024.12.25, 25/12/2024 */
	if (allNumeric && groups.length === 3 && DATE_SEP.test(t)) {
		return { rawPos: ["exactdate"] };
	}

	/* a lone 4-digit group in a year range: 2024, ၁၃၈၆ */
	if (allNumeric && groups.length === 1 && isYear(groups[0])) {
		return { rawPos: ["year"] };
	}

	/* "၁၂၃/" — a slash that is not part of a date is still an address */
	if (t.includes("/")) {
		return { rawPos: ["addr"] };
	}

	return { rawPos: ["count"] };
}

export default classifyNumber;
