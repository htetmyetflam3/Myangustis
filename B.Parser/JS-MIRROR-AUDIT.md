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
| `@core/docx/source.js` | `workflow/pipeline.py`; 80-paragraph chunks, font-based UNKNOWN/Unicode behavior compared. Pinned JS throws `orderZawgyi is not defined` for Zawgyi and `orderUnicode is not defined` for explicit Unicode branches; Python still converts them, so these are **not parity**. | T/P |
| `@core/docx/zip.js` | Python `zipfile` plus `extract/docx_extract.py`; ZIP internals, ZIP64 and error behavior not identical. | P |
| `@core/ocr/ocr.js` | `workflow/ocr.py`, `entry/manager.py`; JS uses Tesseract.js, Python CLI. Recognition and availability behavior are not identical. Routing and mocked results compared. | T/P |
| `@core/ocr/read.js` | `entry/manager.py`; input sniffing and validation differ. | P |

## PDF instructions, resource decoding and pages

| JS file | Python counterpart / finding | Status |
|---|---|---|
| `@core/pdf/instructions.js` | `workflow/pipeline.py`, `extract/pdf_fonts.py`, `normalize/judgement.py`; page facts and stem verdicts precede content; no complete exported instruction renderer/API. | T/P |
| `@core/pdf/legacy-judgement.js` | `extract/pdf_fonts.py` and routing; helper functions are not comprehensively compared. | P |
| `@core/pdf/method/decoder.js` | `extract/pdf_fonts.py`; per-resource maps, CID behavior and synthetic differential. | T/P |
| `@core/pdf/method/legacy/codepage-confirmed.js` | `extract/pdf_fonts.py`; synthetic direct-decoder and extracted-page behavior compared. | T/P |
| `@core/pdf/method/legacy/codepage-names.js` | `resources/font_names.py`, bundled font names. | T/P |
| `@core/pdf/method/legacy/codepage-pooled.js` | Repair candidate evidence has no equivalent live Python repair path; not called by `convert`. | N |
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
| `@core/runtime/finish.js` | `workflow/finish.py`, `workflow/pipeline.py`; selected PDF/DOCX records compared; Python PDF `clean` reports differ. | T/P |
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
| `@postprocess/beautify/clean.js` | `normalize/cleanup.py`, `normalize/unicode_evidence.py`; selected PDF finishing comparisons. | T/P |
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
| `@rule/unicode-evidence.js` | `normalize/unicode_evidence.py`; selected finishing comparisons, not all regional scripts. | T/P |

## Python-only surface and cross-checks

`entry/api.py`, `entry/cli.py`, `entry/prase.py`, `entry/interop.py`, `workflow/remote_queue.py`, `workflow/lane_log.py`, the launcher scripts and SSH ledger/Parquet/TXT collection are Python integration features; they are not proof of a one-to-one JS mirror. Package `__init__.py` files are wiring, not independent JS behavior. `normalize/legacy_order.py` and the historical evidence scripts have helper/draft functionality outside the pinned normal JS parse route. `output/fonts.py`, resource paths/maps, and Engine data access are Python-side implementations rather than Node subprocesses.

Evidence includes `test_decoder_js_parity.py`, `test_gsub_js_parity.py`, `test_visual_js_parity.py`, `test_pdf_finish_js_parity.py`, `test_pdf_stream_js_parity.py`, `test_pdf_image_coverage.py`, `test_pdf_ocr_js_parity.py`, `test_pdf_ocr_render.py` and `test_docx_js_parity.py`. JS is invoked by these tests only; production Python PDF decoding does not run JS or cache compiled JS. PDF OCR invokes the external Tesseract CLI. The PDF renderer oracle is optional and needs the exact JS rendering dependencies documented in `README.md`. Actual affected books and OCR recognition have not been compared to JS here.

### Python file index

These are the 43 Python files under `architecture/`; each is mapped individually so Python-only entry points are not mistaken for ports of a JS file. Package initializer rows denote wiring only.

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
| `normalize/legacy_order.py` | Python legacy slot helper, not the pinned normal JS page route. |
| `normalize/mm_score.py` | `@rule/mm-score.js`. |
| `normalize/pos_scan.py` | Parts of `@postprocess/init.js` and Engine binding; Python Engine API differs. |
| `normalize/rabbit.py` | `@rule/rabbit.js`, in memory rather than JS streaming. |
| `normalize/scan.py` | Structural scanning in `@postprocess/init.js`. |
| `normalize/unicode_evidence.py` | `@rule/unicode-evidence.js`. |
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
| `workflow/lane_log.py` | Python diagnostic logging. |
| `workflow/ocr.py` | `@core/ocr/ocr.js`, `@core/runtime/render.js`; different OCR and rendering engines. |
| `workflow/pipeline.py` | `@core/runtime/source.js`, `@core/docx/source.js`, `@core/requested.js`; reports and storage differ. |
| `workflow/remote_queue.py` | Python SSH queues, ledger and output collection; no one-to-one JS core file. |
