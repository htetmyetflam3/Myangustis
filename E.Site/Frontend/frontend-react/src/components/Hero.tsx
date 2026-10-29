import { useEffect, useState } from "react";
import { FileCheck, FileText, ScanText } from "lucide-react";
import ConverterArt from "./art/ConverterArt";
import { UploadPanel } from "./UploadPanel";

function openDemo(kind: "pdf" | "docx" | "scan") {
  window.dispatchEvent(new CustomEvent("akkhara:open-demo", { detail: kind }));
}

function LiveDot() {
  return (
    <svg className="lp-live" viewBox="0 0 14 14" aria-hidden="true">
      <circle className="lp-live-halo" cx="7" cy="7" r="3.25" />
      <circle className="lp-live-dot" cx="7" cy="7" r="3.25" />
    </svg>
  );
}

function ChipDot() {
  return (
    <svg className="lp-chip-dot" viewBox="0 0 14 14" aria-hidden="true">
      <circle className="lp-chip-halo" cx="7" cy="7" r="3.25" />
      <circle className="lp-chip-core" cx="7" cy="7" r="3.25" />
    </svg>
  );
}

const SCENES = [
  {
    chip: "01 / pdf · docx",
    top: "ယူနီကုဒ်နဲ့ ရိုက်ထားတဲ့",
    grad: "PDF · DOCX",
    lead: "PDF နဲ့ Word (DOCX) ဖိုင်တွေထဲက စာကို စာပိုဒ်၊ ခေါင်းစဉ် ပုံစံအတိုင်း ပြန်ထုတ်ပေးပါတယ်။ ထွက်လာတဲ့ စာသားကို ကူးယူလို့၊ ရှာဖွေလို့၊ ပြန်တည်းဖြတ်လို့ ရပါတယ်။",
    note: "ဒီလို ယူနီကုဒ်ဖိုင်တွေကိုတော့ အွန်လိုင်းမှာ ရှိတဲ့ multi language converter အများစုကလည်း ဖတ်နိုင်ပါတယ်။",
    en: "Unicode PDFs and Word files. The text comes back with its paragraphs and headings in place.",
  },
  {
    chip: "02 / pdf → word · ဇော်ဂျီ",
    top: "မြန်မာစာ မပေါ်တဲ့",
    grad: "ဇော်ဂျီ PDF",
    lead: "PDF ကို Microsoft Word ဒါမှမဟုတ် အွန်လိုင်း converter နဲ့ ပြောင်းကြည့်တဲ့အခါ မြန်မာစာ လုံးဝ မထွက်တာ၊ စာလုံးတွေ ပုံပျက်နေတာ ကြုံဖူးမှာပါ။ အဲဒီဖိုင်တွေက ယူနီကုဒ် မဟုတ်ဘဲ ဇော်ဂျီနဲ့ ရိုက်ထားလို့ပါ။ ဇော်ဂျီကို သီးသန့်နည်းနဲ့ ပြန်ဖတ်မှ ရပါတယ်။",
    note: "AKKHARA က ဒီလိုဖိုင်မျိုးကို မှန်ကန်တဲ့ မြန်မာစာအဖြစ် ပြောင်းပေးပါတယ်။",
    en: "Open a Zawgyi PDF in Word or an online converter and the Myanmar text comes out blank or scrambled. AKKHARA reads it properly.",
  },
  {
    chip: "03 / scan pdf · ဓာတ်ပုံ",
    top: "ဓာတ်ပုံအဖြစ်သာ ရှိတဲ့",
    grad: "Scan PDF",
    lead: "Scan ဖတ်ထားတဲ့ စာမျက်နှာမှာ စာလုံးဆိုတာ မရှိပါဘူး — ဓာတ်ပုံပဲ ရှိတာပါ။ ဒါကြောင့် ပုံထဲက စာကို ဖတ်ပြီး စာသားအဖြစ် ပြန်ရေးပေးတဲ့ OCR လိုအပ်ပါတယ်။ AKKHARA ရဲ့ OCR ကို မြန်မာစာအတွက် သီးသန့် ပြင်ဆင်ထားပါတယ်။",
    note: "Scan ဖိုင်တွေမှာ ပုံမှုန်နေရင် အဖြေလည်း မှုန်ပါတယ်။ CamScanner၊ Adobe Scan တို့နဲ့ ရိုက်ထားတဲ့ ဖိုင်တွေမှာ အထူးသိသာပါတယ်။",
    en: "A scanned page is a picture, not text. OCR reads the picture — how clear the scan is decides how good the result is.",
  },
];

export default function Hero() {
  const [scene, setScene] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setScene((n) => (n + 1) % (SCENES.length + 1)), 5000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <section id="hero">
      <div className="lp-hero lp-wrap" id="heroSlider">
        <div className="lp-hero-kicker">
          <span className="lp-kicker ak-micro">myanmar pdf → text you can use</span>
          <span className="ak-micro" style={{ color: "#7c7466" }}>
            pdf · docx · scanned pdf · txt
          </span>
        </div>

        <div className="lp-hero-grid">
          <div className="lp-desktop">
            <div className="lp-frame">
              <div className="lp-chrome lp-chrome-blue">
                <LiveDot />
                <span className="lp-chrome-title">Myanmar text your other tools could not read</span>
              </div>

              <div className="lp-stage">
                <div className="lp-track" id="heroTrack" style={{ transform: `translateX(-${scene * 100}%)` }}>
                  <div className="lp-slide lp-slide-art">
                    <div className="lp-screen">
                      <ConverterArt />
                    </div>
                  </div>

                  {SCENES.map((sc) => (
                    <div className="lp-slide lp-slide-text" key={sc.chip}>
                      <div className="lp-text-scene">
                        <div className="lp-chip is-blue">
                          <ChipDot />
                          <span>{sc.chip}</span>
                        </div>
                        <p className="lp-h1">
                          {sc.top}
                          <br />
                          <span className="lp-grad">{sc.grad}</span>
                        </p>
                        <p className="lp-lead">{sc.lead}</p>
                        <p className={sc.mm === false ? "lp-note" : "lp-note mm"}>{sc.note}</p>
                        <p className="lp-en">{sc.en}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="lp-demo-bar">
                <p className="lp-demo-title">Try a converted sample, then edit the text</p>
                <div className="lp-demo-btns" role="group" aria-label="Open a converted sample">
                  <button type="button" className="lp-demo-btn" onClick={() => openDemo("pdf")}>
                    <FileText className="h-4 w-4" aria-hidden="true" /> Zawgyi PDF
                  </button>
                  <button type="button" className="lp-demo-btn" onClick={() => openDemo("docx")}>
                    <FileCheck className="h-4 w-4" aria-hidden="true" /> DOCX
                  </button>
                  <button type="button" className="lp-demo-btn" onClick={() => openDemo("scan")}>
                    <ScanText className="h-4 w-4" aria-hidden="true" /> Scan PDF
                  </button>
                </div>
              </div>
            </div>


          </div>

          <UploadPanel />
        </div>
      </div>
    </section>
  );
}
