"""Core report/event facilities from logen.js (not the legacy debug writers)."""
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime
import json
import os
from pathlib import Path
import time


def date_time_hash(at=None):
    return (at or datetime.now()).strftime('%Y%m%d-%H%M%S')


@dataclass
class ReportTracker:
    module: str
    start_time: float | None = None
    end_time: float | None = None
    counters: dict = field(default_factory=dict)
    flags: dict = field(default_factory=dict)
    lists: dict = field(default_factory=dict)
    samples: dict = field(default_factory=dict)

    def inc(self, key, n=1): self.counters[key] = self.counters.get(key, 0) + n
    def flag(self, key, value): self.flags[key] = value
    def list(self, key, item): self.lists.setdefault(key, []).append(item)
    def sample(self, key, item, cap=20):
        samples = self.samples.setdefault(key, [])
        if item not in samples: samples.append(item)
        if len(samples) > cap: del samples[:len(samples) - cap]


class Logen:
    def __init__(self, *, batch=False, file=None, checks=False):
        self.batch, self.file = batch, Path(file) if file else None
        self.checks_enabled = checks
        self.reports = {}
        self.listeners = defaultdict(list)
        self.checks = []
        self.chain = deque(maxlen=64)
        self.check_results = []

    def tracker(self, module):
        return self.reports.setdefault(module, ReportTracker(module))

    def append_file(self, line):
        if self.file:
            try:
                self.file.parent.mkdir(parents=True, exist_ok=True)
                fd = os.open(self.file, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
                with os.fdopen(fd, 'a', encoding='utf-8') as output:
                    output.write(line + '\n')
            except OSError:
                pass

    def emit_log(self, module, level, event, data=None):
        data = data or {}
        stamp = datetime.now().strftime('%H:%M:%S.%f')[:-3]
        if not self.batch or level in ('fail', 'error'):
            extra = ' '.join(f'{k}={v}' for k, v in data.items() if v is not None and v != '')
            print(f'{stamp} [{module}] {level.upper():<7} {event} {extra}'.rstrip())
        self.append_file(f'[{stamp}] [{module}] {level} {event} {json.dumps(data, ensure_ascii=False)}')

    def on_event(self, name, callback): self.listeners[name].append(callback)

    def stage(self, module): return Stage(self, module)

    def reset_report(self): self.reports.clear()

    def reset_chain(self):
        self.chain.clear()
        self.check_results.clear()

    def emit_event(self, name, payload=None):
        payload = payload or {}
        for listener in tuple(self.listeners[name]): listener(payload)
        for listener in tuple(self.listeners['*']): listener({'event': name, **payload})

    def define_check(self, name, *, after, run):
        self.checks.append((name, after, run))
        return len(self.checks)

    def record(self, event, payload):
        if self.checks_enabled:
            self.chain.append({'event': event, 'payload': payload, 'at': int(time.time() * 1000)})

    def run_checks(self, after, payload):
        if not self.checks_enabled: return []
        results = []
        for name, trigger, run in self.checks:
            if trigger != after: continue
            try:
                verdict = run(payload, list(self.chain))
                if verdict is None or verdict is True: ok, detail = True, ''
                elif verdict is False: ok, detail = False, ''
                elif isinstance(verdict, str): ok, detail = False, verdict
                else: ok, detail = bool(verdict.get('ok')), verdict.get('detail', '')
            except Exception as exc:
                ok, detail = False, str(exc)
            result = {'name': name, 'ok': ok, 'detail': detail}
            results.append(result)
            self.check_results.append(result)
            self.tracker('CHECK').inc('passed' if ok else 'failed')
        return results

    def flush_report(self, to_console=True):
        lines = []
        for module, tracker in self.reports.items():
            elapsed = int(((tracker.end_time or time.time()) - tracker.start_time) * 1000) if tracker.start_time is not None else 0
            values = [f'{k}={v}' for k, v in tracker.counters.items()] + [f'{k}={v}' for k, v in tracker.flags.items()]
            lines.append(' '.join([f'[{module}]', f'{elapsed}ms', *values]))
            lines.extend(f"  {module}.{k}: {', '.join(map(str, v[:20]))}" for k, v in tracker.samples.items())
            lines.extend(f"  {module}.{k}: {', '.join(map(str, v[:50]))}" for k, v in tracker.lists.items())
        report = '\n'.join(lines)
        if report:
            if to_console: print(report)
            self.append_file(report)
        return report


def read_counts(value):
    if value is None: return {'total': 0, 'items': []}
    if isinstance(value, (int, float)): return {'total': value, 'items': []}
    items = []
    for key, count in value.items():
        try: count = float(count) if count else 0
        except (TypeError, ValueError): count = 0
        items.append({'key': str(key), 'count': count})
    items.sort(key=lambda item: item['count'], reverse=True)
    return {'total': sum(item['count'] for item in items), 'items': items}


def read_tally(value):
    if value is None: return {'total': 0, 'pairs': [], 'chars': 0}
    if isinstance(value, (int, float)): return {'total': value, 'pairs': [], 'chars': None}
    if callable(getattr(value, 'total', None)):
        return {'total': value.total(), 'pairs': value.pairs(),
                'chars': value.char_delta() if callable(getattr(value, 'char_delta', None)) else None}
    pairs = []
    for key, count in value.items():
        parts = str(key).replace('\0', '=>').split('=>')
        try: count = float(count) if count else 0
        except (TypeError, ValueError): count = 0
        pairs.append({'from': parts[0], 'to': parts[1] if len(parts) > 1 else '?', 'count': count})
    pairs.sort(key=lambda pair: pair['count'], reverse=True)
    return {'total': sum(pair['count'] for pair in pairs), 'pairs': pairs,
            'chars': sum((len(p['from']) - len(p['to'])) * p['count'] for p in pairs)}


def show_counts(items, cap):
    return '  '.join(f"{item['key']} {{{item['count']}}}" for item in items[:cap])


def show_pairs(pairs, cap):
    return '  '.join(f"{pair['from']}=>{pair['to']} {{{pair['count']}}}" for pair in pairs[:cap])


class Stage:
    def __init__(self, logen, module): self.logen, self.module = logen, module

    def start(self, data=None):
        self.logen.tracker(self.module).start_time = time.time()
        self.logen.emit_log(self.module, 'processing', 'start', data)

    def end(self, data=None):
        tracker = self.logen.tracker(self.module)
        tracker.end_time = time.time()
        elapsed = int((tracker.end_time - tracker.start_time) * 1000) if tracker.start_time is not None else 0
        self.logen.emit_log(self.module, 'success', 'done', {**(data or {}), 'ms': elapsed})

    def fail(self, data=None): self.logen.emit_log(self.module, 'fail', 'fail', data)
    def skip(self, data=None): self.logen.emit_log(self.module, 'skip', 'skip', data)
