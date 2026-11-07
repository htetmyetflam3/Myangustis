import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Check, Copy, Sparkles, X, Upload } from "lucide-react";
import { detectZawgyi, zawgyiToUnicode } from "../lib/pdf";
import { copyText } from "../lib/grammar";

const EASE: [number, number, number, number] = [0.2, 0.8, 0.2, 1];

const SAMPLE_ZG =
  "ကျွန်ုပ်တို့ နိုင်ငံ တွင္ စာပေ များ စွာ ရှိသည္။ ဟောင်းနေတဲ့ စာသားများကို ဖတ်၍မရဘဲ ထားခဲ့လျှင် မဖြစ်ပါ။ ဒီနေရာတွင္ ချက်ချင်း ပြောင်းလို့ရသည္။";


/* The header scrolls away with the page now, so the two things a visitor
   still needs from anywhere live here: a dock on the right edge that goes to
   the upload area, and a scroll-to-top in the footer. Mirrors `.ak-dock` and
   `.ak-to-top` in frontend-bootstrap/scss/_mirror.scss. */
export function UploadDock() {
  return (
    <button
      type="button"
      className="ak-dock"
      title="ဖိုင်တင်ရန်"
      aria-label="ဖိုင်တင်ရန် နေရာသို့ သွားရန်"
      onClick={() => window.dispatchEvent(new CustomEvent("akkhara:open-upload"))}
    >
      <Upload className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
    </button>
  );
}

export function ToTopButton() {
  return (
    <button
      type="button"
      className="ak-to-top"
      aria-label="စာမျက်နှာ အပေါ်ဆုံးသို့ ပြန်တက်ရန်"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m18 15-6-6-6 6" />
      </svg>
      <span className="mm">အပေါ်ဆုံးသို့</span>
    </button>
  );
}

