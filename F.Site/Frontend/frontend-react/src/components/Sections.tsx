import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Minus,
  Plus,
  ArrowUpRight,
  Download,
  ScanText,
  Layers,
  Keyboard,
} from "lucide-react";
import { Wordmark } from "./Nav";
import { ToTopButton } from "./Extras";

const EASE: [number, number, number, number] = [0.2, 0.8, 0.2, 1];

function Reveal({
  children,
  delay = 0,
  className = "",
  y = 28,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  y?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.75, delay, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function SectionLabel({ n, en, mm }: { n: string; en: string; mm: string }) {
  return (
    <div className="flex items-baseline gap-4">
      <span className="font-mono2 text-[0.75rem] text-[#c63b26]">{n}</span>
      <span className="micro text-[#a9a093]">{en}</span>
      <span className="mm ml-auto text-[0.85rem] text-[#7a7266]">{mm}</span>
    </div>
  );
}


export function SocialProof() {
  const stats = [
    { v: "၁၀၀", l: "pages in the tested file" },
    { v: "၁၀၀ / ၁၀၀", l: "pages that were Zawgyi" },
    { v: "TXT · DOCX", l: "formats you can save to" },
    { v: "OCR", l: "spell fixing in development" },
  ];
  const tags = [
    "PDF files",
    "Word files",
    "scanned pages",
    "Zawgyi → Unicode",
    "copy and search",
    "TXT export",
    "DOCX export",
    "check against the original",
    "spell fixing in development",
  ];

  return (
    <section className="border-y border-[#0e1626]/12 bg-[#efe6d3]/55">
      <div className="mx-auto max-w-[1440px] px-5 py-12 sm:px-8 lg:px-12">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s, i) => (
            <Reveal key={s.l} delay={i * 0.08}>
              <div className="border-l border-[#0e1626]/15 pl-5">
                <div className="mm-display text-[clamp(1.9rem,3vw,2.7rem)] font-bold leading-none text-[#0e1626]">
                  {s.v}
                </div>
                <div className="micro mt-3 text-[#7a7266]">{s.l}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>

      <div className="relative overflow-hidden border-t border-[#0e1626]/12 py-3.5">
        <div className="marquee-track flex w-max gap-10 whitespace-nowrap">
          {[...tags, ...tags].map((t, i) => (
            <span key={i} className="mm flex items-center gap-3 text-[0.9rem] text-[#7a7266]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#c63b26]" />
              {t}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}


const STEPS = [
  {
    n: "01",
    t: "ဖိုင်တင်ခြင်း",
    d: "PDF ဒါမှမဟုတ် Word (DOCX) ဖိုင်ကို တင်လိုက်ရုံပါပဲ။ ယူနီကုဒ်လား၊ ဇော်ဂျီလား၊ scan လုပ်ထားတာလားဆိုတာ ကြိုသိစရာ မလိုပါဘူး။",
    meta: "pdf · docx",
  },
  {
    n: "02",
    t: "စာမျက်နှာအလိုက် ဖတ်ခြင်း",
    d: "စာမျက်နှာတစ်ခုချင်းစီကို စစ်ပြီး မြန်မာစာကို မှန်ကန်တဲ့ ပုံစံအဖြစ် အလိုအလျောက် ပြောင်းပေးပါတယ်။ Scan ဖြစ်နေရင် ပုံထဲက စာကို ဖတ်ပေးပါတယ်။",
    meta: "detect · convert",
  },
  {
    n: "03",
    t: "မူရင်းနဲ့ တိုက်စစ်ခြင်း",
    d: "ထွက်လာတဲ့ စာနဲ့ မူရင်းဖိုင်ကို ဘေးချင်းထားပြီး စာကြောင်းလိုက် တိုက်ကြည့်လို့ ရပါတယ် — ဖုန်းပေါ်မှာပါ။ မှားနေတာ တွေ့ရင် ချက်ချင်း ပြင်ပြီး TXT ဒါမှမဟုတ် Word (DOCX) အဖြစ် သိမ်းလိုက်ရုံပါပဲ။",
    meta: "review · .txt · .docx",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
      <Reveal>
        <SectionLabel n="01" en="how it works" mm="လုပ်ဆောင်ပုံ သုံးဆင့်" />
        <h2 className="mm-display mt-6 max-w-[20ch] text-[clamp(2rem,4.6vw,3.4rem)] font-bold leading-[1.15] tracking-tight">
          ဖိုင်တင်လိုက်ရုံနဲ့{" "}
          <span className="bg-gradient-to-r from-[#c63b26] to-[#e0a63c] bg-clip-text text-transparent">
            ပြန်သုံးလို့ရတဲ့ စာသား ရပါပြီ
          </span>
        </h2>
      </Reveal>

      <div className="mt-14 border-t border-[#0e1626]/15">
        {STEPS.map((s, i) => (
          <Reveal key={s.n} delay={i * 0.1}>
            <div
              className={`group grid gap-4 border-b border-[#0e1626]/15 py-9 md:grid-cols-[auto_1.1fr_1.4fr_auto] md:items-baseline md:gap-8`}
              style={{ paddingLeft: `${i * 24}px` }}
            >
              <span className="font-display text-[clamp(2.6rem,6vw,4.6rem)] font-black leading-none text-[#0e1626]/12 transition-colors duration-500 group-hover:text-[#c63b26]/70">
                {s.n}
              </span>
              <h3 className="mm-display text-[1.35rem] font-bold leading-snug text-[#0e1626]">
                {s.t}
              </h3>
              <p className="mm max-w-[56ch] text-[0.98rem] leading-[1.9] text-[#0e1626]/72">
                {s.d}
              </p>
              <span className="micro whitespace-nowrap text-[#a9a093]">{s.meta}</span>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}


type Cell = "no" | "part" | "yes";

const ROWS: { label: string; a: Cell; b: Cell; c: Cell }[] = [
  { label: "ယူနီကုဒ် PDF", a: "yes", b: "part", c: "yes" },
  { label: "ဇော်ဂျီ PDF", a: "part", b: "part", c: "yes" },
  { label: "Scan ဖတ်ထားတဲ့ PDF", a: "no", b: "yes", c: "part" },
  { label: "ကူးယူ၊ ရှာဖွေလို့ရတဲ့ စာသား", a: "yes", b: "part", c: "yes" },
  { label: "TXT / Word အဖြစ် သိမ်းခြင်း", a: "part", b: "part", c: "yes" },
  { label: "မူရင်းနဲ့ တိုက်စစ်နိုင်ခြင်း", a: "part", b: "yes", c: "yes" },
];

const HEAD = ["Other converters", "Basic OCR", "AKKHARA"];

const BENCHMARK_TOOLS = [
  {
    name: "PDF2Go",
    detail: "PDF-to-Text upload page",
    href: "https://www.pdf2go.com/pdf-to-text",
  },
  {
    name: "Adobe Acrobat",
    detail: "PDF-to-Word converter",
    href: "https://www.adobe.com/acrobat/online/pdf-to-word.html",
  },
  {
    name: "Google Drive / Docs",
    detail: "Official OCR instructions",
    href: "https://support.google.com/drive/answer/176692?hl=en&co=GENIE.Platform%3DDesktop",
  },
  {
    name: "FreeConvert",
    detail: "PDF-to-Text upload page",
    href: "https://www.freeconvert.com/pdf-to-text",
  },
];

const SAVED_OUTPUTS = [
  { name: "AKKHARA · cleanup off", href: "/samples/sample.praser.txt" },
  { name: "FreeConvert", href: "/samples/sample-freeconvert.txt" },
  { name: "PDF2Go", href: "/samples/sample-pdf2go.txt" },
  { name: "PDF24", href: "/samples/sample-pdf24.txt" },
  { name: "pdftotext", href: "/samples/sample-pdftotext.txt" },
];

function Mark4({ kind }: { kind: Cell }) {
  if (kind === "yes")
    return (
      <span className="inline-flex items-center gap-2 text-[#7ee0b4]">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-[#2e7d5b]">
          <Check size={14} strokeWidth={3} color="#eafff5" />
        </span>
        <span className="micro">full</span>
      </span>
    );
  if (kind === "part")
    return (
      <span className="inline-flex items-center gap-2 text-[#e0a63c]">
        <span className="grid h-6 w-6 place-items-center rounded-full border border-[#e0a63c]/60">
          <Minus size={13} strokeWidth={3} />
        </span>
        <span className="micro">partial</span>
      </span>
    );
  return (
    <span className="inline-flex items-center gap-2 text-[#f7f2e7]/45">
      <span className="grid h-6 w-6 place-items-center rounded-full border border-[#f7f2e7]/25">
        <Minus size={13} strokeWidth={3} />
      </span>
      <span className="micro">none</span>
    </span>
  );
}

export function Compare() {
  const rowNote: Record<string, [string, string, string]> = {
    "ယူနီကုဒ် PDF": ["အများအားဖြင့် ရတယ်", "မလိုအပ်ဘဲ ပုံကနေ ဖတ်", "တိုက်ရိုက် ထုတ်ပေး"],
    "ဇော်ဂျီ PDF": ["စာပျောက်၊ ပုံပျက်တတ်", "ပုံကနေ ခန့်မှန်းရ", "ဇော်ဂျီကို မှန်အောင် ဖတ်"],
    "Scan ဖတ်ထားတဲ့ PDF": ["စာသား မပါလို့ မရ", "ဒီအတွက် သုံးရတာ", "ပုံ ကြည်လင်မှုအပေါ် မူတည်"],
    "ကူးယူ၊ ရှာဖွေလို့ရတဲ့ စာသား": ["ဖိုင်ပေါ် မူတည်", "အမှား ပြန်စစ်ရ", "ယူနီကုဒ်အဖြစ် ထွက်"],
    "TXT / Word အဖြစ် သိမ်းခြင်း": ["tool အလိုက် ကွာ", "tool အလိုက် ကွာ", "TXT + Word"],
    "မူရင်းနဲ့ တိုက်စစ်နိုင်ခြင်း": ["ကိုယ်တိုင် စစ်ရ", "ကိုယ်တိုင် စစ်ရ", "မူရင်းနဲ့ ဘေးချင်းယှဉ်"],
  };

  return (
    <section id="compare" className="ink-panel grain grain-dark relative overflow-hidden">
      <div className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
        <Reveal>
          <div className="flex items-baseline gap-4">
            <span className="font-mono2 text-[0.75rem] text-[#e0a63c]">02</span>
            <span className="micro text-[#f7f2e7]/45">comparison</span>
            <span className="mm ml-auto text-[0.85rem] text-[#f7f2e7]/50">
              တခြား tools တွေနဲ့ နှိုင်းယှဉ်ချက်
            </span>
          </div>
          <h2 className="mm-display mt-6 max-w-[24ch] text-[clamp(2rem,4.6vw,3.4rem)] font-bold leading-[1.15] text-[#f7f2e7]">
            ဘာတွေ လုပ်နိုင်ပြီလဲ —{" "}
            <span className="bg-gradient-to-r from-[#e0a63c] to-[#c63b26] bg-clip-text text-transparent">
              ဘာတွေ မလုပ်နိုင်သေးဘူးလဲ
            </span>
          </h2>
          <p className="mm mt-4 max-w-[70ch] text-[0.98rem] leading-[1.9] text-[#f7f2e7]/60">
            ယူနီကုဒ်နဲ့ ဇော်ဂျီ PDF၊ Word ဖိုင်တွေကို အခု ပြောင်းပေးနိုင်ပါပြီ။ Scan ဖိုင်တွေကိုလည်း ဖတ်ပေးပါတယ် — ဒါပေမယ့် ပုံမှုန်နေရင် အဖြေလည်း မှုန်ပါတယ်။ စာထဲက အမှားလေးတွေကို အလိုအလျောက် ပြန်ပြင်ပေးတဲ့ အပိုင်းကတော့ ဆက်လုပ်နေဆဲပါ။
          </p>
        </Reveal>

        <Reveal delay={0.12} className="mt-10">
          {/* Mobile and tablet: each criterion becomes a readable comparison card. */}
          <div className="grid gap-4 lg:hidden" role="table" aria-label="Comparison with other converters">
            {ROWS.map((r, i) => (
              <motion.article
                key={r.label}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.25 }}
                transition={{ delay: i * 0.04, duration: 0.45, ease: EASE }}
                className="rounded-2xl border border-[#f7f2e7]/14 bg-[#f7f2e7]/5 p-4"
                role="row"
              >
                <h3 className="mm-display border-b border-[#f7f2e7]/12 pb-3 text-[0.96rem] font-semibold leading-relaxed text-[#f7f2e7]">
                  {r.label}
                </h3>
                <div className="mt-2 grid gap-1">
                  {HEAD.map((heading, j) => {
                    const cell = ([r.a, r.b, r.c] as Cell[])[j];
                    return (
                      <div
                        key={heading}
                        className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 py-3 ${
                          j === 2 ? "bg-[#2e7d5b]/16" : "bg-[#f7f2e7]/[0.025]"
                        }`}
                        role="cell"
                      >
                        <div className="min-w-0">
                          <div className={`mm text-[0.82rem] font-semibold ${j === 2 ? "text-[#e0a63c]" : "text-[#f7f2e7]/72"}`}>
                            {heading}
                          </div>
                          <div className={`mm mt-1 text-[0.76rem] leading-relaxed ${j === 2 ? "text-[#7ee0b4]/85" : "text-[#f7f2e7]/45"}`}>
                            {rowNote[r.label]?.[j]}
                          </div>
                        </div>
                        <Mark4 kind={cell} />
                      </div>
                    );
                  })}
                </div>
              </motion.article>
            ))}
          </div>

          {/* Desktop: retain the compact comparison table. */}
          <div className="hidden lg:block">
            <table className="w-full table-fixed border-collapse text-left">
              <thead>
                <tr className="border-b border-[#f7f2e7]/20">
                  <th className="micro w-[28%] py-4 pr-4 font-medium text-[#f7f2e7]/45">criteria</th>
                  {HEAD.map((h, i) => (
                    <th
                      key={h}
                      className={`py-4 pr-4 text-[0.95rem] font-semibold ${
                        i === 2 ? "mm text-[#e0a63c]" : "mm text-[#f7f2e7]/75"
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r, i) => (
                  <motion.tr
                    key={r.label}
                    initial={{ opacity: 0, y: 14 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, amount: 0.4 }}
                    transition={{ delay: i * 0.06, duration: 0.5, ease: EASE }}
                    className="group border-b border-[#f7f2e7]/10 transition-colors hover:bg-[#f7f2e7]/6"
                  >
                    <td className="mm py-4 pr-4 text-[0.93rem] leading-relaxed text-[#f7f2e7]/85">{r.label}</td>
                    {([r.a, r.b, r.c] as Cell[]).map((cell, j) => (
                      <td key={j} className="py-4 pr-4 align-middle">
                        <Mark4 kind={cell} />
                        <div className={`mm mt-1.5 text-[0.78rem] leading-relaxed ${j === 2 ? "text-[#7ee0b4]/85" : "text-[#f7f2e7]/45"}`}>
                          {rowNote[r.label]?.[j]}
                        </div>
                      </td>
                    ))}
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="micro mt-5 leading-relaxed text-[#f7f2e7]/40">
            what works today · other tools vary · scan results depend on how clear the page is
          </p>
        </Reveal>

        <Reveal delay={0.16} className="mt-16">
          <div
            id="benchmark"
            className="scroll-mt-24 overflow-hidden rounded-[2rem] border border-[#e0a63c]/35 bg-[#f7f2e7]/[0.055] shadow-2xl shadow-black/20"
          >
            <div className="grid gap-8 border-b border-[#f7f2e7]/12 p-5 sm:p-8 lg:grid-cols-[1.15fr_0.85fr] lg:p-10">
              <div>
                <div className="micro flex items-center gap-3 text-[#e0a63c]">
                  <span>reproducible benchmark</span>
                  <span className="h-px w-10 bg-[#e0a63c]/50" />
                  <span>100 pages</span>
                </div>
                <h3 className="mm-display mt-4 max-w-[18ch] text-[clamp(1.7rem,3.6vw,2.65rem)] font-bold leading-tight text-[#f7f2e7]">
                  ဒီ sample တစ်ခုတည်းကို tools တိုင်းမှာ စမ်းကြည့်ပါ
                </h3>
                <p className="mm mt-4 max-w-[64ch] text-[0.94rem] leading-[1.9] text-[#f7f2e7]/62">
                  ဒီမှာ သုံးထားတာက စာမျက်နှာ ၁၀၀ ပါတဲ့ ဇော်ဂျီ PDF အတိအကျပါ။ ဖိုင်ကို တစ်ကြိမ် download လုပ်ပြီး အောက်က tool တွေမှာ ဘာမှ မပြင်ဘဲ တင်ကြည့်ပါ။ ထွက်လာတဲ့ မြန်မာစာ၊ အင်္ဂလိပ်စာ၊ သင်္ကေတနဲ့ စာမျက်နှာ အပိုင်းအခြားတွေကို မူရင်းနဲ့ ယှဉ်ကြည့်နိုင်ပါတယ်။
                </p>
              </div>

              <div className="grid content-start gap-3">
                {[
                  ["01", "Download", "Exact sample.pdf · 269,519 bytes"],
                  ["02", "Upload unchanged", "Use each official link below"],
                  ["03", "Compare complete output", "One sample is evidence, not a universal accuracy score"],
                ].map(([n, title, detail]) => (
                  <div key={n} className="grid grid-cols-[auto_1fr] gap-3 rounded-2xl border border-[#f7f2e7]/10 bg-black/10 p-3.5">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-[#e0a63c] font-mono2 text-[0.65rem] font-bold text-[#0e1626]">{n}</span>
                    <div>
                      <div className="text-sm font-bold text-[#f7f2e7]">{title}</div>
                      <div className="mt-0.5 text-xs leading-relaxed text-[#f7f2e7]/45">{detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-5 sm:p-8 lg:p-10">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <a
                  href="/samples/sample.pdf"
                  download="sample.pdf"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#e0a63c] px-5 py-3 text-sm font-bold text-[#0e1626] transition hover:bg-[#efb94c]"
                >
                  <Download size={17} /> Download exact sample PDF
                </a>
                <button
                  type="button"
                  data-open-pdf
                  onClick={() => window.dispatchEvent(new CustomEvent("akkhara:open-pdf"))}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#f7f2e7]/20 px-5 py-3 text-sm font-bold text-[#f7f2e7] transition hover:bg-[#f7f2e7]/10"
                >
                  Run the API demo <ArrowUpRight size={16} />
                </button>
              </div>

              <div className="mt-8">
                <div className="micro text-[#f7f2e7]/38">test with the article&apos;s referenced tools</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {BENCHMARK_TOOLS.map((tool) => (
                    <a
                      key={tool.name}
                      href={tool.href}
                      target="_blank"
                      rel="noreferrer"
                      className="group rounded-2xl border border-[#f7f2e7]/12 bg-[#f7f2e7]/[0.035] p-4 transition hover:border-[#e0a63c]/55 hover:bg-[#f7f2e7]/[0.075]"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-bold text-[#f7f2e7]">{tool.name}</span>
                        <ArrowUpRight size={15} className="shrink-0 text-[#e0a63c] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-[#f7f2e7]/45">{tool.detail}</p>
                    </a>
                  ))}
                </div>
                <p className="mt-3 text-[0.72rem] leading-relaxed text-[#f7f2e7]/35">
                  These are independent third-party services. Review each service&apos;s privacy and file-retention terms before uploading another document.
                </p>
              </div>

              <div className="mt-8 border-t border-[#f7f2e7]/12 pt-6">
                <div className="micro text-[#f7f2e7]/38">download the saved full-text evidence</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {SAVED_OUTPUTS.map((output) => (
                    <a
                      key={output.name}
                      href={output.href}
                      download
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full border border-[#f7f2e7]/14 bg-black/10 px-3 py-2 text-xs font-semibold text-[#f7f2e7]/70 transition hover:border-[#7ee0b4]/55 hover:text-[#7ee0b4]"
                    >
                      <Download size={13} /> {output.name}
                    </a>
                  ))}
                </div>
                <p className="mm mt-4 max-w-[92ch] text-[0.76rem] leading-relaxed text-[#f7f2e7]/42">
                  AKKHARA ဖိုင်ကတော့ အမှားပြင်တာကို ပိတ်ထားပြီး ထွက်လာတဲ့အတိုင်း တင်ထားတာပါ။ ဖိုင်အပြည့်ကို download လုပ်ကြည့်လို့ ရပါတယ်။ ဒီဖိုင်တစ်ခုတည်းနဲ့ ဖိုင်အမျိုးအစား အားလုံးအတွက် အာမခံချက်အဖြစ် မယူထားပါဘူး။
                </p>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}


const BENEFITS = [
  {
    icon: ScanText,
    t: "ဇော်ဂျီဖိုင်ကိုပါ ဖတ်ပေးတယ်",
    d: "တခြား converter တွေမှာ မြန်မာစာ ပျောက်သွားတတ်တဲ့ ဖိုင်မျိုးကို မှန်ကန်တဲ့ မြန်မာစာအဖြစ် ပြန်ထုတ်ပေးပါတယ်။",
  },
  {
    icon: Layers,
    t: "စာမျက်နှာတိုင်းကို သီးသန့် စစ်တယ်",
    d: "ဖိုင်တစ်ခုလုံးကို တစ်မျိုးတည်း မှတ်မယူဘဲ စာမျက်နှာတစ်ခုချင်းစီကို စစ်ပြီး လိုအပ်တာကို ပြောင်းပေးပါတယ်။",
  },
  {
    icon: Check,
    t: "မူရင်းနဲ့ ဘေးချင်းယှဉ်ကြည့်လို့ရတယ်",
    d: "ထွက်လာတဲ့ စာသားကို မူရင်းဖိုင်နဲ့ ယှဉ်ပြီး အင်္ဂလိပ်စာ၊ ကွင်းစကွင်းပိတ်နဲ့ စာလုံးအစီအစဉ်တွေ မှန်မမှန် ကိုယ်တိုင် စစ်နိုင်ပါတယ်။",
  },
  {
    icon: Keyboard,
    t: "စာသား ကူးထည့်ပြီးလည်း ပြောင်းလို့ရတယ်",
    d: "ဖိုင် မတင်ချင်ဘူးဆိုရင် ဇော်ဂျီစာသားကို တိုက်ရိုက် ကူးထည့်ပြီး ယူနီကုဒ်အဖြစ် ပြောင်းနိုင်ပါတယ်။",
  },
  {
    icon: ArrowUpRight,
    t: "TXT ဒါမှမဟုတ် Word အဖြစ် သိမ်းနိုင်တယ်",
    d: "စစ်ပြီးသား စာသားကို TXT ဒါမှမဟုတ် Word (DOCX) အဖြစ် သိမ်းယူနိုင်ပါတယ်။ ပုံစံရှုပ်တဲ့ စာမျက်နှာတွေကိုတော့ Word မှာ ပြန်စစ်ပေးပါ။",
  },
  {
    icon: ScanText,
    t: "Scan ဖိုင်ဆိုရင် ပုံကြည်မှ ပိုမှန်တယ်",
    d: "Scan ဖိုင်တွေမှာ ပုံမှုန်နေရင် အဖြေလည်း မှုန်ပါတယ်။ CamScanner၊ Adobe Scan တို့နဲ့ ရိုက်ထားတဲ့ ဖိုင်တွေမှာ အထူးသိသာပါတယ်။ ပုံ မှုန်နေရင် ဘယ်ကိရိယာမှ မှန်အောင် မဖတ်နိုင်ပါဘူး။",
  },
];

export function Benefits() {
  return (
    <section id="features" className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
      <Reveal>
        <SectionLabel n="03" en="why akkhara" mm="အကျိုးကျေးဇူးများ" />
        <h2 className="mm-display mt-6 max-w-[22ch] text-[clamp(2rem,4.6vw,3.4rem)] font-bold leading-[1.15] tracking-tight">
          PDF ထဲက စာကို ပြန်ထုတ်ပြီး မူရင်းနဲ့ တိုက်စစ်လို့ ရပါတယ်
        </h2>
      </Reveal>

      <div className="mt-12 grid border-l border-t border-[#0e1626]/14 sm:grid-cols-2 lg:grid-cols-3">
        {BENEFITS.map((b, i) => (
          <Reveal key={b.t} delay={(i % 3) * 0.08}>
            <div className="group h-full border-b border-r border-[#0e1626]/14 p-7 transition-colors duration-500 hover:bg-[#fbf8f1]">
              <b.icon
                size={22}
                className="text-[#c63b26] transition-transform duration-500 group-hover:-translate-y-1"
                strokeWidth={1.6}
              />
              <h3 className="mm-display mt-5 text-[1.15rem] font-bold text-[#0e1626]">{b.t}</h3>
              <p className="mm mt-2.5 text-[0.92rem] leading-[1.9] text-[#0e1626]/68">{b.d}</p>
              <span className="micro mt-5 block text-[#a9a093] opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                0{i + 1} / benefit
              </span>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}


const FAQ = [
  {
    q: "ဇော်ဂျီ PDF ဆိုတာ ဘာလဲ။ ဘာကြောင့် တခြားမှာ စာမပေါ်တာလဲ။",
    a: "မြန်မာစာ ရိုက်တဲ့အခါ ယူနီကုဒ်နဲ့ ဇော်ဂျီ ဆိုပြီး နှစ်မျိုး ရှိပါတယ်။ ဇော်ဂျီနဲ့ ရိုက်ထားတဲ့ ဖိုင်ကို Word ဒါမှမဟုတ် အွန်လိုင်း converter တွေက မဖတ်တတ်လို့ စာပျောက်တာ၊ ပုံပျက်တာတွေ ဖြစ်ရတာပါ။ AKKHARA က အဲဒီဖိုင်မျိုးကို သီးသန့် ဖတ်ပေးပါတယ်။",
  },
  {
    q: "Scan လုပ်ထားတဲ့ PDF ကို အခုဖတ်နိုင်ပြီလား။",
    a: "ဖတ်နိုင်ပါတယ်။ ပုံထဲက စာကို ဖတ်ပြီး စာသားအဖြစ် ပြန်ရေးပေးပါတယ်။ ဒါပေမယ့် Scan ဖိုင်တွေမှာ ပုံမှုန်နေရင် အဖြေလည်း မှုန်ပါတယ်။ CamScanner၊ Adobe Scan တို့နဲ့ ရိုက်ထားတဲ့ ဖိုင်တွေမှာ အထူးသိသာပါတယ်။",
  },
  {
    q: "ထုတ်ယူထားတဲ့ စာသားက အမြဲတမ်း အမှန်လား။",
    a: "မဟုတ်ပါဘူး။ ဖိုင်တည်ဆောက်ပုံအလိုက် ရလဒ် ကွာနိုင်ပါတယ်။ မြန်မာစာကို ပြန်ရပေမယ့် အင်္ဂလိပ်စာ၊ ကွင်းစကွင်းပိတ်၊ နေရာလွတ်နဲ့ သင်္ကေတတချို့ကို မူရင်းဖိုင်နဲ့ ယှဉ်ပြီး စစ်ပေးသင့်ပါတယ်။",
  },
  {
    q: "အမှားပြင်ပေးတာ (Cleanup) ဆိုတာ ဘာလဲ။",
    a: "ထုတ်ပြီးသား စာသားထဲက မှားနေတတ်တဲ့ စာလုံးအချို့ကို ပြန်ပြင်ပေးတဲ့ ရွေးချယ်စရာ အဆင့်တစ်ခုပါ။ သုံးချင်မှ သုံးလို့ ရပါတယ်။",
  },
  {
    q: "TXT နဲ့ Word (DOCX) ဘာကွာလဲ။",
    a: "TXT က စာသားသက်သက်ပါ။ Word (DOCX) ကတော့ စာမျက်နှာနဲ့ စာကြောင်းနေရာတွေကို ထိန်းပေးထားလို့ Word မှာ ဆက်ပြင်ရ လွယ်ပါတယ်။ ပုံစံရှုပ်တဲ့ စာမျက်နှာတွေကိုတော့ မူရင်းနဲ့ ပြန်စစ်ပေးပါ။",
  },
  {
    q: "ဘယ်လိုစမ်းသပ်ထားလဲ။",
    a: "စာမျက်နှာ ၁၀၀ ပါတဲ့ ဇော်ဂျီ PDF တစ်ဖိုင်ကို တခြား converter တွေနဲ့ ဘေးချင်းယှဉ်ပြီး စမ်းထားပါတယ်။ ဖိုင်တစ်ဖိုင်ရဲ့ ရလဒ်ကို ဖိုင်အမျိုးအစား အားလုံးအတွက် အာမခံချက်အဖြစ် မယူထားပါဘူး။",
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section
      id="faq"
      className="border-t border-[#0e1626]/12 bg-[#efe6d3]/40"
    >
      <div className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <Reveal>
            <SectionLabel n="04" en="faq" mm="မေးခွန်းများ" />
            <h2 className="mm-display mt-6 text-[clamp(2rem,4vw,3rem)] font-bold leading-[1.15]">
              မေးလေ့ရှိတဲ့ မေးခွန်း ခြောက်ခု
            </h2>
            <p className="mt-4 max-w-[34ch] text-[0.9rem] leading-relaxed text-[#7a7266]">
              Still unsure? Write to us in Burmese — we answer within one working day.
            </p>
            <a
              href="mailto:hello@akkhara.mm"
              className="sweep font-mono2 mt-6 inline-block text-[0.9rem] text-[#c63b26]"
            >
              hello@akkhara.mm
            </a>
          </Reveal>

          <div className="border-t border-[#0e1626]/15">
            {FAQ.map((f, i) => {
              const isOpen = open === i;
              return (
                <Reveal key={f.q} delay={i * 0.05} y={16}>
                  <div className="border-b border-[#0e1626]/15">
                    <button
                      onClick={() => setOpen(isOpen ? null : i)}
                      aria-expanded={isOpen}
                      className="flex w-full items-start gap-5 py-5 text-left"
                    >
                      <span className="font-mono2 mt-1 text-[0.75rem] text-[#a9a093]">
                        0{i + 1}
                      </span>
                      <span className="mm flex-1 text-[1.02rem] font-medium leading-snug text-[#0e1626]">
                        {f.q}
                      </span>
                      <span
                        className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border transition-all duration-300 ${
                          isOpen
                            ? "rotate-180 border-[#c63b26] bg-[#c63b26] text-white"
                            : "border-[#0e1626]/25 text-[#0e1626]"
                        }`}
                      >
                        {isOpen ? <Minus size={14} /> : <Plus size={14} />}
                      </span>
                    </button>
                    <AnimatePresence initial={false}>
                      {isOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.4, ease: EASE }}
                          className="overflow-hidden"
                        >
                          <p className="mm max-w-[70ch] pb-6 pl-[3.1rem] pr-8 text-[0.95rem] leading-[1.95] text-[#0e1626]/72">
                            {f.a}
                          </p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}


export function CtaBand() {
  const openPdf = () => {
    document.getElementById("hero")?.scrollIntoView({ behavior: "smooth" });
    setTimeout(() => window.dispatchEvent(new CustomEvent("akkhara:open-pdf")), 450);
  };
  const openGrammar = () => {
    document.getElementById("hero")?.scrollIntoView({ behavior: "smooth" });
    setTimeout(() => window.dispatchEvent(new CustomEvent("akkhara:open-grammar")), 450);
  };

  return (
    <section className="relative overflow-hidden bg-[#0b1121]">
      <img
        src="images/band.jpg"
        alt=""
        className="absolute inset-0 h-full w-full object-cover opacity-55"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-[#0b1121] via-[#0b1121]/85 to-[#0b1121]/35" />
      <div className="relative mx-auto max-w-[1440px] px-5 py-24 sm:px-8 lg:px-12 lg:py-32">
        <Reveal>
          <span className="micro text-[#e0a63c]">start now · ရန်ကုန်</span>
          <h2 className="mm-display mt-6 max-w-[18ch] text-[clamp(2.2rem,5.6vw,4.2rem)] font-bold leading-[1.1] text-[#f7f2e7]">
            ဖတ်လို့မရတဲ့ PDF ကို{" "}
            <span className="bg-gradient-to-r from-[#e0a63c] to-[#c63b26] bg-clip-text text-transparent">
              ဒီကနေ စမ်းကြည့်ပါ
            </span>
          </h2>
          <p className="mm mt-6 max-w-[56ch] text-[1rem] leading-[1.95] text-[#f7f2e7]/70">
            စာမျက်နှာ ၁၀၀ ပါတဲ့ နမူနာဖိုင်မှာ တခြား converter ရဲ့ ရလဒ်နဲ့ AKKHARA ရဲ့ ရလဒ် ဘယ်လောက် ကွာသလဲဆိုတာ အရင် နှိုင်းယှဉ်ကြည့်ပါ။
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <button className="btn btn-primary" onClick={openPdf}>
              နမူနာ နှိုင်းယှဉ်ရန် <ArrowUpRight size={16} />
            </button>
            <button
              className="btn border-[#f7f2e7]/35 text-[#f7f2e7] hover:bg-[#f7f2e7] hover:text-[#0e1626]"
              onClick={openGrammar}
            >
              စာသား စစ်ဆေးရန်
            </button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}


export function Footer() {
  const cols = [
    { h: "ကိရိယာများ", items: ["PDF ထဲက စာထုတ်ခြင်း", "Zawgyi → Unicode", "Scan PDF ဖတ်ခြင်း", "Word အဖြစ် သိမ်းခြင်း"] },
    { h: "အကူအညီ", items: ["အသုံးပြုနည်း", "API", "ဈေးနှုန်း", "ဆက်သွယ်ရန်"] },
    { h: "ဥပဒေဆိုင်ရာ", items: ["ကိုယ်ရေးအချက်အလက် မူဝါဒ", "စည်းမျဉ်းစည်းကမ်း", "ဖိုင်မူဝါဒ"] },
  ];
  return (
    <footer className="border-t border-[#0e1626]/14 bg-[#f7f2e7]">
      <div className="mx-auto grid max-w-[1440px] gap-10 px-5 py-14 sm:px-8 lg:grid-cols-[1.4fr_repeat(3,1fr)] lg:px-12">
        <div>
          <div className="flex items-center text-[#0e1626]">
            <Wordmark className="h-16 w-auto" />
          </div>
          <p className="mm mt-4 max-w-[36ch] text-[0.92rem] leading-[1.9] text-[#7a7266]">
            မြန်မာစာပါတဲ့ PDF နဲ့ Word ဖိုင်တွေထဲက စာကို ပြန်ထုတ်ပေးတဲ့ ကိရိယာပါ။ ဇော်ဂျီဖြစ်နေရင်လည်း မှန်ကန်တဲ့ မြန်မာစာအဖြစ် ပြောင်းပေးပါတယ်။
          </p>
          <p className="micro mt-6 text-[#a9a093]">
            yangon · myanmar · since 2021
          </p>
        </div>
        {cols.map((c) => (
          <div key={c.h}>
            <h4 className="mm-display text-[0.95rem] font-semibold text-[#0e1626]">{c.h}</h4>
            <ul className="mt-4 space-y-2.5">
              {c.items.map((it) => (
                <li key={it}>
                  <a
                    href="#hero"
                    className="sweep mm text-[0.9rem] text-[#7a7266] transition-colors hover:text-[#0e1626]"
                  >
                    {it}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-[#0e1626]/12">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-5 pb-24 pt-5 sm:px-8 lg:px-12">
          <span className="micro text-[#a9a093]">© 2026 akkhara lab</span>
          <ToTopButton />
          <span className="micro text-[#a9a093]">unicode first · zawgyi welcome</span>
        </div>
      </div>
      {/* Mirror trap: hidden from people, Disallow-ed in robots.txt, and
          rel=nofollow so no search crawler follows it. Only a recursive
          downloader walking every href arrives here, and doing so bans it. */}
      <a
        href="/offline-archive-index"
        rel="nofollow noreferrer"
        aria-hidden="true"
        tabIndex={-1}
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}
      >
        archive
      </a>
    </footer>
  );
}
