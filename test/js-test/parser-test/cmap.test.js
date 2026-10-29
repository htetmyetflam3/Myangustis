import test from "node:test";
import assert from "node:assert/strict";
import { parseTtfCmap } from "../../../B.Parser/main/parser/core/ttf-cmap.js";
import { parseToUnicodeStream } from "../../../B.Parser/main/parser/read/pdf-extract.js";

















function fontWithCmap(subtable) {

  const dir = Buffer.alloc(12 + 16);
  dir.writeUInt32BE(0x00010000, 0);
  dir.writeUInt16BE(1, 4);
  dir.write("cmap", 12, "latin1");
  dir.writeUInt32BE(0, 16);
  dir.writeUInt32BE(28, 20);
  dir.writeUInt32BE(subtable.length, 24);
  return Buffer.concat([dir, subtable]);
}


function format4(segments) {
  const segCount = segments.length + 1;
  const head = 14;
  const ends = head;
  const pad = ends + segCount * 2;
  const starts = pad + 2;
  const deltas = starts + segCount * 2;
  const ranges = deltas + segCount * 2;
  let glyphBase = ranges + segCount * 2;



  const bodies = [];
  const offsets = [];
  segments.forEach((seg, i) => {
    if (seg.glyphs) {
      offsets.push(glyphBase - ranges - i * 2);
      const buf = Buffer.alloc(seg.glyphs.length * 2);
      seg.glyphs.forEach((g, j) => buf.writeUInt16BE(g, j * 2));
      bodies.push(buf);
      glyphBase += buf.length;
    } else {
      offsets.push(0);
    }
  });

  const total = glyphBase;
  const sub = Buffer.alloc(total);
  sub.writeUInt16BE(4, 0);
  sub.writeUInt16BE(total, 2);
  sub.writeUInt16BE(0, 4);
  sub.writeUInt16BE(segCount * 2, 6);
  segments.forEach((seg, i) => sub.writeUInt16BE(seg.end, ends + i * 2));
  segments.forEach((seg, i) => sub.writeUInt16BE(seg.start, starts + i * 2));
  segments.forEach((seg, i) => sub.writeInt16BE(seg.delta ?? 0, deltas + i * 2));
  offsets.forEach((off, i) => sub.writeUInt16BE(off, ranges + i * 2));
  sub.writeUInt16BE(0xffff, ends + (segCount - 1) * 2);
  sub.writeUInt16BE(0xffff, starts + (segCount - 1) * 2);
  sub.writeInt16BE(1, deltas + (segCount - 1) * 2);
  sub.writeUInt16BE(0, ranges + (segCount - 1) * 2);
  let at = ranges + segCount * 2;
  for (const body of bodies) {
    body.copy(sub, at);
    at += body.length;
  }
  return sub;
}

test("a format 4 segment reached through glyphIdArray reads the right glyph", () => {









  const sub = format4([
    { start: 0x1000, end: 0x1001, delta: 0, glyphs: [0x0e10, 0x0e11] },
    { start: 0x2000, end: 0x2001, delta: 0, glyphs: [0x0e12, 0x0e13] },
  ]);
  const map = parseTtfCmap(fontWithCmap(sub));
  assert.equal(map.get(0x1000), 0x0e10);
  assert.equal(map.get(0x1001), 0x0e11);
  assert.equal(map.get(0x2000), 0x0e12);
  assert.equal(map.get(0x2001), 0x0e13);
  assert.equal(map.size, 4);
});

test("a format 4 segment reached through idDelta still reads the right glyph", () => {
  const sub = format4([{ start: 0x1000, end: 0x1002, delta: -0x0f00 }]);
  const map = parseTtfCmap(fontWithCmap(sub));
  assert.deepEqual([...map.entries()], [
    [0x1000, 0x0100], [0x1001, 0x0101], [0x1002, 0x0102],
  ]);
});


const CMAP_WITH_ARRAYS = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
6 beginbfrange
<00EB> <00F2> <1000>
<0100> <0101> [<0020> <103C>]
<0102> <0103> <1017>
<0104> <010A> [<10191039> <101A> <0020> <1031> <101D> <0020> <101F>]
endbfrange
1 beginbfchar
<0148> <1021>
endbfchar
endcmap
CMapName currentdict /CMap defineresource pop
end
end
`;

test("an entry is never spliced onto the tail of the entry before it", () => {







  const map = parseToUnicodeStream(Buffer.from(CMAP_WITH_ARRAYS, "latin1"));

  assert.equal(map.get(0x0148), "\u1021", "အ survives the range above it");
  assert.equal(map.size, 20, "no phantom range: 8 + 2 + 2 + 7 named codes, plus the bfchar");

  assert.equal(map.get(0x00eb), "\u1000");
  assert.equal(map.get(0x00f2), "\u1007", "a scalar range still increments");
  assert.equal(map.get(0x0100), " ", "the array form still works");
  assert.equal(map.get(0x0101), "\u103C");
  assert.equal(map.get(0x0102), "\u1017");
  assert.equal(map.get(0x0103), "\u1018");

  assert.equal(map.get(0x0104), "\u1019\u1039");
  assert.equal(map.get(0x0106), " ");
  assert.equal(map.get(0x010A), "\u101F");
});

test("a source code is read at the width it was written at", () => {
  const oneByte = parseToUnicodeStream(Buffer.from(
    "1 beginbfchar\n<20> <1000>\nendbfchar\n", "latin1"));
  assert.equal(oneByte.get(0x20), "\u1000");

  const twoByte = parseToUnicodeStream(Buffer.from(
    "1 beginbfchar\n<0020> <1000>\nendbfchar\n", "latin1"));
  assert.equal(twoByte.get(0x20), "\u1000");
});
