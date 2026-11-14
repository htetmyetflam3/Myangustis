# Parse run, log redesign, and what the finish stage still owes JS

Branch `arena/8995c157-myangustis`, rebased on `origin/python` `f5c1514`.

## 1. The run that set the brief

`PARSER_DIAGNOSTICS=on PARSER_LOG_ENABLED=on PARSER_LOG_FILE=/log/ python B.Parser/main.py parse part-5.pdf ...`

`part-5.pdf` is `pdf-parts/part-5.pdf` from the `trash` branch: 85 pages, 4.1 MB,
Zawgyi-One subsets and a Type0 Zawgyi face, i.e. one of the collections of books
the JS parser failed.

| | before | after |
| --- | --- | --- |
| console | 97 lines / ~240 KB of nested JSON, one ~2.5 KB line per page | 13 lines: 5 page-range decisions, 1 verdict, the normal progress lines |
| file log | 97 lines / ~240 KB, same JSON, no verdict anywhere | 91 lines / 43 KB: 85 one-line page records + decisions + 1 verdict |
| `decision: aligned` on a page with `chars: 0` | indistinguishable from a good page | `status=empty`, counted, and named in the verdict |
| what happened | not stated anywhere | `symptom=legacy-ascii-residue severity=text-corrupted` + counts + font + hint |
| `Aနိမ့်Aမြင့်`, `AကျU်း`, `Aံ့O`, `Eကန်Eက` | 437 Latin slots shipped | all repaired: `အနိမ့်အမြင့်`, `အကျဥ်း`, `အံ့ဩ`, `ဧကန်ဧက` |

Evidence files: `terminal.txt`, `log` copy, `Junk/Parser/output/txt/part-5{,-after}.txt`.

## 2. Log format (the design)

Three layers, because one layer cannot serve both an operator and a post-mortem:

1. **`page`** — one compact JSON line per page, **file only**. Scalars that decide
   whether the page is right: `lane`, `lane_reason`, `decision`, `category`,
   `chars`, `myanmar`, `nonempty_lines`, `single_char_lines`, `residue`,
   `residue_unproven`, `unmapped_codes`, `fallback_bytes`, `hex_placeholders`,
   `repeated_lines`, `warnings`, `status`. ~450 bytes, greppable.
2. **`book`** — one record per book, console *and* file. Page counts
   (`ok/repaired/degraded/empty`) plus `symptom`, `severity`, `evidence`,
   `hint`, `also`, `detail`. This is the line a human reads; one per book.
3. **verbose** — `PARSER_DIAGNOSTICS_VERBOSE=on` (or `PARSER_DIAGNOSTIC_SAMPLES=on`)
   restores the old full per-page payload with the six counter blocks.

Syndromes (`diagnostics.syndrome`), ordered by how much text they destroy:
`no-myanmar-text` (info) · `no-text-layer` · `legacy-ascii-residue` ·
`unmapped-glyphs` · `hex-placeholders` · `repeated-text` · `fragmented-lines` ·
`latin-fallback` · `duplicated-text` · `ok`. A book can carry a second one in
`also`.

Read a run with:

```bash
grep '"info book "' log/lane-decisions.log | grep -o '"symptom": "[a-z-]*"' | sort | uniq -c
grep '"status": "empty"' log/lane-decisions.log | grep -o '"book": "[^"]*", "page": [0-9]*'
```

## 3. The residue repair (design, not a book tie)

`B.Parser/architecture/normalize/legacy_ascii.py`. A legacy face's /ToUnicode can
be a faithful bridge back to an ASCII layout (A=အ, U=ဥ, O=ဩ, E=ဧ); nothing in the
file names the layout, so the slots arrive as Latin and stay Latin. The repair
maps a slot only when it sits in Myanmar context and is not part of a real Latin
word, so English, numbers and labels survive. Unproven letters (e.g. `V`) are
reported by `scan()` and left visible — a wrong guess is worse than an artifact
you can grep for.

**Open question for the JS-alignment work:** JS may already repair these slots
in its own decode stage. If it does, this module is the wrong place and must be
deleted in favour of whatever JS does — not kept as a second answer.

## 4. What the failed names say, from Python's own output

`Junk/staging/parse-run/triage_failed_names.py` runs the *same* `syndrome()`
over `Junk/parsed-books.txt`, so a failed book is classified from text alone —
no PDF copied, nothing extracted from the parquet. Output:
`failed-names-triage.md`.

What it found, matching the report:

| book | what the text shows |
| --- | --- |
| `-1759341726906` | `နှင် ့` **660 times** — the dot is detached from its base and sits after a space. Second half is ZawCode (rules never fire). |
| `-1708528931770` | `စကပ\t/ရ/၊` fragment repeated — not text; the worst case, 0 readable words. |
| `-1758614468061` | first half, Zawgyi run never fires; text is `ပ[00E5]ပ[00E2]…` code dumps. |

The JS output for these is the reference, not these files: they predate the JS
fix.

## 5. Ordering at the finish stage — the real divergence (open)

Three ordering systems exist and must not be confused:

1. `orderText` — canonical mark-priority order (`@postprocess/beautify/clean.js:783`,
   Python `normalize/cleanup.py:320`). **Python and JS are line-for-line equal,
   and `cleanup_text` equals JS `clean.js:795`.** The divergence is not here.
2. `arrangeZawCodeOrder` — ZawCode draft ordering (`beautify/zawcode-order.js`,
   Python `normalize/beautify.py`), decided by `doc.zawcode_order`.
3. Legacy visual order — `legacy_order.py` / `codepage-visual.js`.

At the finish stage JS `processPageRecord` (`@core/runtime/finish.js:100-200`) does:

```
ZAWGYI  -> base = orderText(Rabbit.zg2uni(raw))
UNICODE -> base = preserveRegionalRuns(raw, orderText)
clean   = cleanupFor(cat, base)          // cleanupUnicode(base), UNICODE and ZAWGYI
text    = applyCleanup ? clean : base
```

Python `workflow/finish.py:finish_pdf_page` does the same two functions **plus**
things JS's finish does not have: `judgement.judge_page_lines` →
`select_page_decision`, the `zawgyi_codepage` swap, a `legacy` decision branch that
orders each line on its own, `finalize_pdf_output` applied to both `base` and
`clean`, and `build_final_pages` running `cleanup_text` **again** per line. That
second ordering at the same stage is the "two order + fallback" to remove in
favour of JS's single ordering, and it is the first suspect for a mark being
pushed past a space (`နှင် ့`).

Next, in order:

1. Reproduce `-1759341726906` with the current parser (one row out of
   `data/books.parquet`, not a bulk extract) and with the current JS parser,
   and diff the **finish stage output**, not the final txt.
2. Delete the extra ordering/fallback from the Python finish path so the stage
   has exactly JS's sequence: decide → one conversion+ordering → one cleanup.
3. Only then re-check `legacy_ascii`: if JS repairs the Latin slots itself,
   remove it.
4. Re-run this triage and the JS comparison over the 133 names, not per book.
