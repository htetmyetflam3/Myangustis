/**
 * idmap.js — the ASCII↔Burmes↔ID converter tables.
 *
 * Moved from MonoSyllabism/map/base/idmapper.js (map/base/ deleted: the map
 * dir holds only generated artifacts now). Loads once, lazily, from
 * File/.tree/syllable.mapped.txt written by the build phase. Row parsing
 * goes through Tree.loaded.loadMappedRows — the single home for that file.
 */

import { TreeFile } from "../../bridge/path.js";
import { loadMappedRows } from "../main/grapheme/Tree.loaded.js";

let _asciiToId = null;
let _idToAscii = null;
let _burmeseToId = null;
let _idToBurmese = null;

function loadMappings() {
	if (_asciiToId) return;

	_asciiToId = new Map();
	_idToAscii = new Map();
	_burmeseToId = new Map();
	_idToBurmese = new Map();

	const rows = loadMappedRows(TreeFile());
	if (!rows) {
		console.warn(`[syllableToID] Not found: ${TreeFile()}/syllable.mapped.txt`);
		return;
	}

	for (const { burmese, ascii, id } of rows) {
		if (ascii && id) {
			_asciiToId.set(ascii, id);
			_idToAscii.set(id, ascii);
		}
		if (burmese && id) {
			_burmeseToId.set(burmese, id);
			_idToBurmese.set(id, burmese);
		}
	}

	console.log(
		`[syllableToID] Loaded ` +
		`${_asciiToId.size} ascii→id, ` +
		`${_idToBurmese.size} id→burmese`
	);
}

/** Burmese surface → tree id (null when unmapped). */
export function burmeseToId(syllable) {
	if (!syllable) return null;
	loadMappings();
	return _burmeseToId.get(syllable) ?? null;
}

/** ASCII key-string → tree id (null when unmapped). */
export function asciiToId(ascii) {
	if (!ascii) return null;
	loadMappings();
	return _asciiToId.get(ascii) ?? null;
}

/** Tree id → Burmese surface (null when unknown). */
export function idToBurmese(id) {
	if (!id) return null;
	loadMappings();
	return _idToBurmese.get(id) ?? null;
}

/** Tree id → ASCII key-string (null when unknown). */
export function idToAscii(id) {
	if (!id) return null;
	loadMappings();
	return _idToAscii.get(id) ?? null;
}
