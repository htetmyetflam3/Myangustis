# Layout rules to verify

Slots below are converter inputs, not necessarily PDF bytes or physical keys.

## WinInnwa

| Slot: decimal / hex | Character | Current decision | Verify |
|---|---|---|---|
| 36 / 0x24 | `$` | Unmapped | Earlier `ွှ`; other witness `ကျပ်` |
| 37 / 0x25 | `%` | Unmapped | Earlier `ဏ` was questioned |
| 124 / 0x7C | `\|` | Unmapped | Earlier `ျွ`; other witness `ဋ္ဌ` |
| 181 / 0xB5 | `µ` | Unmapped | Earlier `%`; other witness `!` |
| 234 / 0xEA | `ê` | Unmapped | Earlier `ှ`; other witness `ြု` |
| 87 / 0x57 | `W` | `ျွှ` | Original version; not seen in surveyed PDFs |
| 166 / 0xA6 | `¦` | `္ထ` | Original version; not seen in surveyed PDFs |
| 191 / 0xBF | `¿` | `?` | Original version; not seen in surveyed PDFs |
| 201 / 0xC9 | `É` | `္တွ` | Original version; not seen in surveyed PDFs |
| 216 / 0xD8 | `Ø` | `င်္ိ` | Original version; not seen in surveyed PDFs |
| 231 / 0xE7 | `ç` | `,` | Original version; not seen in surveyed PDFs |
| 240 / 0xF0 | `ð` | `ိံ` | Original version; not seen in surveyed PDFs |

## Ayar

| Slot: decimal / hex | Character | Current decision | Verify |
|---|---|---|---|
| 199 / 0xC7 | `Ç` | `င်္ီ` | Original keyboard slot; observed in grammar text |
| 231 / 0xE7 | `ç` | `င်္` | Original keyboard slot |
| 95 / 0x5F | `_` | Empty output | Original keyboard behavior |
| 48 / 0x30 | `0` | `၀` | `ဝ/၀` in context; no global replacement |
| 119 / 0x77 | `w` | `၀` | `ဝ/၀` in context; no global replacement |

## Shared-page Unicode order

- Determine the order-check and known-Unicode guard before changing the unknown-font Rabbit fallback. On source part 3, page 434, the `Myanmar2`-named resource was classified as unknown; visual-order text and unresolved glyph codes left the page unaligned after the earlier six swaps. For example, `ေပြာင်း` became `ပေြာင်း`, while Rabbit changed the already-correct `ရင်း` to `ရငျး`. Verify the needed behavior against full-font evidence.

## Paused handoff — 2026-11-03

### JavaScript PDF-to-SVG and recovery

- The user wants a hand-rolled JavaScript PDF-to-SVG path without the MuPDF AGPL dependency. The new exporter, glyph recovery and Parser integration are **not implemented**; continue only when the user resumes the flow. The existing `svgout/` prototype is experimental and remains unwired. `svgout/make-line.js` does not run Python, but its input contract and messages still refer to the Python exporter; replace that dependency as the new flow is defined. `B.Parser/extend/python-entry.js` is the general Python-to-Manager bridge, not an SVG entry; do not remove it as an SVG change.
- Proposed flow: Manager owns the private job directory and routes recovery requests; the extraction worker spools each page once; Scan consumes Engine POS per line, requests recovery for candidates, and appends the chosen line once to a temporary text file. Manager then runs the output writer and source linearization. This Scan-writer split was recommended, not yet implemented or approved as final.
- Keep one file-backed document handle, use page numbers and stable line/run references, cache source page commands and shared resources before text-piece deduplication, export a flagged page once and reuse it for its lines. Preserve raw text-showing code bytes before ToUnicode separately from CIDs, GIDs and Unicode; retain stream boundaries, fonts, forms, images, paint order, transforms, clipping, page geometry and rotation. Do not reload or collect the whole PDF through Manager/provider; release page objects after use.
- The current text extractor is not a faithful SVG renderer: `PdfPagePieces` deduplicates pieces and `shownStrings` omits numeric `TJ` adjustments. Part 9 page 63 contains two same-origin glyph paints with different clips; preserve both occurrences and evaluate visibility rather than silently dropping either. Four uses on that page remained unframed in the prototype. Prior eight-page/64-output parity checks are not proof of complete PDF fidelity.
- Previously evaluated exporters are not established drop-ins: PDF.js/canvas collapsed a distinct clipped occurrence, `pdf-into-svg` displaced a glyph, `document-svg` distorted an image/added dots, and the Aspose trials did not preserve the required original-page output. Do not repeat or promote them as verified fixes without new evidence.
- Preserve the four-rule line frame and `trash` presentation; page coordinates must be converted consistently between PDF y-up and SVG y-down. Raster/image and unsupported-SVG recovery must warn even in quiet mode; OCR remains an option. A near-full-page image can require OCR despite a text footer. If matching is ambiguous, retain the original line and report it instead of guessing.
- Current `spoolPageContent` removes its command file before the page is returned, and current POS finish runs after source linearization and output writing. The proposed recovery flow requires a different cache lifetime and explicit worker request/response messages. Linearizing a PDF does not insert corrected text. Do not add an exporter dependency, wire SVG into Parser or redesign Engine without authorization.

