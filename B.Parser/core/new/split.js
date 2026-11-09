/*
(new/split) After qpdf: separate container from content.
qpdf already knows what is container and what is content - PDF
syntax marks it (dictionary, then stream...endstream) - so once it
has repaired/decrypted the file, one scan writes the two apart:
  container.txt - every object's dictionary, references intact,
                  stream payloads replaced by their address here
  content.txt   - the stream payloads back to back, raw bytes
The address problem is solved by the writer, not the reader: as
each stream is appended its byte offset and length are recorded in
container.txt's @stream table (object number -> content offset,
length). That table is the new xref. Objects are scanned one at a
time off the landed file; the file is never held whole.
OCR jobs take the other exit: stripPdfImages throws the container
away entirely and keeps only the image streams' bytes.
*/
import fs from "node:fs";
import zlib from "node:zlib";

const OBJ_RE = /(\d+)\s+(\d+)\s+obj(?![\w])/;
const CHUNK = 256 * 1024;

// Walk the indirect objects of a PDF file, one at a time.
// Yields { num, gen, dict, stream } - dict as latin1 text, stream
// as a Buffer (FlateDecode inflated, other filters raw) or null.
export async function* scanPdfObjects(file) {
  const fd = fs.openSync(file, "r");
  let pending = Buffer.alloc(0);
  let eof = false;
  const block = Buffer.allocUnsafe(CHUNK);
  const fill = () => {
    if (eof) return;
    const n = fs.readSync(fd, block, 0, CHUNK, null);
    if (n === 0) { eof = true; return; }
    pending = pending.length ? Buffer.concat([pending, block.subarray(0, n)]) : Buffer.from(block.subarray(0, n));
  };
  try {
    for (;;) {
      // Find the next object header, discarding inter-object junk
      // (xref tables, trailers) as it is passed.
      let m = null;
      while ((m = OBJ_RE.exec(pending.toString("latin1"))) === null) {
        if (eof) return;
        pending = pending.subarray(Math.max(0, pending.length - 32));
        fill();
      }
      const headEnd = m.index + m[0].length;
      // The whole object (through endobj) must be in the window.
      let endAt = -1;
      while ((endAt = pending.indexOf("endobj", headEnd)) === -1) {
        if (eof) return;
        fill();
      }
      const objBytes = pending.subarray(0, endAt + 6);
      pending = pending.subarray(endAt + 6);
      const body = objBytes.subarray(headEnd, objBytes.length - 6);
      const streamAt = body.indexOf("stream");
      let dict = body.toString("latin1").trim();
      let stream = null;
      if (streamAt !== -1 && /<<[\s\S]*>>/.test(dict.slice(0, streamAt))) {
        dict = body.subarray(0, streamAt).toString("latin1").trim();
        let dataAt = streamAt + 6;
        if (body[dataAt] === 0x0d && body[dataAt + 1] === 0x0a) dataAt += 2;
        else if (body[dataAt] === 0x0a || body[dataAt] === 0x0d) dataAt += 1;
        const declared = dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/);
        let raw;
        if (declared && dataAt + Number(declared[1]) <= body.length) {
          raw = body.subarray(dataAt, dataAt + Number(declared[1]));
        } else {
          const endStream = body.indexOf("endstream", dataAt);
          raw = body.subarray(dataAt, endStream === -1 ? body.length : endStream);
          if (raw.length && raw[raw.length - 1] === 0x0a) raw = raw.subarray(0, raw.length - (raw.length > 1 && raw[raw.length - 2] === 0x0d ? 2 : 1));
        }
        stream = Buffer.from(raw);
        if (/\/FlateDecode|\/Fl(?![a-z])/.test(dict)) {
          try { stream = zlib.inflateSync(stream); } catch { /* keep raw */ }
        }
      }
      yield { num: Number(m[1]), gen: Number(m[2]), dict, stream };
    }
  } finally {
    fs.closeSync(fd);
  }
}

function dictValue(dict, key) {
  const hit = dict.match(new RegExp("/" + key + "\\s+(\\d+)"));
  return hit ? Number(hit[1]) : null;
}

function streamFilter(dict) {
  const hit = dict.match(/\/Filter\s*\/(\w+)|\/Filter\s*\[\s*\/(\w+)/);
  return hit ? (hit[1] ?? hit[2]) : null;
}

// Write container.txt + content.txt beside the prepared PDF and
// return their paths plus the @stream index that was recorded.
export async function splitPdf(file) {
  const containerPath = file + ".container.txt";
  const contentPath = file + ".content.txt";
  const out = fs.createWriteStream(contentPath, { mode: 0o600 });
  const index = [];
  const objects = [];
  let offset = 0;
  try {
    for await (const obj of scanPdfObjects(file)) {
      if (obj.stream) {
        const filter = streamFilter(obj.dict);
        index.push({ num: obj.num, gen: obj.gen, offset, length: obj.stream.length, ...(filter ? { filter } : {}) });
        objects.push(`${obj.num} ${obj.gen} obj\n${obj.dict}\nstream -> content @${offset} (${obj.stream.length} bytes)\nendobj`);
        if (!out.write(obj.stream)) {
          await new Promise((resolve, reject) => { out.once("drain", resolve); out.once("error", reject); });
        }
        offset += obj.stream.length;
      } else {
        objects.push(`${obj.num} ${obj.gen} obj\n${obj.dict}\nendobj`);
      }
    }
    await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
  } catch (error) {
    out.destroy();
    fs.rmSync(contentPath, { force: true });
    throw error;
  }
  const head = [
    "# container - stream addresses below are (byte offset, length) into content.txt",
    ...index.map((s) => `@stream ${s.num} ${s.gen} -> content @${s.offset} len ${s.length}${s.filter ? " filter " + s.filter : ""}`),
    "",
  ];
  fs.writeFileSync(containerPath, head.join("\n") + objects.join("\n\n") + "\n", { mode: 0o600 });
  return { containerPath, contentPath, index };
}

// The OCR exit for a PDF job: strip everything around the images
// and keep only the image bytes, one file per image stream.
const IMAGE_EXT = { DCTDecode: "jpg", JPXDecode: "jp2", CCITTFaxDecode: "ccitt", FlateDecode: "raw" };
export async function stripPdfImages(file, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const images = [];
  for await (const obj of scanPdfObjects(file)) {
    if (!obj.stream || !/\/Subtype\s*\/Image/.test(obj.dict)) continue;
    const filter = streamFilter(obj.dict);
    const ext = IMAGE_EXT[filter] ?? "bin";
    const imagePath = `${outDir}/image-${obj.num}.${ext}`;
    fs.writeFileSync(imagePath, obj.stream, { mode: 0o600 });
    images.push({
      path: imagePath,
      object: obj.num,
      filter,
      width: dictValue(obj.dict, "Width"),
      height: dictValue(obj.dict, "Height"),
      size: obj.stream.length,
    });
  }
  return images;
}
