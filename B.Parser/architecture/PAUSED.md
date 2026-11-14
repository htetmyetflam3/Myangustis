# Paused — Ayar/WinInnwa layout selection (2026-11-14)

Parked at `be6723b`: a layout is guessed from the text in `normalize/legacy_ascii.py`; selecting a
code page in `extract/pdf_fonts.py` was never started. Resume only after the WinInnwa two-subset
study: subset code numbers carry no relation to the layout or to each other, so bytes cannot imply a layout.
