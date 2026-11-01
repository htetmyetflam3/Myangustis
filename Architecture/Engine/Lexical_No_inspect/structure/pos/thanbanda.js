import { getViablePos } from '../../abstract/baseline.js';

[
  '§89', '§90', '§91', '§92', '§93', '§94', '§95', '§96',
  '§97', '§98', '§99', '§43-က', '§43-ခ', '§43-ဂ', '§43-ဃ',
  '§39', '§40',
].forEach((r) => W.register('thanbanda', r, 0.75));

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
  const nextIsNoun = next && (
    next.rawPos?.includes('n') ||
    getViablePos(next, context, index + 1).viable.has('n')
  );
  const prevIsVerb = prev && (
    prev.rawPos?.includes('v') ||
    getViablePos(prev, context, index - 1).viable.has('v')
  );
  const nextIsVerb = next && (
    next.rawPos?.includes('v') ||
    getViablePos(next, context, index + 1).viable.has('v')
  );
  const betweenWords = prevIsNoun && nextIsNoun;
  const betweenClauses = prevIsVerb || nextIsVerb || !prev || !next;

  /* §89  adversative */
  const adversativeParticles = ['သို့ရာတွင်', 'သို့သော်လည်း', 'လင့်ကစား', 'သော်လည်း', 'စေကာမူ', 'လျက်နှင့်'];
  if (adversativeParticles.includes(t)) {
    matches.push({
      id: 'thanbanda-§89',
      module: 'thanbanda',
      category: 'သမ္ဗန္ဓ',
      type: 'အနက်အဓိပ္ပာယ်ဆက်',
      subtype: 'ဆန့်ကျင်ပြသမ္ဗန္ဓ',
      scope: 'adversative_contrastive',
      rule_ref: '§89',
      confidence: 0.9,
      particle: t,
      note: 'Contrastive: but, although.',
    });
  }

  /* §90  temporal */
  if (t === 'နှင့်တစ်ပြိုင်နက်' && betweenClauses) {
    matches.push({
      id: 'thanbanda-§90-1',
      module: 'thanbanda', category: 'သမ္ဗန္ဓ', type: 'ဝါကျဆက်',
      subtype: 'အချိန်ပြသမ္ဗန္ဓ', scope: 'temporal_simultaneous',
      rule_ref: '§90', confidence: 0.9, particle: t,
      note: 'Temporal: as soon as.',
    });
  }
  if ((t === 'တိုင်' || t === 'တိုင်အောင်') && betweenClauses) {
    matches.push({
      id: 'thanbanda-§90-2',
      module: 'thanbanda', category: 'သမ္ဗန္ဓ', type: 'ဝါကျဆက်',
      subtype: 'အချိန်ပြသမ္ဗန္ဓ', scope: 'temporal_until',
      rule_ref: '§90', confidence: 0.85, particle: t,
      note: 'Temporal: until (inter-clausal).',
    });
  }
  if ((t === 'မှ' || t === 'စဉ်' || t === 'ရင်း' || t === 'တုန်း') && betweenClauses) {
    matches.push({
      id: 'thanbanda-§90-3',
      module: 'thanbanda', category: 'သမ္ဗန္ဓ', type: 'ဝါကျဆက်',
      subtype: 'အချိန်ပြသမ္ဗန္ဓ', scope: 'temporal_during_from',
      rule_ref: '§90', confidence: 0.85, particle: t,
      note: 'Temporal: while, during, since.',
    });
  }
  if (t === 'တိုင်း' && betweenClauses) {
    matches.push({
      id: 'thanbanda-§90-4',
      module: 'thanbanda', category: 'သမ္ဗန္ဓ', type: 'ဝါကျဆက်',
      subtype: 'အချိန်ပြသမ္ဗန္ဓ', scope: 'temporal_whenever',
      rule_ref: '§90', confidence: 0.85, particle: t,
      note: 'Temporal: whenever.',
    });
  }

  /* §91  purposive */
  const purposiveParticles = ['အောင်', 'ရန်', 'ရန်အလို့ငှာ', 'ရန်အတွက်', 'အံ့သောငှာ', 'စိမ့်သောငှာ'];
  if (purposiveParticles.includes(t) && betweenClauses) {
    matches.push({
      id: 'thanbanda-§91',
      module: 'thanbanda', category: 'သမ္ဗန္ဓ', type: 'အနက်ဆက်',
      subtype: 'အကျိုးမျှော်ပြသမ္ဗန္ဓ', scope: 'purposive',
      rule_ref: '§91', confidence: 0.9, particle: t,
      note: 'Purposive: in order that.',
    });
  }
  if (t === 'ဖို့' && betweenClauses) {
    matches.push({
      id: 'thanbanda-§91-ဖို့',
      module: 'thanbanda', category: 'သမ္ဗန္ဓ', type: 'အနက်ဆက်',
      subtype: 'အကျိုးမျှော်ပြသမ္ဗန္ဓ', scope: 'purposive',
      rule_ref: '§91', confidence: 0.85, particle: 'ဖို့',
      note: 'Purposive: in order to.',
    });
  }
  if (t === 'အတွက်' && betweenClauses) {
    matches.push({
      id: 'thanbanda-§91-အတွက်',
      module: 'thanbanda', category: 'သမ္ဗန္ဓ', type: 'အနက်ဆက်',
      subtype: 'အကျိုးမျှော်ပြသမ္ဗန္ဓ', scope: 'purposive_benefactive',
      rule_ref: '§91', confidence: 0.85, particle: 'အတွက်',
      note: 'Purposive: for the purpose of.',
    });
  }

  /* §92  causal */
  const causalParticles = ['သောကြောင့်', 'သဖြင့်', 'လို့', 'ထို့ကြောင့်', 'သို့ဖြစ်၍', 'အဘယ်ကြောင့်ဆိုသော်'];
  if (causalParticles.includes(t) && betweenClauses) {
    matches.push({
      id: 'thanbanda-§92',
      module: 'thanbanda', category: 'သမ္ဗန္ဓ', type: 'အနက်ဆက်',
      subtype: 'အကြောင်းပြသမ္ဗန္ဓ', scope: 'causal',
      rule_ref: '§92', confidence: 0.9, particle: t,
      note: 'Causal: because, therefore.',
    });
  }
  if (t === '၍' && betweenClauses) {
    if (prevIsVerb && nextIsVerb) {
      matches.push({
        id: 'thanbanda-§92-၍-seq',
        module: 'thanbanda', category: 'သမ္ဗန္ဓ', type: 'ဝါကျဆက်',
        subtype: 'တစ်ခုပြီးတစ်ခုပြသမ္ဗန္ဓ', scope: 'sequential_or_causal',
        rule_ref: '§92', confidence: 0.8, particle: '၍',
        note: 'Ambiguous: causal or sequential.',
      });
    } else {
      matches.push({
        id: 'thanbanda-§92-၍',
        module: 'thanbanda', category: 'သမ္ဗန္ဓ', type: 'အနက်ဆက်',
        subtype: 'အကြောင်းပြသမ္ဗန္ဓ', scope: 'causal',
        rule_ref: '§92', confidence: 0.85, particle: '၍',
        note: 'Causal: therefore.',
      });
    }
  }
  if (t === 'နှင့်' && betweenClauses) {
    matches.push({
      id: 'thanbanda-§92-နှင့်',
      module: 'thanbanda', category: 'သမ္ဗန္ဓ', type: 'ဝါကျဆက်',
      subtype: 'အကြောင်းပြသမ္ဗန္ဓ', scope: 'causal',
      rule_ref: '§92', confidence: 0.85, particle: 'နှင့်',
      note: 'Causal: upon hearing/seeing.',
    });
  }

  /* §93  comparative */
  const comparativeParticles = ['သကဲ့သို့', 'သလို', 'ထက်'];
  if (comparativeParticles.includes(t) && betweenClauses) {
    matches.push({
      id: 'thanbanda-§93',
      module: 'thanbanda', category: 'သမ္ဗန္ဓ', type: 'ဝါကျဆက်',
      subtype: 'နှိုင်းယှဉ်ပြသမ္ဗန္ဓ', scope: 'comparative',
      rule_ref: '§93', confidence: 0.9, particle: t,
      note: 'Comparative: as, like, than.',
    });
  }

  /* §94  additive */
  if (t === 'လည်း' && betweenClauses) {
    matches.push({
      id: 'thanbanda-§94-လည်း',
      module: 'thanbanda', category: 'သမ္ဗန္ဓ', type: 'အနက်ဆက်',
      subtype: 'ပေါင်းစည်းပြသမ္ဗန္ဓ', scope: 'additive',
      rule_ref: '§94', confidence: 0.9, particle: 'လည်း',
      note: 'Additive: also, too.',
    });
  }
  if (t === 'အပြင်' && betweenClauses) {
    matches.push({
      id: 'thanbanda-§94-အပြင်',
      module: 'thanbanda', category: 'သမ္ဗန္ဓ', type: 'အနက်ဆက်',
      subtype: 'ပေါင်းစည်းပြသမ္ဗန္ဓ', scope: 'additive',
      rule_ref: '§94', confidence: 0.9, particle: 'အပြင်',
      note: 'Additive: besides.',
    });
  }
  if (t === 'သာမက' && betweenClauses) {
    matches.push({
      id: 'thanbanda-§94-သာမက',
      module: 'thanbanda', category: 'သမ္ဗန္ဓ', type: 'အနက်ဆက်',
      subtype: 'ပေါင်းစည်းပြသမ္ဗန္ဓ', scope: 'additive_not_only',
      rule_ref: '§94', confidence: 0.9, particle: 'သာမက',
      note: 'Additive: not only...but also.',
    });
  }

  /* §95  disjunctive */
  if (t === 'သို့မဟုတ်') {
    if (betweenWords) {
      matches.push({
        id: 'thanbanda-§95-word',
        module: 'thanbanda', category: 'သမ္ဗန္ဓ', type: 'ပုဒ်ဆက်',
        subtype: 'ရွေးချယ်ပြသမ္ဗန္ဓ', scope: 'disjunctive_word',
        rule_ref: '§95', confidence: 0.9, particle: 'သို့မဟုတ်',
        note: 'Disjunctive at word level.',
      });
    } else {
      matches.push({
        id: 'thanbanda-§95-clause',
        module: 'thanbanda', category: 'သမ္ဗန္ဓ', type: 'ဝါကျဆက်',
        subtype: 'ရွေးချယ်ပြသမ္ဗန္ဓ', scope: 'disjunctive_clause',
        rule_ref: '§95', confidence: 0.9, particle: 'သို့မဟုတ်',
        note: 'Disjunctive at clause level.',
      });
    }
  }

  /* §96  conditional */
  if (t === 'လျှင်' && betweenClauses) {
    matches.push({
      id: 'thanbanda-§96-လျှင်',
      module: 'thanbanda', category: 'သမ္ဗန္ဓ', type: 'ဝါကျဆက်',
      subtype: 'ကန့်သတ်ချက်ပြသမ္ဗန္ဓ', scope: 'conditional_if',
      rule_ref: '§96', confidence: 0.95, particle: 'လျှင်',
      note: 'Conditional: if.',
    });
  }
  if (t === 'မှ' && betweenClauses) {
    matches.push({
      id: 'thanbanda-§96-မှ',
      module: 'thanbanda', category: 'သမ္ဗန္ဓ', type: 'ဝါကျဆက်',
      subtype: 'ကန့်သတ်ချက်ပြသမ္ဗန္ဓ', scope: 'conditional_only_if',
      rule_ref: '§96', confidence: 0.85, particle: 'မှ',
      note: 'Conditional: only if.',
    });
  }
  if (t === 'က' && betweenClauses) {
    matches.push({
      id: 'thanbanda-§96-က',
      module: 'thanbanda', category: 'သမ္ဗန္ဓ', type: 'ဝါကျဆက်',
      subtype: 'ကန့်သတ်ချက်ပြသမ္ဗန္ဓ', scope: 'conditional_then',
      rule_ref: '§96', confidence: 0.85, particle: 'က',
      note: 'Conditional: then/if.',
    });
  }

  /* §97  non-restrictive */
  const nonRestrictiveStarters = ['ဖြစ်စေ', 'သော်လည်းကောင်း'];
  if (nonRestrictiveStarters.includes(t)) {
    matches.push({
      id: 'thanbanda-§97',
      module: 'thanbanda', category: 'သမ္ဗန္ဓ', type: 'ဝါကျဆက်',
      subtype: 'ကန့်သတ်မဲ့ပြသမ္ဗန္ဓ', scope: 'non_restrictive',
      rule_ref: '§97', confidence: 0.9, particle: t,
      note: 'Non-restrictive: whether...or.',
    });
  }

  /* §98  simultaneous */
  const simultaneousParticles = ['လျက်', 'ကာ', 'ရင်း'];
  if (simultaneousParticles.includes(t) && betweenClauses) {
    matches.push({
      id: 'thanbanda-§98',
      module: 'thanbanda', category: 'သမ္ဗန္ဓ', type: 'ဝါကျဆက်',
      subtype: 'တစ်ပြိုင်နက်ပြသမ္ဗန္ဓ', scope: 'simultaneous',
      rule_ref: '§98', confidence: 0.9, particle: t,
      note: 'Simultaneous: while.',
    });
  }

  /* §99  sequential */
  if ((t === 'ကာ' || t === '၍') && betweenClauses) {
    matches.push({
      id: 'thanbanda-§99',
      module: 'thanbanda', category: 'သမ္ဗန္ဓ', type: 'ဝါကျဆက်',
      subtype: 'တစ်ခုပြီးတစ်ခုပြသမ္ဗန္ဓ', scope: 'sequential',
      rule_ref: '§99', confidence: 0.85, particle: t,
      note: 'Sequential: and then.',
    });
  }

  /* §43  word-level */
  if (t === 'နှင့်' && betweenWords) {
    matches.push({
      id: 'thanbanda-§43-က',
      module: 'thanbanda', category: 'သမ္ဗန္ဓ', type: 'ပုဒ်ဆက်',
      subtype: 'ပေါင်းစည်းပြသမ္ဗန္ဓ', scope: 'word_additive',
      rule_ref: '§43-က', confidence: 0.9, particle: 'နှင့်',
      note: 'Word-level additive.',
    });
  }
  if (t === 'လည်းကောင်း' && betweenWords) {
    matches.push({
      id: 'thanbanda-§43-ခ',
      module: 'thanbanda', category: 'သမ္ဗန္ဓ', type: 'ပုဒ်ဆက်',
      subtype: 'ပေါင်းစည်းပြသမ္ဗန္ဓ', scope: 'word_additive_both',
      rule_ref: '§43-ခ', confidence: 0.9, particle: 'လည်းကောင်း',
      note: 'Word-level: both A and B.',
    });
  }
  if (t === 'ဖြစ်စေ' && betweenWords) {
    matches.push({
      id: 'thanbanda-§43-ဂ',
      module: 'thanbanda', category: 'သမ္ဗန္ဓ', type: 'ပုဒ်ဆက်',
      subtype: 'ကန့်သတ်မဲ့ပြသမ္ဗန္ဓ', scope: 'word_non_restrictive',
      rule_ref: '§43-ဂ', confidence: 0.9, particle: 'ဖြစ်စေ',
      note: 'Word-level: A or B.',
    });
  }
  if (t === 'မှတစ်ပါး' && betweenWords) {
    matches.push({
      id: 'thanbanda-§43-ဃ',
      module: 'thanbanda', category: 'သမ္ဗန္ဓ', type: 'ပုဒ်ဆက်',
      subtype: 'ကန့်သတ်ချက်ပြသမ္ဗန္ဓ', scope: 'word_exclusive',
      rule_ref: '§43-ဃ', confidence: 0.9, particle: 'မှတစ်ပါး',
      note: 'Word-level: except for.',
    });
  }

  /* §39, §40  meaning-level */
  if (t === 'သော်လည်း' && betweenClauses) {
    matches.push({
      id: 'thanbanda-§39',
      module: 'thanbanda', category: 'သမ္ဗန္ဓ', type: 'ဝါကျဆက်',
      subtype: 'ဆန့်ကျင်ပြသမ္ဗန္ဓ', scope: 'adversative',
      rule_ref: '§39', confidence: 0.9, particle: 'သော်လည်း',
      note: 'Adversative: although.',
    });
  }
  if (t === 'ထို့ကြောင့်') {
    matches.push({
      id: 'thanbanda-§40-ထို့ကြောင့်',
      module: 'thanbanda', category: 'သမ္ဗန္ဓ', type: 'အဓိပ္ပာယ်ဆက်',
      subtype: 'အကြောင်းပြသမ္ဗန္ဓ', scope: 'meaning_causal',
      rule_ref: '§40', confidence: 0.9, particle: 'ထို့ကြောင့်',
      note: 'Meaning-level causal.',
    });
  }
  if (t === 'အဘယ်ကြောင့်ဆိုသော်') {
    matches.push({
      id: 'thanbanda-§40-အဘယ်ကြောင့်ဆိုသော်',
      module: 'thanbanda', category: 'သမ္ဗန္ဓ', type: 'အဓိပ္ပာယ်ဆက်',
      subtype: 'အကြောင်းပြသမ္ဗန္ဓ', scope: 'meaning_reason_giving',
      rule_ref: '§40', confidence: 0.9, particle: 'အဘယ်ကြောင့်ဆိုသော်',
      note: 'Meaning-level reason.',
    });
  }
  if (t === 'ထို့ပြင်') {
    matches.push({
      id: 'thanbanda-§40-ထို့ပြင်',
      module: 'thanbanda', category: 'သမ္ဗန္ဓ', type: 'အဓိပ္ပာယ်ဆက်',
      subtype: 'ပေါင်းစည်းပြသမ္ဗန္ဓ', scope: 'meaning_additive',
      rule_ref: '§40', confidence: 0.9, particle: 'ထို့ပြင်',
      note: 'Meaning-level additive.',
    });
  }
  if (t === 'ထို့နောက်') {
    matches.push({
      id: 'thanbanda-§40-ထို့နောက်',
      module: 'thanbanda', category: 'သမ္ဗန္ဓ', type: 'အဓိပ္ပာယ်ဆက်',
      subtype: 'တစ်ခုပြီးတစ်ခုပြသမ္ဗန္ဓ', scope: 'meaning_sequential',
      rule_ref: '§40', confidence: 0.9, particle: 'ထို့နောက်',
      note: 'Meaning-level sequential.',
    });
  }
  if (t === 'သို့ရာတွင်') {
    matches.push({
      id: 'thanbanda-§40-သို့ရာတွင်',
      module: 'thanbanda', category: 'သမ္ဗန္ဓ', type: 'အဓိပ္ပာယ်ဆက်',
      subtype: 'ဆန့်ကျင်ပြသမ္ဗန္ဓ', scope: 'meaning_adversative',
      rule_ref: '§40', confidence: 0.9, particle: 'သို့ရာတွင်',
      note: 'Meaning-level adversative.',
    });
  }
  if (t === 'ထိုအခါ') {
    matches.push({
      id: 'thanbanda-§40-ထိုအခါ',
      module: 'thanbanda', category: 'သမ္ဗန္ဓ', type: 'အဓိပ္ပာယ်ဆက်',
      subtype: 'အချိန်ပြသမ္ဗန္ဓ', scope: 'meaning_temporal',
      rule_ref: '§40', confidence: 0.9, particle: 'ထိုအခါ',
      note: 'Meaning-level temporal.',
    });
  }

  return matches.length ? matches : null;
}

export { classify };
