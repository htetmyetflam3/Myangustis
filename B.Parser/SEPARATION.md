# B.Parser — separation sketch (work in progress, NOT final)

This session is a **sketch restructure**: files were *moved* (`git mv`, history
preserved), nothing was deleted. Logic was not rewritten. Further clean-up is
expected task-by-task; this file is the map for those tasks.

Target shape decided with the owner — **4 parts** inside `B.Parser/`:

```
B.Parser/
  index.js        public front door / integration point (wiring only, no logic)
  _path.js        shared path resolver (points at the layout below)
  _index.js       repo-workspace re-export (unchanged)

  core/           1. CORE parsing logic
  host/           2. HOST (site) — left exactly as-is in this task
  extend/         3. EXTEND — extended functions intended to integrate
                     with other services
  integration/    4. INTEGRATION — caller glue, split in two:
    host/            core <-> site host
    services/        core <-> other services (scraper, socket, local, ...)
```

## 1. `core/` — pure parsing logic

Moved from `B.Parser/main/core/`; data moved from `B.Parser/main/jason-map/`.

| dir | contents |
|---|---|
| `core/pdf/` | PDF lexer/objects/pages/fonts/content/render/writer, pdf-stream |
| `core/docx/` | DOCX extract/manual handling |
| `core/` (root units) | detect/clean/zawcode-order/legacy-order/stream-replace, rabbit, pylib, provenance, json-map, … |
| `core/beautify/` | beautify, scan (POS via extend bind-engine), repair, vector (SVG), raster (OCR result), `repair/` modules |
| `core/decoding/` | flow design: decide, source-decoding, finalized-cmap, runtime |
| `core/codepage/` | legacy codepages, TTF cmap/gsub/glyf, vote, fonts |
| `core/io/` | read/write/emit/render/zip/qpdf/decrypt |
| `core/ocr/` | OCR entry/ops (+ `relaxedsimd.cjs`) |
| `core/manager/` | Manager, worker pool, runtime, OCR helpers |
| `core/api/` | dispatcher, bind-parser, stream-reader (see violations) |
| `core/limits/` | `local.js` only — the site profile moved to integration |
| `core/jason-map/` | all JSON maps/evidence (was `main/jason-map/`) |
| `core/model/`, `core/repair/` | OCR traineddata, repair SVG sheets |

Fixed while moving (path-only, no logic change):
`core/codepage/codepage-visual.js` imported `../../_path.js` *as JSON*; it now
imports `../jason-map/visual-unicode-glyph-evidence.json`, which is what its
`evidence.witnesses` code always expected.

## 2. `host/` — site host, unchanged

`host/Backend/**` + `host/Frontend/**` were **not moved or edited** in this
task, per the owner's "host stay as is".

Known stale references inside host, left for a host task (do not fix blindly):
- `host/Backend/file/paths.js` → `../../../B.Parser/_path.js` (resolves to a
  non-existent `B.Parser/B.Parser/_path.js`)
- `host/Backend/gateway/queue/analysisFinalize.js` →
  `../../../../B.Parser/main/parser/index.js` (old front door; new one is
  `B.Parser/index.js`)

## 3. `extend/` — extended functions for other services

Kept in place; only their `../main/core/…` imports were repointed to `../core/…`.

- `pipeline.js` — extended page/docx processing built on core
- `codepage-resolve.js` — legacy/vector codepage resolution built on core
- `classify.js`, `04-classify.js` — scraper-source classification
  (**exact duplicates of each other** — dedupe is a later task, not done here)
- `caller-policy.js` — caller (site/scraper/local) policy
- `python-entry.js` — **omitted, see Python note below** (import path only)

## 4. `integration/` — caller glue

### `integration/host/` (was `core/init/`, `core/limits/site.js`)
- `init.js` — `createPdfParser` / `createDocxParser` (site entry)
- `dispatch.js` — `SiteDispatch`
- `limits.js` — site caller limit profile (was `core/limits/site.js`)

### `integration/services/`
- `scraper-entry.js` — scraper service entry (was `extend/`)
- `parse-bridge.js` — CLI/bridge producing verdict JSON; now loads the front
  door at `B.Parser/index.js` (was `B.Parser/main/parser/index.js`)
