# JS → Python parser audit

Reference: JS commit `67f02845bcd266ff764fcc167a3337626eb1c75f`; Python branch based on `73a46d583983bb9a56aff9fd87927c077118c3fb`, with the changes in this checkout. Scope: the JS `B.Parser/convert.js` → `InitInput` → `parseDecoding` → `writeOutputFile` path, plus separately exported parser helpers and the Python SSH/OCR runners. The website, cookie/database/gateway and Engine are **not** claimed as mirrored.

This is a file-by-file **inventory and call-path review**, supplemented by the tests named below. It is not a proof that every branch or every PDF, DOCX, output or recognition result matches. A counterpart is not necessarily a port of every export. JS imports do not by themselves prove a function is called; in particular the external DOCX and repair functions are not called by the `convert` path reviewed here. Conditional OCR and preparation paths execute only when their inputs require them.

Legend: **T** = selected cases compared with pinned JS; **P** = Python counterpart exists but no comprehensive differential verification, or a known difference exists; **N** = no corresponding Python implementation or not used in the normal conversion path. T is evidence for the tested cases only. JS paths in the tables are relative to `B.Parser/architecture/`; Python paths are relative to the same directory.

## Front door

| JS file | Python counterpart / finding | Status |
|---|---|---|
| `B.Parser/index.js` | `entry/index.py` exports Python conversion and stage functions; contracts differ. | P |
| `B.Parser/convert.js` | `entry/index.py`, `entry/manager.py`; JS serializes conversions, performs preparation and returns writer metadata; Python has a different API/result and POS scan. | P |

## DOCX and OCR

| JS file | Python counterpart / finding | Status |
|---|---|---|
| `@core/docx/docx-external.js` | No Mammoth extractor; external-method helper is not called by `convert` → `parseDecoding`. | N |
| `@core/docx/docx-extract.js` | `extract/docx_extract.py`; paragraph, direct-font, run-formatting, image relationships and archive checks. XML tokenizer, malformed XML and ZIP edge cases remain different. | T/P |
| `@core/docx/source.js` | `workflow/pipeline.py`; 80-paragraph chunks, font-based UNKNOWN/Unicode behavior compared. | T/P |
| `@core/docx/zip.js` | Python `zipfile` plus `extract/docx_extract.py`; ZIP internals, ZIP64 and error behavior not identical. | P |
| `@core/ocr/ocr.js` | `workflow/ocr.py`, `entry/manager.py`; JS uses Tesseract.js, Python CLI. Recognition and availability behavior are not identical. Routing and mocked results compared. | T/P |
| `@core/ocr/read.js` | `entry/manager.py`; input sniffing and validation differ. | P |

## PDF instructions, resource decoding and pages

| JS file | Python counterpart / finding | Status |
|---|---|---|
| `@core/pdf/instructions.js` | `workflow/pipeline.py`, `extract/pdf_fonts.py`, `normalize/judgement.py`; page facts and stem verdicts precede content; no complete exported instruction renderer/API. | T/P |
| `@core/pdf/legacy-judgement.js` | `extract/legacy_judgement.py` (`decide_legacy_family`, candidate scoring and the mirrored absolute floor), wrapped by `extract/legacy_lane_score.decide_lane` and called by `extract/pdf_fonts.FontDecoder.settle_legacy_family` on the sample collected by `extract/pdf_extract._settle_legacy_families`. The Python wrapper's relative acceptance is an intentional extension; pinned JS has the judgement but no caller to diff against. | P |
| `@core/pdf/method/decoder.js` | `extract/pdf_fonts.py`; per-resource maps, CID behavior and synthetic differential. | T/P |
| `@core/pdf/method/legacy/codepage-confirmed.js` | `extract/pdf_fonts.py`; synthetic direct-decoder and extracted-page behavior compared. | T/P |
| `@core/pdf/method/legacy/codepage-names.js` | `resources/font_names.py`, bundled font names. | T/P |
| `@core/pdf/method/legacy/codepage-pooled.js` | Repair candidate evidence has no equivalent live Python repair path; not called by `convert`. Different question from the code page choice above: this one asks which *bytes* were witnessed for a font resource, never which table to read. | N |
| `@core/pdf/method/legacy/codepage-registry.js` | `extract/pdf_fonts.py`; Ayar and WinInnwa tables checked against JS. | T/P |
| `@core/pdf/method/legacy/codepage-subset.js` | `extract/pdf_fonts.py`, `resources/maps_data/legacy-subset-profiles.json`; 22 profiles and exact guards, not all real subsets tested. | T/P |
| `@core/pdf/method/legacy/codepage-visual.js` | `extract/pdf_visual.py` and bundled evidence; differential uses two witness fonts and synthetic runs. | T/P |
| `@core/pdf/method/legacy/fallback.js` | `extract/pdf_fonts.py`; selected fallback cases checked. | T/P |
| `@core/pdf/method/pdfencoding/decoding.js` | `extract/pdf_extract.py`, `extract/pdf_fonts.py`; stream, page and font extraction; synthetic full-PDF comparisons, not every operator/filter. | T/P |
| `@core/pdf/method/pdfencoding/encodings.js` | `extract/pdf_fonts.py`, bundled PDF encodings; selected mapping comparisons only. | T/P |
| `@core/pdf/method/unicode/cmap/cmap.js` | `extract/pdf_fonts.py`, `extract/pdf_extract.py`; synthetic ToUnicode, CMap and encodings. | T/P |
| `@core/pdf/method/unicode/ttf.js` | `extract/pdf_fonts.py`, `extract/ttf_gsub.py`; bounded caches and selected font-resource cases. | T/P |
| `@core/pdf/method/unicode/ttf/font.js` | Font table parsing in `extract/pdf_extract.py` and `extract/pdf_visual.py`; helper API/real font formats not comprehensively checked. | P |
| `@core/pdf/method/unicode/ttf/ttf-cmap.js` | `extract/pdf_extract.py`, `extract/pdf_visual.py`; two bundled witness fonts and synthetic cases. | T/P |
| `@core/pdf/method/unicode/ttf/ttf-gsub.js` | `extract/ttf_gsub.py`; 252 synthetic font comparisons, not all fonts/lookups. | T/P |
| `@core/pdf/method/values.js` | `extract/pdf_fonts.py`; syntax values, lexer and object parsing; malformed objects can differ. | T/P |
| `@core/pdf/pages/content.js` | `extract/pdf_extract.py`; length/filter handling compared in selected cases; Python holds page content in memory rather than spooling it. | T/P |
| `@core/pdf/pages/image.js` | `extract/pdf_image_coverage.py`; synthetic transforms, clips, inline images, forms, masks and inheritance compared. | T/P |
| `@core/pdf/pages/pages.js` | `extract/pdf_extract.py`; layout pieces and spread heuristics; Python does not use the JS disk-backed piece store. | T/P |

## Orchestration, storage and markup

| JS file | Python counterpart / finding | Status |
|---|---|---|
| `@core/requested.js` | `workflow/pipeline.py`, `output/render.py`; output shape, metadata and limits differ. | P |
| `@core/run.js` | `entry/manager.py`, `workflow/pipeline.py`; image-only PDF OCR routing and markup edge case tested; bare-image and DOCX OCR finalization need more comparison. | T/P |
| `@core/runtime/finalized-cmap.js` | `workflow/finish.py`, `normalize/cleanup.py`; synthetic PDF finishes compared; no file-backed streaming replacement. | T/P |
| `@core/runtime/finish.js` | `workflow/finish.py`, `workflow/pipeline.py`; selected PDF/DOCX records compared by `test_pdf_finish_js_parity.py` (312 samples, exact). JS threads an `applyCleanup` boolean through its finishing calls; the Python side does not — see "The cleanup flag is not part of the design". | T/P |
| `@core/runtime/json-map.js` | `resources/maps.py`, `resources/engine.py`; Python reads bundled JSON/Engine data in-process, loading APIs differ. | P |
| `@core/runtime/lexer.js` | `extract/pdf_fonts.py`, `extract/pdf_extract.py`; Python lexer reads in-memory bytes, not JS file lexer. | P |
| `@core/runtime/markup.js` | `output/markup.py`, `workflow/pipeline.py`; selected DOCX and OCR markup compared. | T/P |
| `@core/runtime/objects.js` | `extract/pdf_extract.py`; Python scans objects into memory, not JS's file-backed object store. | P |
| `@core/runtime/optimize.js` | `output/render.py` optionally uses pikepdf, not JS optimization; result/availability differ. | P |
| `@core/runtime/pdf-writer.js` | `output/render.py` uses fpdf2, not the JS PDF writer. | P |
| `@core/runtime/render.js` | `workflow/ocr.py` uses PDFium/Pillow, not PDF.js/canvas. Eight solid-fill geometry/crop comparisons are not pixel-parity for real pages. | T/P |
| `@core/runtime/source.js` | `workflow/pipeline.py`; stem/instruction routing, resource-local maps and selected synthetic PDFs tested; memory, metadata, reports and exported callbacks differ. | T/P |

## Input, helpers and preparation

| JS file | Python counterpart / finding | Status |
|---|---|---|
| `@entry/depency/service.js` | No JS-style socket-activated service; Python has independent runners/Flask. | N |
| `@entry/helper/collect.js` | `entry/manager.py`, `entry/index.py`; Python holds input bytes, not streamed temp spooling. | P |
| `@entry/helper/file-reader.js` | `entry/index.py`, `entry/manager.py`; not the same chunk-stream contract. | P |
| `@entry/helper/limit.js` | `entry/limits.py` and PDF extraction limits; caller/owner caps differ. | P |
| `@entry/helper/metadata.js` | `entry/index.py`, `entry/manager.py`; input detection/contracts differ. | P |
| `@entry/helper/validator.js` | `extract/docx_extract.py`, `extract/decrypt.py`; whole-DOCX safety checks now added, but JS validates headers and ZIP64 differently. | P |
| `@entry/init.js` | `entry/index.py`, `entry/manager.py`, `extract/decrypt.py`; Python has no equivalent fully streamed InitInput. | P |
| `@helper/provenance.js` | No matching JS provenance record API in normal Python conversion. | N |
| `@helper/pylib.js` | Native Python values plus local helpers; no exhaustive cross-language edge-case comparison. | P |
| `@helper/stream-replace.js` | No equivalent file-backed replacement pipeline; Python performs transformations in memory. | P |
| `@init/docx/read.js` | `extract/docx_extract.py`, `workflow/pipeline.py`; zip validation/extraction differs on edge cases. | P |
| `@init/pdf/helper/decrypt.js` | `extract/decrypt.py` uses pypdf instead of qpdf; encrypted and object-stream behavior can differ. | P |
| `@init/pdf/helper/split.js` | No JS-style `container.txt`/`content.txt` split or image-only prepare API; JS's normal `convert` continues with prepared PDF path. | N |
| `@init/pdf/pdf.js` | `extract/decrypt.py`, `workflow/pipeline.py`; preparation format and memory model differ. | P |

