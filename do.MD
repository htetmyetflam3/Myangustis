# Parser follow-ups

## Parser chain guard

The requested pinned test tracks the parser chain: which stages run and their
order from instruction through finalization for each covered lane and task. It
should catch missing or reordered stages while allowing page or line
implementations and synchronous or asynchronous calls. Repair may remain
unwired or pass-through. Automatic PDF OCR and embedded DOCX image OCR are
excluded from this guard by request; their issues remain follow-ups below.
The purpose is to stop phase and rule-stage placement drifting over time and
changing output. The guard does not pin individual rule results or every other
behavior test; those can be checked separately. On a chain failure, revert the
change that broke it rather than adjusting the chain or test to hide the failure.

The guard checks stage data flow without pinning exact output text. Its current
observers are tied to particular function entry points; support for arbitrary
page/line or async implementations is still incomplete.

## OCR follow-ups

- **DOCX image OCR:** recognized text is inserted after the DOCX chunk has been
  cleaned, so the inserted text misses that step. Route it through the shared
  later phase and scan it before output. A generated-input probe exposed this;
  this path is excluded from the pinned chain guard.
- **Automatic PDF OCR:** the parser's SSH parse runner sets `PRASER_OCR=off`.
  A local run verified that setting prevents automatic OCR; with OCR enabled,
  `prepare_job` can call it for image-only pages. The cleaned OCR text currently
  misses the structural scan. Check the deployed environment before claiming
  whether other live entry points reach it. This path is excluded from the
  pinned chain guard.

Ordered work, each item a general rule. No per-book handling. The order is set
by whether the cause can be seen from this checkout at all: that is what decides
whether a fix can be measured, or only asserted.

