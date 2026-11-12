/*
The public front door of B.Parser. Wiring only - no parsing logic.

For almost everything, use the one function:

  import { convert } from "./index.js";        // or from "B.Parser"
  await convert("in.pdf", "out.docx");
  await convert("in.docx", "out.txt");
  await convert({ bytes, filename: "in.pdf" }, "out.pdf");

convert() runs the whole chain (take in -> prepare -> parse -> write
the requested file) and returns { file, from, to, pages, counts }.

The three stages are also exported individually for callers that
need to compose them themselves (e.g. parse many files, write later):
  InitInput        stage 1: take a file in and prepare it
  parseDecoding    stage 2: prepared file -> marked-up page strings
  writeOutputFile  stage 3: page strings -> .pdf / .docx / .txt file

See MAP.md for the one-page map of this whole directory.
*/
import { advisoryOnce } from "../A.Engine/public/advisory.js";

// First-use guidance, once per user and terminal-only: this is the chain
// door, and the middle-chain helpers are not. Text that still holds
// unknown contexts comes back in the parse reports, not on stdout.
advisoryOnce(
  "parser-door",
  "[Parser] B.Parser/index.js is the chain door: convert() takes a file in, "
    + "parses it, and writes the requested output. The stage functions "
    + "(InitInput, parseDecoding, writeOutputFile) only exist for callers that "
    + "compose the stages themselves; parsing helpers called directly skip "
    + "preparation, cleanup and the reports, where unknown contexts are kept.",
);

export { convert } from "./convert.js";
export { InitInput } from "./@entry/init.js";
export { parseDecoding } from "./prised/@core/run.js";
export { writeOutputFile } from "./prised/@core/requested.js";
