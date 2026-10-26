import { getViablePos, getCompoundRefs } from '../../abstract/baseline.js';

function classify(tokens, index, context) {
  const { L, W, query } = context;
  const t = tokens[index];
  if (!t) return null;

  /* baseline filter */
  const { viable } = getViablePos(t, context, index);
  const canBeNoun = viable.has('n') || t.rawPos?.includes('n');
  if (!canBeNoun) return null;

  /* skip particles / numbers */
  if (L.isParticleForm(t.text) || t.rawPos?.includes('num') || /^\d+$/.test(t.text)) {
    return null;
  }

  const text = t.text;
  const matches = [];
  const prev = tokens[index - 1];
  const next = tokens[index + 1];

  /* §7-က  proper noun heuristic (sentence-initial) */
  if (index === 0 && t.rawPos?.includes('n')) {
    matches.push({
      id: 'noun-§7-က',
      module: 'noun',
      category: 'နာမ်',
      type: 'တစ်ဦးဆိုင်နာမ်',
      scope: 'proper_noun',
      rule_ref: '§7-က',
      confidence: 0.6,
      note: 'Proper noun: sentence-initial entity name (heuristic).',
    });
  }

  /* §7-ခ  pluralizable common noun */
  if (next && (next.text === 'များ' || next.text === 'တို့')) {
    matches.push({
      id: 'noun-§7-ခ',
      module: 'noun',
      category: 'နာမ်',
      type: 'အများဆိုင်နာမ်',
      scope: 'common_pluralizable',
      rule_ref: '§7-ခ',
      confidence: 0.9,
      note: 'Common noun: pluralizable by များ/တို့.',
    });
  }

  /* §15-ခ / §15-က  compound vs simple  — baseline owns this */
  const compoundRefs = getCompoundRefs(t, context, index, 'n');
  if (compoundRefs.length > 0) {
    matches.push({
      id: 'noun-§15-ခ',
      module: 'noun',
      category: 'နာမ်',
      type: 'ပေါင်းစပ်နာမ်',
      scope: 'compound',
      rule_ref: '§15-ခ',
      confidence: 0.85,
      note: 'Compound noun: formed by joining two or more words.',
    });
  } else {
    matches.push({
      id: 'noun-§15-က',
      module: 'noun',
      category: 'နာမ်',
      type: 'ပင်ကိုနာမ်',
      scope: 'simple',
      rule_ref: '§15-က',
      confidence: 0.7,
      note: 'Simple noun: not decomposable.',
    });
  }

  /* §20  verbal noun  (verb + noun-forming particle) */
  if (prev && prev.rawPos?.includes('v') && L.isNounFormer(text)) {
    matches.push({
      id: 'noun-§20',
      module: 'noun',
      category: 'နာမ်',
      type: 'ကြိယာနာမ်',
      scope: 'verbal_noun',
      rule_ref: '§20',
      confidence: 0.9,
      note: 'Verbal noun: verb + noun-forming particle.',
    });
  }

  /* §21  quality noun  (adj + အ/မှု/ခြင်း) */
  if (prev && prev.rawPos?.includes('dj') && (text === 'အ' || text === 'မှု' || text === 'ခြင်း')) {
    matches.push({
      id: 'noun-§21',
      module: 'noun',
      category: 'နာမ်',
      type: 'ဂုဏ်ရည်ပြနာမ်',
      scope: 'quality_noun',
      rule_ref: '§21',
      confidence: 0.9,
      note: 'Quality noun: adjective + အ/မှု/ခြင်း.',
    });
  }

  return matches.length ? matches : null;
}

export { classify };