## Output

| JS file | Python counterpart / finding | Status |
|---|---|---|
| `@output/docx/write.js` | `output/render.py`, `output/markup.py`; Python writer is separate, DOCX XML/format parity not established. | P |
| `@output/helper/markup.js` | `output/markup.py`; selected markup behaviors, not exhaustive differential. | P |
| `@output/helper/output-fonts.js` | `output/fonts.py`; shared roles/data, separate renderer behavior. | P |
| `@output/helper/output-type.js` | `entry/manager.py`, `output/render.py`; extension defaults and result metadata differ. | P |
| `@output/helper/text-lines.js` | Python text iteration in `output/render.py`; not the same streaming interface. | P |
| `@output/io/render.js` | Compatibility output helpers in `output/render.py`; separate library implementations. | P |
| `@output/pdf/write.js` | `output/render.py`; fpdf2 vs JS writer, layout and bytes not verified equal. | P |

## Rules, scanning and separately exported repair

| JS file | Python counterpart / finding | Status |
|---|---|---|
| `@postprocess/beautify/beautify.js` | No equivalent token repair/beautification in the Python conversion path; not called by JS `convert`. | N |
| `@postprocess/beautify/clean.js` | `normalize/cleanup.py`; selected PDF finishing comparisons. | T/P |
| `@postprocess/beautify/zawcode-order.js` | `normalize/beautify.py`; selected page-decision/order behavior compared; JS repair APIs not ported. | T/P |
| `@postprocess/bind-engine.js` | `normalize/pos_scan.py` binds Python Engine in-process, not JS stream bridge; interface differs. | P |
| `@postprocess/init.js` | `normalize/scan.py`, `normalize/pos_scan.py`; selected structural/POS behavior, not comprehensive equivalence. | P |
| `@postprocess/repair/match.js` | No Python repair matcher; not called by JS `convert`. | N |
| `@postprocess/repair/raster.js` | No Python repair rasterizer; not called by JS `convert`. | N |
| `@postprocess/repair/repair.js` | No Python equivalent of full vector/POS repair; not called by JS `convert`. | N |
| `@postprocess/repair/svg/build-svg.js` | Build-time JS vector-index tool; no corresponding parser-runtime port. | N |
| `@postprocess/repair/svg/make-line.js` | No equivalent live repair line-SVG builder; not called by JS `convert`. | N |
| `@postprocess/repair/svg/scan-frame.js` | No equivalent live repair frame scanner; not called by JS `convert`. | N |
| `@postprocess/repair/svg/sheet.js` | No equivalent live repair sheet reader; not called by JS `convert`. | N |
| `@postprocess/repair/vote.js` | No equivalent live repair vote stage; not called by JS `convert`. | N |
| `@rule/detect.js` | `normalize/detector.py`, `resources/font_names.py`; selected font evidence comparisons. | T/P |
| `@rule/judgement.js` | `normalize/judgement.py`; selected instruction and page decisions compared. | T/P |
| `@rule/mm-score.js` | `normalize/mm_score.py`; used by finishing; not exhaustively verified. | P |
| `@rule/rabbit.js` | `normalize/rabbit.py`; used by differential finishes, not all strings checked. | T/P |
| `@rule/unicode-evidence.js` | **no Python counterpart** — deleted on request, 2026-11-20; see *"The regional wrapper"*. | — |

## Python-only surface and cross-checks

`entry/api.py`, `entry/cli.py`, `entry/prase.py`, `entry/interop.py`, `workflow/remote_queue.py`, `workflow/lane_log.py`, the launcher scripts and SSH ledger/Parquet/TXT collection are Python integration features; they are not proof of a one-to-one JS mirror. Package `__init__.py` files are wiring, not independent JS behavior. `normalize/legacy_order.py` and the historical evidence scripts have helper/draft functionality outside the pinned normal JS parse route. `output/fonts.py`, resource paths/maps, and Engine data access are Python-side implementations rather than Node subprocesses.

Evidence includes `test_decoder_js_parity.py`, `test_gsub_js_parity.py`, `test_visual_js_parity.py`, `test_pdf_finish_js_parity.py`, `test_pdf_stream_js_parity.py`, `test_pdf_image_coverage.py`, `test_pdf_ocr_js_parity.py`, `test_pdf_ocr_render.py` and `test_docx_js_parity.py`. JS is invoked by these tests only; production Python PDF decoding does not run JS or cache compiled JS. PDF OCR invokes the external Tesseract CLI. The PDF renderer oracle is optional and needs the exact JS rendering dependencies documented in `README.md`. Actual affected books and OCR recognition have not been compared to JS here.

### Python file index

These are the 47 Python files under `architecture/`; each is mapped individually so Python-only entry points are not mistaken for ports of a JS file. Package initializer rows denote wiring only.

| Python file | Closest JS responsibility / scope |
|---|---|
| `__init__.py` | Package wiring. |
| `entry/__init__.py` | Package wiring. |
| `entry/api.py` | Python Flask integration; no one-to-one JS core file. |
| `entry/cli.py` | Python CLI integration; no one-to-one JS core file. |
| `entry/index.py` | `B.Parser/index.js`, `B.Parser/convert.js`; different stage contract. |
| `entry/interop.py` | Python JSON job integration; no one-to-one JS core file. |
| `entry/limits.py` | `@entry/helper/limit.js`; owner and quota behavior differs. |
| `entry/manager.py` | `@core/run.js` plus Python entry/OCR orchestration; contracts differ. |
| `entry/prase.py` | Python CLI launcher. |
| `extract/__init__.py` | Package wiring. |
| `extract/decrypt.py` | `@init/pdf/helper/decrypt.js`; pypdf rather than qpdf. |
| `extract/docx_extract.py` | `@core/docx/docx-extract.js`, `zip.js`, and part of DOCX validation. |
| `extract/legacy_lane_score.py` | Python-only: the boss call that decides WinInnwa or Ayar for a face the name gate cannot name, importing mm-score, the scanner, the shared-glyph test and English-likeness; `extract/legacy_judgement.py` stays the mirrored scorer it wraps. |
| `extract/pdf_extract.py` | `@core/pdf/method/pdfencoding/decoding.js`, page content/pieces and object scanning; in-memory. |
| `extract/pdf_fonts.py` | PDF value lexer, resource loader, CMaps, font decoder, legacy code pages and subset profiles. |
| `extract/pdf_image_coverage.py` | `@core/pdf/pages/image.js`. |
| `extract/pdf_visual.py` | `@core/pdf/method/legacy/codepage-visual.js` and supporting TrueType glyph outlines. |
| `extract/ttf_gsub.py` | `@core/pdf/method/unicode/ttf/ttf-gsub.js`. |
| `normalize/__init__.py` | Package wiring. |
| `normalize/beautify.py` | Page-ordering subset of `@postprocess/beautify/zawcode-order.js`. |
| `normalize/cleanup.py` | `@postprocess/beautify/clean.js`. |
| `normalize/detector.py` | `@rule/detect.js`. |
| `normalize/judgement.py` | `@rule/judgement.js`. |
| `normalize/legacy_ascii.py` | Python repair for Latin letters standing in for Myanmar letters (legacy ASCII layouts). No JS counterpart and no `residue`/`ascii` idea anywhere in the pinned tree: it arrived with the recent diagnostics work, not with the mirror. Its own scan/report is kept; the **table** question it half-overlaps is answered by `extract/legacy_judgement.py`, which is from history. |
| `extract/legacy_judgement.py` | `@core/pdf/legacy-judgement.js`. |
| `normalize/legacy_order.py` | Python legacy visual order: `bind_leading_marks` is called for legacy-lane pages by `workflow/finish.py` (and by the extraction join for an unnamed bridge); the slot rules in the same module stay unwired. |
| `normalize/mm_score.py` | `@rule/mm-score.js`. |
| `normalize/pos_scan.py` | Parts of `@postprocess/init.js` and Engine binding; Python Engine API differs. |
| `normalize/rabbit.py` | `@rule/rabbit.js`, in memory rather than JS streaming. |
| `normalize/scan.py` | Structural scanning in `@postprocess/init.js`. |
| *(deleted)* `normalize/unicode_evidence.py` | was `@rule/unicode-evidence.js`. Removed 2026-11-20 — see *"The regional wrapper"*. |
| `output/__init__.py` | Package wiring. |
| `output/fonts.py` | `@output/helper/output-fonts.js`; separate writer/font library. |
| `output/markup.py` | `@core/runtime/markup.js`, `@output/helper/markup.js`. |
| `output/render.py` | `@output/docx/write.js`, `@output/pdf/write.js`, optional Python layout/optimization. |
| `resources/__init__.py` | Package wiring. |
| `resources/engine.py` | JS map/Engine-data access via `_path.js` and `@core/runtime/json-map.js`; in-process Python. |
| `resources/font_names.py` | `@core/pdf/method/legacy/codepage-names.js`, `@rule/detect.js`. |
| `resources/maps.py` | `@core/runtime/json-map.js`; separate resource loader. |
| `resources/paths.py` | Parser resource paths, analogous in purpose to JS `_path.js`. |
| `workflow/__init__.py` | Package wiring. |
| `workflow/finish.py` | `@core/runtime/finish.js`, `finalized-cmap.js`; not a full API clone. |
| `workflow/diagnostics.py` | Python opt-in PDF stage and segmentation diagnostics; no JS equivalent. |
| `workflow/lane_log.py` | Python diagnostic logging. |
| `workflow/ocr.py` | `@core/ocr/ocr.js`, `@core/runtime/render.js`; different OCR and rendering engines. |
| `workflow/pipeline.py` | `@core/runtime/source.js`, `@core/docx/source.js`, `@core/requested.js`; reports and storage differ. |
| `workflow/remote_queue.py` | Python SSH queues, ledger and output collection; no one-to-one JS core file. |

