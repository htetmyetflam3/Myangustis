function classify(tokens, index, context) {
  const { L, W } = context;
  const t = tokens[index];
  if (!t) return null;

  /* closed-class pronoun check  (rawPos first, then L fallback) */
  const isPronoun = t.rawPos?.includes('pn') || L.isPronoun?.(t.text);
  if (!isPronoun) return null;

  const text = t.text;
  const matches = [];

  if (L.SPEAKER_PRONOUNS?.has(text)) {
    matches.push({
      id: 'pronoun-§11-က',
      module: 'pronoun',
      category: 'နာမ်စား',
      type: 'ပုဂ္ဂလနာမ်စား',
      subtype: 'ပြောသူနာမ်စား',
      scope: 'first_person',
      rule_ref: '§11-က',
      confidence: 0.95,
      note: 'First-person pronoun.',
    });
  }
  if (L.LISTENER_PRONOUNS?.has(text)) {
    matches.push({
      id: 'pronoun-§11-ခ',
      module: 'pronoun',
      category: 'နာမ်စား',
      type: 'ပုဂ္ဂလနာမ်စား',
      subtype: 'ကြားနာသူနာမ်စား',
      scope: 'second_person',
      rule_ref: '§11-ခ',
      confidence: 0.95,
      note: 'Second-person pronoun.',
    });
  }
  if (L.THIRD_PERSON_REF?.has(text)) {
    matches.push({
      id: 'pronoun-§11-ဂ',
      module: 'pronoun',
      category: 'နာမ်စား',
      type: 'ပုဂ္ဂလနာမ်စား',
      subtype: 'အပြောခံနာမ်စား',
      scope: 'third_person',
      rule_ref: '§11-ဂ',
      confidence: 0.9,
      note: 'Third-person referential pronoun.',
    });
  }
  if (L.DEMONSTRATIVE_ADJ?.has(text)) {
    const next = tokens[index + 1];
    if (!next || L.isParticleForm(next.text) || next.text === 'ကား') {
      matches.push({
        id: 'pronoun-§12',
        module: 'pronoun',
        category: 'နာမ်စား',
        type: 'အညွှန်းနာမ်စား',
        scope: 'demonstrative_pronoun',
        rule_ref: '§12',
        confidence: 0.85,
        note: 'Demonstrative pronoun: stands alone as noun substitute.',
      });
    }
  }

  /* numeral pronoun  (rawPos/regex, no static list) */
  const isNumber = t.rawPos?.includes('num') || /^\d+$/.test(text);
  if (isNumber && !L.isClassifier(text)) {
    matches.push({
      id: 'pronoun-§24',
      module: 'pronoun',
      category: 'နာမ်စား',
      type: 'သင်္ချာနာမ်စား',
      scope: 'numeral_pronoun',
      rule_ref: '§24',
      confidence: 0.8,
      note: 'Numeral pronoun: replaces a counted noun.',
    });
  }

  if (L.QUANTIFIER_PRON?.has(text)) {
    matches.push({
      id: 'pronoun-§26',
      module: 'pronoun',
      category: 'နာမ်စား',
      type: 'သင်္ချာနာမ်စား',
      subtype: 'ပမာဏပြသင်္ချာနာမ်စား',
      scope: 'quantifier_pronoun',
      rule_ref: '§26',
      confidence: 0.85,
      note: 'Quantifier pronoun: some, all, few.',
    });
  }

  return matches.length ? matches : null;
}

export { classify };