- `dispatcher-server.js` — long-running HTTP dispatcher service (was `core/api/`)
- `lazy-dispatcher.js`, `lazy-client.js`, `lazy-parser.sh` — on-demand Unix
  socket dispatcher (was `core/api/`); they now import
  `../../core/api/dispatcher.js`
- `parser-dispatcher.service` / `.socket` — systemd units; `ExecStart` updated
  to `integration/services/dispatcher-server.js` (was a stale
  `main/parser/js/shared/28-dispatcher-server.js`)
- `myangustis-parser.socket` / `.service` — systemd socket activation for
  the Unix socket: systemd owns `/tmp/myangustis-parser.sock`, starts
  `lazy-dispatcher.js` (fd 3) on connection, dispatcher idle-exits.
  Enable only the `.socket`. `dev-dispatcher.sh` is the dev twin
  (`systemd-socket-activate` re-arm loop; root script `dev:parser`)
- `local/stream.js`, `local/init.js`, `local/entry.js` — local-caller dispatch
  streams (was `core/local/`, `core/init/entry.js`). Three near-duplicate
  `LocalDispatchStream` implementations — dedupe is a later task.

### Front door
`B.Parser/index.js` (was `core/entry.js`) re-exports only wiring:
`createPdfParser`, `createDocxParser`, `SiteDispatch`, `LocalDispatchStream`,
`Manager`. `package.json` `"main"` now points at it.
The old barrel also re-exported `closeParserManager` / `parserModuleAvailable`,
which do not exist in `init.js` — those broken re-exports were dropped; no
implementation was deleted.

## Dependency rule (target) and known violations

Target: `core` imports nothing from `extend/`, `integration/` or `host/`;
`extend` may import `core`; `integration/*` may import `core` + `extend`;
`host` should import only through `integration`/the front door.

**Still violated on purpose in this sketch (next tasks, in suggested order):**
1. `core/manager/runtime.js` → `extend/pipeline.js`
   (`loadDetector`, `processDocxForMethod`, `buildFinalPages`)
2. `core/pdf/pdf-stream.js` → `extend/pipeline.js`
   (`streamPdfPages`, `processPageRecord`, `collectPdfResult`, `markPdfImagePages`)
3. `core/api/dispatcher.js` → `extend/caller-policy.js` (`normalizeCaller`)
   — and `core/manager/manager-core.js` ⇄ `core/api/dispatcher.js` are
   mutually dependent; dispatcher/manager may belong in integration, not core.
4. `core/beautify/scan.js` now reaches the Engine only through
   `extend/bind-engine.js`; direct `Architecture/Engine/…` / `index-path.js`
   coupling inside core is gone.
5. `core/api/parser_dispatcher_client.py` — Python client, omitted (below).

## Omitted / untouched

- **Python parser is omitted from this restructure** (owner: treat as never
  run). `B.Parser/main/Python/**` was not moved, edited or wired.
  `extend/python-entry.js` and `core/api/parser_dispatcher_client.py` only
  received/were carried by mechanical moves; they are not part of the sketch.
- `B.Parser/main/` still remains, holding only the omitted Python tree and
  `main/parser/{js/make-index-font11.js, jason-map/vector/*.svg}` build
  tooling. Emptying/removing `main/` is a later task.
- `host/**`, repo-level callers (`D.Scraper`, `test/`, `tools-box`)
  still reference the old `main/parser/…` layout in places — out of scope for
  this task; update them task-by-task against `B.Parser/index.js`.

## Verification for this task

- `node --check` passes for every JS file under `core/`, `extend/`,
  `integration/` and `index.js`.
- Every relative import in those parts resolves to a real file.
- `B.Parser/index.js`, `integration/host/init.js`,
  `integration/services/local/stream.js`, `core/codepage/codepage-visual.js`
  import successfully.
- Full parse smoke test not run: dependencies are not installed in this
  checkout (`fflate` etc.), and the dispatcher's owner-lane
  `budgetFor() → Infinity` timeout overflow is pre-existing untouched logic.
