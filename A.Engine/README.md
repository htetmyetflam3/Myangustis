# Engine

`architecture/myangustis_engine/` is the Python engine package. Its nested
`MonoSyllabism/` tree contains the mapper, graph builder, segmentor, walkers,
POS tagger and formatters. `init/bridge.py` is the public engine entry;
`secure_data/secure.py` reads the encrypted master and plain or sealed JSON.
No Node, JS child process or WASM is used at runtime. The bridge has one
hash-free streaming path; it does not expose positional API responses.

This checkout includes a sample encrypted master, generated trees, and their
**public test key** at `architecture/myangustis_engine/.data/note.test.txt`.
Renaming a key does not keep it secret; do not use this key to protect private
data. For production, use a separately stored master and key as shown below.
The packaged wheel excludes these local runtime files.

From the repository root:

```sh
uv sync --package myangustis-engine --extra native
export MYANGUSTIS_MASTER_ENC=/private/master.json.enc
export MYANGUSTIS_MASTER_KEY_FILE=/private/master.key.txt
# Alternatively provide MASTER_JSON_KEY through your secret manager.
uv run --package myangustis-engine myangustis-build-trees --output /private/prebuilt-trees
export MYANGUSTIS_TREE_DIR=/private/prebuilt-trees
```

The builder is a separate operation; the runtime requires existing trees and
never builds them. Keep production master data and keys outside the repository. The tree
manifest checks file consistency, not authenticity or confidentiality.

```python
from myangustis_engine import bind_engine
from myangustis_engine.api import segment_text, pos_views
from myangustis_engine.secure_data.secure import read_master_json, read_secure_json

syllables = segment_text('မြန်မာစာ။')  # sync caller
views = pos_views('မြန်မာစာ။')          # raw_pos + syllable views
# Async callers can iterate bind_engine({'sourceText': text, 'flag': 'pos'}).
```

For an API deployment, build the compiled modules on the target OS, architecture
and Python ABI, with matching Python development headers and a C compiler:

```sh
uv run --package myangustis-engine --extra native myangustis-build-native \
  --output /private/native-engine --trees /private/prebuilt-trees
```

Deploy the output and separately provide `cryptography`, the sealed master and
its key. The output contains native `.so`/extension modules, minimal Python
package initializers, and readable knowledge/tree JSON. The native build omits
the tree builder and generated C source. Compilation obscures code but does
not prevent reverse engineering. The normal development wheel contains
readable Python source.

Run `uv run --package myangustis-engine python -m unittest discover -s test/engine -v`.
JS differential tests are optional and require an external reference checkout;
set `MYANGUSTIS_JS_REFERENCE_ROOT` to it. `logen.py` is a partial logging port;
the host and debug bridge are out of scope. The Python `Lexical` package
contains the current inspectable lexical experiments; the JS reference calls
its corresponding area `Lexical_No_inspect`.

## Experimental sentence-template probe

The experimental `template` report first scans `pe`-group POS candidates from the
Burmese full stop backwards using the runtime master's `resolution.single`
defaults and style alternatives. It skips surfaces supported by both styles
and selects the first distinguishing style, then exposes applicable resolution
entries throughout the sentence. POS ambiguity and multiple category/role
paths remain visible; selection is based on candidates, not a confirmed parse.
Unlisted forms and sentences with no discriminator remain unresolved.
Grouped/multi-token resolution rules and position-based distinctions are not
yet implemented. This style evidence does not yet resolve the template roles.

The opt-in `template` flag is an incomplete parser. It can report `possible`
`msp-03` and `msp-04` candidates for supported noun/verb structures, such as
`အိပ်ရာ သိမ်း။` and `ထမင်းဆိုင်မှာ စားမလား။`. It looks from the end for a
verb root, binds a noun unit as its `N1` child, and preserves the template's
nested declarations and inheritance. The owner defines `pe` as a grouping of
`p` (ပစ္စည်း), `w` (ဝိဘတ်), and `cj`; it is not equivalent to the single `p` tag. It can include a listed noun wibat and
listed verb-family ending candidates, retaining the marker's source and
`disambiguate` entries. Candidates do not resolve noun roles, marker category,
ending order, or competing templates and are not final parses. Unsupported
or ambiguously tagged tokens stay unresolved.

For `msp-05`, the explicit ending can be reported as evidence, but its noun
sequence and `pt` are not yet parsed. `msp-06` can probe the subject and optional source, goal, instrument and
comitative/temporal marker chain using the selected style. An unknown name split into mixed POS tokens may be retained as one
conditional noun-unit candidate before a noun wibat, without changing raw tags
or asserting that the spelling is wrong. In msp-06, a noun unit cannot cross a
`pe` selected by a fuller complete binding with the same verb unit and existing
marker positions; rejected over-groupings remain inspectable. Raw `pe` POS
candidates do not automatically split names, and incomparable bindings remain
alternatives. This is not yet a global cross-template resolver. Proper-name status
is not confirmed; fused temporal units are not parsed. MOR-02 distinguishes
time versus place when a candidate noun unit is followed by `က`: listed time
endings select time; otherwise it defaults to place. The list is incomplete,
so unlisted time expressions can take the place default; see the ledger for
extensions and the rule's implementation scope. Search limits are reported when reached.
`msp-07` reports marker evidence but does not yet parse the fronted topic or
omitted markers.
`msp-01` and `msp-02` remain pending fallbacks while broader structures are
incomplete. Incomplete sentences stay unresolved. Existing `syllable` and `pos`
output is unchanged.

```python
from myangustis_engine.api import template_views
reports = template_views('ထမင်းဆိုင်မှာ စားမလား။')
```
