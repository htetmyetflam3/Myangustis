import { getViablePos } from '../../abstract/baseline.js';

['§17-က', '§17-ခ', '§17-ဂ', '§17-ဃ', '§19-က', '§19-ခ'].forEach((r) =>
  W.register('gender-number', r, 0.8),
);

function classify(tokens, index, context) {
  const { L, W } = context;
  const t = tokens[index];
  if (!t) return null;

  const text = t.text;
  const matches = [];
  const prev = tokens[index - 1];
  const next = tokens[index + 1];

  /* §17-က  male gender marker */
  if (L.isMaleGender(text)) {
    const prevIsNoun = prev && (
      prev.rawPos?.includes('n') ||
      getViablePos(prev, context, index - 1).viable.has('n')
    );
    if (prevIsNoun) {
      matches.push({
        id: 'gender-§17-က',
        module: 'gender-number',
        category: 'လိင်',
        type: 'ပုလ္လိင်',
        scope: 'male_marker',
        rule_ref: '§17-က',
        confidence: 0.9,
        note: 'Male gender marker attached to noun.',
      });
    }
  }

  /* §17-ခ  female gender marker */
  if (L.isFemaleGender(text)) {
    const prevIsNoun = prev && (
      prev.rawPos?.includes('n') ||
      getViablePos(prev, context, index - 1).viable.has('n')
    );
    if (prevIsNoun) {
      matches.push({
        id: 'gender-§17-ခ',
        module: 'gender-number',
        category: 'လိင်',
        type: 'ဣတ္ထိလိင်',
        scope: 'female_marker',
        rule_ref: '§17-ခ',
        confidence: 0.9,
        note: 'Female gender marker attached to noun.',
      });
    }
  }

  /* §17-ဂ  neuter — default for nouns without gender marker  (no static list) */
  if (t.rawPos?.includes('n') && !L.isMaleGender(text) && !L.isFemaleGender(text)) {
    matches.push({
      id: 'gender-§17-ဂ',
      module: 'gender-number',
      category: 'လိင်',
      type: 'နပုလ္လိင်',
      scope: 'neuter',
      rule_ref: '§17-ဂ',
      confidence: 0.6,
      note: 'Neuter: inanimate object without gender (default).',
    });
  }

  /* §19-ခ  plural */
  if (next && (next.text === 'များ' || next.text === 'တို့')) {
    matches.push({
      id: 'gender-§19-ခ',
      module: 'gender-number',
      category: 'ကိန်း',
      type: 'ဗဟုဝုစ်ကိန်း',
      scope: 'plural',
      rule_ref: '§19-ခ',
      confidence: 0.9,
      note: 'Plural number: marked by များ/တို့.',
    });
  }

  /* §19-က  singular — default when no plural marker */
  const isNoun = t.rawPos?.includes('n') || getViablePos(t, context, index).viable.has('n');
  const isNumber = t.rawPos?.includes('num') || /^\d+$/.test(text);
  if (isNoun && !isNumber && !(next && (next.text === 'များ' || next.text === 'တို့'))) {
    matches.push({
      id: 'gender-§19-က',
      module: 'gender-number',
      category: 'ကိန်း',
      type: 'ဧကဝုစ်ကိန်း',
      scope: 'singular',
      rule_ref: '§19-က',
      confidence: 0.6,
      note: 'Singular number: default when no plural marker present.',
    });
  }

  return matches.length ? matches : null;
}

export { classify };
