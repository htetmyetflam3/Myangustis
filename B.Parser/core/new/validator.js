export function validatePdf(file) {
  const fd = fs.openSync(file, "r");
  const block = Buffer.allocUnsafe(64 * 1024);
  let tail = Buffer.alloc(0);
  let header = null;
  let encrypted = false;
  let objectStreams = false;
  let position = 0;
  try {
    while (true) {
      const count = fs.readSync(fd, block, 0, block.length, position);
      if (!count) break;
      position += count;
      const bytes = tail.length ? Buffer.concat([tail, block.subarray(0, count)]) : block.subarray(0, count);
      if (header === null) header = bytes.length >= 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-";
      encrypted ||= bytes.includes(ENCRYPT_MARK);
      objectStreams ||= bytes.includes(OBJSTM_MARK);
      if (header !== null && encrypted && objectStreams) break;
      tail = Buffer.from(bytes.subarray(Math.max(0, bytes.length - Math.max(ENCRYPT_MARK.length, OBJSTM_MARK.length) + 1)));
    }
  } finally {
    fs.closeSync(fd);
  }
  return { header: header === true, encrypted, objectStreams };
}


// --- function 1: validate ------------------------------------------------
// The header verdict (%PDF- / PK / other) plus the package check: a
// real DOCX carries [Content_Types].xml and word/document.xml in its
// central directory. Anything else wearing PK is not a DOCX.
export function validateDocx(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const kind = buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-"
    ? "pdf"
    : buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b ? "docx" : "other";
  if (kind !== "docx") return { kind, valid: false };
  let valid = false;
  try {
    const names = memberNames(buf);
    valid = names.has("[Content_Types].xml") && names.has("word/document.xml");
  } catch {
    valid = false;
  }
  return { kind, valid };
}