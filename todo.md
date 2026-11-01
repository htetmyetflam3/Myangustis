# Layout rules to verify

Slots below are converter inputs, not necessarily PDF bytes or physical keys.

## WinInnwa

| Slot: decimal / hex | Character | Current decision | Verify |
|---|---|---|---|
| 36 / 0x24 | `$` | Unmapped | Earlier `ွှ`; other witness `ကျပ်` |
| 37 / 0x25 | `%` | Unmapped | Earlier `ဏ` was questioned |
| 124 / 0x7C | `\|` | Unmapped | Earlier `ျွ`; other witness `ဋ္ဌ` |
| 181 / 0xB5 | `µ` | Unmapped | Earlier `%`; other witness `!` |
| 234 / 0xEA | `ê` | Unmapped | Earlier `ှ`; other witness `ြု` |
| 87 / 0x57 | `W` | `ျွှ` | Original version; not seen in surveyed PDFs |
| 166 / 0xA6 | `¦` | `္ထ` | Original version; not seen in surveyed PDFs |
| 191 / 0xBF | `¿` | `?` | Original version; not seen in surveyed PDFs |
| 201 / 0xC9 | `É` | `္တွ` | Original version; not seen in surveyed PDFs |
| 216 / 0xD8 | `Ø` | `င်္ိ` | Original version; not seen in surveyed PDFs |
| 231 / 0xE7 | `ç` | `,` | Original version; not seen in surveyed PDFs |
| 240 / 0xF0 | `ð` | `ိံ` | Original version; not seen in surveyed PDFs |

## Ayar

| Slot: decimal / hex | Character | Current decision | Verify |
|---|---|---|---|
| 199 / 0xC7 | `Ç` | `င်္ီ` | Original keyboard slot; observed in grammar text |
| 231 / 0xE7 | `ç` | `င်္` | Original keyboard slot |
| 95 / 0x5F | `_` | Empty output | Original keyboard behavior |
| 48 / 0x30 | `0` | `၀` | `ဝ/၀` in context; no global replacement |
| 119 / 0x77 | `w` | `၀` | `ဝ/၀` in context; no global replacement |
