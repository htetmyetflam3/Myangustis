






















import { OutputFile } from "../_path.js";

import { bridgeStart, bridgeEnd, bridgeLineCount, getDateTimeHash } from "../bridge/logen.js";

import { runRuleEngine } from "../bridge/Ginit.js";

import { createStreamWriter, setHash } from "../MonoSyllabism/utilities/disk.js";
import { getFlushLines } from "../MonoSyllabism/utilities/buffer.js";
import {
	toBurmeseLine,
	toBurmeseLineWithPos,
	toIdsLineWithPos,
	toIdMapperLine,
	toIdMergedLine,
} from "../MonoSyllabism/utilities/formatter.js";
import { burmeseToId } from "../MonoSyllabism/generators/idmap.js";
import { fullstopHolder } from "../MonoSyllabism/generators/pos-input.js";
import { toLineStrings } from "../MonoSyllabism/generators/SfomatterForP.js";
import { runTagger } from "../MonoSyllabism/main/phoneme/phonology.js";

class Hook {
	constructor(name) {
		this.name = name;
		this.taps = [];
	}
	tap(fn) {
		this.taps.push(fn);
	}
	async call(data) {
		for (const fn of this.taps) {
			await fn(data);
		}
	}
}

class BridgeHooks {
	constructor() {
		this.syllable = new Hook("syllable");
		this.rawPos = new Hook("rawPos");


		this.ids = new Hook("ids");
		this.idMapper = new Hook("idMapper");
		this.idMerged = new Hook("idMerged");
	}
}




















export function receiveCallerHash(callerHash) {
	setHash(callerHash);
	return callerHash;
}

export function receiveInternalHash() {
	const innerHash = getDateTimeHash();
	setHash(innerHash);
	return innerHash;
}

export async function bridge(seg, writeFlags, sessionHash, inputPath) {
	bridgeStart({ file: inputPath, hash: sessionHash });

	const flushLines = getFlushLines(inputPath);
	const hooks = new BridgeHooks();
	const writers = {};
	let lineCount = 0;

	if (writeFlags.syllable) {
		writers.syllable = createStreamWriter(OutputFile(), "syllable", flushLines);
		hooks.syllable.tap((line) => {
			writers.syllable.writeLine([toBurmeseLine(line)]);
		});
	}

	if (writeFlags.rawPos) {
		writers.rawPos = createStreamWriter(OutputFile(), "raw_pos", flushLines);
		hooks.rawPos.tap((line) => {
			writers.rawPos.writeLine([
				toBurmeseLineWithPos(line, "rawPos"),
			]);
		});
	}

	const unitGen = fullstopHolder(seg);
	const taggerGen = runTagger(unitGen, sessionHash);
	const kernelGen = runRuleEngine(taggerGen, sessionHash);

	for await (const lineResult of kernelGen) {
		await hooks.syllable.call(lineResult);
		await hooks.rawPos.call(lineResult);

		lineCount++;
		bridgeLineCount(1);
	}

	const paths = {};
	for (const [name, writer] of Object.entries(writers)) {
		writer.flush();
		paths[`${name}Path`] = writer.close();
	}

	bridgeEnd({ file: inputPath, lineCount });

	return {
		syllablePath: paths.syllablePath ?? null,
		rawPosPath: paths.rawPosPath ?? null,
		lineCount,
		hash: sessionHash,
	};
}





















export async function bridgeDebug(seg, _writeFlags, sessionHash, inputPath) {
	bridgeStart({ file: inputPath, hash: sessionHash });

	const flushLines = getFlushLines(inputPath);
	const hooks = new BridgeHooks();
	const writers = {};
	let lineCount = 0;

	writers.syllable = createStreamWriter(OutputFile(), "syllable", flushLines);
	hooks.syllable.tap((line) => {
		writers.syllable.writeLine([toBurmeseLine(line)]);
	});

	writers.rawPos = createStreamWriter(OutputFile(), "raw_pos", flushLines);
	hooks.rawPos.tap((line) => {
		writers.rawPos.writeLine([toBurmeseLineWithPos(line, "rawPos")]);
	});

	writers.ids = createStreamWriter(OutputFile(), "ids", flushLines);
	hooks.ids.tap((line) => {
		writers.ids.writeLine([toIdsLineWithPos(line)]);
	});

	writers.idMapper = createStreamWriter(OutputFile(), "id_mapper", flushLines);
	hooks.idMapper.tap((line) => {

		writers.idMapper.writeLine([
			toIdMapperLine(line, (s) => burmeseToId(s) ?? s),
		]);
	});

	writers.idMerged = createStreamWriter(OutputFile(), "id_merged", flushLines);
	hooks.idMerged.tap((line) => {
		writers.idMerged.writeLine([toIdMergedLine(line)]);
	});

	const unitGen = fullstopHolder(seg);
	const taggerGen = runTagger(unitGen, sessionHash);
	const kernelGen = runRuleEngine(taggerGen, sessionHash);

	for await (const lineResult of kernelGen) {
		await hooks.syllable.call(lineResult);
		await hooks.rawPos.call(lineResult);
		await hooks.ids.call(lineResult);
		await hooks.idMapper.call(lineResult);
		await hooks.idMerged.call(lineResult);

		lineCount++;
		bridgeLineCount(1);
	}

	const paths = {};
	for (const [name, writer] of Object.entries(writers)) {
		writer.flush();
		paths[`${name}Path`] = writer.close();
	}

	bridgeEnd({ file: inputPath, lineCount });

	return {
		syllablePath: paths.syllablePath ?? null,
		rawPosPath: paths.rawPosPath ?? null,
		idsPath: paths.idsPath ?? null,
		idMapperPath: paths.idMapperPath ?? null,
		idMergedPath: paths.idMergedPath ?? null,
		lineCount,
		hash: sessionHash,
	};
}









export async function bridgeSyllable(seg, writeFlags, sessionHash, inputPath) {
	bridgeStart({ file: inputPath, hash: sessionHash });

	const flushLines = getFlushLines(inputPath);
	let syllablePath = null;
	let lineCount = 0;

	if (writeFlags.syllable) {
		const writer = createStreamWriter(OutputFile(), "syllable", flushLines);
		lineCount = await writer.consumeSyllable(seg);
		syllablePath = writer.close();
	} else {

		for await (const line of toLineStrings(seg)) {
			if (typeof line === "string") lineCount++;
		}
	}

	bridgeLineCount(lineCount);
	bridgeEnd({ file: inputPath, lineCount });

	return { syllablePath, rawPosPath: null, lineCount, hash: sessionHash };
}
