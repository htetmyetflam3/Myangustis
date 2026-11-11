# Frame-parity fixture

The JavaScript parser and the Python parser are independent programs that
implement one contract: given the same page export and seed, both build the
same SVG line and frame sheets, byte for byte.

This directory holds that contract as **data**:

| file | what it is |
|---|---|
| `page.svg` | a small synthetic page export (4 glyph paths, 3 lines, 2 sizes) |
| `expected.json` | the SVG the JavaScript builder emitted for seeds 1 and 7, stored verbatim |

`B.Parser/Python/test_frame_parity.py` runs the Python builder on `page.svg`
and compares its output with `expected.json`. It runs Python only — no Node,
no subprocess into JavaScript.

## Regenerating the golden

Regenerate it **from the JavaScript side**, once, when the frame contract
itself changes (never to make a failing Python test pass):

```sh
cd "$(mktemp -d)"
cp /path/to/B.Parser/Python/fixtures/frame-parity/page.svg .
for seed in 1 7; do
  node /path/to/B.Parser/prised/@postprocess/repair/svg/make-line.js \
       page.svg "$seed" ".$seed.js"
done
# then fold known/*.svg into expected.json in the shape above
```

That command is a build step run by a human, not by either parser. The
Python tree never calls it.
