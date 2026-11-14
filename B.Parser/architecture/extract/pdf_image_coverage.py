"""Placed-image evidence from PDF graphics operations.

Mirrors the pinned JS PageImageCollector. Coverage is measured in page points,
not source pixels, and uncertain clipping cannot establish a page-sized image.
This collector does not decode images or decide whether to run OCR.
"""
from __future__ import annotations

import math

from myangustis_parser.extract.pdf_fonts import Name, Ref

NEAR_PAGE_DIMENSION = 0.95
IDENTITY = (1, 0, 0, 1, 0, 0)


def _numbers(values):
    return all(isinstance(value, (int, float)) and not isinstance(value, bool) for value in values)


def _multiply(m, n):
    return (m[0]*n[0] + m[2]*n[1], m[1]*n[0] + m[3]*n[1],
            m[0]*n[2] + m[2]*n[3], m[1]*n[2] + m[3]*n[3],
            m[0]*n[4] + m[2]*n[5] + m[4], m[1]*n[4] + m[3]*n[5] + m[5])


def _axis_aligned(matrix):
    return ((abs(matrix[1]) < 1e-8 and abs(matrix[2]) < 1e-8)
            or (abs(matrix[0]) < 1e-8 and abs(matrix[3]) < 1e-8))


def _rectangle(m, x0=0, y0=0, x1=1, y1=1):
    points = [(m[0]*x + m[2]*y + m[4], m[1]*x + m[3]*y + m[5])
              for x, y in ((x0, y0), (x1, y0), (x0, y1), (x1, y1))]
    return [min(p[0] for p in points), min(p[1] for p in points),
            max(p[0] for p in points), max(p[1] for p in points)]


def _intersect(a, b):
    if a is None or b is None:
        return None
    box = [max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])]
    return box if box[2] > box[0] and box[3] > box[1] else None


def _inherited(loader, page_num, page_gen, key):
    page = loader.resolve(Ref(page_num, page_gen))
    seen = set()
    for _ in range(32):
        if not isinstance(page, dict):
            break
        if key in page:
            return loader.resolve(page[key])
        parent = page.get('Parent')
        if not isinstance(parent, Ref) or parent in seen:
            break
        seen.add(parent)
        page = loader.resolve(parent)
    return None


def _box(loader, value):
    box = loader.resolve(value)
    if not isinstance(box, list) or len(box) != 4 or not _numbers(box):
        return None
    a, b, c, d = box
    if not all(math.isfinite(v) for v in box) or a == c or b == d:
        return None
    return [min(a, c), min(b, d), max(a, c), max(b, d)]


class PageImageCollector:
    def __init__(self, loader, page_num, page_gen, operations):
        self.loader = loader
        self.operations = operations
        self.media = _box(loader, _inherited(loader, page_num, page_gen, 'MediaBox')) or [0, 0, 612, 792]
        self.resources = _inherited(loader, page_num, page_gen, 'Resources')
        self.state = {'matrix': IDENTITY, 'clip': self.media[:], 'clip_known': True}
        self.stack, self.path = [], []
        self.complex_path = self.pending_clip = False
        self.images = []
        self.forms = set()

    def add_image(self, name, is_mask=False):
        matrix, clip = self.state['matrix'], self.state['clip']
        visible = _intersect(_intersect(_rectangle(matrix), self.media), clip)
        if visible is None:
            return
        x_coverage = (visible[2] - visible[0]) / (self.media[2] - self.media[0])
        y_coverage = (visible[3] - visible[1]) / (self.media[3] - self.media[1])
        self.images.append({'name': name, 'bbox': visible, 'coverage': x_coverage * y_coverage,
                            'pageSized': (not is_mask and self.state['clip_known'] and _axis_aligned(matrix)
                                          and x_coverage >= NEAR_PAGE_DIMENSION and y_coverage >= NEAR_PAGE_DIMENSION)})

    def _form(self, entry, form, resources):
        if not isinstance(entry, Ref) or entry in self.forms or len(self.forms) >= 32:
            return
        data = self.loader.stream_of(entry)
        if not data:
            return
        self.forms.add(entry)
        previous = (self.state, self.stack, self.path, self.complex_path, self.pending_clip)
        matrix = self.loader.resolve(form.get('Matrix'))
        matrix = (_multiply(self.state['matrix'], matrix) if isinstance(matrix, list)
                  and len(matrix) == 6 and _numbers(matrix) else self.state['matrix'])
        form_box = _box(self.loader, form.get('BBox'))
        clip = _intersect(self.state['clip'], _rectangle(matrix, *form_box)) if form_box else self.state['clip']
        self.state = {'matrix': matrix, 'clip': clip,
                      'clip_known': self.state['clip_known'] and (not form_box or _axis_aligned(matrix))}
        self.stack, self.path = [], []
        self.complex_path = self.pending_clip = False
        own = self.loader.resolve(form.get('Resources'))
        try:
            for op, operands in self.operations(data):
                self.consume(op, operands, own if isinstance(own, dict) else resources)
        finally:
            self.state, self.stack, self.path, self.complex_path, self.pending_clip = previous
            self.forms.remove(entry)

    def consume(self, op, operands, resources=None):
        if resources is None:
            resources = self.resources
        state = self.state
        if op == 'q':
            self.stack.append({'matrix': state['matrix'],
                               'clip': state['clip'][:] if state['clip'] is not None else None,
                               'clip_known': state['clip_known']})
        elif op == 'Q':
            if self.stack:
                self.state = self.stack.pop()
        elif op == 'cm' and len(operands) >= 6 and _numbers(operands[-6:]):
            state['matrix'] = _multiply(state['matrix'], operands[-6:])
        elif op == 're' and len(operands) >= 4 and _numbers(operands[-4:]):
            x, y, w, h = operands[-4:]
            if not _axis_aligned(state['matrix']):
                self.complex_path = True
            self.path.append(_rectangle(state['matrix'], x, y, x + w, y + h))
        elif op in ('m', 'l', 'c', 'v', 'y'):
            self.complex_path = True
        elif op in ('W', 'W*'):
            self.pending_clip = True
        elif op in ('n', 'S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*'):
            if self.pending_clip:
                if not self.complex_path and len(self.path) == 1:
                    state['clip'] = _intersect(state['clip'], self.path[0])
                else:
                    state['clip_known'] = False
            self.path = []
            self.complex_path = self.pending_clip = False
        elif op == 'BI':
            self.add_image('inline')
        elif op == 'Do' and operands and isinstance(operands[-1], Name):
            name = str(operands[-1])
            xobjects = self.loader.resolve(resources.get('XObject')) if isinstance(resources, dict) else None
            entry = xobjects.get(name) if isinstance(xobjects, dict) else None
            obj = self.loader.resolve(entry)
            subtype = self.loader.resolve(obj.get('Subtype')) if isinstance(obj, dict) else None
            if subtype == 'Image':
                self.add_image(name, self.loader.resolve(obj.get('ImageMask')) is True)
            elif subtype == 'Form':
                self._form(entry, obj, resources)
