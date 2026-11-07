
const INK = "#0e1626";
const BRAND = "#c63b26";
const AMBER = "#e0a63c";
const TEAL = "#2e7d5b";
const PAPER = "#f7f2e7";

function TextLine({ x, y, width, delay = 0 }: { x: number; y: number; width: number; delay?: number }) {
  return (
    <rect
      className="fx-line"
      x={x}
      y={y}
      width={width}
      height="12"
      rx="6"
      fill="#d9cec0"
      style={{ animationDelay: `${delay}s` }}
    />
  );
}

export default function OcrArt({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1200 820"
      className={`svg-fx h-auto w-full ${className}`}
      role="img"
      aria-label="Animated illustration: an image-only Burmese PDF moving through a Tesseract recognition model and custom Myanmar processing logic"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <defs>
        <linearGradient id="ocr-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f8eee7" />
          <stop offset="100%" stopColor="#eee8db" />
        </linearGradient>
        <linearGradient id="ocr-scan" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={BRAND} stopOpacity="0" />
          <stop offset="50%" stopColor={BRAND} stopOpacity="0.9" />
          <stop offset="100%" stopColor={AMBER} stopOpacity="0" />
        </linearGradient>
        <marker id="ocr-arrow" viewBox="0 0 12 12" refX="8" refY="6" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M1 1 L11 6 L1 11 z" fill={AMBER} />
        </marker>
      </defs>

      <rect width="1200" height="820" fill="url(#ocr-bg)" />
      <circle cx="190" cy="170" r="145" fill="#f3ded3" opacity="0.72" />
      <circle cx="1045" cy="660" r="190" fill="#e4eee7" opacity="0.78" />

      {/* OCR workspace */}
      <g>
        <rect x="120" y="90" width="960" height="610" rx="36" fill="#fff" stroke={INK} strokeWidth="7" />
        <rect x="146" y="116" width="908" height="78" rx="22" fill={PAPER} stroke={INK} strokeWidth="5" />
        <circle cx="188" cy="155" r="11" fill="#b32026" stroke={INK} strokeWidth="4" />
        <circle cx="224" cy="155" r="11" fill={AMBER} stroke={INK} strokeWidth="4" />
        <circle cx="260" cy="155" r="11" fill={TEAL} stroke={INK} strokeWidth="4" />
        <text x="306" y="165" fontSize="24" fontWeight="750" fill={INK} fontFamily="Anonymous Pro, monospace">
          myanmar_ocr_pipeline.dev
        </text>
        <rect x="864" y="135" width="156" height="40" rx="20" fill="#f8ecd4" stroke={INK} strokeWidth="4" />
        <text x="942" y="162" textAnchor="middle" fontSize="18" fontWeight="800" fill={BRAND} fontFamily="Anonymous Pro, monospace">
          SCAN-BOUND
        </text>
      </g>

      {/* image-only source page */}
      <g className="fx-float-sm">
        <rect x="180" y="242" width="300" height="370" rx="24" fill="#f1eee7" stroke={INK} strokeWidth="7" />
        <rect x="206" y="270" width="248" height="52" rx="14" fill="#d9d3c9" />
        <text x="330" y="303" textAnchor="middle" fontSize="20" fontWeight="800" fill={INK} fontFamily="Anonymous Pro, monospace">
          IMAGE-ONLY PDF
        </text>
        <rect x="218" y="350" width="224" height="190" rx="12" fill="#e3ded4" stroke="#837a6d" strokeWidth="4" strokeDasharray="9 9" />
        <path d="M246 494 l54 -62 42 42 36 -34 42 54" fill="none" stroke="#837a6d" strokeWidth="8" />
        <circle cx="384" cy="392" r="19" fill={AMBER} opacity="0.8" />
        <text x="330" y="578" textAnchor="middle" fontSize="18" fontWeight="700" fill="#7a7266" fontFamily="Myanmar Sagar, sans-serif">
          no selectable text layer
        </text>
        <rect className="fx-slide-y" x="204" y="334" width="252" height="12" rx="6" fill="url(#ocr-scan)" />
      </g>

      {/* recognition model */}
      <g className="fx-float">
        <circle cx="604" cy="430" r="108" fill="#f8ecd4" stroke={INK} strokeWidth="7" />
        <circle className="fx-spin" cx="604" cy="430" r="78" fill="none" stroke={AMBER} strokeWidth="7" strokeDasharray="32 20" />
        <rect x="552" y="382" width="104" height="96" rx="18" fill="#fff" stroke={INK} strokeWidth="5" />
        <text x="604" y="421" textAnchor="middle" fontSize="20" fontWeight="850" fill={BRAND} fontFamily="Anonymous Pro, monospace">
          MODEL
        </text>
        <text x="604" y="454" textAnchor="middle" fontSize="27" fontWeight="900" fill={INK} fontFamily="Anonymous Pro, monospace">
          OCR
        </text>
        <path className="fx-dash" d="M486 430 H520" stroke={AMBER} strokeWidth="7" markerEnd="url(#ocr-arrow)" />
        <path className="fx-dash" d="M688 430 H730" stroke={AMBER} strokeWidth="7" markerEnd="url(#ocr-arrow)" />
      </g>

      {/* custom logic and output */}
      <g>
        <rect x="746" y="242" width="270" height="370" rx="24" fill="#fff" stroke={INK} strokeWidth="7" />
        <rect x="772" y="270" width="218" height="52" rx="14" fill="#e4eee7" stroke={TEAL} strokeWidth="3" />
        <text x="881" y="303" textAnchor="middle" fontSize="19" fontWeight="800" fill={TEAL} fontFamily="Anonymous Pro, monospace">
          MYANMAR LOGIC
        </text>
        <TextLine x={782} y={360} width={178} />
        <TextLine x={782} y={402} width={150} delay={0.18} />
        <TextLine x={782} y={444} width={196} delay={0.36} />
        <TextLine x={782} y={486} width={132} delay={0.54} />
        <rect x="782" y="532" width="198" height="48" rx="16" fill="#e4eee7" stroke={TEAL} strokeWidth="4" />
        <text x="881" y="563" textAnchor="middle" fontSize="18" fontWeight="800" fill={TEAL} fontFamily="Myanmar Sagar, sans-serif">
          reviewable text
        </text>
      </g>

      <g>
        <rect x="392" y="722" width="416" height="58" rx="29" fill={INK} />
        <text x="600" y="758" textAnchor="middle" fontSize="20" fontWeight="700" fill="#fff" fontFamily="Myanmar Sagar, sans-serif">
          Tesseract model + AKKHARA processing logic
        </text>
      </g>
    </svg>
  );
}