**Merged PR: [#33](https://github.com/htetmyetflam3/Myangustis/pull/33)** —
merged into `python` on 2026-11-19. It carried the Python legacy judgement and
acceptance rule, per-face program identity, the disarmed lane move with its pin
kept, and this task note plus the parser audit note later removed from the
package. It is **Python only** — the JS notes in here are for main, and nothing
on the non-legacy path (zawcode / rabbit / aligned) was judged or changed by
it. The merged code is the baseline for the remaining items below, not pending
PR work; the outstanding parity asymmetry is still Q3.

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
`normalizePageLines`/`normalizeOutputText` and `getEngineNormalize`. Deleting
those three JavaScript sites remains outside this Python change.

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
   a difference the now-removed `test_pdf_finish_js_parity.py` used to pin. It also carries the ZawCode swap (`_zawcode_swap`, its own descendant),
   and an unnamed face is decided by `extract/legacy_lane_score.decide_lane` --
   one module that imports mm-score, the scanner, the shared-glyph test and
   English-likeness, called by the instructor, instead of a second page pass
   through the chain. ~~empty in both trees~~ was: `legacy_order`'s unwired slot rules
   (`legacy_bases`, `reorder_legacy_slots`, `reorder_zawcode_text`,
   `count_zawcode_evidence`) and the `tools-box/python/zawcode-*.py` generators
   that were their only readers are **deleted**, because a rule nothing calls is
   worse than no rule at all. Landing it means the JS `decision === "legacy"`
   branch and `finish.apply_decision`'s `legacy` branch in one movement, with the
   parity suites re-pinned in the same commit.
1a. **The gate has no switch.** Done, and it was a design violation sitting in
   plain sight: an `apply_cleanup` boolean threaded from `workflow/finish.clean`
   through nine functions and the entry callers, so a caller could hand back a page
   with ordering applied and cleanup skipped. `clean()` is now unconditional —
   normalize plus imposter replacement, every page of every lane, and when it
   returns the page leaves the parsing chain — with `ordered()` kept only as the
   report's `base` column beside it. `test_shared_finish.test_the_gate_has_no_switch`
   fails if a `cleanup` parameter comes back to any of them. The JS side still
   threads its `applyCleanup` (`@core/runtime/finalized-cmap.js`,
   `convertFinalizedPageText`); removing that option is a separate JavaScript-side follow-up.
1b. **A legacy face the file does not name gets the wrong subset table.** Done,
   and it is the parse side of the same lane, not a beautify: the two tables
   disagree on 92 of the 109 slots they share, and every face whose name says
   nothing silently took the WinInnwa default. The old design already had the
   answer — `@core/pdf/legacy-judgement.js`, "the caller decodes the same page
   sample under each code page and this layer scores which reading is real
   Burmese" — with no Python caller. It has one now:
   `extract/legacy_lane_score.decide_lane`, wrapping
   `extract/legacy_judgement.decide_legacy_family`, is called by
   `FontDecoder.settle_legacy_family` on strings collected by
   `extract/pdf_extract._settle_legacy_families`. The standalone scorer retains
   its 0.85 floor for comparison; the lane wrapper selects the better table
   relatively and abstains for fewer than 50 marks. Measured through the pipeline
   door: `orphan` 96 → 0 on a page with one named and one unnamed face, written in
   Ayar codes; a pinned name is never asked, and an insufficient sample keeps the
   default with the attempt recorded. `test_legacy_family.py`.
   Two things deliberately **not** done here: the choice was not moved into the
   beautify stage (a wrong table is a wrong *character*, not a wrong order, and
   only the parse stage has the raw codes and both tables), and it does not let
   each page commit a conflicting table. A short sample can accumulate across
   up to three attempts; the resulting answer is pinned once to that face for
   the rest of the document.
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
   instructor keeps the side he chose.
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
1e. **Make the code-page probe auditable before widening it.** The ledger is now
   implemented without changing which table wins. The current Python path can
   accumulate shown strings across up to three probe attempts (bounded by
   `PROBE_SAMPLE_BYTES`), tries Ayar and WinInnwa, and keeps one answer on the face.
   Each attempt records `candidates`, `zeroedForFewMarks`, `pagesAsked`,
   `pagesUsed`, `pagesFailed`, marks and candidate scores/evidence. With both
   `PARSER_DIAGNOSTICS=on` and `PARSER_LOG_ENABLED=on`, the file gets a
   `[PDFDIAG] codepage` event per attempt; it contains counts and evidence, never
   decoded sample text. `attempts` counts evaluations; `pagesAsked` counts distinct
   one-based PDF pages that showed the face; `pagesUsed` counts pages retained in
   the current bounded sample; `pagesFailed` counts distinct pages that raised in a
   candidate decode (with the candidate breakdown in `candidates`). A candidate's
   `pagesUsed` is zero when its sample read failed; `zeroedForFewMarks` counts
   candidate evaluations below the mark minimum, with counts by candidate.

   **Still open:** the lost `extend/codepage-resolve.js chooseCodePage` sampled up
   to six pages *per candidate* and built a separate `DocumentDecoding` per table;
   the current path still swaps the table on the face's decoder and is capped at
   three attempts. Ranking `UNICODE_PATH` as a third candidate remains Q6, a
   behavior decision rather than part of the ledger task. The source PDFs on
   `trash` are not required to unit-test or audit the ledger, but they are needed
   to measure any wider probe against the books.
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
   (`(page_instruction, source_encoding)`, previously pinned by the removed mirror checks)
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
already has — the pipeline for a page, the parser's own scanner for text, and
the saved sample overview:

```bash
python B.Parser/tools/experiment/bridge_report.py <pdf>             # bridge coverage per font
python -m myangustis_parser.normalize.scan <txt> -o <scan>          # damage per rule
python B.Parser/tools/audit_overview.py --check                     # overview vs committed evidence
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
  the removed `test_pdf_finish_js_parity.py` used to pin the difference. The same
  question applies to the three JavaScript-only normalize sites and
  `applyCleanup` in `@core/runtime/finalized-cmap.js`. **main's action**; no
  differential test remains for this question.
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
  Unicode", which would let the legacy face probe reject both tables. The current
  path still considers only Ayar and WinInnwa, with a per-face answer or abstention;
  its ledger is implemented and records the page/candidate evidence. Adding a third
  candidate changes what the parser may conclude, so it remains an owner decision.
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
digested into `B.Parser/audit/OVERVIEW.md`. Use the parser CLI described in
`B.Parser/README.md` to regenerate text; enable `PARSER_DIAGNOSTICS=on` when
per-page diagnostics are needed.
