/**
 * FILE: Parsed/parser/codepage/zawcode-layout.mjs
 *
 * THE ZAWCODE KEYMAGIC LAYOUT, BUILT AGAINST THE INPUT CMAP.
 *
 * Built from the Keymagic layout in ./zawcode.kms ("ဇော်ကုဂ်": type the
 * Zawgyi key sequence, output Unicode) integrated with the INPUT cmap of
 * the ယဲ့နင် book: the Myanmar3 + MyanmarText subset cmaps embedded
 * in "Praser/File/upload/pdf/ယဲ့နင် စာစဉ် a ၁.merged.merged.pdf"
 * (Word 2010, 4,414 pages; ./zawcode-cmap.json is the extraction).
 *
 * Integration rule: a key slot enters the table only if every code point
 * the layout makes it emit is one the input font cmap can name. Measured
 * on that cmap: 92 slots, 0 dropped -- every Myanmar code point the
 * layout can produce (75) exists in the Myanmar3 subset cmap.
 *
 * Slots are keyed by the keyboard slot character itself (US layout:
 * unshifted = lowercase / digit, shifted = uppercase / symbol), so the
 * table states the layout's emissions in the same slot terms the .kms
 * uses. The layout's U+200A composition placeholder ($nbsp, typed
 * before ေ and ြ so the engine can re-order) is NOT document content
 * and is stripped here; the re-order rules live in the .kms (typing
 * side) and in text/cleanup.mjs `unmixZawCodeMarks` (reading side --
 * the side the parser runs, on text the input cmap already decoded).
 * Dead-key states (GRAVE_ACCENT/TILDE) have no byte form and exist
 * only in the .kms.
 */

/* Myanmar code points named by the ယဲ့နင် INPUT fonts' cmaps
   (Myanmar3 \u222a MyanmarText subsets, extracted 2026-10-20; full maps in
   ./zawcode-cmap.json). This is the inventory the layout was integrated
   against -- the writer font of the output PDF plays no part here. */
export const ZAWCODE_INPUT_CMAP_INVENTORY = new Set([
  0x1000,0x1001,0x1002,0x1003,0x1004,0x1005,0x1006,0x1007,0x1008,0x1009,0x100A,0x100B,0x100C,0x100D,0x100E,0x100F,0x1010,0x1011,0x1012,0x1013,0x1014,0x1015,0x1016,0x1017,0x1018,0x1019,0x101A,0x101B,0x101C,0x101D,0x101E,0x101F,0x1020,0x1021,0x1023,0x1024,0x1025,0x1026,0x1027,0x1029,0x102A,0x102B,0x102C,0x102D,0x102E,0x102F,0x1030,0x1031,0x1032,0x1036,0x1037,0x1038,0x1039,0x103A,0x103B,0x103C,0x103D,0x103E,0x103F,0x1040,0x1041,0x1042,0x1043,0x1044,0x1045,0x1046,0x1047,0x1048,0x1049,0x104A,0x104B,0x104C,0x104D,0x104E,0x104F,0x1050,0x1051,0x1052,0x1053,0x1054,0x1055,0x1056,0x1057,0x1058,0x1059,0x1065,
]);

/* slot code -> the Myanmar text that keyboard slot stands for, exactly
   as <VK_*> rules in ./zawcode.kms define them (placeholder stripped). */
const ZAWCODE_SLOT_ENTRIES = [
  [32, ' '], [33, '\u100d'], [34, '\u1013'], [35, '\u100b'],
  [36, '\u104c'], [37, '%'], [38, '\u101b'], [39, '\u1012'],
  [40, '('], [41, ')'], [42, '\u1002'], [43, '+'],
  [44, '\u101a'], [45, '-'], [46, '.'], [47, '\u104b'],
  [48, '\u1040'], [49, '\u1041'], [50, '\u1042'], [51, '\u1043'],
  [52, '\u1044'], [53, '\u1045'], [54, '\u1046'], [55, '\u1047'],
  [56, '\u1048'], [57, '\u1049'], [58, '\u102b\u103a'], [59, '\u1038'],
  [60, '\u101d'], [61, '='], [62, '\u1008'], [63, '\u104a'],
  [64, '\u100f\u1039\u100d'], [65, '\u1017'], [66, '\u103c'], [67, '\u1003'],
  [68, '\u102e'], [69, '\u1014'], [70, '\u1004\u103a\u1039'], [71, '\u103d'],
  [72, '\u1036'], [73, '\u103e\u102f'], [74, '\u1032'], [75, '\u102f'],
  [76, '\u1030'], [77, '\u103c'], [78, '\u103c'], [79, '\u1025'],
  [80, '\u100f'], [81, '\u103b\u103e'], [82, '\u103b\u103d'], [83, '\u103e'],
  [84, '\u103d\u103e'], [85, '\u1037'], [86, '\u1020'], [87, '\u103b\u103d\u103e'],
  [88, '\u100c'], [89, '\u1037'], [90, '\u1007'], [91, '\u101f'],
  [92, '\u104f'], [94, '/'], [95, '\u00d7'], [97, '\u1031'],
  [98, '\u1018'], [99, '\u1001'], [100, '\u102d'], [101, '\u1014'],
  [102, '\u103a'], [103, '\u102b'], [104, '\u1037'], [105, '\u1004'],
  [106, '\u103c'], [107, '\u102f'], [108, '\u1030'], [109, '\u102c'],
  [110, '\u100a'], [111, '\u101e'], [112, '\u1005'], [113, '\u1006'],
  [114, '\u1019'], [115, '\u103b'], [116, '\u1021'], [117, '\u1000'],
  [118, '\u101c'], [119, '\u1010'], [120, '\u1011'], [121, '\u1015'],
  [122, '\u1016'], [123, '\u1027'], [124, '\u100b\u1039\u100c'], [125, '}'],
];

/**
 * Build the ZawCode code page against a document font cmap inventory:
 * keep only the slots whose whole output the cmap can name (Latin slot
 * output always passes -- it comes through the document's Latin faces).
 * With no inventory, the layout is taken whole.
 */
export function buildZawCodeCodePage(cmapInventory = null) {
  const table = new Map();
  for (const [slot, text] of ZAWCODE_SLOT_ENTRIES) {
    if (cmapInventory) {
      let named = true;
      for (const ch of text) {
        const cp = ch.codePointAt(0);
        if (cp >= 0x1000 && cp <= 0x109F && !cmapInventory.has(cp)) { named = false; break; }
      }
      if (!named) continue;
    }
    table.set(slot, text);
  }
  return table;
}

/* The layout integrated with the ယဲ့နင် input
   cmap. On that inventory nothing is filtered out (92/92 slots). */
export const ZAWCODE_LEGACY_CODE_PAGE = buildZawCodeCodePage(ZAWCODE_INPUT_CMAP_INVENTORY);

/* Routing note: this slot table is the built layout artifact, not a
   document decode candidate and not a font-name gate. Font names lie;
   the runtime identifies ZawCode-stored text by the readable result of
   the document's own cmap read (pipeline's `zawCodeGuard` split from
   the `unicode` win), and repairs the stored order behind the scan
   verdict. The table stays as the tested statement of what each
   keyboard slot emits -- ungated in the legacy competition it would
   out-score wininnwa on a real WinInnwa book (0.979 vs 0.978 on
   bg-mlc-1-1) with cluster-plausible garbage, which is exactly why no
   table competition decides this path. */
