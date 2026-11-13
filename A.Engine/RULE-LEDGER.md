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
  particular sentence can already be parsed or a particle resolved.
- **Active POS stage:** [`bridge/Ginit.py`](architecture/myangustis_engine/bridge/Ginit.py)
  calls [`posoverride.py`](architecture/myangustis_engine/Lexical_No_inspect/abstract/posoverride.py).
  The latter is currently a pass-through. The active bridge applies the
  noun/verb rule below; it is not a grammar classifier yet.
- **Tagger inputs:** [`phonology.py`](architecture/myangustis_engine/MonoSyllabism/main/phoneme/phonology.py)
  emits `syllables`, `ids`, and candidate `rawPos`. Relevant current tags
  include `pn` (pronoun), `n` (noun), `p` (particle) and `w` (wibat).
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
under noun particle as a gender-related item; retaining both paths matters.

## Wibat naming proposal — starting point, not runtime names

These are **invented, compact identifiers** for discussion, not established
Burmese grammatical terminology and not names already present in the code.
The Burmese names and existing lists remain the authority for which node is
which. Choose or replace any code before implementing it.

### Recommended structure

`wi.<family>.<type>` names a **wibat type**, not a word, style or rule:

- `wi` = wibat category; `nu` = noun family; `vu` = verb family.
- `wi.nu.zor` = **ပိုင်ဆိုင်ခြင်းပြဝိဘတ်**, the possessive/associated relation.
  Pronounce it “wee noo zor”. `zor` is arbitrary; it is not a claim about
  Burmese etymology or an existing engine tag. `nu` follows the existing
  `wibat.noun` inventory; it does not change the pronoun POS. It covers the
  owner’s Burmese category rather than asserting literal legal ownership.
- Use a separate rule ID such as `r.wi.zor.01` for **pronoun + bare dot →
  `wi.nu.zor`**. The type and the rule that discovers it are not the same.
- Suggested separate marker notation: `mk.dot` = the bare U+1037 input mark;
  this names the **form**, not its grammatical function. The same glyph is not
  automatically `zor` in every context.
- `w` and `pn` remain existing raw POS tags; `wi.nu.zor` is a proposed
  richer classification, **not** a replacement raw tag or a change to the
  master. LSE/LSN and `BOTH` are not components of the type name.

Example notation, once the owner’s pattern is matched:

```
pronoun + mk.dot  --r.wi.zor.01-->  wi.nu.zor
```

For readability in discussion one may say **“zor-wibat”**, and keep the
full ID `wi.nu.zor` in the ledger. Alternate equally valid names for the same
node are `wi.nu.pos` (transparent shorthand) or `wi.nu.vax` (more alien).
Only one should eventually be chosen; aliases must not create duplicate types.

### Complete `wibat` node inventory from `mainrules`

The labels below are proposed mnemonic aliases, not conclusions about the
listed markers. An **empty list means the source has not assigned a surface
here**, not that the function is impossible. Each item is a type node unless
it is explicitly identified as a disambiguation queue.

| Family | Proposed ID | `mainrules` Burmese node | Source-list status / examples |
|---|---|---|---|
| noun | `wi.nu.sub` | ကတ္တားဝိဘတ် | empty |
| noun | `wi.nu.obj` | ကံဝိဘတ် | `ကို` |
| noun | `wi.nu.src` | ထွက်ခွာရာပြဝိဘတ် | `မှ` |
| noun | `wi.nu.dir` | ရှေးရှုရာပြဝိဘတ် | empty; keep separate from endpoint |
| noun | `wi.nu.end` | ဆိုက်ရောက်ရာပြဝိဘတ် | `ထိ`, `အထိ`, `ထိအောင်` |
| noun | `wi.nu.ins` | အသုံးခံပြဝိဘတ် | empty |
| noun | `wi.nu.cau` | အကြောင်းပြဝိဘတ် | `ကြောင့်` |
| noun | `wi.nu.rec` | လက်ခံပြဝိဘတ် | `အား` |
| noun | `wi.nu.loc` | နေရာပြဝိဘတ် | empty in mainrules |
| noun | `wi.nu.tim` | အချိန်ပြဝိဘတ် | empty in mainrules |
| noun | `wi.nu.zor` | ပိုင်ဆိုင်ခြင်းပြဝိဘတ် | empty in mainrules; first owner rule targets it |
| noun | `wi.nu.fit` | လိုက်လျောပြဝိဘတ် | `အရ`, `အတိုင်း`, … |
| noun | `wi.nu.com` | ယှဉ်တွဲပြဝိဘတ် | `နှင့်အတူ`, `နှင့်တကွ` |
| noun | `wi.nu.sep` | ခွဲထုတ်ရာပြဝိဘတ် | `အနက်`, `အထဲမှာ`, `အထဲမှ` |
| noun | `wi.nu.pur` | ရည်စူးချက်ပြဝိဘတ် | `ငှာ`, `ဖို့`, `အတွက်`, … |
| noun | `wi.nu.spc` | နေရာဆက်တိုက်ပြဝိဘတ် | empty |
| noun | `wi.nu.dur` | အချိန်ဆက်တိုက်ပြဝိဘတ် | `ပတ်လုံး`, `လုံးလုံး` |
| verb | `wi.vu.prs` | ပစ္စုပ္ပန်ကာလပြကြိယာဝိဘတ် | empty |
| verb | `wi.vu.pst` | အတိတ်ကာလပြကြိယာဝိဘတ် | `ပြီ` |
| verb | `wi.vu.fut` | အနာဂတ်ကာလပြကြိယာဝိဘတ် | `မည်`, `လိမ့်မည်`, … |
| verb | `wi.vu.cmd` | စေခိုင်းဝိဘတ် | `လော့` |
| verb | `wi.vu.jnt` | ညှိနှိုင်းဝိဘတ် | `စို့`, `ရအောင်` |
| verb | `wi.vu.wsh` | ဆန္ဒညွှန်ဝိဘတ် | `ပါရစေ`, `ပါစေ` |
| verb | `wi.vu.ord` | အမိန့်ချဝိဘတ် | `စေ`; keep separate from `cmd` |