---

# Legacy decoding: what the files actually contain

Merged from the notes that used to live in `notes/bridge-order.md` and
`architecture/PAUSED.md`; those files are gone and this is their only home.

## The bridge is a key table, not text

A legacy face's `/ToUnicode` is not Myanmar text: each value is the **keyboard
key** of that glyph (`0x01 -> 'j'`, `0x0A -> 't'`, …). The layout turns a key
into a letter. Measured on the sample books:

| file | font | bridge entries | codes < 0x20 | wininnwa | ayar | zawcode |
|---|---|---|---|---|---|---|
| bg-mlc-1-1.pdf | `/EAAAAA+WinInnwa` | 105 | 31 | **104/104** | 89/104 | 0/104 |
| bg-mlc-2-5.pdf | `/EAAAAA+WinInnwa` | 113 | 31 | **112/113** | 95/113 | 0/113 |
| part-5.pdf | `/FCSSNP+Zawgyi-One` | 116 | 31 | 16/16 | 14/16 | 0/16 |

So `code -> ToUnicode key -> layout glyph` reads every code, including the
control range the hand-built tables skipped. The layout is chosen once per font
by key coverage — evidence about the font, not a score over its output.

## Two-byte tokens are visual order, not fused codes

In the page streams (`bg-mlc-1-1.pdf`, 41 pages) a two-byte token such as
`<0506>` is adjacency, and the order is visual:

| kind | count | example |
|---|---|---|
| mark + consonant | 3859 | `<0506>` `'ာ'`+`'သ'` → reads သာ |
| mark + mark | 3666 | `<0405>` `'်'`+`'ာ'` |
| stack glyph first | 205 | `<0809>` `'္ဒ'`+`'ါ'` |
| consonant + consonant | 17 | `<0607>` `'သ'`+`'ဒ'` |
| consonant + mark | 15 | `<0B09>` `'တ'`+`'ါ'` |

No byte arithmetic composes two codes into one; the relation is ordering.
`normalize/cleanup.order_text` reorders *marks among themselves* — it moves
`ေ` and the medials behind their base and nothing else — so the 3859
mark-then-base pairs stay exactly as the file wrote them. That is the shape of
the engine's normalize, not a gap in it: `A.Engine
MonoSyllabism/map/normalize.py` sorts a base's marks by `mapData.Priority`
(`reorderAndWrap`) and strips glue and imposters (`normalize`); it never moves a
mark across a base, because in Unicode a mark before its base is not a variant
of the right order, it is a missing base.

So this class is **decode-stage**, not finishing-stage, and the pass that used to
sit here (`legacy_order.bind_leading_marks`, called by the finish stage and by
the extraction join for an unnamed bridge) is deleted. It was an extra rule beside
the gate: it made `orphan` counts go to zero on synthetic pages and it had no
ancestor anywhere in JS — which is why the parity suite could only pass by
comparing `finished == bind_leading_marks(js)`. With it gone the 312-sample
comparison is exact again, and the surviving report of these pairs is the
scanner's `orphan` count: 19,754 on `Junk/parsed-books.txt`, of which the
leading characters after `order_text` are `ေ` 1,243 · `ိ` 887 · `ာ` 812 ·
`ျ` 576 · `ု` 505. A `ေ` still leading after ordering means `_opens_cluster`
found no base to move it behind — the base never arrived, i.e. an unmapped code
or a line that broke inside the cluster (root causes 2 and 3), not a rule
normalize failed to run.

`legacy_order`'s slot rules (`legacy_bases`, `reorder_legacy_slots`,
`reorder_zawcode_text`, `count_zawcode_evidence`) were tried on this class first
and fix none of it: they move the same `ေ`/`ြ` that `cleanup` already moves, so on
44,601 corpus lines they changed 15,846 and removed **zero** `orphan` or
`impossible` hits. They were **deleted** rather than left unwired, together with
their only readers, `tools-box/python/zawcode-gid-contexts.py` and
`zawcode-order-evidence.py` -- see "The legacy ordering rule does not exist in
either tree" below.

## Two tables, one default: which one a face was written for

The Ayar and WinInnwa tables share 109 slots and disagree on **92** of them, so
reading a face through the wrong table is not a rounding error — nine codes in
ten change meaning. Three answers exist for a face, in this order: a witnessed
resource profile (exact SHA over font program + /ToUnicode + code range), the
name (`legacy_font_family`, the pin the two hand-built tables were made for),
and — for an unnamed legacy face — a page-sample judgement. The Python caller
is `extract/pdf_extract._settle_legacy_families`; it collects the shown strings
for that resource and `FontDecoder.settle_legacy_family` temporarily reads the
same bounded sample through Ayar and WinInnwa. Short samples accumulate across
up to `PROBE_MAX_ATTEMPTS` (currently 3) attempts, subject to
`PROBE_SAMPLE_BYTES`. `extract/legacy_lane_score.decide_lane` applies the
relative ranking, minimum-mark rule and English penalty around the scorer in
`extract/legacy_judgement.py`; this is not the scorer's standalone absolute
0.85 floor. Ties keep the documented default, and the verdict pins a table to
that face only — it does not move the page between lanes.

The face record retains a bounded ledger: candidate marks, score/quality,
`impossible` and English evidence, `pagesAsked`, `pagesUsed`, `pagesFailed`, and
`zeroedForFewMarks`. With `PARSER_DIAGNOSTICS=on` and
`PARSER_LOG_ENABLED=on`, each evaluation emits a file-only `[PDFDIAG] codepage`
event. Page counts refer to distinct one-based PDF pages: asked pages showed
strings for this face, used pages remain in the capped sample, and failed pages
raised during a candidate decode. Candidate `pagesUsed` is zero when that
candidate's sample read failed. `zeroedForFewMarks` counts candidate evaluations
below the mark minimum, with counts by candidate. The event keeps counts and error
types, never the sample strings or exception messages.

Measured through the pipeline door on a two-face page (one named, one not, both
written in Ayar codes): `orphan` **96 → 0** and the glyphs change; the same page
with both names pinned is untouched, which is the control that says the probe
moved nothing it should not.

## Hand-built subset tables cannot generalise

`resources/maps_data/legacy-subset-profiles.json` holds 22 observed profiles
(20 ayar, 2 wininnwa) keyed by font SHA. Two findings limit them: the same font
SHA disagrees between that file and JS's `raw-byte-map.json` (1 of 11 witnessed
runs reproduce by concatenation), and both tables are printable-biased — the
code that carries `္ဒ` (`0x08`) and the virama positions (`0x13` in part-5) sit
below `0x20`, where the tables have almost nothing.

## Pause note (was `architecture/PAUSED.md`)

Ayar/WinInnwa layout selection is no longer paused for the bridge case — it is
implemented per font by key coverage. What remains open is the class where the
file carries **no** `/ToUnicode` at all (see below).

---

# Broken page collection

Every part was run through the full parser with its own logging, then through
the parser's own damage scanner (`normalize/scan.py`). This repository carries
the **logs and the damage reports**; the decoded txt is 20 MB the same command
regenerates, so it is not committed.

```bash
PARSER_LOG_ENABLED=1 PARSER_DIAGNOSTICS=1 PARSER_LOG_FILE=B.Parser/audit/parts/part-N.log \
  python B.Parser/main.py parse pdf-parts/part-N.pdf parts/part-N.txt
