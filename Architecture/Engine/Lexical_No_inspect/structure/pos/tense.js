import { getViablePos } from '../../abstract/baseline.js';

['§24-က', '§24-ခ', '§24-ဂ'].forEach((r) => W.register('tense', r, 0.85));

function classify(tokens, index, context) {
  const { L, W } = context;
  const t = tokens[index];
  if (!t || !L.isParticleForm(t.text)) return null;

  const text = t.text;
  const prev = tokens[index - 1];
  const matches = [];

  /* must follow a verb */
  const prevIsVerb = prev && (
    prev.rawPos?.includes('v') ||
    getViablePos(prev, context, index - 1).viable.has('v')
  );
  if (!prevIsVerb) return null;

  if (L.isFutureMarker(text)) {
    matches.push({
      id: 'tense-§24-ဂ',
      module: 'tense',
      category: 'ကာလ',
      type: 'အနာဂတ်ကာလ',
      scope: 'future',
      rule_ref: '§24-ဂ',
      confidence: 0.95,
      note: 'Future tense: unambiguous future marker.',
    });
  }
  if (L.isPresentPastShared(text)) {
    const hasPast = L.hasPastTimeContext(tokens);
    const hasFuture = L.hasFutureTimeContext(tokens);
    if (hasPast && !hasFuture) {
      matches.push({
        id: 'tense-§24-ခ',
        module: 'tense',
        category: 'ကာလ',
        type: 'အတိတ်ကာလ',
        scope: 'past',
        rule_ref: '§24-ခ',
        confidence: 0.85,
        note: 'Past tense: disambiguated by past-time adverb.',
      });
    } else {
      matches.push({
        id: 'tense-§24-က',
        module: 'tense',
        category: 'ကာလ',
        type: 'ပစ္စုပ္ပန်ကာလ',
        scope: 'present',
        rule_ref: '§24-က',
        confidence: 0.75,
        note: 'Present tense: default when no past marker. Ambiguous with past.',
      });
    }
  }

  return matches.length ? matches : null;
}

export { classify };
