"""sys.path wiring for the responsibility-shaped modules/ tree.

The scraper modules keep flat sibling imports by convention
(`from disk_floor import ...`, `from Scrawler import ...`), the same
convention the proofreading-shaped tree uses. Every entry point imports
this module first; it puts each module directory on sys.path once, in a
stable order, so the flat imports resolve without dumping the modules into
one flat directory.

Layout (owner-shaped, one responsibility per directory):
  modules/crawler/       Dcrawler, Scrawler, HCrawler
  modules/download/      save_local, save_remote
  modules/guard/disk/    disk_floor, download_rate, site_size_guard, dedup_pdfs
  modules/guard/helper/  site_login
  modules/platform/      domain_guard, mediafire, phatmal
  modules/platform/scribdl/  scribd, scribd-downloader
  modules/result/        pdf_classify, text_collect, run journals
  modules/url/           download_links, failed_urls, fetch_results, serpapi
  support/               mailer, night, pdf_support, segment_bridge
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent

MODULE_DIRS = (
    "modules/crawler",
    "modules/download",
    "modules/guard/disk",
    "modules/guard/helper",
    "modules/platform",
    "modules/platform/scribdl",
    "modules/result",
    "modules/url",
    "support",
)

for _relative in MODULE_DIRS:
    _absolute = str(ROOT / _relative)
    if _absolute not in sys.path:
        sys.path.insert(0, _absolute)
