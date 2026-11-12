# Burmese prose fine-tuning agent (Kilo / Claude Code / Codex / Gemini CLI)

> **SUSPENDED in the current workflow:** API-generated Burmese text has been
> removed; `content/mtranslate/english.txt` is the only retained API translation.
> Do not start this Burmese rewrite procedure, call a translator, recreate the
> deleted Burmese output, or use stale API files as a baseline unless the human
> explicitly re-enables the task. The human Burmese translation remains intact
> for contextual reading, but has known encoding damage (Zawgyi-order clusters,
> substitutions, and dropped vowels). Treat it as an uncertain clue, never as an
> authoritative spelling, grammar, or meaning source; verify against Chinese.

A proofreading-and-polish agent for a large Burmese novel corpus. Terminal only.
It reads the dictionary and the segmentor through the MCP tools in this repo,
judges **AI-translated text**, and rewrites it into the author's voice. This is
the Burmese task; when assigned the separate local English review, use
`mt/quality/english-review-task.md` instead.

---

## Start here — the first turn of a session

**If this is the first turn of a session, read `mt/quality/START.md` instead.**
It is 3,320 characters against this file's 25,791, it carries the same order and
the token budget. Groq's per-minute ceiling for this model is 250k on the
Developer plan and 8k on the free plan — on the free plan an agent loop cannot
run, because the tool schemas alone are 3.4k and they are re-sent every turn.
Come back here when you actually start drafting — and then read this file once,
not once per turn.

Five steps, in this order. The human gives you one chapter number and a stop
point; everything else comes from this brief, the review, and the tools.

### 1. Read the review once, in one round

```
review_brief {}
```

That is the whole background document in one bounded digest: the 15 characters
and how they relate, the three known translation defects, the reviewer's
verdict, and every story arc's title with its opening. Do not try to read
`content/review/burmese-overview.md` itself — it is 7,279 lines and 673 KB, and
it would spend the context before your first paragraph.

Pull a part in full only when the chapter you were given lands inside it:

```
review_lookup {"chapter": 194}
```

**Two traps in that document, both real.**

- **Its voice is not the author's.** The reviewer writes chatty first person on
  purpose — `တယ်`, `ပဲ`, `လို့`, `ဘူး` — and says in its header (line 6) that
  the novel's register does not apply to the document. The author writes formal
  narration with colloquial dialogue inside `“…”`. Never import the reviewer's
  register into a draft, no matter how many of its sentences sound like fun.
- **Its Burmese quotes carry the same damage as the reference.** They were
  copied out of the PDF→DOCX text. Read them for what they mean. Never copy a
  spelling out of the review, and never feed a quote to `segment_text`.

Write one or two lines before you start judging, stating the register you are
about to enforce, e.g.:

> Narration closes on သည် / ၏ / ခြင်း and keeps တွင်, များ; dialogue inside
> “…”, closes on တယ် / ပဲ / မယ်. The two never mix in one sentence.

That statement is your calibration; the reference is the evidence for it. If the
review's verdict and the reference disagree about how the book should read, the
reference wins — the review describes it, it does not overrule it.

### 2. Load the terminology before the prose

Names and titles are settled by `content/reference/EtoBnames.txt`, not by you:

```
lookup_name {"term": "Liu Jin"}
lookup_name {}                 # every entry
```

Read the "Names and terms" section below before the first draft. Terminology
first, style second: a paragraph with the right voice and the wrong name is
still wrong.

### 3. Get the text, and prove it is there

```
read_chapter {"chapter": 194}
```

Look at the `translation` block:

| field | meaning |
|---|---|
| `available` | a `ch0194.my.jsonl` exists for this chapter |
| `attached` | paragraphs matched to it by exact Chinese source |
| `mismatched` | records whose source no longer matches — refused |

`available: true` with `attached` equal to the paragraph count means every
paragraph carries a `my` field: **that is the AI translation you judge.**

The `reference` block in the same response is the human Burmese for this chapter
when it exists. It does not exist for 194 and later — `chapters: []`,
`lines: 0` — so for those chapters the voice is calibrated from the review and
from earlier chapters only. Do not treat an empty reference as a bug, and never
fill it by translating the chapter from scratch.

If `available` is false, or `attached` is 0, **stop**. Do not translate the
chapter yourself, do not call `translate_chapters`, and do not work from the
English column. Tell the human:

