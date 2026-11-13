# POS and grammar rule ledger

**Purpose:** a human-readable record of rules already active and rules proposed
for the POS/grammar stage. This is **not runtime configuration**: adding a
rule here does not change segmentation, POS tags, the master, or templates.
Rule IDs below are ledger identifiers, not established linguistic names.

## Source map and terminology

- **Main rule inventory:** [`mainrules.json`](architecture/myangustis_engine/knowledge/isTreasure/mainrules.json)
  mirrors the data in `main`'s `A.Engine/architecture/knowledge/isTreasure/mainrules.js`.
  Relevant paths include `wibat.noun`, `wibat.disambiguate`,
  `thanbanda.clause`, `thanbanda.sentence`, and `paccaya`.
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

**Working interpretation for review:** when a pronoun is immediately followed
by an orthographically attached standalone `့` (U+1037, dot below), consider
the mark a candidate for the possessive wibat function, associated with that
pronoun. This records the proposed analysis; it does **not** say every dot
below or every pronoun followed somewhere by a dot is possessive. It also does
not assume that the mark is an independently written particle: it may be an
orthographic mark on the final syllable of the pronoun.

**Proposed evidence/guardrails before implementation:**

1. Establish the **whole pronoun span**, including multi-syllable pronouns,
   from evidence stronger than one token merely containing `pn` as one of
   several candidates. If the pronoun identity is unresolved, keep the rule
   pending rather than treating the candidate as confirmed.
2. The `့` must be a **bare U+1037 token** and attach to the end of that
   pronoun in the source, with no intervening character, word, whitespace or
   punctuation. The tagger omits whitespace tokens and the formatted API does
   not supply original character positions, so adjacency in a list of POS
   tokens is **not enough** to prove source attachment. Preserve source spans
   or other reliable boundary evidence before applying the rule.
3. Determine whether the mark is a valid part of the pronoun's spelling,
   a separately meaningful possessive marker in the owner's analysis, or a
   segmentation/normalization artifact. Never relabel all residual marks as
   grammar merely because they are bare in engine output.
4. Suggested annotation, **not an established output contract**: identify the
   pronoun span and the attached mark, record candidate category `wibat` and
   type `ပိုင်ဆိုင်ခြင်းပြဝိဘတ်`, and retain input POS candidates and source
   evidence. Decide later whether the annotation belongs on the mark, on the
   pronoun, on their relation, or on more than one of these. Avoid duplicating
   or deleting text and avoid inventing an independent word ID for a combining
   mark without an agreed representation.
5. If style/category, family/type, pronoun identity, or source attachment is
   unresolved, retain candidate evidence and do not make an irreversible
   override. Sentence/phrase role and the owner's LSE/LSN distinctions may be
   needed, but their exact precedence is not established here.

**Observed current end-to-end behavior (not expected final answers):**

| Input | Current syllable view | Current POS view | Implication |
|---|---|---|---|
| `ကျွန်တော့်စာ။` | `ကျွန် · တော် · ့ · စာ · ။` | `ကျွန်{n,p} · တော်{n,p,pn} · ့{F} · စာ{n,p} · ။<eos>` | The mark is bare, but `တော်` has multiple candidates and the whole pronoun span is not resolved. A simple “previous token has pn” test would overclaim. |
| `သူ့စာ။` | `သူ့ · စာ · ။` | `သူ့{?} · စာ{n,p} · ။<eos>` | The mark is already part of a syllable, so a rule for **bare** `့` alone would not fire. Whether the same analysis should apply here is an owner decision. |
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
- Dot after a non-pronoun, or separated by whitespace/punctuation: do not
  trigger. This requires preserved source boundaries.
- Dot already inside a syllable, as in `သူ့`: owner to decide whether this
  rule is strictly for bare marks or should also cover the equivalent attached
  spelling. Do not silently expand scope.
- Canonically equivalent `asat + dot` / `dot + asat` source order: identify
  the same attachment without losing the original spelling or conflating
  normalization artifacts with linguistic rules.
- A pronoun immediately before a sentence boundary, incomplete input, or a
  sentence without a following possessed noun: expected outcome needs an
  explicit decision; a possession relation may need a target beyond the
  proposed marker classification.
- Interactions with LSE/LSN, family/type overlaps, other `disambiguate`
  entries, and conflicts between later rules: retain all evidence until
  priorities and tie-breaking are specified.

## Open decisions / backlog

- Confirm whether `DRAFT-POS-001` recognizes only **bare output marks**, or
  both bare and syllable-internal spellings of the same pronoun + dot pattern.
- Confirm what counts as a confirmed pronoun, including multi-syllable forms,
  and whether the rule needs a following possessed noun to classify the mark.
- Define how the pronoun/mark relation is represented and where its wibat type
  belongs in the future output; the current schema has no agreed mark-level
  provenance/offset contract.
- Provide worked examples for how LSE/LSN resolves a `disambiguate` overlap,
  and how sentence-role evidence resolves a `BOTH` family/type overlap.
- Replace lossy `particleToClass` flattening only after agreeing on a
  multi-candidate, provenance-preserving model; don't change runtime maps as
  part of this ledger.
