import {
  inspectUpload,
  gateFor,
  route,
  buildPayload,
  formatBytes,
  readQuota,
  writeQuota,
  usedFromRemaining,
  DAILY_LIMIT,
  DOCX_IMAGE_DOMINANCE,
  NOTICE,
} from "./upload.js";
import { isTerminal, pollDelivery, readDelivery, stateLabel } from "./delivery.js";
const CSRF_TIMEOUT_MS = 8000;
// A file POST is not a small JSON GET: a 7 MB scan on a slow connection needs
// minutes, not seconds. Give the upload room proportional to its size.
const uploadTimeoutMs = (bytes) => Math.min(3_600_000, 60_000 + bytes * 0.08);
const TOKEN_KEY = "akkhara:visitor";
const store = () => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};
const visitorToken = () => store()?.getItem(TOKEN_KEY) || "anon";
async function csrfToken() {
  const response = await fetch("/csrf-token", {
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(CSRF_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`CSRF endpoint answered ${response.status}`);
  const body = await response.json();
  if (!body.csrfToken) throw new Error("CSRF endpoint returned no token");
  return body;
}
// fetch does not expose upload progress. XHR lets a slow 16 MB connection show
// real byte progress instead of an unexplained second spinner.
function postUpload(body, csrf, timeout, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new window.XMLHttpRequest();
    xhr.open("POST", "/api/submit");
    xhr.withCredentials = true;
    xhr.timeout = timeout;
    xhr.setRequestHeader("x-csrf-token", csrf);
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    });
    xhr.addEventListener("load", () => {
      let answer = {};
      try { answer = JSON.parse(xhr.responseText || "{}"); } catch { /* non-JSON refusal */ }
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        answer,
        visitorToken: xhr.getResponseHeader("X-Visitor-Token"),
      });
    });
    xhr.addEventListener("timeout", () => reject(new window.DOMException("Upload timed out", "TimeoutError")));
    xhr.addEventListener("error", () => reject(new TypeError("Network upload failed")));
    xhr.send(body);
  });
}
export function initUploadTool() {
  const panel = document.getElementById("upload");
  if (!panel) return;
  const el = (id) => document.getElementById(id);
  const fileLabel = el("upFile");
  const status = el("upStatus");
  const title = el("upTitle");
  const sub = el("upSub");
  const quota = el("upQuota");
  const quotaText = el("upQuotaText");
  const drop = el("upDrop");
  const input = el("upInput");
  const errorBox = el("upError");
  const errorText = el("upErrorText");
  const result = el("upResult");
  const nameOut = el("upName");
  const chip = el("upChip");
  const stats = el("upStats");
  const notice = el("upNotice");
  const noticeText = el("upNoticeText");
  const promptZawgyi = el("upPromptZawgyi");
  const zawgyiEn = el("upZawgyiEn");
  const zawgyiMm = el("upZawgyiMm");
  const promptOcr = el("upPromptOcr");
  const ocrText = el("upOcrText");
  const chooser = el("upChooser");
  const select = el("uploadEngine");
  const outputChooser = el("upOutputChooser");
  const outputSelect = el("uploadOutput");
  const outputRequired = el("upOutputRequired");
  const actions = el("upActions");
  const chipName = el("upChipName");
  const sendingRow = el("upSending");
  const sendingText = el("upSendingText");
  const submit = el("upSubmit");
  const deliveryRow = el("upDelivery");
  const deliveryLabel = el("upDeliveryLabel");
  const deliveryError = el("upDeliveryError");
  const download = el("upDownload");
  const downloadLabel = el("upDownloadLabel");
  const sent = el("upSent");
  const sentTitle = el("upSentTitle");
  const sentIcon = el("upSentIcon");
  const sentNote = el("upSentNote");
  const sentRetry = el("upSentRetry");
  let plan = null;
  let flow = "conversion";
  let gate = "none";
  let choice = "default";
  let outputFormat = "";
  let picked = null;
  let used = 0;
  let sending = false;
  let lastConfirmed = false;
  let abortSignal = { aborted: false };
  function paintDelivery(d) {
    if (!d) { deliveryRow.hidden = true; return; }
    deliveryRow.hidden = false;
    deliveryRow.classList.toggle("is-ready", d.state === "FINISHED");
    deliveryRow.classList.toggle("is-failed", d.state === "FAILED" || Boolean(d.error));
    deliveryLabel.textContent = stateLabel(d.state);
    const ready = d.state === "FINISHED" && d.downloadUrl;
    download.hidden = !ready;
    if (ready) {
      download.href = d.downloadUrl;
      if (d.finalFilename) download.setAttribute("download", d.finalFilename);
      downloadLabel.textContent =
        `Download${d.finalFilename ? ` ${d.finalFilename}` : ""}` +
        (d.finalBytes ? ` · ${formatBytes(d.finalBytes)}` : "");
    }
    deliveryError.hidden = !d.error;
    deliveryError.textContent = d.error || "";
  }
  const setStatus = (text) => {
    const node = status.lastChild;
    if (node) node.textContent = text;
  };
  const remaining = () => Math.max(0, DAILY_LIMIT - used);
  function paintQuota() {
    const left = remaining();
    quota.hidden = left > 0;
    if (left <= 0) {
      quotaText.textContent = `You have used all ${DAILY_LIMIT} uploads for today. The allowance resets at 00:00 UTC — 06:30 in Myanmar.`;
    }
    drop.classList.toggle("is-blocked", left <= 0);
    input.disabled = left <= 0;
    if (!plan) setStatus(left > 0 ? `${left} of ${DAILY_LIMIT} left today` : "Daily limit reached");
  }
  function paintOutputRequired() {
    const missing = Boolean(plan) && !outputFormat;
    if (outputRequired) outputRequired.hidden = !missing;
    if (submit) submit.disabled = missing;
    document
      .querySelectorAll("[data-up-confirm]")
      .forEach((button) => { button.disabled = missing; });
  }
  function paintRoute() {
    if (!plan) return;
    const picked_ = route(plan, flow, choice, outputFormat);
    chip.textContent = `${picked_.job} · ${picked_.method}`;
    chip.classList.toggle("is-ocr", picked_.job === "ocr" || picked_.content === "image");
    paintOutputRequired();
  }
  function paintFlow() {
    const analysis = flow === "analysis";
    title.textContent = analysis ? "Upload a document to analyse" : "Upload a PDF or DOCX";
    sub.textContent = analysis
      ? "The file is checked in your browser first. If the Burmese is not readable, you are asked before anything is analysed."
      : "Your file is checked in the browser first, and that check decides which method to use.";
    panel.setAttribute("aria-label", analysis ? "grammar analysis / upload" : "upload / extraction path");
  }
  function reset() {
    plan = null;
    picked = null;
    sending = false;
    abortSignal.aborted = true;
    abortSignal = { aborted: false };
    paintDelivery(null);
    gate = "none";
    choice = "default";
    outputFormat = "";
    input.value = "";
    drop.hidden = false;
    drop.classList.remove("is-busy", "is-over");
    errorBox.hidden = true;
    result.hidden = true;
    sent.hidden = true;
    actions.hidden = false;
    sendingRow.hidden = true;
    chooser.hidden = true;
    if (outputChooser) outputChooser.hidden = true;
    if (outputSelect) outputSelect.value = "";
    promptZawgyi.hidden = true;
    promptOcr.hidden = true;
    notice.hidden = false;
    select.disabled = false;
    submit.disabled = false;
    fileLabel.textContent = `${flow} · pdf / docx`;
    paintQuota();
  }
  /** A rejected file must leave the widget exactly as it was before the pick:
      no picked file, no stale input value (or re-choosing the SAME file would
      not fire a change event and the widget would look stuck), and the notice
      visible on the default drop state. No reload needed. */
  function rejectFile(notice) {
    picked = null;
    input.value = "";
    drop.classList.remove("is-busy");
    el("upDropTitle").textContent = "Drop a PDF or DOCX here, or click to choose";
    errorText.textContent = notice;
    errorBox.hidden = false;
    paintQuota();
  }
  async function take(file) {
    if (remaining() <= 0) return;
    picked = file;
    drop.classList.add("is-busy");
    errorBox.hidden = true;
    el("upDropTitle").textContent = "Checking the file…";
    setStatus("Checking the file…");
    let next;
    try {
      next = await inspectUpload(file, flow);
    } catch (error) {
      rejectFile(error instanceof Error ? error.message : "The file could not be read.");
      return;
    }
    if (next.kind === "unsupported") {
      rejectFile(next.notice);
      return;
    }
    drop.classList.remove("is-busy");
    el("upDropTitle").textContent = "Drop a PDF or DOCX here, or click to choose";
    plan = next;
    gate = gateFor(next, flow);
    choice = "default";
    fileLabel.textContent = `${next.name} · ${formatBytes(next.size)}`;
    nameOut.textContent = next.name;
    chipName.textContent = next.name;
    noticeText.textContent = next.notice;
    result.classList.toggle("is-scan", next.kind === "pdf-scan");
    result.classList.toggle("is-images", next.kind === "docx-images");
    stats.innerHTML =
      next.inputFormat === "pdf"
        ? `<div><dt>size</dt><dd>${formatBytes(next.size)}</dd></div>
           <div><dt>pages</dt><dd>${next.detector.sampledPages
             ? `${next.detector.sampledTextPages}/${next.detector.sampledPages} sampled · ${next.detector.pages} total`
             : `${next.detector.textPages}/${next.detector.pages} text`}</dd></div>
           <div><dt>mm letters</dt><dd>${next.detector.myanmarLetters}</dd></div>
           <div><dt>layer</dt><dd>${next.kind === "pdf-text" ? "text" : "image only"}</dd></div>`
        : `<div><dt>size</dt><dd>${formatBytes(next.size)}</dd></div>
           <div><dt>image bytes</dt><dd>${formatBytes(next.detector.imageBytes)}</dd></div>
           <div><dt>text bytes</dt><dd>${formatBytes(next.detector.textBytes)}</dd></div>
           <div><dt>ratio</dt><dd>${
             next.detector.textBytes
               ? (next.detector.imageBytes / next.detector.textBytes).toFixed(1)
               : "∞"
           }× / ${DOCX_IMAGE_DOMINANCE}×</dd></div>`;
    chooser.hidden = gate !== "choose-docx";
    outputFormat = "";
    if (outputSelect) outputSelect.value = "";
    if (outputChooser) outputChooser.hidden = false;
    promptZawgyi.hidden = gate !== "confirm-zawgyi";
    promptOcr.hidden = gate !== "confirm-ocr";
    notice.hidden = gate === "confirm-zawgyi" || gate === "confirm-ocr";
    actions.hidden = gate === "confirm-zawgyi" || gate === "confirm-ocr";
    if (gate === "confirm-zawgyi") {
      zawgyiEn.textContent = NOTICE.zawgyi;
      zawgyiMm.textContent = NOTICE.zawgyiMm;
    }
    if (gate === "confirm-ocr") {
      ocrText.textContent = next.inputFormat === "pdf" ? NOTICE.ocrPdf : NOTICE.ocrDocx;
    }
    select.value = choice;
    drop.hidden = true;
    result.hidden = false;
    sent.hidden = true;
    paintRoute();
    setStatus(`${remaining()} of ${DAILY_LIMIT} left today`);
  }
  async function send(confirmed) {
    if (!plan || sending) return;
    if (!outputFormat) {
      setStatus("Choose output format");
      paintOutputRequired();
      return;
    }
    sending = true;
    lastConfirmed = confirmed;
    const payload = buildPayload({ plan, flow, choice, confirmed, outputFormat });
    actions.hidden = true;
    chooser.hidden = true;
    if (outputChooser) outputChooser.hidden = true;
    promptZawgyi.hidden = true;
    promptOcr.hidden = true;
    sent.hidden = true;
    sendingText.textContent = `Submitting ${plan.name}…`;
    sendingRow.hidden = false;
    setStatus("Submitting…");
    let note = "";
    let failed = false;
    let accepted = null;
    let serverUsed = null;
    try {
      const body = new FormData();
      if (picked) body.append("file", picked, payload.uploadName);
      body.append("metadata", JSON.stringify(payload));
      const csrf = await csrfToken();
      const response = await postUpload(
        body,
        csrf.csrfToken,
        uploadTimeoutMs(picked?.size || 0),
        (loaded, total) => {
          const percent = Math.min(100, Math.round((loaded / total) * 100));
          sendingText.textContent = `Uploading ${plan.name} · ${percent}% (${formatBytes(loaded)} / ${formatBytes(total)})`;
          setStatus(`Uploading ${percent}%`);
        },
      );
      if (response.visitorToken) store()?.setItem(TOKEN_KEY, response.visitorToken);
      const answer = response.answer;
      if (response.ok) {
        accepted = readDelivery(answer, "");
        serverUsed = usedFromRemaining(answer?.remaining);
      } else if (response.status === 429) {
        failed = true;
        serverUsed = usedFromRemaining(answer?.remaining) ?? DAILY_LIMIT;
        note = "Your daily limit is used up. The server refused this upload.";
      } else {
        // The server answered and refused: show ITS reason, never an internal
        // payload dump. A 400 here means the request itself was rejected --
        // nothing was processed, and the user can fix or retry.
        failed = true;
        note = answer?.error
          ? `The server refused this upload (${response.status}): ${answer.error}`
          : `The server refused this upload (${response.status}). Nothing was processed.`;
      }
    } catch (error) {
      failed = true;
      note = error?.name === "TimeoutError"
        ? "The upload took too long and was stopped. Check the connection and try again."
        : "The upload could not reach the server. Check the connection and try again.";
    }
    const state = readQuota(store(), visitorToken());
    // A daily slot is only spent when the server actually took the job (or
    // refused it for quota). A failed request must not eat one of the three
    // daily uploads.
    used = serverUsed ?? (failed ? state.used : state.used + 1);
    writeQuota(store(), { ...state, used });
    sendingRow.hidden = true;
    notice.hidden = true;
    // Successful jobs use the delivery card as the single source of truth.
    // Do not show a contradictory "Submitted" card beside a later "Failed" state.
    sent.hidden = Boolean(accepted);
    sent.classList.toggle("is-failed", failed);
    sentTitle.textContent = failed ? "Not submitted" : "Submitted";
    if (sentIcon) sentIcon.setAttribute("href", failed ? "#i-alert-triangle" : "#i-circle-check");
    sentNote.textContent = failed
      ? note
      : note || "The file was accepted. It will be processed and the download appears below.";
    sentRetry.hidden = !failed;
    paintDelivery(accepted);
    setStatus(failed ? "Not submitted" : accepted ? stateLabel(accepted.state) : "Submitted");
    sending = false;
    if (accepted && accepted.submitId && !isTerminal(accepted.state)) {
      const signal = abortSignal;
      const settled = await pollDelivery(accepted.submitId, {
        signal,
        onUpdate: (update) => { if (!signal.aborted) paintDelivery(update); },
      });
      if (!signal.aborted) paintDelivery(settled);
    }
  }
  select.addEventListener("change", () => {
    choice = select.value === "manual" ? "manual" : "default";
    paintRoute();
  });
  if (outputSelect) {
    outputSelect.addEventListener("change", () => {
      outputFormat = ["txt", "docx", "pdf"].includes(outputSelect.value) ? outputSelect.value : "";
      paintOutputRequired();
    });
  }
  submit.addEventListener("click", () => send(gate === "choose-docx"));
  if (sentRetry) sentRetry.addEventListener("click", () => { if (plan && !sending) send(lastConfirmed); });
  document
    .querySelectorAll("[data-up-confirm]")
    .forEach((button) => button.addEventListener("click", () => send(true)));
  drop.addEventListener("dragover", (event) => {
    event.preventDefault();
    drop.classList.add("is-over");
  });
  drop.addEventListener("dragleave", (event) => {
    event.preventDefault();
    drop.classList.remove("is-over");
  });
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    drop.classList.remove("is-over");
    const [file] = event.dataTransfer.files;
    if (file) take(file);
  });
  input.addEventListener("change", (event) => {
    const [file] = event.target.files;
    if (file) take(file);
  });
  document.querySelectorAll("[data-up-reset]").forEach((button) => button.addEventListener("click", reset));
  window.addEventListener("akkhara:upload-flow", (event) => {
    flow = event.detail === "analysis" ? "analysis" : "conversion";
    paintFlow();
    reset();
  });
  
  window.addEventListener("akkhara:upload-focus", () => {
    used = readQuota(store(), visitorToken()).used;
    if (!plan) reset();
    else paintQuota();
  });
  paintFlow();
  used = readQuota(store(), visitorToken()).used;
  paintQuota();
  csrfToken()
    .then((session) => {
      paintQuota();
    })
    .catch(() => {});
}