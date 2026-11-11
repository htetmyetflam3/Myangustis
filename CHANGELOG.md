# Changelog

## 2.0.2 — 2026-11-11 — test record restored to green

### Test record (the last full run)

Command: `npm test` (`node --test test/node/**/*.test.js`), Node 22.22.3, from a clean
checkout with dependencies installed (`npm install`).

```
tests 317 | pass 295 | fail 0 | skipped 22
```

Per suite:

| Suite  | Tests | Pass | Fail | Skipped |
| ------ | ----: | ---: | ---: | ------: |
| site   |    99 |   99 |    0 |       0 |
| parser |   134 |  116 |    0 |      18 |
| engine |    42 |   42 |    0 |       0 |
| paths  |    30 |   30 |    0 |       0 |
| tools  |    12 |    8 |    0 |       4 |

Before this record the same command reported 121 tests / 45 pass / 73 fail / 3 skipped:
most suites could not even import, because the tests and the host still named the
pre-flattening layout (`F.Site/`, `B.Parser/main/parser/`, `B.Parser/extend/`).

Skipped tests, with reasons (all visible in the run, nothing silently dropped):

- 4 in `tools-test` — `qpdf` is not installed in this environment; every PDF lane
  prepares through it, so those tests report the prerequisite instead of a false failure.
- 1 in `parser-test/parser-layout` — the shipped 100-page sample, same `qpdf` prerequisite.
- 18 in `parser-test` (`zawcode-order`, `world-word`, `zawgyi-cmap`,
  `visual-unicode-glyphs`) — the assertions describe the removed detector/Manager
  pipeline (page-level detector injection, the `posScan` Manager sidecar, the
  `ကမ်ဘာ`→`ကမ္ဘာ` world-word rule). The flattened chain decides pages from the font
  stem and keeps its reports in the parse result, so these need re-derivation against
  the current door rather than a rename.

### Fixed

- **Host imports resolve again.** `B.Parser/host` imported four modules the flattening
  removed. They are back as thin bridges, not copies:
  `B.Parser/integration/host/init.js` (`createPdfParser`/`createDocxParser`/
  `closePraserManager` over `InitInput` → `parseDecoding` → `writeOutputFile`),
  `B.Parser/integration/services/trigger-request.js`,
  `B.Parser/init/bind-input.js` (passthrough to `InitInput`) and
  `B.Parser/core/io/render.js` (`writeDocxPlain` over `writeDocxMarkup`).
- **`B.Parser/host/Backend/file/paths.js` names the current layout.**
  `PARSED_ROOT`/`PARSER_DIR` → `B.Parser`, `PRASER_MANAGER`/`PRASER_JS` → `B.Parser/index.js`,
  maps → `B.Parser/@jason-map`, model → `prised/@core/ocr/model`, fixtures → the shipped
  samples. `validatePraserAssets()` now passes again, so the Site boots.
- **`B.Parser/host/_index.js` reached one directory too shallow** (`../index-path.js`
  resolved to `B.Parser/index-path.js`), so the Site always fell back to its local
  workspace. It now imports `../../index-path.js`, and the shared `Junk/` workspace
  resolution works.
- **Mark ordering inside a cluster (`prised/@postprocess/beautify/clean.js`).**
  `reorderMarks` and the ZawCode unmixer sorted marks by `MARK_ORDER`, which is the
  Engine's slot order (`ေ` = 2, medials = 19–22) and therefore turned `ကြေ` into `ကေြ`
  and `လမ်း` into `လမး်`. Cluster marks now sort by modern Burmese syllable order
  (medials → `ေ` → vowels → `ံ` → `်` → `့` → `း`), and a mark that belongs earlier in the
  syllable can no longer attach backwards, so `လာပြီး` and `ေသလမ်း` come out right.
- **POS report writer restored (`prised/@postprocess/init.js`).** `PosScanner.finish(path)`
  and `scanTextWithPos(text, { outputPath })` write `<output>.unknown.txt` again
  (`Page N, line L` / `Original:` / `Context:`), keeping the scan advisory and the
  conversion untouched. The CLI uses the same writer for its sidecar.
- **`tools-box/js/pipeline-cli.js` runs on the current door.** The file had been left at
  `tools-box/00-pipeline-cli.js` with imports written for `tools-box/js/`; it is back in
  place and its `parser local` calls `InitInput → parseDecoding → writeOutputFile`
  instead of the removed `Manager.dispatchStream`.
- **First-use guidance names a real door.** `B.Parser/index.js` now emits the once-per-user
  advisory through `Architecture/host/advisory.js`; the middle-chain advisory in
  `runtime/finish.js` no longer points at `Manager.dispatchStream`.
- **Boot self-test list (`Backend/selftest.js`)** pointed at `Parsed/parser/test/*.test.mjs`;
  it now lists the `test/node/**` files that actually exist.
- **Tests repointed** to the flattened tree (`prised/`, `host/`, `@rule/`, `@postprocess/`),
  with the `streamPdfPages(source, log, options)` / `processPageRecord(rec, cleanup, log,
  layout, encoding)` signatures and the `selectPageDecision` / `markOrderAligned` homes.

### Retired test files (kept for reference, not run)

Moved to `test/node/retired/*.test.js.retired` — each tested a module the flattening
deleted, so they cannot import:

`caller-policy`, `owner-limits`, `pdf-file-stream`, `scan-placement`, `qpdf`,
`zawcode-layout`, `legacy-kinzi`, `wininnwa-global`, `vector-unknown`, `vector`.

`legacy-kinzi` and `wininnwa-global` pinned `legacyAyarToUnicode`, whose job moved into the
per-resource legacy decoding lane; `vector*` needed the SVG sheet directory that is not in
this tree; the rest needed `Manager`, the worker pool, `worker/pdf-stream`, `read/pdf-tail`,
`write/emit`, `read/page-store`, `write/pdf-text-sink` or `extend/caller-policy.js`.

### Still open

- The ZawCode lane needs new coverage: its "stored order" expectations (`ကာေ`) describe the
  pre-flattening convention, while the current unmixer emits Unicode order (`ကော`).
- `tools-box/js/pipeline-cli.js parser local` and the Site's HTTP PDF lane need `qpdf` on
  the machine; they cannot be exercised without it.
