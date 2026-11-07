import { getViablePos, getCompoundRefs } from '../../abstract/baseline.js';

[
  '§24', '§25', '§31', '§34', '§28-က', '§28-ခ',
  '§27-က', '§27-ခ', '§28', '§29', '§30', '§42'
].forEach((r) => W.register('adjective', r, 0.8));

function classify(tokens, index, context) {
  const { L, W } = context;
  const t = tokens[index];
  if (!t) return null;

  /* ── baseline filter ── */
  const { viable } = getViablePos(t, context, index);
  const canBeAdj = viable.has('dj') || t.rawPos?.includes('dj');
  if (!canBeAdj) return null;

  const text = t.text;
  const matches = [];
  const prev = tokens[index - 1];
  const next = tokens[index + 1];

  const nextIsNoun = next && (
    next.rawPos?.includes('n') ||
    getViablePos(next, context, index + 1).viable.has('n')
  );

  /* §24  quality adj → noun */
  if (t.rawPos?.includes('dj') && nextIsNoun) {
    matches.push({
      id: 'adj-§24',
      module: 'adjective',
      category: 'နာမဝိသေသန',
      type: 'ဂုဏ်ရည်ပြနာမဝိသေသန',
      scope: 'quality_direct',
      rule_ref: '§24',
      confidence: 0.9,
      note: 'Quality adjective: directly modifies following noun.',
    });
  }

  /* §25  attributive  (adj + သော/သည့်/မည့်) */
  if (t.rawPos?.includes('dj') && next && L.isAdjFormer(next.text)) {
    matches.push({
      id: 'adj-§25',
      module: 'adjective',
      category: 'နာမဝိသေသန',
      type: 'ဂုဏ်ရည်ပြနာမဝိသေသန',
      scope: 'quality_attributive',
      rule_ref: '§25',
      confidence: 0.9,
      note: 'Attributive adjective: adj + သော/သည့်/မည့် + noun.',
    });
  }

  /* §31  numeral adj */
  const isNumber = t.rawPos?.includes('num') || /^\d+$/.test(text);
  if (isNumber && nextIsNoun) {
    matches.push({
      id: 'adj-§31',
      module: 'adjective',
      category: 'နာမဝိသေသန',
      type: 'သင်္ချာနာမဝိသေသန',
      scope: 'numeral_attributive',
      rule_ref: '§31',
      confidence: 0.9,
      note: 'Numeral adjective: number modifies noun.',
    });
  }

  /* §34  interrogative adj  (closed class — safe to list) */
  if (L.INTERROGATIVE_ADJ?.includes(text) && nextIsNoun) {
    matches.push({
      id: 'adj-§34',
      module: 'adjective',
      category: 'နာမဝိသေသန',
      type: 'အမေးနာမဝိသေသန',
      scope: 'interrogative_attributive',
      rule_ref: '§34',
      confidence: 0.9,
      note: 'Interrogative adjective: modifies noun in question.',
    });
  }

  /* §42  demonstrative adj  (closed class) */
  if (L.DEMONSTRATIVE_ADJ?.has(text) && nextIsNoun) {
    matches.push({
      id: 'adj-§42',
      module: 'adjective',
      category: 'နာမဝိသေသန',
      type: 'အညွှန်းနာမဝိသေသန',
      scope: 'demonstrative_adjective',
      rule_ref: '§42',
      confidence: 0.9,
      note: 'Demonstrative adjective: modifies following noun.',
    });
  }

  /* §27-ခ  compound adj  — baseline owns this now */
  const compoundRefs = getCompoundRefs(t, context, index, 'dj');
  if (compoundRefs.length > 0) {
    matches.push({
      id: 'adj-§27-ခ',
      module: 'adjective',
      category: 'နာမဝိသေသန',
      type: 'ပေါင်းစပ်နာမဝိသေသန',
      scope: 'compound',
      rule_ref: '§27-ခ',
      confidence: 0.85,
      note: 'Compound adjective: noun+adj or adj+adj.',
    });
  }

  /* §28  degree adj  — pattern-based, NOT static list */
  if (isDegreePattern(text)) {
    matches.push({
      id: 'adj-§28',
      module: 'adjective',
      category: 'နာမဝိသေသန',
      type: 'အဆင့်ပြနာမဝိသေသန',
      scope: 'degree',
      rule_ref: '§28',
      confidence: 0.8,
      note: 'Degree adjective: positive/comparative/superlative.',
    });
  }

  /* §27-က  simple fallback */
  if (t.rawPos?.includes('dj') && matches.length === 0) {
    matches.push({
      id: 'adj-§27-က',
      module: 'adjective',
      category: 'နာမဝိသေသန',
      type: 'ပင်ကိုနာမဝိသေသန',
      scope: 'simple',
      rule_ref: '§27-က',
      confidence: 0.75,
      note: 'Simple adjective: no special semantic type.',
    });
  }

  return matches.length ? matches : null;
}

/* pattern-based degree detection  (replaces 50-item static list) */
function isDegreePattern(text) {
  return /^(သာ၍|ပို၍|အျ).+(ဆုံး|သော)$/.test(text);
}

export { classify };
