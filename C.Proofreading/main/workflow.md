# The workflow that actually worked — chapters 194–195

This records the process that produced `mt/quality/baseline/ch0194.my.txt` and
`ch0195.my.txt`, written because the **sequence** matters more than any single
rule in it.

Two things are documented here:

1. the step-by-step order the work was actually directed in, which is **not**
   the order `finetune-agent-prompt.md` prescribes;
2. the technique that came out of it.

The headline: **translate blind first, then let the tools correct you.**

`finetune-agent-prompt.md` describes the target correctly. But its procedure is
front-loaded — review first, terminology first, `check_names` per paragraph,
register calibration stated before the first sentence. Following that order
produced stiff Burmese, because attention spent on particle selection is
attention not spent on meaning. The pass that worked inverted it: get the
meaning down in natural Burmese, then measure the result against the rules with
the repo's own tools and repair the deltas.

---

## Where the instructions overrode `finetune-agent-prompt.md`

The prompt's own five steps, and what was actually done instead.

| # | `finetune-agent-prompt.md` says | What was directed instead | Why |
|---|---|---|---|
| 1 | **Read the review once** — `review_brief {}`, then `review_lookup {"chapter": 194}` | **Skipped entirely.** No `review_brief`, no `review_lookup`, no `content/review/burmese-overview.md` | *"u can use other tools except review and previous chapter and other tools that will overhead ur with context."* Also moot: `review_lookup --chapter 194` returns `chapter 194 is outside the indexed arcs` |
| 2 | **Load terminology before the prose** — `lookup_name`, terminology first, style second | Terminology was settled **after** the raw draft, from a census of the author's own usage, then registered through `--register-name` | The raw baseline had to be genuinely blind. Naming it correctly is a later pass |
| 3 | `read_chapter` + `compare_english_chapter` to prove alignment | Kept — this is the one prompt step followed as written | Alignment is cheap and it caught the duplicated page in ch195 |
| 4 | `check_names` on **every** paragraph before `save_draft` | Run once per chapter on the whole text, plus `mt/names.py --check --json` | Per-paragraph checking was not needed once names were already canonical |
| 5 | **Translate one chapter, report and stop. Chapter 195 is a separate session** | Both chapters in one session, strictly sequential: 194 finished, then 195 | *"go write 194 first do one after anothe"* |

Beyond the five steps:

| Prompt | Override |
|---|---|
| *"The English gate and Burmese translation are one task, not separate assignments"* | Split on purpose. **English bridge first as its own deliverable**, Burmese only on a later instruction |
| Output contract is `save_draft` | **Plain `.txt` elsewhere in the repo** — *"in plain txt in else where inside repo write it bro"*. Now `mt/quality/baseline/` |
| *"calibrate voice from the review and earlier style evidence"* | Voice calibrated by **counting the 195 human chapters**, not by reading the review. See phase 2 |
| Register rule: *narration closes on သည် / ၏ / ခြင်း; dialogue inside `“…”` closes on တယ် / ပဲ* | **Extended, not contradicted:** unquoted first-person inner monologue is **also LSN**. The prompt has no rule for it; it was supplied by ruling |
| Report-heavy: honesty sections, flags, notes | *"no u have to fix on ur own not to report bro it is tools to help u."* Fixes get **applied**, not reported |
| — | **Do not build tools.** *"ur task is translation not building more tools the tools r convenience step for u to make fine tune translation result"* — reversed at the end of the session for `register.py` alone |

---

## The sequence as directed

### Step 1 — Read the rules, then set them down

Read `finetune-agent-prompt.md`, `START.md`, `MT.md` (LSE/LSN policy at lines
206–207), `english-review-task.md`, `tools/README.md`. Then stop actively
holding them. They return later as measurements, not as constraints in working
memory.

### Step 2 — English bridge only, 194 then 195

Own English rendering written directly against the Chinese. No API. The
retained API English (`content/mtranslate/english.txt`) and local Argos
(`zh-en.txt`) are witnesses to cross-check, never sources to copy.

Paragraph IDs are stamped into the bridge at this point — `**[001–002]**`,
`**[003]**` — which costs nothing and later made the pairing record derivable
instead of guessed. Coverage came out **166/166 and 197/197, no gaps**.

Output: `content/mtranslate/own-english/ch0194.en.md`, `ch0195.en.md`.
Stop. Deliver. Wait.

### Step 3 — Blind-translate the Burmese baseline

*"now translate plainly to Burmese on ur own without looking anything else as
raw base line."*

