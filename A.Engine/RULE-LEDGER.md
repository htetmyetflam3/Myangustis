# POS and grammar rule ledger

**Purpose:** a human-readable record of rules already active and rules proposed
for the POS/grammar stage. This is **not runtime configuration**: adding a
rule here does not change segmentation, POS tags, the master, or templates.
Rule IDs below are ledger identifiers, not established linguistic names.

## Source map and terminology

- **Main rule inventory:** [`mainrules.json`](architecture/myangustis_engine/knowledge/isTreasure/mainrules.json)
  mirrors the data in `main`'s `A.Engine/architecture/knowledge/isTreasure/mainrules.js`.
  **Current work starts at `wibat`**: `wibat.noun`, `wibat.verb`,
  and their `disambiguate` lists. The other grammar-book sections are
  references for later, not the starting point or executable rules.
- **Draft, not a completed classifier:** [`template-data.json`](architecture/myangustis_engine/knowledge/isTreasure/template-data.json)
  mirrors the snapshot of `main`'s `knowledge/isTreasure/template.js`. It has
  `SyllableSchema` (`posFamily`, `pos`, `unit`, `relation`, `role`),
  `LSE_Map`, `LSN_Map`, `particleToClass`, and sentence templates `msp-01`
  through `msp-07`. These are useful design material, not proof that a
  particular sentence can already be parsed or a grammatical item resolved.
- **Active POS stage:** [`bridge/Ginit.py`](architecture/myangustis_engine/bridge/Ginit.py)
  calls [`posoverride.py`](architecture/myangustis_engine/Lexical/abstract/posoverride.py).
  The latter is currently a pass-through. The active bridge applies the
  noun/verb rule below; it is not a grammar classifier yet.
- **Tagger inputs:** [`phonology.py`](architecture/myangustis_engine/MonoSyllabism/main/phoneme/phonology.py)
  emits `syllables`, `ids`, and candidate `rawPos`. Relevant current tags
  include `pn` (pronoun), `n` (noun), `p` (ပစ္စည်း) and `w` (ဝိဘတ်).
  A candidate list is not, by itself, a confirmed grammatical analysis.

### Keep the ambiguity dimensions separate

This is the owner's intended interpretation for future work:

1. A **`BOTH` node** represents overlap at the **family/type** level. Do not
   automatically interpret the word `BOTH` as the conclusion “this occurrence
   is both LSE and LSN,” or treat it as one resolved label.
2. An explicit **`disambiguate`** entry signals overlap between categories;
   resolve that distinction with the relevant LSE/LSN information, according
   to rules and evidence still to be specified. It is a queue for resolution,
   **not** a grammatical type to emit.
3. A **`BOTH` node not marked `disambiguate`** needs surrounding grammatical
   roles and sentence patterns to determine its family/type. Preserve the
   possibilities when that context cannot decide; do not select the first
   candidate just because it appears first in the data.
4. LSE/LSN evidence, category, family, type, and sentence role are separate
   observations. Keep provenance and unresolved alternatives; never encode a
   family/type decision solely by overwriting a style field.

**Important draft limitation:** the existing JS template's `_set` function
sets `ls: 'BOTH'` whenever a surface is encountered again, including when
building `LSE_Map` and `LSN_Map`, and retains the first category/family/type
(`ex.category || cat`, etc.). Consequently its generated `particleToClass`
can collapse multiple paths and lose information. That implementation is not
an accurate encoding of the owner's interpretation above; don't use it as a
single-answer authority. The meaning of LSE/LSN evidence and the exact way it
resolves category overlaps still need the owner's examples and decisions.

For example, `mainrules.json` places `၏` under `wibat.disambiguate` and
leaves `wibat.noun.ပိုင်ဆိုင်ခြင်းပြဝိဘတ်` empty; the draft LSE/LSN maps put
`၏` under that noun type and the draft `particleToClass` gives it a `BOTH`
label. Record these as **different source assertions**, not an automatic
resolution. Likewise `ကို` is listed under noun wibat as object marker and
under noun ပစ္စည်း as a gender-related item; retaining both paths matters.

## Naming your rules — independent of grammatical categories

Your override rules are your own operational rules, not names for the book's
wibat categories. A rule may recognise, refine, or connect **any** category;
the identifier must not imply that it belongs exclusively to a particular
wibat type. The chosen series is **MOR** — **M**yangustis **O**verride
**R**ule. The first rule is **`MOR-01`**.

