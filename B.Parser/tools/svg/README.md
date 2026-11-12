# SVG helper tools

This folder contains the standalone Python SVG framing helpers and their
`fixtures/frame-parity/` golden files. They are auxiliary tools, not the main
parser entry; see `B.Parser/README.md` for the parser package and CLI.

From the workspace environment, run the golden test with:

```sh
uv run --package myangustis-parser python test/parser-tests/test_frame_parity.py
```