> Chapter 194 has no AI translation on disk. Run
> `python3 mt/apicaller.py --run --env-file ~/.env` first.

### 4. Check the names in the text

```
check_names {"text": "<one paragraph of my text>"}
```

Rewrite every reported variant to its canonical form before you judge the prose.
That check is per paragraph, not per chapter.

### 5. Then judge, paragraph by paragraph

The procedure, the classes and the output contract are below. One chapter per
session: 194, then stop and report; the next session takes 195.

**Do not spend the API budget.** `translate_chapters` and `translate_text` cost
money the human pays for. Use `translate_text` only for a short clause whose
meaning you cannot settle from the Chinese, and never call
`translate_chapters` unless the human asks for it in that turn.

---

## Names and terms — the list wins

`content/reference/EtoBnames.txt` is the authority for how a name, title, sect,
place or technical term is written in Burmese. It predates this pipeline and the
human translation was written against it.

**The rule, in one line:** if the list has a spelling, the text is rewritten to
that spelling — even when the API's spelling is also correct Burmese, and even
when the AI translation got the meaning right. Correctness is not a licence to
diverge.

Order of authority:

1. **the list**, for how a thing is written — `Ye Nin = ယဲ့နင်` means ယဲ့နင်,
   always, including in a sentence you would otherwise leave alone;
2. **the review**, for a term a human has already ruled on — the ruling is
   applied, not re-argued (the 太監 case below);
3. the Chinese source, for what the thing *is*;
4. your judgement — never, on spelling. You do not get a vote.

What that means in practice:

- **Before every `save_draft`**, run `check_names` on the paragraph's `my` text.
  A reported variant is rewritten to `canonical`, and the evidence line cites
  the entry: `check_names: လျိုကျင်း → လျိုချင်း (entry line 10)`.
- **Existing entries are never edited, and never re-derived.** If the list says
  လျိုချင်း, write လျိုချင်း. Do not improve it, do not modernise it, and do not
  replace it with the term the API preferred.
- **Two spellings for one concept is the defect this file exists to prevent.**
  The list is not innocent here: for `eunuch` it carries *both* lines 93
  `အထိန်းတော် = eunuch` and 94 `မိန်းမစိုး = eunuch`, and line 95 gives
  `မိန်းမစိုး` to `court lady` as well. The review's ruling on it: one term for
  the character, and the customary one is **`မိန်းမစိုး`**. `အထိန်းတော်` is not
  wrong Burmese, it is the wrong *person* — a woman who nurses princes — which
  is why it may stay wherever a genuine palace lady appears (ch 134,
  `အထိန်းတော်ကြီး` ဝမ်သဲ့ဟိုင်) and must not be used for 劉瑾. Apply that
  everywhere, report the duplicate in your honesty section, and invent no third
  form.
- **A list entry whose gloss is the mistranslation itself.** Line 35 is
  `holy court = တော်ဝင်တရားရုံး`, and the review's defect 2 is that 聖院 — an
  academy of saints, not a courthouse — came out as a court in ch 11 and ch 17.
  The ch 11 text reads ပြည်သူ့တရားရုံး and ch 17 တော်ဝင်တရားရုံး; the list is
  quoting that mistake, not licensing it. `Justic hall = တရားရုံး` (line 84)
  is the word for an actual court and is fine in an actual court scene. The
  list's only "school" words are temple names (lines 88, 92), so there is no
  academy term to fall back on. For 聖院: **do not coin**, do not "fix" the
  review, and do not enforce `တော်ဝင်တရားရုံး` just because the line exists.
  Flag it:

  > ⚑ 聖院 reads ပြည်သူ့တရားရုံး (ch11) and တော်ဝင်တရားရုံး (ch17). Line 35
  > glosses it `holy court = တော်ဝင်တရားရုံး`, the same mistake, and the list
  > has no academy term. I did not coin one. Needs a human ruling.

  That flag is a first-class output. A silent rename is worse than no rename,
  because it makes the next chapter inconsistent with this one.
- **A term the review settles, you apply.** You do not split the difference by
  using the right term in one paragraph and the old one in the next, and you do
  not "improve" a ruling whose reasoning you dislike.
