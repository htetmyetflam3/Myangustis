import { PdfName, PdfRef, isNumeric, toNumber } from "./pdf-fonts.js";

// Both dimensions must cover at least 95% of the MediaBox. Pixel dimensions
// alone say nothing about how large an image was placed on a PDF page.
export const NEAR_PAGE_DIMENSION = 0.95;
const IDENTITY = [1, 0, 0, 1, 0, 0];

function matrixMultiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function axisAligned(m) {
  const eps = 1e-8;
  return (Math.abs(m[1]) < eps && Math.abs(m[2]) < eps)
    || (Math.abs(m[0]) < eps && Math.abs(m[3]) < eps);
}

function rectangle(m, x0 = 0, y0 = 0, x1 = 1, y1 = 1) {
  const points = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => [
    m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5],
  ]);
  return [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1])),
    Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))];
}

function intersect(a, b) {
  if (!a || !b) return null;
  const box = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
  return box[2] > box[0] && box[3] > box[1] ? box : null;
}

function inherited(loader, pageNum, pageGen, key) {
  let page = loader.resolve(new PdfRef(pageNum, pageGen));
  const seen = new Set();
  for (let depth = 0; page instanceof Map && depth < 32; depth += 1) {
    if (page.has(key)) return loader.resolve(page.get(key));
    const parent = page.get("Parent");
    if (!(parent instanceof PdfRef) || seen.has(parent.key())) break;
    seen.add(parent.key());
    page = loader.resolve(parent);
  }
  return null;
}

function boxValue(loader, value) {
  const box = loader.resolve(value);
  if (!Array.isArray(box) || box.length !== 4 || !box.every(isNumeric)) return null;
  const [a, b, c, d] = box.map(toNumber);
  if (![a, b, c, d].every(Number.isFinite) || a === c || b === d) return null;
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
}

export class PageImageCollector {
  constructor(loader, pageNum, pageGen, operations) {
    this.loader = loader;
    this.operations = operations;
    this.media = boxValue(loader, inherited(loader, pageNum, pageGen, "MediaBox")) || [0, 0, 612, 792];
    this.resources = inherited(loader, pageNum, pageGen, "Resources");
    this.state = { matrix: [...IDENTITY], clip: [...this.media], clipKnown: true };
    this.stack = [];
    this.path = [];
    this.complexPath = false;
    this.pendingClip = false;
    this.images = [];
    this.forms = new Set();
  }

  addImage(name, isMask = false) {
    const { matrix, clip, clipKnown } = this.state;
    const placed = rectangle(matrix);
    const visible = intersect(intersect(placed, this.media), clip);
    if (!visible) return;
    const width = this.media[2] - this.media[0];
    const height = this.media[3] - this.media[1];
    const xCoverage = (visible[2] - visible[0]) / width;
    const yCoverage = (visible[3] - visible[1]) / height;
    this.images.push({
      name,
      bbox: visible,
      coverage: xCoverage * yCoverage,
      pageSized: !isMask && clipKnown && axisAligned(matrix)
        && xCoverage >= NEAR_PAGE_DIMENSION && yCoverage >= NEAR_PAGE_DIMENSION,
    });
  }

  form(entry, form, resources) {
    if (!(entry instanceof PdfRef) || this.forms.has(entry.key()) || this.forms.size >= 32) return;
    const data = this.loader.streamOf(entry);
    if (!data) return;
    this.forms.add(entry.key());
    const previous = this.state;
    const previousStack = this.stack;
    const previousPath = this.path;
    const previousComplex = this.complexPath;
    const previousClip = this.pendingClip;
    const matrix = this.loader.resolve(form.get("Matrix"));
    const nextMatrix = Array.isArray(matrix) && matrix.length === 6 && matrix.every(isNumeric)
      ? matrixMultiply(previous.matrix, matrix.map(toNumber)) : [...previous.matrix];
    const formBox = boxValue(this.loader, form.get("BBox"));
    const box = formBox ? rectangle(nextMatrix, ...formBox) : null;
    this.state = { matrix: nextMatrix, clip: box ? intersect(previous.clip, box) : previous.clip,
      clipKnown: previous.clipKnown && (!formBox || axisAligned(nextMatrix)) };
    this.stack = [];
    this.path = [];
    this.complexPath = false;
    this.pendingClip = false;
    const own = this.loader.resolve(form.get("Resources"));
    try {
      for (const [op, operands] of this.operations(data.toString("latin1"))) this.consume(op, operands, own instanceof Map ? own : resources);
    } finally {
      this.state = previous;
      this.stack = previousStack;
      this.path = previousPath;
      this.complexPath = previousComplex;
      this.pendingClip = previousClip;
      this.forms.delete(entry.key());
    }
  }

  consume(op, operands, resources = this.resources) {
    const state = this.state;
    if (op === "q") {
      this.stack.push({ matrix: [...state.matrix], clip: state.clip && [...state.clip], clipKnown: state.clipKnown });
    } else if (op === "Q") {
      if (this.stack.length) this.state = this.stack.pop();
    } else if (op === "cm" && operands.length >= 6 && operands.slice(-6).every(isNumeric)) {
      state.matrix = matrixMultiply(state.matrix, operands.slice(-6).map(toNumber));
    } else if (op === "re" && operands.length >= 4 && operands.slice(-4).every(isNumeric)) {
      const [x, y, w, h] = operands.slice(-4).map(toNumber);
      if (!axisAligned(state.matrix)) this.complexPath = true;
      this.path.push(rectangle(state.matrix, x, y, x + w, y + h));
    } else if (["m", "l", "c", "v", "y"].includes(op)) {
      this.complexPath = true;
    } else if (op === "W" || op === "W*") {
      this.pendingClip = true;
    } else if (["n", "S", "s", "f", "F", "f*", "B", "B*", "b", "b*"].includes(op)) {
      if (this.pendingClip) {
        if (!this.complexPath && this.path.length === 1) state.clip = intersect(state.clip, this.path[0]);
        else state.clipKnown = false;
      }
      this.path = [];
      this.complexPath = false;
      this.pendingClip = false;
    } else if (op === "BI") {
      this.addImage("inline");
    } else if (op === "Do" && operands.at(-1) instanceof PdfName) {
      const name = String(operands.at(-1));
      const xobjects = resources instanceof Map ? this.loader.resolve(resources.get("XObject")) : null;
      const entry = xobjects instanceof Map ? xobjects.get(name) : null;
      const object = this.loader.resolve(entry);
      const type = object instanceof Map ? this.loader.resolve(object.get("Subtype")) : null;
      if (String(type) === "Image") this.addImage(name, this.loader.resolve(object.get("ImageMask")) === true);
      else if (String(type) === "Form") this.form(entry, object, resources);
    }
  }
}
