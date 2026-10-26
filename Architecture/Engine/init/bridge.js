// NATIVE engine bridge — the terminal pipeline routines, cut out of
// Bridge/bridge.js and embedded beside their only native caller (init/cli.js).
//
//   bridge()          POS tagger path: fullstopHolder -> runTagger ->
//                     runRuleEngine, dual syllable/raw_pos stream writers.
//   bridgeDebug()     the Staging_architecture five-output debug form,
//                     preserved as a rare-event safety net: the SAME chain
//                     as bridge() including the pass-through runRuleEngine
//                     kernel, plus the runIdMapper observability stage that
//                     taps three extra id views. All five files are always
//                     written — hardcoded, no write flags (the old flags were
//                     only a convenience while the mapping was unstable).
//   bridgeSyllable()  syllable-only segmenting path: the writer consumes the
//                     segmentor generator directly; tagger and rule engine
//                     are never constructed.
//
// MonoSyllabism imports are real (intra-engine, move with this file).
// The merged-Bridge modules resolved here permanently: the engine owns its
// whole bridge under architecture/bridge/ — logen.js (report-first logger +
// getDateTimeHash), Ginit.js (pass-through rule kernel) and path.js (the
// workspace contract) are real siblings, not top-level Bridge placeholders.

// Engine bridge path contract (architecture/bridge/path.js).
import { OutputFile } from "../bridge/path.js";
// Report-first logger + the internal datetime hash minter.
import { bridgeStart, bridgeEnd, bridgeLineCount, getDateTimeHash } from "../bridge/logen.js";
// Rule-engine kernel — pass-through today (architecture/bridge/Ginit.js).
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
		// Debug-only observability taps (the runIdMapper stage); bridge()
		// never taps them, so production pays nothing.
		this.ids = new Hook("ids");
		this.idMapper = new Hook("idMapper");
		this.idMerged = new Hook("idMerged");
	}
}

/* ── Hash receiving — TWO explicit entry modes, no implicit fallback ──────
   The boundary validates before the bridge is ever reached, so a receiver
   never re-validates and never mints on the wrong path:

   receiveCallerHash()  API invocation (standalone-web /job, api-server).
                        The express layer already gated the key + the seven
                        metadata fields + jobToken uniqueness, and runMain()
                        already ran hashKind() on the id. Bridge therefore
                        TRUSTS the caller hash as-is: outputs land as
                        segmented_{callerHash}_*. No minting on this path.

   receiveInternalHash() Library invocation — the bridge imported directly by
                        another module (proofreading, …) with no caller id.
                        The engine owns the session and injects its own
                        inner-state datetime hash (logen.getDateTimeHash).

   Both call setHash() because createStreamWriter reads the session at
   construction time (segmented_{hash}_syllable/raw_pos.txt). The core
   routines below only ever consume an already-resolved hash. */
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

/* Debug sibling of bridge() — the Staging_architecture five-output form
   (linga PR #21/#23 Syllable.initS.js runMainPipeline type "pos"), kept as a
   rare-event mapping-inspection safety net rather than a daily routine.

   Chain is IDENTICAL to bridge(): fullstopHolder -> runTagger ->
   runRuleEngine (the same pass-through kernel — both path-A forms include
   it). What differs is the runIdMapper observability stage after the kernel:
   three extra taps render the id views, so all FIVE files are produced:

     segmented_<hash>_syllable.txt   Burmese flat syllables (toBurmeseLine)
     segmented_<hash>_raw_pos.txt    Burmese merged word + pos (toBurmeseLineWithPos)
     segmented_<hash>_ids.txt        merged word id + pos (toIdsLineWithPos)
     segmented_<hash>_id_mapper.txt  id per syllable, no pos (toIdMapperLine)
     segmented_<hash>_id_merged.txt  merged id, no pos (toIdMergedLine)

   Hardcoded five outputs — writeFlags is deliberately ignored. The old
   writeSyllable/writePos gates existed only while mapping alignment was
   being debugged file by file; the flow is stable now, and keeping the
   renderers here means a future inspection never rewrites the pipeline.
   Return shape extends bridge() with the three id paths. */
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
		// Staging runIdMapper behavior: unmapped surfaces pass through.
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

/* Syllable-only sibling of bridge(). Thin by design: the writer consumes
   the segmentor generator directly (disk.js consumeSyllable, formatting in
   formatter.js) — the tagger and the rule engine are never constructed.
   Assembly differs on purpose: \n lines here vs two-fullstop units in
   bridge() (fullstopHolder) — the tagger needs sentence boundaries, the
   syllable file mirrors input lines. Chosen by flag in runMain(), so this
   is not a second pass — it is the only pass when POS was not asked
   for. Whitespace is filtered in toSyllableLine and only there. */
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
		/* No writer: still drain the segmentor so lineCount stays honest. */
		for await (const line of toLineStrings(seg)) {
			if (typeof line === "string") lineCount++;
		}
	}

	bridgeLineCount(lineCount);
	bridgeEnd({ file: inputPath, lineCount });

	return { syllablePath, rawPosPath: null, lineCount, hash: sessionHash };
}