python -m myangustis_parser.normalize.scan parts/part-N.txt -o B.Parser/audit/scans/part-N.scan.txt
python B.Parser/tools/audit_overview.py --write        # the digest of everything above
```

`PARSER_LOG_ENABLED` writes the lane events; the per-page record needs
`PARSER_DIAGNOSTICS=1` as well, and the log is **appended to** — re-running a
part into a path that already holds a run doubles every event, which is exactly
what the committed logs do (see below).

## Source PDFs (branch `trash`, not in this repository)

| path on `trash` | blob | size | orphan hits |
|---|---|---|---|
| `pdf-parts/part-1.pdf` | `48decf9d31c2` | 33.3 MB | 9,528 |
| `pdf-parts/part-2.pdf` | `05449ff86223` | 47.0 MB | 26,798 |
| `pdf-parts/part-3.pdf` | `02bac26d6d7a` | 41.7 MB | 11,075 |
| `pdf-parts/part-4.pdf` | `26707f323f41` | 9.2 MB | 7,600 |
| `pdf-parts/part-5.pdf` | `ecf079d6f075` | 4.2 MB | 430 |
| `pdf-parts/part-6.pdf` | `c9f707041858` | 20.3 MB | 3,804 |
| `pdf-parts/part-7.pdf` | `90758cabeffd` | 20.0 MB | 75 |
| `pdf-parts/part-8.pdf` | `db9e8ad289b5` | 10.0 MB | 142 |
| `pdf-parts/part-9.pdf` | `bdd5073b43b9` | 12.5 MB | 586 |

Each part merges ~40 body pages of many source PDFs with one label page per
source carrying its file name, so the log's `book`/`page` and the scan's line
numbers attribute every defect to a book without extracting a PDF.

**Provenance, re-verified against `trash`.** The nine blobs and their byte sizes
above are the current ones (`git fetch --filter=blob:none --depth=1 origin trash`,
then `git rev-parse FETCH_HEAD:pdf-parts/part-1.pdf` = `48decf9d31c2…`,
`git ls-tree -l FETCH_HEAD -- pdf-parts/` = 33,336,410 / 46,988,465 / 41,681,489 /
9,241,853 / 4,159,274 / 20,291,011 / 19,999,897 / 10,018,189 / 12,476,014 bytes,
which is the MB column rounded). A `book` value in the logs is the *part* file
(`"book": "part-1.pdf"`), never a source name: the source attribution comes from
the label pages inside each part, which is why the scans can name 68 books while the
log lines only ever cite nine files.

**What is not recorded anywhere: the invocation.** The `.log` files begin at an
event (`[17:00:27.031] [BEAUTIFY] info decision …`) -- no argv, no version, no
options line -- so the run that produced them cannot be re-derived from the
evidence in this checkout. Two switches are readable from the emitters instead, and
they are what a re-run needs: `PARSER_LOG_ENABLED=1` for the `[STEM]`/`[BEAUTIFY]`
lane events (`workflow/lane_log.py:29`) and `PARSER_DIAGNOSTICS=1` for the
`[PDFDIAG]` per-page record (`workflow/diagnostics.py:43`), which is also why every
part appears twice in its own log (1,992 of 1,992 events have an identical twin --
see `audit/OVERVIEW.md`). The books themselves live on the scraper VPS and are
fetched by the repository's own `download-pdfs.py` (SSH settings from `.env`,
SHA-256 verified, files kept outside the repository).

## Bundled maps

Seven files ship under `resources/maps_data/`. A map nothing loads is not data
waiting to be used — it is a second opinion nobody reads, and the next reader has
to guess which copy the code follows. So each one is named here with its loader,
and `test_bundled_maps.py` fails if a map stops being referenced.

| map | loaded by | state |
|---|---|---|
| `burmese-inventory.json` | `normalize/cleanup.py`, `normalize/legacy_order.py` | live; itself generated from the two maps below |
| `damage-rules.json` | `normalize/scan.py` (report) and, for `impossible` alone, `extract/legacy_judgement.py` (decision) | **live as of this change** — the scanner used to restate `base`/`strayMarks`/`letterOrMark`/`impossible` as literals; it now reads the map, and the 2.2 MB corpus scan is byte-identical either way (19,754 orphan · 270 impossible · 1,764 stray · 21 repeat · 564 digit · 22,021 virama) |
| `homoglyphs.json` | `normalize/legacy_order.py` | **new to the Python side as of this change** — carried over byte-for-byte from JS `@jason-map/homoglyphs.json`; it is the pairs behind the Burmese-number test, which `normalize/judgement.judge_page_lines` collects on every lane and `extract/legacy_judgement.decide_legacy_family` acts on |
| `legacy-subset-profiles.json` | `extract/pdf_fonts.py` | live; the name+hash pairing (below) |
| `legacy-font-names.json` | `resources/font_names.py` | live; generated from JS's two name sets, so its gaps are JS's (`ayar` is absent, which is why `/EAAAAA+Ayar` never enters the lane by name) |
| `cipher-map.json` | `extract/pdf_extract.py` via `find_map` | live and optional — an external override, absent-by-design is a valid state |
| `visual-unicode-glyph-evidence.json` | `extract/pdf_visual.py` | live and **load-bearing**: it mirrors `codepage-visual.js`, and `match_visual_unicode_glyphs` has no fallback path, so unloading it deletes witnessed visual recovery and its differential test, not just a file |

Two maps were deleted, both dead:

- **`mm-score.json`** was a byte-identical copy of `mm_score.MARKS` and
  `mm_score.MARK_ORDER`, whose comment says those values are the grammar
  engine's table *verbatim* and the only copy in this codebase. The module is the
  authority; JS loads its own copy in `@rule/mm-score.js`, which is why the file
  exists here at all. It is **not** merged into `burmese-inventory.json` either:
  the inventory's `marks` is the *wider* scanning set (mm-score's 16 marks plus
  `scan.json`'s 17 `strayMarks`, so it counts U+1039) and `mm_score` counting the
  virama as a mark would move every score, every ZawCode call, and the new
  code-page probe at once. `test_bundled_maps.py` pins that the two sets stay
  different on purpose.
- **`zawcode-draft-glyphs.json`** fed a decoder branch whose inputs —
  `DocumentDecoding.zawcode_profiles` and `zawcode_templates` — are never assigned
  by anything in the tree (only initialised to `None` at `pdf_fonts.py:1151`), so
  `pdf_fonts.py:1738-1746` was unreachable. The tools that generated the map,
  `tools-box/python/zawcode-gid-contexts.py` and `zawcode-order-evidence.py`, still
  point at `B.Parser/main/parser/jason-map/`, a layout this repository does not
  have: the branch and its generators drifted apart before the map went. Both
  generators are now deleted, with the unwired slot rules they existed to feed. The
  branch, its four slots on `DocumentDecoding`, its run join and its
  `PRASER_ZAWCODE_DRAFT` gate are all **deleted** — it was not an experiment to
  keep declared, and a live path with no supplier is worse than no path.

## Font evidence that pairs the name with a hash

This is the shape the legacy lane should trust, and it is old, not invented:

- **`@core/pdf/method/decoder.js:545-558`** — inside the legacy lane, and only for
  a face whose name matches `/^(?:wininnwa|arlarwade|amyanmar|ayar)/`, it digests
  the embedded `FontFile2` and the `/ToUnicode` stream and asks
  `subsetFontBridge({fontSha256, toUnicodeSha256, baseFont, firstChar, lastChar,
  hasEncoding})`. The comment is the rule: *"The bridge describes this exact font
  resource and its encoding, not the PDF file. Unmatched resources never inherit
  another subset's byte map."*
- **`codepage-subset.js:212-224`** — `subsetFontBridge` returns `null` unless
  **every** field matches (`toUnicodeSha256`, `baseFont`, `firstChar`, `lastChar`,
  and no `/Encoding`), and on a match returns `fontFamily` plus a `layoutTable`
  label, with the warning that the table is for this resource and not a claim
  about the family.
- **`codepage-pooled.js` → `pooled-keyboard-font-evidence.json`** (7.4 MB) — the
  widest version of the same key: `pdf_font_scopes[].scope` = `font_sha256` +
  `tounicode_sha256` + `base_font` + `first_char` + `last_char` +
  `encoding: "absent"`, and each hit carries `status`, `requiresContext`,
  `sourcePdfSha256`, `sourcePage(s)` and a `reason`. Re-exported to the repair
  layer as `pdfRepairCandidates`. Python has no loader for it — the `N` row above.
- **`extend/codepage-resolve.js` `chooseCodePage`** — deleted in `764b272` ("main
  parser fresh"), and the ancestor of `legacy-judgement.js`. Its fuller design
  built a `DocumentDecoding` per candidate table, sampled **up to six pages**
  (`CODE_PAGE_PROBE_PAGES = 6`), kept a ledger (`candidates`,
  `zeroedForFewMarks`, `pagesAsked`, `pagesUsed`, `pagesFailed`, `marks`), emitted
  it as a `codepage` event, and could rank `UNICODE_PATH` as a *third* candidate.
  Python now has a behavior-preserving ledger and up to three accumulated probe
  attempts, but not that six-page resolver or the third candidate: see
  `do.MD` item 1e and Q6 for the remaining scope/decision.
- **Python's side** — `pdf_fonts.py:1905-1912` already has the five-field guard
  inline (`digest` + `baseFont` equality + `firstChar`/`lastChar` +
  `toUnicodeSha256`, no `/Encoding`) against the 22 profiles in
  `legacy-subset-profiles.json`, and `detect_legacy_layout_fonts`
  (`pdf_fonts.py:1385`) survived as the name-free detector. What the port never
  took is the *named API* and its test: `pdf-legacy-bridge.test.js` drives
  `subsetFontBridge` with three real hashes and asserts the null cases. That is
  the gap worth filling next, because a guard you cannot call cannot be tested.

## Pairing a face with a hash, and what happens where it cannot pair

The gap above is now filled on the Python side, and filling it decided the
font-name question: the guard is a named, callable function with tests for the
null cases, and the rule it states — *unmatched resources never inherit another
subset's byte map* — is applied to the lane's own ledger, not only to the pool.

A face's identity is `FontDecoder.program_sha256`
(`pdf_fonts.font_program_sha256`, `pdf_fonts.py:1803`): the sha256 of whatever
program the descriptor embeds — `FontFile2`, `FontFile3` or `FontFile`, and for a
CID face read off the descendant — with `FontDecoder.pairable` answering whether
there is one at all. It is computed for every face on both lanes, because the lane
trial reads the *shared* decoders and an identity kept only inside the legacy block
would be missing for exactly the faces the trial is asking. The pool pairing keeps
the narrow view the JS guard has: `FontFile2` only (`truetype_only=True`), so a CFF
or Type1 face never matches a profile cut from TrueType bytes. `load_map` is
`lru_cache`d, so the pool costs one read per process and the program is hashed once
per `/Font` object (`FontResourceLoader._program_cache`).

**Why the name cannot carry a decision** — measured over the two books in
`Junk/Parser/upload/pdf`, against the 22-profile pool (keyed by program digest, each
entry carrying `baseFont` — arlarwade 11, amyanmar 9, wininnwa 2 — plus
`toUnicodeSha256`, `firstChar`/`lastChar`, `codePage` — ayar 20, wininnwa 2 — and
`rawRuns`):

| book | distinct `/BaseFont` | with an embedded program | no program in the file | names that pair with the pool |
|---|---|---|---|---|
| part-4 | 29 | 19 | 5 | **1** (`wininnwa`, program `31e1447e81…`, pool `toUnicodeSha256 b27b2c3cbb…`, 0–113) |
| part-1 | 65 | — | 13 | **0** |

And same name is not same face: part-4's `wininnwa` answers to **five** embedded
programs (`firstChar`/`lastChar` 0–105, 0–113, 0–114, 0–127, 0–64), part-1's
`zawgyione` to **60** different programs plus 1,032 unembedded references,
`myanmar3` to 8, `calibri` to 15. A table keyed on the name is right for one cut of
sixty and wrong for the rest; `rawRuns`, `firstChar` and `lastChar` are per-subset
facts, which is why the pool itself is keyed by the digest and not by the name.

So `DocumentDecoding.lane_trial` is keyed by the hash and a face with no program in
the file is not asked at all (`extract/pdf_extract.lane_trial`, `pdf_extract.py:954`):
where the name cannot be paired with a hash the lane commits nothing, and the
instructor stays on the side he chose. The entry still records `baseFont` beside the
hash, so a log line can be read by a person.

The effect, front door (`python3 B.Parser/main.py <book>.pdf --txt`):

| book | pages asked | decoder builds with / without a program | pins committed | output vs `b2d9623` |
|---|---|---|---|---|
| part-4 | 212 | 89 / 14 | **0** | identical, 1,205,367 B |
| part-1 | 1,268 | 201 / 101 | **1** | identical, 5,740,811 B |

part-1's single pin is program `35ee2d90ca4b…`, labelled `zawgyione`, won by
`wininnwa` at score 0.7679 with 56 marks (quality 0.7262, `legacy-readable`) — the
same answer the default would have given, now attached to the one face that earned it
instead of inherited by 61. Zero pins on part-4 is not the trial failing: its
`no-burmese` retirements were name-keyed before, and the Burmese faces of that book
carry no program at all, so there is nothing to pair and nothing to commit.

**Can the instructor see the subset font map all day?** Yes — the file facts. The stem
pass (`workflow/pipeline.py:200-236`) already walks every `/Font` of every page before
any page is parsed, records `baseFont`, `subtype`, whether `/ToUnicode` is a reference
and whether that map speaks Myanmar, and keys `stem_fonts` by the resource reference so
each face is asked once for the book. The same `font` dict in that loop holds
`FirstChar`, `LastChar`, the `/Encoding` key and the `FontDescriptor`, i.e. every field
the five-field guard reads, so a pool lookup moved up there would cost nothing and could
be done before a lane is chosen. What it cannot see from there is the *shown strings*:
no content stream is decoded in the stem pass, so the stem can say "this face is a
witnessed subset profile" and can never say "this page reads as Burmese". That half is
why acceptance stays in the lane, and it is the reason the swap was not moved there.

## Where the evidence lives

| file | what it holds |
|---|---|
| `audit/OVERVIEW.md` | the generated digest of everything below — read it instead of opening the raw files (`python B.Parser/tools/audit_overview.py`) |
| `audit/parts/part-N.log` | the **lane** events only, compressed to contiguous page ranges: `decision: book, pages, rule` and `lane-switch: book, page, from, to`. With `PARSER_DIAGNOSTICS=1` the same file also carries the per-page record (`lane`, `lane_reason`, `decision`, `category`, `residue`, `detached_marks`, `duplicate_lines`, `warnings`, `status`) — the committed parts were collected without that flag, so they do not have it |
| `audit/scans/part-N.scan.txt` | damage per part: `orphan` / `impossible` / `stray` / `repeat` / `digit` / `virama` — cluster, hit count, and the **line number** it came from |
| `audit/broken-books.jsonl` | per-book rollup: `book`, `pages`, `orphan`, `impossible`, `stray`, `repeat` |

Two things the committed evidence cannot do, stated here so nobody re-derives
them by hand: the logs hold **the same run twice** in every part (Logen appends,
and each part was collected twice into one path), so a count taken by summing
lines is double — pages have to be taken as a union; and there is no per-page
report in the repository, so the flagged-page figure the collection PR quoted
(1,192 of 5,098) is not checkable here. The page count itself is: the nine logs
name 5,098 distinct pages between them.

Totals across the nine parts, as the scans report them: **orphan 60,038 ·
stray 12,768 · repeat 1,221 · impossible 521** — plus `digit` 3,386 and
`virama` 34,426, which the earlier summary left out.

`orphan` — a dependent mark with no base — is the dominant defect by an order of
magnitude, and it is the same thing the worst pages show.

## Audit claims

Every number this document states about the committed evidence is recomputed from
that evidence by `python B.Parser/tools/audit_overview.py --check`, which reads
only `audit/` and fails if a row below and the files ever disagree. The
per-part `orphan hits` column of the source-PDF table above is checked the same
way.

| claim | value |
|---|---|
| pages covered by the logs | 5,098 |
| log events (all parts) | 1,992 |
| distinct log events | 783 |
| scan orphan | 60,038 |
| scan impossible | 521 |
| scan stray | 12,768 |
| scan repeat | 1,221 |
| scan digit | 3,386 |
| scan virama | 34,426 |
| books in the report | 68 |
| report pages | 2,379 |
| books with a defect | 58 |

## What the worst page shows

`part-3` page 754:

```
'-၂၃-'
'ယခလလပဆငတ နရမ:လည မနမပညရ:ငတက သတစတpက"ကထငရ'
'လပဆင လမရပgဘ။ အရ:တငအရ:ဘသစကက အထပ"လလထတ'
```

Consonants decode; marks do not, and mark positions arrive as ASCII
punctuation (`:`, `"`, `p`, `g`). The fonts behind that part include several
resources with **zero `/ToUnicode` entries** (`/ABCDEE+Zawgyi-One`,
`/VNZQXL+WinYadanapon`, `/ABCDEE+Calibri`, `/ABCDEE+Times New Roman`). A font
with neither `/ToUnicode` nor `/Encoding` leaves no per-glyph link in the file,
so every mark outside the fallback is lost — that is the open root cause.