### POS scan and source review

- Review `C.Proofreading/main/content/review/pdf-parser-flagged-lines-9-parts.txt` against the **original** PDFs, not the representative sample. The text-only scan covered 5,098 pages; its 91,832 flagged lines and 332,160 tag-free contexts are POS-unknown candidates, not confirmed errors. Contexts were selected before tags were removed; no OCR was run. The original PDFs are not tracked in the current tree; their Git blob IDs are in the report.
- Engine POS has no source offsets or cross-line context, and its scan input may omit Latin. Do not substitute POS output for the original normalized line, infer a glyph solely from a POS token or assume an unknown token is broken. Preserve spaces, converter/Engine output, protected characters and the original when recovery is uncertain. The old vector-repair builder is not wired into the normal scan; there is no automatic POS → old vector repair → rescan today.
- For PDFs, `method:"manual"` sends images to OCR and text to parsing; `job:"null"` alone does not turn on OCR, and `job:"ocr"` accepts only the default method. Recognize one-to-four digits and `Page-1` as page numbers. The desired recovery path must not silently change these contracts or assume a deployed Site route was tested.
- Part 9 page 46 is Zawgyi; book repair remains deferred. On the cited page 424, `ေ` follows the preceding `တ်`; do not invent a typo or mapping error. Keep the known-Unicode guard and the part-3-page-434 fallback uncertainty above unchanged until real source/full-font evidence resolves them.
- Previously observed issues still need source-based review: part 1 page 3's overprinted title was duplicated, part 2 page 1315 retained an unresolved glyph mapping, and part 8 page 3's raster OCR was inaccurate and repeated a footer. Column order and repetitions are not fully verified; do not silently deduplicate or discard them.

### ZawCode and font evidence

- Verify the eight supplied ZawCode swaps on original PDF pages that actually choose ZawCode: the sampled part-9 pages 46, 63 and 71 chose Rabbit, so those samples do not validate the swaps. `B2` may equal `B`, `X` is never `ေ`, Engine bases include `ဣ`, and the old `3A 37/38` stopgap and proposed `31 B 3C 2C` are not rules.
- Ignore U+200B for lane selection; trim it only for the selected ZawCode conversion. Rabbit receives the original decoded text. Preserve one method per page, Unicode protection, the 2,048-byte decompressed checkpoint and warning/resumption when text appears later.
- Resolve the PDF `17/25` CID/GID identity only from full-font and source-neighbor evidence; the user questions whether `17` appears in the supplied maps. Treat `18/1C` as cluster-local, distinguish glyphs from keys/slots, and do not invent automatic alternative substitutions. For Ayar/Win, pair a base and `ျ` before pre-base `ေ` only where the witnessed slots/context support it. Retain the unresolved WinInnwa/Ayar slots above; Win `0x37` is also unresolved. Do not route solely by font hash/family, assume 255 keys or guess GIDs.
- If keyboard/sample work resumes, extract and reparse Ayar/Win codes first and show errors; other families are deferred. Preserve all 40 layouts and the user's distinctions, including `ဝ/၀`, `ဂ/၈`, `ရ/၇`, `တိံ`, `ူ/ုု`, `င်္ီ` and kinzi. For A4 samples use grouped vowels, single dots, small margins/extra pages and the user's forms, not a 903-word dump; `စျ` is U+1005 U+103B, not `ဈ`, and include `စျေ` and witnessed `ဈေ` without an invented tone. Use `ာ`, not `ါ`, with `ျ/ြ`. Shared Unicode fallback is not proof of historical typing. KeyMagic and the seven-TXT vector/training run remain stopped unless explicitly resumed.

### Other paused work and boundaries

- Downloader/`.l2s` work is stopped; there is no live SSH session. Do not delete unknown backing files or resume it without direction. If resumed, use the root `.env`/`SSH_DIR`, one SSH/output at a time and filename skips; no ledger, hashes, discovery or retries.
- Keep Site/frontend upload and quota work, Scraper, dictionary, Pali, representative PDF/output and unrelated tests out of the PDF-to-SVG task. The CLI must not start or chain servers. Only trusted IDs or caller-opened PDF/DOCX streams bypass public caps.
- Do not print or change keys, plaintext master data or caches; do not edit Engine/WASM or assume their source and binary are equivalent. Use the existing `secure.js` path. Current Engine inspection was limited, not a full audit.
