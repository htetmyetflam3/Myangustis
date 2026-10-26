import { onOverlayOpen } from "./overlay.js";
const GENERIC_OUTPUT_URL = "/samples/sample-freeconvert.txt";
const PARSED_OUTPUT_URL = "/samples/sample.praser.txt";
const WATCHDOG_MS = 12000;
const SETTLE_MS = 900;
let cachedDemo = null;
async function textFrom(url, timeout = 8000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`Could not load ${url}`);
  return response.text();
}
async function requestDemo() {
  const [generic, parsed] = await Promise.all([
    textFrom(GENERIC_OUTPUT_URL),
    textFrom(PARSED_OUTPUT_URL),
    new Promise((resolve) => setTimeout(resolve, SETTLE_MS)),
  ]);
  return { generic, parsed };
}
function loadDemo(force = false) {
  if (force) cachedDemo = null;
  cachedDemo ??= requestDemo();
  return cachedDemo;
}
export function initPdfDemo() {
  const overlay = document.getElementById("pdfOverlay");
  const status = document.getElementById("pdfStatus");
  const loading = document.getElementById("pdfLoading");
  const error = document.getElementById("pdfError");
  const errorMsg = document.getElementById("pdfErrorMsg");
  const result = document.getElementById("pdfResult");
  const source = document.getElementById("pdfSource");
  const genericPre = document.getElementById("pdfGeneric");
  const parsedPre = document.getElementById("pdfParsed");
  if (!overlay || !loading || !result) return;
  const setStatus = (text) => {
    const node = status?.lastChild;
    if (node) node.textContent = text;
  };
  const show = (state) => {
    loading.hidden = state !== "loading";
    if (error) error.hidden = state !== "error";
    result.hidden = state !== "ready";
  };
  const fail = (message) => {
    cachedDemo = null;
    if (errorMsg) errorMsg.textContent = message;
    setStatus("Output unavailable");
    show(error ? "error" : "ready");
  };
  let running = false;
  let watchdog = 0;
  function run(force = false) {
    if (running) return;
    running = true;
    show("loading");
    setStatus("Converting…");
    window.clearTimeout(watchdog);
    watchdog = window.setTimeout(() => {
      if (!running) return;
      running = false;
      fail("The output took too long to load. Download the complete files below instead.");
    }, WATCHDOG_MS);
    loadDemo(force)
      .then((demo) => {
        genericPre.textContent = demo.generic;
        parsedPre.textContent = demo.parsed;
        if (source) source.textContent = "complete output · 100 pages";
        setStatus("Converted · 100 pages");
        show("ready");
      })
      .catch((err) => fail(err instanceof Error ? err.message : "Could not load the output."))
      .finally(() => {
        running = false;
        window.clearTimeout(watchdog);
      });
  }
  onOverlayOpen("pdf", () => run(false));
  document.getElementById("pdfRetry")?.addEventListener("click", () => run(true));
  new MutationObserver(() => {
    if (!overlay.hidden && result.hidden && (!error || error.hidden) && !running) run(false);
  }).observe(overlay, { attributes: true, attributeFilter: ["hidden"] });
}