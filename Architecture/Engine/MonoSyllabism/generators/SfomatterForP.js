


export async function* toLineStrings(seg) {
	let line = "";
	for await (const item of seg) {
		if (item === "\n") {
			yield line;
			line = "";
			continue;
		}
		if (typeof item !== "string") continue;
		line += item;
	}
	if (line.length) yield line;
}