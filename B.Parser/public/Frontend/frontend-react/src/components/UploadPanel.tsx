import React, { useEffect, useRef, useState } from "react";
import {
  Upload,
  FileCheck,
  ScanText,
  AlertTriangle,
  Download,
  FileText,
  RefreshCw,
  CheckCircle2,
  Ban,
} from "lucide-react";
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
  type DocxChoice,
  type Flow,
  type OutputFormat,
  type Gate,
  type SubmitMetadata,
  type UploadPlan,
} from "../lib/upload";
import {
  isTerminal,
  pollDelivery,
  readDelivery,
  stateLabel,
  type Delivery,
} from "../lib/delivery";
import OcrArt from "./art/OcrArt";

interface UploadPanelProps {
  initialFlow?: Flow;
}

type Phase = "idle" | "checking" | "ready" | "sending" | "sent" | "error";

const CSRF_TIMEOUT_MS = 8000;
// A file POST is not a small JSON GET: a 7 MB scan on a slow connection needs
// minutes, not seconds. Give the upload room proportional to its size.
const uploadTimeoutMs = (bytes: number) => Math.min(3_600_000, 60_000 + bytes * 0.08);
const TOKEN_KEY = "akkhara:visitor";
const OUTPUT_OPTIONS: Array<{ value: OutputFormat; label: string; detail: string }> = [
  { value: "txt", label: "TXT", detail: "plain Unicode text" },
  { value: "docx", label: "DOCX", detail: "editable Word document" },
  { value: "pdf", label: "PDF", detail: "print-ready document" },
];

const storage = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

const visitorToken = () => storage()?.getItem(TOKEN_KEY) || "anon";

async function csrfToken(): Promise<{ csrfToken: string; quotaBypass: boolean }> {
  const response = await fetch("/csrf-token", {
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(CSRF_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`CSRF endpoint answered ${response.status}`);
  const body = (await response.json()) as { csrfToken?: string; quotaBypass?: boolean };
  if (!body.csrfToken) throw new Error("CSRF endpoint returned no token");
  return { csrfToken: body.csrfToken, quotaBypass: body.quotaBypass === true };
}

type UploadResponse = {
  ok: boolean;
  status: number;
  answer: Record<string, unknown>;
  visitorToken: string | null;
};

function postUpload(
  body: FormData,
  csrf: string,
  timeout: number,
  onProgress: (loaded: number, total: number) => void,
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/submit");
    xhr.withCredentials = true;
    xhr.timeout = timeout;
    xhr.setRequestHeader("x-csrf-token", csrf);
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    });
    xhr.addEventListener("load", () => {
      let answer: Record<string, unknown> = {};
      try { answer = JSON.parse(xhr.responseText || "{}") as Record<string, unknown>; } catch { /* non-JSON refusal */ }
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        answer,
        visitorToken: xhr.getResponseHeader("X-Visitor-Token"),
      });
    });
    xhr.addEventListener("timeout", () => reject(new DOMException("Upload timed out", "TimeoutError")));
    xhr.addEventListener("error", () => reject(new TypeError("Network upload failed")));
    xhr.send(body);
  });
}