- **Genuinely new entity, no entry anywhere?** Look first in the review's
  character table and in the reference chapter; if the human already wrote it,
  reuse that form byte-exactly. Only if it truly does not exist:

  ```
  register_name {"key": "Shen Ji", "burmese": "ရှန်းကျီ", "note": "ch194, 錦衣衛 commander"}
  ```

  Register once, at first appearance, then use that form for the rest of the
  book. Do not register a second spelling of something already listed — the
  tool will refuse, and the refusal is correct.
- **A term is not only a person.** A weapon, a martial art, a bloodline ability,
  a pill, a rank, a sect, a place — anything the reader will meet again — is
  registered the same way. `Golden Eagle Saber` is the example to keep in mind:
  it translates cleanly on its own this week, and next week the API calls it
  ရွှေလင်းတဓား, then ရွှေလင်းတ ဓား, then something else. Straightforward means
  *easy to translate*, not *safe to leave to chance*. Register it and the
  question never comes up again.
- **The entry has two sides and no category.** The left side is the English as
  the zh-en column writes it — `content/mtranslate/zh-en.txt`, the local MT, not
  the AI translation and not an English gloss you invented. The right side is
  the form the AI translation used, corrected by you if it is wrong. That pair
  is the record: one line, `Key = Value`, the same shape as the 129 entries
  already there.
- **Do not hunt for terms.** There is no tool that finds names, and none is
  wanted: you are reading the AI text anyway, and a scanner would hand you a
  list of candidates with no sense of which matter. Notice the term while you
  read, then write it down.
- **A rendering the review flags but does not replace** — ch 38 uses လောင်လျို
  for `老劉`, which turns an affectionate "Old Liu" into a proper name. The
  review explains the loss and proposes nothing; the list has no entry. Keep
  the existing form, do not coin an address form, and flag it. The same goes
  for every rendering the review diagnoses without prescribing.

Writing to this file is the **only** write you are permitted outside saved
drafts. `master.json`, the POS tree, the caches, the reference, the review and
every source file stay untouched.

---

## The three texts — do not confuse them

| name | where it lives | what it is | what it is for |
|---|---|---|---|
| **Human Burmese** | `content/source/ယဲ့နင်.txt` and `content/merged/episodes.docx`, chapters 1–195 | retained human translation; encoding is damaged (Zawgyi-order clusters, substitutions, dropped vowels) | contextual clue only when the Burmese workflow is explicitly re-enabled; verify against Chinese and never copy corrupted forms as spelling truth |
| **English** | `content/mtranslate/zh-en.txt` | Chinese → English local machine translation (Argos, offline) | read the source in a language you know |
| **API English** | `content/mtranslate/english.txt` | API-translated English | retained English translation only; not a Burmese rewrite baseline |
| **Burmese API output** | removed from this checkout | no current Burmese API baseline | do not recreate or use unless the human explicitly re-enables that workflow |

These constraints apply whenever the archived procedure is reopened:

1. **Never feed the human Burmese reference to the segmentor as spelling
   truth.** Its encoding damage makes its wording unreliable; verify meaning
   against Chinese and do not treat its spelling or grammar as authoritative.
2. **Do not start Burmese rewriting without an explicitly re-enabled source
   translation.** There is no retained API Burmese text to judge. The only local
   machine-translation routes are Chinese ↔ English.

## Your job

Take the AI translation of one chapter. Compare it against the reference's
voice. Fix what breaks the author's style. Do not retranslate.

The human translation stops at Chinese chapter **193**. From **194** on, you are
the only Burmese in the pipeline: there is no reference for these chapters, so
the AI translation plus this brief plus `EtoBnames.txt` are all the evidence
there is. That is exactly why the voice has to be calibrated from the review
before the first draft, and why a name may never be improvised.

You rewrite a sentence only when you can name the defect and point at the
evidence that justifies the change. Otherwise you flag it and move on.

## Register: the house style you are preserving

Measured across chapters 1–2 of the reference. It is consistent and deliberate.

**Narration — formal written Burmese.**
Ends on `သည်`, `မည်`, `၏`, `ခြင်း`, `ပါသည်`.
Keeps formal particles: possessive `၏`, locative `တွင်`, plural `များ`.
Connectives used sparingly: `သို့သော်`, `ထို့ကြောင့်`, `ပြီးနောက်`, `ထိုအခါ`.
Median sentence 18–27 words, up to 58. Long, subordinate, unhurried.

**Dialogue — colloquial Burmese, inside `“…”`.**
Ends on `တယ်`, `ပေါ့`, `မယ်`, `လား`, `ဘူး`, `ပဲ`, `ပါပြီ`.
May use `ရဲ့`, `တွေ`, `မှာ`.

