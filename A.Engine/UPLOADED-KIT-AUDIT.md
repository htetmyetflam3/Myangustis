# Audit against the uploaded JS kit

Reference: `secret/base/{normalize,sourceMapper,function,sourceMap}.js` and
`secret/graph/{build,disassembler,shape}.js`. The kit does not contain the
engine's segmentor, POS runtime or input bridge, so it cannot establish 1:1
parity for those parts. `secret/base/sourceMap.js` is a build input: the kit's
`build-payload.js` inlines `master.json` map data and removes duplicate exports.
The differential tests materialize the same substitutions in a temporary copy;
they do not rewrite the uploaded reference.

## Changes and results

- Python already had `mapperNormalize`, matching the uploaded implementation.
  Both text and file input paths now call it directly; previously they called
  `mapperStr(normalize(text))`, which skipped priority ordering and wrapping.
  This is an integration decision using the uploaded mapper; the kit does not
  itself specify the full engine input bridge. The historical JS engine on
  `main` used the old input path, so its bridge is not the parity oracle for
  this integration.
- The tree builder now uses JavaScript UTF-16 indexing where the kit does,
  JavaScript property ordering for roots, and JavaScript trim semantics in POS
  entries. An empty dictionary remains an empty JS object rather than falling
  back to the outer master.
- Differential tests run the actual uploaded JS sources. The current full
  master produces matching syllable lookup data, forward and reverse trees,
  references, mapped rows and POS tree/failures. Mapper tests include generated
  mixed-script cases and UTF-16/whitespace edge cases. These tests do not prove
  universal parity or cover components absent from the kit.
- With the corrected input path, the supplied Burmese samples produce eight
  bare dot-below marks in forms absent from the syllable inventory, down from
  52 bare asat marks. No post-segmentation mark-order fallback was added.

## Intentional remaining difference

`secret/graph/build.js` rewrites its plaintext master to delete failed POS
entries. Python's builder reports failures without mutating its supplied master,
which is encrypted in the Python runtime. Automatically deleting dictionary
data or rewriting an encrypted master requires an explicit design decision;
this audit does not silently remove user data. The kit's master also contains
plaintext data and its payload key is checked in; treat them as public, not
secrets. The proofreading tool's `canonical` helper is separate from the
engine runtime and was not used to change segmentation.