export const UploadPanel: React.FC<UploadPanelProps> = ({ initialFlow = "conversion" }) => {
  const [flow, setFlow] = useState<Flow>(initialFlow);
  const [phase, setPhase] = useState<Phase>("idle");
  const [plan, setPlan] = useState<UploadPlan | null>(null);
  const [gate, setGate] = useState<Gate>("none");
  const [choice, setChoice] = useState<DocxChoice>("default");
  const [outputFormat, setOutputFormat] = useState<OutputFormat | null>(null);
  const [message, setMessage] = useState("");
  const [sentNote, setSentNote] = useState("");
  const [sentFailed, setSentFailed] = useState(false);
  const [isDragOver, setDragOver] = useState(false);
  const [used, setUsed] = useState(0);
  const [quotaBypassed, setQuotaBypassed] = useState(false);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ loaded: number; total: number } | null>(null);
  const abortRef = useRef<{ aborted: boolean }>({ aborted: false });
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<File | null>(null);
  const lastConfirmedRef = useRef(false);
  
  
  
  const sendingRef = useRef(false);
  const resetRef = useRef<(() => void) | null>(null);

  
  useEffect(() => {
    const refresh = () => setUsed(readQuota(storage(), visitorToken()).used);
    refresh();
    csrfToken().then((session) => setQuotaBypassed(session.quotaBypass)).catch(() => {});
    window.addEventListener("akkhara:upload-focus", refresh);
    return () => window.removeEventListener("akkhara:upload-focus", refresh);
  }, []);
  
  useEffect(() => {
    const onFlow = (event: Event) => {
      const next = (event as CustomEvent<Flow>).detail;
      setFlow(next === "analysis" ? "analysis" : "conversion");
      resetRef.current?.();
    };
    window.addEventListener("akkhara:upload-flow", onFlow);
    return () => window.removeEventListener("akkhara:upload-flow", onFlow);
  }, []);

  const remaining = Math.max(0, DAILY_LIMIT - used);
  const analysis = flow === "analysis";

  const reset = () => {
    setPhase("idle");
    setPlan(null);
    setGate("none");
    setChoice("default");
    setOutputFormat(null);
    setMessage("");
    setSentNote("");
    setSentFailed(false);
    setDelivery(null);
    setUploadProgress(null);
    abortRef.current.aborted = true;
    abortRef.current = { aborted: false };
    fileRef.current = null;
    sendingRef.current = false;
    if (inputRef.current) inputRef.current.value = "";
  };

  /** A rejected file must leave the widget exactly as it was before the
      pick: no plan (the invalid file's name must not linger in the chrome),
      no fileRef, no stale input value (or re-choosing the SAME file would not
      fire a change event and the widget would look stuck). No reload needed. */
  const rejectFile = (notice: string) => {
    fileRef.current = null;
    if (inputRef.current) inputRef.current.value = "";
    setPlan(null);
    setGate("none");
    setMessage(notice);
    setPhase("error");
  };

  const take = async (file: File) => {
    fileRef.current = file;
    setPhase("checking");
    setMessage("");
    setSentNote("");
    setSentFailed(false);
    try {
      const next = await inspectUpload(file, flow);
      if (next.kind === "unsupported") {
        rejectFile(next.notice);
        return;
      }
      setPlan(next);
      setGate(gateFor(next, flow));
      setChoice("default");
      setOutputFormat(null);
      setPhase("ready");
    } catch (error) {
      rejectFile(error instanceof Error ? error.message : "The file could not be read.");
    }
  };

  const submit = async (confirmed: boolean) => {
    if (!plan || sendingRef.current) return;
    if (!outputFormat) {
      setMessage("Choose an output format before submitting.");
      return;
    }
    sendingRef.current = true;
    lastConfirmedRef.current = confirmed;
    const file = fileRef.current;
    const payload: SubmitMetadata = buildPayload({ plan, flow, choice, confirmed, outputFormat });
    setUploadProgress(null);
    setPhase("sending");
    let accepted: Delivery | null = null;
    let serverUsed: number | null = null;
    let failed = false;
    let note = "";

    try {
      const body = new FormData();

      if (file) body.append("file", file, payload.uploadName);
      body.append("metadata", JSON.stringify(payload));
      const csrf = await csrfToken();
      setQuotaBypassed(csrf.quotaBypass);
      const response = await postUpload(
        body,
        csrf.csrfToken,
        uploadTimeoutMs(file?.size ?? 0),
        (loaded, total) => setUploadProgress({ loaded, total }),
      );

      if (response.visitorToken) storage()?.setItem(TOKEN_KEY, response.visitorToken);
      const answer = response.answer;

      if (response.ok) {
        accepted = readDelivery(answer, "");
        serverUsed = usedFromRemaining(answer.remaining);
        note = "";
      } else if (response.status === 429) {
        failed = true;
        serverUsed = usedFromRemaining(answer.remaining) ?? DAILY_LIMIT;
        note = "Your daily limit is used up. The server refused this upload.";
      } else {
        // The server answered and refused: show ITS reason, never an internal
        // payload dump. A 400 here means the request itself was rejected --
        // nothing was processed, and the user can fix or retry.
        failed = true;
        note = typeof answer.error === "string"
          ? `The server refused this upload (${response.status}): ${answer.error}`
          : `The server refused this upload (${response.status}). Nothing was processed.`;
      }
    } catch (error) {
      failed = true;
      note =
        (error as DOMException)?.name === "TimeoutError"
          ? "The upload took too long and was stopped. Check the connection and try again."
          : "The upload could not reach the server. Check the connection and try again.";
    }

    // A daily slot is only spent when the server actually took the job (or
    // refused it for quota). A failed request must not eat one of the three
    // daily uploads.
    const state = readQuota(storage(), visitorToken());
    const next = { ...state, used: serverUsed ?? (failed ? state.used : state.used + 1) };
    writeQuota(storage(), next);
    setUsed(next.used);

    setMessage("");
    setSentNote(failed ? note : note || "The file was accepted. It will be processed and the download appears below.");
    setSentFailed(failed);
    setDelivery(accepted);
    setPhase("sent");
    sendingRef.current = false;

    if (accepted && accepted.submitId && !isTerminal(accepted.state)) {
      const signal = abortRef.current;
      const settled = await pollDelivery(accepted.submitId, {
        signal,
        onUpdate: (update) => {
          if (!signal.aborted) setDelivery(update);
        },
      });
      if (!signal.aborted) setDelivery(settled);
    }
  };

  resetRef.current = reset;

  const preview = plan ? route(plan, flow, choice) : null;

  const chip = (label: string, tone: "ocr" | "praser" | "skip") => (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono2 text-[10px] font-bold uppercase tracking-wider ${
        tone === "ocr"
          ? "bg-indigo-50 text-indigo-700"
          : tone === "skip"
            ? "bg-slate-100 text-slate-600"
            : "bg-emerald-50 text-emerald-700"
      }`}
    >
      {label}
    </span>
  );

  const methodChip = () => {
    if (!preview) return null;
    const tone = preview.job === "ocr" ? "ocr" : preview.method === "default" ? "skip" : "praser";
    return chip(`${preview.job} · ${preview.method}`, tone);
  };

  const blocked = !quotaBypassed && remaining <= 0;
  const uploadPercent = uploadProgress?.total
    ? Math.min(100, Math.round((uploadProgress.loaded / uploadProgress.total) * 100))
    : null;

  const statusText =
    phase === "checking"
      ? "Checking a page sample…"
      : phase === "sending"
        ? uploadPercent === null ? "Preparing upload…" : `Uploading ${uploadPercent}%`
        : phase === "sent"
          ? sentFailed
            ? "Not submitted"
            : delivery
              ? stateLabel(delivery.state)
              : "Submitted"
          : quotaBypassed
            ? "Corpus builder · no quota"
            : blocked
              ? "Daily limit reached"
              : `${remaining} of ${DAILY_LIMIT} left today`;

  return (
    <aside className="lp-upload" id="upload" aria-label={analysis ? "grammar analysis / upload" : "upload / extraction path"}>
      <div className="lp-upload-chrome">
        <svg className="lp-live" viewBox="0 0 14 14" aria-hidden="true">
          <circle className="lp-live-halo" cx="7" cy="7" r="3.25" />
          <circle className="lp-live-dot" cx="7" cy="7" r="3.25" />
        </svg>
        <span className="lp-upload-file font-mono2">
          {plan ? `${plan.name} · ${formatBytes(plan.size)}` : `${flow} · pdf / docx`}
        </span>
        <span className="ts-status">
          <i />
          {statusText}
        </span>
      </div>

      <div className="lp-upload-body">
        <h2 className="lp-upload-title">
          {analysis ? "Upload a document to analyse" : "Upload a PDF or DOCX"}
        </h2>
        <p className="lp-upload-sub mm">
          {analysis
            ? "The file is checked in your browser first. If the Burmese is not readable, you are asked before anything is analysed."
            : "Your file is checked in the browser first, and that check decides which method to use."}
        </p>
      {blocked && phase !== "sent" && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs leading-relaxed text-rose-900">
          <Ban className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            You have used all {DAILY_LIMIT} uploads for today. The allowance resets at 00:00 UTC —
            06:30 in Myanmar.
          </span>
        </div>
      )}

      {(phase === "idle" || phase === "checking" || phase === "error") && (
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (blocked) return;
            const file = e.dataTransfer.files?.[0];
            if (file) take(file);
          }}
          className={`flex min-h-[260px] flex-col items-center justify-center rounded-2xl border-2 border-dashed bg-white p-8 text-center transition ${
            blocked
              ? "cursor-not-allowed border-slate-200 opacity-60"
              : isDragOver
                ? "cursor-pointer border-indigo-500 bg-indigo-50/40"
                : "cursor-pointer border-slate-300/80 hover:border-slate-400"
          }`}
        >
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-500">
            {phase === "checking" ? (
              <RefreshCw className="h-6 w-6 animate-spin text-indigo-600" />
            ) : (
              <Upload className="h-6 w-6" />
            )}
          </span>
          <h4 className="mt-4 text-sm font-bold text-slate-900">
            {phase === "checking"
              ? "Checking the file…"
              : "Drop a PDF or DOCX here, or click to choose"}
          </h4>
          <p className="mm mt-2 max-w-md text-xs leading-relaxed text-slate-600">
            PDF၊ Word နဲ့ scan ဖတ်ထားတဲ့ ဖိုင် အားလုံး လက်ခံပါတယ်။ ဖိုင်ကို ကိုယ့်စက်ထဲမှာပဲ စစ်ပြီး လိုအပ်တဲ့ နည်းလမ်းကို အလိုအလျောက် ရွေးပေးပါတယ်။
          </p>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            disabled={blocked}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) take(file);
            }}
          />
          {phase === "error" && message && (
            <p className="mt-4 inline-flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
              <AlertTriangle className="h-4 w-4" /> {message}
            </p>
          )}
        </label>
      )}

      {plan && (phase === "ready" || phase === "sending" || phase === "sent") && (
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2 text-sm font-bold text-slate-900">
                {plan.kind === "pdf-scan" ? (
                  <ScanText className="h-4 w-4 shrink-0 text-indigo-600" />
                ) : (
                  <FileCheck className="h-4 w-4 shrink-0 text-emerald-600" />
                )}
                <span className="truncate">{plan.name}</span>
              </span>
              {methodChip()}
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-2 font-mono2 text-[11px] text-slate-600 sm:grid-cols-4">
              <div>
                <dt className="text-slate-400">size</dt>
                <dd>{formatBytes(plan.size)}</dd>
              </div>
              {plan.inputFormat === "pdf" ? (
                <>
                  <div>
                    <dt className="text-slate-400">pages</dt>
                    <dd>
                      {plan.detector.sampledPages
                        ? `${plan.detector.sampledTextPages}/${plan.detector.sampledPages} sampled · ${plan.detector.pages} total`
                        : `${plan.detector.textPages}/${plan.detector.pages} text`}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">mm letters</dt>
                    <dd>{plan.detector.myanmarLetters}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">layer</dt>
                    <dd>{plan.kind === "pdf-text" ? "text" : "image only"}</dd>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <dt className="text-slate-400">image bytes</dt>
                    <dd>{formatBytes(plan.detector.imageBytes)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">text bytes</dt>
                    <dd>{formatBytes(plan.detector.textBytes)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">ratio</dt>
                    <dd>
                      {plan.detector.textBytes
                        ? (plan.detector.imageBytes / plan.detector.textBytes).toFixed(1)
                        : "∞"}
                      × / {DOCX_IMAGE_DOMINANCE}×
                    </dd>
                  </div>
                </>
              )}
            </dl>
          </div>

          {phase === "ready" && (
            <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-700">
                  Choose output format <span className="text-rose-600">*</span>
                </span>
                <span className="mm text-[11px] text-slate-500">မပို့ခင် မဖြစ်မနေ ရွေးပါ</span>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {OUTPUT_OPTIONS.map((option) => {
                  const selected = outputFormat === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setOutputFormat(option.value);
                        setMessage("");
                      }}
                      className={`rounded-xl border px-3 py-2 text-left transition ${
                        selected
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 bg-slate-50 text-slate-800 hover:border-slate-400"
                      }`}
                    >
                      <span className="block text-xs font-black tracking-wide">{option.label}</span>
                      <span className={`block text-[11px] ${selected ? "text-slate-200" : "text-slate-500"}`}>
                        {option.detail}
                      </span>
                    </button>
                  );
                })}
              </div>
              {!outputFormat && (
                <p className="mt-2 text-[11px] font-semibold text-rose-700">
                  Select TXT, DOCX, or PDF before the upload can start.
                </p>
              )}
              {message && (
                <p className="mt-2 text-[11px] font-semibold text-rose-700">{message}</p>
              )}
            </div>
          )}

          {/* the Zawgyi prompt — analysis only, and "no" cancels */}
          {gate === "confirm-zawgyi" && phase === "ready" && (
            <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs leading-relaxed text-amber-900">
              <span className="flex items-start gap-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {NOTICE.zawgyi}
                  <span className="mm mt-1.5 block">{NOTICE.zawgyiMm}</span>
                </span>
              </span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => submit(true)}
                  disabled={blocked || !outputFormat}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-60"
                >
                  Yes — convert it first
                </button>
                <button
                  type="button"
                  onClick={reset}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700"
                >
                  No — cancel
                </button>
              </div>
            </div>
          )}

          {/* the OCR prompt — analysis only, no dropdown here by design */}
          {gate === "confirm-ocr" && phase === "ready" && (
            <div className="flex flex-col gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3.5 text-xs leading-relaxed text-indigo-900">
              <span className="flex items-start gap-2.5">
                <ScanText className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{plan.inputFormat === "pdf" ? NOTICE.ocrPdf : NOTICE.ocrDocx}</span>
              </span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => submit(true)}
                  disabled={blocked || !outputFormat}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-60"
                >
                  Yes — run OCR first
                </button>
                <button
                  type="button"
                  onClick={reset}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700"
                >
                  No — cancel
                </button>
              </div>
            </div>
          )}

          {gate === "none" && (
            <div
              className={`flex items-start gap-2.5 rounded-xl border p-3.5 text-xs leading-relaxed ${
                plan.kind === "pdf-scan"
                  ? "border-indigo-100 bg-indigo-50/70 text-indigo-900"
                  : "border-emerald-100 bg-emerald-50/70 text-emerald-900"
              }`}
            >
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="mm">{plan.notice}</span>
            </div>
          )}

          {/* the dropdown — conversion flow, image-heavy DOCX only */}
          {gate === "choose-docx" && (
            <>
              <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs leading-relaxed text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="mm">{plan.notice}</span>
              </div>
              <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3.5 sm:flex-row sm:items-center sm:justify-between">
                <label htmlFor="uploadEngine" className="mm text-xs font-semibold text-slate-700">
                  ဒီ DOCX ကို ဘယ်နည်းလမ်းနဲ့ ပြောင်းမလဲ ရွေးပါ
                </label>
                <select
                  id="uploadEngine"
                  value={choice}
                  onChange={(e) => setChoice(e.target.value as DocxChoice)}
                  disabled={phase !== "ready"}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800"
                >
                  <option value="default">Default — convert the text, skip pictures</option>
                  <option value="manual">Auto — OCR the picture pages, convert the rest</option>
                </select>
              </div>
            </>
          )}

          {/* The browser finished reading the file: name it, and offer submit.
              Clicking swaps the whole row for the loading state, so there is
              no button left to press twice. */}
          {phase === "ready" && gate !== "confirm-zawgyi" && gate !== "confirm-ocr" && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex min-w-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700">
                <FileText className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                <span className="truncate max-w-[220px]">{plan.name}</span>
              </span>
              <button
                type="button"
                onClick={() => submit(gate === "choose-docx")}
                disabled={blocked || !outputFormat}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-60"
              >
                <Upload className="h-3.5 w-3.5" />
                Process
              </button>
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700"
              >
                Choose another file
              </button>
            </div>
          )}

          {phase === "sending" && (
            <div className="up-sending-box">
              <div className="up-working-art">
                <OcrArt />
              </div>
              <p className="up-working-txt">
                <RefreshCw className="h-3.5 w-3.5 animate-spin text-indigo-600" />
                {uploadProgress
                  ? `Uploading ${plan.name} · ${uploadPercent}% (${formatBytes(uploadProgress.loaded)} / ${formatBytes(uploadProgress.total)})`
                  : `Preparing ${plan.name}…`}
              </p>
            </div>
          )}

          {phase === "sent" && delivery && (
            <div
              className={`rounded-2xl border p-4 ${
                delivery.state === "FINISHED"
                  ? "border-emerald-200 bg-emerald-50/60"
                  : delivery.state === "FAILED" || delivery.error
                    ? "border-rose-200 bg-rose-50/60"
                    : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-xs font-bold text-slate-900">
                  {delivery.state === "FINISHED" ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : delivery.state === "FAILED" || delivery.error ? (
                    <AlertTriangle className="h-4 w-4 text-rose-600" />
                  ) : (
                    <RefreshCw className="h-4 w-4 animate-spin text-indigo-600" />
                  )}
                  {stateLabel(delivery.state)}
                </span>
                {delivery.state === "FINISHED" && delivery.downloadUrl && (
                  <a
                    href={delivery.downloadUrl}
                    download={delivery.finalFilename ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-white"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download{delivery.finalFilename ? ` ${delivery.finalFilename}` : ""}
                    {delivery.finalBytes ? ` · ${formatBytes(delivery.finalBytes)}` : ""}
                  </a>
                )}
              </div>
              {delivery.error && (
                <p className="mt-2 text-[11px] leading-relaxed text-rose-700">{delivery.error}</p>
              )}
            </div>
          )}

          {phase === "sent" && !delivery && (
            <div
              className={`rounded-2xl border p-4 ${
                sentFailed ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                {sentFailed ? (
                  <AlertTriangle className="h-4 w-4 text-rose-600" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                )}
                {sentFailed ? "Not submitted" : "Submitted"}
              </div>
              <p
                className={`mt-1 text-[11px] leading-relaxed ${
                  sentFailed ? "text-rose-700" : "text-slate-500"
                }`}
              >
                {sentNote}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {sentFailed && (
                  <button
                    type="button"
                    onClick={() => submit(lastConfirmedRef.current)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-white"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Try again
                  </button>
                )}
                <button
                  type="button"
                  onClick={reset}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700"
                >
                  Upload another file
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      </div>
    </aside>
  );
};
