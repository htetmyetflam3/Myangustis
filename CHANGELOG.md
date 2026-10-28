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
