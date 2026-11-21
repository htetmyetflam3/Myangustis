# Proofreading

This workspace component provides chapter reading, English-review context,
name checks, and draft storage. The current review workflow is English-only; it
reads existing text and does not generate or rewrite translations.

## Run

From the repository root:

```sh
uv sync --package myangustis-proofreading
uv run --package myangustis-proofreading \
  python C.Proofreading/architecture/tools/mcp.py --help
```

The MCP server entry point is `C.Proofreading/architecture/tools/mcp.py --serve`.
Chapter text and reference files are under `architecture/content/`. Follow
[`architecture/workflow.md`](architecture/workflow.md) for the review steps;
startup constraints are in
[`architecture/tools/quality/START.md`](architecture/tools/quality/START.md).

**Tooling note:** these commands currently fail in this checkout:

- `--inspect`: missing `audit_source`.
- `--read`: missing `agent_work`.
- `--compare-english` and `--previous-burmese-context`: missing `agent_english`.

Restore the missing modules before relying on automated review.
