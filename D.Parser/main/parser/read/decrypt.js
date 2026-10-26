import { runQpdf } from "../core/qpdf.mjs";

const ENCRYPT_MARK = Buffer.from("/Encrypt");

export function isEncryptedPdf(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return buf.includes(ENCRYPT_MARK);
}

export async function decryptPdf(bytes, log = () => {}) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (!isEncryptedPdf(buf)) return buf;
  try {
    const { data: out, warnings } = await runQpdf(buf, ["--password=", "--decrypt"]);
    if (warnings) log(`[i] qpdf decrypt warning: ${warnings}`);
    log(
      `[+] PDF was encrypted; decrypted with qpdf `
        + `(${buf.length.toLocaleString("en-US")} -> ${out.length.toLocaleString("en-US")} bytes)`,
    );
    return out;
  } catch (cause) {
    if (/invalid password|password.*incorrect|requires a password/iu.test(String(cause?.message))) {
      throw new Error("This PDF needs a password to open; supply an unprotected copy.", { cause });
    }
    throw cause;
  }
}

const OBJSTM_MARK = Buffer.from("/ObjStm");

/* Object streams (PDF 1.5+): whole indirect objects compressed inside an
   /ObjStm stream are invisible to parsePdfObjects(), so the page tree and
   fonts never resolve. The reference approach (scraper pdf_support.py) is
   not a second parser: detect the marker, rewrite the file once with
   object streams disabled (there: pikepdf ObjectStreamMode.disable, which
   is libqpdf; here: the qpdf CLI, same library, --object-streams=disable,
   which also normalises cross-reference streams back to a plain table),
   then let the existing parser read plain objects. A marker byte-sequence
   inside a content stream is a false positive whose only cost is one
   harmless rewrite. */
export function hasObjectStreams(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return buf.includes(OBJSTM_MARK);
}

export async function expandObjectStreams(bytes, log = () => {}) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (!hasObjectStreams(buf)) return buf;
  const { data: out, warnings } = await runQpdf(buf, ["--object-streams=disable"]);
  if (warnings) log(`[i] qpdf object-stream warning: ${warnings}`);
  log(
    `[+] PDF uses object streams; expanded with qpdf `
      + `(${buf.length.toLocaleString("en-US")} -> ${out.length.toLocaleString("en-US")} bytes)`,
  );
  return out;
}
