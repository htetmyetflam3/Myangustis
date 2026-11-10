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
export { convert } from "./convert.js";
export { InitInput } from "./@entry/init.js";
export { parseDecoding } from "./@parse/run.js";
export { writeOutputFile } from "./@parse/requested.js";