The number identifies the rule, not the grammatical type, execution order,
final POS, sentence position, or priority. Those require separate fields if
needed. `MOR-01` names your rule; its output remains the existing grammatical
type **ပိုင်ဆိုင်ခြင်းပြဝိဘတ်**. Naming the rule does not implement it.

### The first rule and its book-reference context

```
My rule 01 (MOR-01):
    pronoun + bare ့  →  ပိုင်ဆိုင်ခြင်းပြဝိဘတ်

Context / expectation proposed by the owner:
    a possessive wibat expects a noun in the next cluster.
```

These are two different things: the first is **your override rule**; the
bracketed expectation is a grammatical relation to investigate in the book
reference. Do not silently turn the expectation into a mandatory condition for
firing the override, or assume “next cluster” equals the next raw POS token.
How clusters are delimited and how the expectation behaves across modifiers,
omission, and ambiguity remain to be designed.

**Closest identified JSON reference:** `simple_sentence_patterns[12]`, ID
`SP_13`, reference `§63(ဍ)`, has pattern `SUBJ + POSSESSION +
SUBJ_COMPLEMENT + VERB` and the example `ဤစာအုပ်သည် မောင်ဘ၏ စာအုပ် ဖြစ်သည်။`
Here `မောင်ဘ၏` is followed by `စာအုပ်` in the example. This supports looking
at a possessor/possessed-noun relationship, but it is a **whole-sentence
example**, not a named general rule saying every possessive wibat must be
immediately followed by a noun or a direct statement of the bare-`့` rule.

Another relevant example is `word_order_constraints`, `WOC_09`, §208(ခ)(၃):
`မသန်မစွမ်းသူများ၏ ငါးကြိမ်မြောက် အားကစားပြိုင်ပွဲကို ...`. It places an
ordinal modifier between the possessive phrase and the head noun. This is
why a future “next cluster expects a noun” relation should be designed at the
**cluster/head** level, not reduced to “the next token must have `n`”.
`WOC_09` itself concerns ordinal modifier placement; it is not a dedicated
possessive-wibat rule. Neither JSON entry proves the complete bracketed rule.

### Starting inventory: `wibat`

The `wibat` section is the working inventory; the rest of the grammar-book
JSON is reference/context, not a ready-made classifier. Its `noun` family
contains nodes for subject, object, source, direction, endpoint, instrument,
cause, recipient, place, time, **ပိုင်ဆိုင်ခြင်းပြဝိဘတ်**, conformity,
comitative, separation, purpose, and spatial/temporal continuation. The
`verb` family has present/past/future and directive/coordination/wish/order
nodes. Preserve the Burmese source node names: those English summaries are
navigation aids, not replacement definitions.

In `mainrules.wibat.noun`, the possessive node is **empty**;
`wibat.disambiguate` lists `သည်` and `၏`. In the separate draft template,
`LSE_Map`/`LSN_Map` list `၏` under the possessive noun node. These are
source assertions to keep distinct, not permission to collapse ambiguity or
invent a new spelling entry. Your pronoun + bare-mark rule is **additional to
that inventory**; it is not a new name for the book's wibat type.

## Existing runtime rules and stage behavior

| ID | Status | Condition | Current result | Source |
|---|---|---|---|---|
| `EXISTING-POS-001` | Active | A token has **exactly** two `rawPos` candidates, `n` and `v`, in either order. | Bridge replaces `rawPos` with `['rbvn']` and sets `finalPos` to `rbvn`. `isAmbiguous` reflects the original candidate count. A list containing `n`, `v`, and another tag is not collapsed. | `bridge/Ginit.py` (mirrors active `main` JS `bridge/Ginit.js`) |
| `EXISTING-POS-002` | Active behavior | Any other token at the current POS override stage. | Candidates pass through, `finalPos` is the first candidate (or `None` for an empty list), and `matches` is empty. This is a placeholder, **not** evidence that ambiguity has been resolved. | `Lexical/abstract/posoverride.py` |

The tagger has additional standalone-token and number/punctuation handling in
`phonology.py`; those are tagger behavior, not rules implemented by this POS
ledger. Main's separate experimental `Lexical_No_inspect/abstract/kernel.js`
contains classifier/resolver scaffolding, but it is not the active Python
pipeline and is not evidence that contextual grammar rules are running.

