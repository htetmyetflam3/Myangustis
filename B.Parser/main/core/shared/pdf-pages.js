import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { countImpossiblePairs } from "./scan.js";

const require = createRequire(import.meta.url);

function differentLines(before, after) {
  const left = before.split("\n");
  const right = after.split("\n");
  let changed = 0;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if ((left[index] ?? "") !== (right[index] ?? "")) changed += 1;
  }
  return changed;
}

// A page's drawing order need not be reading order. Store drawing pieces on
// disk so duplicate detection and spatial sorting don't retain the page text.
export class PdfPagePieces {
  constructor(directory) {
    let DatabaseSync;
    try {
      ({ DatabaseSync } = require("node:sqlite"));
    } catch (cause) {
      throw new Error("File-backed PDF extraction requires Node.js 22.13 or later", { cause });
    }
    this.file = path.join(directory, `page-pieces-${randomUUID()}.sqlite`);
    const fd = fs.openSync(this.file, "wx", 0o600);
    fs.closeSync(fd);
    try {
      this.db = new DatabaseSync(this.file);
      this.db.exec(`
        PRAGMA journal_mode=OFF;
        PRAGMA synchronous=OFF;
        PRAGMA temp_store=FILE;
        PRAGMA cache_size=-2048;
        PRAGMA mmap_size=0;
        CREATE TABLE pieces (id INTEGER PRIMARY KEY, y REAL, x REAL, size REAL, text TEXT, runs TEXT);
        CREATE TABLE unique_pieces (slot INTEGER PRIMARY KEY, y REAL, x REAL, size REAL, text TEXT, runs TEXT, line INTEGER, ord INTEGER);
        CREATE INDEX unique_x ON unique_pieces(x);
        CREATE INDEX unique_yx ON unique_pieces(y DESC, x ASC, slot ASC);
        CREATE TABLE line_anchors (id INTEGER PRIMARY KEY, y REAL);
        CREATE TABLE lines (id INTEGER PRIMARY KEY, x REAL, y REAL, size REAL, text TEXT);
        CREATE TABLE final_lines (id INTEGER PRIMARY KEY, x REAL, y REAL, size REAL, text TEXT);
      `);
      this.insertPiece = this.db.prepare("INSERT INTO pieces(y,x,size,text,runs) VALUES(?,?,?,?,?)");
      this.pieces = this.db.prepare("SELECT id,y,x,size,text,runs FROM pieces ORDER BY id");
      this.nearby = this.db.prepare("SELECT slot,y,x,text FROM unique_pieces WHERE x BETWEEN ? AND ? AND y BETWEEN ? AND ? ORDER BY slot");
      this.insertUnique = this.db.prepare("INSERT INTO unique_pieces(y,x,size,text,runs) VALUES(?,?,?,?,?)");
      this.updateUnique = this.db.prepare("UPDATE unique_pieces SET y=?,x=?,size=?,text=?,runs=? WHERE slot=?");
      this.sorted = this.db.prepare("SELECT slot,y,x FROM unique_pieces ORDER BY y DESC,x ASC,slot ASC");
      this.sortedLeft = this.db.prepare("SELECT slot,y,x FROM unique_pieces WHERE x < ? ORDER BY y DESC,x ASC,slot ASC");
      this.sortedRight = this.db.prepare("SELECT slot,y,x FROM unique_pieces WHERE x >= ? ORDER BY y DESC,x ASC,slot ASC");
      this.columnEvidence = this.db.prepare("SELECT x,y,length(trim(text)) AS chars FROM unique_pieces WHERE length(trim(text)) > 0 ORDER BY y DESC,x ASC");
      this.insertAnchor = this.db.prepare("INSERT INTO line_anchors(id,y) VALUES(?,?)");
      this.assignLine = this.db.prepare("UPDATE unique_pieces SET line=?,ord=? WHERE slot=?");
      this.ordered = this.db.prepare("SELECT p.line,a.y AS baseline,p.x,p.size,p.text,p.runs FROM unique_pieces p JOIN line_anchors a ON a.id=p.line ORDER BY p.line,p.x,p.ord");
      this.insertLine = this.db.prepare("INSERT INTO lines(id,x,y,size,text) VALUES(?,?,?,?,?)");
      this.readLines = this.db.prepare("SELECT id,x,y,size,text FROM lines ORDER BY id");
      this.insertFinal = this.db.prepare("INSERT INTO final_lines(id,x,y,size,text) VALUES(?,?,?,?,?)");
      this.readFinal = this.db.prepare("SELECT id,x,y,size,text FROM final_lines ORDER BY id");
      this.active = false;
    } catch (error) {
      this.db?.close();
      fs.rmSync(this.file, { force: true });
      throw error;
    }
  }

