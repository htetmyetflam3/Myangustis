# English review workflow

The active track is English-only. Do not call a translator or regenerate the
stored English or Burmese files. This is the intended review process, but it is
blocked by missing modules:

- `mcp.py --inspect`: `audit_source`.
- `mcp.py --read`: `agent_work`.
- `mcp.py --compare-english` and `--previous-burmese-context`: `agent_english`.

Restore these modules before running an automated review.

1. Check chapter coverage with `mcp.py --inspect` when needed. If the requested
   chapter or either English version is missing, or paragraph alignment fails,
   stop and report the limitation; do not fill gaps from old files.
2. Compare one ten-paragraph window at a time:

   ```sh
   uv run --package myangustis-proofreading \
     python C.Proofreading/architecture/tools/mcp.py \
     --compare-english 194 --start 1 --count 10
   ```

   Read the alignment metadata first. Continue at `window.next_start`; do not
   request or paste a whole chapter.
3. Use Chinese as the source of meaning. Treat the local machine translation
   as a fallible witness; keep accurate existing API English unchanged.
4. For recurring names or terms, use bounded `--previous-burmese-context` only
   as a clue. The retained Burmese text has encoding damage; verify any reading
   against Chinese and do not infer a spelling from a damaged match.
5. Report only concrete English corrections or material ambiguities, with the
   paragraph number and a short reason grounded in Chinese. Do not edit the
   retained translations as part of this review.
