# JS engine (main branch) — segmentation + POS on deliberately misspelled text

Scope: **segmentation (`flag: 'syllable'`) and POS (`flag: 'pos'`) only.** No
parser, no PDF/DOCX, no files parsed. Same three hand-written, intentionally
misspelled sentences in every round, so only the logging flags change.

## 1. What was staged

`main` in this repo is the **JavaScript** tree (`index-path.js`, `logen.js`,
`package.json`), head `67f0284`. Extracted read-only, like a checkout, into
`Junk/staging/main-js/`:

```sh
git archive 67f0284 A.Engine index-path.js logen.js package.json .npmrc jsconfig.js \
  | tar -x -C Junk/staging/main-js
```

* 92 files / 11 MB, no `.git`, no `node_modules`.
* No `npm install` needed: the engine core imports only Node builtins
  (`node:fs`, `node:path`, `node:crypto`, `node:url`, `node:events`,
  `node:util`) plus its own files. Nothing from the parser or the web app is
  touched.
* The runner refuses to start unless `EngineRoot()` resolves inside
  `Junk/staging/main-js`, so the working tree can never be used by accident.
* `Junk/` (fonts, 34 MB) and the parser tree are not part of this run.

## 2. The flags that actually exist (this is the bit that matters)

From `A.Engine/architecture/init/bridge.js` and `logen.js`:

| switch | where | default | what it really does |
| --- | --- | --- | --- |
| `log` | `BindEngine({ sourceText, flag, log })` | `true` | Gates **events**. `runSegmentor(..., {log})` and `runTagger(..., {log})` emit the `SEGMENT` / `TAGGER` console lines, the detail counters and the `[SEGMENTOR] Done. Total lines: N` print only while this is true. |
| `DEBUG` | `legacyLog.init({ DEBUG: true })` | `false` | Gates **files**. Uppercase, one-shot (`if (_initialized) return`). While true, detail events are appended to the per-module files in the engine log dir and every module report is written on `process.on('exit')`. |
| `logDir` | `configureWorkspace({ logDir })` (`_path.js`) | `<Junk>/log/logfromengine` | Where those files land. `getLogen()` installs it via `setEngineLogDirectory(LogFile)`. |
| `debug` | `BindEngine({ debug: true })` | `false` | Something else entirely: `init/debug-bridge.js` `runDebug()` returns five `segmented_<hash>_*.txt` dumps. Not used here. |

So **"debug log on/off" in the JS engine is `legacyLog.init({ DEBUG })`**, and
a log file only appears when `log: true` **and** `DEBUG: true` — except the POS
walker, see round 3.

## 3. Rounds (three, because the two flags are not the same switch)

| round dir | `BindEngine.log` | `legacyLog.init.DEBUG` | log files written |
| --- | --- | --- | --- |
| `r1-log-on-debug-on` | `true` | `true` | `segment.log` 45 B, `tagger.log` 220 B, `walker.log` 987 B |
| `r2-debug-off` | `true` | `false` | **none** |
| `r3-log-off` | `false` | `true` | only `walker.log` 987 B |

### Round 1 — log on, DEBUG on

Console (`console.txt`, 10 lines, ANSI stripped):

```
14/11/2026, 20:05:42.643  SYS     INFO    logger-init
14/11/2026, 20:05:42.799  SEG     PROCESSING segmenting...
[SEGMENTOR] Done. Total lines: 3
14/11/2026, 20:05:42.959  TAG     PROCESSING tagging...
14/11/2026, 20:05:42.959  SEG     PROCESSING segmenting...
[SEGMENTOR] Done. Total lines: 3
14/11/2026, 20:05:42.969  TAG     SUCCESS done | 10ms
```

`logfromengine/tagger.log`:

```
══ TAGGER REPORT ══
elapsed: 13ms

── counts ──
  tokenReceived:     50
  wordCount:     41
```

`logfromengine/walker.log`:

```
══ WALKER REPORT ══
elapsed: 4ms

── counts ──
  quit_no-match:     68
  outputSyllables:     68

══ TREE PATHS ══
── root A ──
  step1: total=12
  step2: total=8
```

`segment.log` holds the SEGMENT REPORT header (elapsed only): the JS segmentor
does not push per-syllable detail counters for a 3-line input, so its report is
just the timing block.

### Round 2 — the same run with `DEBUG: false` ("debug log off")

* `logfromengine/` is **empty**: no `segment.log`, no `tagger.log`, no
  `walker.log`. Nothing is written, not even a header.
* Console is the same events minus the `logger-init` line (9 lines) — `log`
  was still true, so the SEGMENT/TAGGER lines still print.
* `summary.json` records `"log_files": []`.
* The empty `logfromengine/` directory is kept with a `.gitkeep` marker (git
  cannot store an empty directory); it contains **no** log file.

