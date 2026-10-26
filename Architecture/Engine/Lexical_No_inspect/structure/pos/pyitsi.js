import { getViablePos } from '../../abstract/baseline.js';

[
  '§100', '§101', '§102', '§103', '§104', '§105',
  '§106', '§107', '§108', '§109', '§110', '§111',
  '§112', '§113', '§114', '§115', '§116', '§117',
].forEach((r) => W.register('pyitsi', r, 0.7));

function classify(tokens, index, context) {
  const { L, W, query } = context;
  const t = tokens[index];
  if (!t || !L.isParticleForm(t.text)) return null;

  const text = t.text;
  const prev = tokens[index - 1];
  const next = tokens[index + 1];
  const matches = [];

  /* helpers: rawPos + baseline */
  const prevIsNoun = prev && (
    prev.rawPos?.includes('n') ||
    getViablePos(prev, context, index - 1).viable.has('n')
  );
  const prevIsVerb = prev && (
    prev.rawPos?.includes('v') ||
    getViablePos(prev, context, index - 1).viable.has('v')
  );
  const prevIsAdj = prev && (
    prev.rawPos?.includes('dj') ||
    getViablePos(prev, context, index - 1).viable.has('dj')
  );
  const prevIsNum = prev && (
    prev.rawPos?.includes('num') || /^\d+$/.test(prev.text)
  );

  /* §100  classifier after numeral */
  if (L.isClassifier(text) && prevIsNum) {
    matches.push({
      id: 'pyitsi-§100',
      module: 'pyitsi',
      category: 'ပစ္စည်း',
      type: 'အမူးပစ္စည်း',
      scope: 'classifier',
      rule_ref: '§100',
      confidence: 0.95,
      particle: text,
      note: 'Classifier particle after numeral.',
    });
  }

  /* §102  gender particle */
  if ((L.isMaleGender(text) || L.isFemaleGender(text)) && prevIsNoun) {
    matches.push({
      id: 'pyitsi-§102',
      module: 'pyitsi',
      category: 'ပစ္စည်း',
      type: 'လိင်ပစ္စည်း',
      scope: 'gender_marker',
      rule_ref: '§102',
      confidence: 0.9,
      particle: text,
      note: 'Gender particle attached to noun.',
    });
  }

  /* §104  plural marker */
  if ((text === 'များ' || text === 'တို့') && prevIsNoun) {
    matches.push({
      id: 'pyitsi-§104',
      module: 'pyitsi',
      category: 'ပစ္စည်း',
      type: 'ဗဟုဝုစ်ပစ္စည်း',
      scope: 'plural_marker',
      rule_ref: '§104',
      confidence: 0.95,
      particle: text,
      note: 'Plural marker after noun.',
    });
  }

  /* §106  focus / emphasis */
  const focusParticles = ['ပင်', 'သာ', 'ချည်း', 'တော့', 'တောင်'];
  if (focusParticles.includes(text)) {
    matches.push({
      id: 'pyitsi-§106',
      module: 'pyitsi',
      category: 'ပစ္စည်း',
      type: 'အလေးပစ္စည်း',
      scope: 'focus_emphasis',
      rule_ref: '§106',
      confidence: 0.85,
      particle: text,
      note: 'Focus/emphasis particle.',
    });
  }

  /* §108  question particle */
  if (L.isQuestionParticle(text)) {
    matches.push({
      id: 'pyitsi-§108',
      module: 'pyitsi',
      category: 'ပစ္စည်း',
      type: 'အမေးပစ္စည်း',
      scope: 'question_marker',
      rule_ref: '§108',
      confidence: 0.95,
      particle: text,
      note: 'Question sentence-final particle.',
    });
  }

  /* §110  sentence-final mood */
  if (L.isSentenceFinal(text)) {
    matches.push({
      id: 'pyitsi-§110',
      module: 'pyitsi',
      category: 'ပစ္စည်း',
      type: 'ဝါကျဆုံးပစ္စည်း',
      scope: 'sentence_final',
      rule_ref: '§110',
      confidence: 0.9,
      particle: text,
      note: 'Sentence-final mood particle.',
    });
  }

  /* §112  auxiliary verb particle */
  if (L.isVerbAuxiliary(text) && prevIsVerb) {
    matches.push({
      id: 'pyitsi-§112',
      module: 'pyitsi',
      category: 'ပစ္စည်း',
      type: 'ကြိယာဝိသေသနပစ္စည်း',
      scope: 'verb_auxiliary',
      rule_ref: '§112',
      confidence: 0.9,
      particle: text,
      note: 'Auxiliary verb particle.',
    });
  }

  /* §113  vocative */
  const vocativeParticles = ['အို', 'ဟယ်', 'ရှင်', 'ရေ', 'ဗျို့', 'ခင်ဗျာ', 'ဗျာ', 'ဟေ့'];
  if (vocativeParticles.includes(text)) {
    matches.push({
      id: 'pyitsi-§113',
      module: 'pyitsi',
      category: 'ပစ္စည်း',
      type: 'ဆဲခေါ်ပစ္စည်း',
      scope: 'vocative',
      rule_ref: '§113',
      confidence: 0.95,
      particle: text,
      note: 'Vocative/calling particle.',
    });
  }

  /* §114  adjective-forming */
  if (L.isAdjFormer(text) && prev && (prevIsVerb || prevIsNoun)) {
    matches.push({
      id: 'pyitsi-§114',
      module: 'pyitsi',
      category: 'ပစ္စည်း',
      type: 'နာမဝိသေသနပစ္စည်း',
      scope: 'adjectivalizer',
      rule_ref: '§114',
      confidence: 0.9,
      particle: text,
      note: 'Adjective-forming particle: သော/သည့်/မည့်.',
    });
  }

  /* §116  adverb-forming */
  if (L.isAdvFormer(text) && prevIsAdj) {
    matches.push({
      id: 'pyitsi-§116',
      module: 'pyitsi',
      category: 'ပစ္စည်း',
      type: 'ကြိယာဝိသေသနပစ္စည်း',
      scope: 'adverbializer',
      rule_ref: '§116',
      confidence: 0.85,
      particle: text,
      note: 'Adverb-forming particle: စွာ/တတ်/တ/ချည်.',
    });
  }

  return matches.length ? matches : null;
}

export { classify };