## The cleanup flag is not part of the design

**The gate.** `workflow/finish.clean()` is normalize, called after a page's
parsing finishes. Every page of every lane passes through it — Unicode, Zawgyi
after Rabbit, legacy, OCR, UNKNOWN — it is internal routing rather than a
caller's option, and when it returns the page's parsing is finished: the page
leaves the parsing chain and nothing downstream re-opens its text. Its two halves
are one step: ordering (`order_text`, whose tables are the engine's) and the
imposter replacement (`cleanup_text`).

**Deleted here.** There was an `apply_cleanup` boolean threaded from
`finish.clean` through `finalize_pdf_output`, `finish_text`, `finish_pdf_page`,
`pipeline._convert_line`, `_conv_lines`, `_cleanup_for`, `build_content`,
`build_final_pages`, `process_pdf_stream`, `collect_stream_results`,
`diagnostics.page_log`/`page_record` (as `cleanup_applied`) and the entry callers.
Any caller could hand a page back with the ordering applied and cleanup skipped,
which is the same text two lanes would not agree on. `test_public_entry_apis_expose_no_cleanup_toggle`
pinned only that the *public* APIs hid the flag, so the internals kept it; the
whole flag is now gone, the two halves are `clean` (the page's text) and
`ordered` (a report column, never an output), and
`test_shared_finish.test_the_gate_has_no_switch` fails if the word `cleanup`
appears in any of those signatures again.

**The JS side: delete it there too.** The mirror still carries the flag and the
Python parity tests are written against its output, so this note is the
instruction, not an oversight:

| JS file | the flag's shape | what to do |
|---|---|---|
| `@core/runtime/finalized-cmap.js` | `orderUnicodeText`/`cleanupUnicodeText` are separate exports, and `convertFinalizedPageText(text, page, applyCleanup)` picks between them with a boolean | drop the third argument; return the `(base, clean)` pair, as `finish.finalized_output` does |
| `@core/runtime/finish.js` | `cleanupFor(cat, text)` gates by category and the category gate is real; `applyCleanup` is threaded beside it | keep the category rule, delete the boolean |
| `@core/pdf/legacy-judgement.js`, `@core/runtime/finish.js:58` | `orderText(...)` called directly, no flag | nothing — this is already the design |
| job payloads on either door | `applyCleanup` is a key nothing reads: `interop.run_job` picks its options by name and never looks at it | delete the key wherever a caller still sends it |

### The regional wrapper: deleted on request

`normalize/unicode_evidence.py` and `preserve_regional_runs` are **gone**
(2026-11-20, by instruction). Removed with them: the import and the three calls in
`workflow/finish.py` (`ordered`, `clean`, `clean_page` — now bare
`order_text`/`cleanup_text(ordered(text))`/`normalize_phase2`), the import in
`workflow/pipeline.py`, and the three `test_mirror.py` checks. Ordering and
cleanup now run on **every** code point, Mon and extended ranges included.

What that costs, measured before it was dropped the first time:

```
ENGINE   normalize('ကမၻာ')  -> imposter table applies, no shield
JS       convertFinalizedPageText('ကမၻာ', page, true) -> unchanged (the shield holds)
PARITY   139 of 310 samples carry a REGIONAL-range code point; the wrapper changed
         the result for all 139 — i.e. ~45% of test_pdf_finish_js_parity
```

On `IMB Final.pdf` nothing changes: 0 of its 339 decoded lines contain a
REGIONAL-range code point, so the shipped TXT is byte-identical either way.

The upstream conflict the experiment found is still open and is the note for
`python`: the Engine applies its `IMPOSTER` table with no shield, so a Mon or
extended code point that collides with a table key is rewritten there, while the
JS parser's shield blocks the same repair. Narrowing those `IMPOSTER` keys is
where this belongs; until then Python and the JS oracle disagree on such text by
design, not by accident.

## The legacy ordering rule: two cases, chosen by the code page

The chain gives every lane one slot for the rule that rewrites its text:

> stem parser -> judgement -> lane selection -> parse in the selected lane with the
> selected beautify rule (**and in the legacy lane, that rule is the legacy
> ordering**) -> cleanup -> `finish.py` -> bind-engine api.

The legacy lane's slot is filled, and it has **two cases**, because a legacy face's
visual order is a property of the code page, not of the lane:

| case | what runs | where it comes from |
|---|---|---|
| plain slots (`layout='wininnwa'`/`'ayar'`) | `reorder_legacy_slots` — ေ+ra+base -> base+ra+ေ, ra+base -> base+ra, ေ+base(+ya) -> base+ya+ေ | the code page the face was read through |
| compound (`layout=None`/`'zawcode'`) | `visual_order` (the ZawCode swap, U+200B kept) | a face whose code page is not plain WinInnwa/Ayar |

Both then run the same kinzi/preposed/AA regexes in `arrange_legacy_order`, which
`finish.apply_decision`'s `legacy` branch calls per line.

**The switch is the settled code page.** `pipeline` reads it from
`pg['legacy_families']` — the record `extract.pdf_extract` writes per face from the
decoder: `family` from `FontDecoder.settle_legacy_family`'s probe on the face's own
bytes (`by='page'`), or from the name gate (`by='name'`), or nothing. The name gate
alone is not enough: a subset renumbers glyphs from `0x21`, so its code page is the
one its **bytes** were settled through, bridged by its own `/ToUnicode`
(`pdf_fonts.bridge_codes`). Only when no family is settled does the rule keep the
ZawCode swap.

**History, because the record was wrong.** `legacy_bases`, `reorder_legacy_slots`,
`reorder_zawcode_text` and `count_zawcode_evidence` were deleted at `cdb05fb`, and
that commit's message and this file then stated the lane's rule "does not exist in
either tree", with the slot "left empty". It did exist, in this module and in the JS
that mirrored it (`7504040:B.Parser/main/parser/text/legacy-order.js`,
`reorderLegacySlots`, deleted at `764b272`/`2fa2a81` during the parser restructure).
What the deletion actually left was the ZawCode case applied to every face, i.e. the
compound guards running over plain WinInnwa text. Both cases are restored, and the
choice is now the one the decoder already settled.

**JS still has none of it.** The pinned reference's page-finish step writes each
legacy line through the shared ordering and says why:

```js
// @core/runtime/finalized-cmap.js:243-262
// Legacy pages are written as decoded, then given the one shared
// ordering (orderUnicodeText) every lane gets at page finish. There
// is no legacy-specific reorder rule: extraction only decodes.
if (decision === "legacy") {
  …  write(orderUnicodeText(text));
}
```

So the legacy decision is still the one documented divergence from the mirror, and
`test_pdf_finish_js_parity.py` still pins its size (`LEGACY_LANE_GAP`).

**Measured, 2026-11-20, because the pin was not describing anything.** Against the
pinned reference it now compares (`67f0284`, main), the oracle diverges on 253 of
310 samples -- and 121 of those differ while both sides pick the *same* decision
(40 legacy/legacy, 39 rabbit/rabbit, 37 aligned/aligned, 5 zawcode/zawcode). Its
allowance only covers samples where this tree says `legacy` and JS says something
else, so the guard trips at the first sample outside that shape (`'က'`,
`parsingPath='legacy'`, `sourceEncoding='unicode'`: this tree `aligned`, JS `legacy`).
Read it as: the oracle outlived the reference it was written against, not as a
one-sample regression, and the pin needs re-basing on a reference this tree still
mirrors before it means anything again.

## The separate Engine-normalize call is deleted; bind engine is the only door

**The trace, from both trees, is what settles it.** The bind api is "call it and
pass an object", and the normalize sits *behind* it, applied to every block before
the Engine looks at it:

| step | JS (pinned `67f02845`) | Python (`A.Engine/architecture/`) |
|---|---|---|
| the call the parser makes | `@postprocess/bind-engine.js` — `bindEngine(request)` → `BindEngine(request)` | `api.py:6-8` — `collect(text, flag)` → `bind_engine({'sourceText': text, 'flag': flag, 'log': False})` |
| into the engine | `init/bridge.js:12` — `async function* Engine({ sourceText, flag, log }, …)` | `init/bridge.py:17-42` — `bind_engine(request)`, then `bridge.py:42` |
| the input reader | `init/bridge.js:19` — `readFromApi(sourceText)` | `bridge.py:42` — `read_from_api(source, mapper)` |
| **the normalize** | `MonoSyllabism/generators/input.js` — `for await (const block of collectFromText(sourceText)) { const cleaned = normalize(block); const mapped = mapperStr(cleaned); yield mapped; }` | `MonoSyllabism/generators/input.py:3-5` — `for block in collect_from_text(text): yield runtime.mapperNormalize(block)` |
| what that is | `normalize` + `mapperStr`, imported from `map/loader.js` | `map/normalize.py:95` `mapperNormalize = mapperStr(reorderAndWrap(normalize(text)))`, and `:89` `normalize` = `NFC → from_utf16_units → Glue strip → cleanImposters` |

Two consequences, and they are the rule:

1. **An upfront normalize in the parser is the same pass twice**, run on the wrong
   side of the door. The parser's job ends at `cleanup` inside the finish; whatever
   it hands over is normalized by the Engine as the first act inside bind.
2. **It is not a repair, so deleting it loses nothing.** What returns from bind is
   tagged *analysis* of the normalized text — the normalized text is not written
   back over the file. A stray mark that survives into a finished page is therefore
   a `cleanup` bug to fix in `cleanup`; pre-normalizing at the parser's end would
   hide it from `normalize/scan.py`'s counts and from the reports while leaving the
   shipped bytes identical.

That is also why this section deletes the plumbing instead of wiring it, where the
earlier draft of this audit proposed re-attaching it.

The chain, in the JS's own words:

| piece | what it is told to do |
|---|---|
| `@rule/mm-score.js` | "judges structure strictly… **This module never rewrites text.**" |
| `@rule/judgement.js` | "the strict low-level token walking lives in `mm-score.js` beside it… **which this module asks for evidence. Nothing here rewrites text.**" and: "The TEXT KEEPING section at the bottom is **inherited plumbing from the deleted `normalize.js`**; it judges nothing and selects nothing." |
| `@postprocess/beautify/zawcode-order.js` | "**These rules rewrite text; deciding stays in `@rule/judgement.js`.** … beautify is the parsing chain, repair is a later runtime stage." |
| `@core/runtime/finalized-cmap.js` | "Every beautify rule layer gets `clean.js` as its follow-up here, **then the page is finished**… **Do not add a blanket second ordering pass behind this finish.**" |

So mm-score + beautify and normalize are not one pass: the pair runs first, and
the Engine normalize is the **final gate per line, one step behind it**. `36aa3a5`
shows that shape exactly:

```js
// B.Parser/main/parser/text/page-file-decision.js  (finishPageToFile)
const writeOriginal = ({ transform = (text) => text, normalizeLines = false } = {}) => {
  for (const [, , , text] of store.lines()) {
    let result = transform(text);                                             // beautify rule
    if (normalizeLines) result = [...normalizePageLines(result, normalize)].join("\n");  // the gate, behind it
    write(correctWorldWord(result, worldEvidence));
  }
};
writeOriginal({ normalizeLines: true });                                   // plain lane
writeOriginal({ transform: arrangeZawCodeOrder, normalizeLines: true });   // ZawCode lane
```

with `normalize` arriving from the front door: `extend/pipeline.js:30`
`const normalizeWithEngine = await getEngineNormalize();` → passed into
`finishPageToFile({ …, normalize: normalizeWithEngine })`.

`764b272` ("main parser fresh") dropped the `normalizeLines` calls and the
`normalize` parameter and moved the two functions into `@rule/judgement.js`'s TEXT
KEEPING section as orphans. At the pinned reference `getEngineNormalize` is
imported by **`test/parser-test/zawcode-order.test.js` and nothing else** — the
gate runs in the JS tests and not in the JS chain. The Python port inherited that
state faithfully: `normalize/judgement.py` carried `normalize_page_lines` /
`normalize_output_text` with `test_mirror.py` as their only caller, and
`resources/engine.py` reads engine *data*, never an engine function. (The two
functions are deleted now — see "Settled, and the other way round" at the end of
this section.)

**Name the owner before blaming it.** No `clean.py` has ever existed in this
repository, and neither has a parser `normalize.py`: the Python file is
`normalize/cleanup.py`, at every step of its history
(`B.Parser/Python/modules/cleanup.py` → `main/Python/modules/cleanup.py` →
`architecture/normalize/cleanup.py`). The deleted `B.Parser/main/parser/text/normalize.js`
said so in its own header, and that sentence is the design's:

> "JS-only pipeline orchestration. **There is deliberately no `normalize.py`** —
> this module has NO Python counterpart, so it must not define any data or
> behaviour that a Python module owns. The five functions **`cleanup.py` owns**
> live in their mirror, `cleanup.mjs`, and are re-exported here so existing
> callers keep working unchanged. **`normalizeGlue` is `cleanup.py`'s
> `normalize_text`**, aliased on the way through because this module exports an
> unrelated `normalizeText` of its own further down — the one name that genuinely
> means two different things on the two sides of the port. **`MARKS` belongs to
> `mm_score.py`** and is re-exported from its mirror for the same reason."

So the five normalize functions belong to `cleanup.py` (with `MARKS` to
`mm_score.py`), and `normalize.js` was only a JS re-export shim — deleted in
`2ef4ac3`, with `cleanup.js` and every other `normalize.js` gone by the pinned
reference. What `764b272` actually lost is not a Python module but the shim's
second job: the **pluggable external normalize** (`initNormalize()` reading
`PRASER_NORMALIZE_MODULE`, `getEngineNormalize()` handed to
`finishPageToFile({…, normalize})` and applied per line one step behind the
beautify rule). At the pinned reference that hook has no production caller at all
— only `test/parser-test/zawcode-order.test.js` still fetches it — so an outside
normalize can no longer be attached to the finish, and the parser's own
`normalize_page_lines`/`normalize_output_text` (the plumbing the shim re-exported)
sat uncalled in both trees — deleted from the Python side, still to be deleted in
the JS.

**Settled, and the other way round.** The question "should the gate be re-attached
to the parser?" is answered *no*: the chain reaches the Engine **once**, at its
end, through the bind-engine api — `normalize/pos_scan.py` importing
`myangustis_engine.api.collect` is the only Engine text call in the parser, while
`resources/engine.py` reads engine *data* and `workflow/lane_log.py` its logger.
A second, separate call of the Engine `normalize` is a competing owner of the same
characters, so the plumbing that made one possible is **deleted here**:
`normalize/judgement.py`'s TEXT KEEPING section (`normalize_page_lines`,
`normalize_output_text`, and their `__all__` entries) plus the two
`test/parser-tests/test_mirror.py` pins that were its only callers. Nothing else in
the tree loaded them, which is the same test the deletion was decided by
everywhere else in this audit.

`workflow/ocr.py`, `entry/*`, `output/*` and the parity suites are untouched — no
behavior changed, so `test_pdf_finish_js_parity.py`, `test_decoder_js_parity.py` and
`test_docx_js_parity.py` still compare byte-for-byte, and a page's characters are
shaped by exactly one thing after the pair: `cleanup` at the finish.

**Action for main, because the JS is the same.** At the pinned reference the only
remaining separate caller is a *test*, and the reach is three sites:

| site | what to do |
|---|---|
| `@rule/judgement.js:266,281` — `normalizePageLines` / `normalizeOutputText` | delete; the header already calls them "inherited plumbing … it judges nothing and selects nothing" |
| `B.Parser/_path.js:39` `getEngineNormalize`, its re-export at `B.Parser/_index.js:5` and `index-path.js:52,57` | delete the hook — with no chain caller it exists only to let a test fetch a second normalize |
| `test/parser-test/zawcode-order.test.js:6,10,12,110,184,196,202-243` | drop the cases that call `getEngineNormalize()`/`normalizeOutputText()`; keep the ordering assertions that go through the lane |

The `36aa3a5` shape above is *not* worth restoring, and the trace is the reason: its
`normalizeLines` pass re-ran what bind already runs internally, and its only visible
effect was on bytes the file already carried. If main wants the text the parser
*writes* to be Engine-normalized too, that is a different decision from this one —
it would move every lane's output, re-pin the parity samples in both trees at once,
and re-baseline `normalize/scan.py`'s orphan/stray counts, because those are
measured on the written text. Nothing was wired here, by design: the parser has one
normalize owner inside the finish (`cleanup`) and the Engine keeps its own, behind
the api.

## Reading a PDF run: which symptom belongs to which phase

The books in `audit/broken-books.jsonl` live on the scraper VPS, not in Git:
`download-pdfs.py --env /path/to/.env --book=<name>` fetches them (SSH host, user
and `SSH_DIR` come from `.env`; the default local directory is outside the
repository, and every file is checked against the source SHA-256). This sandbox
has only `.env.example` and no route to that host, so the per-PDF runs happen on a
machine that does -- and the table below is what to read in their output. Each
symptom class is owned by exactly one phase; a class improving somewhere else
means a repair left its phase.

| phase | what it owns | the class that should move here | what a hit here *means* |
|---|---|---|---|
| `extract/pdf_extract` + `pdf_fonts` (decode) | turning the file's codes into Unicode | `orphan` where the base never arrived; `virama` with nothing stacked | the file has no per-glyph link (no `/ToUnicode`, no `/Encoding`) -- root cause 2, not a rule to add downstream |
| the lane's beautify rule (`apply_decision`: `arrange_legacy_order` incl. the ZawCode swap, `arrange_zawcode_order`, `Rabbit`) | the code page's own ordering and shared-glyph habits | `digit` (``၀`` wearing a mark, ``ရ`` inside a word run), preposed/kinzi order | a wrong or undecided table: inspect the per-face `codepage` ledger (marks, candidate scores, `impossible`/English evidence and page counts) before blaming the ordering |
| `cleanup` at `workflow/finish` | mark order inside a cluster that *has* a base, imposter replacement | `orphan` whose base is present but out of order; ``မၻာ``-style imposters | a rule missing from `order_text`/`cleanup_text` -- the one shared ordering, never a lane-specific copy |
| `normalize/pos_scan` → bind-engine api | reporting only | none: it must not change any count | a difference here is the Engine's reading of the text, and the Engine normalizes *behind* the api; nothing is written back |
| extraction piece dedup + `_collapse_overprint` | double-drawn shadow copies | `stray`, `repeat` | a piece that is one unit repeated is a piece-level fact -- fixed at the piece, never re-parsed later |

Three readings that are expected, not regressions:

- **`impossible` does not go down.** By design it is consulted only in the
  wininnwa-versus-ayar decision (a veto there, never a rewrite), so a page keeps
  its `impossible` hits and says so; `scan` counting them is the deliverable.
- **`orphan` falls but not to zero.** Ordering cannot move a mark with no base in
  front of it. The residual `ေ`/`ိ`/`ာ`/`ျ`/`ု` leading counts are the size of the
  decode problem, not of the ordering rule.
- **A legacy page may differ from the JS output.** `test_pdf_finish_js_parity.py`
  pins that gap at **39 of 310 samples, all `decision == 'legacy'`** -- the lane
  rule the mirror has not landed. Anything outside that lane is a bug, not a gap.

```bash
python -m myangustis_parser.normalize.scan <out.txt> -o <out.scan.txt>   # damage per rule
python B.Parser/tools/audit_overview.py --write                          # refresh OVERVIEW.md
python B.Parser/tools/audit_overview.py --check                          # claim table vs evidence
```

## Front-door re-run of three parts from the report

The books are not in this checkout, but their blobs are reachable on branch `trash`
and the run needs no fixture: `git fetch --depth=1 --filter=blob:limit=11m origin trash`,
`git cat-file blob $(git rev-parse FETCH_HEAD:pdf-parts/part-5.pdf) > /tmp/part-5.pdf`,
then the three files copied to `Junk/Parser/upload/pdf/` and run through the single
entry point, `python3 B.Parser/main.py part-5.pdf --txt`, with the scanner door on
the result: `python -m myangustis_parser.normalize.scan Junk/Parser/output/txt/part-5.txt`.
Outputs and scans live under `Junk/Parser/output/` -- ignored by Git, like every run.

| part | pages | report: orphan / impossible / stray / repeat | this run | verdict |
|---|---|---|---|---|
| 4 | 340 | 7,600 / 114 / 74 / 7 | **7,640 / 114 / 74 / 7** | identical except +40 orphan (+0.5%) |
| 5 | 85 | 430 / 0 / 1 / 6 | **707 / 0 / 1 / 6** | `impossible`, `stray`, `repeat` identical; **+277 orphan** |
| 8 | 85 | 142 / 1 / 9 / 0 | **147 / 1 / 9 / 0** | identical except +5 orphan |

Three of the four classes agree exactly on all three books, which is the point of
the exercise: the chain is producing the same damage profile as the run that
generated `audit/`, page for page and book for book.

**Where the residual sits.** `orphan` is not uniform across the three books -- +0.5%
on part-4, +5 on part-8, +277 on part-5 -- and it is not the legacy phases' to own:
beautify is a one-arm dispatch (`workflow/finish.apply_decision`: `rabbit` gets the
conversion, `zawcode` the slot swap, `legacy` the legacy ordering, `aligned` nothing),
and `normalize/judgement.select_page_decision` consults four fields and no score
(`hasMyanmar`, `candidateSlots >= ZAWCODE_MIN_SLOTS`, `parsing_path`, `zawgyi_codepage`,
then `aligned`); its own docstring says the mark-order rule alone makes the Rabbit
call and "no score margin second-guesses it". Nothing in this repository ranks a
ZawCode or Rabbit reading against another, and the only place that ranks candidates at
all is `extract/legacy_judgement` over exactly two of them -- `LEGACY_CODE_PAGES` is
`{"ayar", "wininnwa"}` (`extract/pdf_fonts.py:956`), reached only for a face already on
the legacy lane (`:1499`), where mm-score, the `impossible` veto and the shared-glyph
count are the ruler both readings are measured with, not a lane vote.
A per-page attribution of the residual was cut from this section: it had been read off
the run's `[BEAUTIFY] decision` / `[STEM] lane-switch` lines, which report the lane a
page took, not what the page became. The instrument is the result file, and the control
it needed has now been run on all three books -- applied to the finished text, to lines
that contain no Zawgyi slot at all:

| part | lines with no Zawgyi slot | `Rabbit.zg2uni` would still change | `arrange_zawcode_order` would still change |
|---|---|---|---|
| 4 | 6,277 | 5,040 (80%) | 2,681 (43%) |
| 5 | 2,561 | 2,246 (88%) | 1,113 (43%) |
| 8 | 1,820 | 1,479 (81%) | 538 (30%) |

So "the rule would still change this line" is *not* evidence that the rule was skipped:
neither rule is a no-op on already-correct text (both are idempotent, and both fire on
ordinary Unicode -- `ဒေါက်တာငွေစိုး` -> `ဒေါက်တာငွစေိုး`). What is evidence, in the result
file alone, is a Zawgyi-only slot that survived to the output: ``[\u103f\u1060-\u1099]``,
which Unicode assigns to Shan and a Myanmar-language book does not carry.

| part | pages of Myanmar text | pages whose finished text still holds Zawgyi-only slots | marks | where they sit |
|---|---|---|---|---|
| 4 | 320 | **118** | 8,670 | a run of ~120 marks a page across p226-p340 |
| 5 | 81 | **11** | 409 | p85: 262, p84: 83, p82: 56 (401 of 409), 3 pages with one |
| 8 | 74 | **5** | 75 | p56: 66, four pages with one to four |

That is the mixing, counted where it is visible and by a test that cannot fire on
correct text. The scanner's own clusters, mapped through the result file's
`--- Page N ---` markers, land the same way on part-5's three worst pages (p82, p84,
p85): 18 of 25 `orphan`, **all 25 `virama`, all 14 `digit`, the 1 `stray`** -- and none
of the 3 `repeat`. part-4 carries the same condition through a whole section of the
book, and the pages holding one to four marks are a different event and should not be
read with them.
Nothing here says which stage should have caught them; the legacy phases are excluded
only in the sense that no rule of theirs runs outside its own lane, and these numbers
are not a score of any lane.