No tools, no corpus, no register planning, no `check_names`. Chinese → Burmese
through the bridge, in whatever Burmese comes naturally.

Two hard constraints on the output:

- **zero Chinese characters, zero English words**
- plain `.txt`, in the repo, not via `save_draft`

Keep this draft. It is at `mt/quality/baseline/raw/`. It is the only evidence
that the later passes changed anything, and the contrast is what shows the
tools earned their place. Its measured profile: `ပါသည်` 86 times and
`ကျွန်ုပ်` 87 times in chapter 194 alone — the human author uses neither.

### Step 4 — Establish the author's voice by counting

Before fixing anything, find out numerically what "correct" means.
`mt/translate.py` exposes `burmese_chapters()`, which iterates all 195
human-authored chapters. Count against that corpus instead of reasoning from
the prompt.

What it settled, each overturning something assumed:

- **309 lines begin with `ငါ`; 0 carry an opening quote mark.** The author
  never quotes a thought — hence the unquoted-monologue row in the register
  table.
- Colloquial first-person forms and their real frequencies: `ငါက` 262,
  `ငါလည်း` 28, `ငါကတော့` 8, `ငါတော့` 7.
- `အားယ်` appears **0** times — which turned two occurrences in my own
  chapter 195 from "stylistic choice" into "corruption I introduced".
- Dialogue connective is `ဒါပေမယ့်`, not `သို့သော်`.
- `ပင်` precedes the case marker: `မူလပင်တွင်`, never `မူလတွင်ပင်`.
- `ကျွန်ုပ်` — 0. The character's first person is `ငါ`.

**Substring counting is a trap.** `တယ်` matches inside `အင်မော်တယ်`,
`ဟုတ်` inside `မဟုတ်`, `လုပ်` inside `ပြုလုပ်`, `ကား` inside `စကား`,
`အား` inside `အားလုံး`. Count whole tokens only — and count a particle **only
as an exact tagged token surface**, cross-checked against the original string,
because `ကစား` is a verb, not a `က` plus a verb.

### Step 5 — The correction loop

A loop, not a sweep. Each iteration:

1. **Copy, then tag.** Never tag the original — *"u segment ur file if needed
   copy and use ur copied version to segment."* `mt/quality/tag-both.mjs`
   under `--import ./scraper/wasm/box/runtime-guard.mjs`.
2. **Audit register.** `mt/quality/register.py` walks the tagged stream,
   classifies each block, tracks quote state cumulatively, and reports every
   `{w}` particle whose native register differs from its context.
3. **Use only the segmented output for the multi-tag decisions.** *"u use only
   that segmented output for multi part ignore other phase especially on
   w = ဝိဘတ်."* For each marker: pick the role, check LSE against LSN, then
   apply `resolution.single`.
4. **Pick the role, then the form.** This step cannot be automated.
   `resolution.single` maps a marker to its counterpart **per grammatical
   role**: `မှာ` → `၌` as a place, `သည်` as a subject, `တွင်` as a time.
   `က` is listed under ကတ္တား, ထွက်ခွာရာပြ, နေရာပြ **and** အချိန်ပြ,
   each taking a different LSE form.
5. **Apply, then re-wrap.** Edit at block level on whitespace-normalised text,
   re-wrap to ≤95 columns, re-join blocks with a blank line.
6. **Re-tag and compare** against the previous iteration's numbers.

Nine iterations for these two chapters.

### Step 6 — Names

`နတ်` censused across all 195 chapters before coining anything: `နတ်ဆိုး`
~93, `နတ်လေးပါး` 54, `နတ်ဘုရား` 12, `မာရ်` 0, classifier `ပါး`.
New terms then go in through `tools/mcp_server.py --register-name`, never by
hand-editing the registry, confirmed with `mt/names.py --check --json`.

`--check` also reports *suspected variants*. Several are false positives
(`သိုင်းဝိည`, `တရာယ်ကြီး` are real strings). Verify before touching.

Three terms added for ch194 — `ကပ်ဆိုးနတ်ဘုရား`, `စိတ်နတ်ဆိုး`,
`မိုးခေါင်နတ်ဆိုး` — at `content/reference/EtoBnames.txt` lines 137/139/141.

### Step 7 — Verify

- Tagger on the final text: ch194 100 units / 3,125 tagged tokens / 190
  unknown; ch195 96 / 2,571 / 214.
- `original_master_unchanged` must be `True` — the proof master data was never
  written to.
- Chinese 0, Latin 0, `ပါသည်` 0, `ကျွန်ုပ်` 0, `သည်သည်` 0, `အားယ်` 0.
- `git status` shows only intended files.