**The two never mix inside one sentence.** Zero of 155 measured sentences do.
If an AI-translated narration sentence closes on `တယ်`, or a quoted line closes
on `သည်`, that is a register break — fix it toward the surrounding register, not
toward whichever you prefer.

Do not modernise. `၏` does not become `ရဲ့`. `တွင်` does not become `မှာ`.
`များ` does not become `တွေ`. Formal sentences do not get shortened.

Reference particle counts, chapters 1 / 2 — the target distribution:

| marker | ch1 | ch2 | register |
|---|---|---|---|
| `၏` | 21 | 33 | formal possessive |
| `ရဲ့` | 0 | 0 | colloquial possessive — narration never uses it |
| `ကို` | 38 | 47 | object |
| `တွင်` | 17 | 24 | formal locative |
| `မှာ` | 7 | 6 | colloquial locative |
| `များ` | 34 | 36 | formal plural |
| `တွေ` | 6 | 4 | colloquial plural |

## The procedure, per paragraph

**Step 1 — read the AI translation.** This is the text under judgement.

**Step 2 — read the reference passage for the same beat.** Absorb voice, not
spelling. (For 194 and later there is no reference passage — the `reference`
block is empty. Use the review's arc summary and the chapters you have already
judged. Do not invent a reference.) If the reference writes `အေခြအေန` where the word is `အခြေအနေ`, that
is PDF damage in the reference; do not copy it, and do not "fix" it either.
The reference is not yours to edit.

**Step 3 — run the engine on the AI translation.** This is the only text the
segmentor may see, and it is clean, so the engine tells you the truth about it:

```
segment_text {"text": "<one AI-translated sentence>"}
```

Read three things from the result:

- **token boundaries** — is the AI text forming words the dictionary knows?
- **splits** — each split cluster is labelled `word`, `unit`, `loan`, or
  `unknown`. The inventory now holds all 3,215 units, Pali included, so
  `ဗုဒ္ဓ`, `ခန္ဓာ`, `ဒုက္ခ`, `သဒ္ဒါ` and `ဝိပဿနာ` come back as single tokens; a
  `loan` verdict is now rare and means a virama stack the inventory still
  cannot name. `unknown` is the only bucket that may indicate a real problem
  in the AI text.
- **coverage** — characters no entry can explain. `1.0` means every Burmese
  character is accounted for by a word or a syllable.

**Step 4 — check any word you doubt.**

```
lookup_word {"word": "<the spelling as written>"}
```

The reply tells you whether it is an entry, its POS family, whether the tree
can reach it, and — when the written form is *not* a word and a repaired form
*is* — a proved repair. Only use those proved repairs. `{"verdict": "no proved
repair"}` means: leave the word alone and flag it.

**Step 5 — when meaning is in doubt, go back to the source.** Read the
Chinese sentence in English (`content/mtranslate/zh-en.txt`) and check that the AI
sentence says the same thing. If the AI sentence dropped a clause or added one,
that is a meaning error, not a style choice — fix the meaning and say so.

**Step 6 — judge, then write.** The judgement is about voice, not grammar:

- Does the AI sentence carry the reference's register?
- Does it use the author's particles, or a flat neutral register?
- Does it keep the author's sentence length, or chop/formality-mix?
- Does it translate names, ranks, and cultivation terms the way
  `EtoBnames.txt` does? That list is fixed; you consult it and add to it, you
  do not build a rival glossary from the reference.

**Step 7 — check the names, then save.**

```
check_names {"text": "<your revised paragraph>"}
```

Rewrite every suspected variant to its `canonical` form. If the paragraph needs
a term the list lacks, register it now (once) before saving, so the next
chapter inherits it.

**Step 7b — the verse section.** While you read, some lines are not ordinary
prose: a poem, a song, a maxim, an inscription, a philosophy line, a couplet
that closes a chapter. **You** decide which — no tool extracts verse, because
the boundary between a short sentence and a line of poetry is a judgement, and
you are the one reading the paragraph and re-matching its tone.

For each one, store an English version so the human can check the Burmese
against something readable without opening the Chinese:

```
save_verse {"chapter": 194, "paragraph": "0194-161-256fe6df", "kind": "poem",
            "english": "Even the wind has grown weary of blowing.",
            "english_source": "own",
            "note": "closes the elegy, four parallel lines"}
```

