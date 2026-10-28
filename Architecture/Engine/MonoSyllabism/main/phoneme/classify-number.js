












const YEAR_RANGES = [
	[1200, 1400],
	[1900, 2100],
];

const DATE_SEP = /[.\-/]/;


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


	if (/^(၀၉|09)/.test(digitsOnly) && digitsOnly.length >= 8 && digitsOnly.length <= 11) {
		return { rawPos: ["phone"] };
	}

	const groups = numGroups(t);
	const allNumeric = groups.every((g) => /^[0-9၀-၉]+$/.test(g));


	if (allNumeric && groups.length === 3 && DATE_SEP.test(t)) {
		return { rawPos: ["exactdate"] };
	}


	if (allNumeric && groups.length === 1 && isYear(groups[0])) {
		return { rawPos: ["year"] };
	}


	if (t.includes("/")) {
		return { rawPos: ["addr"] };
	}

	return { rawPos: ["count"] };
}

export default classifyNumber;
