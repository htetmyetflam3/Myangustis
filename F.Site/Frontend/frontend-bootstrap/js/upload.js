import {
  detect,
  DOCX_IMAGE_DOMINANCE,
  PDF_TEXT_MIN_CHARS,
  PDF_IMAGE_DOMINANCE,
  PDF_TEXT_BYTES_PER_PAGE,
} from "./detect.js";
export const OUTPUT_FORMATS = ["txt", "docx", "pdf"];
export const MAX_OCR_PAGES = 50;
// Must match PRASER_MAX_PAGES in the deployed server configuration. Rejecting
// locally prevents a multi-minute upload that the parser is guaranteed to refuse.
export const MAX_PARSER_PAGES = 300000;
import { probeScript } from "./script.js";
export { DOCX_IMAGE_DOMINANCE, PDF_TEXT_MIN_CHARS };
export const NOTICE = {
  pdfText: "စာပြောင်းလို့ရတဲ့ font ပါပါတယ် — တိုက်ရိုက် ပြောင်းပေးပါမယ်။",
  pdfScan:
    "စာပြောင်းလို့ရတဲ့ font မပါပါဘူး — စာမျက်နှာတွေက scan ပုံတွေပါ။ OCR နည်းလမ်းနဲ့ ပုံကနေ စာအဖြစ် ပြောင်းပါမယ်။",
  docxText: "စာပြောင်းလို့ရတဲ့ font ပါတဲ့ DOCX ပါ — တိုက်ရိုက် ပြောင်းပေးပါမယ်။",
  docxImages:
    "DOCX ထဲမှာ ပုံတွေ ပါနေပါတယ်။ font ပါတဲ့ စာကိုပဲ ပြောင်းပေးမှာမို့ ပုံနေရာတွေမှာ ကွက်လပ် ဖြစ်နေပါမယ်။ ပုံထဲက စာကိုပါ လိုချင်ရင် အောက်က dropdown မှာ OCR နည်းလမ်းကို ရွေးပါ။",
  unsupported: "PDF ဒါမှမဟုတ် DOCX ဖိုင်ပဲ လက်ခံပါတယ်။",
  tooManyScanPages:
    "ဒီ scan PDF မှာ စာမျက်နှာ {pages} ရှိပါတယ်။ OCR က တစ်ကြိမ်ကို {max} မျက်နှာအထိပဲ လက်ခံလို့ ခွဲပြီး တင်ပေးပါ။",
  tooManyPages:
    "This PDF has {pages} pages, but the server accepts at most {max} pages per file. Split it into smaller files before uploading.",
  zawgyi:
    "This document is written in the Zawgyi font. AKKHARA converts it to Unicode automatically — there is nothing you need to do first.",
  zawgyiMm:
    "စာပြောင်းလို့ရပေမယ့် zawgyi font ဖြစ်နေပါတယ်။ ယူနီကုဒ်အဖြစ် အလိုအလျောက် ပြောင်းပေးပါ့မယ်။",
  ocrPdf:
    "These pages are pictures, not text — there is no font to convert from. OCR can turn them into text.",
  ocrDocx:
    "The text here sits inside the pictures, so converting the text alone comes back blank. OCR can turn those pictures into text.",
};
const emptyDetector = () => ({
  name: "pdf.js",
  pages: 0,
  textPages: 0,
  imagePages: 0,
  myanmarChars: 0,
  myanmarLetters: 0,
  imageBytes: 0,
  textBytes: 0,
  confirmed: false,
});
export async function inspectUpload(file, flow = "conversion") {
  const base = {
    name: file.name,
    size: file.size,
    kind: "unsupported",
    inputFormat: "",
    readable: false,
    script: probeScript(""),
    detection: null,
    detector: emptyDetector(),
    gate: "none",
    notice: NOTICE.unsupported,
    text: "",
  };
  const detection = await detect(file);
  if (!detection) return base;
  if (detection.inputFormat === "pdf" && detection.pages > MAX_PARSER_PAGES) {
    return {
      ...base,
      inputFormat: "pdf",
      detection,
      detector: {
        ...base.detector,
        pages: detection.pages,
        sampledPages: detection.sampledPages,
        sampledTextPages: detection.sampledTextPages,
        sampledImagePages: detection.sampledImagePages,
      },
      notice: NOTICE.tooManyPages
        .replace("{pages}", String(detection.pages))
        .replace("{max}", String(MAX_PARSER_PAGES)),
    };
  }
  const script = probeScript(detection.text);
  const detector = {
    name: detection.parser,
    pages: detection.pages,
    textPages: detection.textPages,
    imagePages: detection.imagePages,
    ...(detection.sampledPages
      ? {
          sampledPages: detection.sampledPages,
          sampledTextPages: detection.sampledTextPages,
          sampledImagePages: detection.sampledImagePages,
        }
      : {}),
    myanmarChars: script.myanmarChars,
    myanmarLetters: script.myanmarLetters,
    imageBytes: detection.imageBytes,
    textBytes: detection.textBytes,
    confirmed: false,
  };
  const common = {
    ...base,
    inputFormat: detection.inputFormat,
    readable: script.readable,
    script,
    detection,
    detector,
    text: detection.text,
  };
  if (detection.inputFormat === "pdf") {
    const perPage = detection.pages > 0 ? detection.textBytes / detection.pages : detection.textBytes;
    const imageDominant =
      detection.imageBytes > detection.textBytes * PDF_IMAGE_DOMINANCE &&
      perPage < PDF_TEXT_BYTES_PER_PAGE;
    const textBased =
      !imageDominant && detection.text.replace(/\s/g, "").length >= PDF_TEXT_MIN_CHARS;
    if (textBased) {
      /* A text layer AND substantial image bytes. The scanned-novel case:
         the text layer exists but may be noise from the scanning tool,
         while the real content sits in the page images. Only the user can
         say whether the images are worth reading, so it gets the same
         prompt an image-heavy DOCX gets. */
      if (detection.imageBytes > detection.textBytes) {
        return { ...common, kind: "pdf-images", gate: "choose-docx", notice: NOTICE.pdfText };
      }
      return { ...common, kind: "pdf-text", gate: "none", notice: NOTICE.pdfText };
    }
    if (detection.pages > MAX_OCR_PAGES) {
      return {
        ...common,
        kind: "unsupported",
        gate: "none",
        notice: NOTICE.tooManyScanPages
          .replace("{pages}", String(detection.pages))
          .replace("{max}", String(MAX_OCR_PAGES)),
      };
    }
    return {
      ...common,
      kind: "pdf-scan",
      gate: flow === "analysis" ? "confirm-ocr" : "none",
      notice: NOTICE.pdfScan,
    };
  }
  const imageHeavy =
    detection.imageBytes > 0 && detection.imageBytes > detection.textBytes * DOCX_IMAGE_DOMINANCE;
  if (imageHeavy) {
    return {
      ...common,
      kind: "docx-images",
      gate: "choose-docx",
      notice: NOTICE.docxImages,
    };
  }
  return {
    ...common,
    kind: "docx-text",
    gate: flow === "analysis" && !script.readable ? "confirm-zawgyi" : "none",
    notice: NOTICE.docxText,
  };
}

