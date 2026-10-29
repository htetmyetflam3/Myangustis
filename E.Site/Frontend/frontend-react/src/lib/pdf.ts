
export type Encoding = "utf-8" | "legacy-zawgyi" | "single-byte" | "unknown";

export type ParsedDoc = {
  name: string;
  bytes: number;
  pages: number;
  streams: number;
  
  naive: string;
  
  text: string;
  encoding: Encoding;
  ms: number;
  chars: number;
  words: number;
  lines: number;
};
const hasInflate = typeof globalThis !== "undefined" && "DecompressionStream" in globalThis;

export function bytesToAscii(bytes: Uint8Array): string {
  let out = "";
  const step = 0x2000;
  for (let i = 0; i < bytes.length; i += step) {
    out += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return out;
}

async function inflate(data: Uint8Array): Promise<Uint8Array | null> {
  if (!hasInflate) return null;
  
  
  let end = data.length;
  while (end > 0 && (data[end - 1] === 10 || data[end - 1] === 13 || data[end - 1] === 32 || data[end - 1] === 9)) {
    end--;
  }
  const trimmed = data.subarray(0, end);
  for (const format of ["deflate", "deflate-raw"]) {
    try {
      const DS = (globalThis as any).DecompressionStream;
      const stream = new Blob([trimmed.slice() as unknown as BlobPart])
        .stream()
        .pipeThrough(new DS(format));
      const buf = await new Response(stream).arrayBuffer();
      const out = new Uint8Array(buf);
      if (out.length) return out;
    } catch {
      /* try the next format */
    }
  }
  return null;
}


function naiveDecode(bytes: Uint8Array): string {
  try {
    return new TextDecoder("windows-1252").decode(bytes);
  } catch {
    return bytesToAscii(bytes);
  }
}

function utf8DecodeStrict(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}





const PUA = /[\uE000-\uF8FF]/;

export function detectZawgyi(t: string): boolean {
  if (!t) return false;
  return (
    PUA.test(t) ||
    /\u1039(?=[\u102B-\u1038\u1031\s\u104A\u104B.,:;!?)]|[\u1031])/.test(t) ||
    /\u1039\u1039/.test(t) ||
    /\u1031\u1031/.test(t)
  );
}


export function zawgyiToUnicode(input: string): string {
  let t = input;
  t = t.replace(/[\uE000-\uF8FF]/g, "");
  
  t = t.replace(
    /\u1039(?=[\u102B-\u1038\u1031\s\u104A\u104B.,:;!?)]|[\u1031])/g,
    "\u103A"
  );
  
  t = t.replace(/(\u1031)\u1031+/g, "$1");
  t = t.replace(/(\u103A)\u103A+/g, "$1");
  
  t = t.replace(/[Â�]/g, "");
  t = t.replace(/[ \t\u00A0]{2,}/g, " ");
  return t;
}




type RawString = { bytes: Uint8Array };
function extractTextStrings(content: string): RawString[] {
  const out: RawString[] = [];
  let i = 0;
  let inText = false;
  const n = content.length;
  const isBoundary = (idx: number) =>
    idx === 0 || /[\s[\]<>(){}]/.test(content[idx - 1] || "");

  while (i < n) {
    const c = content[i];
    if (inText && c === "(" && isBoundary(i)) {
      const buf: number[] = [];
      let depth = 1;
      i++;
      while (i < n && depth > 0) {
        const ch = content[i];
        if (ch === "\\") {
          const nx = content[i + 1];
          i += 2;
          if (nx >= "0" && nx <= "7") {
            let oct = nx;
            while (i < n && oct.length < 3 && content[i] >= "0" && content[i] <= "7") {
              oct += content[i];
              i++;
            }
            buf.push(parseInt(oct, 8) & 0xff);
          } else {
            const map: Record<string, number> = {
              n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92,
            };
            if (nx === "\n" || nx === "\r") {
              if (nx === "\r" && content[i] === "\n") i++;
            } else if (map[nx] !== undefined) buf.push(map[nx]);
          }
          continue;
        }
        if (ch === "(") depth++;
        if (ch === ")") {
          depth--;
          if (depth === 0) { i++; break; }
        }
        buf.push(ch.charCodeAt(0) & 0xff);
        i++;
      }
      if (buf.length) out.push({ bytes: Uint8Array.from(buf) });
      continue;
    }
    if (inText && c === "<" && content[i + 1] !== "<") {
      const hex: string[] = [];
      i++;
      while (i < n && content[i] !== ">" && hex.join("").length < 4000) {
        const h = content[i];
        if (/[0-9a-fA-F]/.test(h)) hex.push(h);
        i++;
      }
      i++;
      const joined = hex.join("");
      const buf: number[] = [];
      for (let k = 0; k + 1 < joined.length; k += 2)
        buf.push(parseInt(joined.slice(k, k + 2), 16));
      if (buf.length) out.push({ bytes: Uint8Array.from(buf) });
      continue;
    }
    if (c === "B" && content[i + 1] === "T" && isBoundary(i)) { inText = true; i += 2; continue; }
    if (c === "E" && content[i + 1] === "T" && isBoundary(i)) { inText = false; i += 2; continue; }
    i++;
  }
  return out;
}

