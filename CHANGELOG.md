## [Unreleased] - 2026-10-28
### Changed / Fixed / Removed
- Keep workspace setup create-only: replace reset helpers with `ensureWorkspace` and preserve existing directories and files on repeated runs.
- Retain existing Engine logs and append normalization debug session headers instead of truncating logs at startup.
- Remove Site startup/hourly artifact deletion; queue eviction now expires records without deleting their input or output files.
- Preserve React build output on rebuild and exclude runtime workspaces from the bootstrap clean command.
- Add seven focused preservation tests, including real detached Engine/host path imports. Full application startup was not exercised.

## [Unreleased] - 2026-10-28 — Import cleanup and test maintenance
### Changed / Fixed / Removed
- Remove unused logging imports, queue filesystem import, tree path helper import, and redundant Parser writer/helper imports. Active extraction and output writers remain in place.
- Delete `wasm-kit/`; retain the deployed Engine WASM/runtime files.
- Correct stale `D.Parser` references in tests and Site-to-Parser integration, shared font locations, moved PDF fixtures, and the upload-metadata test import.
- Update queue-status expectations to include the current task/leg/completion fields.
- Remove the retired browser-extraction `silent-original` suites (both copies) and the obsolete standalone startup-chain suite. These expected superseded upload/startup contracts; current upload-metadata, signature, queue and Engine-roundtrip coverage remains.

**All tests in `npm test` pass except 8 explicitly skipped: 212 passed, 0 failed.**

- Six sealed-dictionary tests require `MASTER_JSON_KEY`, which is unavailable in this environment; they remain enabled automatically when that key is supplied.
- Two existing skips require unavailable PDF/OCR fixtures.
- This result covers the complete Node suite invoked by `npm test`, not an unexecuted Python or deployed-service suite.

## [Unreleased] - 2026-10-28 — Engine data and cleanup
### Added
- Add a JavaScript bridge for Python callers to access the engine-owned sealed data.
- Add a JavaScript comment cleaner that preserves ESLint directives and meaningful empty-block comments.
### Changed / Fixed / Removed
- Move sealed engine data to `Architecture/Engine/.data`, with lazy access through the shared path chain and no root `.data` fallback.
- Route Python POS comparison and tagging through the engine instead of maintaining a separate Python POS code map.
- Remove the obsolete scraper run-end text flush; per-file upload processing continues to segment and write Parquet rows.
- Remove ordinary JavaScript comments while retaining ESLint and tool directives, and remove the obsolete package-removal explanation from the license.
## [Unreleased] - 2026-10-28 — Engine master cache
### Changed / Fixed / Removed
- Route master-data consumers and fingerprint requests through the shared engine data entry, including the proofreading register tool.
- Cache parsed master data in memory with caller isolation and source/key invalidation; retain the encrypted disk cache and existing verified tree caches.
- Add synthetic encrypted-master and tree-cache regression tests.

## [Unreleased] - 2026-10-28 — Python workspace environment
### Changed / Fixed / Removed
- Load the Python workspace environment through `index-path.py`, using the same root and engine-data sources and precedence as the Node workspace entry.
- Migrate the Python tools from `secretloader.py` and remove that obsolete loader; add Python/Node environment parity tests.

## [Unreleased] - 2026-10-28 — Parser JSON maps
### Changed / Fixed / Removed
- Load parser JSON maps on demand through one source-aware in-memory cache, with isolated return values and regression tests.
- Correct parser workspace and scraper integration paths to `B.Parser`; retain the existing `E.Scraper` workspace.

## [Unreleased] - 2026-10-28 — Shared logging and proofreading paths
### Changed / Fixed / Removed
- Consolidate server-side logging implementations and helpers into root `logen.js`, accessed by components through their index/path chains; leave browser-side logging unchanged.
- Move the proofreading tagger into `C.Proofreading/main` and resolve its engine binding through the proofreading path chain.
- Preserve shared event-bus behavior and append-only engine logs; add logging-chain and relocated-tagger tests.

## [Unreleased] - 2026-10-29 — Streaming engine bridge
### Changed / Fixed / Removed
- Replace signature dispatch with one flag-driven, string-input `BindEngine`: syllables stream per line, POS streams paired syllable and tagged views, and hashed POS returns the guard placeholder.
- Limit hashed callers to two active slots and preserve the old five-file debug output under `Junk/output`; retain the previous bridge implementations in the tools archive.
- Migrate the scraper, site, proofreading tools and tools API to the new boundary. Public tokenizer processing now accepts text in POST bodies; the former file-readback GET routes return 405.
- Update caller, API, debug, workspace and environment-chain tests for the streaming contract.
### Verification
- Node: 252 tests, 244 passed, 8 skipped; both frontend builds passed with existing bundle-size warnings.
- Python: 316 passed, 17 failed, 6 skipped, 8 errors and 35 subtests passed; failures and collection errors match the prior baseline involving unavailable source modules and fixtures.
- Targeted ESLint and the bridge, caller, public API, tools API and environment-chain tests passed.

## [Unreleased] - 2026-10-29 — Proofreading path and DOCX repairs
### Changed / Fixed / Removed
- Regenerate `episodes.docx` from the tracked Chinese and Burmese sources using the verified 195 chapter pairs; restore the title CLI regression and fix the moved DOCX generator imports and source paths.
- Point review, names, chapter-map, translation and dictionary inventory paths at their current directories; make the MCP entry discover its split modules and generate client configs for the actual CLI.
- Use the engine mapper loader for imposter-table tests, retain the sealed dictionary tests and report loader failures, and update grammar tests for JSON without the retired runtime guard. The comparison POS view remains unported.
- Replace the unrelated `docx` dependency with `python-docx`, as used by the generator.
### Verification
- Node: 252 tests, 244 passed, 8 skipped. Targeted Python: 128 passed. Targeted ESLint and `git diff --check` passed.
- Full Python: 333 passed, 11 failed, 3 skipped, 4 collection errors, and 35 subtests passed. Six failures need `MASTER_JSON_KEY`; one needs the unported comparison POS view; four failures and four collection errors involve missing `agent_work`, `agent_english`, or `audit_source` modules. These tests remain in place.

## [Unreleased] - 2026-10-29 — Remove tests for absent modules
### Changed / Fixed / Removed
- Remove tests that require the absent `agent_work`, `agent_english` or `audit_source` modules; retain independent chapter-selection, title, verse and CLI-alias coverage.
### Verification
- Focused Python: 34 passed, 18 subtests passed. Full Python: 343 passed, 7 failed, 3 skipped, 35 subtests passed; six failures require `MASTER_JSON_KEY`, and one requires the unported comparison POS view. No collection errors.
- Node: 252 tests, 244 passed, 8 skipped.

## [Unreleased] - 2026-10-29 — Remove root Bridge directory
### Changed / Fixed / Removed
- Remove the root `Bridge/path.js` re-export and its directory; callers use the shared engine entry instead.
- Remove the obsolete schema and bootstrap references, and verify the root Bridge directory stays absent.
### Verification
- Node: 244 passed, 8 skipped; targeted engine and logging tests: 14 passed. Schema JSON, targeted ESLint, shell syntax and `git diff --check` passed.
- Python: 343 passed, 7 failed, 3 skipped and 35 subtests passed; the same six sealed-dictionary key failures and one unported comparison POS failure remain.
