/*
(DOCX 2) DOCX branch, position 2 in the chain - after the zip is opened (DOCX 1).
This module extracts the paragraphs of a DOCX document from its document.xml, in order, with the same Myanmar checks the PDF branch uses.
*/
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readCentralDirectory, readEntry } from "../../../@parse/docx/zip.js";
import { ValueError } from "../../../core/@helper/pylib.js";
import { OWNER_PARSER_WORKER, resourceLimit } from "../../../@entry/helper/limit.js";
import { containsMyanmar } from "../../../core/@rule/detect.js";



export const MAX_MEMBER_MB = resourceLimit("PRASER_MAX_MEMBER_MB", 64, 256);
export const MAX_DOCX_TOTAL_MB = resourceLimit("PRASER_MAX_DOCX_TOTAL_MB", 128, 512);
export const MAX_DOCX_ENTRIES = resourceLimit("PRASER_MAX_DOCX_ENTRIES", 4096, 20000);
export const MAX_MEMBER_RATIO = OWNER_PARSER_WORKER ? Infinity : 200;

const W_URI = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const DRAWING_URI = "http://schemas.openxmlformats.org/drawingml/2006/main";
const VML_URI = "urn:schemas-microsoft-com:vml";
const RELATIONSHIP_URIS = new Set([
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  "http://purl.oclc.org/ooxml/officeDocument/relationships",
]);
export const DOCUMENT_XML = "word/document.xml";


const HEADER_RE = /^word\/header\d*\.xml$/;
const FOOTER_RE = /^word\/footer\d*\.xml$/;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(text) {
  if (!text.includes("&")) return text;
  return text.replace(/&(#\d+|#[xX][0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]*);/g, (whole, body) => {
    if (body[0] === "#") {
      const cp = body[1] === "x" || body[1] === "X"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return whole;
      return String.fromCodePoint(cp);
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, body) ? ENTITIES[body] : whole;
  });
}


