import fs from "node:fs";
import zlib from "node:zlib";
import { Readable } from "node:stream";
import { positiveLimit } from "./limits.mjs";

const MAX_ZIP_ENTRIES = positiveLimit("PRASER_MAX_DOCX_ENTRIES", 4096, 20000);
const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const ZIP64_EOCD_LOC_SIG = 0x07064b50;

export class BadZipFile extends Error {
  constructor(msg) { super(msg); this.name = "BadZipFile"; }
}


export function readCentralDirectory(buf) {
  const maxBack = Math.min(buf.length, 66075);
  let eocd = -1;
  for (let i = buf.length - 22; i >= buf.length - maxBack; i -= 1) {
    if (i >= 0 && buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd === -1) throw new BadZipFile("File is not a zip file");

  let count = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);

  if (cdOffset === 0xffffffff || count === 0xffff) {
    const loc = eocd + 22;
    if (loc + 20 <= buf.length && buf.readUInt32LE(loc) === ZIP64_EOCD_LOC_SIG) {
      const z64 = Number(buf.readBigUInt64LE(loc + 8));
      if (z64 + 4 <= buf.length && buf.readUInt32LE(z64) === 0x06064b50) {
        count = Number(buf.readBigUInt64LE(z64 + 32));
        cdOffset = Number(buf.readBigUInt64LE(z64 + 48));
      }
    }
  }

  if (!Number.isSafeInteger(count) || count > MAX_ZIP_ENTRIES) {
    throw new BadZipFile(`ZIP exceeds the ${MAX_ZIP_ENTRIES} member cap`);
  }
  if (!Number.isSafeInteger(cdOffset) || cdOffset < 0 || cdOffset > buf.length) {
    throw new BadZipFile("ZIP central directory offset is invalid");
  }

  const entries = new Map();
  let parsedCount = 0;
  let p = cdOffset;
  for (let n = 0; n < count; n += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CD_SIG) break;
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    let compressSize = buf.readUInt32LE(p + 20);
    let fileSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    let localOffset = buf.readUInt32LE(p + 42);
    const nameStart = p + 46;
    const extraStart = nameStart + nameLen;
    const name = buf.toString("utf8", nameStart, extraStart);
    p = extraStart + extraLen + commentLen;

    if (fileSize === 0xffffffff || compressSize === 0xffffffff || localOffset === 0xffffffff) {
      let q = extraStart;
      const end = extraStart + extraLen;
      while (q + 4 <= end) {
        const id = buf.readUInt16LE(q);
        const sz = buf.readUInt16LE(q + 2);
        if (id === 0x0001) {
          let r = q + 4;
          if (fileSize === 0xffffffff && r + 8 <= end) { fileSize = Number(buf.readBigUInt64LE(r)); r += 8; }
          if (compressSize === 0xffffffff && r + 8 <= end) { compressSize = Number(buf.readBigUInt64LE(r)); r += 8; }
          if (localOffset === 0xffffffff && r + 8 <= end) { localOffset = Number(buf.readBigUInt64LE(r)); }
          break;
        }
        q += 4 + sz;
      }
    }

    if (entries.has(name)) throw new BadZipFile(`Duplicate ZIP member ${JSON.stringify(name)}`);
    entries.set(name, { name, flags, method, crc, compressSize, file: fileSize, localOffset });
    parsedCount += 1;
  }
  if (parsedCount !== count) throw new BadZipFile("ZIP central directory is truncated");
  return entries;
}


export function readEntry(buf, entry, { maxOutputBytes = null } = {}) {
  if ((entry.flags & 0x1) !== 0) {
    throw new Error(`File ${JSON.stringify(entry.name)} is encrypted, password required for extraction`);
  }
  if (entry.method !== 0 && entry.method !== 8) {
    throw new Error(`compression type ${entry.method} for ${JSON.stringify(entry.name)} not supported`);
  }
  const lh = entry.localOffset;
  if (lh + 30 > buf.length || buf.readUInt32LE(lh) !== LOCAL_SIG) {
    throw new BadZipFile("Bad magic number for local header");
  }
  const nameLen = buf.readUInt16LE(lh + 26);
  const extraLen = buf.readUInt16LE(lh + 28);
  const start = lh + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + entry.compressSize);

  let out;
  if (entry.method === 0) {
    out = data;
  } else {
    try {
      out = zlib.inflateRawSync(data, maxOutputBytes ? { maxOutputLength: maxOutputBytes } : undefined);
    } catch (e) {
      if (e && e.code === "ERR_BUFFER_TOO_LARGE") throw e;
      throw new BadZipFile(`Bad CRC-32 for file ${JSON.stringify(entry.name)}`);
    }
  }
  
  if ((entry.crc >>> 0) !== (zlib.crc32(out) >>> 0)) {
    throw new BadZipFile(`Bad CRC-32 for file ${JSON.stringify(entry.name)}`);
  }
  return out;
}


