# Engine logging rounds on deliberately misspelled Burmese

Two rounds of the **staged `python` branch engine** (segment + POS) on the same
hand-written, intentionally wrong text — first with the engine log on, then
with it off. Both log files are kept.

## 1. What was staged

```sh
git archive 8a4424b A.Engine B.Parser index-path.py pyproject.toml \
    .env.example main.py systemd_lib.py | tar -x -C Junk/staging/main
```

* `8a4424b` is the head of the `python` branch (= the branch this work started
  from), checked out read-only into `Junk/staging/main/`.
* Extracted with `git archive`, so there is no `.git`, no `__pycache__` and no
  working-tree edit in the copy — it is exactly what the branch contains.
* `Junk/` (34 MB of fonts), `C.Proofreading/architecture/content` (75 MB of book
  corpora) and `secret/` are not copied: the engine does not read them.
* The runner refuses to start unless `myangustis_engine.__file__` is inside
  `Junk/staging/main/`, so the editable install of the working tree can never
  be used by accident.
* `diff -r -x __pycache__ Junk/staging/main/A.Engine/architecture/myangustis_engine A.Engine/architecture/myangustis_engine`
  is empty: the staged engine is byte-identical to the engine on this branch
  (this branch only touched parser paths, not `A.Engine`).

## 2. The flags that actually exist

From `A.Engine/architecture/myangustis_engine/init/bridge.py`:

| key | type | default | behaviour |
| --- | --- | --- | --- |
| `log` | bool | `True` | while True **and** a logger is passed, `Logen` writes `SEGMENT`/`TAGGER` records to its file/console. `None` logger silences everything, including the `[SEGMENTOR] Done…` print, which is guarded by `if logger:`. |
| `debug` | bool | `False` | **only `False` is accepted.** `debug=True` raises `NotImplementedError('The bridge debug path is intentionally not mirrored')`. There is no way to switch it on. |
| `quiet` | bool | `False` | validated as a bool, not used by the Python path. |

There is no `LOG_ENABLED` / `DEBUG` environment variable in the engine and no
`logPath`; the switch is the per-request `log` key plus the `Logen(file=…)`
you hand to `bind_engine`.

Note for library callers: `myangustis_engine.api.collect()` hard-codes
`'log': False`, so `api.segment_text()` / `api.pos_views()` **never** log. To
log you must call `bind_engine(request, logger=Logen(file=…))` with
`'log': True` yourself — that is what `run_engine_round.py` does.

```python
logger = Logen(file=out / 'engine.log', console=collect_lines)
request = {'sourceText': text, 'flag': 'syllable', 'log': True, 'debug': False}
[item async for item in bind_engine(request, logger=logger)]
```

## 3. The text (`input.txt`, 3 lines, 128 chars)

```
နျေကေ ြာငါးဂျှိားနါ
ဖတျ်ခြင်း မရတဲ့ မြန်မာစာကို ကေျြာင့် ပြင်ဖို့ ကြိုးစားတယ်။
သျှင့်ျ အိမ်ထဲ နွေး‌ေ‌ြ ခွေးကြောင်တွေ ဝင်လာကြတယ်
```

What is wrong on purpose:

* line 1 — medial ya before its base (`နျ`), a bare medial ra with nothing to
  attach to (`ြာငါး`), orphaned `ှ ိ ာ း`, and `နါ` with no asat.
* line 2 — asat after a medial (`ဖတျ်`), reversed stack with two medials in
  front of the base (`ကေျြာင့်`). This is the only line ending in `။`.
* line 3 — trailing medial after the asat (`သျှင့်ျ`), and ZWNJ-padded
  `နွေး‌ေ‌ြ` (`U+200C` ×2).

## 4. Round 1 — `log: true`, `debug: false`

`Junk/staging/runs/round-1-log-on/engine.log` (292 bytes, 4 lines, mode 0600):

```
[13:28:17.322] [SEGMENT] processing segmenting... {"lineCount": 0}
[13:28:17.351] [TAGGER] processing tagging... {}
[13:28:17.409] [SEGMENT] processing segmenting... {"lineCount": 0}
[13:28:17.412] [TAGGER] success done {"tokenCount": 50, "wordCount": 44, "elapsedSec": "0.1", "elapsed": 61}
```