export function gateFor(plan, flow) {
  if (plan.kind === "unsupported") return "none";
  if (flow === "conversion") return ["docx-images", "pdf-images"].includes(plan.kind) ? "choose-docx" : "none";
  if (["pdf-scan", "docx-images", "pdf-images"].includes(plan.kind)) return "confirm-ocr";
  return plan.readable ? "none" : "confirm-zawgyi";
}

/* The mode is a statement about the OUTPUT, not about the file:

     txt out        images cannot be carried -> default (boxes skipped)
     docx|pdf out   images can be carried    -> manual  (boxes re-embedded)

   `plan.readable` is deliberately NOT consulted here. Readability is the
   second source's question -- it is what the backend's code-page recovery
   exists to answer. Using it to pick the mode made "the text layer was
   garbled" mean "re-embed the images", which are unrelated facts. */
export function route(plan, flow, choice = "default", outputFormat = "txt") {
  void flow;
  const method = outputFormat === "txt" ? "default" : "manual";
  if (plan.kind === "pdf-scan") return { content: "image", job: "ocr", method };
  /* An image-heavy DOCX is the only case with a real choice, and only the
     user can make it: the text layer is fine, but the image boxes may hold
     more text. Saying yes makes it mixed, which sends the boxes to the
     second worker group. Saying no treats it as a plain text document. */
  if ((plan.kind === "docx-images" || plan.kind === "pdf-images") && choice === "manual") {
    return { content: "mixed", job: "null", method };
  }
  return { content: "text", job: "extracting", method };
}
export function buildPayload({
  plan,
  flow,
  choice = "default",
  confirmed = false,
  outputFormat,
  at = new Date(),
}) {
  if (!OUTPUT_FORMATS.includes(outputFormat)) {
    throw new Error("outputFormat is required");
  }
  const inputFormat = plan.inputFormat || "pdf";
  const desired = outputFormat;
  const { content, job: handling, method: mode } = route(plan, flow, choice, outputFormat);
  const analysis = flow === "analysis";
  return {
    v: 1,
    source: analysis ? "analysis" : "converter",
    content,
    /* One label per column, and only that one:
         converter   job = handling, method = mode
         analysis    method = handling, task = mode
       Sending the other column's labels is rejected by the server. */
    ...(analysis
      ? { method: handling, task: mode }
      : { job: handling, method: mode }),
    originalName: plan.name,
    uploadName: normalizeName(plan.name, inputFormat, at),
    clickedAt: isoSeconds(at),
    fileFormat: inputFormat,
    conversion: desired,
    desired,
    detector: { ...plan.detector, confirmed },
  };
}
export function demoPayload(originalName = "sample.pdf") {
  return {
    v: 1,
    source: "converter",
    originalName,
    uploadName: originalName,
    fileFormat: "pdf",
    conversion: "txt",
    desired: "txt",
  };
}
export function isoSeconds(at) {
  return `${at.toISOString().slice(0, 19)}Z`;
}

