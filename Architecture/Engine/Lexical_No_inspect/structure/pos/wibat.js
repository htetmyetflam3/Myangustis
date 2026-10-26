import { getViablePos } from '../../abstract/baseline.js';

function classify(tokens, index, context) {
  const { L, W } = context;
  const current = tokens[index];
  const prev = tokens[index - 1];
  const next = tokens[index + 1];
  const t = current.text;
  const matches = [];

  if (!current || !L.isParticleForm(t)) return null;

  /* helpers */
  const prevIsNoun = prev && (
    prev.rawPos?.includes('n') ||
    getViablePos(prev, context, index - 1).viable.has('n')
  );
  const prevIsVerb = prev && (
    prev.rawPos?.includes('v') ||
    getViablePos(prev, context, index - 1).viable.has('v')
  );
  const nextIsNoun = next && (
    next.rawPos?.includes('n') ||
    getViablePos(next, context, index + 1).viable.has('n')
  );
  const nextIsVerb = next && (
    next.rawPos?.includes('v') ||
    getViablePos(next, context, index + 1).viable.has('v')
  );
  const nextIsAdj = next && (
    next.rawPos?.includes('dj') ||
    getViablePos(next, context, index + 1).viable.has('dj')
  );

  /* §53  subject markers */
  if (t === 'သည်' && prevIsNoun && nextIsVerb) {
    matches.push({
      id: 'wibat-§53-သည်',
      module: 'wibat',
      category: 'ဝိဘတ်',
      type: 'နာမ်ဝိဘတ်',
      subtype: 'ကတ္တားဝိဘတ်',
      scope: 'subject_marker',
      rule_ref: '§53',
      confidence: 0.9,
      particle: 'သည်',
      note: 'Subject marker.',
    });
  }
  if (t === 'က' && prevIsNoun && nextIsVerb) {
    matches.push({
      id: 'wibat-§53-က',
      module: 'wibat',
      category: 'ဝိဘတ်',
      type: 'နာမ်ဝိဘတ်',
      subtype: 'ကတ္တားဝိဘတ်',
      scope: 'subject_marker',
      rule_ref: '§53',
      confidence: 0.85,
      particle: 'က',
      note: 'Ambiguous: subject/ablative/locative/temporal.',
    });
  }
  if (t === 'မှာ' && prevIsNoun && nextIsVerb) {
    matches.push({
      id: 'wibat-§53-မှာ',
      module: 'wibat',
      category: 'ဝိဘတ်',
      type: 'နာမ်ဝိဘတ်',
      subtype: 'ကတ္တားဝိဘတ်',
      scope: 'subject_marker',
      rule_ref: '§53',
      confidence: 0.85,
      particle: 'မှာ',
      note: 'Ambiguous: subject/locative/temporal.',
    });
  }

  /* §54  object marker */
  if (t === 'ကို' && prevIsNoun && nextIsVerb) {
    matches.push({
      id: 'wibat-§54',
      module: 'wibat',
      category: 'ဝိဘတ်',
      type: 'နာမ်ဝိဘတ်',
      subtype: 'ကံဝိဘတ်',
      scope: 'object_marker',
      rule_ref: '§54',
      confidence: 0.95,
      particle: 'ကို',
      note: 'Direct object marker.',
    });
  }

  /* §55  ablative */
  if (t === 'မှ' && prevIsNoun && nextIsVerb) {
    matches.push({
      id: 'wibat-§55',
      module: 'wibat',
      category: 'ဝိဘတ်',
      type: 'နာမ်ဝိဘတ်',
      subtype: 'ထွက်ခွာရာပြဝိဘတ်',
      scope: 'ablative_source',
      rule_ref: '§55',
      confidence: 0.9,
      particle: 'မှ',
      note: 'Ablative: source of departure.',
    });
  }

  /* §56  directional */
  if (t === 'သို့' && prevIsNoun && nextIsVerb) {
    matches.push({
      id: 'wibat-§56',
      module: 'wibat',
      category: 'ဝိဘတ်',
      type: 'နာမ်ဝိဘတ်',
      subtype: 'ရှေးရှုရာပြဝိဘတ်',
      scope: 'directional_toward',
      rule_ref: '§56',
      confidence: 0.9,
      particle: 'သို့',
      note: 'Directional toward.',
    });
  }

  /* §61  locative */
  if ((t === '၌' || t === 'တွင်' || t === 'ဝယ်' || t === 'ဝက') && prevIsNoun && (nextIsVerb || nextIsAdj)) {
    matches.push({
      id: 'wibat-§61',
      module: 'wibat',
      category: 'ဝိဘတ်',
      type: 'နာမ်ဝိဘတ်',
      subtype: 'နေရာပြဝိဘတ်',
      scope: 'locative',
      rule_ref: '§61',
      confidence: 0.9,
      particle: t,
      note: 'Locative: in, at, on.',
    });
  }

  /* §63  possessive */
  if (t === '၏' && prevIsNoun && nextIsNoun) {
    matches.push({
      id: 'wibat-§63',
      module: 'wibat',
      category: 'ဝိဘတ်',
      type: 'နာမ်ဝိဘတ်',
      subtype: 'ပိုင်ဆိုင်ခြင်းပြဝိဘတ်',
      scope: 'possessive',
      rule_ref: '§63',
      confidence: 0.95,
      particle: '၏',
      note: "Possessive: 's, of.",
    });
  }

  /* verb role markers */
  if (prevIsVerb) {
    if (t === 'မည်' || t === 'လိမ့်မည်') {
      matches.push({
        id: 'wibat-§78',
        module: 'wibat',
        category: 'ဝိဘတ်',
        type: 'ကြိယာဝိဘတ်',
        subtype: 'အနာဂတ်ကာလပြကြိယာဝိဘတ်',
        scope: 'future_tense',
        rule_ref: '§78',
        confidence: 0.95,
        particle: t,
        note: 'Future tense.',
      });
    }
    if (t === 'သည်' || t === '၏' || t === 'ပြီ') {
      const hasPast = L.hasPastTimeContext(tokens);
      const hasFuture = L.hasFutureTimeContext(tokens);
      if (hasPast && !hasFuture) {
        matches.push({
          id: 'wibat-§77',
          module: 'wibat',
          category: 'ဝိဘတ်',
          type: 'ကြိယာဝိဘတ်',
          subtype: 'အတိတ်ကာလပြကြိယာဝိဘတ်',
          scope: 'past_tense',
          rule_ref: '§77',
          confidence: 0.85,
          particle: t,
          note: 'Past tense: disambiguated by past-time adverb.',
        });
      } else {
        matches.push({
          id: 'wibat-§75',
          module: 'wibat',
          category: 'ဝိဘတ်',
          type: 'ကြိယာဝိဘတ်',
          subtype: 'ပစ္စုပ္ပန်ကာလပြကြိယာဝိဘတ်',
          scope: 'present_tense',
          rule_ref: '§75',
          confidence: 0.75,
          particle: t,
          note: 'Present tense: default. Ambiguous with past.',
        });
      }
    }
    if (t === 'လော့') {
      matches.push({
        id: 'wibat-§81',
        module: 'wibat',
        category: 'ဝိဘတ်',
        type: 'ကြိယာဝိဘတ်',
        subtype: 'စေခိုင်းဝိဘတ်',
        scope: 'imperative_command',
        rule_ref: '§81',
        confidence: 0.95,
        particle: 'လော့',
        note: 'Imperative/command.',
      });
    }
    if (t === 'စို့') {
      matches.push({
        id: 'wibat-§82',
        module: 'wibat',
        category: 'ဝိဘတ်',
        type: 'ကြိယာဝိဘတ်',
        subtype: 'ညှိနှိုင်းဝိဘတ်',
        scope: 'suggestion_hortative',
        rule_ref: '§82',
        confidence: 0.9,
        particle: 'စို့',
        note: "Suggestion: let's.",
      });
    }
    if (t === 'စေ') {
      matches.push({
        id: 'wibat-§84',
        module: 'wibat',
        category: 'ဝိဘတ်',
        type: 'ကြိယာဝိဘတ်',
        subtype: 'အမိန့်ချဝိဘတ်',
        scope: 'decree_order',
        rule_ref: '§84',
        confidence: 0.9,
        particle: 'စေ',
        note: 'Decree: official order.',
      });
    }
  }

  return matches.length ? matches : null;
}

export { classify };
