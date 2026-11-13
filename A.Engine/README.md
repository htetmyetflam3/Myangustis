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
the host, debug bridge and `Lexical_No_inspect` are out of scope.