### The book that shows the handoff: `ယဲ့နင် စာစဉ် a ၁` (repo `lingux`, 4,414 pages)

Fetched as one blob -- `gh api -H "Accept: application/vnd.github.raw" repos/htetmyetflam3/lingux/git/blobs/<sha>`
for `Parser/main/File/upload/pdf/ယဲ့နင် စာစဉ် a ၁.merged.merged.pdf` (10,575,815 bytes) -- and run the same
way: `PARSER_DIAGNOSTICS=1 PARSER_LOG_ENABLED=1 python3 B.Parser/main.py <file> --txt`, then the page
records in `B.Parser/logs/lane-decisions.log` and the scanner on the result file. This book is the
counter-example to every book in `audit/`: it has **no legacy pages at all**.

| measured on the run | value |
|---|---|
| page records | 4,414, all `lane=font` (`decode_kind` never `legacy`) |
| `category` | UNICODE 3,812 / UNKNOWN 377 / ZAWGYI 225 |
| `decision` | **`zawcode` 2,666** / `aligned` 1,523 / `rabbit` 225 |
| `changed` | yes on 2,891 = **every `zawcode` and `rabbit` page, no `aligned` page** |
| scanner on the result file | `orphan` 25,739 -- `stray` 2,856 -- `impossible` 71 -- `digit` 99 -- `virama` 29 |
| warnings | `unicode-glyph-recovery-needs-review` on 2,075 pages |

