import { getViablePos, getCompoundRefs } from '../../abstract/baseline.js';

['§22-က', '§22-ခ', '§22-ဂ', '§16', '§17', '§18'].forEach((r) =>
  W.register('verb', r, 0.85),
);

function classify(tokens, index, context) {
  const { L, W } = context;
  const t = tokens[index];
  if (!t) return null;

  /* baseline filter */
  const { viable } = getViablePos(t, context, index);
  const canBeVerb = viable.has('v') || t.rawPos?.includes('v');
  if (!canBeVerb) return null;

  const text = t.text;
  const matches = [];
  const prev = tokens[index - 1];

  /* §22-ဂ  existence verb  (closed class) */
  if (text === 'ရှိ' || text === 'တည်ရှိ') {
    matches.push({
      id: 'verb-§22-ဂ',
      module: 'verb',
      category: 'ကြိယာ',
      type: 'ရှိခြင်းပြကြိယာ',
      scope: 'existence',
      rule_ref: '§22-ဂ',
      confidence: 0.95,
      note: 'Existence verb: denotes being/having.',
    });
  }

  /* §17  qualitative verb  (adj + tense particle) */
  if (prev && prev.rawPos?.includes('dj') && L.isPresentPastShared(text)) {
    matches.push({
      id: 'verb-§17',
      module: 'verb',
      category: 'ကြိယာ',
      type: 'ဂုဏ်ရည်ပြကြိယာ',
      scope: 'qualitative_verb',
      rule_ref: '§17',
      confidence: 0.9,
      note: 'Qualitative verb: adjective + tense particle.',
    });
  }

  /* §18  compound verb  — baseline owns this */
  const compoundRefs = getCompoundRefs(t, context, index, 'v');
  if (compoundRefs.length > 0) {
    matches.push({
      id: 'verb-§18',
      module: 'verb',
      category: 'ကြိယာ',
      type: 'ပေါင်းစပ်ကြိယာ',
      scope: 'compound',
      rule_ref: '§18',
      confidence: 0.85,
      note: 'Compound verb: joined stems + tense particle.',
    });
  }

  /* §16  simple verb fallback */
  if (compoundRefs.length === 0 && matches.length === 0) {
    matches.push({
      id: 'verb-§16',
      module: 'verb',
      category: 'ကြိယာ',
      type: 'ပင်ကိုကြိယာ',
      scope: 'simple',
      rule_ref: '§16',
      confidence: 0.8,
      note: 'Simple verb: not decomposable.',
    });
  }

  /* §22-က/ခ  action vs state — default to action when no semantic list available */
  if (matches.length === 0 && text !== 'ရှိ' && text !== 'တည်ရှိ') {
    matches.push({
      id: 'verb-§22-က',
      module: 'verb',
      category: 'ကြိယာ',
      type: 'ပြုခြင်းပြကြိယာ',
      scope: 'action',
      rule_ref: '§22-က',
      confidence: 0.7,
      note: 'Action verb: default for uncategorized verbs.',
    });
  }

  return matches.length ? matches : null;
}

export { classify };
