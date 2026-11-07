#!/usr/bin/env node
// Staged-parse experiment for the "outside first, decompress later" shape:
//
//   Phase 1 (no stream is opened): scan object dictionaries only, walk the
//     page tree, and build a small plan per page: page ref, content ref,
//     an interned MediaBox id (one canonical copy per distinct box), and a
//     font-context fingerprint (font object -> descendant -> descriptor ->
//     embedded font file, plus ToUnicode / Encoding / CIDToGIDMap refs).
//   Phase 2 (decompress on demand): walk pages in order. The first page of
//     a font context builds its decoding tables (decompresses ToUnicode
//     once); every later page with the same fingerprint reuses them.
//     Glyph codes whose ToUnicode entry is missing or whitespace-only
//     are collected per context as "blind" GIDs -- the one place the
//     vector-repair stage would run,
//     at most once per font context, never per page.
//
//   node B.Parser/samples/staged-font-context.mjs [input.pdf]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openPdfScannedObjects } from "../core/pdf/pdf-objects.js";
import { getStream, parseToUnicodeStream } from "../core/io/read.js";

const keyOf = (num, gen) => `${num},${gen}`;
const refOf = (key) => key.replace(",", " ") + " R";
const splitKey = (key) => key.split(",").map(Number);

function fieldRef(text, name) {
  const m = new RegExp(`/${name}\\s+\\[?\\s*(\\d+)\\s+(\\d+)\\s+R`).exec(text);
  return m ? keyOf(m[1], m[2]) : null;
}
function fieldName(text, name) {
  const m = new RegExp(`/${name}\\s*/([A-Za-z0-9+._-]+)`).exec(text);
  return m ? m[1] : null;
}
function fieldRefs(text) {
  return [...text.matchAll(/(\d+)\s+(\d+)\s+R/gu)].map((m) => keyOf(m[1], m[2]));
}

// Small, disposable summary of one object's dictionary. Raw dictionary text
// is thrown away as soon as the summary is taken.
function summarize(key, text) {
  const type = fieldName(text, "Type");
  const base = { key, type };
  if (type === "Catalog") return { ...base, pagesRef: fieldRef(text, "Pages") };
  if (type === "Pages") {
    return {
      ...base,
      kids: fieldRefs(/\/Kids\s*\[([^\]]*)\]/u.exec(text)?.[1] ?? ""),
      mediaBox: /\/MediaBox\s*(\[[^\]]*\])/u.exec(text)?.[1]?.replace(/\s+/gu, " ").trim() ?? null,
    };
  }
  if (type === "Page") {
    const fontAt = text.indexOf("/Font");
    const segment = fontAt < 0 ? "" : text.slice(fontAt, (text.indexOf(">>", fontAt) + 2) || undefined);
    const contentsRef = fieldRef(text, "Contents") ?? fieldRefs(/\/Contents\s*\[([^\]]*)\]/u.exec(text)?.[1] ?? "")[0] ?? null;
    return {
      ...base,
      parentRef: fieldRef(text, "Parent"),
      mediaBox: /\/MediaBox\s*(\[[^\]]*\])/u.exec(text)?.[1]?.replace(/\s+/gu, " ").trim() ?? null,
      rotate: /\/Rotate\s+(-?\d+)/u.exec(text)?.[1] ?? null,
      contentsRef,
      fontSlots: [...segment.matchAll(/\/([A-Za-z0-9]+)\s+(\d+)\s+(\d+)\s+R/gu)]
        .map((m) => ({ slot: m[1], fontRef: keyOf(m[2], m[3]) })),
    };
  }
  if (type === "Font" || fieldName(text, "Subtype") === "CIDFontType2") {
    return {
      ...base,
      subtype: fieldName(text, "Subtype"),
      baseFont: fieldName(text, "BaseFont"),
      encodingRef: fieldRef(text, "Encoding"),
      encodingName: fieldName(text, "Encoding"),
      toUnicodeRef: fieldRef(text, "ToUnicode"),
      descendantRef: fieldRef(text, "DescendantFonts"),
      descriptorRef: fieldRef(text, "FontDescriptor"),
      cidToGidMap: fieldName(text, "CIDToGIDMap"),
    };
  }
  if (type === "FontDescriptor") {
    return {
      ...base,
      fontName: fieldName(text, "FontName"),
      fontFileRef: fieldRef(text, "FontFile2") ?? fieldRef(text, "FontFile3") ?? fieldRef(text, "FontFile"),
    };
  }
  return base;
}

