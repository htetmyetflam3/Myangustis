import React, { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Cpu,
  Download,
  ExternalLink,
  FileCheck,
  RefreshCw,
} from "lucide-react";
import { ToolShell } from "./ToolShell";

interface PdfDemoOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

type DemoResult = {
  generic: string;
  parsed: string;
};

type DemoState = "loading" | "ready" | "error";

const SAMPLE_URL = "/samples/sample.pdf";
const GENERIC_OUTPUT_URL = "/samples/sample-freeconvert.txt";
const PARSED_OUTPUT_URL = "/samples/sample.praser.txt";
const SAMPLE_NAME = "sample.pdf";

const FILE_TIMEOUT_MS = 8000;
const WATCHDOG_MS = 12000;
const SETTLE_MS = 900;

let cachedDemo: Promise<DemoResult> | null = null;

async function textFrom(url: string, timeout = FILE_TIMEOUT_MS) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`Could not load ${url}`);
  return response.text();
}

async function requestDemo(): Promise<DemoResult> {
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

export const PdfDemoOverlay: React.FC<PdfDemoOverlayProps> = ({ isOpen, onClose }) => {
  const [state, setState] = useState<DemoState>("loading");
  const [result, setResult] = useState<DemoResult | null>(null);
  const [message, setMessage] = useState("");
  const watchdog = useRef<number | undefined>(undefined);

  const run = (force = false) => {
    setState("loading");
    setMessage("");

    
    window.clearTimeout(watchdog.current);
    watchdog.current = window.setTimeout(() => {
      cachedDemo = null;
      setMessage("The demo took too long to answer. Download the saved outputs below instead.");
      setState("error");
    }, WATCHDOG_MS);

    return loadDemo(force)
      .then((next) => {
        window.clearTimeout(watchdog.current);
        setResult(next);
        setState("ready");
      })
      .catch((error) => {
        window.clearTimeout(watchdog.current);
        cachedDemo = null;
        setMessage(error instanceof Error ? error.message : "Could not load the output.");
        setState("error");
      });
  };

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setState("loading");
    setMessage("");
    watchdog.current = window.setTimeout(() => {
      if (!active) return;
      cachedDemo = null;
      setMessage("The demo took too long to answer. Download the saved outputs below instead.");
      setState("error");
    }, WATCHDOG_MS);

    loadDemo()
      .then((next) => {
        if (!active) return;
        window.clearTimeout(watchdog.current);
        setResult(next);
        setState("ready");
      })
      .catch((error) => {
        if (!active) return;
        window.clearTimeout(watchdog.current);
        cachedDemo = null;
        setMessage(error instanceof Error ? error.message : "Could not load the output.");
        setState("error");
      });
    return () => {
      active = false;
      window.clearTimeout(watchdog.current);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <ToolShell
      open={isOpen}
      onClose={onClose}
      file="sample.pdf · 100 pages · 269,519 bytes"
      status={
        state === "ready"
          ? "Converted · 100 pages"
          : state === "error"
            ? "Output unavailable"
            : "Converting…"
      }
      eyebrow="pdf → unicode text"
      title="Conversion Result"
      subtitle="The same 100-page Zawgyi PDF through two converters — a standard PDF-to-text tool on the left, AKKHARA on the right. Both results are complete, nothing cut short."
      badges={["Unicode output · TXT"]}
      icon={<Cpu className="h-5 w-5" />}
    >
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-100/90 px-4 py-3 text-xs sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold text-slate-700">
            <FileCheck className="h-4 w-4 shrink-0 text-blue-600" />
            <span>{SAMPLE_NAME} · 100 pages · 269,519 bytes</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={SAMPLE_URL}
            download={SAMPLE_NAME}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400 px-3 py-2 font-bold text-slate-950 transition hover:bg-amber-300"
          >
            <Download className="h-3.5 w-3.5" /> Download source PDF
          </a>
          <a
            href="#benchmark"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-700"
          >
            How this was produced <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      {state === "loading" && (
        <div className="mt-4 flex min-h-[270px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-sky-50/50 p-8 text-center">
          <div className="grid h-16 w-16 place-items-center rounded-2xl border border-blue-200 bg-white shadow-sm">
            <RefreshCw className="h-7 w-7 animate-spin text-blue-600" />
          </div>
          <h4 className="mt-5 text-sm font-bold text-slate-900">Converting {SAMPLE_NAME}</h4>
          <p className="mt-2 max-w-md text-xs leading-relaxed text-slate-600">
            Both outputs open in full — 100 pages each, nothing truncated.
          </p>
        </div>
      )}

      {state === "error" && (
        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center">
          <AlertCircle className="mx-auto h-7 w-7 text-rose-600" />
          <h4 className="mt-3 font-bold text-slate-900">The output could not be loaded</h4>
          <p className="mt-1 text-sm text-slate-600">{message}</p>
          <button
            type="button"
            onClick={() => run(true)}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      )}

      {state === "ready" && result && (
        <div className="mt-4">
          <div className="mb-4 flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-slate-700 sm:flex-row sm:items-center sm:justify-between">
            <span>
              <strong>One source, two converters:</strong> the left frame is the FreeConvert output; the right frame is AKKHARA&apos;s, with cleanup off.
            </span>
            <span className="shrink-0 rounded-full bg-white px-2.5 py-1 font-mono text-[10px] text-blue-700">
              complete output · 100 pages
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 sm:gap-6">
            <section className="flex flex-col overflow-hidden rounded-2xl border-2 border-rose-200/80 bg-white shadow-md">
              <header className="flex items-center justify-between gap-3 border-b border-rose-100 bg-gradient-to-r from-red-50 to-rose-50 px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                  <div className="min-w-0">
                    <h4 className="text-xs font-bold text-slate-900 sm:text-sm">Standard converter output</h4>
                    <p className="text-[11px] font-medium text-rose-700">FreeConvert · same source file</p>
                  </div>
                </div>
                <a
                  href="https://www.freeconvert.com/pdf-to-text"
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-rose-700"
                  aria-label="Open FreeConvert PDF to text"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </header>

              <div className="flex flex-1 flex-col justify-between bg-slate-50/50 p-4">
                <pre className="scrollbar-thin max-h-[360px] min-h-[240px] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-white p-4 font-quote text-sm leading-relaxed text-slate-700">
                  {result.generic}
                </pre>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
                  <span className="min-w-0 truncate font-mono2 text-[0.72rem] text-slate-500">sample-freeconvert.txt</span>
                  <a
                    href={GENERIC_OUTPUT_URL}
                    download
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-semibold text-rose-700"
                  >
                    Download full output
                  </a>
                </div>
              </div>
            </section>

            <section className="relative flex flex-col overflow-hidden rounded-2xl border-2 border-emerald-400 bg-white shadow-xl ring-4 ring-emerald-500/10">
              <header className="flex items-center justify-between gap-3 bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-3 text-white">
                <div className="flex min-w-0 items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-100" />
                  <div className="min-w-0">
                    <h4 className="text-xs font-bold sm:text-sm">AKKHARA Unicode output</h4>
                    <p className="text-[11px] text-emerald-100">Cleanup off · review against the source</p>
                  </div>
                </div>
                <span className="shrink-0 rounded bg-white px-2 py-0.5 text-[10px] font-bold text-emerald-800">100 pages</span>
              </header>

              <div className="flex flex-1 flex-col justify-between bg-emerald-50/20 p-4">
                <pre className="scrollbar-thin max-h-[360px] min-h-[240px] overflow-auto whitespace-pre-wrap break-words rounded-xl border-2 border-emerald-200 bg-white p-4 font-quote text-sm leading-relaxed text-slate-900 shadow-sm">
                  {result.parsed}
                </pre>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-emerald-100 pt-3">
                  <span className="min-w-0 truncate font-mono2 text-[0.72rem] text-slate-500">sample.praser.txt</span>
                  <a
                    href={PARSED_OUTPUT_URL}
                    download
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-semibold text-emerald-700"
                  >
                    Download full output
                  </a>
                </div>
              </div>
            </section>
          </div>

          <div className="mt-6 flex flex-col items-start justify-between gap-3 rounded-2xl bg-gradient-to-r from-blue-900 to-indigo-900 p-4 text-white sm:flex-row sm:items-center">
            <div>
              <h4 className="text-sm font-bold sm:text-base">Reproduce this yourself</h4>
              <p className="mt-1 text-xs text-blue-200">Download the source PDF, run it through the linked tools, then read their complete output against this one.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href={SAMPLE_URL}
                download={SAMPLE_NAME}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-400 px-3 py-1.5 text-[11px] font-bold text-slate-950"
              >
                <Download className="h-3.5 w-3.5" /> Download source
              </a>
              <a
                href="#benchmark"
                onClick={onClose}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/30 px-3 py-1.5 text-[11px] font-semibold text-white"
              >
                <Download className="h-3.5 w-3.5" /> See how this was produced
              </a>
            </div>
          </div>
        </div>
      )}
    </ToolShell>
  );
};
