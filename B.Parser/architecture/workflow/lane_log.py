"""Per-book parser decisions; only changes and contiguous page ranges are logged."""
from __future__ import annotations

import os
from pathlib import Path
import sys

from myangustis_engine.logen import Logen
from myangustis_parser.resources import paths


def _load_workspace_env():
    """Use the repository's shared loader when running from a checkout."""
    paths.load_workspace_env()


def log_file():
    """The decision-log file, anchored to the project root.

    ``PARSER_LOG_FILE=/log/`` writes ``<repo>/log/lane-decisions.log`` and
    ``PARSER_LOG_FILE=./logs/decisions.log`` writes inside the checkout —
    never under the filesystem root.
    """
    return paths.log_file_path()


def make_logger():
    _load_workspace_env()
    enabled = os.environ.get('PARSER_LOG_ENABLED', '').strip().lower() in ('1', 'true', 'yes', 'on')
    file = log_file() if enabled else None
    # stderr is still a console (or service journal), without corrupting CLI
    # JSON/text output. File logging is independent of the console sink.
    return Logen(file=file, console=lambda message: print(message, file=sys.stderr, flush=True))


class LaneLog:
    def __init__(self, book, logger=None):
        # Do not expose a local path. Logen escapes control characters in console output.
        self.book = Path(str(book)).name
        self.logger = logger if logger is not None else make_logger()
        self.stem_lane = None
        self.decision = None
        self.first = self.last = None

    def stem(self, page, lanes):
        for lane in lanes:
            if self.stem_lane is not None and lane != self.stem_lane:
                self.logger.emit_log('STEM', 'info', 'lane-switch',
                                     {'book': self.book, 'page': page,
                                      'from': self.stem_lane, 'to': lane})
            self.stem_lane = lane

    def finish_page(self, page, decision):
        if self.decision is not None and (decision != self.decision or page != self.last + 1):
            self.flush()
        if self.decision is None:
            self.decision, self.first = decision, page
        self.last = page

    def flush(self):
        if self.decision is not None:
            self.logger.emit_log('BEAUTIFY', 'info', 'decision',
                                 {'book': self.book, 'pages': f'{self.first}-{self.last}',
                                  'rule': self.decision})
            self.decision = self.first = self.last = None