## Proposed rules

### `MOR-01` — owner’s pronoun + bare dot rule

**Status:** owner-defined rule, **not implemented**. The output is the existing
**ပိုင်ဆိုင်ခြင်းပြဝိဘတ်** type.

**Owner's rule:** `pronoun + bare dot below = ပိုင်ဆိုင်ခြင်းပြဝိဘတ်`.

**Owner-defined scope:** `pronoun + bare ့ (U+1037) →` the possessive wibat
type. The result for a confirmed match is **ပိုင်ဆိုင်ခြင်းပြဝိဘတ်**, not
just a generic candidate. The mark may be an orthographic mark on the final
syllable rather than an independently written grammatical item; this does not change
the owner’s rule. Non-bare attached forms are outside this specific rule.

**Proposed evidence/guardrails before implementation:**

1. Establish the **whole pronoun span**, including multi-syllable pronouns,
   from evidence stronger than one token merely containing `pn` as one of
   several candidates. If the pronoun identity is unresolved, keep the rule
   pending rather than treating the candidate as confirmed.
2. The rule specifies a **bare U+1037 token** after a pronoun. The tagger
   omits whitespace tokens and the formatted API does not supply original
   character positions, so adjacency in a list of POS tokens does not prove
   source attachment. Preserve source spans or other boundary evidence if
   the intended meaning of “+” requires attachment; do not invent a new
   source-boundary condition without agreeing on it.
3. Determine whether the mark is a valid part of the pronoun's spelling,
   a separately meaningful possessive marker in the owner's analysis, or a
   segmentation/normalization artifact. Never relabel all residual marks as
   grammar merely because they are bare in engine output.
4. Suggested annotation, **not an established output contract**: identify the
   pronoun span and the attached mark, record category `wibat` and
   type `ပိုင်ဆိုင်ခြင်းပြဝိဘတ်`, and retain input POS candidates and source
   evidence. Decide later whether the annotation belongs on the mark, on the
   pronoun, on their relation, or on more than one of these. Avoid duplicating
   or deleting text and avoid inventing an independent word ID for a combining
   mark without an agreed representation.
5. If style/category, family/type, pronoun identity, or source attachment is
   unresolved, retain the evidence until the rule’s stated condition is
   established; do not change the rule’s result for a confirmed match. Sentence/phrase role and the owner's LSE/LSN distinctions may be
   needed, but their exact precedence is not established here.

**Observed current end-to-end behavior (not expected final answers):**

| Input | Current syllable view | Current POS view | Implication |
|---|---|---|---|
| `ကျွန်တော့်စာ။` | `ကျွန် · တော် · ့ · စာ · ။` | `ကျွန်{n,p} · တော်{n,p,pn} · ့{F} · စာ{n,p} · ။<eos>` | The mark is bare, but `တော်` has multiple candidates and the whole pronoun span is not resolved. A simple “previous token has pn” test would overclaim. |
| `သူ့စာ။` | `သူ့ · စာ · ။` | `သူ့{?} · စာ{n,p} · ။<eos>` | The mark is already part of a syllable, so a rule for **bare** `့` alone would not fire. It is outside the stated bare-mark rule. |
| `စာ့အုပ်။` | `စာ · ့ · အုပ် · ။` | `စာ{n,p} · ့{F} · အုပ်{n,p} · ။<eos>` | A bare dot following a non-pronoun/uncertain token must not automatically trigger this pronoun rule. This is an input stress case, not a claim of correct spelling. |

`·` in the table is just a visual separator, not text to insert. Displayed
U+1037 can render as `◌့` in isolation; the dotted circle is not part of the
mark. `F` is the current tagger's fallback label for these marks, not the
proposed wibat type.

**Acceptance cases to decide with the owner before implementation:**

- Attached dot after a confirmed pronoun: expected possessive annotation,
  retaining the pronoun and source text.
- Bare dot after an unconfirmed/ambiguous pronoun candidate: unresolved until
  enough context establishes the pronoun; no forced POS/type.
- Dot after a non-pronoun: do not trigger. Source whitespace/punctuation
  boundaries need preserved positions and an agreed interpretation of “+”.