Queue nodes are **not types**: `wibat.noun.disambiguate` contains `က`, `မှာ`,
`သို့`, `ဖြင့်`, `နှင့်`, `၌`, `တွင်`, `ဝယ်`, `တိုင်တိုင်`, `တိုင်အောင်`;
`wibat.disambiguate` contains `သည်`, `၏`. Don't name a resolved class
`wi.nu.disambiguate`. Store the queue position and **all possible category /
family / type paths**, and resolve them using the owner’s LSE/LSN and context
principles above. No mapping for an ambiguous occurrence is asserted here.

### Why source paths must remain visible

The draft template is useful but not the source of an automatic answer:
`mainrules.wibat.noun.ပိုင်ဆိုင်ခြင်းပြဝိဘတ်` is empty, while the draft
`LSE_Map`/`LSN_Map` lists `၏` there; `mainrules.wibat.disambiguate` also lists
`၏`. Similarly the draft adds noun-location entries to a node left empty in
mainrules. These are **source differences to retain for review**, not reasons
to fill missing lists, discard the disambiguation queue, or assign `BOTH` from
style membership. Sentence and clause templates may supply later context;
the rest of the grammar-book data is reference material, not an implemented
classifier or a prerequisite for naming the wibat nodes.

### Proposed annotation for the first rule (concept only)

```
rule:        r.wi.zor.01
input:       confirmed pronoun + bare mk.dot (U+1037)
result:      category=wi, family=nu, type=zor
source:      owner-defined rule; mainrules wibat noun type
state:       proposed / not runtime
```

The label identifies the grammatical function; it does not decide whether
future output should represent `mk.dot` as a separate token or as a relation
attached to its pronoun. That is an implementation representation question,
not a doubt about the owner’s stated rule.

## Existing runtime rules and stage behavior

| ID | Status | Condition | Current result | Source |
|---|---|---|---|---|
| `EXISTING-POS-001` | Active | A token has **exactly** two `rawPos` candidates, `n` and `v`, in either order. | Bridge replaces `rawPos` with `['rbvn']` and sets `finalPos` to `rbvn`. `isAmbiguous` reflects the original candidate count. A list containing `n`, `v`, and another tag is not collapsed. | `bridge/Ginit.py` (mirrors active `main` JS `bridge/Ginit.js`) |
| `EXISTING-POS-002` | Active behavior | Any other token at the current POS override stage. | Candidates pass through, `finalPos` is the first candidate (or `None` for an empty list), and `matches` is empty. This is a placeholder, **not** evidence that ambiguity has been resolved. | `Lexical_No_inspect/abstract/posoverride.py` |

The tagger has additional standalone-token and number/punctuation handling in
`phonology.py`; those are tagger behavior, not rules implemented by this POS
ledger. Main's separate experimental `Lexical_No_inspect/abstract/kernel.js`
contains classifier/resolver scaffolding, but it is not the active Python
pipeline and is not evidence that contextual grammar rules are running.

## Proposed rules

### `DRAFT-POS-001` — pronoun + bare dot below → possessive wibat

**Status:** proposed by owner; **not implemented**. Name and output schema are
working labels. The Burmese label requested is **ပိုင်ဆိုင်ခြင်းပြဝိဘတ်**.

**Owner's rule:** `pronoun + bare dot below = ပိုင်ဆိုင်ခြင်းပြဝိဘတ်`.

**Owner-defined scope:** `pronoun + bare ့ (U+1037) →` the possessive wibat
type. The result for a confirmed match is **ပိုင်ဆိုင်ခြင်းပြဝိဘတ်**, not
just a generic candidate. The mark may be an orthographic mark on the final
syllable rather than an independently written particle; this does not change
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
- Provide worked examples for how LSE/LSN resolves a `disambiguate` overlap,
  and how sentence-role evidence resolves a `BOTH` family/type overlap.
- Replace lossy `particleToClass` flattening only after agreeing on a
  multi-candidate, provenance-preserving model; don't change runtime maps as
  part of this ledger.
