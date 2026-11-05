#!/usr/bin/env node













import path from "node:path";
import { Manager } from "../main/manager/index.js";
import { DEFAULT_OUTPUT_DIR } from "../_path.js";
import { muteAdvisories } from "../../Architecture/host/advisory.js";

function parseArgs(argv) {
  const [first, second, third] = argv;
  if (first && first.trim().startsWith("{")) {
    return JSON.parse(first);
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
  const args = process.argv.slice(2);
  if (args.includes("--quiet")) muteAdvisories();
  const job = parseArgs(args.filter((arg) => arg !== "--quiet"));
  if (!job?.inPath && !job?.data) {
    console.error("usage: node scraper-entry.js [--quiet] <inPath> <output> [filename]");
    process.exit(2);
  }
  const manager = new Manager({ outputDir: job.outDir ?? DEFAULT_OUTPUT_DIR });
  try {


    const result = await manager.dispatch(job, "scraper");
    process.stdout.write(JSON.stringify(result));

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