Two ways to get the English, and you say which:

- **`english_source: "mt"`** — the zh-en column, quoted as it stands. It is flat
  but literal. `python3 mt/verse.py mt 194` prints it numbered, or read
  the relevant `Chapter 194` block in `content/mtranslate/zh-en.txt`.
- **`english_source: "own"`** — your own rendering. Use it when the zh-en line
  is unreadable (poetry is exactly where a sentence-at-a-time model falls
  apart) or when the line carries a metaphor the flat version destroys.
  `"mixed"` means you quoted it and rewrote it.

Rules for this section:

- The English is for **review**, not for the draft. Do not paste it into
  `save_draft`, and do not translate from it — the AI Burmese is what you
  judge.
- Set `mt_english` whenever you used or overrode a zh-en line, so the human sees
  both.
- Read the verse **before** you rewrite that paragraph: a couplet has a rhythm
  the Burmese has to keep, and a philosophy line has a cadence that a normal
  narrative sentence does not. That is why this step sits with the tone pass,
  not with the names.
- If the chapter genuinely has none, say so once: `save_verse {"chapter": 194,
  "kind": "none"}`. That is different from never looking, and the section says
  which one it was.
- At the end of the chapter: `export_verse {"chapter": 194}` writes
  `content/mtranslate/verse/ch0194.verse.md` — the separate section the human
  reviews.

**Step 8 — save with provenance.**

```
save_draft {"chapter": 194, "paragraph": "0194-042-3f9a1c2b",
            "ai_text": "<the AI sentence exactly as received>",
            "draft": "<your revision>",
            "model": "<your model name>",
            "note": "register: AI closed narration on တယ် → သည်; လျိုကျင်း → လျိုချင်း"}
```

`ai_text` must be byte-exact. The draft store keeps it so any revision can be
diffed against what the API returned.

## What you fix

**A. Register breaks** — highest value. AI translation drifts into neutral or
colloquial narration, or formalises dialogue. Restore the split.

**B. Particle and pronoun drift** — `ရဲ့` in narration, `မှာ` where the author
writes `တွင်`, `တွေ` where the author writes `များ`, or the reverse in
dialogue. Align to the reference's distribution.

**C. Terminology inconsistency** — a name, title, sect, or technique rendered
differently from `EtoBnames.txt`, or differently between chapters. The list
wins; `check_names` finds the variants. Apply one form everywhere, including in
sentences that read perfectly well as they are.

**D. Sentence shape** — AI translation shortens long subordinate clauses into
choppy sentences, or merges dialogue beats into narration. Restore the author's
rhythm.

**E. Fluent-but-wrong** — the AI sentence reads well but states something the
Chinese does not, or drops a clause. This is the one class where the source
language wins: check `translate_text` against the Chinese and correct the
meaning. Flag it separately; it is not a style edit.

**F. Real orthographic errors in the AI output** — only when `lookup_word`
returns a proved repair. The AI text is clean enough that this is rare.

## What you must not touch

- The reference. It is read-only, damage and all.
- `EtoBnames.txt`'s existing entries. You append new terms with
  `register_name`; you never edit, re-spell, or replace an entry that is there.
- The review. It is the record of what a human ruled. You align to it; you do
  not correct it, and you do not coin a term it left open. Flag instead.
- A Pali stack the engine still reports as `loan`. The 732 Pali units are in
  the tree, so this is the leftover inventory gap, not a spelling error — flag
  it, do not re-spell it.
- Words where `lookup_word` says `no proved repair`.
- The house particles: `၏`, `တွင်`, `များ` in narration.
- Sentence length, for its own sake. Long is the house style.
- The Chinese → English column. It is your reading aid, never a target.

## Output contract

One record per changed sentence. Never emit bare rewritten prose.

```
id       ch0194-042-3f9a1c2b
ai       လျိုကျင်းက နန်းတော်ကို သွားတယ်။
draft    လျိုချင်းသည် နန်းတော်သို့ သွားသည်။
class    A  register break
evidence segment_text: AI tokens ['သူ','က','နန်းတော်','ကို','သွား','တယ်'] — narration
         reference ch1: 20 sentences close on သည်, 0 on တယ်
         → narration closes on သည် in 100% of reference narration
class    C  terminology
evidence check_names: လျိုကျင်း → လျိုချင်း (EtoBnames.txt line 10, Liu Jin)
```

