import JSZip from "jszip";
import { detectZawgyi, zawgyiToUnicode } from "./pdf";

function escapeXml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function downloadTxt(text: string, filename: string) {
  downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), filename);
}

export async function downloadDocx(text: string, filename: string) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
  );
  const paras = text
    .split(/\n/)
    .map(
      (l) =>
        `<w:p><w:r><w:t xml:space="preserve">${escapeXml(l)}</w:t></w:r></w:p>`
    )
    .join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`
  );
  const blob = await zip.generateAsync({
    type: "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  downloadBlob(blob, filename);
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export async function readAsText(file: File): Promise<string> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".txt") || lower.endsWith(".md")) return await file.text();
  if (lower.endsWith(".docx")) {
    const zip = await JSZip.loadAsync(file);
    const entry =
      zip.file("word/document.xml") || zip.file("word/document/document.xml");
    if (!entry) return "";
    const xml = await entry.async("string");
    return xml
      .replace(/<\/w:p>/g, "\n")
      .replace(/<w:tab[^>]*\/>/g, "\t")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .trim();
  }
  if (lower.endsWith(".pdf")) {
    const { parsePdf } = await import("./pdf");
    const doc = await parsePdf(file, file.name);
    return doc.text;
  }
  return await file.text();
}

export { detectZawgyi, zawgyiToUnicode };


export type Severity = "high" | "med" | "low";

export type Issue = {
  id: string;
  index: number;
  length: number;
  rule: string;
  label: string;
  found: string;
  suggestion?: string;
  severity: Severity;
  replace?: string;
};

type Rule = {
  id: string;
  label: string;
  severity: Severity;
  re: RegExp;
  replace: (m: string, ...rest: (string | number)[]) => string;
  suggestion: (m: string) => string;
  skipIf?: (m: string) => boolean;
};

const RULES: Rule[] = [
  {
    id: "zg",
    label: "Zawgyi ဖောင်တော်ဖြင့် ရေးထားသည်",
    severity: "high",
    re: /[\s\S]+/g,
    replace: (m) => zawgyiToUnicode(m),
    suggestion: () => "Unicode စာသားအဖြစ် ပြောင်းလဲပါ",
    skipIf: (m) => !detectZawgyi(m),
  },
  {
    id: "asat-stack",
    label: "္ သည် ် (asat) နေရာတွင် မှားယွင်းစွာ သုံးထားသည်",
    severity: "high",
    re: /\u1039(?=[\u102B-\u1038\u1031])/g,
    replace: () => "\u103A",
    suggestion: () => "asat ် ဖြင့် အစားထိုးပါ",
  },
  {
    id: "asat-missing",
    label: "“ပါတယ” တွင် asat ပျောက်နေသည်",
    severity: "high",
    re: /ပါတယ(?!်)/g,
    replace: () => "ပါတယ်",
    suggestion: () => "ပါတယ် ဟု ပြင်ပါ",
  },
  {
    id: "asat-missing2",
    label: "“ရှိတယ” တွင် asat ပျောက်နေသည်",
    severity: "med",
    re: /ရှိတယ(?!်)/g,
    replace: () => "ရှိတယ်",
    suggestion: () => "ရှိတယ် ဟု ပြင်ပါ",
  },
  {
    id: "double-space",
    label: "စပ်စပ် နေရာလွတ်",
    severity: "low",
    re: /[ \t\u00A0]{2,}/g,
    replace: () => " ",
    suggestion: () => "တစ်လုံးတည်း လျှော့ပါ",
  },
  {
    id: "space-before",
    label: "၊ ။ မတိုင်မီ နေရာလွတ် မလိုပါ",
    severity: "low",
    re: /[ \t]+([\u104A\u104B])/g,
    replace: (_m, p1) => String(p1),
    suggestion: (m) => `“${m.trim()}” ကို ရှေ့တန်းဆွဲပါ`,
  },
  {
    id: "space-after",
    label: "၊ ။ နောက် နေရာလွတ် ပျောက်နေသည်",
    severity: "med",
    re: /([\u104A\u104B])(?=[^\s\u104A\u104B])/g,
    replace: (_m, p1) => `${p1} `,
    suggestion: (m) => `“${m}” နောက် နေရာလွတ် ထည့်ပါ`,
  },
  {
    id: "dup-punct",
    label: "၊ ။ ထပ်နေသည်",
    severity: "low",
    re: /([\u104A\u104B])\1+/g,
    replace: (_m, p1) => String(p1),
    suggestion: () => "တစ်ခုတည်း ထားပါ",
  },
  {
    id: "dup-word",
    label: "စကားလုံး ထပ်နေသည်",
    severity: "med",
    re: /([^\s\u104A\u104B]{2,}) \1(?=[\s\u104A\u104B]|$)/g,
    replace: (_m, p1) => String(p1),
    suggestion: (m) => `“${m}” → “${m.split(" ")[0]}”`,
  },
];

function sentencesWithoutFullStop(text: string): {
  index: number;
  length: number;
  found: string;
}[] {
  const out: { index: number; length: number; found: string }[] = [];
  let offset = 0;
  text.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (
      trimmed.length > 12 &&
      !/[\u104B!?"'”’)]$/.test(trimmed) &&
      !/^[-–—•#]/.test(trimmed)
    ) {
      out.push({
        index: offset + line.lastIndexOf(trimmed),
        length: trimmed.length,
        found: trimmed.slice(-14),
      });
    }
    offset += line.length + 1;
  });
  return out;
}

export function runChecks(text: string): Issue[] {
  if (!text.trim()) return [];
  const issues: Issue[] = [];
  let seed = 0;

  const globalZg = detectZawgyi(text);

  RULES.forEach((rule) => {
    if (rule.id === "zg" && !globalZg) return;
    const re = new RegExp(rule.re.source, rule.re.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (rule.skipIf && rule.skipIf(m[0])) {
        if (m.index === re.lastIndex) re.lastIndex++;
        continue;
      }
      issues.push({
        id: `${rule.id}-${seed++}`,
        index: m.index,
        length: m[0].length,
        rule: rule.id,
        label: rule.label,
        found: m[0].slice(0, 40),
        suggestion: rule.suggestion(m[0]),
        severity: rule.severity,
        replace:
          rule.id === "zg"
            ? undefined
            : String(rule.replace(m[0], ...(m.slice(1) as (string | number)[]))),
      });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  });

  sentencesWithoutFullStop(text).forEach((s) => {
    issues.push({
      id: `fullstop-${seed++}`,
      index: s.index,
      length: s.length,
      rule: "fullstop",
      label: "စာကြောင်း နောက်ကုဒ် ။ မပါပါ",
      found: s.found,
      suggestion: "“။” ထည့်ပါ",
      severity: "low",
      replace: text.slice(s.index, s.index + s.length) + "။",
    });
  });

  const rank: Record<Severity, number> = { high: 0, med: 1, low: 2 };
  issues.sort((a, b) => a.index - b.index || rank[a.severity] - rank[b.severity]);
  const kept: Issue[] = [];
  let lastEnd = -1;
  issues.forEach((i) => {
    if (i.index >= lastEnd) {
      kept.push(i);
      lastEnd = i.index + i.length;
    }
  });
  return kept;
}

export function scoreOf(issues: Issue[]) {
  const s = issues.reduce(
    (acc, i) => acc + (i.severity === "high" ? 14 : i.severity === "med" ? 8 : 3),
    0
  );
  return Math.max(18, Math.min(100, 100 - s));
}
