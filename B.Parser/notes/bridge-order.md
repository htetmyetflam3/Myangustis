# WinInnwa bridge — what the stream actually carries (bg-mlc-1-1, 41 pages)

`/F4 /EAAAAA+WinInnwa`: `/ToUnicode` 104 codes (0x01–0x69, 31 below 0x20) → each value is the
WinInnwa *key*; `LEGACY_CODE_PAGES['wininnwa']` defines 104/104 of them.

Two-byte tokens in the page streams (`<0506>`, `<0809>`, …): **7762 in the book**

| kind | count | example |
|---|---|---|
| mark + consonant (visual order) | 3859 | `<0506>` `'ာ'`+`'သ'` → reads သာ |
| mark + mark | 3666 | `<0405>` `'်'`+`'ာ'` |
| stack glyph first | 205 | `<0809>` `'္ဒ'`+`'ါ'` |
| consonant + consonant | 17 | `<0607>` `'သ'`+`'ဒ'` |
| consonant + mark | 15 | `<0B09>` `'တ'`+`'ါ'` |

So a two-byte token is adjacency in **visual** order, not a fused code: half of them are a vowel
written before its consonant. No byte arithmetic composes them.
