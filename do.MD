# Do — from `B.Parser/AUDIT.md`

Ordered work, each item a general rule. No per-book handling.

1. **No-bridge fonts lose their marks** (worst case: `part-3` p754 — consonants
   decode, marks arrive as `:`, `"`, `p`, `g`; the file has fonts with zero
   `/ToUnicode`). Fix: recover per-glyph identity from the font program —
   glyph names first (`uni103A`, `kha`), outline hash second, against a table
   learned from the faces that do have a bridge. Unrecoverable glyphs stay
   visible, never guessed.
   Measure: `latin_in_mm` on the 1192 flagged pages → 0, `mm` up.
2. **Lines split inside a cluster** (`short_share` up to 0.43 in the
   collection; book `-1708528931770` is 39 % sub-4-char lines). Fix: the run
   join may not break between a base and its marks, whatever the gap.
   Measure: `short_share` on the collection and on `Junk/parsed-books.txt`.
3. **Zawgyi arrives unconverted** (`ခ်စ္` in book `1683082497742`). Fix: decide
   ZawCode per run from its own evidence, not six slots per page.
   Measure: `doubled` + `disorder`, and the `်`+`္` signature count.

Re-measure after each with the same scripts:

```bash
python B.Parser/tools/experiment/bridge_report.py <pdf>        # bridge coverage per font
python /tmp/aggregate-pages.py                                 # refresh audit/broken-pages.jsonl
```

Source PDFs are on branch `trash` (`pdf-parts/part-1..9.pdf`), never in this repo.
