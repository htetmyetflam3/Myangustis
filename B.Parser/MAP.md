# B.Parser — the one-page map

**What it does:** takes a Myanmar document (`.pdf` / `.docx`, Zawgyi or
Unicode, old legacy fonts included) and writes it back out as a clean
`.pdf`, `.docx`, or `.txt`.

## The only thing you ever call

```js
import { convert } from "./index.js";
await convert("input.pdf", "output.docx");
```

That's it. Everything below is internal. You never need to open the
internal files to use this — if something breaks, say what went wrong,
not which file.

## What happens inside (3 stages)

| Stage | What it does | Where it lives |
|---|---|---|
| 1. Take in | checks size, lands a temp file, prepares it (qpdf expands/decrypts PDFs; DOCX packages are validated). Nothing is held whole in memory. | `@entry/` → `@init/` |
| 2. Parse | reads the prepared file, works out each page's encoding (Unicode / Zawgyi / legacy font), cleans the text, and returns **one marked-up string per page** (`<h1>`, `<b>`, `<i>`, blank line = new paragraph). Layout is used here and thrown away here. | `@parse/` |
| 3. Write | renders those page strings to the file type the output name asks for. Never re-opens the original. | `@output/`, wrapped by `@parse/requested.js` |

Support code: `core/` (text rules, cleanup, post-processing),
`@jason-map/` (the JSON conversion maps), `host/` (the website —
Backend + Frontend, separate from the converter), `samples/` (test files).

## Rules already baked in (don't undo)

- One **judgement** decides each page's decoding lane, once. Decoders
  execute; they never second-guess or refuse.
- The parser must not run all day. It is woken per job (systemd socket
  service in `@entry/depency/`) and exits when idle.
- Only 2 files convert at a time (the machine is mostly 2 cores).
- Output writing happens only **after** parsing returns — never inside it.

## The rest of the repo, in one breath

`Architecture/` is the separate Myanmar language engine (grammar/POS);
`C.Proofreading/`, `D.Scraper/`, `tools-box/` are small side tools;
`test/` holds tests. **B.Parser is the file converter** — this directory.
