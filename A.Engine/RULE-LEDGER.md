# Engine rule ledger

Reference only; runtime code and tests are authoritative. Rule inventory: `architecture/myangustis_engine/knowledge/isTreasure/mainrules.json` (current scope: `wibat`). `template-data.json` is draft data, not runtime behavior.

## Done

| ID | Exact rule or change | Source / check |
|---|---|---|
| POS-01 | Exactly two candidates `{n, v}` in either order become `rbvn`; other candidate lists pass through. | `bridge/Ginit.py`; `test/engine/test_pos_stage.py` |
| DICT-01 | Move `သိမ်း` from `dictionary.NOUN` to `dictionary.VERB`. | Master/tree check; `test/engine/test_dictionary_repair.py` |
| DICT-02 | Remove exact `ကို  က` from `dictionary.NOUN`; keep separate `ကို` and `က` entries. | Master/tree check; `test/engine/test_dictionary_repair.py` |

## Partial

| ID | Implemented behavior | Limit |
|---|---|---|
| MOR-02 | For a selected `က` after a noun unit, a listed time ending gives `time`; otherwise the result is `place`. Endings: `နာရီ`, `အချိန်`, `တုန်း`, `ရက်`, `လ`, `နှစ်`, `ခုနှစ်`, `မိနစ်`, `စဉ်`, `ခိုက်`. | `msp-06` only; list is incomplete; does not change POS. Source: `Lexical/abstract/template_runtime.py`. |
| PE-01 | A selected `pe` blocks an overlong name span. | `msp-06` candidates only; not a global resolver. Source: `Lexical/abstract/template_runtime.py`. |
| NAME-01 | `msp-06` can retain a marker-bounded sequence containing `?` as a conditional noun-unit candidate. | Not a confirmed name or POS correction. |

## Not implemented

| ID | Requested rule | Status |
|---|---|---|
| MOR-01 | Confirmed pronoun + bare `့` (U+1037) → `ပိုင်ဆိုင်ခြင်းပြဝိဘတ်`. | Not implemented. No following-noun condition; an attached form such as `သူ့` is outside this bare-mark rule. |
| — | `ဦး` + consecutive `?` tokens + noun wibat → noun span. | Idea only; no rule ID or runtime behavior. `?` alone does not prove a name or typo. |

## Unresolved

- Keep `BOTH`, `disambiguate`, LSE/LSN, category, family/type, and sentence role as separate evidence; do not force a single result or pick the first candidate.
- `p` means `ပစ္စည်း`, `w` means `ဝိဘတ်`, and `pe` represents `{p, w, cj}`. The mapping between `cj` and the tagger's `cn` is not established.
