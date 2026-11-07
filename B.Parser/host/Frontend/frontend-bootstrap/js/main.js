import { initPdfDemo } from "./pdf-demo.js";
import { initDemoResult } from "./demo-result.js";
import { initGrammarTool } from "./grammar-tool.js";
import { initUploadTool } from "./upload-tool.js";
import { closeOverlay, openOverlay } from "./overlay.js";
const nav = document.getElementById("nav");
const burger = document.getElementById("navBurger");
const onNavScroll = () => nav.classList.toggle("is-scrolled", window.scrollY > 24);
onNavScroll();
window.addEventListener("scroll", onNavScroll, { passive: true });
new MutationObserver(() => nav.classList.toggle("glass", nav.classList.contains("is-scrolled")))
  .observe(nav, { attributes: true, attributeFilter: ["class"] });
burger.addEventListener("click", () => {
  const open = nav.classList.toggle("is-open");
  burger.setAttribute("aria-expanded", String(open));
});
document.querySelectorAll("[data-nav-close]").forEach((link) =>
  link.addEventListener("click", () => {
    nav.classList.remove("is-open");
    burger.setAttribute("aria-expanded", "false");
  })
);
const scrollToHero = () =>
  document.getElementById("hero")?.scrollIntoView({ behavior: "smooth", block: "start" });
document.querySelectorAll("[data-open-pdf]").forEach((el) =>
  el.addEventListener("click", () => openOverlay("pdf"))
);
document.querySelectorAll("[data-open-pdf-scroll]").forEach((el) =>
  el.addEventListener("click", () => {
    nav.classList.remove("is-open");
    burger.setAttribute("aria-expanded", "false");
    scrollToHero();
    window.setTimeout(() => openOverlay("pdf"), 440);
  })
);
const setUploadFlow = (flow) =>
  window.dispatchEvent(new CustomEvent("akkhara:upload-flow", { detail: flow }));

const goToUpload = (flow) => {
  nav.classList.remove("is-open");
  burger.setAttribute("aria-expanded", "false");
  setUploadFlow(flow);
  const panel = document.getElementById("upload");
  panel?.scrollIntoView({ behavior: "smooth", block: "center" });
  panel?.classList.add("is-called");
  window.setTimeout(() => panel?.classList.remove("is-called"), 1400);
  window.dispatchEvent(new CustomEvent("akkhara:upload-focus"));
};
document
  .querySelectorAll("[data-open-upload-scroll]")
  .forEach((el) => el.addEventListener("click", () => goToUpload("conversion")));
