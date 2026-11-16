# Do — from `B.Parser/AUDIT.md`

Ordered work, each item a general rule. No per-book handling. The order is set
by whether the cause can be seen from this checkout at all: that is what decides
whether a fix can be measured, or only asserted.

**Open PR: [#33](https://github.com/htetmyetflam3/Myangustis/pull/33)** —
`arena/0f6e3735-myangustis` → `python`, 42 files (+3,800 / −2,712), not draft,
mergeable, no checks reported on this repo. It carries items 1b/1d/1e-partial below: the two
legacy parsers and the acceptance rule that lets either win, the per-face program
identity, the disarmed lane move with its pin kept, and this file plus
`B.Parser/AUDIT.md`. It is **Python only** — the JS notes in here are for main, and
nothing on the non-legacy path (zawcode / rabbit / aligned) is judged or changed by it.
It is ready to land as it stands (`283 passed, 37 skipped, 94 subtests`,
`audit_overview --check` OK); the only asymmetry it carries is the parity one in
Q3. Note for the record: a workspace restore flattened the branch back to its base
(`52d7a21`) mid-work, so the earlier commit-by-commit history of these steps is
gone; the content arrives as the commits now on this branch.

**Done: the separate Engine-normalize call is deleted.** The chain reaches the
Engine once, at its end — `normalize/pos_scan.py` → bind-engine api
(`myangustis_engine.api.collect`); `resources/engine.py` takes engine *data* only.
Bind was traced, not assumed: `api.collect` →
`bind_engine({'sourceText','flag'})` → `read_from_api` → `mapperNormalize(block)` =
`mapperStr(reorderAndWrap(normalize(…)))` (Python `A.Engine/.../generators/input.py:3-5`,
`map/normalize.py:89,95`; JS `@postprocess/bind-engine.js` → `A.Engine/.../init/bridge.js:12,19`
→ `MonoSyllabism/generators/input.js`, `normalize(block)` on every block). The
normalize is the first thing behind the door, so a parser-side one is the same pass
twice — and it is not a repair, because bind never writes its normalized text back.
So a second, separate normalize beside that call was the thing to remove, not to
re-attach: `normalize/judgement.py`'s inherited TEXT KEEPING plumbing
(`normalize_page_lines`/`normalize_output_text`, the orphaned remnant of the deleted
`normalize.js`) is gone with its two `test_mirror.py` pins, and nothing else loaded
it. Legacy ordering and the injected-gate question are both settled the same way:
the parser owns cleanup at `finish.py`, the Engine owns what happens behind bind.
The JS is in the same state — its only separate caller is
`test/parser-test/zawcode-order.test.js`, through `@rule/judgement.js`'s
`normalizePageLines`/`normalizeOutputText` and `getEngineNormalize` — so deleting
those three sites is main's action: `B.Parser/AUDIT.md`,
*"The separate Engine-normalize call is deleted; bind engine is the only door"*.

1. **A legacy page keeps the visual order its file wrote.** Open, and **not**
   something the finishing stage may fix. What is true of the engine's normalize:
   `A.Engine/.../MonoSyllabism/map/normalize.py` sorts a base's marks by
   `mapData.Priority` (`reorderAndWrap`) and strips glue and imposters
   (`normalize`); `normalize/cleanup.order_text` is that rule plus the pre-base
   movement from `@postprocess/beautify/clean.js`, which knows `ေ` and the four
   medials and nothing else. A mark that leads a run has no base in front of it
   because its base never arrived — a wrong code page (item 1b), a line broken
   inside the cluster (2), an unmapped glyph (3) — so no ordering rule can move
   it, and the pass that appeared to (a `bind_leading_marks` helper in
   `legacy_order`, called by the finish stage and by the extraction join behind a
   font-name gate) is deleted: it had no JS ancestor, it made the 312-sample
   parity test unable to compare exactly, and it turned a decode-stage bug into a
   silent cosmetic fix.
   Measure: `orphan` from `normalize/scan.py`. After `order_text` the corpus
   leading characters are `ေ` 1,243 · `ိ` 887 · `ာ` 812 · `ျ` 576 · `ု` 505 —
   the `ေ` cases are normalize refusing to move a mark with no base after it, and
   that refusal is the lead into items 2 and 3.
   The circle in this item -- the legacy lane's own ordering -- is **implemented in
   turn 3**: `normalize/legacy_order.arrange_legacy_order` (moved out of
   `extract/pdf_extract.py`, where it sat behind a `legacy_text_fix` boolean the
   pipeline switched off, and the switch is deleted with it) runs in
   `finish.apply_decision`'s `legacy` branch, one step before the shared ordering,
   and moves 39 of the 310 parity samples -- all of them `decision == 'legacy'`,
   which is the gap `test_pdf_finish_js_parity.py` pins until main mirrors the
   rule. It also carries the ZawCode swap (`_zawcode_swap`, its own descendant),
   and an unnamed face is decided by `extract/legacy_lane_score.decide_lane` --
   one module that imports mm-score, the scanner, the shared-glyph test and
   English-likeness, called by the instructor, instead of a second page pass
   through the chain. ~~empty in both trees~~ was: `legacy_order`'s unwired slot rules
   (`legacy_bases`, `reorder_legacy_slots`, `reorder_zawcode_text`,
   `count_zawcode_evidence`) and the `tools-box/python/zawcode-*.py` generators
   that were their only readers are **deleted**, because a rule nothing calls is
   worse than no rule at all. Landing it means the JS `decision === "legacy"`
   branch and `finish.apply_decision`'s `legacy` branch in one movement, with the
   parity suites re-pinned in the same commit: `B.Parser/AUDIT.md`,
   *"The legacy ordering rule does not exist in either tree"*.
1a. **The gate has no switch.** Done, and it was a design violation sitting in
   plain sight: an `apply_cleanup` boolean threaded from `workflow/finish.clean`
   through nine functions and the entry callers, so a caller could hand back a page
   with ordering applied and cleanup skipped. `clean()` is now unconditional —
   normalize plus imposter replacement, every page of every lane, and when it
   returns the page leaves the parsing chain — with `ordered()` kept only as the
   report's `base` column beside it. `test_shared_finish.test_the_gate_has_no_switch`
   fails if a `cleanup` parameter comes back to any of them. The JS side still
   threads its `applyCleanup` (`@core/runtime/finalized-cmap.js`,
   `convertFinalizedPageText`) and is listed for deletion in `B.Parser/AUDIT.md`.
1b. **A legacy face the file does not name gets the wrong subset table.** Done,
   and it is the parse side of the same lane, not a beautify: the two tables
   disagree on 92 of the 109 slots they share, and every face whose name says
   nothing silently took the WinInnwa default. The old design already had the
   answer — `@core/pdf/legacy-judgement.js`, "the caller decodes the same page
   sample under each code page and this layer scores which reading is real
   Burmese" — with no Python caller. It has one now:
   `extract/legacy_judgement.decide_legacy_family` (scoring, floor 0.85, minimum
   50 marks), applied by `FontDecoder.settle_legacy_family` to a sample collected
   by `extract/pdf_extract._settle_legacy_families`. Measured through the
   pipeline door: `orphan` 96 → 0 on a page with one named and one unnamed face,
   written in Ayar codes; a pinned name is never asked, and an undecided sample
   keeps the default with the attempt recorded. `test_legacy_family.py`.
   Two things deliberately **not** done here: the choice was not moved into the
   beautify stage (a wrong table is a wrong *character*, not a wrong order, and
   only the parse stage has the raw codes and both tables), and it was not decided
   per page beyond one page (a table is a font fact — per-page scoring would
   let 400 pages of one face disagree).
1d. **Make the subset bridge callable, then test it.** Partly done, and the
   measurement killed the part that should not have been tried. A face now has an
   identity: `FontDecoder.program_sha256`, with `.pairable` answering whether the
   file embeds a program at all, from the named function
   `pdf_fonts.font_program_sha256` (`pdf_fonts.py:1803`) — sha256 of `FontFile2`,
   `FontFile3` or `FontFile`, read off the descendant for a CID face, memoised per
   `/Font` object, computed for every face on both lanes because the lane trial
   reads the *shared* decoders. The pool pairing stayed as narrow as JS's guard:
   `FontFile2` only (`truetype_only=True`, `pdf_fonts.py:1905-1912`), so a CFF or
   Type1 face never inherits a profile cut from TrueType bytes. The null cases have
   tests (`FaceIdentityTests`, `test_legacy_family.py`).
   **Why nothing is keyed by the name:** measured over the two books against the
   22-profile pool, 1 name of 29 pairs on part-4 and 0 of 65 on part-1, while
   `wininnwa` answers to five embedded programs and `zawgyione` to sixty plus 1,032
   unembedded references. So `DocumentDecoding.lane_trial` is keyed by the hash, and
   a face with no program in the file is not asked at all — nothing committed, the
   instructor keeps the side he chose. `B.Parser/AUDIT.md`,
   *"Pairing a face with a hash, and what happens where it cannot pair"*.
   **Still open:** the return shape. The five fields are verified inline and the
   answer is only ever a code page; there is no
   `subset_font_bridge(font_sha256, to_unicode_sha256, base_font, first_char,
   last_char, has_encoding)` for another caller to ask, and no
   `fontFamily`/`layoutTable` pair to say with the answer that it describes one
   resource and not a family. JS's *order* of authority is deliberately not
   reproduced — it gates the hash lookup on `/^(?:wininnwa|arlarwade|amyanmar|ayar)/`
   before hashing, where this hashes every face and makes `baseFont` equality part of
   the verification, which is the stricter reading of "names only with a verified
   name" and costs one sha256 per embedded program. `pdf-legacy-bridge.test.js`'s
   three real-hash cases cannot be ported while that JS tree and the source PDFs
   (branch `trash`) are out of reach.
1e. **Widen the code-page probe to what the lost `extend` version did.** The port
   this turn matches the *restored* `legacy-judgement.js` (one sample, floor, mark
   minimum), and that module is a reduced survivor. `extend/codepage-resolve.js
   chooseCodePage` (deleted in `764b272`) sampled up to six pages per candidate,
   built a `DocumentDecoding` per table rather than swapping one field, kept a
   ledger (`candidates`, `zeroedForFewMarks`, `pagesAsked`, `pagesUsed`,
   `pagesFailed`, `marks`) and emitted it as a `codepage` event, and ranked
   `UNICODE_PATH` as a third candidate so "neither table — this is Unicode" is an
   answer. All four are still open. Do the ledger first: an accepted-or-not decision
   with no page count next to it cannot be audited against the books.
1f. **Do not ship the pooled map.** `pooled-keyboard-font-evidence.json` (7.4 MB)
   is the widest name+hash evidence in the old design and Python never loads it.
   If `pdfRepairCandidates` is ever ported, the map belongs beside the source PDFs
   (branch `trash`), not in `maps_data/` — the same rule that keeps 20 MB of txt
   out of this repository.

1g. **The stem pass can see every file fact about a face; keep it to that.** The
   question the lane work raised, answered by looking: `workflow/pipeline.py:200-234`
   walks every `/Font` of every page *before any page is parsed*, keys `stem_fonts` by
   the resource reference so a face is asked once for the book, and already records
   `baseFont`, `subtype`, whether `/ToUnicode` is a reference and whether that map
   speaks Myanmar. The dict it holds also has `FirstChar`, `LastChar`, the `/Encoding`
   key and the `FontDescriptor` — i.e. every field the guard in 1d reads, at no extra
   cost (`maps.load_map` is `lru_cache`d, `FontResourceLoader._program_cache` holds one
   digest per face). So the instructor can consult the subset-profile pool all day
   long. What he cannot see from there is the **shown strings**: no content stream is
   decoded in the stem pass, so the stem can say "this face is a witnessed subset
   profile" and can never say "this page reads as Burmese". Acceptance therefore stays
   in the lane, and the swap is not to be moved there.
   Two rules for whoever lifts the lookup: do not widen `instruction_lane`'s inputs
   (`(page_instruction, source_encoding)`, pinned by `test/parser-tests/test_mirror.py`)
   — a new fact inside that function breaks the mirror, so carry it beside it as a
   face fact; and do not let a witnessed profile become a *lane* answer, it pins a
   code page for one program and says nothing about the page. Whether the lane gate
   should prefer a profile's `codePage` over its own name-derived default when the two
   disagree is **unmeasured**, because on these books one face of ninety-four pairs.

1c. **Still open, and it is a data question:** the lane gate reads
   `legacy-font-names.json`, generated from JS's two sets, and `ayar` itself is
   missing from them — `legacy_font_family('/EAAAAA+Ayar')` says `'ayar'` while
   `is_legacy_font_name` says no, so a page whose only face is named Ayar never
   enters the legacy lane at all. Fixing it means either a Python-side registry
   entry (diverges from the pinned JS data) or upstream data. Do not "fix" it by
   loosening the lane gate to font-name substrings: that is how the modern Unicode
   font named *Ayar* gets read through a subset table.
2. **No-bridge fonts lose their marks** (worst case: `part-3` p754 — consonants
   decode, marks arrive as `:`, `"`, `p`, `g`; the file has fonts with zero
   `/ToUnicode`). Fix: recover per-glyph identity from the font program — glyph
   names first (`uni103A`, `kha`), outline hash second, against a table learned
   from the faces that do have a bridge. Unrecoverable glyphs stay visible,
   never guessed. Blocked here: those font programs are in the PDFs on branch
   `trash`.
   Measure with `orphan` and `stray` per page — **not** `latin_in_mm`, which is
   computed by nothing in this repository (it came from the scratch aggregator
   that was never committed).
3. **Lines split inside a cluster.** The run join breaks a line on a gap that
   falls between a base and its marks. Fix: a gap never splits a cluster —
   `extract/pdf_extract._join_page_runs`, where the slot repair already lives,
   is the stage that knows the runs.
   **The metric named for this (`short_share`, and the 0.43 figure) does not
   exist in the source**, so nothing here can confirm or refute it. Before this
   item can be worked, the measure has to be defined where its siblings are: a
   counted field in `workflow/diagnostics.text_metrics`, like
   `single_char_lines`. Until then it is a hypothesis with a number attached.
4. **Zawgyi arrives unconverted** (`ခ်စ္` in book `1683082497742`). The ZawCode
   call currently needs six matching slots *per page*
   (`normalize/judgement.ZAWCODE_MIN_SLOTS`); a page mixing Latin drills with
   Zawgyi never reaches it. Fix: decide ZawCode per run from its own evidence.
   The cause is in this checkout and unit-testable; the effect on the books is
   not, because the scored text has to be regenerated from `trash`.
   Measure: `mm_score.score_text` `duplicate` + `disorder`, and the `်`+`္`
   signature count.

Re-measure after each with the committed scripts, through the doors the design
already has — the pipeline for a page, the parser's own scanner for text, the
overview tool for the audit's numbers:

```bash
python B.Parser/tools/experiment/bridge_report.py <pdf>             # bridge coverage per font
python -m myangustis_parser.normalize.scan <txt> -o <scan>          # damage per rule
python B.Parser/tools/audit_overview.py --check                     # AUDIT.md vs audit/ evidence
python B.Parser/tools/audit_overview.py --write                     # refresh audit/OVERVIEW.md
```

`normalize/legacy_ascii.py` is **not** this design's answer to the table
question, whatever its name suggests: it has no JS counterpart and no
`residue`/`ascii` concept anywhere in the pinned tree, so it arrived with the
recent diagnostics work. Its scan/report half is useful and stays; do not build
the WinInnwa-versus-Ayar decision on top of it, and note that its own per-page
default is *Ayar* while the decoder's is *WinInnwa* — one question, two answers,
until the judgement module above became the single place that answers it.

The scratch `/tmp/aggregate-pages.py` this file used to name as the refresh
command is not in the repository and is not coming back: the per-book rollup it
produced is `audit/broken-books.jsonl`, and `audit_overview.py` reads it.

Measuring a lane on the wrong text is how a fix gets away with doing nothing.
`Junk/parsed-books.txt` is mostly Zawgyi output — Rabbit's ground, not path 2's —
and the unwired `legacy_order` slot rules were tested against it first: they
changed 15,846 of its 44,601 lines and removed **zero** `orphan` and
`impossible` hits. A page has to be built through `pipeline` with a legacy face,
decoded and finished, and read back with the scanner.

Source PDFs are on branch `trash` (`pdf-parts/part-1..9.pdf`), never in this repo.

## Open questions

The ones this branch cannot answer by itself — each is a decision, not a task. The
measurement that frames it is named, so answering means choosing, not re-running.

- **Q1 · Does a witnessed profile outrank the lane gate, or only the face?** (1d, 1g)
  A profile pins a code page for one program; the gate decides a lane for one page. The
  lookup could move up to the stem pass for free, and the question left is whether the
  gate should *prefer* a profile's `codePage` over its name-derived default when the two
  disagree. **Unmeasured**: on these books 1 face of 94 pairs, so any answer now is a
  guess about a population that does not exist here. Blocked on data, not on code —
  it needs more profiles in `legacy-subset-profiles.json`, or a book that carries them.
- **Q2 · Is `ayar`'s absence from `legacy-font-names.json` upstream data or a Python
  entry?** (1c) `legacy_font_family('/EAAAAA+Ayar')` answers `'ayar'` while
  `is_legacy_font_name` says no, so a page whose only face is named Ayar never enters
  the lane. A Python-side entry diverges from the pinned JS sets. **main's call** —
  the note is written, this branch will not loosen the gate to name substrings.
- **Q3 · Does main mirror `arrange_legacy_order`?** The Python `legacy` branch of
  `finish.apply_decision` moves 39 of the 310 parity samples, all of them
  `decision == 'legacy'`; the JS `decision === "legacy"` branch has no such step, so
  `test_pdf_finish_js_parity.py` pins the difference *until* main lands it. Same
  question for the deletions listed in `B.Parser/AUDIT.md` (the three
  `@rule/judgement.js` normalize sites, `applyCleanup` in
  `@core/runtime/finalized-cmap.js`). **main's action**; the parity suite is the
  countdown.
- **Q4 · Is a *learned* bridge acceptable for a no-bridge face?** (2, 1f) Marks of a
  font with no `/ToUnicode` currently arrive as `:`, `"`, `p`, `g`. Recovering them
  needs either the pooled evidence (7.4 MB, deliberately not shipped) or a table
  learned from the faces that do have a bridge — glyph names, then outline hash. The
  design forbids guessing, so the open question is what counts as evidence:
  a *derived* mapping is not the file's own. Needs the `trash` PDFs to measure at all.
- **Q5 · What is `short_share`, exactly?** (3) A line broken between a base and its
  marks is the named cause, and the metric for it exists in nothing but the deleted
  scratch aggregator. It has to be defined where its siblings are — a counted field in
  `workflow/diagnostics.text_metrics`, beside `single_char_lines` — and a definition
  (which gap, which neighbour, per line or per run?) is a decision, not an
  implementation detail.
- **Q6 · Should the probe keep a `UNICODE_PATH` third candidate?** (1e) The lost
  `extend/codepage-resolve.js chooseCodePage` could answer "neither table — this is
  Unicode", which is the lane gate admitting it was wrong. The port matches the reduced
  restored module (one sample, floor, mark minimum) and the lane can currently only
  abstain or take a table. Adding the candidate is a real change to what the lane may
  say, so it is asked rather than done. The ledger (`pagesAsked`, `pagesUsed`,
  `pagesFailed`, `zeroedForFewMarks`) is not a question and is open to work.
- **Q7 · Is "the trial pins the face, never the lane" final?** The move was tried,
  measured on both books and disarmed (`ceaea30` in the flattened history): the trial's
  sample is read through the shared decoder, so it gets the map's text for free while
  the legacy decoder rightly does not trust that map — the CID-bridged version cost
  363,115 Myanmar characters on part-1. If a lane move is ever payable, the price is
  defined by that number; until then the answer recorded here is *no*.

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

Committed evidence: `B.Parser/audit/parts/part-N.log`,
`B.Parser/audit/scans/part-N.scan.txt` and `B.Parser/audit/broken-books.jsonl`,
digested into `B.Parser/audit/OVERVIEW.md`. The decoded txt is regenerated with
the command in `B.Parser/AUDIT.md` — with `PARSER_DIAGNOSTICS=1` if the run is
meant to leave the per-page record behind.
