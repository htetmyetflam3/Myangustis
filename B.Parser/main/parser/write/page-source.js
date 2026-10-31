import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFArray, PDFDocument, PDFName, PDFStream, ParseSpeeds } from "pdf-lib";
import { runQpdf } from "../core/qpdf.js";

const CONTENTS = PDFName.of("Contents");
const REPLACED_STREAM_KEYS = new Set(["/Length", "/Filter", "/DecodeParms"]);

// Page commands are spooled as they are parsed, rather than retained for the
// whole book. All other objects are copied by the PDF writer and qpdf.
export class PageSourceWriter {
  constructor() {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), "myangustis-pdf-source-"));
    this.spoolPath = path.join(this.dir, "commands.bin");
    this.fd = fs.openSync(this.spoolPath, "w+", 0o600);
    this.position = 0;
    this.pages = [];
  }

  addPage(index, streams) {
    if (index !== this.pages.length) throw new Error("PDF pages were not written in order");
    this.pages.push(streams.map((bytes) => {
      const start = this.position;
      let written = 0;
      while (written < bytes.length) {
        written += fs.writeSync(this.fd, bytes, written, bytes.length - written, this.position + written);
      }
      this.position += bytes.length;
      return { start, length: bytes.length };
    }));
  }

  read(entry) {
    const bytes = Buffer.allocUnsafe(entry.length);
    let offset = 0;
    while (offset < entry.length) {
      const read = fs.readSync(this.fd, bytes, offset, entry.length - offset, entry.start + offset);
      if (!read) throw new Error("PDF command spool ended early");
      offset += read;
    }
    return bytes;
  }

  async finish(source) {
    const pdf = await PDFDocument.load(source, {
      updateMetadata: false, throwOnInvalidObject: true, parseSpeed: ParseSpeeds.Fastest,
    });
    const pages = pdf.getPages();
    if (pages.length !== this.pages.length) throw new Error("PDF page count changed while preparing linearization");
    for (let i = 0; i < pages.length; i += 1) {
      const entries = this.pages[i];
      if (!entries.length) continue;
      const node = pages[i].node;
      const original = pdf.context.lookup(node.get(CONTENTS));
      const old = original instanceof PDFArray
        ? Array.from({ length: original.size() }, (_, index) => pdf.context.lookup(original.get(index)))
        : [original];
      if (old.length !== entries.length || old.some((stream) => !(stream instanceof PDFStream))) {
        throw new Error(`Unexpected content streams on PDF page ${i + 1}`);
      }
      const refs = entries.map((entry, index) => {
        const stream = pdf.context.flateStream(this.read(entry));
        // Preserve stream metadata other than the old compression/length.
        for (const [key, value] of old[index].dict.entries()) {
          if (!REPLACED_STREAM_KEYS.has(key.toString())) stream.dict.set(key, value);
        }
        return pdf.context.register(stream);
      });
      node.set(CONTENTS, refs.length === 1 ? refs[0] : pdf.context.obj(refs));
    }
    const staged = await pdf.save({
      useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false,
    });
    const { data, warnings } = await runQpdf(staged, ["--linearize", "--object-streams=disable"]);
    const result = path.join(this.dir, "linearized.pdf");
    fs.writeFileSync(result, data, { mode: 0o600 });
    return { path: result, dir: this.dir, warnings };
  }

  close({ remove = true } = {}) {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
    if (remove) fs.rmSync(this.dir, { recursive: true, force: true });
    else fs.rmSync(this.spoolPath, { force: true });
  }
}