  begin(doc) {
    this.abort();
    this.db.exec("DELETE FROM pieces; DELETE FROM unique_pieces; DELETE FROM line_anchors; DELETE FROM lines; DELETE FROM final_lines; BEGIN");
    this.active = true;
    this.doc = doc;
    this.fontIds = new WeakMap();
    this.fonts = new Map();
    this.nextFont = 1;
  }

  encodeRuns(runs) {
    if (!Array.isArray(runs)) return null;
    return JSON.stringify(runs.map(([marker, text, confirmed, raw]) => {
      if (this.doc.kind !== "font" || !marker || typeof marker !== "object") return [marker, text, confirmed, raw];
      let id = this.fontIds.get(marker);
      if (!id) { id = this.nextFont++; this.fontIds.set(marker, id); this.fonts.set(id, marker); }
      return [id, text, confirmed, raw];
    }));
  }

  decodeRuns(raw) {
    if (raw == null) return null;
    const runs = JSON.parse(raw);
    if (this.doc.kind !== "font") return runs;
    return runs.map(([id, text, confirmed, raw]) => [typeof id === "number" ? this.fonts.get(id) : id, text, confirmed, raw]);
  }

  add([y, x, size, text, runs]) {
    this.insertPiece.run(y, x, size, text, this.encodeRuns(runs));
  }

