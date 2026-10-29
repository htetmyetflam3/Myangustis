/**
 * FILE: frontend-react/src/data/mockData.ts
 *
 * Mirror of frontend-bootstrap/js/grammar-data.js — see the notes there.
 *
 * In short, three things this file is careful about:
 *   1. every defect in `rawText` is declared. `ယနေ႕` (U+1095), `ခေတ္` and
 *      `ပါတယ္` (U+1039 where the asat U+103A belongs) were not, so "Fix All"
 *      claimed every issue was resolved while three Zawgyi words were still
 *      on screen — on a page about Zawgyi correctness. Applying all of the
 *      issues below now reproduces `correctedText` exactly, and
 *      `assertSampleIsConsistent()` checks it.
 *   2. `index` is derived, never hand-written: all six original offsets had
 *      drifted off their words.
 *   3. every `original` is a whole word occurring exactly once, so the
 *      single-pass `String.replace` in the tool cannot land on the wrong one.
 */
export interface GrammarIssue {
  id: string;
  original: string;
  suggestion: string;
  reason: string;
  ruleCategory: 'Spelling' | 'Grammar' | 'Punctuation' | 'Font Standardization';
  index: number;
}

const RAW = `ယနေ႕ခေတ္ နည်းပညာ တို႕တက်လာမူကြောင့် ကျွန်တော်တို အလုပ်လုပ်ရာတွင် အဆင်ပြေခြင်များစွာ ရှိလာပါတယ္။ ရုံးစာရွက်စာတမ်းမျာကို စနစ်တကျ မသိမ်းစည်းပါက အချက်လက် ဆုံးရှုံးနိုင်ပါသည်။`;

const CORRECTED = `ယနေ့ခေတ် နည်းပညာ တိုးတက်လာမှုကြောင့် ကျွန်တော်တို့ အလုပ်လုပ်ရာတွင် အဆင်ပြေခြင်းများစွာ ရှိလာပါသည်။ ရုံးစာရွက်စာတမ်းများကို စနစ်တကျ မသိမ်းဆည်းပါက အချက်အလက် ဆုံးရှုံးနိုင်ပါသည်။`;

const issue = (
  id: string,
  original: string,
  suggestion: string,
  reason: string,
  ruleCategory: GrammarIssue['ruleCategory'],
): GrammarIssue => ({
  id,
  original,
  suggestion,
  reason,
  ruleCategory,
  index: RAW.indexOf(original),
});

export const SAMPLE_GRAMMAR_DOC = {
  rawText: RAW,
  correctedText: CORRECTED,
  issues: [
    issue(
      'iss-1',
      'ယနေ႕ခေတ္',
      'ယနေ့ခေတ်',
      'Zawgyi artifacts: ႕ (U+1095) is ့ (U+1037), and ္ (U+1039) is the asat ် (U+103A)',
      'Font Standardization',
    ),
    issue(
      'iss-2',
      'တို႕တက်လာမူ',
      'တိုးတက်လာမှု',
      'Zawgyi artifact ႕, and the noun suffix is မှု, not မူ',
      'Spelling',
    ),
    issue(
      'iss-3',
      'ကျွန်တော်တို',
      'ကျွန်တော်တို့',
      "Missing tone marker (အောက်မြစ် 'တို့')",
      'Spelling',
    ),
    issue(
      'iss-4',
      'အဆင်ပြေခြင်များစွာ',
      'အဆင်ပြေခြင်းများစွာ',
      'Missing း in ခြင်း',
      'Spelling',
    ),
    issue(
      'iss-5',
      'ရှိလာပါတယ္',
      'ရှိလာပါသည်',
      '္ (U+1039) where the asat ် (U+103A) belongs; ပါသည် also matches the register of the closing sentence',
      'Font Standardization',
    ),
    issue(
      'iss-6',
      'စာရွက်စာတမ်းမျာကို',
      'စာရွက်စာတမ်းများကို',
      'Missing း in များ',
      'Grammar',
    ),
    issue(
      'iss-7',
      'မသိမ်းစည်းပါက',
      'မသိမ်းဆည်းပါက',
      'Correct spelling in Myanmar orthography is သိမ်းဆည်း',
      'Spelling',
    ),
    issue(
      'iss-8',
      'အချက်လက်',
      'အချက်အလက်',
      'Compound noun completeness: အချက်အလက်',
      'Grammar',
    ),
  ] as GrammarIssue[],
};

/** Apply every issue, in order, the way "Fix All" does. */
export const applyAll = (text: string, issues: GrammarIssue[]): string =>
  issues.reduce((acc, i) => acc.replace(i.original, i.suggestion), text);

/** Only the rules that actually match the text in front of the visitor. */
export const applicableIssues = (text: string): GrammarIssue[] =>
  SAMPLE_GRAMMAR_DOC.issues.filter((i) => text.includes(i.original));

/**
 * "All issues resolved" is only true while these hold, so they are asserted
 * rather than trusted: every `original` appears exactly once, and fixing all
 * of them yields `correctedText`.
 */
export function assertSampleIsConsistent(): string[] {
  const problems: string[] = [];
  for (const i of SAMPLE_GRAMMAR_DOC.issues) {
    const hits = RAW.split(i.original).length - 1;
    if (hits !== 1) problems.push(`${i.id}: "${i.original}" occurs ${hits}x, expected 1`);
    if (i.index < 0) problems.push(`${i.id}: not found in the sample text`);
  }
  if (applyAll(RAW, SAMPLE_GRAMMAR_DOC.issues) !== CORRECTED) {
    problems.push('fixing every issue does not reproduce correctedText');
  }
  return problems;
}
