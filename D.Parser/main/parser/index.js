/**
 * FILE: Parsed/parser/index.mjs
 *
 * THE FRONT DOOR. Everything outside Parsed/parser/ imports from here and
 * nothing else, so the inside is free to move without breaking the site.
 *
 * The layers below are an order, not a pile. Each one may only reach DOWN:
 *
 *   core/      no dependencies. paths, limits, pylib shims, zip, qpdf,
 *              the TTF cmap reader, the log contract. Anyone may read it.
 *   read/      container -> text + geometry. PDF, DOCX, OCR. Never writes.
 *   shape/     pure glyph geometry. svg (reference) | raster (page) | match.
 *   codepage/  which byte means which letter, for legacy fonts.
 *              ONE door: codepage/resolve.mjs.
 *   text/      bytes -> correct Unicode. detect, rabbit, cleanup, normalize,
 *              score, repair, scan.
 *   write/     text -> .txt / .docx / .pdf.
 *   pipeline   assembly only: wires the stages, owns no logic of its own.
 *   manager    the only entry: worker/lane supervision for the site.
 *   manager    process/worker supervision for the site.
 *   worker/    thread entry points. Shells only -- no logic lives here.
 *
 * Full map, including which names are load-bearing and which only look it:
 * Parsed/parser/ARCHITECTURE.md
 */

/* ── supervised/worker execution, used by the site backend ── */
export { Manager } from "./manager.mjs";

/* ── writers, used directly when the text is already in hand ── */
export { writeDocxPlain, writeDocxLayout, writePdf } from "./write/render.mjs";

/* ── log sinks: pass one in instead of inventing a callback ── */
export { SILENT, collect, stdoutLog, tee, resolveLog } from "./core/log.mjs";
