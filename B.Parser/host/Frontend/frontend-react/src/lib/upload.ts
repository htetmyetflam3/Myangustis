import {
  detect,
  DOCX_IMAGE_DOMINANCE,
  PDF_TEXT_MIN_CHARS,
  PDF_IMAGE_DOMINANCE,
  PDF_TEXT_BYTES_PER_PAGE,
  type Detection,
} from "./detect";
import { probeScript, type ScriptVerdict } from "./script";

export type Content = "text" | "image" | "mixed";
export type Job = "extracting" | "ocr" | "null";
export type Method = "default" | "manual";
export type OutputFormat = "txt" | "docx" | "pdf";
export const OUTPUT_FORMATS: readonly OutputFormat[] = ["txt", "docx", "pdf"];
export const MAX_OCR_PAGES = 50;
// Must match PRASER_MAX_PAGES in the deployed server configuration. This
// avoids uploading a document the parser is guaranteed to reject.
export const MAX_PARSER_PAGES = 300000;

export type Flow = "conversion" | "analysis";


export type Gate =
  | "none"            
  | "choose-docx"     
  | "confirm-zawgyi"  
  | "confirm-ocr";    

export type UploadKind = "pdf-text" | "pdf-scan" | "docx-text" | "docx-images" | "unsupported";

export type DetectorReport = {
  name: "pdf.js" | "mammoth";
  pages: number;
  textPages: number;
  imagePages: number;
  sampledPages?: number;
  sampledTextPages?: number;
  sampledImagePages?: number;
  myanmarChars: number;
  myanmarLetters: number;
  imageBytes: number;
  textBytes: number;
  confirmed: boolean;
};

export type UploadPlan = {
  name: string;
  size: number;
  kind: UploadKind;
  inputFormat: "pdf" | "docx" | "";
  
  readable: boolean;
  script: ScriptVerdict;
  detection: Detection | null;
  detector: DetectorReport;
  gate: Gate;
  notice: string;
  text: string;
};

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
} as const;





const emptyDetector = (): DetectorReport => ({
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

export async function inspectUpload(file: File, flow: Flow = "conversion"): Promise<UploadPlan> {
  const base: UploadPlan = {
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
  const detector: DetectorReport = {
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
      
      gate: flow === "analysis" ? "confirm-ocr" : "choose-docx",
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


export function gateFor(plan: UploadPlan, flow: Flow): Gate {
  if (plan.kind === "unsupported") return "none";
  if (flow === "conversion") return plan.kind === "docx-images" ? "choose-docx" : "none";
  if (plan.kind === "pdf-scan") return "confirm-ocr";
  if (plan.kind === "docx-images") return "choose-docx";
  return plan.readable ? "none" : "confirm-zawgyi";
}





export type SubmitMetadata = {
  v: 1;
  source: "converter" | "analysis";
  content?: Content;
  /* converter column */ job?: Job;
  /* analysis column  */ task?: Job;
  method?: Method;
  originalName: string;
  uploadName: string;
  clickedAt?: string;
  fileFormat: "pdf" | "docx";
  conversion: OutputFormat;
  desired: OutputFormat;
  detector?: DetectorReport;
};


export type DocxChoice = "default" | "manual";

export type BuildArgs = {
  plan: UploadPlan;
  flow: Flow;
  
  choice?: DocxChoice;
  
  confirmed?: boolean;
  
  outputFormat: OutputFormat;
  
  at?: Date;
};
/* The mode is a statement about the OUTPUT, not about the file:
     txt out        images cannot be carried -> default (boxes skipped)
     docx|pdf out   images can be carried    -> manual  (boxes re-embedded)
   `plan.readable` is deliberately NOT consulted: readability is the second
   source's question, and using it to pick the mode made "the text layer was
   garbled" mean "re-embed the images", which are unrelated facts. */
export function route(
  plan: Plan,
  flow: string,
  choice = "default",
  outputFormat: OutputFormat = "txt",
): { content: Content; job: Job; method: Method } {
  void flow;
  const method = (outputFormat === "txt" ? "default" : "manual") as Method;
  if (plan.kind === "pdf-scan") {
    return { content: "image" as Content, job: "ocr" as Job, method };
  }
  /* An image-heavy DOCX is the only case with a real choice, and only the
     user can make it. Yes -> mixed, which sends the boxes to the second
     worker group. No -> treat it as a plain text document. */
  if ((plan.kind === "docx-images" || plan.kind === "pdf-images") && choice === "manual") {
    return { content: "mixed" as Content, job: "null" as Job, method };
  }
  return { content: "text" as Content, job: "extracting" as Job, method };
}
export function buildPayload({
  plan,
  flow,
  choice = "default",
  confirmed = false,
  outputFormat,
  at = new Date(),
}: BuildArgs): SubmitMetadata {
  if (!OUTPUT_FORMATS.includes(outputFormat)) {
    throw new Error("outputFormat is required");
  }
  const inputFormat = (plan.inputFormat || "pdf") as "pdf" | "docx";
  const desired = outputFormat;
  const { content, job: handling, method: mode } = route(plan, flow, choice, outputFormat);
  const analysis = flow === "analysis";
  return {
    v: 1,
    source: flow === "analysis" ? "analysis" : "converter",
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


export function demoPayload(originalName = "sample.pdf"): SubmitMetadata {
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






export function isoSeconds(at: Date): string {
  return `${at.toISOString().slice(0, 19)}Z`;
}


export function normalizeName(originalName: string, inputFormat: "pdf" | "docx", at: Date): string {
  const stamp = at.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const base = String(originalName ?? "").normalize("NFC").replace(/\.[^.]*$/, "");

  let safe = base
    .replace(/[\\/]+/g, " ")
    
    // eslint-disable-next-line no-control-regex
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
export type QuotaState = { token: string; day: string; used: number };

export const utcDay = (at: Date = new Date()) => at.toISOString().slice(0, 10);

type Storagelike = Pick<Storage, "getItem" | "setItem">;

export function readQuota(storage: Storagelike | null, token: string, at: Date = new Date()): QuotaState {
  const day = utcDay(at);
  const fresh: QuotaState = { token, day, used: 0 };
  if (!storage) return fresh;
  try {
    const raw = storage.getItem(QUOTA_KEY);
    if (!raw) return fresh;
    const saved = JSON.parse(raw) as QuotaState;
    
    if (saved.token !== token || saved.day !== day) return fresh;
    return { token, day, used: Number(saved.used) || 0 };
  } catch {
    return fresh;
  }
}

export function writeQuota(storage: Storagelike | null, state: QuotaState): void {
  try {
    storage?.setItem(QUOTA_KEY, JSON.stringify(state));
  } catch {
    /* private mode — the server still enforces the real limit */
  }
}



export function usedFromRemaining(remaining: unknown): number | null {
  if (typeof remaining !== "number" || !Number.isFinite(remaining)) return null;
  if (remaining >= DAILY_LIMIT) return 0;
  return Math.max(0, Math.min(DAILY_LIMIT, DAILY_LIMIT - remaining));
}

export const remainingOf = (state: QuotaState) => Math.max(0, DAILY_LIMIT - state.used);

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
