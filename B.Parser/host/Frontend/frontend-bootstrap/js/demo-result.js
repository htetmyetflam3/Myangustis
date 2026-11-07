import { onOverlayOpen, openOverlay } from "./overlay.js";

const SAMPLES = {
  pdf: {
    file: "sample.pdf · 100 pages",
    eyebrow: "pdf → unicode text",
    sub: "A 100-page Zawgyi PDF with a text layer, read through the embedded font maps.",
    badge: "Unicode output",
    loading: "Converting sample.pdf",
    base: "/samples/sample.praser",
  },
  docx: {
    file: "sample.zawgyi.docx",
    eyebrow: "docx → unicode text",
    sub: "A DOCX whose text layer is Zawgyi: Myanmar code points in visual order, reordered to Unicode.",
    badge: "Unicode output",
    loading: "Converting sample.zawgyi.docx",
    base: "/samples/sample.docx.praser",
  },
  scan: {
    file: "ဘဝထိုထို-part_1.pdf · 50 pages",
    eyebrow: "image-only pdf → ocr text",
    sub: "A real CamScanner scan: 50 page images whose only text is the scanner's own watermark. Rendered and recognised page by page.",
    badge: "OCR output",
    loading: "Reading the scan",
    base: "/samples/sample.scan.praser",
  },
};

const FETCH_TIMEOUT_MS = 12000;
const SETTLE_MS = 700;
let pending = null;
const cache = new Map();

async function load(base) {
  if (!cache.has(base)) {
    cache.set(
      base,
      (async () => {
        const [text] = await Promise.all([
          fetch(`${base}.txt`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }).then((r) => {
            if (!r.ok) throw new Error(`Could not load ${base}.txt`);
            return r.text();
          }),
          new Promise((resolve) => setTimeout(resolve, SETTLE_MS)),
        ]);
        return text;
      })().catch((error) => {
        cache.delete(base);
        throw error;
      }),
    );
  }
  return cache.get(base);
}

export function initDemoResult() {
  const overlay = document.getElementById("demoOverlay");
  if (!overlay) return;
  const el = (id) => document.getElementById(id);
  const loading = el("dmLoading");
  const error = el("dmError");
  const result = el("dmResult");

  const show = (state) => {
    loading.hidden = state !== "loading";
    error.hidden = state !== "error";
    result.hidden = state !== "ready";
  };

  function run(kind) {
    const cfg = SAMPLES[kind];
    if (!cfg) return;
    el("dmFile").textContent = cfg.file;
    el("dmEyebrow").textContent = cfg.eyebrow;
    el("dmSub").textContent = cfg.sub;
    el("dmBadge").textContent = cfg.badge;
    el("dmLoadingTitle").textContent = cfg.loading;
    el("dmStatus").innerHTML = "<i></i>Converting…";
    el("dmSaveDocx").href = `${cfg.base}.docx`;
    el("dmSavePdf").href = `${cfg.base}.pdf`;
    el("dmSaveTxt").href = `${cfg.base}.txt`;
    show("loading");
    load(cfg.base)
      .then((text) => {
        if (pending !== kind) return;
        el("dmText").value = text;
        el("dmStatus").innerHTML = "<i></i>Converted";
        show("ready");
      })
      .catch((err) => {
        if (pending !== kind) return;
        el("dmErrorText").textContent = err instanceof Error ? err.message : String(err);
        el("dmStatus").innerHTML = "<i></i>Unavailable";
        show("error");
      });
  }

  document.querySelectorAll("[data-demo]").forEach((button) =>
    button.addEventListener("click", () => {
      pending = button.getAttribute("data-demo");
      openOverlay("demo");
    }),
  );
  onOverlayOpen("demo", () => run(pending));
}