- Dot already inside a syllable, as in `သူ့`: outside this rule’s stated
  bare-mark scope; do not silently expand it.
- Canonically equivalent `asat + dot` / `dot + asat` source order: identify
  the same attachment without losing the original spelling or conflating
  normalization artifacts with linguistic rules.
- A pronoun + bare mark without a following possessed noun still matches the
  owner’s stated rule. Identifying a separate possessed target, if needed, is
  a later relation-resolution task, not a condition for this marker rule.
- Interactions with LSE/LSN, family/type overlaps, other `disambiguate`
  entries, and conflicts between later rules: retain all evidence until
  priorities and tie-breaking are specified.

## Open decisions / backlog

- Design how to identify a pronoun, including a multi-syllable form, in the
  current token stream. Do not add a following-noun requirement to the rule.
- Define how the pronoun/mark relation is represented and where its wibat type
  belongs in the future output; the current schema has no agreed mark-level
  provenance/offset contract.
- Define “next cluster” and the noun-head expectation separately from rule
  matching; check the original book for a more direct reference.
- Provide worked examples for how LSE/LSN resolves a `disambiguate` overlap,
  and how sentence-role evidence resolves a `BOTH` family/type overlap.
- Replace lossy `particleToClass` flattening only after agreeing on a
  multi-candidate, provenance-preserving model; don't change runtime maps as
  part of this ledger.

## Dictionary repair note: `သိမ်း`

- **Reported by owner:** `သိမ်း` is wrongly categorized as a noun in the
  dictionary and needs repair; it is a verb in `အိပ်ရာ သိမ်း။` (book example
  `MSP_03`).
- **Observed before repair:** the POS view for `အိပ်ရာ သိမ်း။` returned
  `အိပ်ရာ{n} သိမ်း{n} ။<eos>`, so no verb candidate is available for the
  template parser in this example.
- **Status:** repaired at the owner’s request: moved the exact entry from
  `dictionary.NOUN` to `dictionary.VERB` in the encrypted runtime master and
  rebuilt the trees. The POS view now returns `အိပ်ရာ{n} သိမ်း{v} ။<eos>`.
  The source `secret/master.json` was corrected too; the two master datasets
  match again. This is not a change to the template parser.

## ဦး + `{?}` before a noun wibat — idea for later

**Status:** recorded for future investigation, not implemented and not
currently a POS-override rule. The owner originally associated `{?}` with
wrong spelling, then clarified that dictionary-missing names can also produce
`{?}`. The tag alone proves neither a typo nor a name and must not be
automatically changed into a noun.

The original idea was `ဦး + consecutive {?} + noun marker` → treat `ဦး` and
the intervening sequence as a noun. **Noun marker means any နာမ်ဝိဘတ်**,
not only a subject marker. The owner wants to find a suitable way to handle
this later rather than include it in the current POS-override rules. The rule's
scope, evidence, handling of misspellings and execution stage remain open;
no `MOR-02` identifier or behavior is established for it.

A raw `{w}` can also represent a verb wibat or be ambiguous, so it cannot by
itself confirm a noun-wibat boundary. The current tagger reports `ဦးဘသည်`
as `ဦး{r} ဘ{n} သည်{w,p,pn}`: that example does not contain a `{?}` token.

## `pe` and grammatical candidates

The owner clarified that `p` means **ပစ္စည်း**, not a generic English
“particle”. `w` is ဝိဘတ်. `pe` is intentional and represents `{p, w, cj}`;
it is not simply another name for the tagger's `p`. The owner had planned to
resolve those separately, but the exact approach is not yet specified. Keep
`pe`, `pe1`, etc. in the template without collapsing the constituent categories.
The current Python tagger uses `cn` for conjunction, while the owner's grouping
is written `cj`; how those labels correspond needs confirmation. No new runtime
resolution rule is established by this note.

## Dictionary-missing names in templates

The owner notes that dictionaries cannot cover all names: a name such as
`မန္တလေး` or `စဖရန်စ္စစကို` may be split into tokens with mixed and
misleading POS tags. The msp-06 probe can retain a marker-bounded sequence that
contains `{?}` as one **conditional noun-unit candidate**, with original
token tags and uncertainty intact. It is not a confirmed name, correction,
or POS override, and does not implement the deferred `ဦး` rule above. Word
boundaries and alternatives still need further analysis.

