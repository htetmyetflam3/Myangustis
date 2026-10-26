#!/usr/bin/env node
// scraper-entry.mjs — the ONE JS seam the Python scraper calls.
//
// The scraper no longer carries its own skip/parse decision: it shells into
// here and the Manager (the bridge) applies the 'scraper' policy — Unicode,
// ZawCode and OCR parse; wininnwa/ayar/vector old-font PDFs come back as a
// terminal { skipped: true } result, exit code 0, never an exception.
//
// Usage (positional, matches the subprocess shape scan.py already uses):
//   node scraper-entry.mjs <inPath> <output> [filename]
// Optional contract metadata (jobToken/submitId/...) via env JSON:
//   PARSER_JOB_META='{"jobToken":"...","submitId":"..."}' node scraper-entry.mjs ...
//
// Or pass a full job object as a single JSON argv token.
import path from "node:path";
import { Manager } from "../main/parser/manager.mjs";
import { DEFAULT_OUTPUT_DIR } from "../main/parser/core/paths.mjs";

function parseArgs(argv) {
  const [first, second, third] = argv;
  if (first && first.trim().startsWith("{")) {
    return JSON.parse(first); // full job object
  }
  const metaEnv = process.env.PARSER_JOB_META;
  const meta = metaEnv ? JSON.parse(metaEnv) : {};
  return {
    job: "extracting",
    method: "default",
    output: second || "txt",
    inPath: first,
    filename: third || (first ? path.basename(first) : null),
    meta,
  };
}

async function main() {
  const job = parseArgs(process.argv.slice(2));
  if (!job?.inPath && !job?.data) {
    console.error("usage: node scraper-entry.mjs <inPath> <output> [filename]");
    process.exit(2);
  }
  const manager = new Manager({ outputDir: job.outDir ?? DEFAULT_OUTPUT_DIR });
  try {
    // 'scraper' is the whole reason this entry exists: the policy lives in the
    // manager/caller-policy, not in Python. The result always echoes metadata.
    const result = await manager.dispatch(job, "scraper");
    process.stdout.write(JSON.stringify(result));
    // A policy skip is a normal outcome, not a process failure.
    process.exit(0);
  } catch (err) {
    process.stdout.write(
      JSON.stringify({ skipped: false, action: "error", error: err?.message ?? String(err) }),
    );
    process.exit(1);
  } finally {
    await manager.close().catch(() => {});
  }
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) main();
