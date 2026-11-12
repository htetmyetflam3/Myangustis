/*
(core/io) Output renderers — compatibility shim.

`analysisFinalize.js` imports `writeDocxPlain` / `writePdf` from here
(old `core/io/render.js`). The current writers live in `@output/`:
`writePdf` is re-exported as-is; `writeDocxPlain` renders plain text
as a single-page DOCX via `writeDocxMarkup`.
*/
import { writeDocxMarkup } from "../../@output/docx/write.js";

export { writePdf } from "../../@output/pdf/write.js";

export async function writeDocxPlain(outPath, text) {
  return writeDocxMarkup(outPath, [String(text ?? "")]);
}