export function buildOutsidePlan(objects) {
  const nodes = new Map();   // pages-tree nodes + catalog
  const fontSummaries = new Map();
  const descriptors = new Map();
  const pageSummaries = [];
  for (const [key, dict] of objects) {
    const text = Buffer.from(dict).toString("latin1");
    const s = summarize(key, text);
    if (s.type === "Catalog" || s.type === "Pages") nodes.set(key, s);
    else if (s.type === "Page") pageSummaries.push(s);
    else if (s.type === "FontDescriptor") descriptors.set(key, s);
    else if (s.type === "Font" || s.subtype === "CIDFontType2") fontSummaries.set(key, s);
  }

  // Resolve each font object's chain once: font -> (descendant) ->
  // descriptor -> embedded font file. The fingerprint is these refs plus
  // the decoding-map refs; pages sharing it share one GID world.
  const fonts = new Map();
  for (const [key, f] of fontSummaries) {
    if (f.type !== "Font") continue; // skip CIDFont descendants themselves
    const descendant = f.descendantRef ? fontSummaries.get(f.descendantRef) : null;
    const descriptorKey = f.descriptorRef ?? descendant?.descriptorRef ?? null;
    const descriptor = descriptorKey ? descriptors.get(descriptorKey) : null;
    const detail = {
      fontRef: key,
      subtype: f.subtype ?? null,
      baseFont: f.baseFont ?? null,
      encoding: f.encodingName ?? (f.encodingRef ? `ref ${refOf(f.encodingRef)}` : null),
      toUnicodeRef: f.toUnicodeRef ?? null,
      cidFontRef: f.descendantRef ?? null,
      descriptorRef: descriptorKey,
      fontFileRef: descriptor?.fontFileRef ?? null,
      cidToGidMap: descendant?.cidToGidMap ?? f.cidToGidMap ?? null,
    };
    detail.fingerprint = [
      detail.fontRef, detail.subtype, detail.baseFont, detail.encoding,
      detail.toUnicodeRef, detail.cidFontRef, detail.descriptorRef,
      detail.fontFileRef, detail.cidToGidMap,
    ].join("|");
    fonts.set(key, detail);
  }

  // Page order from the tree; MediaBox inherited through /Pages nodes and
  // interned: one canonical entry per distinct box value.
  const catalog = [...nodes.values()].find((n) => n.type === "Catalog");
  const orderedRefs = [];
  (function walk(key) {
    if (!key) return;
    const node = nodes.get(key);
    if (!node) { orderedRefs.push(key); return; } // a Page (not kept in nodes)
    for (const kid of node.kids ?? []) walk(kid);
  })(catalog?.pagesRef);
  const byRef = new Map(pageSummaries.map((p) => [p.key, p]));
  const inheritedBox = (page) => {
    let box = page.mediaBox;
    let cursor = page;
    while (!box && cursor?.parentRef) {
      cursor = nodes.get(cursor.parentRef) ?? byRef.get(cursor.parentRef);
      box = cursor?.mediaBox ?? null;
    }
    return box;
  };

  const boxIds = new Map();
  const boxes = [];
  const fontTables = new Map();
  const pages = orderedRefs.filter((ref) => byRef.has(ref)).map((ref, i) => {
    const page = byRef.get(ref);
    const boxValue = inheritedBox(page) ?? "[unknown]";
    if (!boxIds.has(boxValue)) { boxIds.set(boxValue, boxes.length); boxes.push({ id: boxes.length, value: boxValue, pages: 0 }); }
    const boxId = boxIds.get(boxValue);
    boxes[boxId].pages += 1;
    const slots = page.fontSlots.map(({ slot, fontRef }) => {
      const detail = fonts.get(fontRef);
      const fingerprint = detail?.fingerprint ?? fontRef;
      if (!fontTables.has(fingerprint)) {
        fontTables.set(fingerprint, { id: fontTables.size, ...detail, pages: 0 });
      }
      const table = fontTables.get(fingerprint);
      table.pages += 1;
      return { slot, fontRef, fontId: table.id, fingerprint };
    });
    return {
      page: i + 1,
      ref,
      contentsRef: page.contentsRef,
      boxId,
      rotate: page.rotate ?? "0",
      fonts: slots,
      // Resource order in the dictionary is not meaningful (/F2 may be
      // listed before /F1); the context key must be canonical or the same
      // context would be rebuilt as a "new" one.
      contextId: [...slots].sort((a, b) => a.slot.localeCompare(b.slot))
        .map((s) => `${s.slot}=${s.fingerprint}`).join(";"),
    };
  });

  return {
    pageCount: pages.length,
    pages,
    boxes,
    fontTables: [...fontTables.values()],
    pageContexts: [...new Set(pages.map((p) => p.contextId))].length,
  };
}