document.querySelectorAll("[data-open-analysis]").forEach((el) =>
  el.addEventListener("click", () => {
    closeOverlay();
    goToUpload("analysis");
  })
);
document.querySelectorAll("[data-open-grammar-scroll]").forEach((el) =>
  el.addEventListener("click", () => {
    scrollToHero();
    window.setTimeout(() => openOverlay("grammar"), 450);
  })
);
const track = document.getElementById("heroTrack");
const scenes = document.querySelectorAll("#heroTrack > .lp-slide").length || 1;
let scene = 0;
function setScene(next) {
  scene = ((next % scenes) + scenes) % scenes;
  track.style.transform = `translateX(-${scene * 100}%)`;
}
window.setInterval(() => setScene(scene + 1), 5000);
const TAGS = [
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
document.getElementById("proofMarquee").innerHTML = [...TAGS, ...TAGS]
  .map(
    (tag) =>
      `<span class="ak-marquee-item mm"><span class="ak-marquee-dot"></span>${tag}</span>`
  )
  .join("");
const ROWS = [
  { label: "ယူနီကုဒ် PDF", cells: ["yes", "part", "yes"], notes: ["အများအားဖြင့် ရတယ်", "မလိုအပ်ဘဲ ပုံကနေ ဖတ်", "တိုက်ရိုက် ထုတ်ပေး"] },
  { label: "ဇော်ဂျီ PDF", cells: ["part", "part", "yes"], notes: ["စာပျောက်၊ ပုံပျက်တတ်", "ပုံကနေ ခန့်မှန်းရ", "ဇော်ဂျီကို မှန်အောင် ဖတ်"] },
  { label: "Scan ဖတ်ထားတဲ့ PDF", cells: ["no", "yes", "part"], notes: ["စာသား မပါလို့ မရ", "ဒီအတွက် သုံးရတာ", "ပုံ ကြည်လင်မှုအပေါ် မူတည်"] },
  { label: "ကူးယူ၊ ရှာဖွေလို့ရတဲ့ စာသား", cells: ["yes", "part", "yes"], notes: ["ဖိုင်ပေါ် မူတည်", "အမှား ပြန်စစ်ရ", "ယူနီကုဒ်အဖြစ် ထွက်"] },
  { label: "TXT / Word အဖြစ် သိမ်းခြင်း", cells: ["part", "part", "yes"], notes: ["tool အလိုက် ကွာ", "tool အလိုက် ကွာ", "TXT + Word"] },
  { label: "မူရင်းနဲ့ တိုက်စစ်နိုင်ခြင်း", cells: ["part", "yes", "yes"], notes: ["ကိုယ်တိုင် စစ်ရ", "ကိုယ်တိုင် စစ်ရ", "မူရင်းနဲ့ ဘေးချင်းယှဉ်"] },
];
const HEAD = ["Other converters", "Basic OCR", "AKKHARA"];
const CHECK_SVG =
  '<svg width="14" height="14" fill="none" stroke="#eafff5" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="#i-check"></use></svg>';
const MINUS_SVG =
  '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="#i-minus"></use></svg>';
function mark(kind) {
  if (kind === "yes")
    return `<span class="ak-mk is-yes"><span class="ak-mk-ico">${CHECK_SVG}</span><span class="micro">full</span></span>`;
  if (kind === "part")
    return `<span class="ak-mk is-part"><span class="ak-mk-ico">${MINUS_SVG}</span><span class="micro">partial</span></span>`;
  return `<span class="ak-mk is-no"><span class="ak-mk-ico">${MINUS_SVG}</span><span class="micro">none</span></span>`;
}
document.getElementById("cmpRows").innerHTML = ROWS.map(
  (row, i) => `
      <tr class="reveal is-fast" style="--reveal-y: 14px; --reveal-delay: ${i * 0.06}s">
        <td class="is-crit mm">${row.label}</td>
        ${row.cells
          .map(
            (cell, j) => `<td>${mark(cell)}<div class="ak-cmp-note mm${j === 2 ? " is-us" : ""}">${row.notes[j]}</div></td>`
          )
          .join("")}
      </tr>`
).join("");
document.getElementById("cmpCards").innerHTML = ROWS.map(
  (row, i) => `
      <article class="ak-cmp-card reveal is-fast" style="--reveal-y: 14px; --reveal-delay: ${i * 0.04}s" role="row">
        <h3 class="mm">${row.label}</h3>
        <div class="ak-cmp-rows">
          ${row.cells
            .map(
              (cell, j) => `
            <div class="ak-cmp-row${j === 2 ? " is-us" : ""}" role="cell">
              <div class="min-w-0">
                <div class="ak-cmp-row-h mm">${HEAD[j]}</div>
                <div class="ak-cmp-note mm${j === 2 ? " is-us" : ""}">${row.notes[j]}</div>
              </div>
              ${mark(cell)}
            </div>`
            )
            .join("")}
        </div>
      </article>`
).join("");
const ICONS = {
  scanText:
    '<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="#i-scan-lines"></use></svg>',
  layers:
    '<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="#i-layers"></use></svg>',
  check:
    '<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="#i-check"></use></svg>',
  keyboard:
    '<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="#i-keyboard"></use></svg>',
  arrowUpRight:
    '<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="#i-arrow-up-right"></use></svg>',
};
const BENEFITS = [
  { icon: "scanText", t: "ဇော်ဂျီဖိုင်ကိုပါ ဖတ်ပေးတယ်", d: "တခြား converter တွေမှာ မြန်မာစာ ပျောက်သွားတတ်တဲ့ ဖိုင်မျိုးကို မှန်ကန်တဲ့ မြန်မာစာအဖြစ် ပြန်ထုတ်ပေးပါတယ်။" },
  { icon: "layers", t: "စာမျက်နှာတိုင်းကို သီးသန့် စစ်တယ်", d: "ဖိုင်တစ်ခုလုံးကို တစ်မျိုးတည်း မှတ်မယူဘဲ စာမျက်နှာတစ်ခုချင်းစီကို စစ်ပြီး လိုအပ်တာကို ပြောင်းပေးပါတယ်။" },
  { icon: "check", t: "မူရင်းနဲ့ ဘေးချင်းယှဉ်ကြည့်လို့ရတယ်", d: "ထွက်လာတဲ့ စာသားကို မူရင်းဖိုင်နဲ့ ယှဉ်ပြီး အင်္ဂလိပ်စာ၊ ကွင်းစကွင်းပိတ်နဲ့ စာလုံးအစီအစဉ်တွေ မှန်မမှန် ကိုယ်တိုင် စစ်နိုင်ပါတယ်။" },
  { icon: "keyboard", t: "စာသား ကူးထည့်ပြီးလည်း ပြောင်းလို့ရတယ်", d: "ဖိုင် မတင်ချင်ဘူးဆိုရင် ဇော်ဂျီစာသားကို တိုက်ရိုက် ကူးထည့်ပြီး ယူနီကုဒ်အဖြစ် ပြောင်းနိုင်ပါတယ်။" },
  { icon: "arrowUpRight", t: "TXT ဒါမှမဟုတ် Word အဖြစ် သိမ်းနိုင်တယ်", d: "စစ်ပြီးသား စာသားကို TXT ဒါမှမဟုတ် Word (DOCX) အဖြစ် သိမ်းယူနိုင်ပါတယ်။ ပုံစံရှုပ်တဲ့ စာမျက်နှာတွေကိုတော့ Word မှာ ပြန်စစ်ပေးပါ။" },
  { icon: "scanText", t: "Scan ဖိုင်ဆိုရင် ပုံကြည်မှ ပိုမှန်တယ်", d: "Scan ဖိုင်တွေမှာ ပုံမှုန်နေရင် အဖြေလည်း မှုန်ပါတယ်။ CamScanner၊ Adobe Scan တို့နဲ့ ရိုက်ထားတဲ့ ဖိုင်တွေမှာ အထူးသိသာပါတယ်။ ပုံ မှုန်နေရင် ဘယ်ကိရိယာမှ မှန်အောင် မဖတ်နိုင်ပါဘူး။" },
];
document.getElementById("benefitsGrid").innerHTML = BENEFITS.map(
  (benefit, i) => `
      <div class="reveal" style="--reveal-delay: ${(i % 3) * 0.08}s">
        <div class="ak-ben-cell">
          ${ICONS[benefit.icon]}
          <h3 class="ak-ben-t mm-display">${benefit.t}</h3>
          <p class="ak-ben-d mm">${benefit.d}</p>
          <span class="ak-ben-i micro">0${i + 1} / benefit</span>
        </div>
      </div>`
).join("");
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
const PLUS_SVG =
  '<svg class="ak-faq-plus" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="#i-plus"></use></svg>';
const FAQ_MINUS_SVG =
  '<svg class="ak-faq-minus" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="#i-minus"></use></svg>';
const faqList = document.getElementById("faqList");
faqList.innerHTML = FAQ.map(
  (item, i) => `
      <div class="reveal" style="--reveal-y: 16px; --reveal-delay: ${i * 0.05}s">
        <div class="ak-faq-item${i === 0 ? " is-open" : ""}">
          <button type="button" class="ak-faq-q" aria-expanded="${i === 0}">
            <span class="ak-faq-n font-mono2">0${i + 1}</span>
            <span class="ak-faq-t mm">${item.q}</span>
            <span class="ak-faq-ico">${PLUS_SVG}${FAQ_MINUS_SVG}</span>
          </button>
          <div class="ak-faq-a"><p class="mm">${item.a}</p></div>
        </div>
      </div>`
).join("");
faqList.querySelectorAll(".ak-faq-q").forEach((button) =>
  button.addEventListener("click", () => {
    const item = button.closest(".ak-faq-item");
    const wasOpen = item.classList.contains("is-open");
    faqList.querySelectorAll(".ak-faq-item").forEach((other) => {
      other.classList.remove("is-open");
      other.querySelector(".ak-faq-q").setAttribute("aria-expanded", "false");
    });
    if (!wasOpen) {
      item.classList.add("is-open");
      button.setAttribute("aria-expanded", "true");
    }
  })
);
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-in");
      observer.unobserve(entry.target);
    });
  },
  { threshold: 0.2 }
);
document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));
document.getElementById("toTop")?.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});

const sticky = document.getElementById("stickyCta");
let stickyGone = false;
const onStickyScroll = () => sticky.classList.toggle("is-show", !stickyGone && window.scrollY > 760);
onStickyScroll();
window.addEventListener("scroll", onStickyScroll, { passive: true });
document.getElementById("stickyClose").addEventListener("click", () => {
  stickyGone = true;
  sticky.classList.remove("is-show");
});
initPdfDemo();
initDemoResult();
initGrammarTool();
initUploadTool();