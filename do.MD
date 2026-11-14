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

## Sources

The nine parts live on branch `trash`, never here:

| part | blob | size |
|---|---|---|
| `pdf-parts/part-1.pdf` | `48decf9d31c2` | 33.3 MB |
| `pdf-parts/part-2.pdf` | `05449ff86223` | 47.0 MB |
| `pdf-parts/part-3.pdf` | `02bac26d6d7a` | 41.7 MB |
| `pdf-parts/part-4.pdf` | `26707f323f41` | 9.2 MB |
| `pdf-parts/part-5.pdf` | `ecf079d6f075` | 4.2 MB |
| `pdf-parts/part-6.pdf` | `c9f707041858` | 20.3 MB |
| `pdf-parts/part-7.pdf` | `90758cabeffd` | 20.0 MB |
| `pdf-parts/part-8.pdf` | `db9e8ad289b5` | 10.0 MB |
| `pdf-parts/part-9.pdf` | `bdd5073b43b9` | 12.5 MB |

A label page per source PDF inside each part is what attributes the log's
`book`/`page` and the scan's line numbers to a book.

Committed evidence: `B.Parser/audit/parts/part-N.log` and
`B.Parser/audit/scans/part-N.scan.txt`. The decoded txt is regenerated with the
command in `B.Parser/AUDIT.md`.
