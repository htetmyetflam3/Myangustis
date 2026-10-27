## [Unreleased] - 2026-10-28
### Changed / Fixed / Removed
- Keep workspace setup create-only: replace reset helpers with `ensureWorkspace` and preserve existing directories and files on repeated runs.
- Retain existing Engine logs and append normalization debug session headers instead of truncating logs at startup.
- Remove Site startup/hourly artifact deletion; queue eviction now expires records without deleting their input or output files.
- Preserve React build output on rebuild and exclude runtime workspaces from the bootstrap clean command.
- Add seven focused preservation tests, including real detached Engine/host path imports. Full application startup was not exercised.