So two-thirds of a Unicode book had its finished text rewritten, page by page, by the ZawCode slot
rule -- and the tree already warns about 2,075 of those pages as recovered Unicode.

**The mechanism, from the stage, not inferred.** `normalize/judgement.select_page_decision`
(`:261-269`) tests the slot count *above* the lane:

```python
if not zawgyi_codepage and judgment["candidateSlots"] >= ZAWCODE_MIN_SLOTS:
    return "zawcode"          # never asks which lane the page is on
if parsing_path == PDF_PARSING_PATHS["LEGACY"]:
    return "legacy"
```

`zawcode` is the name of a beautify *rule* (`workflow/finish.apply_decision` dispatches on it); it is
not a lane, and there are two lanes. Because the test is above the lane check, one rule name does both
jobs at once, and both directions follow from that single fact: a modern page gets a rule that belongs
to the other lane (this book: 2,666 pages whose finished text the rule rewrote -- the same file also
carries 25,739 `orphan` hits, which is measured alongside it here, not attributed to it), and a legacy
page loses its own rule
(part-4: 127 of its 128 legacy-lane pages were labelled `zawcode`, so `arrange_legacy_order` ran on 1).
The JS mirror says the same thing out loud -- `@rule/judgement.js:188-191` and the comment at `:162-171`,
"flagged zawcode and takes the ZawCode beautify rules, legacy pages included" -- so this is inherited
behaviour, recorded here as the mechanism. Changing it in Python needs the design's ruling first: no
code in this branch was touched for it, and the `test_pdf_finish_js_parity` oracle would move with it.

