#!/usr/bin/env node
// Decode a PDF from outside-stream dictionaries only, and write the
// per-page instructions (the B.Parser/core/pdf/page-instructions.js
// pass). Stream bodies are never opened, so this works on a raw file
// the full stream parser has not prepared yet.
//
//   node tools-box/js/pdf-instructions.js [input.pdf] [output.txt]
//
// Defaults: the shipped sample PDF -> B.Parser/samples/sample-outside-stream.instructions.txt
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeOutsideStream, renderInstructions } from "../../B.Parser/core/pdf/page-instructions.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const input = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(repo, "B.Parser", "host", "Frontend", "frontend-bootstrap", "public", "samples", "sample.pdf");
const output = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(repo, "B.Parser", "samples", "sample-outside-stream.instructions.txt");

const decoded = decodeOutsideStream(input);
fs.writeFileSync(output, renderInstructions(decoded, { sourceLabel: path.relative(repo, input) }), "utf8");
console.log(`wrote ${path.relative(repo, output)} (${decoded.pages.length} pages, ${decoded.objectCount} objects, ${decoded.streamCount} streams skipped)`);
