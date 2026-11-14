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
    """Per-book parser decisions: page evidence to the file, one verdict to the console.

    Two sinks on purpose. The console is for the operator watching a run and
    gets one line per book; the file is for the post-mortem and gets every
    page. ``Logen(batch=True)`` writes the file without touching the console,
    so detail costs the operator nothing.
    """

    def __init__(self, book, logger=None):
        # Do not expose a local path. Logen escapes control characters in console output.
        self.book = Path(str(book)).name
        self.logger = logger if logger is not None else make_logger()
        # A caller may hand in any object with ``emit_log`` (tests, services);
        # only a real Logen carries a file, and only then is there a file sink.
        self.file_logger = Logen(batch=True, file=getattr(self.logger, 'file', None),
                                 console=lambda message: None)
        self.stem_lane = None
        self.decision = None
        self.first = self.last = None

    def file_event(self, event, data):
        """Evidence for the file, silent on the console."""
        if self.file_logger.file is not None:
            self.file_logger.emit_log('PDFDIAG', 'info', event, data)

    def verdict(self, data):
        """The one line per book that says what happened to it."""
        self.logger.emit_log('PDFDIAG', 'info', 'book', data)

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