export function openZipBuffer(buf) {
  return readCentralDirectory(buf);
}

const dosTime = (d) => ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
const dosDate = (d) => (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
class Member {
  constructor(zip, name) {
    this.zip = zip;
    this.name = name;
    this.nameBuf = Buffer.from(name, "utf8");
    this.utf8 = [...name].some((c) => c.codePointAt(0) > 0xff);
    this.time = new Date();
    this.crc = 0;
    this.size = 0;
    this.compressSize = 0;
    this.headerPos = zip.pos;
  }

  async stream(chunks) {
    const zip = this.zip;
    const flags = this.utf8 ? 0x800 : 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(LOCAL_SIG, 0);
    header.writeUInt16LE(20, 4);            
    header.writeUInt16LE(flags, 6);
    header.writeUInt16LE(8, 8);             
    header.writeUInt16LE(dosTime(this.time), 10);
    header.writeUInt16LE(dosDate(this.time), 12);
    header.writeUInt32LE(0, 14);            
    header.writeUInt32LE(0, 18);            
    header.writeUInt32LE(0, 22);            
    header.writeUInt16LE(this.nameBuf.length, 26);
    header.writeUInt16LE(0, 28);
    zip.write(header);
    zip.write(this.nameBuf);

    const defl = zlib.createDeflateRaw({ level: zip.compresslevel });
    const src = Readable.from((async function* () {
      for await (const c of chunks) {
        const buf = Buffer.isBuffer(c) ? c : Buffer.from(String(c), "utf8");
        this.size += buf.length;
        this.crc = zlib.crc32(buf, this.crc);
        yield buf;
      }
    }).call(this));
    const done = new Promise((resolve, reject) => {
      defl.on("data", (chunk) => {
        this.compressSize += chunk.length;
        zip.write(chunk);
      });
      defl.on("error", reject);
      defl.on("end", resolve);
      src.on("error", reject);
    });
    src.pipe(defl);
    src.resume();
    await done;

    const patch = Buffer.alloc(12);
    patch.writeUInt32LE(this.crc >>> 0, 0);
    patch.writeUInt32LE(this.compressSize, 4);
    patch.writeUInt32LE(this.size, 8);
    fs.writeSync(zip.fd, patch, 0, 12, this.headerPos + 14);
    zip.entries.push(this);
  }
}

export class ZipStreamWriter {
  constructor(outPath, { compresslevel = 6 } = {}) {
    this.fd = fs.openSync(outPath, "w");
    this.pos = 0;
    this.entries = [];
    this.compresslevel = compresslevel;
  }

  write(buf) {
    fs.writeSync(this.fd, buf, 0, buf.length, this.pos);
    this.pos += buf.length;
  }

  member(name) {
    return new Member(this, name);
  }

  
  async writestr(name, data) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
    await new Member(this, name).stream([buf]);
  }

  async close() {
    const cdStart = this.pos;
    for (const e of this.entries) {
      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(CD_SIG, 0);
      cd.writeUInt16LE((3 << 8) | 20, 4);   
      cd.writeUInt16LE(20, 6);              
      cd.writeUInt16LE(e.utf8 ? 0x800 : 0, 8);
      cd.writeUInt16LE(8, 10);
      cd.writeUInt16LE(dosTime(e.time), 12);
      cd.writeUInt16LE(dosDate(e.time), 14);
      cd.writeUInt32LE(e.crc >>> 0, 16);
      cd.writeUInt32LE(e.compressSize, 20);
      cd.writeUInt32LE(e.size, 24);
      cd.writeUInt16LE(e.nameBuf.length, 28);
      cd.writeUInt16LE(0, 30);              
      cd.writeUInt16LE(0, 32);              
      cd.writeUInt16LE(0, 34);              
      cd.writeUInt16LE(0, 36);              
      cd.writeUInt32LE(0o600 << 16, 38);
      cd.writeUInt32LE(e.headerPos, 42);
      this.write(cd);
      this.write(e.nameBuf);
    }
    const cdSize = this.pos - cdStart;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(EOCD_SIG, 0);
    eocd.writeUInt16LE(this.entries.length, 8);          
    eocd.writeUInt16LE(this.entries.length, 10);         
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdStart, 16);
    this.write(eocd);
    fs.closeSync(this.fd);
  }
}