function* walkXml(xml) {
  const n = xml.length;
  const nsStack = [new Map([["", null]])];
  const scope = [];                        
  let i = 0;

  const parseName = (raw) => {
    const colon = raw.indexOf(":");
    if (colon === -1) {
      const uri = nsStack[nsStack.length - 1].get("") ?? null;
      return [uri ?? "", raw];
    }
    const prefix = raw.slice(0, colon);
    const local = raw.slice(colon + 1);
    const top = nsStack[nsStack.length - 1];
    const uri = top.has(prefix) ? top.get(prefix) : (prefix === "xml"
      ? "http://www.w3.org/XML/1998/namespace"
      : prefix === "xmlns" ? "http://www.w3.org/2000/xmlns/" : undefined);
    if (uri === undefined) throw new Error(`unbound prefix ${JSON.stringify(prefix)}`);
    return [uri ?? "", local];
  };

  while (i < n) {
    const lt = xml.indexOf("<", i);
    if (lt === -1) break;
    if (lt > i) {
      yield { kind: "text", value: decodeEntities(xml.slice(i, lt)) };
    }
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (xml.startsWith("<?", lt)) {
      const end = xml.indexOf("?>", lt + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt + 9);
      const raw = xml.slice(lt + 9, end === -1 ? n : end);
      
      yield { kind: "text", value: raw, cdata: true };
      i = end === -1 ? n : end + 3;
      continue;
    }
    
    let j = lt + 1;
    let quote = null;
    while (j < n) {
      const c = xml[j];
      if (quote) { if (c === quote) quote = null; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
      j += 1;
    }
    const tag = xml.slice(lt + 1, j);
    i = j + 1;

    if (tag[0] === "/") {
      
      
      const [uri, local] = parseName(tag.slice(1).trim());
      scope.pop();
      nsStack.pop();
      yield { kind: "close", uri, local };
      continue;
    }
    const selfClosing = tag.endsWith("/");
    const body = selfClosing ? tag.slice(0, -1) : tag;
    
    let k = 0;
    while (k < body.length && !/[\s]/.test(body[k])) k += 1;
    const rawName = body.slice(0, k);
    const attrText = body.slice(k);

    const attrs = [];
    const attrRe = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')|([^\s/>]+)/g;
    let am;
    while ((am = attrRe.exec(attrText)) !== null) {
      const value = am[3] !== undefined ? am[3] : am[4] !== undefined ? am[4] : null;
      attrs.push([am[1], value === null ? null : decodeEntities(value)]);
    }

    const map = new Map(nsStack[nsStack.length - 1]);
    for (const [aname, value] of attrs) {
      if (aname === "xmlns") map.set("", value ?? "");
      else if (aname.startsWith("xmlns:")) map.set(aname.slice(6), value ?? "");
    }
    nsStack.push(map);
    scope.push({ selfClosing });

    const [uri, local] = parseName(rawName);
    const imageNode = (uri === DRAWING_URI && local === "blip") || (uri === VML_URI && local === "imagedata");
    const namespacedAttrs = imageNode ? attrs.map(([name, value]) => {
      const colon = name.indexOf(":");
      return colon < 0
        ? { uri: "", local: name, value }
        : { uri: map.get(name.slice(0, colon)) ?? "", local: name.slice(colon + 1), value };
    }) : [];
    yield { kind: "open", uri, local, selfClosing, attrs, namespacedAttrs };
    if (selfClosing) {
      nsStack.pop();
      scope.pop();
      yield { kind: "close", uri, local };
    }
  }
}


export function extractDocxParagraphs(docxPath, {
  fontNamesByParagraph = null, imageDir = null, imageFiles = null,
} = {}) {
  const buf = Buffer.isBuffer(docxPath) || docxPath instanceof Uint8Array
    ? Buffer.from(docxPath.buffer, docxPath.byteOffset, docxPath.byteLength)
    : fs.readFileSync(docxPath);
  return parseDocxParagraphs(buf, { fontNamesByParagraph, imageDir, imageFiles });
}


export function validateDocxArchive(zipBuf) {
  const entries = readCentralDirectory(zipBuf);
  if (entries.size > MAX_DOCX_ENTRIES) {
    throw new ValueError(`DOCX exceeds the ${MAX_DOCX_ENTRIES} member cap`);
  }
  if (!entries.has("[Content_Types].xml") || !entries.has(DOCUMENT_XML)) {
    throw new ValueError("ZIP package is not a valid DOCX document");
  }

  let total = 0;
  const memberCap = MAX_MEMBER_MB * 1024 * 1024;
  const totalCap = MAX_DOCX_TOTAL_MB * 1024 * 1024;
  for (const [name, info] of entries) {
    if (
      name.includes('\\') ||
      name.includes('\0') ||
      name.startsWith('/') ||
      name.split('/').includes('..')
    ) {
      throw new ValueError(`DOCX contains an unsafe member name ${JSON.stringify(name)}`);
    }
    if (!Number.isSafeInteger(info.file) || !Number.isSafeInteger(info.compressSize)) {
      throw new ValueError(`DOCX member ${JSON.stringify(name)} has unsafe ZIP64 sizes`);
    }
    if ((info.flags & 0x1) !== 0) {
      throw new ValueError(`DOCX member ${JSON.stringify(name)} is encrypted`);
    }
    if (info.method !== 0 && info.method !== 8) {
      throw new ValueError(`DOCX member ${JSON.stringify(name)} uses unsupported compression`);
    }
    if (info.file > memberCap) {
      throw new ValueError(
        `DOCX member ${JSON.stringify(name)} exceeds the ${MAX_MEMBER_MB} MB cap`,
      );
    }
    const ratio = info.file / Math.max(info.compressSize, 1);
    if (ratio > MAX_MEMBER_RATIO) {
      throw new ValueError(
        `DOCX member ${JSON.stringify(name)} exceeds the ${MAX_MEMBER_RATIO}x compression-ratio cap`,
      );
    }
    total += info.file;
    if (!Number.isSafeInteger(total) || total > totalCap) {
      throw new ValueError(`DOCX exceeds the ${MAX_DOCX_TOTAL_MB} MB expanded-size cap`);
    }
  }
  return entries;
}


function readMemberXml(zipBuf, info, name) {
  const ratio = info.file / Math.max(info.compressSize, 1);
  if (info.file > MAX_MEMBER_MB * 1024 * 1024) {
    throw new ValueError(
      `docx member ${JSON.stringify(name)} exceeds the ${MAX_MEMBER_MB} MB cap (decompression bomb?)`,
    );
  }
  if (ratio > MAX_MEMBER_RATIO) {
    throw new ValueError(
      `docx member ${JSON.stringify(name)} compresses ${info.compressSize} -> ${info.file} bytes `
      + `(ratio ${Math.round(ratio)}x) — decompression bomb, refused`,
    );
  }
  const xmlBytes = readEntry(zipBuf, info, { maxOutputBytes: (MAX_MEMBER_MB + 1) * 1024 * 1024 });
  
  return xmlBytes.toString("utf8").replace(/\r\n?/g, "\n");
}


function orderedParts(names) {
  const ordered = [];
  ordered.push(...names.filter((n) => HEADER_RE.test(n)).sort());
  if (names.includes(DOCUMENT_XML)) ordered.push(DOCUMENT_XML);
  for (const n of ["word/footnotes.xml", "word/endnotes.xml"]) {
    if (names.includes(n)) ordered.push(n);
  }
  ordered.push(...names.filter((n) => FOOTER_RE.test(n)).sort());
  return ordered;
}

function imageRelationships(zipBuf, entries, part) {
  const relsName = path.posix.join(path.posix.dirname(part), "_rels", `${path.posix.basename(part)}.rels`);
  const info = entries.get(relsName);
  const relationships = new Map();
  if (!info) return relationships;
  for (const ev of walkXml(readMemberXml(zipBuf, info, relsName))) {
    if (ev.kind !== "open" || ev.local !== "Relationship") continue;
    const attrs = Object.fromEntries(ev.attrs);
    if (!attrs.Id || !attrs.Target || !String(attrs.Type || "").endsWith("/image")
        || String(attrs.TargetMode || "").toLowerCase() === "external") continue;
    let target;
    try { target = decodeURIComponent(attrs.Target.split("#", 1)[0]); } catch { continue; }
    if (target.includes("\\") || target.includes("\0") || target.includes("://")) continue;
    const member = target.startsWith("/")
      ? path.posix.normalize(target).slice(1)
      : path.posix.normalize(path.posix.join(path.posix.dirname(part), target));
    if (!member.startsWith("../") && entries.has(member)) relationships.set(attrs.Id, member);
  }
  return relationships;
}

export function parseDocxParagraphs(zipBuf, {
  imageDir = null, imageFiles = null, fontNamesByParagraph = null,
} = {}) {
  const entries = validateDocxArchive(zipBuf);
  if (imageDir && !Array.isArray(imageFiles)) throw new TypeError("imageFiles must be an array for DOCX image extraction");
  const paragraphs = [];
  const images = new Map();
  const markerPrefix = imageDir ? `\uE000OCR-${randomUUID()}-` : "";
  const registerImage = (member) => {
    if (!member || !entries.has(member)) return "";
    if (images.has(member)) return images.get(member);
    const id = String(images.size + 1).padStart(4, "0");
    const name = path.posix.basename(member).replace(/[^a-zA-Z0-9._-]/gu, "_");
    fs.mkdirSync(imageDir, { recursive: true, mode: 0o700 });
    const target = path.join(imageDir, `${id}-${name}`);
    const bytes = readEntry(zipBuf, entries.get(member), { maxOutputBytes: (MAX_MEMBER_MB + 1) * 1024 * 1024 });
    fs.writeFileSync(target, bytes, { flag: "wx", mode: 0o600 });
    const marker = `${markerPrefix}${id}\uE001`;
    imageFiles.push({ id, path: target, marker });
    images.set(member, marker);
    return marker;
  };
  for (const name of orderedParts([...entries.keys()])) {
    const info = entries.get(name);
    if (!info) continue;
    const relationships = imageDir ? imageRelationships(zipBuf, entries, name) : null;
    const resolveImage = relationships ? (id) => registerImage(relationships.get(id)) : null;
    paragraphs.push(...collectParagraphs(readMemberXml(zipBuf, info, name), { resolveImage, fontNamesByParagraph }));
  }
  return paragraphs;
}


export function collectParagraphs(xml, { resolveImage = null, fontNamesByParagraph = null } = {}) {
  const paragraphs = [];
  const paragraphFonts = [];
  const openParagraphs = [];
  const openRuns = [];
  const elStack = [];        

  for (const ev of walkXml(xml)) {
    if (ev.kind === "open") {
      elStack.push({ uri: ev.uri, local: ev.local, textTaken: false });
      if (ev.uri === W_URI && ev.local === "p") {
        
        
        
        const ctx = { parts: [], at: paragraphs.length, fonts: new Set() };
        paragraphs.push("");
        paragraphFonts.push(ctx.fonts);
        openParagraphs.push(ctx);
      }
      if (ev.uri === W_URI && ev.local === "r") openRuns.push({ fonts: null, bold: false, italic: false });
      if (openRuns.length && ev.uri === W_URI
        && (ev.local === "b" || ev.local === "bCs" || ev.local === "i" || ev.local === "iCs")) {
        // Run properties: <w:b/> inside the run's rPr marks the run bold
        // (bCs/iCs are the complex-script twins Word sets for Myanmar).
        // An explicit w:val of false/0/off turns the mark back off.
        const val = ev.attrs.find(([name]) => name === "w:val")?.[1];
        const off = typeof val === "string" && /^(?:false|0|off|none)$/iu.test(val);
        const run = openRuns[openRuns.length - 1];
        if (ev.local === "b" || ev.local === "bCs") run.bold = !off;
        else run.italic = !off;
      }
      if (ev.uri === W_URI && ev.local === "rFonts" && openRuns.length) {
        // Only direct run declarations are evidence. Style inheritance and
        // theme fonts are deliberately left unknown.
        const relevant = ev.attrs.filter(([name]) => /^w:(?:ascii|hAnsi|cs|eastAsia)$/u.test(name));
        const themed = ev.attrs.some(([name]) => /^w:(?:ascii|hAnsi|cs|eastAsia)Theme$/u.test(name));
        openRuns[openRuns.length - 1].fonts = themed ? [""] : relevant.map(([, value]) => value || "");
      }
      if (openParagraphs.length) {
        const imageNode = (ev.uri === DRAWING_URI && ev.local === "blip")
          || (ev.uri === VML_URI && ev.local === "imagedata");
        if (resolveImage && imageNode) {
          const reference = ev.namespacedAttrs.find((attr) => RELATIONSHIP_URIS.has(attr.uri)
            && (attr.local === "embed" || attr.local === "id"));
          const marker = reference ? resolveImage(reference.value) : "";
          if (marker) for (const ctx of openParagraphs) ctx.parts.push(marker);
        } else if (ev.uri === W_URI && ev.local === "br") {
          for (const ctx of openParagraphs) ctx.parts.push("\n");
        } else if (ev.uri === W_URI && ev.local === "tab") {
          for (const ctx of openParagraphs) ctx.parts.push("\t");
        }
      }
    } else if (ev.kind === "text") {
      
      
      
      const top = elStack[elStack.length - 1];
      if (top && !top.textTaken && top.uri === W_URI && top.local === "t" && openParagraphs.length) {
        top.textTaken = true;
        // Emit the parser's inline marks with the run: <b>/<i> around the
        // run's text. The finishing stage escapes the text, not the marks.
        const runFlags = openRuns[openRuns.length - 1];
        let marked = ev.value;
        if (runFlags?.italic) marked = `<i>${marked}</i>`;
        if (runFlags?.bold) marked = `<b>${marked}</b>`;
        for (const ctx of openParagraphs) {
          ctx.parts.push(marked);
          if (fontNamesByParagraph && containsMyanmar(ev.value)) {
            const fonts = openRuns[openRuns.length - 1]?.fonts;
            for (const name of fonts?.length ? fonts : [""]) ctx.fonts.add(name);
          }
        }
      }
    } else if (ev.kind === "close") {
      elStack.pop();
      if (ev.uri === W_URI && ev.local === "r") openRuns.pop();
      if (ev.uri === W_URI && ev.local === "p") {
        const ctx = openParagraphs.pop();
        if (ctx) paragraphs[ctx.at] = ctx.parts.join("");
      }
    }
  }
  if (fontNamesByParagraph) fontNamesByParagraph.push(...paragraphFonts);
  return paragraphs;
}