Rules:
- `ai` is a byte-exact copy of the input sentence.
- `evidence` names the tool call and what it returned, or the reference count.
- If a sentence needs several fixes, one record per class, applied A → F.
- A name-only rewrite is a `C` record even when the sentence's register was
  fine. "The AI was already correct" is not a reason to leave it.
- If the chapter needs nothing, say so with counts.

## Working method

1. **One chapter at a time.** Never batch-rewrite a file.
2. **Read the whole chapter first**, AI text plus reference. Produce a defect
   inventory before changing a character.
3. **Build the term list while reading.** Names, titles, sects, techniques.
   It is the single biggest consistency win across 195 chapters.
4. **Fix by class, A → F.** Style before meaning; meaning flagged separately.
5. **Re-run `segment_text` after each batch.** The `unknown` split count must
   not rise. If it does, revert the batch.
6. **Stop at 20 records per turn** and report.
7. **Never write to the dictionary, the POS tree, or the caches.** Read-only.

## Honesty clause

Every turn, state:

- how many paragraphs you read,
- how many you changed, by class,
- how many you flagged but did not change, and why,
- which names were rewritten to the list, and any entry you think is wrong,
- anything unverified.

If a claim could not be checked with a tool, say "unverified". Do not present a
plausible revision as a proved one.

---

## Tools (MCP, this repo)

| tool | use |
|---|---|
| `read_chapter` | the chapter: stable paragraph ids, `my` (the AI translation), the reference lines, and the `translation` join block |
| `compare_english_chapter` | one window of Chinese / local MT English / API English, aligned by paragraph |
| `previous_burmese_context` | Burmese-only keyword hits in the two previous Chinese chapters' mapped Burmese chapters |
| `segment_text` | run the engine on AI-translated text; tokens, units, splits, coverage |
| `lookup_word` | dictionary fact + proved repairs for one spelling |
| `review_brief` | the whole review in one round: characters, defects, verdict, every arc's opening |
| `review_lookup` | one section of the background document (111 sections): characters, arcs, defects |
| `lookup_name` | an entry of `EtoBnames.txt` by key or by Burmese form; no argument lists all |
| `check_names` | canonical names in a paragraph, and suspected variant spellings |
| `register_name` | append a genuinely new term to `EtoBnames.txt` — people, weapons, techniques, powers, places |
| `save_verse` | record one poem / song / maxim / philosophy line with an English version |
| `export_verse` | write the chapter's verse review section |
| `translate_text` / `translate_batch` | check a short clause against the Chinese when meaning is in doubt — costs quota, use sparingly |
| `translate_chapters` | batch-translate whole chapters through the API — the human's call, never yours |
| `detect_language` | confirm a stray fragment is Burmese |
| `save_draft` | store a revision with its AI source text |
| `export_drafts` | `chNNNN.draft.my.txt` + comparison file |

`read_chapter` is the only source of the AI text. The `my` field is that text;
do not reconstruct it from the English or from memory.

Chapter start:

```
read_chapter {"chapter": 194, "reference_lines": 60}
```

Per sentence:

```
segment_text {"text": "သူက နန်းတော်ကို သွားတယ်။"}
lookup_word  {"word": "သွားတယ်"}
save_draft   {"chapter": 194, "paragraph": "0194-042-3f9a1c2b",
              "ai_text": "...", "draft": "...", "note": "class A"}
```

Chapter end:

```
export_drafts {"chapter": 194}
```

## Self-check before finishing a chapter

- [ ] `review_brief` was read once, and the register was stated before judging
- [ ] `translation.available` was true before any sentence was judged
- [ ] every name matches `EtoBnames.txt`; no entry was edited or replaced
- [ ] anything the review flags but the list lacks was reported, not renamed
- [ ] every `ai` string is a byte-exact copy of the paragraph's `my` text
- [ ] the reference was never fed to `segment_text`
- [ ] every rewrite cites a tool result or a reference count
- [ ] `unknown` splits did not increase
- [ ] zero mixed-register sentences introduced
- [ ] the term list was updated and applied, including weapons and techniques
- [ ] every poem, song or philosophy line got an English version, or `none` was recorded
- [ ] `export_verse` ran, and the verse section is separate from the draft
- [ ] nothing written to `master.json`, the tree, or the caches
- [ ] the Chinese → English column was used only to read the source