---

## The register rule, as finally applied

| register | where |
|---|---|
| LSE literary | default prose / narration |
| LSN spoken | inside quote marks |
| LSN spoken | **unquoted first-person inner monologue** — project ruling |

Consequences that were learned the hard way:

- `ငါသည်` → `ငါကတော့` / `ငါလဲ` / `ငါ`
- `ငါသွားခြင်း` → `ငါသွားတော့` / `ငါသွားရင်`
- Nominalised `V + ခြင်း` does not survive in first person:
  `ရပ်တန့်ခြင်း မရှိတော့ဘူး` → `ရပ်တန့်သွားတာ မရှိတော့ဘူး`
- Inside dialogue the connective is colloquial: `ဒါပေမယ့်`, never `သို့သော်`
- The author never quotes a thought, so monologue carries **no** quote marks

---

## Guards — every one of these was hit at least once

**Match on normalised text, never on a remembered string.** Search strings that
span a soft line break fail silently. Flatten each block with
`" ".join(block.split())`, match there, then re-wrap. Largest single source of
failed edits.

**Re-joining blocks is not joining lines.** `'\n'.join(wrapped)` where blank
paragraphs became `''` destroys paragraph separation. Join with `'\n\n'`. Hit,
caught, repaired by recovering the pre-edit bytes from Git and re-applying all
37 edits.

**Blanket conversions are wrong.** Three separate times:

- `က` → `သည်` everywhere. Wrong inside monologue, and wrong in
  `ကြာမြင့်စွာကပင်` where the `က` is အချိန်ပြ, not ကတ္တား.
- `ကို` → `အား` everywhere. Over-reached into `ကိုယ်` and wrote
  `သူ့အားယ်ပေါ်` / `သူ့အားယ်မှ` — corruption, since `အားယ်` occurs
  0 times in 195 chapters.
- Formalising every `ငါ`-bearing passage. Unquoted `ငါ` is the character
  thinking, which is LSN. Converting it produced the double copula
  `ရှိနေသည်သည်`.

**Do not "fix" what the author wrote.** `ကြာမြင့်စွာ` stays bare. `အိမ်က`
(possessive), `ထားရှိပါက` (conditional) and `ဦးမှာ` (question particle) are
correct. `ထဲ`, `တိုင်း` and `အတွက်` are absent from `resolution.single` and
must be left alone.

**Quote state is cumulative across the document.** Toggling per paragraph
misclassifies multi-line dialogue and mixed blocks such as
`“…” ယဲ့နင်က ပြောသည်။`, whose quoted half is LSN while the narration
tail is LSE.

**Monologue detection must be block-level.** `ငါ`-presence alone misses blocks
like `လူ့လောကက မူလက ဒီလိုပါပဲ။`. Catch those with colloquial tokens
(`ပါပဲ`, `တဲ့`, `လိုက်တာ`), matched as whole tokens.

**A mismatch is a candidate, not a verdict.** The segmentor tags the bare `က`
inside `ကမ္ဘာ` and `တကယ့်`, and `တိုင်း` inside `နေရာတိုင်း`, as
particles. Print the context and check the surface against the original string
before changing anything.

**`raw_pos` is one line per output unit, not per source line.** Chapter 194 has
365 source lines and 100 units. Line numbers there cannot place a token; align
by character offset.

**The segmentor's combining-mark order differs from a hand-written file.**
U+103A and U+1037 come out in a different adjacent order — 174 positions in
chapter 194 — with identical length and content. Canonicalise both sides before
comparing.

---

## The tool calls in order — command, output, decision

This is the log the fine-tuning depends on: what was called, in the order it
was called, what came back, and the single decision that call drove. Every
figure was produced by running the command shown, on this checkout.

### 1. `read_chapter` — the count everything aligns to

```bash
python3 tools/mcp.py --read_chapter 194 --start 1 --count 10
```

`window.total = 166` (194) and `197` (195); `translation.available = false`,
reason *"no API translation at content/mtranslate/rapidapi/ch0194.my.jsonl"*.
Those totals became the alignment target.

Worth knowing: splitting the raw chapter body on newlines gives **167 and
198**, because each body ends with a `[[KMTCRAWLER MARKER 170]]` line.
`audit_source.py` strips those (`_MARKER`, line 50) and `read_chapter`
therefore reports the correct count. Hand-splitting the body does not.

### 2. `compare_english_chapter` — two witnesses that disagree

```bash
python3 tools/mcp.py --compare_english_chapter 194 --start 1 --count 10
```