function findStreams(bytes: Uint8Array): { start: number; end: number }[] {
  const hits: { start: number; end: number }[] = [];
  const kw = (from: number, word: string) => {
    outer: for (let i = from; i <= bytes.length - word.length; i++) {
      for (let j = 0; j < word.length; j++)
        if (bytes[i + j] !== word.charCodeAt(j)) continue outer;
      return i;
    }
    return -1;
  };
  let cursor = 0;
  while (cursor < bytes.length) {
    const s = kw(cursor, "stream");
    if (s < 0) break;
    let dataStart = s + 6;
    if (bytes[dataStart] === 13) dataStart++;
    if (bytes[dataStart] === 10) dataStart++;
    const e = kw(dataStart, "endstream");
    if (e < 0) break;
    hits.push({ start: dataStart, end: e });
    cursor = e + 9;
  }
  return hits;
}

function stats(t: string) {
  const words = t.trim() ? t.trim().split(/\s+/).length : 0;
  const lines = t.split(/\n/).filter((l) => l.trim()).length;
  return { chars: t.replace(/\s/g, "").length, words, lines };
}

export async function parsePdf(file: Blob, name: string): Promise<ParsedDoc> {
  const t0 = performance.now();
  const buf = new Uint8Array(await file.arrayBuffer());
  const streams = findStreams(buf);
  const pages = Math.max(
    1,
    (bytesToAscii(buf).match(/\/Type\s*\/Page[^s]/g) || []).length || 1
  );

  const properRuns: string[] = [];
  const naiveRuns: string[] = [];
  let used = 0;

  for (const s of streams) {
    let data: Uint8Array = buf.subarray(s.start, s.end);
    const raw = bytesToAscii(data);
    if (!raw.includes("BT") && !raw.includes("Tj") && !raw.includes("TJ")) {
      const inflated = await inflate(data);
      if (!inflated) continue;
      data = inflated;
    } else {
      const asText = bytesToAscii(data);
      if (!asText.includes("BT")) {
        const inflated = await inflate(data);
        if (inflated) data = inflated;
      }
    }
    const content = bytesToAscii(data);
    if (!content.includes("BT")) continue;
    const strings = extractTextStrings(content);
    if (!strings.length) continue;
    used++;
    const joined = new Uint8Array(
      strings.reduce((a, b) => a + b.bytes.length + 1, 0)
    );
    let off = 0;
    strings.forEach((r, idx) => {
      joined.set(r.bytes, off);
      off += r.bytes.length;
      if (idx < strings.length - 1) { joined[off] = 10; off++; }
    });
    naiveRuns.push(naiveDecode(joined));
    const strict = utf8DecodeStrict(joined);
    properRuns.push(strict ?? naiveDecode(joined));
  }

  let naive = naiveRuns.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  let text = properRuns.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  let encoding: Encoding = "unknown";
  if (text) {
    if (utf8DecodeStrict(buf.subarray(0, Math.min(buf.length, 40000))) !== null) {
      encoding = detectZawgyi(text) ? "legacy-zawgyi" : "utf-8";
    } else encoding = "single-byte";
    if (detectZawgyi(text)) {
      text = zawgyiToUnicode(text);
      encoding = "legacy-zawgyi";
    }
  } else {
    text = "";
    naive = "";
  }

  const ms = Math.round(performance.now() - t0);
  return {
    name,
    bytes: buf.length,
    pages: used ? Math.max(pages, 1) : pages,
    streams: used,
    naive,
    text,
    encoding,
    ms: Math.max(ms, 1),
    ...stats(text),
  };
}


export async function fetchSample(): Promise<ParsedDoc> {
  const response = await fetch("/samples/sample.pdf");
  if (!response.ok) throw new Error("The benchmark sample could not be loaded.");
  const blob = await response.blob();
  return parsePdf(blob, "sample.pdf");
}