## Dictionary repair note: `ကို  က`

- **Owner-directed correction:** remove the exact two-syllable `ကို  က` entry
  from `dictionary.NOUN`; it was an erroneous noun entry. Separate `ကို` and
  `က` entries in other categories were retained.
- **Status: finished.** Removed it from both the plaintext source
  `secret/master.json` and the encrypted runtime master
  `A.Engine/architecture/myangustis_engine/.data/master.json.enc`; rebuilt
  `A.Engine/architecture/myangustis_engine/.cache-tree/` from that master.
  Both master datasets now match, and the tree manifest records the runtime
  master fingerprint.
- **Observed before:** in `ဦးဘက စဖရန်စ္စစကိုက ပြန်လာတယ်။`, the tagger
  combined the last two syllables as `ကိုက{n}`. **After:** they appear
  separately as `ကို{w,p} က{w,cn,n}`. This correction alone does not prove
  a final noun-name span or resolve all POS/roles.

## Name-unit boundary at `pe` — slot-aware stop sign

The owner directed that name merging must not cross a `pe`: a selected `pe`
is a stop sign globally, including for name spans. A raw POS possibility alone
does not prove a token acts as `pe`. Both choices—using a token within a name
unit or splitting it as `pe`—must satisfy the applicable template slots.

The owner expects later rules and templates to honor this boundary as well.
Unusual names may expose edge cases; keep those examples for review rather
than assuming the present implementation handles every possible name.

**Current implementation:** the msp-06 probe builds complete slot bindings
first. When a binding selects an additional marker inside a noun unit of a
less-detailed binding with the same verb unit and the same previously selected
marker positions, it rejects that over-grouped binding. The boundary indices
and rejected analysis remain available as `rejected_analyses`. Incomparable
marker sets and different verb units remain alternatives, and raw tags do not
change. This comparison is limited to generated msp-06 candidates; it is not
a global cross-template resolver or proof that a conditional candidate is a
final parse. Other template implementations must honor the same stop sign.

For `ဦးဘက စဖရန်စ္စစကိုက ပြန်လာတယ်။`, msp-06 finds the complete binding
`ဦးဘ + က` and `စဖရန်စ္စစကို + က`, so it rejects the binding that swallows
the first `က` into `ဦးဘကစဖရန်စ္စစကို`. Ambiguous POS candidates inside the
name are not automatically split as `pe` without a supported slot binding.

## MOR-02: time versus place before `က` — RELOOK / EXTEND

**Status: implemented in the experimental msp-06 candidate probe; revisit and
extend the time list.** The owner corrected the draft and requested runtime
integration. The owner says to extend the list later:

```text
{
နာရီ
အချိန်
တုန်း
ရက်
လ
နှစ်
ခုနှစ်
မိနစ်
စဉ်
ခိုက်
/*will extend later*/
} + က  → time
else → place
```

MOR-02 distinguishes time/place interpretations of a selected `က` after a
candidate noun unit, not subject-marker `က`. In the current msp-06 probe,
normalize the combined unit to NFC and check whether it **ends with** a listed
expression (longest match wins); a listed ending selects time, otherwise the
owner's rule selects place. This is a provisional implementation of `+ က`;
its matching scope, segmentation and inflections must be revisited. The owner
corrected the original typo `နာdရီ` to `နာရီ`. The executable list and rule
are in `Lexical/abstract/template_runtime.py` (`_MOR_02_TIME_ENDINGS`,
`_mor_02_ka_role`). Candidate evidence records `MOR-02`, the matched ending or
`default-place`, and the unit; original POS and resolution evidence are kept.

**RELOOK:** the list is incomplete. For example, `မနက်က` currently takes the
place default even though `မနက်` can indicate time. Suffix matching can also
match the end of an unrelated word. Extend the list and reconsider matching
when examples show the need. Some listed forms (such as `တုန်း`, `စဉ်`, and
`ခိုက်`) have no noun-tag candidate in the tested standalone inputs, so the
msp-06 noun-unit probe cannot yet bind them; the rule can recognize their
endings when an eligible candidate unit is available, but does not override
their POS. The rule does not itself establish a name boundary, settle source
versus other place roles, or select the complete sentence analysis. It does
not implement the deferred `ဦး` idea.
