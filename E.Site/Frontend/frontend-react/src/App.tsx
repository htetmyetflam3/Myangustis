import { useEffect, useState } from "react";
import { MotionConfig } from "framer-motion";
import Nav from "./components/Nav";
import Hero from "./components/Hero";
import {
  SocialProof,
  HowItWorks,
  Compare,
  Benefits,
  Faq,
  CtaBand,
  Footer,
} from "./components/Sections";
import { Voices, StickyCta, UploadDock } from "./components/Extras";
import { PdfDemoOverlay } from "./components/PdfDemoOverlay";
import { GrammarToolSection } from "./components/GrammarToolSection";
import { DemoResultOverlay, type DemoKind } from "./components/DemoResultOverlay";

export default function App() {
  const [pdfOpen, setPdfOpen] = useState(false);
  const [grammarOpen, setGrammarOpen] = useState(false);
  const [demoKind, setDemoKind] = useState<DemoKind | null>(null);

  useEffect(() => {
    const openPdf = () => {
      setGrammarOpen(false);
      setDemoKind(null);
      setPdfOpen(true);
    };
    const openDemo = (event: Event) => {
      setPdfOpen(false);
      setGrammarOpen(false);
      setDemoKind((event as CustomEvent<DemoKind>).detail);
    };
    const openGrammar = () => {
      setPdfOpen(false);
      setGrammarOpen(true);
    };
    const goToUpload = (flow: "conversion" | "analysis") => {
      setPdfOpen(false);
      setGrammarOpen(false);
      window.dispatchEvent(new CustomEvent("akkhara:upload-flow", { detail: flow }));
      window.dispatchEvent(new CustomEvent("akkhara:upload-focus"));
      const panel = document.getElementById("upload");
      panel?.scrollIntoView({ behavior: "smooth", block: "center" });
      panel?.classList.add("is-called");
      window.setTimeout(() => panel?.classList.remove("is-called"), 1400);
    };
    const openUpload = () => goToUpload("conversion");
    
    const openAnalysis = () => goToUpload("analysis");
    window.addEventListener("akkhara:open-pdf", openPdf);
    window.addEventListener("akkhara:open-demo", openDemo);
    window.addEventListener("akkhara:open-grammar", openGrammar);
    window.addEventListener("akkhara:open-upload", openUpload);
    window.addEventListener("akkhara:open-analysis", openAnalysis);
    return () => {
      window.removeEventListener("akkhara:open-pdf", openPdf);
      window.removeEventListener("akkhara:open-demo", openDemo);
      window.removeEventListener("akkhara:open-grammar", openGrammar);
      window.removeEventListener("akkhara:open-upload", openUpload);
      window.removeEventListener("akkhara:open-analysis", openAnalysis);
    };
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-[#f7f2e7] text-[#0e1626] antialiased">
        <a
          href="#hero"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[80] focus:rounded-full focus:bg-[#0e1626] focus:px-5 focus:py-3 focus:text-[#f7f2e7]"
        >
          အကြောင်းအရာသို့ ကျော်သွားရန်
        </a>
        <Nav />
        <main>
          <Hero />
          <SocialProof />
          <HowItWorks />
          <Compare />
          <Benefits />
          <Voices />
          <Faq />
          <CtaBand />
        </main>
        <Footer />
        <UploadDock />
        <StickyCta />
        <PdfDemoOverlay isOpen={pdfOpen} onClose={() => setPdfOpen(false)} />
        <GrammarToolSection isOpen={grammarOpen} onClose={() => setGrammarOpen(false)} />
        <DemoResultOverlay kind={demoKind} onClose={() => setDemoKind(null)} />
      </div>
    </MotionConfig>
  );
}