### Round 3 — extra: `log: false`, `DEBUG: true`

* Console: only `logger-init` — no `SEGMENT`/`TAGGER` lines, no
  `[SEGMENTOR] Done` (4 lines).
* Yet `walker.log` is still written (987 B, identical to round 1). The POS rule
  engine (`bridge/Ginit.js` → walker) is **not** passed the `log` flag, so its
  detail counters always fire and `DEBUG` alone decides whether they hit disk.
  In other words `log: false` silences segmentation/tagging, not the POS walker.

## 4. Outputs are identical in all three rounds

`segmentation.txt`, `pos.syllable.txt`, `pos.raw.txt` have the same md5 in
every round (`d8ba18ba…`, `43d503ac…`, `8ebb8c55…`) — the flags only change
logging, never the result.

### Segmentation (3 lines in → 3 lines out)

```
နျ  ေ  ကေ  ြ  ာ  ငါး  ဂျ  ှ  ိ  ာ  း  န  ါ
ဖ  တျ  ်  ခြင်း  မ  ရ  တဲ့  မြန်  မာ  စာ  ကို  ကေ  ျ  ြ  ာ  င့  ်  ပြင်  ဖို့  ကြိုး  စား  တယ်  ။
သျှ  င့  ်  ျ  အိမ်  ထဲ  နွေး  ေ  ြ  ခွေး  ကြောင်  တွေ  ဝင်  လာ  ကြ  တယ်
```

### POS (1 unit for 3 lines, `tokenReceived: 50`, `wordCount: 41`)

```
နျ{?} ေ{F} ကေ{?} ြ{F} ာ{F} ငါး{n} ဂျ{?} ှ{F} ိ{F} ာ{F} း{F} န{n} ါ{F} ဖ{n,p}
တျ{?} ်{F} ခြင်း{n,p} မ{n,p} ရ{n,p} တဲ့{p} မြန်မာ{n} စာ{n,p} ကို{w,p} ကေ{?} ျ{F}
ြ{F} ာ{F} င့{?} ်{F} ပြင်{n,p} ဖို့{v,w,cn,p} ကြိုးစား{v} တယ်{w} ။<eos> သျှ{?}
င့{?} ်{F} ျ{F} အိမ်{n} ထဲ{w} နွေး{aj} ေ{F} ြ{F} ခွေး{n} ကြောင်{n} တွေ{v,p}
ဝင်{v} လာ{v,p} ကြ{n,p} တယ်{w}
```

What it shows:

* **No throw.** 128 characters of impossible orthography come back as tokens.
* Broken stacks surface as `{?}` bases (`နျ ဂျ ကေ တျ သျှ င့`) and `{F}`
  floating marks (`ှ ိ ာ း ါ ် ြ ေ ျ`) — `{F}` is the "input was broken" signal.
* Unlike the Python engine (which rewrote `နျေကေ` into `ကြော` and `င့ ်` into
  `င် ့`), the JS segmentor stays **literal**: `ကေ` + `ြ` + `ာ` stay separate,
  and `နွေး` even gets tagged `{aj}`.
* Only line 2 ends with `။`, so all three lines become **one** POS unit with a
  single `<eos>` mid-stream. Line breaks alone do not end a POS sentence.
* `quit_no-match: 68` in `walker.log` = every token the POS walker could not
  match in a rule, i.e. the broken half of the input.

## 5. Files

```
Junk/staging/input.txt                              the 3 misspelled sentences (shared)
Junk/staging/js-run/run_engine_rounds.mjs           the runner (segment + POS only)
Junk/staging/js-run/runs/r1-log-on-debug-on/         console.txt, segmentation.txt,
                                                    pos.syllable.txt, pos.raw.txt,
                                                    summary.json,
                                                    logfromengine/{segment,tagger,walker}.log
Junk/staging/js-run/runs/r2-debug-off/              the same, logfromengine/ empty
Junk/staging/js-run/runs/r3-log-off/                the same, only walker.log
```

Reproduce (each round is its own process because `legacyLog.init` is one-shot):

```sh
export NO_COLOR=1 MYANGUSTIS_STATE_DIR=$PWD/Junk/staging/js-run/state
node Junk/staging/js-run/run_engine_rounds.mjs --round=r1-log-on-debug-on --log=true  --debug=true
node Junk/staging/js-run/run_engine_rounds.mjs --round=r2-debug-off        --log=true  --debug=false
node Junk/staging/js-run/run_engine_rounds.mjs --round=r3-log-off          --log=false --debug=true
```

(An earlier round in this workspace staged the **`python`** branch by mistake;
that run is `Junk/staging/RUN-NOTES.md` and is about the Python engine, not
this one.)