  finish({ onConfirmedRepair = null, joinRuns, pageLeft = 0, pageWidth = 0, pageHeight = 0, hasTableRules = false }) {
    if (!this.active) throw new Error("No PDF page is being collected");
    let changedLines = 0;
    let impossibleBefore = 0;
    let impossibleAfter = 0;
    let hasRepair = false;
    for (const piece of this.pieces.iterate()) {
      let text = piece.text;
      let runs = this.decodeRuns(piece.runs);
      if (this.doc.kind === "legacy" && Array.isArray(runs)) {
        for (const run of runs) run[1] = run[2];
        const after = runs.map((run) => run[1]).join("");
        if (after !== text) hasRepair = true;
        changedLines += differentLines(text, after);
        impossibleBefore += countImpossiblePairs(text);
        impossibleAfter += countImpossiblePairs(after);
        text = after;
      }
      const encoded = this.encodeRuns(runs);
      let inserted = false;
      // A witnessed visual glyph may have decoded to an empty string in a
      // rejected ToUnicode map. It is not a duplicate of nearby visible text.
      const emptyVisualRun = !text && this.doc.kind === "font"
        && runs?.some(([font, , , raw]) => font?.visualUnicodeGlyphs && typeof raw === "string" && raw.length);
      if (!emptyVisualRun) {
        for (const old of this.nearby.iterate(piece.x - 1, piece.x + 1, piece.y - 1, piece.y + 1)) {
          if (Math.abs(piece.x - old.x) > 1 || Math.abs(piece.y - old.y) > 1) continue;
          if (text === old.text || old.text.includes(text)) { inserted = true; break; }
          if (old.text && text.includes(old.text)) {
            this.updateUnique.run(piece.y, piece.x, piece.size, text, encoded, old.slot);
            inserted = true;
            break;
          }
        }
      }
      if (!inserted) this.insertUnique.run(piece.y, piece.x, piece.size, text, encoded);
    }
    if (hasRepair) onConfirmedRepair?.({ summary: { changedLines, impossibleBefore, impossibleAfter } });

    // A landscape sheet may contain two book pages side by side. When both
    // halves have substantial text over overlapping vertical ranges, keep
    // their lines separate and read the left half before the right. Without
    // that evidence retain the usual top-to-bottom page order.
    let spread = false;
    const middle = pageLeft + pageWidth / 2;
    if (!hasTableRules && pageWidth >= pageHeight * 1.25 && pageHeight > 0) {
      const halves = [0, 1].map(() => ({ count: 0, low: Infinity, high: -Infinity, y: null, chars: 0 }));
      const finishBaseline = (half) => {
        if (half.y === null || half.chars < 20) return;
        half.count += 1;
        half.low = Math.min(half.low, half.y);
        half.high = Math.max(half.high, half.y);
      };
      for (const piece of this.columnEvidence.iterate()) {
        if (piece.x < pageLeft || piece.x > pageLeft + pageWidth) continue;
        const half = halves[piece.x < middle ? 0 : 1];
        if (half.y === null || Math.abs(piece.y - half.y) > 3) {
          finishBaseline(half);
          half.y = piece.y;
          half.chars = 0;
        }
        half.chars += piece.chars;
      }
      halves.forEach(finishBaseline);
      const overlap = Math.min(halves[0].high, halves[1].high) - Math.max(halves[0].low, halves[1].low);
      spread = halves.every((half) => half.count >= 5 && half.high - half.low >= pageHeight * 0.2)
        && overlap >= pageHeight * 0.15;
    }
    const groups = spread
      ? [this.sortedLeft.iterate(middle), this.sortedRight.iterate(middle)] : [this.sorted.iterate()];
    let line = 0;
    let ordinal = 0;
    for (const group of groups) {
      let currentY = null;
      for (const piece of group) {
        if (currentY === null || Math.abs(piece.y - currentY) > 3) {
          currentY = piece.y;
          line += 1;
          this.insertAnchor.run(line, currentY);
        }
        this.assignLine.run(line, ordinal++, piece.slot);
      }
    }

    let current = null;
    let ordered = [];
    const flush = () => {
      if (!current) return;
      const text = joinRuns(ordered, this.doc);
      this.insertLine.run(current.id, current.x, current.y, current.size, text);
      ordered = [];
    };
    for (const piece of this.ordered.iterate()) {
      if (!current || current.id !== piece.line) {
        flush();
        current = { id: piece.line, x: piece.x, y: piece.baseline, size: piece.size };
      } else current.size = Math.max(current.size, piece.size);
      ordered.push([piece.x, piece.size, piece.text, this.decodeRuns(piece.runs)]);
    }
    flush();
    this.db.exec("COMMIT");
    this.active = false;
    return this;
  }

  *lines() {
    for (const row of this.readLines.iterate()) yield [row.x, row.y, row.size, row.text];
  }

  clearFinal() { this.db.exec("DELETE FROM final_lines"); }

  putFinal(index, [x, y, size, text]) { this.insertFinal.run(index + 1, x, y, size, text); }

  *finalLines() {
    for (const row of this.readFinal.iterate()) yield [row.x, row.y, row.size, row.text];
  }

  abort() {
    if (!this.active) return;
    this.db.exec("ROLLBACK");
    this.active = false;
  }

  close() {
    if (!this.db) return;
    this.abort();
    this.db.close();
    this.db = null;
    fs.rmSync(this.file, { force: true });
    for (const suffix of ["-journal", "-shm", "-wal"]) fs.rmSync(`${this.file}${suffix}`, { force: true });
  }
}
