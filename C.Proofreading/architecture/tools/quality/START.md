# Start card — current English-review workflow

## Scope and stop conditions

The current review track is English-only. API-generated Burmese text and the
other per-chapter API outputs have been removed; `content/mtranslate/english.txt`
is the only retained API-translated text file. Do not call an API, recreate
Burmese API output, or use stale API artifacts as a baseline. The separate
Burmese rewrite prompt (`finetune-agent-prompt.md`) is suspended unless the human
explicitly re-enables it.

If the requested chapter is not present in `english.txt`, or either translation
is missing or alignment fails, stop and report the exact limitation. Do not
substitute old files, infer missing lines, or regenerate translations.

## Review one small window

Use the current Chinese chapter number and a ten-paragraph window:

```text
compare_english_chapter {"chapter": 194, "start": 1, "count": 10}
```

Each row aligns the Chinese paragraph, local zh-en machine English, and API
English. Read the alignment metadata first. Continue only at `window.next_start`;
do not request or paste an entire chapter.

The retained inputs are:

- API English: `content/mtranslate/english.txt` (currently chapters 194–208);
- local Chinese→English: `content/mtranslate/zh-en.txt`;
- local English→Chinese: `content/mtranslate/en-zh.txt` (a reverse-check aid);
- Chinese source: `content/source/chinese-0511241012-from-8011_1.txt`;
- human Burmese source/reference: `content/source/ယဲ့နင်.txt` and
  `content/merged/episodes.docx`.

The two local MT files contain only parser-recognized chapters. The source
parser recovers chapter 241 from its OCR-damaged mid-body header, but still
reports 298 and 299 as unrecognized starts. Do not claim those chapters are
absent; report the parser limitation and do not invent their text.

## Human Burmese context — encoding caution

The prior human Burmese translation is retained, and must be consulted when a
recurring name, title, place, or technical term may have an established earlier
rendering. Use a Burmese-script keyword with the current Chinese chapter:

```text
previous_burmese_context {"chapter": 194, "keyword": "နတ်"}
```

The helper searches the two preceding Chinese chapters using the merged DOCX
chapter map and returns only bounded context. The human Burmese source has known
encoding damage (including Zawgyi-order clusters, substitutions, and dropped
vowels). Treat hits as uncertain contextual clues—not authoritative spelling,
grammar, style, or meaning. Verify every interpretation against the Chinese. If
the damaged text prevents an exact hit, do not guess or copy a form from it.

## Review rules

- Never call a translator or modify `english.txt`, `zh-en.txt`, or `en-zh.txt`.
- Chinese is the semantic source; local machine English is a fallible second
  witness. Keep accurate API English unchanged.
- Report only concrete English corrections and material ambiguities, with the
  paragraph index and a concise reason grounded in the Chinese.
- Do not read whole-book sources or return a whole tool result. Use bounded
  comparison/context tools instead.
- `mt/quality/english-review-task.md` has the detailed procedure. The Burmese
  rewrite procedure remains suspended unless the human explicitly re-enables it.