// Extract Type0 (CID) glyph codes from one decompressed content stream,
// tracking which resource font is active at each text-showing operation.
function pageCids(contentText, cidSlots) {
  const cids = [];
  let current = null;
  const token = /\/(F\d+)\s+[\d.]+\s+Tf|<([0-9A-Fa-f]+)>|\((?:\\.|[^\\()])*\)/gu;
  let m;
  while ((m = token.exec(contentText)) !== null) {
    if (m[1]) { current = m[1]; continue; }
    if (m[2] && current && cidSlots.has(current)) {
      const hex = m[2];
      for (let i = 0; i + 4 <= hex.length; i += 4) cids.push([current, parseInt(hex.slice(i, i + 4), 16)]);
    }
  }
  return cids;
}

export function runStagedParse(source, { repairStage = null, maxPages = Infinity } = {}) {
  const { objects, close } = openPdfScannedObjects(source);
  try {
    const plan = buildOutsidePlan(objects);
    const stats = {
      pageCount: plan.pageCount,
      uniqueBoxes: plan.boxes.length,
      uniqueFontTables: plan.fontTables.length,
      uniquePageContexts: plan.pageContexts,
      contextBuilds: 0,
      contextSwitches: 0,
      pagesReusingContext: 0,
      toUnicodeDecompressed: 0,
      contentStreamsOpened: 0,
      glyphCodes: 0,
      decodedChars: 0,
      myanmarChars: 0,
      blindGids: 0,
      vectorRepairCalls: 0,
      contexts: [],
    };
    const cache = new Map(); // contextId -> { tables, blind:Set, repair }
    let previousContext = null;
    const textParts = [];

    for (const page of plan.pages.slice(0, maxPages)) {
      let ctx = cache.get(page.contextId);
      if (!ctx) {
        // First page of this font context: build its tables once.
        ctx = { tables: new Map(), blind: new Set(), repair: null, vectorRepairArmed: true };
        for (const slot of page.fonts) {
          const detail = plan.fontTables.find((t) => t.id === slot.fontId);
          if (!detail?.toUnicodeRef) continue;
          const bytes = getStream(objects, ...splitKey(detail.toUnicodeRef));
          if (bytes) {
            ctx.tables.set(slot.slot, parseToUnicodeStream(bytes));
            stats.toUnicodeDecompressed += 1;
          }
        }
        cache.set(page.contextId, ctx);
        stats.contextBuilds += 1;
        stats.contexts.push({
          context: stats.contexts.length,
          firstPage: page.page,
          fonts: page.fonts.map((s) => {
            const d = plan.fontTables.find((t) => t.id === s.fontId);
            return `${s.slot}->${refOf(d.fontRef)} ${d.subtype}/${d.baseFont} `
              + `ToUnicode=${d.toUnicodeRef ? refOf(d.toUnicodeRef) : "none"} `
              + `fontFile=${d.fontFileRef ? refOf(d.fontFileRef) : "none"}`;
          }),
        });
      }
      if (page.contextId === previousContext) stats.pagesReusingContext += 1;
      else stats.contextSwitches += 1;
      previousContext = page.contextId;

      if (!page.contentsRef) continue;
      const content = getStream(objects, ...splitKey(page.contentsRef));
      if (!content) continue;
      stats.contentStreamsOpened += 1;
      const cidSlots = new Set(page.fonts.filter((s) => ctx.tables.has(s.slot)).map((s) => s.slot));
      const text = content.toString("latin1");
      for (const [slot, cid] of pageCids(text, cidSlots)) {
        stats.glyphCodes += 1;
        const hit = ctx.tables.get(slot)?.get(cid);
        if (hit !== undefined && hit.trim() !== "") {
          stats.decodedChars += [...hit].length;
          stats.myanmarChars += [...hit].filter((ch) => {
            const cp = ch.codePointAt(0);
            return cp >= 0x1000 && cp <= 0x109f;
          }).length;
          textParts.push(hit);
        } else if (ctx.repair?.byGid?.has(cid)) {
          textParts.push(ctx.repair.byGid.get(cid));
        } else {
          // Blind GID: no ToUnicode entry, or one that maps to whitespace
          // only (the same condition pdf-fonts.js treats as unresolved).
          // Vector repair is the stage that could recover it from the
          // embedded font's outlines -- armed once per context, not per page.
          if (!ctx.blind.has(cid)) ctx.blind.add(cid);
          if (ctx.vectorRepairArmed && repairStage) {
            stats.vectorRepairCalls += 1;
            ctx.repair = repairStage(page, ctx, objects) ?? null;
            ctx.vectorRepairArmed = false; // at most once per context
          }
        }
      }
    }
    stats.blindGids = [...cache.values()].reduce((n, c) => n + c.blind.size, 0);
    return { plan, stats, textSample: textParts.join("").slice(0, 400) };
  } finally {
    close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const input = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..",
      "F.Site", "Frontend", "frontend-bootstrap", "public", "samples", "sample.pdf");
  const { plan, stats, textSample } = runStagedParse(input);
  console.log("PHASE 1 (outside only, no stream opened)");
  console.log(`  pages              : ${stats.pageCount}`);
  console.log(`  unique MediaBoxes  : ${stats.uniqueBoxes} ${JSON.stringify(plan.boxes.map((b) => [b.value, b.pages]))}`);
  console.log(`  unique font tables : ${stats.uniqueFontTables}`);
  for (const t of plan.fontTables) {
    console.log(`    font ${refOf(t.fontRef)} ${t.subtype}/${t.baseFont} encoding=${t.encoding} `
      + `ToUnicode=${t.toUnicodeRef ? refOf(t.toUnicodeRef) : "none"} fontFile=${t.fontFileRef ? refOf(t.fontFileRef) : "none"} pages=${t.pages}`);
  }
  console.log("PHASE 2 (decompress per page, tables cached by font context)");
  console.log(`  context builds (tables built once) : ${stats.contextBuilds}`);
  console.log(`  context switches                   : ${stats.contextSwitches}`);
  console.log(`  pages reusing previous context     : ${stats.pagesReusingContext}`);
  console.log(`  ToUnicode streams decompressed     : ${stats.toUnicodeDecompressed}`);
  console.log(`  content streams opened             : ${stats.contentStreamsOpened}`);
  console.log(`  CID glyph codes seen               : ${stats.glyphCodes} (${stats.decodedChars} chars via ToUnicode, ${stats.myanmarChars} Myanmar)`);
  console.log(`  blind GIDs (vector-repair stage)   : ${stats.blindGids} candidates, repair calls=${stats.vectorRepairCalls}`);
  console.log(`  decoded sample: ${JSON.stringify(textSample.slice(0, 120))}`);
}