export function QuickConvert() {
  const [input, setInput] = useState("");
  const [copied, setCopied] = useState(false);

  const isZg = useMemo(() => (input.trim() ? detectZawgyi(input) : false), [input]);
  const output = useMemo(
    () => (input ? (detectZawgyi(input) ? zawgyiToUnicode(input) : input) : ""),
    [input]
  );

  return (
    <section id="tool" className="border-y border-[#0e1626]/12 bg-[#efe6d3]/55">
      <div className="mx-auto max-w-[1440px] px-5 py-16 sm:px-8 lg:px-12 lg:py-24">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="micro inline-flex items-center gap-2 text-[#c63b26]">
              <span className="h-px w-6 bg-[#c63b26]" />
              free tool · zawgyi → unicode
            </span>
            <h2 className="mm-display mt-5 max-w-[24ch] text-[clamp(1.8rem,3.8vw,2.9rem)] font-bold leading-[1.18] text-[#0e1626]">
              စာသားပဲ ရှိလား — ဒီမှာ ချက်ချင်း ပြောင်းပါ
            </h2>
          </div>
          <p className="mm max-w-[38ch] text-[0.92rem] leading-[1.9] text-[#7a7266]">
            ဖိုင်မတင်ရဘဲ၊ ရိုက်ထားတဲ့ Zawgyi စာသားကို Unicode အဖြစ် ပြောင်းပေးပါတယ်။
            ဘယ်နေရာမှ မတင်ဘူး — ဘရောက်စာအတွင်းပဲ လုပ်တယ်။
          </p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 26 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ duration: 0.7, ease: EASE }}
          className="hairline mt-8 grid overflow-hidden bg-[#fbf8f1] shadow-[0_40px_80px_-70px_rgba(14,22,38,0.9)] lg:grid-cols-[1fr_auto_1fr]"
        >
          {/* input */}
          <div className="flex min-h-[300px] flex-col p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  input ? (isZg ? "bg-[#c63b26]" : "bg-[#2e7d5b]") : "bg-[#a9a093]"
                }`}
              />
              <span className="micro text-[#7a7266]">မူလစာသား · input</span>
              <span className="font-mono2 ml-auto text-[0.72rem] text-[#7a7266]">
                {input.length}
              </span>
            </div>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              spellCheck={false}
              aria-label="မူလစာသား"
              placeholder="ဤနေရာတွင် Zawgyi စာသားကို ကူးပြီးချပါ…"
              className="mm scrollbar-thin mt-4 min-h-[190px] w-full flex-1 resize-none rounded-lg border border-[#0e1626]/16 bg-white/70 p-4 text-[1rem] leading-[2.05] text-[#0e1626] outline-none transition focus:border-[#c63b26]/60"
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="btn btn-ghost btn-sm" onClick={() => setInput(SAMPLE_ZG)}>
                <Sparkles size={14} /> ဥပမာ ထည့်ရန်
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setInput("");
                }}
              >
                <X size={14} /> ရှင်းရန်
              </button>
            </div>
          </div>

          {/* rail */}
          <div className="relative flex items-center justify-center border-y border-[#0e1626]/12 px-4 py-4 lg:border-x lg:border-y-0 lg:px-3 lg:py-6">
            <span className="grid h-11 w-11 place-items-center rounded-full accent-grad text-white shadow-[0_16px_28px_-18px_rgba(198,59,38,0.9)]">
              <ArrowRight size={18} strokeWidth={2.4} className="rotate-90 lg:rotate-0" />
            </span>
          </div>

          {/* output */}
          <div className="flex min-h-[300px] flex-col p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <span
                className={`micro rounded-full border px-2 py-1 ${
                  !input
                    ? "border-[#0e1626]/18 text-[#7a7266]"
                    : isZg
                      ? "border-[#2e7d5b]/40 bg-[#2e7d5b]/10 text-[#2e7d5b]"
                      : "border-[#0e1626]/18 text-[#7a7266]"
                }`}
              >
                {!input ? "output" : isZg ? "zawgyi ရှာတွေ့ · ပြောင်းပြီး" : "unicode ဖြစ်ပြီးသား"}
              </span>
              <button
                className="ml-auto grid h-8 w-8 place-items-center rounded-full border border-[#0e1626]/18 transition hover:bg-[#0e1626] hover:text-[#f7f2e7] disabled:opacity-35"
                disabled={!output}
                aria-label="ရလဒ် ကူးရန်"
                onClick={async () => {
                  const ok = await copyText(output);
                  setCopied(ok);
                  setTimeout(() => setCopied(false), 1600);
                }}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
            <div className="mt-4 min-h-[190px] flex-1 rounded-lg border border-[#2e7d5b]/30 bg-white/75 p-4">
              {output ? (
                <p className="mm h-full max-h-[280px] overflow-y-auto whitespace-pre-wrap text-[1rem] leading-[2.05] text-[#0e1626] scrollbar-thin">
                  {output}
                </p>
              ) : (
                <div className="flex h-full min-h-[160px] flex-col items-center justify-center gap-2 text-center">
                  <ArrowRight size={22} className="text-[#a9a093]" />
                  <p className="mm text-[0.9rem] text-[#7a7266]">
                    ဘယ်ဘက်မှာ ရိုက်ထည့်လိုက်တာနဲ့ ဒီမှာ ပေါ်လာပါမယ်
                  </p>
                  <p className="micro text-[#a9a093]">live · no upload</p>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}


const VOICES = [
  {
    q: "စာမျက်နှာ ၁၀၀ လုံးကို ဇော်ဂျီမှန်း မှန်မှန်ကန်ကန် သိနိုင်ခဲ့ပြီး တခြား converter တွေမှာ ပျောက်နေတဲ့ မြန်မာစာကို ပြန်ထုတ်ပေးနိုင်ခဲ့ပါတယ်။",
    n: "Checked on the sample file",
    r: "100 pages · cleanup off",
  },
  {
    q: "တခြား converter တွေမှာ အင်္ဂလိပ်စာနဲ့ နံပါတ်တွေ ကျန်ပေမယ့် မြန်မာစာ အများစု ပျောက်သွားတာကို နှိုင်းယှဉ်ဖိုင်တွေမှာ မြင်နိုင်ပါတယ်။",
    n: "Side-by-side evidence",
    r: "the side-by-side files",
  },
  {
    q: "ထွက်လာတဲ့ ရလဒ်က ၁၀၀% တိကျတယ်လို့ မပြောနိုင်ပါဘူး။ အင်္ဂလိပ်စာ၊ ကွင်းစကွင်းပိတ်၊ နေရာလွတ်နဲ့ သင်္ကေတတချို့ကို မူရင်းဖိုင်နဲ့ ပြန်စစ်ပေးဖို့ လိုပါတယ်။",
    n: "Review note",
    r: "what to double-check",
  },
];

export function Voices() {
  return (
    <section id="voices" className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
      <div className="grid gap-8 lg:grid-cols-[0.78fr_1.22fr] lg:gap-14">
        <motion.div
          initial={{ opacity: 0, y: 26 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ duration: 0.7, ease: EASE }}
        >
          <span className="micro inline-flex items-center gap-2 text-[#c63b26]">
            <span className="h-px w-6 bg-[#c63b26]" />
            test notes · စမ်းသပ်မှတ်တမ်း
          </span>
          <div className="hairline relative mt-5 overflow-hidden bg-[#0e1626]">
            <img
              src="images/voices.jpg"
              alt="မြန်မာစာ စာရွက်စာတမ်းများ"
              className="aspect-[4/3] w-full object-cover opacity-90"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0e1626]/85 via-[#0e1626]/15 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-5">
              <p className="micro text-[#f7f2e7]/70">sample · compare · review</p>
            </div>
          </div>
          <p className="mm mt-5 max-w-[34ch] text-[0.9rem] leading-[1.9] text-[#7a7266]">
            Customer testimonial မဟုတ်ပါ — နမူနာဖိုင်ကို အမှန်တကယ် ပြောင်းကြည့်ပြီး မှတ်ထားတဲ့ မှတ်ချက်တွေပါ။
          </p>
        </motion.div>

        <div className="border-t border-[#0e1626]/15">
          {VOICES.map((v, i) => (
            <motion.figure
              key={v.n}
              initial={{ opacity: 0, y: 22 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ duration: 0.65, delay: i * 0.09, ease: EASE }}
              className="group grid gap-4 border-b border-[#0e1626]/15 py-7 sm:grid-cols-[auto_1fr] sm:gap-7"
            >
              <div className="flex items-start gap-3 sm:block">
                <span className="font-display text-[2.6rem] font-black leading-none text-[#c63b26]/28 transition-colors duration-500 group-hover:text-[#c63b26]/70">
                  “
                </span>
                <span className="font-mono2 block text-[0.72rem] text-[#a9a093] sm:mt-1">
                  0{i + 1}
                </span>
              </div>
              <div>
                <blockquote className="mm-quote text-[clamp(1.05rem,1.6vw,1.3rem)] leading-[1.85] text-[#0e1626]">
                  {v.q}
                </blockquote>
                <figcaption className="mt-4 flex flex-wrap items-center gap-3">
                  <span className="mm text-[0.92rem] font-semibold text-[#0e1626]">{v.n}</span>
                  <span className="h-px w-6 bg-[#0e1626]/25" />
                  <span className="micro text-[#7a7266]">{v.r}</span>
                </figcaption>
              </div>
            </motion.figure>
          ))}
        </div>
      </div>
    </section>
  );
}


export function StickyCta() {
  const [show, setShow] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 760);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!show || gone) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4 sm:pb-5">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
        className="glass pointer-events-auto flex w-full max-w-[760px] items-center gap-3 rounded-full border border-[#0e1626]/16 px-3 py-2.5 shadow-[0_30px_60px_-40px_rgba(14,22,38,0.95)] sm:px-4"
      >
        <span className="hidden h-2 w-2 shrink-0 rounded-full accent-grad sm:block" />
        <p className="mm min-w-0 flex-1 truncate text-[0.88rem] text-[#0e1626]">
          ဇော်ဂျီ PDF — <span className="text-[#7a7266]">နမူနာ output ကို ဘေးချင်းယှဉ်ကြည့်ပါ</span>
        </p>
        <button
          className="btn btn-primary btn-sm shrink-0"
          onClick={() => {
            document
              .getElementById("hero")
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
            setTimeout(() => window.dispatchEvent(new CustomEvent("akkhara:open-pdf")), 420);
          }}
        >
          <Upload size={15} /> နှိုင်းယှဉ်ရန်
        </button>
        <button
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#0e1626]/18 text-[#7a7266] transition hover:bg-[#0e1626] hover:text-[#f7f2e7]"
          onClick={() => setGone(true)}
          aria-label="ဒီ အသိပေးချက်ကို ပိတ်ရန်"
        >
          <X size={14} />
        </button>
      </motion.div>
    </div>
  );
}