export function normalizeName(originalName, inputFormat, at) {
  const stamp = at.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const base = String(originalName ?? "").normalize("NFC").replace(/\.[^.]*$/, "");
  let safe = base
    .replace(/[\\/]+/g, " ")
    .replace(/[\u0000-\u001F\u007F<>:"|?*]/g, "")
    // The upload name is a protocol token the server validates as
    // /^\d{8}T\d{6}Z__[a-zA-Z0-9._-]+\.(pdf|docx)$/ -- a Burmese original
    // name ("ဘဝထိုထို-part_1") must not survive into it or the server
    // refuses the whole upload as invalid multipart. The user's real name
    // travels in metadata.originalName instead.
    .replace(/[^a-zA-Z0-9._\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  const chars = Array.from(safe);
  if (chars.length > 60) safe = chars.slice(0, 60).join("").replace(/[-.]+$/, "");
  if (!safe) safe = "file";
  return `${stamp}__${safe}.${inputFormat}`.normalize("NFC");
}

export const DAILY_LIMIT = 3;
export const QUOTA_KEY = "akkhara:quota";
export const utcDay = (at = new Date()) => at.toISOString().slice(0, 10);
export function readQuota(storage, token, at = new Date()) {
  const day = utcDay(at);
  const fresh = { token, day, used: 0 };
  if (!storage) return fresh;
  try {
    const raw = storage.getItem(QUOTA_KEY);
    if (!raw) return fresh;
    const saved = JSON.parse(raw);
    if (saved.token !== token || saved.day !== day) return fresh;
    return { token, day, used: Number(saved.used) || 0 };
  } catch {
    return fresh;
  }
}
export function writeQuota(storage, state) {
  try {
    if (storage) storage.setItem(QUOTA_KEY, JSON.stringify(state));
  } catch {
  }
}

export function usedFromRemaining(remaining) {
  if (typeof remaining !== "number" || !Number.isFinite(remaining)) return null;
  if (remaining >= DAILY_LIMIT) return 0;
  return Math.max(0, Math.min(DAILY_LIMIT, DAILY_LIMIT - remaining));
}
export const remainingOf = (state) => Math.max(0, DAILY_LIMIT - state.used);
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}