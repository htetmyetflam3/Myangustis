const BASIC_PATTERN = {
  ref: '§118',
  core: ['ကတ္တားပုဒ်', 'ကြိယာပုဒ်'],
  rules: [
    'နာမ်ပုဒ်၊ နာမ်စားပုဒ်တို့ကို လိုအပ်သလို ဖြည့်စွက်ဖွဲ့စည်းနိုင်',
    'နာမ်ပုဒ်၊ နာမ်စားပုဒ်တို့၏နောက်တွင် လိုအပ်သော ဝိဘတ်ကို ဆက်',
    'ဝိဘတ်သည် ဆိုင်ရာနာမ်/နာမ်စား၏ လုပ်ဆောင်ပုံကို ဝေဖန်ပိုင်းခြားပြသည်',
  ],
};
const VERB_INFLECTION = {
  ref: '§119',
  wibat_function: 'ကာလနှင့် ဝါကျအမျိုးအစားကို ခွဲခြားပြသည်',
  pyitsi_function: 'ဝါကျ၏ အနက်အဓိပ္ပာယ်ကို ကွဲပြားစေသည်',
  combinations: ['ဝိဘတ်တည်း', 'ပစ္စည်းတည်း', 'ဝိဘတ်နှင့်ပစ္စည်း နှစ်ခုစလုံး'],
};
const SENTENCE_PATTERNS = [
  { id: 1, name: 'ကတ္တား-ကြိယာ', slots: ['ကတ္တား', 'ကြိယာ'], ref: '§63' },
  {
    id: 2,
    name: 'ကတ္တား-ကတ္တားအဖြည့်-ကြိယာ',
    slots: ['ကတ္တား', 'ကတ္တားအဖြည့်', 'ကြိယာ'],
    ref: '§63-ခ',
  },
  {
    id: 3,
    name: 'ကတ္တား-ကံ-ကြိယာ',
    slots: ['ကတ္တား', 'ကံ', 'ကြိယာ'],
    ref: '§63-ဂ',
  },
  {
    id: 4,
    name: 'ကတ္တား-ကံ-ကံအဖြည့်-ကြိယာ',
    slots: ['ကတ္တား', 'ကံ', 'ကံအဖြည့်', 'ကြိယာ'],
    ref: '§63-ဃ',
  },
  {
    id: 5,
    name: 'ကတ္တား-ထွက်ခွာရာပြပုဒ်-ကြိယာ',
    slots: ['ကတ္တား', 'ထွက်ခွာရာပြပုဒ်', 'ကြိယာ'],
    ref: '§63-င',
  },
  {
    id: 6,
    name: 'ကတ္တား-ရှေးရှုရာပြပုဒ်-ကြိယာ',
    slots: ['ကတ္တား', 'ရှေးရှုရာပြပုဒ်', 'ကြိယာ'],
    ref: '§63-စ',
  },
  {
    id: 7,
    name: 'ကတ္တား-ဆိုက်ရောက်ရာပြပုဒ်-ကြိယာ',
    slots: ['ကတ္တား', 'ဆိုက်ရောက်ရာပြပုဒ်', 'ကြိယာ'],
    ref: '§63-ဆ',
  },
  {
    id: 8,
    name: 'ကတ္တား-ကံ-အသုံးခံပြပုဒ်-ကြိယာ',
    slots: ['ကတ္တား', 'ကံ', 'အသုံးခံပြပုဒ်', 'ကြိယာ'],
    ref: '§63-ဇ',
  },
  {
    id: 9,
    name: 'ကတ္တား-အကြောင်းပြပုဒ်-ကြိယာ',
    slots: ['ကတ္တား', 'အကြောင်းပြပုဒ်', 'ကြိယာ'],
    ref: '§63-ဈ',
  },
  {
    id: 10,
    name: 'ကတ္တား-ကံ-လက်ခံပြပုဒ်-ကြိယာ',
    slots: ['ကတ္တား', 'ကံ', 'လက်ခံပြပုဒ်', 'ကြိယာ'],
    ref: '§63-ည',
  },
  {
    id: 11,
    name: 'ကတ္တား-နေရာပြပုဒ်-ကြိယာ',
    slots: ['ကတ္တား', 'နေရာပြပုဒ်', 'ကြိယာ'],
    ref: '§63-ဋ',
  },
  {
    id: 12,
    name: 'ကတ္တား-အချိန်ပြပုဒ်-ကြိယာ',
    slots: ['ကတ္တား', 'အချိန်ပြပုဒ်', 'ကြိယာ'],
    ref: '§63-ဌ',
  },
  {
    id: 13,
    name: 'ကတ္တား-ပိုင်ဆိုင်ခြင်းပြပုဒ်-ကတ္တားအဖြည့်-ကြိယာ',
    slots: ['ကတ္တား', 'ပိုင်ဆိုင်ခြင်းပြပုဒ်', 'ကတ္တားအဖြည့်', 'ကြိယာ'],
    ref: '§63-ဍ',
  },
  {
    id: 14,
    name: 'ကတ္တား-ကံ-ထွက်ခွာရာပြပုဒ်-ကြိယာ',
    slots: ['ကတ္တား', 'ကံ', 'ထွက်ခွာရာပြပုဒ်', 'ကြိယာ'],
    ref: '§63-ဎ',
  },
  {
    id: 15,
    name: 'ကတ္တား-ကံ-ရှေးရှုရာပြပုဒ်-ကြိယာ',
    slots: ['ကတ္တား', 'ကံ', 'ရှေးရှုရာပြပုဒ်', 'ကြိယာ'],
    ref: '§63-ဏ',
  },
  {
    id: 16,
    name: 'ကတ္တား-ထွက်ခွာရာပြပုဒ်-ရှေးရှုရာပြပုဒ်-ကြိယာ',
    slots: ['ကတ္တား', 'ထွက်ခွာရာပြပုဒ်', 'ရှေးရှုရာပြပုဒ်', 'ကြိယာ'],
    ref: '§63-တ',
  },
  {
    id: 17,
    name: 'ကတ္တား-ကံ-နေရာပြပုဒ်-ကြိယာ',
    slots: ['ကတ္တား', 'ကံ', 'နေရာပြပုဒ်', 'ကြိယာ'],
    ref: '§63-ထ',
  },
  {
    id: 18,
    name: 'ကတ္တား-ကံ-အချိန်ပြပုဒ်-ကြိယာ',
    slots: ['ကတ္တား', 'ကံ', 'အချိန်ပြပုဒ်', 'ကြိယာ'],
    ref: '§63-ဒ',
  },
  {
    id: 19,
    name: 'ကတ္တား-ထွက်ခွာရာပြပုဒ်-ရှေးရှုရာပြပုဒ်-အချိန်ပြပုဒ်-ကြိယာ',
    slots: [
      'ကတ္တား',
      'ထွက်ခွာရာပြပုဒ်',
      'ရှေးရှုရာပြပုဒ်',
      'အချိန်ပြပုဒ်',
      'ကြိယာ',
    ],
    ref: '§63-ဓ',
  },
  {
    id: 20,
    name: 'ကတ္တား-ကံ-နေရာပြပုဒ်-အချိန်ပြပုဒ်-ကြိယာ',
    slots: ['ကတ္တား', 'ကံ', 'နေရာပြပုဒ်', 'အချိန်ပြပုဒ်', 'ကြိယာ'],
    ref: '§63-န',
  },
];
const PARTICLE_ROLE_MAP = {};
const EXTENDED_PATTERNS = {
  adjectiveInsertion: {
    ref: '§182',
    description: 'Insert adjective before noun,adverb before verb',
    transforms: [
      { before: ['ကတ္တား', 'ကြိယာ'], after: ['ကတ္တား', 'နာမဝိသေသန', 'ကြိယာ'] },
      {
        before: ['ကတ္တား', 'ကြိယာ'],
        after: [
          'နာမဝိသေသန',
          'ကတ္တား',
          'နာမဝိသေသန',
          'ကံ',
          'ကြိယာဝိသေသန',
          'ကြိယာ',
        ],
      },
    ],
  },
  phraseInsertion: {
    ref: '§183',
    description: 'Insert noun phrases as compound roles',
    transforms: [
      { before: ['ကတ္တား'], after: ['ကတ္တားပုဒ်စု'] },
      { before: ['နေရာပြပုဒ်'], after: ['နေရာပြပုဒ်စု'] },
      { before: ['အချိန်ပြပုဒ်'], after: ['အချိန်ပြပုဒ်စု'] },
    ],
  },
  reorderPattern: {
    ref: '§184',
    description: 'Front any constituent for emphasis',
    transforms: [
      { pattern: 'any_fronting', constraint: 'ကြိယာသည်_အဆုံး၌_ရှိရမည်' },
    ],
  },
  subjectOmission: {
    ref: '§185',
    description: 'Omit subject when contextually clear',
    indicator: '()',
  },
  verbOmission: {
    ref: '§186',
    description: 'Omit verb in equational/copular constructions',
    contexts: [
      'ကတ္တားအဖြည့်_ဖွဲ့စည်းရာ',
      'နေရာပြ_ထည့်သွင်း',
      'အမေးနာမ်စား_ထည့်သွင်း',
    ],
  },
  subjectParticleOmission: {
    ref: '§187',
    particles: ['သည်', 'က'],
    condition: 'ကတ္တားနှင့်ကြိယာ_ကြား၌_ကံ_အချိန်ပြ_နေရာပြ_စသည်များ_ပါလျှင်',
  },
  objectParticleOmission: {
    ref: '§188',
    particle: 'ကို',
    condition: 'ကံကို_ကြိယာရှေ့၌_ကပ်ထားသောအခါ',
  },
};
const SENTENCE_TYPES = {
  basic: { ref: '§112', structure: ['ကတ္တားပုဒ်', 'ကြိယာပုဒ်'] },
  contextDependent: {
    ref: '§113',
    types: {
      verbOnly: {
        indicator: 'ကြိယာပုဒ်တစ်ခုတည်း',
        examples: ['စားမလား', 'မစားချင်ဘူး'],
      },
      nounOnly: {
        indicator: 'နာမ်ပုဒ်တစ်ခုတည်း',
        examples: ['မောင်မောင်', 'မြစ်ကြီးနားက'],
      },
    },
  },
  multiWordShort: {
    ref: '§114',
    types: {
      nounVerb: {
        structure: ['နာမ်ပုဒ်', 'ကြိယာပုဒ်'],
        examples: ['အမှိုက် မပုံရ', 'သွား တိုက်'],
      },
      placeVerb: {
        structure: ['နေရာပြ', 'ကြိယာ'],
        examples: ['ဘယ်မှာ နေသလဲ', 'ဒီမှာ တည်းပါ'],
      },
    },
  },
  gradualExpansion: { ref: '§115', stages: [] },
  fronting: { ref: '§116', rule: 'အလေးပေးလိုသည့်နာမ်ပုဒ်ကို ဝါကျရှေ့ဆုံး၌ထား' },
  modifierInsertion: {
    ref: '§117',
    rule: 'အထူးပြုပုဒ်များကို ဖြည့်စွက်ဖွဲ့စည်းနိုင်',
    modifiers: [
      'ယှဉ်တွဲပြပုဒ်',
      'ထွက်ခွာရာပြပုဒ်',
      'ရှေးရှုရာပြပုဒ်',
      'အသုံးခံပြပုဒ်',
      'အချိန်ပြပုဒ်',
    ],
  },
};
const STATEMENT_MARKERS = {
  ref: '§120',
  type: 'ထုတ်ဖော်ဝါကျ',
  present_past: {
    particles: ['သည်', '၏'],
    meaning: 'ကတ္တား၏ ပြုသည်၊ ဖြစ်သည်၊ ရှိသည်၏ အဖြစ်',
  },
  future: {
    particles: ['မည်', 'လတ္တံ့', 'အံ့'],
    meaning: 'ကတ္တား၏ ပြုမည့်၊ ဖြစ်မည့်၊ ရှိမည့် အဖြစ်',
  },
};
const BARE_IMPERATIVE = {
  ref: '§121',
  type: 'တိုက်တွန်းဝါကျ(အမိန့်ပေး/စေခိုင်း)',
  particle: null,
};
const EXPLICIT_IMPERATIVE = {
  ref: '§122',
  type: 'တိုက်တွန်းဝါကျ(စေခိုင်း/တိုက်တွန်း/နှိုးဆော်)',
  particles: {
    wibat: ['လော့', 'ပါလော့'],
    pyitsi: ['နော်', 'ကွယ်', 'ပါလား', 'နှင့်ပါလား'],
  },
};
const HORTATIVE = {
  ref: '§123',
  type: 'တိုက်တွန်းဝါကျ(အတူတကွဆောင်ရွက်လိုခြင်း/နှိုးဆော်)',
  particles: ['စို့', 'ကြစို့', 'ရအောင်'],
};
const OPTATIVE = {
  ref: '§124',
  type: 'ဆန္ဒဝါကျ(တောင့်တခြင်း/ကျိန်ဆဲခြင်း/ခွင့်ပြုခြင်း)',
  particle: 'ပါစေ',
  subtypes: [
    { name: 'တောင့်တခြင်း(blessing/wish)' },
    { name: 'ကျိန်ဆဲခြင်း(curse)' },
    { name: 'ခွင့်ပြုခြင်း(permission)' },
  ],
  context_rule: 'ကြိယာ၏သတ္တိကိုလိုက်၍ အဓိပ္ပာယ်ကွဲပြားသည်',
};
const REQUEST = {
  ref: '§125',
  type: 'ဆန္ဒဝါကျ(ခွင့်တောင်းခြင်း)',
  particle: 'ပါရစေ',
};
const DECREE = {
  ref: '§126',
  type: 'တိုက်တွန်းဝါကျ(အမိန့်ပေး/စေခိုင်း — တရားဝင်)',
  particle: 'စေ',
};
const SENTENCE_TYPE_SUMMARY = {
  ref: '§127',
  categories: [
    {
      id: 'က',
      name: 'ပြုခြင်း/ဖြစ်ခြင်း/ရှိခြင်း ပြသော ဝါကျ',
      refs: ['§120'],
      type: 'ထုတ်ဖော်ဝါကျ',
    },
    {
      id: 'ခ',
      name: 'အမိန့်ပေး/စေခိုင်း/တိုက်တွန်း/နှိုးဆော်',
      refs: ['§121', '§122', '§126'],
      type: 'တိုက်တွန်းဝါကျ',
    },
    {
      id: 'ဂ',
      name: 'အတူတကွ ဆောင်ရွက်လိုခြင်း',
      refs: ['§123'],
      type: 'တိုက်တွန်းဝါကျ',
    },
    {
      id: 'ဃ',
      name: 'တောင့်တ/ကျိန်ဆဲ/ခွင့်ပြု/ခွင့်တောင်း',
      refs: ['§124', '§125'],
      type: 'ဆန္ဒဝါကျ',
    },
  ],
};
const PARTICLE_COMBINATIONS = {
  ref: '§128',
  patterns: [
    { particles: ['ကြစို့'], note: 'basic hortative' },
    { particles: ['ကြပါစို့'], note: 'polite hortative' },
    { particles: ['ကြပါစို့', 'ကွယ်'], note: 'affectionate hortative' },
    { particles: ['ကြပါစို့', 'ကွာ'], note: 'familiar hortative' },
    { particles: ['စို့', 'လေ'], note: 'gentle hortative' },
    { particles: ['ကြရအောင်', 'ကွာ'], note: 'urgent hortative' },
  ],
};
const NEGATION = {
  ref: '§129',
  type: 'ငြင်းပယ်ဝါကျ',
  marker: 'မ',
  structure: 'မ+ကြိယာ(+ဘူး/နဲ့/နှင့်)',
};
const NEGATIVE_COMBINATIONS = {
  ref_130: '§130',
  ref_131: '§131',
  ref_132: '§132',
  ref_133: '§133',
  patterns: {
    pattern_1: {
      ref: '§130-က',
      structure: 'မ+(ကြိယာ)+ဘူး+[ကွယ်/ကွာ/နော်/ပါ/သေး/တော့]',
    },
    pattern_2: {
      ref: '§130-ခ',
      structure: 'မ+(ကြိယာ)+[နိုင်/ရ/စေရ/စေရပါ]+ဘူး',
    },
    pattern_3: {
      ref: '§131',
      structure: 'မ+(ကြိယာ)+နဲ့/နှင့်+[လေ/ကွယ်/အုံး/တော့/နော်]',
    },
    pattern_4: { ref: '§132', structure: 'မ+(ကြိယာ)+[ပါစေ/ပါရစေ]+နဲ့/နှင့်' },
    pattern_5: {
      ref: '§133',
      structure: 'မ+(ကြိယာ)+[နိုင်]+ပေါင်/ဘဲကို+[သေး]',
    },
  },
};
const INTERROGATIVE = {
  ref: '§134',
  type: 'မေးခွန်းဝါကျ',
  question_particles: ['နည်း', 'လဲ', 'တုံး'],
  question_words: [
    'ဘယ်',
    'အဘယ်',
    'မည်သူ',
    'ဘယ်သူ',
    'ဘာ',
    'မည်မျှ',
    'ဘယ်လို',
    'ဘယ်လောက်',
  ],
  structure: '(အမေးနာမ်စား/အမေးနာမဝိသေသန/အမေးကြိယာဝိသေသန)+ကြိယာ+အမေးပစ္စည်း',
};
const INTERROGATIVE_OMITTED = {
  ref: '§135',
  type: 'မေးခွန်းဝါကျ(ကြိယာမြှုပ်)',
  structure: 'အမေးနာမ်စား/အမေးနာမဝိသေသန+နည်း/လဲ/တုံး',
};
const INTERROGATIVE_INTERCHANGE = {
  ref: '§136',
  type: 'အမေးပစ္စည်းအလဲအလှယ်',
  particles: ['နည်း', 'လဲ', 'တုံး'],
  scope: 'same_syntactic_slot',
  semantic_equivalence: 'identical_meaning_different_register',
  compatible_with: {
    question_types: [
      'နာမ်မေးခွန်းဝါကျ',
      'နာမ်စားမေးခွန်းဝါကျ',
      'နာမ်ဝိသေသနမေးခွန်းဝါကျ',
      'ကြိယာဝိသေသနမေးခွန်းဝါကျ',
    ],
    question_words: ['မည်မျှ', 'ဘယ်လောက်', 'အဘယ်', 'ဘာ', 'ဘယ်', 'မည်သူ'],
  },
  interchange_rule:
    'particle_may_be_substituted_freely_without_altering_core_interrogative_meaning',
};
const INTERROGATIVE_LA_LAW = {
  ref: '§137',
  type: 'အမေးပစ္စည်းအလဲအလှယ်',
  particles: ['လား', 'လော'],
  scope: 'same_syntactic_slot',
  semantic_equivalence: 'identical_meaning_different_register',
  compatible_with: {
    question_types: [
      'နာမ်မေးခွန်းဝါကျ',
      'နာမ်စားမေးခွန်းဝါကျ',
      'နာမ်ဝိသေသနမေးခွန်းဝါကျ',
      'ကြိယာဝိသေသနမေးခွန်းဝါကျ',
    ],
  },
  interchange_rule:
    'particle_may_be_substituted_freely_without_altering_core_interrogative_meaning',
};
const SENTENCE_MEANING_TYPES = {
  ref: '§196',
  types: [
    {
      id: 'က',
      name: 'ထုတ်ဖော်ဝါကျ',
      meaning: 'statement',
      description: 'ပြုခြင်း/ဖြစ်ခြင်း/ရှိခြင်း ပြသော ဝါကျ',
    },
    {
      id: 'ခ',
      name: 'မေးခွန်းဝါကျ',
      meaning: 'question',
      description: 'မေးမြန်းခြင်း ပြသော ဝါကျ',
    },
    {
      id: 'ဂ',
      name: 'ငြင်းပယ်ဝါကျ',
      meaning: 'negative',
      description: 'ငြင်းပယ်ခြင်း/မဟုတ်ခြင်း ပြသော ဝါကျ',
    },
    {
      id: 'ဃ',
      name: 'တိုက်တွန်းဝါကျ',
      meaning: 'imperative',
      description: 'အမိန့်ပေး/စေခိုင်း/တိုက်တွန်း/နှိုးဆော်',
    },
    {
      id: 'င',
      name: 'ဆန္ဒဝါကျ',
      meaning: 'optative',
      description: 'တောင့်တ/ကျိန်ဆဲ/ခွင့်ပြု/ခွင့်တောင်း',
    },
  ],
};
const SENTENCE_CONSTRUCTION_TYPES = {
  ref: '§197',
  types: [
    {
      id: 'က',
      name: 'ဝါကျရိုး',
      meaning: 'simple_sentence',
      description: 'ကြိယာတစ်ခုပါသော ဝါကျ',
      rule: '§197-က',
    },
    {
      id: 'ခ',
      name: 'ဝါကျရော',
      meaning: 'compound_sentence',
      description: 'ကြိယာနှစ်ခုမကပါသော ဝါကျ',
      rule: '§197-ခ',
    },
  ],
};
const WORD_TYPES = {
  ref: '§199',
  types: [
    {
      id: 'က',
      name: 'ပုဒ်ရိုး',
      meaning: 'simple_word',
      description: 'မပျက်မကွာ သုံးနိုင်သော ပုဒ်',
      rule: '§199-က',
    },
    {
      id: 'ခ',
      name: 'ပေါင်းစပ်ပုဒ်',
      meaning: 'compound_word',
      description: 'ပုဒ်နှစ်ခုမက ပေါင်းစပ်ထားသော ပုဒ်',
      rule: '§199-ခ',
    },
    {
      id: 'ဂ',
      name: 'ပစ္စည်းရောပုဒ်',
      meaning: 'particle_inflected_word',
      description: 'ပစ္စည်းရောထားသော ပုဒ်',
      rule: '§199-ဂ',
    },
    {
      id: 'ဃ',
      name: 'ဝိဘတ်သွယ်ပုဒ်',
      meaning: 'postposition_inflected_word',
      description: 'ဝိဘတ်သွယ်ထားသော ပုဒ်',
      rule: '§199-ဃ',
    },
  ],
  compound_patterns: ['~'],
  particle_suffixes: ['သည်', 'က', 'မှာ', 'ကို', 'မှ', 'သို့'],
  postposition_markers: ['၌', 'တွင်', 'မှ', 'သို့', 'ထိ', 'အောင်'],
};
const WIBAT_TYPES = {
  ref: '§201',
  types: [
    {
      id: 'က',
      name: 'ကတ္တားဝိဘတ်',
      meaning: 'subject_postposition',
      particles: ['သည်', 'က', 'မှာ'],
      rule: '§201-က',
    },
    {
      id: 'ခ',
      name: 'ကံဝိဘတ်',
      meaning: 'object_postposition',
      particles: ['ကို'],
      rule: '§201-ခ',
    },
    {
      id: 'ဂ',
      name: 'ထွက်ခွာရာပြဝိဘတ်',
      meaning: 'ablative_postposition',
      particles: ['မှ'],
      rule: '§201-ဂ',
    },
    {
      id: 'ဃ',
      name: 'ရှေးရှုရာပြဝိဘတ်',
      meaning: 'directional_postposition',
      particles: ['သို့'],
      rule: '§201-ဃ',
    },
    {
      id: 'င',
      name: 'နေရာပြဝိဘတ်',
      meaning: 'locative_postposition',
      particles: ['၌', 'တွင်', 'ဝယ်', 'ဝက'],
      rule: '§201-င',
    },
    {
      id: 'စ',
      name: 'ပိုင်ဆိုင်ခြင်းပြဝိဘတ်',
      meaning: 'possessive_postposition',
      particles: ['၏'],
      rule: '§201-စ',
    },
    {
      id: 'ဆ',
      name: 'ကာလပြကြိယာဝိဘတ်',
      meaning: 'tense_postposition',
      particles: ['သည်', '၏', 'ပြီ', 'မည်', 'လတ္တံ့', 'အံ့'],
      rule: '§201-ဆ',
    },
  ],
  wibat_map: {
    သည်: { type: 'ကတ္တားဝိဘတ်', function: 'subject_marker' },
    က: { type: 'ကတ္တားဝိဘတ်', function: 'subject_marker' },
    မှာ: { type: 'ကတ္တားဝိဘတ်', function: 'subject_marker' },
    ကို: { type: 'ကံဝိဘတ်', function: 'object_marker' },
    မှ: { type: 'ထွက်ခွာရာပြဝိဘတ်', function: 'ablative' },
    သို့: { type: 'ရှေးရှုရာပြဝိဘတ်', function: 'directional' },
    '၌': { type: 'နေရာပြဝိဘတ်', function: 'locative' },
    တွင်: { type: 'နေရာပြဝိဘတ်', function: 'locative' },
    '၏': { type: 'ပိုင်ဆိုင်ခြင်းပြဝိဘတ်', function: 'possessive' },
    မည်: { type: 'ကာလပြကြိယာဝိဘတ်', function: 'future_tense' },
    လတ္တံ့: { type: 'ကာလပြကြိယာဝိဘတ်', function: 'future_tense' },
    အံ့: { type: 'ကာလပြကြိယာဝိဘတ်', function: 'future_tense' },
  },
};
const PHRASE_TYPES = {
  ref: '§202',
  types: [
    {
      id: 'က',
      name: 'ဝိဘတ်ဆက်ပုဒ်စု',
      meaning: 'postposition_phrase',
      description: 'နာမ်/နာမ်စား+ဝိဘတ်',
      rule: '§202-က',
    },
    {
      id: 'ခ',
      name: 'ပစ္စည်းဆက်ပုဒ်စု',
      meaning: 'particle_phrase',
      description: 'ပုဒ်+ပစ္စည်း',
      rule: '§202-ခ',
    },
    {
      id: 'ဂ',
      name: 'သမ္ဗန္ဓဆက်ပုဒ်စု',
      meaning: 'conjunction_phrase',
      description: 'ဝါကျ/ပုဒ်+သမ္ဗန္ဓ',
      rule: '§202-ဂ',
    },
  ],
  conjunction_markers: [
    'နှင့်',
    'သို့မဟုတ်',
    'လည်းကောင်း',
    'ဖြစ်စေ',
    'မှတစ်ပါး',
    'ထို့ပြင်',
  ],
};
const ANALYSIS_STEPS = {
  ref: '§194-§205',
  steps: [
    {
      step: 1,
      name: 'ဝါကျအနက်အဓိပ္ပာယ်ခွဲခြားခြင်း',
      action: 'determine_meaning_type',
      refs: ['§196'],
      description: 'ထုတ်ဖော်/မေး/ငြင်း/တိုက်တွန်/ဆန္ဒ',
    },
    {
      step: 2,
      name: 'ဝါကျဖွဲ့စည်းပုံခွဲခြားခြင်း',
      action: 'determine_construction_type',
      refs: ['§197'],
      description: 'ဝါကျရိုး/ဝါကျရော',
    },
    {
      step: 3,
      name: 'ပုဒ်အမျိုးအစားခွဲခြားခြင်း',
      action: 'classify_words',
      refs: ['§199-§201'],
      description: 'ပုဒ်ရိုး/ပေါင်းစပ်/ပစ္စည်းရောဝိဘတ်သွယ်',
    },
    {
      step: 4,
      name: 'ဝိဘတ်သွယ်ပုဒ်ခွဲခြားခြင်း',
      action: 'classify_wibat',
      refs: ['§201'],
      description: 'ဝိဘတ်အမျိုးအစား',
    },
    {
      step: 5,
      name: 'ပုဒ်စုခွဲခြားခြင်း',
      action: 'classify_phrases',
      refs: ['§202-§203'],
      description: 'ဝိဘတ်/ပစ္စည်း/သမ္ဗန္ဓဆက်ပုဒ်စု',
    },
    {
      step: 6,
      name: 'ဝါကျကဏ္ဍခွဲခြားခြင်း',
      action: 'classify_clauses',
      refs: ['§139-§162'],
      description: 'အမှီခံ/အမှီဝါကျကဏ္ဍ',
    },
  ],
};
const CLAUSE_DEFINITION = {
  ref: '§139',
  myanmar: 'ဝါကျကဏ္ဍ',
  requirements: ['ကတ္တား', 'ကြိယာ'],
  types: [
    { id: 'က', name: 'အမှီခံဝါကျကဏ္ဍ', ref: '§141', can_stand_alone: true },
    { id: 'ခ', name: 'အမှီဝါကျကဏ္ဍ', ref: '§140', can_stand_alone: false },
  ],
};
const DEPENDENT_CLAUSE_DEF = {
  ref: '§140',
  myanmar: 'အမှီဝါကျကဏ္ဍ',
  core_properties: {
    has_subject: true,
    has_verb: true,
    can_stand_alone: false,
    meaning_complete: false,
    requires_attachment: true,
  },
  position_in_sentence: 'before_main_verb_or_between_subject_verb',
  connector_types: ['ဝိဘတ်', 'ပစ္စည်း', 'သမ္ဗန္ဓ'],
};
const INDEPENDENT_CLAUSE_DEF = {
  ref: '§141',
  myanmar: 'အမှီခံဝါကျကဏ္ဍ',
  core_properties: {
    has_subject: true,
    has_verb: true,
    can_stand_alone: true,
    meaning_complete: true,
    requires_attachment: false,
  },
  uniqueness: {
    description: 'ဝါကျရော တစ်ခုလျှင် အမှီခံဝါကျကဏ္ဍ တစ်ခုသာပါဝင်သည်',
    rule: 'Only ONE independent clause per compound sentence',
  },
};
const INDEPENDENT_ENDINGS = {
  statement: { particles: ['သည်', '၏', 'ပြီ'], type: 'ထုတ်ဖော်ဝါကျ' },
  future: { particles: ['မည်', 'လတ္တံ့', 'အံ့'], type: 'ထုတ်ဖော်ဝါကျ(အနာဂတ်)' },
  imperative: {
    particles: ['လော့', 'စို့', 'ရအောင်', 'ပါရစေ', 'စေ'],
    type: 'တိုက်တွန်းဝါကျ',
  },
  question: {
    particles: ['လား', 'လဲ', 'နည်း', 'တုံး', 'လော'],
    type: 'မေးခွန်းဝါကျ',
  },
  optative: { particles: ['ပါစေ'], type: 'ဆန္ဒဝါကျ' },
};
const CLAUSE_ROLES = {
  independent: {
    myanmar: 'အမှီခံဝါကျကဏ္ဍ',
    definition: 'သီးခြားရပ်တည်နိုင်သော အဓိပ္ပာယ်ပြည့်စုံသော ပုဒ်အစုအပေါင်း',
    requirements: ['ကတ္တား', 'ကြိယာ'],
    can_stand_alone: true,
  },
  dependent: {
    myanmar: 'အမှီဝါကျကဏ္ဍ',
    requirements: ['ကတ္တား', 'ကြိယာ'],
    can_stand_alone: false,
    must_attach_to: 'independent',
  },
};
const CROSS_REFERENCE = {
  ref: '§142',
  references: [
    { book: 'မြန်မာသဒ္ဒါ', volume: 2, chapter: 5, topic: 'ဝါကျကဏ္ဍအမျိုးအစား' },
    { book: 'မြန်မာသဒ္ဒါ', volume: 2, chapter: 6, topic: 'ဝါကျရောဖွဲ့နည်း' },
  ],
};
const COMPOUND_OMISSION_RULES = {
  ref: '§143',
  rules: [
    {
      id: 'ကတ္တားတူညီမြှုပ်',
      ref: '§191-က',
      condition: 'dependent.subject===independent.subject',
      action: 'omit_dependent_subject',
    },
    {
      id: 'ကံသက်ရောက်ကတ္တားမြှုပ်',
      ref: '§191-ခ',
      condition: 'dependent.object===independent.subject',
      action: 'omit_independent_subject_or_dependent_object',
    },
  ],
  dependent_as_argument: [
    {
      dependent: 'မောင်မောင်ပြန်လာသည်ကို',
      role: 'ကံ',
      independent: 'ကျွန်တော်မြင်သည်',
    },
    { dependent: 'သူပြောသည်မှာ', role: 'ကတ္တား', independent: 'အမှန်ဖြစ်သည်' },
    { dependent: 'မောင်မောင်ပထမရသည်က', role: 'ကတ္တား', independent: 'များသည်' },
  ],
};
const CLAUSE_BOUNDARY_MARKERS = {
  dependent: {
    noun_clause: ['ကို', 'မှာ', 'က'],
    adjective_clause: ['သော', 'သည့်', 'မည့်'],
    adverb_clause: [
      'သောအခါ',
      'သောကြောင့်',
      'သဖြင့်',
      'လျှင်',
      'မှ',
      'အောင်',
      'ရန်',
      'သလို',
      'သကဲ့သို့',
      'လျက်',
      'ကာ',
      '၍',
      'ရင်း',
    ],
  },
  independent: {
    statement: ['သည်', '၏', 'ပြီ', 'မည်', 'လတ္တံ့', 'အံ့'],
    imperative: ['လော့', 'စို့', 'ရအောင်', 'ပါရစေ', 'စေ'],
    question: ['လား', 'လဲ', 'နည်း', 'တုံး', 'လော'],
    optative: ['ပါစေ'],
  },
};
const SINGLE_DEPENDENT_STRUCTURE = {
  ref: '§145',
  verb_count: 2,
  front_verb: { role: 'dependent_clause_verb', position: 'front' },
  final_verb: { role: 'independent_clause_verb', position: 'end' },
  rule: 'အမှီဝါကျကဏ္ဍတစ်ခုသာပါဝင်သော ဝါကျရောတစ်ခုတွင် ကြိယာ ၂ ခု ပါရှိသည်',
};
const CONNECTOR_BOUNDARY_RULE = {
  ref: '§146',
  rule: 'ဝါကျ၏ရှေ့ပိုင်းရှိ ကြိယာနောက်တွင် ဝိဘတ်ဖြစ်စေ၊ ဝိဘတ်ပစ္စည်းဖြစ်စေ၊ ပစ္စည်းသမ္ဗန္ဓဖြစ်စေ သမ္ဗန္ဓတစ်ခုခုရှိမည်',
  dependent_clause: {
    ends_with: ['ဝိဘတ်', 'ပစ္စည်း', 'သမ္ဗန္ဓ'],
    position: 'front',
  },
  independent_clause: { starts_after: 'connector', contains: 'final_verb' },
};
const SPLIT_PROCEDURE = {
  ref: '§147',
  steps: [
    { step: 1, action: 'identify_all_verbs', expected: 2 },
    {
      step: 2,
      action: 'find_connector_after_front_verb',
      check: 'ဝိဘတ်/ပစ္စည်း/သမ္ဗန္ဓ',
    },
    {
      step: 3,
      action: 'mark_dependent_clause',
      from: 'start',
      to: 'connector',
    },
    {
      step: 4,
      action: 'mark_independent_clause',
      from: 'after_connector',
      to: 'end',
    },
    { step: 5, action: 'verify_both_have_subject_verb' },
  ],
  patterns: [
    {
      pattern: '(ကတ္တား)(ကြိယာ)(သမ္ဗန္ဓ)(ကတ္တား)(ကြိယာ)(ဝိဘတ်)',
      dependent: 'first_3',
      independent: 'last_3',
    },
    {
      pattern: '(ကတ္တား)(ကြိယာ)(ပစ္စည်း)(ကတ္တား)(ကြိယာ)',
      dependent: 'first_3',
      independent: 'last_2',
    },
  ],
};
const CLAUSE_SUBJECT_OMISSION = {
  ref: '§148',
  rule: 'ဝါကျကဏ္ဍတွင် ကတ္တားနှင့်ကြိယာ ပါရှိမြဲဖြစ်သော်လည်း အချို့ဝါကျကဏ္ဍတို့၌ ကတ္တားပုဒ်ကို မြှုပ်ထားတတ်သည်',
  types: [
    {
      type: 'independent_omits_subject',
      when: 'subject_shared_from_dependent',
    },
    {
      type: 'dependent_omits_subject',
      when: 'subject_shared_from_independent',
    },
    { type: 'both_omit_subject', when: 'contextually_clear' },
  ],
};
const DEPENDENT_CLAUSE_TYPES = {
  ref: '§149',
  types: [
    {
      id: 'က',
      name: 'နာမ်ဝါကျကဏ္ဍ',
      ref: '§150',
      function: 'acts_as_noun',
      roles: ['ကတ္တား', 'ကံ'],
      ending_particles: ['ကို', 'မှာ', 'က'],
      description: 'နာမ်သဘောသက်ရောက်သော အမှီဝါကျကဏ္ဍ',
    },
    {
      id: 'ခ',
      name: 'နာမဝိသေသနဝါကျကဏ္ဍ',
      ref: '§151',
      function: 'modifies_noun',
      roles: ['adjectival_modifier'],
      ending_particles: ['သော', 'သည့်', 'မည့်'],
      description: 'နာမဝိသေသနသဘောသက်ရောက်သော အမှီဝါကျကဏ္ဍ',
    },
    {
      id: 'ဂ',
      name: 'ကြိယာဝိသေသနဝါကျကဏ္ဍ',
      ref: '§152',
      function: 'modifies_verb',
      roles: ['adverbial_modifier'],
      ending_particles: [
        'သောအခါ',
        'သောကြောင့်',
        'သဖြင့်',
        'လျှင်',
        'မှ',
        'အောင်',
        'ရန်',
        'သလို',
        'သကဲ့သို့',
        'လျက်',
        'ကာ',
        '၍',
        'ရင်း',
      ],
      description: 'ကြိယာဝိသေသနသဘောသက်ရောက်သော အမှီဝါကျကဏ္ဍ',
    },
  ],
};
const DEPENDENT_CLAUSE_SUBTYPES = {
  ref: '§149',
  types: [
    {
      id: 'က',
      name: 'နာမ်ဝါကျကဏ္ဍ',
      function: 'acts_as_noun',
      roles: ['ကတ္တား', 'ကံ'],
      ending_particles: ['ကို', 'မှာ', 'က'],
      ref: '§150',
    },
    {
      id: 'ခ',
      name: 'နာမဝိသေသနဝါကျကဏ္ဍ',
      function: 'modifies_noun',
      roles: ['adjectival_modifier'],
      ending_particles: ['သော', 'သည့်', 'မည့်'],
      ref: '§151',
    },
    {
      id: 'ဂ',
      name: 'ကြိယာဝိသေသနဝါကျကဏ္ဍ',
      function: 'modifies_verb',
      roles: ['adverbial_modifier'],
      ending_particles: [
        'သောအခါ',
        'သောကြောင့်',
        'သဖြင့်',
        'လျှင်',
        'မှ',
        'အောင်',
        'ရန်',
        'သလို',
        'သကဲ့သို့',
        'လျက်',
        'ကာ',
        '၍',
        'ရင်း',
      ],
      ref: '§152',
    },
  ],
};
const DEPENDENT_TYPE_MAP = {
  ကို: { type: 'နာမ်ဝါကျကဏ္ဍ', role: 'ကံ', ref: '§150' },
  မှာ: { type: 'နာမ်ဝါကျကဏ္ဍ', role: 'ကတ္တား', ref: '§150' },
  က: { type: 'နာမ်ဝါကျကဏ္ဍ', role: 'ကတ္တား/ကံ', ref: '§150' },
  သော: { type: 'နာမဝိသေသနဝါကျကဏ္ဍ', role: 'adjectival', ref: '§151' },
  သည့်: { type: 'နာမဝိသေသနဝါကျကဏ္ဍ', role: 'adjectival', ref: '§151' },
  မည့်: { type: 'နာမဝိသေသနဝါကျကဏ္ဍ', role: 'adjectival', ref: '§151' },
  သောအခါ: { type: 'ကြိယာဝိသေသနဝါကျကဏ္ဍ', subtype: 'အချိန်ပြ', ref: '§152' },
  သောကြောင့်: {
    type: 'ကြိယာဝိသေသနဝါကျကဏ္ဍ',
    subtype: 'အကြောင်းပြ',
    ref: '§152',
  },
  သဖြင့်: { type: 'ကြိယာဝိသေသနဝါကျကဏ္ဍ', subtype: 'အကြောင်းပြ', ref: '§152' },
  လျှင်: { type: 'ကြိယာဝိသေသနဝါကျကဏ္ဍ', subtype: 'ကန့်သတ်ချက်ပြ', ref: '§152' },
  မှ: { type: 'ကြိယာဝိသေသနဝါကျကဏ္ဍ', subtype: 'ကန့်သတ်ချက်ပြ', ref: '§152' },
  အောင်: {
    type: 'ကြိယာဝိသေသနဝါကျကဏ္ဍ',
    subtype: 'အကျိုးမျှော်ပြ',
    ref: '§152',
  },
  ရန်: { type: 'ကြိယာဝိသေသနဝါကျကဏ္ဍ', subtype: 'အကျိုးမျှော်ပြ', ref: '§152' },
  သလို: { type: 'ကြိယာဝိသေသနဝါကျကဏ္ဍ', subtype: 'နှိုင်းယှဉ်ပြ', ref: '§152' },
  သကဲ့သို့: {
    type: 'ကြိယာဝိသေသနဝါကျကဏ္ဍ',
    subtype: 'နှိုင်းယှဉ်ပြ',
    ref: '§152',
  },
  လျက်: { type: 'ကြိယာဝိသေသနဝါကျကဏ္ဍ', subtype: 'အမူအရာပြ', ref: '§152' },
  ကာ: { type: 'ကြိယာဝိသေသနဝါကျကဏ္ဍ', subtype: 'အမူအရာပြ', ref: '§152' },
  '၍': { type: 'ကြိယာဝိသေသနဝါကျကဏ္ဍ', subtype: 'အမူအရာပြ', ref: '§152' },
  ရင်း: { type: 'ကြိယာဝိသေသနဝါကျကဏ္ဍ', subtype: 'အမူအရာပြ', ref: '§152' },
};
const NOUN_CLAUSE_RULE = {
  ref: '§120',
  name: 'နာမ်ဝါကျကဏ္ဍ',
  requirements: ['ကတ္တား', 'ကြိယာ'],
  semantic_force: 'နာမ်သဘော',
  ending_particles: ['ကို', 'မှာ', 'က'],
  particle_type: 'နာမ်ဝိဘတ်',
  roles_in_independent: ['ကတ္တား', 'ကံ'],
  rule: 'ကတ္တားနှင့်ကြိယာပါရှိပြီး နာမ်သဘောသက်ရောက်သော အမှီဝါကျကဏ္ဍကို နာမ်ဝါကျကဏ္ဍဟု ခေါ်သည်။ အဆုံး၌ ကို၊ မှာ၊ က စသည့် နာမ်ဝိဘတ်များ ပါဝင်ကြသည်။',
};
const NOUN_CLAUSE_DUTY = {
  ref: '§150',
  duty: 'နာမ်၏လုပ်ငန်းတာဝန်',
  actions: [
    { type: 'ကတ္တား၏လုပ်ငန်း', description: 'subject_action' },
    { type: 'ကတ္တား-ကံ၏လုပ်ငန်း', description: 'object_action' },
  ],
  rule: 'နာမ်၏လုပ်ငန်းတာဝန်ကို ဆောင်ရွက်သော အမှီဝါကျကဏ္ဍသည် နာမ်ဝါကျကဏ္ဍဖြစ်သည်။ ကတ္တား၏လုပ်ငန်းကိုသော်လည်းကောင်း၊ ကတ္တား-ကံ၏လုပ်ငန်းကိုသော်လည်းကောင်း ဆောင်ရွက်သည်။',
};
const ADJECTIVE_CLAUSE_RULE = {
  ref: '§151',
  name: 'နာမဝိသေသနဝါကျကဏ္ဍ',
  requirements: ['ကတ္တား', 'ကြိယာ'],
  semantic_force: 'နာမဝိသေသနသဘော',
  ending_particles: ['သော', 'သည့်', 'မည့်'],
  particle_type: 'နာမဝိသေသနပုဒ်ပြောင်းပစ္စည်း',
  duty: 'နာမဝိသေသန၏လုပ်ငန်းတာဝန်',
  modifies: 'သက်ဆိုင်ရာနာမ်_နာမ်စား',
  rule: 'နာမဝိသေသန၏လုပ်ငန်းတာဝန်ကို ဆောင်ရွက်သော အမှီဝါကျကဏ္ဍသည် နာမဝိသေသနဝါကျကဏ္ဍဖြစ်သည်။ သက်ဆိုင်ရာနာမ်၊ နာမ်စားကို အထူးပြုသည်။ အဆုံး၌ သော၊ သည့်၊ မည့် ပစ္စည်းများ ပါဝင်ကြသည်။',
};
const ADVERB_CLAUSE_TYPES = {
  ref: '§121-122',
  name: 'ကြိယာဝိသေသနဝါကျကဏ္ဍ',
  requirements: ['ကတ္တား', 'ကြိယာ'],
  semantic_force: 'ကြိယာဝိသေသနသဘော',
  types: [
    {
      id: 1,
      name: 'ဆန့်ကျင်ပြကြိယာဝိသေသနဝါကျကဏ္ဍ',
      meaning: 'contrastive',
      ending_thanbanda: ['သော်လည်း', 'စေကာမူ'],
      description:
        'ဆန့်ကျင်ခြင်းအနက်ဖြင့် ကြိယာဝိသေသနသဘောသက်ရောက်သော အမှီဝါကျကဏ္ဍ',
    },
    {
      id: 2,
      name: 'အချိန်ပြကြိယာဝိသေသနဝါကျကဏ္ဍ',
      meaning: 'temporal',
      ending_thanbanda: ['သောအခါ', 'နှင့်တစ်ပြိုင်နက်'],
      description:
        'အချိန်ကာလကို ဖော်ပြခြင်းဖြင့် ကြိယာဝိသေသနသဘောသက်ရောက်သော အမှီဝါကျကဏ္ဍ',
    },
    {
      id: 3,
      name: 'အကျိုးမျှော်ပြကြိယာဝိသေသနဝါကျကဏ္ဍ',
      meaning: 'purposive',
      ending_thanbanda: ['အောင်', 'ရန်'],
      description:
        'အကျိုးတစ်စုံတစ်ရာ မျှော်လင့်ခြင်းအနက်ဖြင့် ကြိယာဝိသေသနသဘောသက်ရောက်သော အမှီဝါကျကဏ္ဍ',
    },
    {
      id: 4,
      name: 'အကြောင်းပြကြိယာဝိသေသနဝါကျကဏ္ဍ',
      meaning: 'causal',
      ending_thanbanda: ['သောကြောင့်', 'သဖြင့်'],
      description: 'အကြြခြင်းအနက်ဖြင့် ကြိယာဝိသေသနသဘောသက်ရောက်သော အမှီဝါကျကဏ္ဍ',
    },
    {
      id: 5,
      name: 'နှိုင်းယှဉ်ပြကြိယာဝိသေသနဝါကျကဏ္ဍ',
      meaning: 'comparative',
      ending_thanbanda: ['သကဲ့သို့', 'သလို'],
      description:
        'သက်ရှိ၊ သက်မဲ့ စသည်တို့ကို တစ်ခုနှင့်တစ်ခု နှိုင်းယှဉ်သည့်အနက်ဖြင့် ကြိယာဝိသေသနသဘောသက်ရောက်သော အမှီဝါကျကဏ္ဍ',
    },
    {
      id: 6,
      name: 'ကန့်သတ်ချက်ပြကြိယာဝိသေသနဝါကျကဏ္ဍ',
      meaning: 'conditional',
      ending_thanbanda: ['လျှင်', 'မှ'],
      description:
        'တစ်စုံတစ်ရာသော အခြေအနေကို ကန့်သတ်သည့်အနက်ဖြင့်ဖြစ်စေ၊ စည်းကမ်းသတ်မှတ်သည့်အနက်ဖြင့်ဖြစ်စေ ကြိယာဝိသေသနသဘောသက်ရောက်သော အမှီဝါကျကဏ္ဍ',
    },
    {
      id: 7,
      name: 'ကန့်သတ်မဲ့ပြကြိယာဝိသေသနဝါကျကဏ္ဍ',
      meaning: 'unconditional',
      ending_thanbanda: [
        'ဖြစ်စေ...မ...ဖြစ်စေ',
        'လျှင်သော်လည်းကောင်း...လျှင်သော်လည်းကောင်း',
      ],
      description:
        'တစ်စုံတစ်ရာသော အခြေအနေကို ကန့်သတ်ခြင်းမရှိသည့်အနက်ဖြင့်ဖြစ်စေ၊ စည်းကမ်းသတ်မှတ်ခြင်းမရှိသည့်အနက်ဖြင့်ဖြစ်စေ ကြိယာဝိသေသနသဘောသက်ရောက်သော အမှီဝါကျကဏ္ဍ',
    },
    {
      id: 8,
      name: 'ပမာဏပြကြိယာဝိသေသနဝါကျကဏ္ဍ',
      meaning: 'quantitative',
      ending_thanbanda: ['သလောက်', 'ကာမျှဖြင့်'],
      description:
        'ပမာဏကို ဖော်ပြခြင်းဖြင့် ကြိယာဝိသေသနသဘောသက်ရောက်သော အမှီဝါကျကဏ္ဍ',
    },
    {
      id: 9,
      name: 'အမူအရာပြကြိယာဝိသေသနဝါကျကဏ္ဍ',
      meaning: 'manner',
      ending_thanbanda: ['လျက်', 'ကာ', '၍', 'ရင်း'],
      description:
        'အမူအရာကို ဖော်ပြခြင်းဖြင့် ကြိယာဝိသေသနသဘောသက်ရောက်သော အမှီဝါကျကဏ္ဍ',
    },
  ],
};
const ADVERB_CLAUSE_DUTY = {
  ref: '§152',
  duty: 'ကြိယာဝိသေသန၏လုပ်ငန်းတာဝန်',
  modifies: 'သက်ဆိုင်ရာကြိယာ',
  rule: 'ကြိယာဝိသေသန၏လုပ်ငန်းတာဝန်ကို ဆောင်ရွက်သော အမှီဝါကျကဏ္ဍသည် ကြိယာဝိသေသနဝါကျကဏ္ဍဖြစ်သည်။ သက်ဆိုင်ရာကြိယာကို အထူးပြုသည်။',
};
const ADVERB_PARTICLE_MAP = {
  သော်လည်း: { type: 'ဆန့်ကျင်ပြ', id: 1, ref: '§122(က)' },
  စေကာမူ: { type: 'ဆန့်ကျင်ပြ', id: 1, ref: '§122(က)' },
  သောအခါ: { type: 'အချိန်ပြ', id: 2, ref: '§122(ခ)' },
  နှင့်တစ်ပြိုင်နက်: { type: 'အချိန်ပြ', id: 2, ref: '§122(ခ)' },
  အောင်: { type: 'အကျိုးမျှော်ပြ', id: 3, ref: '§122(ဂ)' },
  ရန်: { type: 'အကျိုးမျှော်ပြ', id: 3, ref: '§122(ဂ)' },
  သောကြောင့်: { type: 'အကြောင်းပြ', id: 4, ref: '§122(ဃ)' },
  သဖြင့်: { type: 'အကြောင်းပြ', id: 4, ref: '§122(ဃ)' },
  သကဲ့သို့: { type: 'နှိုင်းယှဉ်ပြ', id: 5, ref: '§122(င)' },
  သလို: { type: 'နှိုင်းယှဉ်ပြ', id: 5, ref: '§122(င)' },
  လျှင်: { type: 'ကန့်သတ်ချက်ပြ', id: 6, ref: '§122(စ)' },
  မှ: { type: 'ကန့်သတ်ချက်ပြ', id: 6, ref: '§122(စ)' },
  ဖြစ်စေ: { type: 'ကန့်သတ်မဲ့ပြ', id: 7, ref: '§122(ဆ)' },
  လျှင်သော်လည်းကောင်း: { type: 'ကန့်သတ်မဲ့ပြ', id: 7, ref: '§122(ဆ)' },
  သလောက်: { type: 'ပမာဏပြ', id: 8, ref: '§122(ဇ)' },
  ကာမျှဖြင့်: { type: 'ပမာဏပြ', id: 8, ref: '§122(ဇ)' },
  လျက်: { type: 'အမူအရာပြ', id: 9, ref: '§122(ဈ)' },
  ကာ: { type: 'အမူအရာပြ', id: 9, ref: '§122(ဈ)' },
  '၍': { type: 'အမူအရာပြ', id: 9, ref: '§122(ဈ)' },
  ရင်း: { type: 'အမူအရာပြ', id: 9, ref: '§122(ဈ)' },
};
const SINGLE_DEPENDENT_CHARACTERISTICS = {
  ref: '§153',
  name: 'အမှီဝါကျကဏ္ဍတစ်ခုသာ ပါဝင်သောဝါကျရောတို့၏ အခြေခံသဘောလက္ခဏာများ',
  characteristics: [
    {
      id: '(က)',
      name: 'dependent_first_independent_last',
      rule: 'အမှီဝါကျကဏ္ဍသည် ဝါကျအစပိုင်း၌ရှိ၍ အမှီခံဝါကျကဏ္ဍသည် ဝါကျ၏အဆုံးပိုင်း၌ရှိသည်',
      description:
        'Dependent clause occupies the initial position;independent clause occupies the final position.',
      position_constraint: { dependent: 'front', independent: 'end' },
    },
    {
      id: '(ခ)',
      name: 'dependent_between_subject_verb',
      rule: 'အမှီဝါကျကဏ္ဍသည် အမှီခံဝါကျကဏ္ဍ၏ ကတ္တားနှင့်ကြိယာအကြား၌လည်း ရှိတတ်သည်',
      description:
        'Dependent clause may also appear between the subject and verb of the independent clause.',
      position_constraint: {
        dependent: 'between_subject_verb',
        independent: 'wraps',
      },
    },
    {
      id: '(ဂ)',
      name: 'dependent_is_basic_sentence_with_connector',
      rule: 'အမှီဝါကျကဏ္ဍသည် ဝါကျရိုးကို ဝိဘတ်၊ ပစ္စည်း၊ သမ္ဗန္ဓတစ်ခုခုဆက်ထားသော ဝါကျကဏ္ဍဖြစ်သည်',
      description:
        'The dependent clause is a basic sentence joined by a wibat,pyitsi,or thanbanda.',
      structure: {
        base: 'ဝါကျရိုး',
        connector_type: ['ဝိဘတ်', 'ပစ္စည်း', 'သမ္ဗန္ဓ'],
      },
    },
    {
      id: '(ဃ)',
      name: 'connector_shows_boundary_and_relation',
      rule: 'ဝိဘတ်၊ ပစ္စည်း၊ သမ္ဗန္ဓတို့သည် အမှီဝါကျကဏ္ဍ၏ နယ်နိမိတ်ကို ပိုင်းခြားပြရုံမျှမက အမှီဝါကျကဏ္ဍသည် အမှီခံဝါကျကဏ္ဍကို မည်သို့အမှီပြုနေကြောင်းကိုလည်း ပြသည်',
      description:
        'Connectors not only mark the dependent-clause boundary but also indicate how the dependent clause relates to the independent clause.',
      connector_function: ['boundary_marker', 'relation_marker'],
    },
    {
      id: '(င)',
      name: 'subject_omission_at_clause_level',
      rule: 'ဝါကျရိုးတွင် ကတ္တားပုဒ်တစ်ခုနှင့် ကြိယာပုဒ်တစ်ခု ပါဝင်ဖွဲ့စည်းထားသည် ဆိုသော်လည်း ဝါကျကဏ္ဍအဆင့်၌ ကတ္တားပုဒ်ကို ရံဖန်ရံခါမြှုပ်၍ ရေးတတ်သည်',
      description:
        'Although a basic sentence requires one subject and one verb,the subject may be omitted at the clause level.',
      omission_scope: 'clause_level',
    },
  ],
};
const CONNECTOR_CLAUSE_TYPE_MAP = {
  မှာ: { type: 'နာမ်ဝါကျကဏ္ဍ', particle_class: 'နာမ်ဝိဘတ်' },
  က: { type: 'နာမ်ဝါကျကဏ္ဍ', particle_class: 'နာမ်ဝိဘတ်' },
  ကို: { type: 'နာမ်ဝါကျကဏ္ဍ', particle_class: 'နာမ်ဝိဘတ်' },
  ကား: { type: 'နာမ်ဝါကျကဏ္ဍ', particle_class: 'ပစ္စည်း' },
  ဟု: { type: 'နာမ်ဝါကျကဏ္ဍ', particle_class: 'ပစ္စည်း' },
  'ဟူ၍': { type: 'နာမ်ဝါကျကဏ္ဍ', particle_class: 'ပစ္စည်း' },
  သော: { type: 'နာမဝိသေသနဝါကျကဏ္ဍ', particle_class: 'ပစ္စည်း' },
  သည့်: { type: 'နာမဝိသေသနဝါကျကဏ္ဍ', particle_class: 'ပစ္စည်း' },
  မည့်: { type: 'နာမဝိသေသနဝါကျကဏ္ဍ', particle_class: 'ပစ္စည်း' },
  မူ: { type: 'ကြိယာဝိသေသနဝါကျကဏ္ဍ', particle_class: 'သမ္ဗန္ဓ' },
  သောကြောင့်: { type: 'ကြိယာဝိသေသနဝါကျကဏ္ဍ', particle_class: 'သမ္ဗန္ဓ' },
  သော်လည်း: { type: 'ကြိယာဝိသေသနဝါကျကဏ္ဍ', particle_class: 'သမ္ဗန္ဓ' },
  လျက်: { type: 'ကြိယာဝိသေသနဝါကျကဏ္ဍ', particle_class: 'သမ္ဗန္ဓ' },
};
const MULTIPLE_VERB_STRUCTURE = {
  ref: '§156',
  verb_count: { min: 3, description: 'more_than_two' },
  final_verb: { role: 'independent_clause_verb', position: 'end' },
  preceding_verbs: { role: 'dependent_clause_verbs', position: 'front' },
  rule: 'အမှီဝါကျကဏ္ဍတစ်ခုမက ပါဝင်သော ဝါကျရောတစ်ခုတွင် ၂ ခုမကသောကြိယာများ ပါရှိသည်။ ဝါကျရော၏အဆုံးပိုင်းကြိယာသည် အမှီခံဝါကျကဏ္ဍ၏ ကြိယာဖြစ်၍ ဝါကျရော၏အရှေ့ပိုင်းကျန်ကြိယာတို့သည် အမှီဝါကျကဏ္ဍများ၏ ကြိယာများ ဖြစ်ကြသည်။',
};
const MULTIPLE_CONNECTOR_BOUNDARY = {
  ref: '§157',
  rule: 'ဝါကျရော၏ရှေ့ပိုင်းရှိ ကြိယာများနောက်တွင် ဝိဘတ်ဖြစ်စေ၊ ပစ္စည်းဖြစ်စေ၊ သမ္ဗန္ဓဖြစ်စေ တစ်ခုခုရှိမည်။ ထိုဝိဘတ်၊ ပစ္စည်း၊ သမ္ဗန္ဓတို့ဖြင့်ဆုံးသော အစိတ်အပိုင်းတို့သည် အမှီဝါကျကဏ္ဍများ ဖြစ်ကြသည်။',
  boundary_type: ['ဝိဘတ်', 'ပစ္စည်း', 'သမ္ဗန္ဓ'],
  segment_rule: 'connector_ending_segment_is_dependent_clause',
};
const NESTED_CLAUSE_RULE = {
  ref: '§158',
  rule: 'အမှီဝါကျကဏ္ဍတို့တွင် ထပ်ဆင့်အမှီဝါကျကဏ္ဍများ ရှိနေတတ်သည်။',
  nesting: 'dependent_within_dependent',
  levels: 'unbounded',
};
const DIRECT_DEPENDENT_NESTING = {
  ref: '§159',
  rule: 'အမှီခံဝါကျကဏ္ဍကို တိုက်ရိုက်အမှီပြုသော အမှီဝါကျကဏ္ဍတစ်ခု၌ အမှီဝါကျကဏ္ဍများ ထပ်ဆင့်ပါဝင်ဖွဲ့စည်းနေပုံကို ဆက်လက်လေ့လာနိုင်သည်။',
  applies_to: 'direct_dependent_clause',
  nested_types: 'all_dependent_subtypes',
};
const NOUN_CLAUSE_NESTING = {
  ref: '§160',
  host_type: 'နာမ်ဝါကျကဏ္ဍ',
  host_relation: 'တိုက်ရိုက်အမှီပြု_အမှီခံဝါကျကဏ္ဍ',
  permitted_nested: [
    'နာမဝိသေသနဝါကျကဏ္ဍ',
    'ကြိယာဝိသေသနဝါကျကဏ္ဍ',
    'နာမ်ဝါကျကဏ္ဍ',
  ],
  rule: 'အမှီခံဝါကျကဏ္ဍကို တိုက်ရိုက်အမှီပြုသော နာမ်ဝါကျကဏ္ဍ တစ်ခုတွင် နာမဝိသေသနဝါကျကဏ္ဍ၊ ကြိယာဝိသေသနဝါကျကဏ္ဍနှင့် နာမ်ဝါကျကဏ္ဍတို့ ထပ်ဆင့်ပါဝင် ဖွဲ့စည်းနေတတ်သည်။',
};
const ADVERB_CLAUSE_NESTING_GENERAL = {
  ref: '§161',
  host_type: 'ကြိယာဝိသေသနဝါကျကဏ္ဍ',
  rule: 'အမှီခံဝါကျကဏ္ဍကို တိုက်ရိုက်အမှီပြုသော ကြိယာဝိသေသနဝါကျကဏ္ဍ တစ်ခု၌ အမှီဝါကျကဏ္ဍများ ထပ်ဆင့်ပါဝင်ဖွဲ့စည်းနေတတ်သည်။',
  nesting: 'dependent_within_adverb_clause',
};
const ADVERB_CLAUSE_NESTING_SPECIFIC = {
  ref: '§162',
  host_type: 'ကြိယာဝိသေသနဝါကျကဏ္ဍ',
  host_relation: 'တိုက်ရိုက်အမှီပြု_အမှီခံဝါကျကဏ္ဍ',
  permitted_nested: [
    'နာမ်ဝါကျကဏ္ဍ',
    'နာမဝိသေသနဝါကျကဏ္ဍ',
    'ကြိယာဝိသေသနဝါကျကဏ္ဍ',
  ],
  rule: 'အမှီခံဝါကျကဏ္ဍကို တိုက်ရိုက်အမှီပြုသော ကြိယာဝိသေသနဝါကျကဏ္ဍတစ်ခုတွင် နာမ်ဝါကျကဏ္ဍ၊ နာမဝိသေသနဝါကျကဏ္ဍနှင့် ကြိယာဝိသေသနဝါကျကဏ္ဍတို့ ထပ်ဆင့်ပါဝင် ဖွဲ့စည်းနေတတ်သည်။',
};
const NESTING_MATRIX = {
  နာမ်ဝါကျကဏ္ဍ: {
    direct_to_independent: true,
    nested_permitted: [
      'နာမဝိသေသနဝါကျကဏ္ဍ',
      'ကြိယာဝိသေသနဝါကျကဏ္ဍ',
      'နာမ်ဝါကျကဏ္ဍ',
    ],
    refs: ['§160'],
  },
  နာမဝိသေသနဝါကျကဏ္ဍ: {
    direct_to_independent: false,
    nested_permitted: [],
    modifies: 'noun_within_host_clause',
    refs: ['§160', '§162'],
  },
  ကြိယာဝိသေသနဝါကျကဏ္ဍ: {
    direct_to_independent: true,
    nested_permitted: [
      'နာမ်ဝါကျကဏ္ဍ',
      'နာမဝိသေသနဝါကျကဏ္ဍ',
      'ကြိယာဝိသေသနဝါကျကဏ္ဍ',
    ],
    refs: ['§161', '§162'],
  },
};
const HOST_INDICATORS = {
  ကို: { host: 'နာမ်ဝါကျကဏ္ဍ', ref: '§160' },
  မှာ: { host: 'နာမ်ဝါကျကဏ္ဍ', ref: '§160' },
  က: { host: 'နာမ်ဝါကျကဏ္ဍ', ref: '§160' },
  သောကြောင့်: { host: 'ကြိယာဝိသေသနဝါကျကဏ္ဍ', ref: '§162' },
  သဖြင့်: { host: 'ကြိယာဝိသေသနဝါကျကဏ္ဍ', ref: '§162' },
  လျှင်: { host: 'ကြိယာဝိသေသနဝါကျကဏ္ဍ', ref: '§162' },
  မှ: { host: 'ကြိယာဝိသေသနဝါကျကဏ္ဍ', ref: '§162' },
  အောင်: { host: 'ကြိယာဝိသေသနဝါကျကဏ္ဍ', ref: '§162' },
  ရန်: { host: 'ကြိယာဝိသေသနဝါကျကဏ္ဍ', ref: '§162' },
};
const MULTIPLE_DEPENDENT_CHARACTERISTICS = {
  ref: '§163',
  name: 'အမှီဝါကျကဏ္ဍတစ်ခုမကပါဝင်သော ဝါကျရောတို့၏ အခြေခံသဘောလက္ခဏာများ',
  characteristics: [
    {
      id: '(က)',
      name: 'all_dependents_before_independent',
      rule: 'အမှီဝါကျကဏ္ဍများသည် အမှီခံဝါကျကဏ္ဍ၏ရှေ့၌ရှိသည်',
      description:
        'All dependent clauses are positioned before the independent clause.',
      position_constraint: {
        dependent: 'before_independent',
        independent: 'final',
      },
    },
    {
      id: '(ခ)',
      name: 'dependents_between_subject_verb',
      rule: 'အမှီဝါကျကဏ္ဍသည် အမှီခံဝါကျကဏ္ဍ၏ ကတ္တားနှင့်ကြိယာအကြား၌လည်း ရှိတတ်သည်',
      description:
        'Dependent clauses may also appear between the subject and verb of the independent clause.',
      position_constraint: {
        dependent: 'between_subject_verb',
        independent: 'wraps',
      },
    },
    {
      id: '(ဂ)',
      name: 'direct_and_nested_dependents_coexist',
      rule: 'အမှီဝါကျကဏ္ဍများတွင် အမှီခံဝါကျကဏ္ဍကို တိုက်ရိုက်မှီသော အမှီဝါကျကဏ္ဍများလည်းရှိသည်။ အမှီဝါကျကဏ္ဍတစ်ခုက အခြားအမှီဝါကျကဏ္ဍတစ်ခုကို ထပ်ဆင့်မှီလျက်ရှိသော အမှီဝါကျကဏ္ဍများလည်းရှိသည်။',
      description:
        'Some dependent clauses directly support the independent clause;others are nested(one dependent clause supports another dependent clause).',
      relation_types: ['direct', 'nested'],
    },
    {
      id: '(ဃ)',
      name: 'subject_omission_at_clause_level',
      rule: 'ဝါကျကဏ္ဍ၏ အဓိပ္ပာယ်ဖွင့်ဆိုချက်အရ ဝါကျကဏ္ဍတွင် ကတ္တားပုဒ်နှင့် ကြိယာပုဒ်ပါရှိသည်ဟု ဆိုသော်လည်း ရံဖန်ရံခါ၌ ကတ္တားပုဒ်ကို မြှုပ်ရေးတတ်သည်။',
      description:
        'Although a clause requires subject+verb,the subject may be omitted at the clause level.',
      omission_scope: 'clause_level',
    },
    {
      id: '(င)',
      name: 'noun_clause_nesting_permitted',
      rule: 'အမှီခံဝါကျကဏ္ဍကို တိုက်ရိုက်အမှီပြုသော နာမ်ဝါကျကဏ္ဍတစ်ခုတွင် နာမဝိသေသန ဝါကျကဏ္ဍ၊ ကြိယာဝိသေသနဝါကျကဏ္ဍနှင့် နာမ်ဝါကျကဏ္ဍတို့ ထပ်ဆင့် ပါဝင်ဖွဲ့စည်းနေတတ်သည်။',
      description:
        'A noun clause directly supporting the independent clause may contain nested adjective,adverb,and noun clauses.',
      host_type: 'နာမ်ဝါကျကဏ္ဍ',
      permitted_nested: [
        'နာမဝိသေသနဝါကျကဏ္ဍ',
        'ကြိယာဝိသေသနဝါကျကဏ္ဍ',
        'နာမ်ဝါကျကဏ္ဍ',
      ],
      cross_ref: '§160',
    },
    {
      id: '(စ)',
      name: 'adverb_clause_nesting_permitted',
      rule: 'အမှီခံဝါကျကဏ္ဍကို တိုက်ရိုက်အမှီပြုသော ကြိယာဝိသေသနဝါကျကဏ္ဍတစ်ခုတွင် နာမ်ဝါကျကဏ္ဍ၊ နာမဝိသေသနဝါကျကဏ္ဍ၊ ကြိယာဝိသေသန ဝါကျကဏ္ဍတို့ ထပ်ဆင့်ပါဝင်ဖွဲ့စည်းနေတတ်သည်။',
      description:
        'An adverb clause directly supporting the independent clause may contain nested noun,adjective,and adverb clauses.',
      host_type: 'ကြိယာဝိသေသနဝါကျကဏ္ဍ',
      permitted_nested: [
        'နာမ်ဝါကျကဏ္ဍ',
        'နာမဝိသေသနဝါကျကဏ္ဍ',
        'ကြိယာဝိသေသနဝါကျကဏ္ဍ',
      ],
      cross_ref: '§162',
    },
  ],
};
const COMPOUND_CONNECTORS = {
  wibat: {
    ref: '§189-က',
    description: 'ဝိဘတ်ဖြင့် ဝါကျရိုးနှစ်ခု ဆက်စပ်ခြင်း',
    connectors: [
      { particle: 'ကို', type: 'ကံဝိဘတ်', role: 'object_nominalizer' },
      { particle: 'မှာ', type: 'ကတ္တားဝိဘတ်', role: 'subject_nominalizer' },
      { particle: 'က', type: 'ကတ္တားဝိဘတ်', role: 'subject_nominalizer' },
    ],
  },
  pyitsi: {
    ref: '§189-ခ',
    description: 'ပစ္စည်းဖြင့် ဝါကျရိုးနှစ်ခု ဆက်စပ်ခြင်း',
    connectors: [
      { particle: 'ဟု', type: 'ပစ္စည်း', role: 'quotative' },
      { particle: 'သော', type: 'ပစ္စည်း', role: 'adjectivalizer' },
    ],
  },
  thanbanda: {
    ref: '§189-ဂ',
    description: 'သမ္ဗန္ဓဖြင့် ဝါကျရိုးနှစ်ခု ဆက်စပ်ခြင်း',
    connectors: [
      { particle: 'သောအခါ', type: 'သမ္ဗန္ဓ', role: 'temporal_when' },
      { particle: 'သောကြောင့်', type: 'သမ္ဗန္ဓ', role: 'causal_because' },
    ],
  },
};
const DEPENDENT_CONNECTORS = {
  wibat: { type: 'ဝိဘတ်', particles: {} },
  pyitsi: { type: 'ပစ္စည်း', particles: {} },
  thanbanda: { type: 'သမ္ဗန္ဓ', particles: {} },
};
const DEPENDENT_POSITIONS = {};
const WORD_ORDER_RULES = {
  subject_placement: {
    ref: '§207',
    default_position: 'start_of_sentence',
    alternative_position: 'immediately_before_verb',
    violations: [{ type: 'distant_subject' }],
  },
  adjective_placement: {
    ref: '§208',
    default_position: 'before_noun',
    markers: ['သော', 'သည့်', 'မည့်'],
    violations: [{ type: 'distant_adjective' }],
  },
  adverb_placement: {
    ref: '§209',
    default_position: 'before_verb',
    markers: ['စွာ', 'တတ်', 'တ', 'ချည်', 'ချည်ချည်'],
    violations: [{ type: 'distant_adverb' }],
  },
};
const NOUN_CLAUSE_PARTICLES = ['ကို', 'မှာ', 'က'];
const ADJECTIVE_CLAUSE_PARTICLES = ['သော', 'သည့်', 'မည့်'];
const ADVERB_CLAUSE_PARTICLES = [
  'သောအခါ',
  'သောကြောင့်',
  'သဖြင့်',
  'လျှင်',
  'မှ',
  'အောင်',
  'ရန်',
  'သလို',
  'သကဲ့သို့',
  'လျက်',
  'ကာ',
  '၍',
  'ရင်း',
];
const ADVERB_HOST_PARTICLES = [
  'သောကြောင့်',
  'သဖြင့်',
  'လျှင်',
  'မှ',
  'အောင်',
  'ရန်',
];
const SUBJECT_MARKERS = ['သည်', 'က', 'မှာ'];
const STATEMENT_PARTICLES = ['သည်', '၏', 'ပြီ'];
const PRESENT_PAST_MARKERS = ['သည်', '၏'];
const FUTURE_MARKERS = ['မည်', 'လတ္တံ့', 'အံ့'];
const IMPERATIVE_PARTICLES = ['လော့', 'စို့', 'ရအောင်', 'ပါရစေ', 'စေ'];
const EXPLICIT_IMPERATIVE_PARTICLES = [
  'လော့',
  'ပါလော့',
  'နော်',
  'ကွယ်',
  'ပါလား',
  'နှင့်ပါလား',
];
const HORTATIVE_PARTICLES = ['စို့', 'ကြစို့', 'ရအောင်'];
const NEGATIVE_EXTENSION_PARTICLES = [
  'ဘူး',
  'နဲ့',
  'နှင့်',
  'ပေါင်',
  'ဘဲကို',
  'သေး',
  'တော့',
  'လေ',
  'ကွယ်',
  'အုံး',
  'နော်',
  'ပါ',
];
const QUESTION_PARTICLES = ['လား', 'လဲ', 'နည်း', 'တုံး', 'လော'];
const QUESTION_WORDS = [
  'ဘယ်',
  'အဘယ်',
  'မည်သူ',
  'ဘယ်သူ',
  'ဘာ',
  'မည်မျှ',
  'ဘယ်လို',
  'ဘယ်လောက်',
];
const SENTENCE_FINAL_PARTICLES = [
  'သည်',
  '၏',
  'ပြီ',
  'မည်',
  'လတ္တံ့',
  'အံ့',
  'လော့',
  'စို့',
  'ရအောင်',
  'ပါရစေ',
  'စေ',
  'လား',
  'လဲ',
  'နည်း',
  'တုံး',
  'လော',
  'ပါစေ',
];
const SENTENCE_FINAL_PUNCT = ['။', '.', '?', '!', '\n'];
const ALL_SENTENCE_PARTICLES = [
  'သည်',
  '၏',
  'ပြီ',
  'မည်',
  'လတ္တံ့',
  'အံ့',
  'လော့',
  'စို့',
  'ရအောင်',
  'ပါရစေ',
  'စေ',
  'လား',
  'လဲ',
  'နည်း',
  'တုံး',
  'လော',
  'ပါစေ',
  'ဘူး',
  'နဲ့',
  'နှင့်',
];
const ALL_CONNECTORS = [
  'ကို',
  'မှာ',
  'က',
  'ဟု',
  'သော',
  'သောအခါ',
  'သောကြောင့်',
  'သဖြင့်',
  'လျှင်',
  'မှ',
  'အောင်',
  'ရန်',
  'သလို',
  'သကဲ့သို့',
  'လျက်',
  'ကာ',
  '၍',
  'ရင်း',
  'သော်လည်း',
  'စေကာမူ',
  'နှင့်တစ်ပြိုင်နက်',
  'ဖြစ်စေ',
  'လျှင်သော်လည်းကောင်း',
  'သလောက်',
  'ကာမျှဖြင့်',
  'ကား',
  'ဟူ၍',
];
const ALL_DEPENDENT_PARTICLES = [
  'ကို',
  'မှာ',
  'က',
  'သော',
  'သည့်',
  'မည့်',
  'သောအခါ',
  'သောကြောင့်',
  'သဖြင့်',
  'လျှင်',
  'မှ',
  'အောင်',
  'ရန်',
  'သလို',
  'သကဲ့သို့',
  'လျက်',
  'ကာ',
  '၍',
  'ရင်း',
  'သော်လည်း',
  'စေကာမူ',
  'နှင့်တစ်ပြိုင်နက်',
  'ဖြစ်စေ',
  'လျှင်သော်လည်းကောင်း',
  'သလောက်',
  'ကာမျှဖြင့်',
  'ကား',
  'ဟု',
  'ဟူ၍',
];
const ALL_INDEPENDENT_PARTICLES = [
  'သည်',
  '၏',
  'ပြီ',
  'မည်',
  'လတ္တံ့',
  'အံ့',
  'လော့',
  'စို့',
  'ရအောင်',
  'ပါရစေ',
  'စေ',
  'လား',
  'လဲ',
  'နည်း',
  'တုံး',
  'လော',
  'ပါစေ',
];
const ALL_CLAUSE_BOUNDARY_MARKERS = [
  'ကို',
  'မှာ',
  'က',
  'သော',
  'သည့်',
  'မည့်',
  'သောအခါ',
  'သောကြောင့်',
  'သဖြင့်',
  'လျှင်',
  'မှ',
  'အောင်',
  'ရန်',
  'သလို',
  'သကဲ့သို့',
  'လျက်',
  'ကာ',
  '၍',
  'ရင်း',
  'သည်',
  '၏',
  'ပြီ',
  'မည်',
  'လတ္တံ့',
  'အံ့',
  'လော့',
  'စို့',
  'ရအောင်',
  'ပါရစေ',
  'စေ',
  'လား',
  'လဲ',
  'နည်း',
  'တုံး',
  'လော',
  'ပါစေ',
];
const WIBAT_CONNECTORS = ['ကို', 'မှာ', 'က'];
const PYITSI_CONNECTORS = ['ဟု', 'သော'];
const THANBANDA_CONNECTORS = [
  'သောအခါ',
  'သောကြောင့်',
  'သဖြင့်',
  'လျှင်',
  'မှ',
  'အောင်',
  'ရန်',
  'သလို',
  'သကဲ့သို့',
  'လျက်',
  'ကာ',
  '၍',
  'ရင်း',
  'သော်လည်း',
  'စေကာမူ',
  'နှင့်တစ်ပြိုင်နက်',
  'ဖြစ်စေ',
  'လျှင်သော်လည်းကောင်း',
  'သလောက်',
  'ကာမျှဖြင့်',
];
const THANBANDA_CONNECTOR_MAP = {
  သော်လည်း: { type: 'ဆန့်ကျင်ပြ', id: 1, ref: '§122(က)' },
  စေကာမူ: { type: 'ဆန့်ကျင်ပြ', id: 1, ref: '§122(က)' },
  သောအခါ: { type: 'အချိန်ပြ', id: 2, ref: '§122(ခ)' },
  နှင့်တစ်ပြိုင်နက်: { type: 'အချိန်ပြ', id: 2, ref: '§122(ခ)' },
  အောင်: { type: 'အကျိုးမျှော်ပြ', id: 3, ref: '§122(ဂ)' },
  ရန်: { type: 'အကျိုးမျှော်ပြ', id: 3, ref: '§122(ဂ)' },
  သောကြောင့်: { type: 'အကြောင်းပြ', id: 4, ref: '§122(ဃ)' },
  သဖြင့်: { type: 'အကြောင်းပြ', id: 4, ref: '§122(ဃ)' },
  သကဲ့သို့: { type: 'နှိုင်းယှဉ်ပြ', id: 5, ref: '§122(င)' },
  သလို: { type: 'နှိုင်းယှဉ်ပြ', id: 5, ref: '§122(င)' },
  လျှင်: { type: 'ကန့်သတ်ချက်ပြ', id: 6, ref: '§122(စ)' },
  မှ: { type: 'ကန့်သတ်ချက်ပြ', id: 6, ref: '§122(စ)' },
  ဖြစ်စေ: { type: 'ကန့်သတ်မဲ့ပြ', id: 7, ref: '§122(ဆ)' },
  လျှင်သော်လည်းကောင်း: { type: 'ကန့်သတ်မဲ့ပြ', id: 7, ref: '§122(ဆ)' },
  သလောက်: { type: 'ပမာဏပြ', id: 8, ref: '§122(ဇ)' },
  ကာမျှဖြင့်: { type: 'ပမာဏပြ', id: 8, ref: '§122(ဇ)' },
  လျက်: { type: 'အမူအရာပြ', id: 9, ref: '§122(ဈ)' },
  ကာ: { type: 'အမူအရာပြ', id: 9, ref: '§122(ဈ)' },
  '၍': { type: 'အမူအရာပြ', id: 9, ref: '§122(ဈ)' },
  ရင်း: { type: 'အမူအရာပြ', id: 9, ref: '§122(ဈ)' },
};
const WIBAT_TYPE_MAP = {
  သည်: { type: 'ကတ္တားဝိဘတ်', function: 'subject_marker' },
  က: { type: 'ကတ္တားဝိဘတ်', function: 'subject_marker' },
  မှာ: { type: 'ကတ္တားဝိဘတ်', function: 'subject_marker' },
  ကို: { type: 'ကံဝိဘတ်', function: 'object_marker' },
  မှ: { type: 'ထွက်ခွာရာပြဝိဘတ်', function: 'ablative' },
  သို့: { type: 'ရှေးရှုရာပြဝိဘတ်', function: 'directional' },
  '၌': { type: 'နေရာပြဝိဘတ်', function: 'locative' },
  တွင်: { type: 'နေရာပြဝိဘတ်', function: 'locative' },
  '၏': { type: 'ပိုင်ဆိုင်ခြင်းပြဝိဘတ်', function: 'possessive' },
  မည်: { type: 'ကာလပြကြိယာဝိဘတ်', function: 'future_tense' },
  လတ္တံ့: { type: 'ကာလပြကြိယာဝိဘတ်', function: 'future_tense' },
  အံ့: { type: 'ကာလပြကြိယာဝိဘတ်', function: 'future_tense' },
};
const OMISSION_TRIGGER_CONNECTORS = [
  'ကို',
  'မှာ',
  'က',
  'ဟု',
  'သော',
  'သောအခါ',
  'သောကြောင့်',
  'သဖြင့်',
  'လျှင်',
  'မှ',
  'အောင်',
  'ရန်',
];
const CONJUNCTION_PHRASE_MARKERS = [
  'နှင့်',
  'သို့မဟုတ်',
  'လည်းကောင်း',
  'ဖြစ်စေ',
  'မှတစ်ပါး',
  'ထို့ပြင်',
];
const PHRASE_MARKERS = [
  '၏',
  'ကို',
  'မှ',
  'သို့',
  '၌',
  'တွင်',
  'ဝယ်',
  'ဝက',
  'အား',
  'အတွက်',
  'အရ',
  'အတိုင်း',
  'အလိုက်',
  'အလျောက်',
];
const POSTPOSITION_MARKERS = [
  '၌',
  'တွင်',
  'မှ',
  'သို့',
  'ထိ',
  'အောင်',
  'ဖြင့်',
  'အထိ',
  'ထိအောင်',
  'တိုင်အောင်',
];
const PARTICLE_SUFFIXES = [
  'သည်',
  'က',
  'မှာ',
  'ကို',
  'မှ',
  'သို့',
  '၌',
  'တွင်',
  '၏',
  'မည်',
  'လတ္တံ့',
  'အံ့',
  'ပြီ',
  'လော့',
  'စို့',
  'ရအောင်',
  'ပါရစေ',
  'ပါစေ',
  'စေ',
];
const COMPOUND_PATTERNS = new Set([
  'ရေအိုး',
  'တောင်ကလပ်',
  'လက်စွပ်',
  'ခေါင်းပေါင်း',
  'လက်ပတ်နာရီ',
  'ရေကူးကန်',
  'စာတတ်ပေတတ်',
  'ရုပ်မြင်သံကြား',
  'လူငယ်',
  'မြေဖြူ',
  'ထမ်းပိုး',
  'အုပ်ဆောင်း',
  'လွယ်အိတ်',
  'ဆွဲကြိုး',
  'နေ့စဉ်မှတ်တမ်း',
  'တစ်ဆင့်စကား',
]);
export {
  SENTENCE_PATTERNS,
  PARTICLE_ROLE_MAP,
  EXTENDED_PATTERNS,
  SENTENCE_TYPES,
  SENTENCE_MEANING_TYPES,
  SENTENCE_CONSTRUCTION_TYPES,
  WORD_TYPES,
  WIBAT_TYPES,
  PHRASE_TYPES,
  ANALYSIS_STEPS,
  BASIC_PATTERN,
  VERB_INFLECTION,
  STATEMENT_MARKERS,
  BARE_IMPERATIVE,
  EXPLICIT_IMPERATIVE,
  HORTATIVE,
  OPTATIVE,
  REQUEST,
  DECREE,
  SENTENCE_TYPE_SUMMARY,
  PARTICLE_COMBINATIONS,
  NEGATION,
  NEGATIVE_COMBINATIONS,
  INTERROGATIVE,
  INTERROGATIVE_OMITTED,
  INTERROGATIVE_INTERCHANGE,
  INTERROGATIVE_LA_LAW,
  CLAUSE_DEFINITION,
  DEPENDENT_CLAUSE_DEF,
  INDEPENDENT_CLAUSE_DEF,
  INDEPENDENT_ENDINGS,
  CLAUSE_ROLES,
  CROSS_REFERENCE,
  COMPOUND_OMISSION_RULES,
  CLAUSE_BOUNDARY_MARKERS,
  SINGLE_DEPENDENT_STRUCTURE,
  CONNECTOR_BOUNDARY_RULE,
  SPLIT_PROCEDURE,
  CLAUSE_SUBJECT_OMISSION,
  DEPENDENT_CLAUSE_TYPES,
  DEPENDENT_CLAUSE_SUBTYPES,
  DEPENDENT_TYPE_MAP,
  NOUN_CLAUSE_RULE,
  NOUN_CLAUSE_DUTY,
  ADJECTIVE_CLAUSE_RULE,
  ADVERB_CLAUSE_TYPES,
  ADVERB_CLAUSE_DUTY,
  ADVERB_PARTICLE_MAP,
  SINGLE_DEPENDENT_CHARACTERISTICS,
  CONNECTOR_CLAUSE_TYPE_MAP,
  MULTIPLE_VERB_STRUCTURE,
  MULTIPLE_CONNECTOR_BOUNDARY,
  NESTED_CLAUSE_RULE,
  DIRECT_DEPENDENT_NESTING,
  NOUN_CLAUSE_NESTING,
  ADVERB_CLAUSE_NESTING_GENERAL,
  ADVERB_CLAUSE_NESTING_SPECIFIC,
  NESTING_MATRIX,
  HOST_INDICATORS,
  MULTIPLE_DEPENDENT_CHARACTERISTICS,
  COMPOUND_CONNECTORS,
  DEPENDENT_CONNECTORS,
  DEPENDENT_POSITIONS,
  WORD_ORDER_RULES,
  NOUN_CLAUSE_PARTICLES,
  ADJECTIVE_CLAUSE_PARTICLES,
  ADVERB_CLAUSE_PARTICLES,
  ADVERB_HOST_PARTICLES,
  SUBJECT_MARKERS,
  STATEMENT_PARTICLES,
  PRESENT_PAST_MARKERS,
  FUTURE_MARKERS,
  IMPERATIVE_PARTICLES,
  EXPLICIT_IMPERATIVE_PARTICLES,
  HORTATIVE_PARTICLES,
  NEGATIVE_EXTENSION_PARTICLES,
  QUESTION_PARTICLES,
  QUESTION_WORDS,
  SENTENCE_FINAL_PARTICLES,
  SENTENCE_FINAL_PUNCT,
  ALL_SENTENCE_PARTICLES,
  ALL_CONNECTORS,
  ALL_DEPENDENT_PARTICLES,
  ALL_INDEPENDENT_PARTICLES,
  ALL_CLAUSE_BOUNDARY_MARKERS,
  WIBAT_CONNECTORS,
  PYITSI_CONNECTORS,
  THANBANDA_CONNECTORS,
  THANBANDA_CONNECTOR_MAP,
  WIBAT_TYPE_MAP,
  OMISSION_TRIGGER_CONNECTORS,
  CONJUNCTION_PHRASE_MARKERS,
  PHRASE_MARKERS,
  POSTPOSITION_MARKERS,
  PARTICLE_SUFFIXES,
  COMPOUND_PATTERNS,
};
