import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, X, ArrowUpRight } from "lucide-react";

const LINKS = [
  { href: "#how", label: "ဘယ်လိုအလုပ်လုပ်လဲ" },
  { href: "#compare", label: "နှိုင်းယှဉ်ချက်" },
  { href: "#features", label: "အကျိုးကျေးဇူးများ" },
  { href: "#faq", label: "မေးခွန်းများ" },
];

const MARK_SOURCE = `${import.meta.env.BASE_URL}images/akkhara-logo.svg`;
const WORDMARK_SOURCE = `${import.meta.env.BASE_URL}images/akkhara-wordmark.svg`;

/** The mark redraws itself, slides into the first-letter slot and the rest of
 *  အက္ခရာ is written beside it. All of the motion lives inside the SVG. */
export function Wordmark({ className = "h-14" }: { className?: string }) {
  return (
    <img
      className={`brand-wordmark ${className}`}
      src={WORDMARK_SOURCE}
      alt="အက္ခရာ — AKKHARA"
      draggable="false"
    />
  );
}

export function Mark({ className = "h-9 w-11" }: { className?: string }) {
  return (
    <span className={`brand-mark ${className}`} aria-hidden="true">
      <span className="brand-mark-wiggle">
        <span className="brand-mark-flip">
          <img src={MARK_SOURCE} alt="" draggable="false" />
        </span>
      </span>
    </span>
  );
}

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const openUpload = () => {
    setOpen(false);
    document
      .getElementById("hero")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.dispatchEvent(new CustomEvent("akkhara:open-upload"));
  };

  return (
    <header
      className={`relative z-50 transition-all duration-500 ${
        scrolled
          ? "glass shadow-[0_10px_40px_-30px_rgba(14,22,38,0.9)] border-b border-[#0e1626]/12"
          : "border-b border-transparent"
      }`}
    >
      <div className="mx-auto flex max-w-[1440px] items-center gap-6 px-5 py-3.5 sm:px-8 lg:px-12">
        <a href="#hero" className="flex items-center gap-3 text-[#0e1626]">
          <Mark />
          <span className="leading-none">
            <span className="block font-display text-[1.35rem] font-black tracking-tight">
              AKKHARA
            </span>
            <span className="micro block text-[#7a7266]">myanmar pdf lab</span>
          </span>
        </a>

        <nav className="ml-auto hidden items-center gap-8 lg:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="sweep mm text-[0.92rem] font-medium text-[#0e1626]/80 transition-colors hover:text-[#0e1626]"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3 lg:ml-0">
          <button
            onClick={openUpload}
            className="btn btn-primary btn-sm hidden sm:inline-flex"
            aria-label="PDF တင်ရန်"
          >
            PDF တင်ရန်
            <ArrowUpRight size={16} strokeWidth={2.4} />
          </button>
          <button
            className="grid h-10 w-10 place-items-center rounded-full border border-[#0e1626]/20 lg:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label="မီနူး ဖွင့်ရန်"
            aria-expanded={open}
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden border-t border-[#0e1626]/10 glass lg:hidden"
          >
            <div className="flex flex-col gap-1 px-5 py-4">
              {LINKS.map((l, i) => (
                <motion.a
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.06 * i + 0.05 }}
                  className="mm rounded-lg px-2 py-3 text-[1rem] font-medium text-[#0e1626] hover:bg-[#0e1626]/6"
                >
                  {l.label}
                </motion.a>
              ))}
              <button onClick={openUpload} className="btn btn-primary mt-2 w-full">
                PDF တင်ရန်
                <ArrowUpRight size={16} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
