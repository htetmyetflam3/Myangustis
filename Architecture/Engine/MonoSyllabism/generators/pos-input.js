/* generator.js — the GENERATOR event: the async-generator stages that sit
   between the pipeline's modules. No files, no formatting, no sizing — each
   export is a stream in → stream out transform.

   fullstopHolder was assembled inline inside Bridge/bridge.js; toLineStrings
   lived inside the writer's readable stage. Both are pipeline stages, so
   they live here with the rest of their kind.
*/

/* Holder behind the segmentor (tagger path only): pieces arrive
   √-suffixed from the segmentor — pure concat, no array, no join.
   A unit completes at the SECOND ။ core (suffix stripped before the
   test, so a ။ inside a masked {...} span can't split early). \n
   becomes a " √" barrier (never a boundary). Trailing fragment
   without two stops still emits at EOF; a barrier-only tail is out. */
export async function* fullstopHolder(seg) {
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