Round 1 also prints the two direct writes (captured in `console.txt` and
`stdout.txt`):

```
[SEGMENTOR] Done. Total lines: 3
[SEGMENTOR] Done. Total lines: 3
```

## 5. Round 2 — `log: false`, `debug: false`

Same text, same flags except logging off.

* `Junk/staging/runs/round-2-log-off/engine.log` — **0 bytes**: nothing was
  written, not even a header.
* `console.txt`, `stdout.txt` — both empty as well.
* `debug=true` was attempted in this round too and failed exactly as in round 1
  (`debug-true-attempt.txt`, `NotImplementedError`), which is the only
  "debug log" state the engine has.

## 6. Results are identical, logging changes nothing

`segmentation.txt`, `pos.syllable.txt` and `pos.raw.txt` are byte-identical
between the two rounds (the runner prints
`segmentation/POS identical across rounds: True`). The only differences are the
log/console files.

### Segmentation (3 lines in, 3 lines out)

```
နျ  ေ  ကြော  ငါး  ဂျ  ှ  ိ  ာ  း  န  ါ
ဖ  တျ  ်  ခြင်း  မ  ရ  တဲ့  မြန်  မာ  စာ  ကို  ကျ  ြ  ေ  ာ  င်  ့  ပြင်  ဖို့  ကြိုး  စား  တယ်  ။
သျှ  ငျ  ်  ့  အိမ်  ထဲ  န  ြ  ွ  ေ  း  ခွေး  ကြောင်  တွေ  ဝင်  လာ  ကြ  တယ်
```

### POS (1 unit for 3 lines)

```
နျ{?} ေ{F} ကြော{n} ငါး{n} ဂျ{?} ှ{F} ိ{F} ာ{F} း{F} န{n} ါ{F} ဖ{n,p} တျ{?} ်{F}
ခြင်း{n,p} မ{n,p} ရ{n,p} တဲ့{p} မြန်မာ{n} စာ{n,p} ကို{w,p} ကျ{v,p} ြ{F} ေ{F} ာ{F}
င်{F} ့{F} ပြင်{n,p} ဖို့{v,w,cn,p} ကြိုးစား{v} တယ်{w} ။<eos> သျှ{?} ငျ{?} ်{F} ့{F}
အိမ်{n} ထဲ{w} န{n} ြ{F} ွ{F} ေ{F} း{F} ခွေး{n} ကြောင်{n} တွေ{v,p} ဝင်{v}
လာ{v,p} ကြ{n,p} တယ်{w}
```

What that shows:

* **It never throws.** 128 characters of impossible orthography come back as
  tokens — the segmentor is total on garbage.
* Invalid stacks get split and the pieces are tagged `{?}` (base the tagger
  cannot analyse: `နျ ဂျ တျ သျှ ငျ`) or `{F}` (a floating mark with no base:
  `ှ ိ ာ း ါ ် ြ ေ ွ ့`). `{F}` is the useful signal that the input was broken.
* The segmentor still *invents* legal syllables out of broken input:
  `နျေကေ` → `နျ  ေ  ကြော` (tagged `{n}`) and `ကေျြာင့်` → `ကျ  ြ  ေ  ာ  င်  ့`
  (`ကျ{v,p}`). Wrong spelling is silently normalised into plausible words —
  worth knowing before trusting counts on dirty text.
* `tokenCount=50 / wordCount=44` in the log counts these fragments, so log
  numbers on broken input are fragment counts, not word counts.
* Only line 2 ends with `။`, so the tagger's `fullstop_holder` glues all three
  lines into **one** sentence: `pos_units=1` with a single `<eos>` in the
  middle. Line breaks alone do not end a POS sentence; a `။` does.

## 7. Files

```
Junk/staging/input.txt                       the 3 misspelled sentences
Junk/staging/run_engine_round.py             the runner (both rounds)
Junk/staging/runs-console.txt                runner stdout (the assertions)
Junk/staging/runs/round-1-log-on/            engine.log (4 lines), console.txt,
                                             stdout.txt, segmentation.txt,
                                             pos.syllable.txt, pos.raw.txt,
                                             debug-true-attempt.txt, summary.json
Junk/staging/runs/round-2-log-off/           the same files, engine.log 0 bytes
```

Reproduce:

```sh
python Junk/staging/run_engine_round.py
```
