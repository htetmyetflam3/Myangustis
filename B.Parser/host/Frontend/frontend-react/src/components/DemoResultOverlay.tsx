import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, Download, FileCheck, FileText, RefreshCw, ScanText } from "lucide-react";
import { ToolShell } from "./ToolShell";

export type DemoKind = "pdf" | "docx" | "scan";

const SAMPLES: Record<DemoKind, {
  file: string; eyebrow: string; title: string; sub: string; badge: string; loading: string; base: string;
}> = {
  pdf: {
    file: "sample.pdf · 100 pages",
    eyebrow: "pdf → unicode text",
    title: "Conversion Result",
    sub: "A 100-page Zawgyi PDF with a text layer, read through the embedded font maps.",
    badge: "Unicode output",
    loading: "Converting sample.pdf",
    base: "/samples/sample.praser",
  },
  docx: {
    file: "sample.zawgyi.docx",
    eyebrow: "docx → unicode text",
    title: "Conversion Result",
    sub: "A DOCX whose text layer is Zawgyi: Myanmar code points in visual order, reordered to Unicode.",
    badge: "Unicode output",
    loading: "Converting sample.zawgyi.docx",
    base: "/samples/sample.docx.praser",
  },
  scan: {
    file: "ဘဝထိုထို-part_1.pdf · 50 pages",
    eyebrow: "image-only pdf → ocr text",
    title: "OCR Result",
    sub: "A real CamScanner scan: 50 page images whose only text is the scanner's own watermark. Rendered and recognised page by page.",
    badge: "OCR output",
    loading: "Reading the scan",
    base: "/samples/sample.scan.praser",
  },
};

const FETCH_TIMEOUT_MS = 12000;
const SETTLE_MS = 700;
const cache = new Map<string, Promise<string>>();

function load(base: string) {
  if (!cache.has(base)) {
    cache.set(base, (async () => {
      const [text] = await Promise.all([
        fetch(`${base}.txt`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }).then((r) => {
          if (!r.ok) throw new Error(`Could not load ${base}.txt`);
          return r.text();
        }),
        new Promise((resolve) => setTimeout(resolve, SETTLE_MS)),
      ]);
      return text;
    })().catch((error) => { cache.delete(base); throw error; }));
  }
  return cache.get(base)!;
}

const ICON: Record<DemoKind, React.ReactNode> = {
  pdf: <FileText className="h-5 w-5" />,
  docx: <FileCheck className="h-5 w-5" />,
  scan: <ScanText className="h-5 w-5" />,
};

interface Props { kind: DemoKind | null; onClose: () => void }

export const DemoResultOverlay: React.FC<Props> = ({ kind, onClose }) => {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  const active = useRef<DemoKind | null>(null);

  useEffect(() => {
    if (!kind) return;
    active.current = kind;
    setState("loading");
    load(SAMPLES[kind].base)
      .then((value) => { if (active.current === kind) { setText(value); setState("ready"); } })
      .catch((error) => {
        if (active.current !== kind) return;
        setMessage(error instanceof Error ? error.message : String(error));
        setState("error");
      });
  }, [kind]);

  if (!kind) return null;
  const cfg = SAMPLES[kind];

  return (
    <ToolShell
      open
      onClose={onClose}
      file={cfg.file}
      status={state === "ready" ? "Converted" : state === "error" ? "Unavailable" : "Converting…"}
      eyebrow={cfg.eyebrow}
      title={cfg.title}
      subtitle={cfg.sub}
      badges={[cfg.badge]}
      icon={ICON[kind]}
    >
      {state === "loading" && (
        <div className="dm-loading">
          <div className="dm-loading-ico">
            <RefreshCw className="h-7 w-7 animate-spin" />
          </div>
          <h4>{cfg.loading}</h4>
          <p>Opening the output in full.</p>
        </div>
      )}

      {state === "error" && (
        <div className="dm-error">
          <AlertCircle className="mx-auto h-7 w-7" />
          <h4>The output could not be loaded</h4>
          <p>{message}</p>
        </div>
      )}

      {state === "ready" && (
        <div className="dm-result">
          <textarea className="dm-text scrollbar-thin" readOnly spellCheck={false} value={text} aria-label="Converted text" />
          <div className="dm-save">
            <span className="dm-save-l">Save as</span>
            <a className="dm-save-btn" href={`${cfg.base}.docx`} download target="_blank" rel="noreferrer">
              <Download className="h-3.5 w-3.5" /> DOCX
            </a>
            <a className="dm-save-btn" href={`${cfg.base}.pdf`} download target="_blank" rel="noreferrer">
              <Download className="h-3.5 w-3.5" /> editable PDF
            </a>
            <a className="dm-save-btn" href={`${cfg.base}.txt`} download target="_blank" rel="noreferrer">
              <Download className="h-3.5 w-3.5" /> TXT
            </a>
          </div>
        </div>
      )}
    </ToolShell>
  );
};