**The same book, run from the pre-edit stage.** `git worktree add --detach /tmp/base 52d7a21` with its own
shim (this checkout untouched), same command, same env: the result file is **byte-identical** (`cmp` clean,
5,196,583 bytes each) and **0 of 4,414** page records differ in `lane`, `decision` or `changed`. Both trees:
`font`/`zawcode` 2,666 -- `font`/`aligned` 1,523 -- `font`/`rabbit` 225 -- `lane=legacy` **0**. JS was not
executed here (no `npm` install in this sandbox); it was compared at source, and `@rule/judgement.js:188-191`
carries the same body as `judgement.py:236-246` at the base and at HEAD.

**How a page is kept out of the lift, measured on this book** (the modern lane is one decode -- Unicode --
and beautify is the correctness lift, so the shape of each page is what should decide the lift):

| set | pages | slots on the text the judgement actually saw | what that means |
|---|---|---|---|
| `decision=aligned` (`changed=no`, so the file *is* what was judged) | 1,523 | 1,511 with **0** slots; **12 with 1-5** | nothing to lift, correct. The 12 carry real ZawCode shape and are under the page floor, so no rule ran at all |
| `decision=rabbit` (every font named `Zawgyi`/`ZawgyiOne`) | 225 | 48 still show >=6 slots *after* the rewrite | `workflow/pipeline.py:343` sets `zawgyi_codepage` from the **font name**, and `judgement.py:263` then refuses to offer the swap at all -- a name vetoes a repair |
| `decision=zawcode` | 2,666 | (post-lift, not comparable) | the lift ran; residual counts drop, which is what a lift does |

So the two doors that let a ZawCode-shaped page through unlifted are both pre-edit, both inherited from JS,
and neither of them is the lane: `ZAWCODE_MIN_SLOTS` counted per page (12 pages here; and in part-4 the same
floor, reached from the other side, is what took 127 of 128 legacy pages away from the legacy rule), and
`has_only_zawgyi_fonts` (225 pages here).

## Why the legacy lane barely changed anything: the floor decided nothing

**Followed through to the lane itself, the same two rules, and the population is what
stopped it.** The judge now scores a legacy reading in `legacy_order.visual_order` --
the ZawCode visual map order, named so -- because at the lane decision beautify has not
run and a mark sitting at its table's slot is correct Burmese, not damage; and the floor
moved from the mirror's 0.85 to `LEGACY_READABLE_FLOOR` 0.4 with `LEGACY_MODERN_CEILING`
0.3 below it. `legacy_lane_score.trial_lane` then asks the lane question of the two
parallel readings per page, and the English-likeness veto is read in the opposite
direction from the way it was first wired: `english_phrase_test` scores only the SPACED
English phrases a page produces (a Latin fragment glued to Burmese -- `aမှာကb`
-- is not English and is not scored at all), and a real English sentence beside Burmese
words costs the legacy reading ENGLISH_WEIGHT / (1 + burmese words) instead of blocking
it, because one sentence must not outvote a page. It blocks only when there is no Burmese
word on the page at all (`englishPage`), and the winner must also beat what the map
already read, so a Unicode page needs no table. Measured on part-4's first 120 pages:
68 page-and-face decisions came back `legacy-readable`, 9 were `english-page` vetoes (the
book's own English headings, on a face whose map read is pure Latin), 54 faces are Latin
alike under both tables, 10 short pages declined. Output change: **zero pages** -- every
readable one was already inside the legacy lane, which is the answer to the question
"does the legacy lane barely change anything": the rule is no longer the limit, the
population is. On part-1, 610 face-slots are excluded by declaring an /Encoding without
/Differences and 145 are CID (2-byte codes) -- including `ABCDEE+Zawgyi-One`, the face
behind that book's 71,337 fallback ASCII bytes on 228 pages -- so no byte-keyed legacy
table (slots 0x21-0xff) can address the population that actually produces the ASCII, and
one page (1341) flipped. The lever after that was tried and measured, and the
number says no: giving the trial the face's own map as a bridge *per code* (keep the
character the map resolved, re-read only a single latin key, two bytes at a time for a
CID face) reaches the whole population -- 141 pages of part-4 and 657 of part-1 come
back `legacy-readable` -- and the output gets worse, not better: 360,467 Myanmar
characters on part-4 become 262,044 and 1,631,519 become 1,268,404 on part-1, with the
book summary's `degraded` page count going 15 -> 122 and 325 -> 558. The reason is
structural and it is the finding worth keeping: the trial reads the page with the
*shared* decoder, so it sees the map's text for free, while acting on the verdict hands
the page to `DocumentDecoding('legacy')`, whose map is empty -- a page flipped on the
strength of a sample it beat loses every code the legacy lane cannot resolve. So a lane
flip cannot be bought by a score, however the score is computed. What the ASCII on
those pages actually needs is the legacy lane's own third step: keep what the map read
and fill only the holes from the table the lane chose -- `_legacy_lookup` gives up on a
code its own map does not name, which is where `A:3566,U:232,E:85` survives today, and
which is a layout-table question (which face's slots are documented, and what is in
them), not a lane question.

The lane move was therefore disarmed and the pin kept: `normal_page` still asks the trial on
every page the gate sent to the modern lane, and a readable winner pins that face's table, but
no page changes lane on the strength of a score. Counters from one front-door run of part-4
after that: 212 pages asked (exactly the pages the gate left modern), 127 verdicts, 292
readings put through `visual_order`, and the verdicts came back 110 `short-page`, 15
`no-burmese`, 2 `english-page` -- zero pins, because the pages whose tables read as Burmese are
the ones already inside the legacy lane. Output: 0 pages changed against the previous commit on
either book, and part-1 p1341 (the one page the lane move had taken) went back to its 1,631,519
Myanmar characters, 5,048 ASCII bytes lighter off. Both spots run at runtime; on these two books
the lane's own probe, scored by the same judge in the same visual order, already agrees with
them, which is what keeps the text where it was.

The first base-vs-branch run on the books that *have* legacy pages said "barely": part-4 moved 78 pages of
340 and part-1 869 of 1,359, yet `digit` was unchanged on part-4 (875 -> 875) and `orphan` went up. The
record added for that initial implementation showed why: `extract/legacy_lane_score` used to accept a
reading only when its mm-score reached the mirrored scorer's absolute `LEGACY_QUALITY_FLOOR = 0.85`.
A legacy page could not reach it, because `1 - max(orphan, disorder)` charges for exactly the visual mark
order a legacy page is written in. Measured, part-4: **63 probes, 0 accepted, best score 0.7158, median
0.0**. That was the pre-revision rule: the lane looked at the face, refused, and left the default table
in place. The following two changes replaced that acceptance rule; the historical counts above are not
the current probe behavior.

Two changes, both inside the legacy lane's own decision -- the modern path and rule selection were not
touched:

* `decide_lane` accepts the **better of the two readings** (the mirror's tie rule kept: the default stands
  first, so a tie decides nothing), and abstains only when the sample carries fewer than `MIN_PROBE_MARKS`
  marks to compare. The absolute floor is still computed and reported (`floor`, and the mirror's own
  `accepted` under `mirror`) so the difference between the two rules stays auditable.
* A face whose sample was too short stays **open for a later page**, and the collected strings accumulate
  up to `PROBE_MAX_ATTEMPTS = 3` pages inside the same byte cap: a face shown two lines per page never
  reaches 50 marks in one page, which is why 104 of part-1's probes abstained even after the first fix.

The effect, same books, same doors -- accepted faces, and the scanner on the output against `52d7a21`:

| part | probes / accepted before | probes / accepted now | pages differing from the base | impossible | stray | digit | orphan |
|---|---|---|---|---|---|---|---|
| 4 | 63 / **0** | 51 / **6** | 78 -> 80 | 114 -> 112 | 74 -> **55** | 875 -> 878 | 7,600 -> 7,609 |
| 1 | 136 / **0** | 105 / **45** | 869 -> 873 | 84 -> **64** | 3,632 -> 3,655 | 991 -> 1,001 | 9,528 -> 11,760 |

Read it as: the lane can now decide, and where it decides the class that means "this pair cannot be
Burmese" falls (`impossible` -2 and -20, -24% on part-1) while `stray` falls on part-4. It is not yet a
win -- `orphan` on part-1 went up 2,232, and that rise is older than this fix (it was 2,137 before it),
`digit` ticks up on both. What the run can now show, and could not before, is *which face* each page took
and with what score (`legacy_faces`/`family_probed`/`family_accepted`/`families` on every page record,
`family_score` and `marks` per face), so the next step is to group those numbers by the pages that got
worse rather than guess at them again.

## Root causes, in the order they should be fixed

Ordered by whether the cause can be seen in this checkout, which is the order
they were worked in.

1. **A legacy page keeps its visual order.** *Verifiable here*: the ordering
   stages, the lane instruction and a synthetic WinInnwa page are all in the
   tree. **Not fixed, and not a finishing bug** — see "Two-byte tokens are visual
   order, not fused codes": normalize moves only `ေ`/medials by design, so a
   mark that leads a run lost its base earlier up the chain (wrong code page,
   split line, unmapped glyph). The extra pass that made this look fixed is
   deleted; the root causes to chase are 2 and 3 and the code-page choice in
   `extract/legacy_judgement.py`.
2. **Lines split inside a cluster.** The run join breaks a line on a gap that
   falls between a base and its marks. The measure named for it, `short_share`,
   is computed by nothing in this repository — it came from a scratch aggregator
   that was never committed, so the claim cannot be re-checked here. What *is*
   in the tree is the join (`extract/pdf_extract._join_page_runs`, where the
   slot repair already lives) and the scanner's `orphan`/`stray` counts.
   General rule: a gap never splits a cluster.
3. **No-bridge fonts lose their marks.** Needs the embedded font program of a
   face the file gives no mapping for — the PDFs live on branch `trash`, so
   neither the cause nor a fix can be verified from this checkout. General rule:
   shape/name evidence, never a per-book rule; unrecoverable glyphs stay
   visible, never guessed.
