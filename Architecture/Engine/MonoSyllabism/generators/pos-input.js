














import { toLineStrings } from './SfomatterForP.js';

export async function* fullstopHolder(seg, { perLine = false } = {}) {
	if (perLine) {
		yield* toLineStrings(seg);
		return;
	}
	let unit = "";
	let stops = 0;
	let hasContent = false;
	for await (const item of seg) {
		if (item === "\n") {
			unit += " √";
			continue;
		}
		if (typeof item !== "string") continue;
		unit += item;
		const core = item.endsWith("√") ? item.slice(0, -1) : item;
		if (core === "။") {
			stops++;
			hasContent = true;
			if (stops >= 2) {
				yield unit;
				unit = "";
				stops = 0;
				hasContent = false;
			}
		} else if (core.trim() !== "") {
			hasContent = true;
		}
	}
	if (unit && hasContent) yield unit;
}


