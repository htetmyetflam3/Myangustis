/*
(new/metadata) The bracket: [metadata, object].
Whatever arrived - a file on disk already read by file-reader, or an
external object handed to the door - is packed the same way: peek at
the first bytes, name what the file is in the metadata, and hand the
object (the byte source, head chunks re-fed, nothing lost) along with
it. The lanes downstream read the metadata to know what they hold;
if anything ever needs to act on metadata alone, it happens here.
*/
import { validateDocx } from "./validator.js";
import { validateImage } from "../../@parse/ocr/read.js";

export async function packInput(source, { filename = null, origin = "external", caller = "owner", job = null } = {}) {
  const iterator = source[Symbol.asyncIterator]();
  const head = [];
  let headBytes = 0;
  while (headBytes < 12) {
    const { done, value } = await iterator.next();
    if (done) break;
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    head.push(chunk);
    headBytes += chunk.length;
  }
  async function* object() {
    for (const chunk of head) yield chunk;
    let step;
    while (!(step = await iterator.next()).done) yield step.value;
  }
  const headBuf = Buffer.concat(head);
  const verdict = validateDocx(headBuf);
  const imageKind = verdict.kind === "other" ? validateImage(headBuf) : null;
  const kind = verdict.kind === "pdf" ? "pdf"
    : verdict.kind === "docx" ? "docx"
    : imageKind ? "ocr" : "other";
  const metadata = {
    kind,
    filename,
    origin,
    caller,
    ...(origin === "disk" && filename ? { sourcePath: filename } : {}),
    ...(imageKind ? { imageKind } : {}),
    ...(job ? { job } : {}),
  };
  return { metadata, object: object() };
}