Three aligned columns — `zh`, `machine_en`, `api_en` — plus a per-source
`alignment` block. `machine_en` came from `content/mtranslate/zh-en.txt` with
`source_checked: true`; `api_en` from `content/mtranslate/english.txt` with
`source_checked: false`. They disagree on paragraph 1 ("shirts, which were
beaten by God" vs "dressed in rusty clothes"), and both are wrong
differently. That is what fixed the working rule: the Chinese is the
authority, the English files are witnesses.

### 3. `compare_english_chapter` 195 — the source defect

Reading windows 61–124 put the duplicate on screen: paragraphs **61–92 repeat
verbatim at 93–124, 32 of 32 byte-identical**, confirmed programmatically.
The first line of the repeated block is a running page header the crawler
glued into the body — an OCR-damaged chapter heading carrying a `3/7` page
marker. Rendered once, flagged for a human ruling.

### 4. `profile.py` — a numeric baseline for the author

```bash
python3 mt/quality/profile.py --chapter 1 --top 6
```

ch1: 89 sentences, 1,516 words, 1,994 units, 26 fragments (1.72%), 17.03
words/sentence, median 17, expansion 3.46×. Dictionary 30,367 entries,
29,571 reachable, 0 unreachable, over 3,229 units. That last pair explains
most of the unknown-tag rate in step 8: an entry not reachable through the
unit inventory cannot be tagged at all.

### 5. `burmese_chapters()` — settle the voice by counting

All 195 human chapters. `ကျွန်ုပ်` occurs **0** times — not rarely, zero.
**309** lines begin with `ငါ`, and **0** of them are quoted. The forms the
author does use: `ငါက` 262 · `ငါလည်း` 28 · `ငါကတော့` 8 · `ငါတော့` 7 ·
`ငါမှာ` 3 · `ငါလဲ` 1.

This was inline shell, not a shipped tool — no tool takes a corpus-wide
question, and `profile.py` is `--chapter`-only with no file-path input. See
gap 6.

### 6. `register_name` / `lookup_name` / `check_names` — the name layer

```bash
python3 tools/mcp.py --lookup_name "ယဲ့နင်"
python3 tools/mcp.py --check_names --text "ယဲ့နင်က ချန်ရှောင်ချန်းကို ကြည့်လိုက်သည်။"
python3 mt/names.py --check --json --text "<chapter text>"
```

`lookup_name` returned one entry, key `Ye Nin`, line 9. `check_names`
returned both names with their registration lines — `ယဲ့နင်` line 9,
`ချန်ရှောင်ချန်း` line 117 under `Chen Shaozheng` — `variants` empty.
`names.py` independently reported 132 entries, hits empty, variants empty.
The three new terms went in through `--register-name` and sit at lines
**137 / 139 / 141** of a 141-line `EtoBnames.txt`.

Two behaviours that cost time: `--check_names --chapter 194` fails with
*"`text` must be a non-empty string"* — it has no chapter input; and
`--lookup_name` indexes English/Burmese keys only, so the Chinese name
returns `count: 0` plus a suggestion to register it, which reads like a
missing name when nothing is missing. `names.py --check` also creates an
untracked `content/mtranslate/agent-drafts.sqlite3`.

### 7. `--segment` — one sentence, fast

```bash
python3 tools/mcp.py --segment --text "ယဲ့နင်က မူလက ဒီလိုပါပဲ။ ..."
```

Shows `က` carrying `w, cn, n` inside `ယဲ့နင်က` — a genuine subject marker —
and `မူလ` cut into `မူ` + `လ`, which is an artefact, not a word. That
contrast is the lesson: **a `w` tag is evidence, not a verdict.**

### 8. `tag-both.mjs` — after every edit round

```bash
node --import ./scraper/wasm/box/runtime-guard.mjs \
     mt/quality/tag-both.mjs SRC WORK OUT.json
```

| | units | tag occurrences | unknown | ambiguous |
|---|---|---|---|---|
| ch194 | 100 | 3,125 | 190 | 1,409 |
| ch195 | 96 | 2,571 | 214 | 1,188 |

`pos_tree_roots` 1,907 · `rejected_dictionary_entries` 0 ·
`original_master_unchanged` **True** every run · `master_sha256`
`9eb066ca…` unchanged. Both views come back at once, which is why this tool
and not the engine one: a bad cluster shows up as an orphan mark in the word
view and a stray piece in the unit view.

### 9. `register.py` — the register audit

```bash
python3 mt/quality/register.py mt/quality/baseline/ch0194.my.txt \
        mt/quality/baseline/ch0195.my.txt --work /tmp/reg --summary --mismatches
```

| | blocks | LSE / LSN | particles | match | no row | candidates |
|---|---|---|---|---|---|---|
| ch194 | 156 | 83 / 73 | 471 | 138 | 286 | **40** |
| ch195 | 159 | 138 / 21 | 374 | 191 | 162 | **19** |

`token_stream_aligned` True both (3,323 and 2,763 tokens). ch194 candidates:
`က` 16, `မှာ` 10, `မှ` 7, `ပြီ` 4, `တိုင်း` 1, `ဖို့` 1, `ဖြင့်` 1. Each
prints line, context, candidate roles and the `resolution.single` options for
that block's register.

---

## What to fix in the tools

The gaps, with the evidence. None of these stopped the work; all of them cost
time or nearly misled me.

**1. `not in resolution.single` means two different things.** ch194 had 286
such occurrences and ch195 162 — but 232 and 104 of them are markers that are
already the *spoken target* of another row. `ကို`, `တယ်`, `နဲ့` and `ရဲ့` all
appear as targets and none is a key, correctly: they are where a mapping
ends. Genuinely unrowed is much smaller — **54 occurrences in ch194, 58 in
ch195**, across these distinct markers:

`ကြောင့် စေ ဆီ ထက် ထိ ထဲ ထဲက ထံ ပါစေ ပါရစေ မည် မယ် လိမ့် လို သနည်း အကြား အတွင်း အပေါ် အား အားဖြင့်`

A `neutral` flag, or identity rows for the targets, would make the count mean
what it looks like it means.

**2. `raw_pos` has no character offsets.** It is one line per *output unit*
— ch194 has 365 source lines and 100 units — so a line number there cannot
place a token. The first version of `register.py` trusted those numbers and
collapsed 156 blocks into 10.

**3. Combining-mark order differs from a typed file.** U+103A and U+1037 come
out in the opposite adjacent order at **174 positions** in ch194, with
identical length and content — 174 false differences for anything comparing
against a hand-written file.

**4. A read-only audit writes files.** `mt/names.py --check` creates
`content/mtranslate/agent-drafts.sqlite3`, so checking names dirties
`git status`.

**5. The name tools do not take the inputs the task has.** `check_names` has
no `--chapter`; `lookup_name` cannot be queried in the project's source
language.

**6. No tool takes a corpus-wide question.** The most valuable measurement in
the project — `ကျွန်ုပ်` = 0 over 195 chapters, 309 unquoted `ငါ`-leading
lines — was inline shell. `profile.py` is chapter-scoped and cannot read an
arbitrary file, so it cannot profile an agent draft either.

**7. Split artefacts receive particle tags.** `က` inside `ကမ္ဘာ` / `တကယ့်`,
`တိုင်း` inside `နေရာတိုင်း`, `မူလ` → `မူ` + `လ`. Sixteen of ch194's forty
candidates were that first case.

**8. Nothing classifies a block's register.** The tagger tags tokens; it does
not say whether the sentence is narration, quoted speech or unquoted
monologue — which is the whole basis of the LSE/LSN decision. Hence
`register.py`. Quote state must be cumulative across the document, not
toggled per paragraph.

**9. In-body duplication is unreported.** `audit_source.py` handles marker
lines and chapter numbers parsed more than once, but nothing flags 32
paragraphs repeated inside a single chapter.

**10. `review_lookup` cannot reach these chapters** — *"chapter 194 is
outside the indexed arcs"*.

---

## Reproducing it

```bash
# 1. tag a copy — never the original, and nothing writes into Engine/
cp mt/quality/baseline/ch0194.my.txt /tmp/src194.txt
node --import ./scraper/wasm/box/runtime-guard.mjs \
     mt/quality/tag-both.mjs /tmp/src194.txt /tmp/work194 /tmp/out194.json

# 2. register audit: candidates + context + candidate roles
python3 mt/quality/register.py mt/quality/baseline/ch0194.my.txt \
        --work /tmp/reg194 --mismatches

# 3. marker tally
python3 mt/quality/register.py mt/quality/baseline/ch0194.my.txt \
        --work /tmp/reg194b --summary

# 4. full report as JSON
python3 mt/quality/register.py mt/quality/baseline/ch0194.my.txt \
        mt/quality/baseline/ch0195.my.txt --work /tmp/regboth \
        --json /tmp/register-report.json
```

`mt/quality/register.py` reads `master.json` read-only and writes only inside
`--work` and `--json`.