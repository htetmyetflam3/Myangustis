/* --- ruleEngine/baseline.js ---
 * Constraint validator for ALL 22 sections.
 * Every rule has a unique ID: baseline.js-{section}-{letter}
 */

import { lookupId } from '../../MonoSyllabism/map/base/idmapper.js';

const ID_TO_WORD = new Map();
if (typeof lookupId === 'object' && lookupId !== null) {
  for (const [word, id] of Object.entries(lookupId)) {
    ID_TO_WORD.set(id, word);
  }
}

function word(token) {
  const ids = token?.joinedIds ?? token?.ids?.join('') ?? '';
  return ID_TO_WORD.get(ids) ?? ids;
}

function mayBe(token, pos) {
  if (!token) return false;
  if (token.finalPos) return token.finalPos === pos;
  return token.rawPos?.includes(pos) ?? false;
}

// ═══════════════════════════════════════════════════════════════
//  SECTIONS 1–4: COMPOUND WORD SEQUENCES
// ═══════════════════════════════════════════════════════════════

const COMPOUND_SEQUENCES = [
  // Section 1: Compound Noun
  { id: '1-a',  seq: ['n','n'],             result: 'compound_noun' },
  { id: '1-b',  seq: ['n','n','n'],         result: 'compound_noun' },
  { id: '1-c',  seq: ['n','v'],             result: 'compound_noun' },
  { id: '1-d',  seq: ['v','v'],             result: 'compound_noun' },
  { id: '1-e',  seq: ['v','v','n'],         result: 'compound_noun' },
  { id: '1-f',  seq: ['v','v','v','v'],     result: 'compound_noun' },
  { id: '1-g',  seq: ['n','v','dj'],        result: 'compound_noun' },
  { id: '1-h',  seq: ['n','dj','v'],        result: 'compound_noun' },
  { id: '1-i',  seq: ['n','n','v'],         result: 'compound_noun' },
  { id: '1-j',  seq: ['n','n','dj'],        result: 'compound_noun' },
  { id: '1-k',  seq: ['n','dj','n'],        result: 'compound_noun' },
  { id: '1-l',  seq: ['n','v','n','v'],     result: 'compound_noun' },
  { id: '1-m',  seq: ['n','dj','v','n'],    result: 'compound_noun' },
  { id: '1-n',  seq: ['n','v','n','n'],     result: 'compound_noun' },
  { id: '1-o',  seq: ['n','v','v','v','n'], result: 'compound_noun' },

  // Section 2: Compound Verb
  { id: '2-a',  seq: ['v','v'],             result: 'compound_verb' },
  { id: '2-b',  seq: ['v','v','v'],         result: 'compound_verb' },
  { id: '2-c',  seq: ['v','v','v','v'],     result: 'compound_verb' },
  { id: '2-d',  seq: ['n','v'],             result: 'compound_verb' },
  { id: '2-e',  seq: ['n','dj','v'],        result: 'compound_verb' },
  { id: '2-f',  seq: ['dj','n','v'],        result: 'compound_verb' },
  { id: '2-g',  seq: ['n','v','v'],         result: 'compound_verb' },
  { id: '2-h',  seq: ['v','n','v'],         result: 'compound_verb' },
  { id: '2-i',  seq: ['n','n','v','v'],     result: 'compound_verb' },
  { id: '2-j',  seq: ['n','v','n','v'],     result: 'compound_verb' },

  // Section 3: Compound Adj
  { id: '3-a',  seq: ['dj','dj'],           result: 'compound_adj' },
  { id: '3-b',  seq: ['dj','dj','dj'],      result: 'compound_adj' },
  { id: '3-c',  seq: ['dj','dj','dj','dj'], result: 'compound_adj' },
  { id: '3-d',  seq: ['n','dj'],            result: 'compound_adj' },

  // Section 4: Compound Adv
  { id: '4-a',  seq: ['v','v'],             result: 'compound_adv' },
  { id: '4-b',  seq: ['v','v','v','v'],     result: 'compound_adv' },
  { id: '4-c',  seq: ['dj','dj'],           result: 'compound_adv' },
  { id: '4-d',  seq: ['dj','dj','dj'],      result: 'compound_adv' },
  { id: '4-e',  seq: ['dj','dj','dj','dj'], result: 'compound_adv' },
  { id: '4-f',  seq: ['n','dj','dv'],       result: 'compound_adv' },
  { id: '4-g',  seq: ['n','n','v'],         result: 'compound_adv' },
  { id: '4-h',  seq: ['n','v','n','v'],     result: 'compound_adv' },
  { id: '4-i',  seq: ['n','n','n','v'],     result: 'compound_adv' },
];

// ═══════════════════════════════════════════════════════════════
//  SECTIONS 5–7, 13–16: PREFIX / PACCAYA / SUFFIX
// ═══════════════════════════════════════════════════════════════

const PREFIX_WORDS      = new Set(['အ','တ','မ','က','ပ']);
const VERB_PACCAYA      = new Set(['စား','လုပ်','သွား','ပြော','လွန်','ပိုင်','လွဲ','ခြား','ပြတ်']);
const ADJ_NOUN_SUFFIX   = new Set(['ခြင်း','မှု','ရေး','စရာ','ချက်']);
const VERB_GUNA_PREFIX  = new Set(['အ','ခြင်း','မှု','ရေး','ဖွယ်','စရာ','ချက်']);

// ═══════════════════════════════════════════════════════════════
//  SECTIONS 8–12, 17–19: TWO-TONE / SAME-VERB / SAME-ADJ
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
//  SECTIONS 20–22: ROLE MARKERS
// ═══════════════════════════════════════════════════════════════

const NOUN_ROLE_PARTICLES     = new Set(['သည်','က','ကို','အား','မှာ','တွင်','ဝယ်','၏','နှင့်အတူ','တိုင်း']);
const PRONOUN_ROLE_PARTICLES  = new Set(['သည်','က','ကို','၏']);
const VERB_ROLE_PARTICLES     = new Set(['သည်','၏','မည်','လော့','ပါစေ','ပါရစေ','စေ']);

// ═══════════════════════════════════════════════════════════════
//  CORE: getViablePos — returns { viable: Set, refs: string[] }
// ═══════════════════════════════════════════════════════════════

export function getViablePos(token, context, index) {
  // eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
  const { resolvedTokens } = context;
  const viable = new Set();
  const refs = [];

  for (const candidate of token.rawPos) {
    // ── Sections 1–4: Compound sequences ──
    const compound = checkCompound(token, context, index, candidate);
    if (compound.viable) {
      viable.add(candidate);
      refs.push(...compound.refs);
      continue;
    }

    // ── Sections 5–7, 13–16: Prefix/paccaya/suffix ──
    const affix = checkAffix(token, context, index, candidate);
    if (affix.viable) {
      viable.add(candidate);
      refs.push(...affix.refs);
      continue;
    }

    // ── Sections 8–12, 17–19: Two-tone patterns ──
    const twoTone = checkTwoTone(token, context, index, candidate);
    if (twoTone.viable) {
      viable.add(candidate);
      refs.push(...twoTone.refs);
      continue;
    }

    // ── Sections 20–22: Role markers ──
    const role = checkRoleMarker(token, context, index, candidate);
    if (role.viable) {
      viable.add(candidate);
      refs.push(...role.refs);
      continue;
    }
  }

  return { viable, refs };
}

// ═══════════════════════════════════════════════════════════════
//  SECTIONS 1–4 IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════

function checkCompound(token, context, index, candidate) {
  const { resolvedTokens } = context;
  const refs = [];

  for (const { id, seq } of COMPOUND_SEQUENCES) {
    for (let offset = 0; offset < seq.length; offset++) {
      const start = index - offset;
      if (start < 0) continue;
      if (seq[offset] !== candidate) continue;
      if (start + seq.length > resolvedTokens.length) continue;

      let match = true;
      for (let i = 0; i < seq.length; i++) {
        const t = resolvedTokens[start + i];
        if (!t) { match = false; break; }

        if (i === offset && start === index) continue;

        if (t.finalPos) {
          if (t.finalPos !== seq[i]) { match = false; break; }
        } else {
          if (!t.rawPos?.includes(seq[i])) { match = false; break; }
        }
      }
      if (match) refs.push(id);
    }
  }

  return { viable: refs.length > 0, refs };
}

// ═══════════════════════════════════════════════════════════════
//  SECTIONS 5–7, 13–16 IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════

function checkAffix(token, context, index, candidate) {
  const { resolvedTokens } = context;
  const prev = index > 0 ? resolvedTokens[index - 1] : null;
  // eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
  const next = resolvedTokens[index + 1];
  const w = word(token);
  const refs = [];

  // 5-a: prefix + verb → noun|adv
  if (candidate === 'v' && prev && PREFIX_WORDS.has(word(prev))) {
    refs.push('5-a');
  }

  // 6-a: verb + paccaya → noun|adv
  if (VERB_PACCAYA.has(w) && prev && mayBe(prev, 'v')) {
    if (candidate === 'n') refs.push('6-a');
    if (candidate === 'dv') refs.push('6-a');
  }

  // 7-a: verb + စွာ → adv
  if (w === 'စွာ' && prev && mayBe(prev, 'v')) {
    if (candidate === 'dv') refs.push('7-a');
  }

  // 13-a: verb + prefix → ဂုဏ်ရည်|adv
  if (VERB_GUNA_PREFIX.has(w) && prev && mayBe(prev, 'v')) {
    if (candidate === 'n') refs.push('13-a');
    if (candidate === 'dv') refs.push('13-a');
  }

  // 14-a: prefix + adj → ဂုဏ်ရည်|adv
  if (candidate === 'dj' && prev && PREFIX_WORDS.has(word(prev))) {
    refs.push('14-a');
  }

  // 15-a: adj + suffix → ဂုဏ်ရည်
  if (ADJ_NOUN_SUFFIX.has(w) && prev && mayBe(prev, 'dj')) {
    if (candidate === 'n') refs.push('15-a');
  }

  // 16-a: adj + စွာ → adv
  if (w === 'စွာ' && prev && mayBe(prev, 'dj')) {
    if (candidate === 'dv') refs.push('16-a');
  }

  return { viable: refs.length > 0, refs };
}

// ═══════════════════════════════════════════════════════════════
//  SECTIONS 8–12, 17–19 IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════

function checkTwoTone(token, context, index, candidate) {
  const { resolvedTokens } = context;
  const t0 = resolvedTokens[index];
  const t1 = resolvedTokens[index + 1];
  const t2 = resolvedTokens[index + 2];
  const t3 = resolvedTokens[index + 3];
  if (!t0) return { viable: false, refs: [] };

  const w0 = word(t0);
  const w1 = t1 ? word(t1) : '';
  const w2 = t2 ? word(t2) : '';
  // eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
  const w3 = t3 ? word(t3) : '';
  const refs = [];

  // 8-a: verb + တ + verb → adv
  if (candidate === 'v' && mayBe(t0, 'v') && w1 === 'တ' && mayBe(t2, 'v')) {
    refs.push('8-a');
  }

  // 9-a: prefix + verb + prefix + verb → adv
  if (candidate === 'v' && PREFIX_WORDS.has(w0) && mayBe(t1, 'v') &&
      PREFIX_WORDS.has(w2) && mayBe(t3, 'v')) {
    refs.push('9-a');
  }

  // 10-a: အ + verb + အ + verb → adv
  if (candidate === 'v' && w0 === 'အ' && mayBe(t1, 'v') && w2 === 'အ' && mayBe(t3, 'v')) {
    refs.push('10-a');
  }

  // 11-a: prefix + verb₁ + suffix + verb₂ → adv
  if (candidate === 'v' && PREFIX_WORDS.has(w0) && mayBe(t1, 'v') &&
      PREFIX_WORDS.has(w2) && mayBe(t3, 'v')) {
    refs.push('11-a');
  }

  // 12-a: မ + verb + တ + verb → adv
  if (candidate === 'v' && w0 === 'မ' && mayBe(t1, 'v') && w2 === 'တ' && mayBe(t3, 'v')) {
    refs.push('12-a');
  }

  // 17-a: prefix + adj + prefix + adj → adv
  if (candidate === 'dj' && PREFIX_WORDS.has(w0) && mayBe(t1, 'dj') &&
      PREFIX_WORDS.has(w2) && mayBe(t3, 'dj')) {
    refs.push('17-a');
  }

  // 18-a: မ + adj + မ + adj → adv
  if (candidate === 'dj' && w0 === 'မ' && mayBe(t1, 'dj') && w2 === 'မ' && mayBe(t3, 'dj')) {
    refs.push('18-a');
  }

  // 19-a: မ + adj + တ + adj → adv
  if (candidate === 'dj' && w0 === 'မ' && mayBe(t1, 'dj') && w2 === 'တ' && mayBe(t3, 'dj')) {
    refs.push('19-a');
  }

  return { viable: refs.length > 0, refs };
}

// ═══════════════════════════════════════════════════════════════
//  SECTIONS 20–22 IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════

function checkRoleMarker(token, context, index, candidate) {
  const { resolvedTokens } = context;
  const next = resolvedTokens[index + 1];
  if (!next) return { viable: false, refs: [] };

  const w = word(next);
  const refs = [];

  // Section 20: noun + role marker
  if (candidate === 'n' && NOUN_ROLE_PARTICLES.has(w)) {
    const map = {
      'သည်':'20-a', 'က':'20-b', 'ကို':'20-c', 'အား':'20-d',
      'မှာ':'20-e', 'တွင်':'20-f', 'ဝယ်':'20-g', '၏':'20-h',
      'နှင့်အတူ':'20-i', 'တိုင်း':'20-j',
    };
    if (map[w]) refs.push(map[w]);
  }

  // Section 21: pronoun + role marker
  if (candidate === 'pn' && PRONOUN_ROLE_PARTICLES.has(w)) {
    const map = { 'သည်':'21-a', 'က':'21-b', 'ကို':'21-c', '၏':'21-d' };
    if (map[w]) refs.push(map[w]);
  }

  // Section 22: verb + role marker
  if (candidate === 'v' && VERB_ROLE_PARTICLES.has(w)) {
    const map = {
      'သည်':'22-a', '၏':'22-b', 'မည်':'22-c', 'လော့':'22-d',
      'ပါစေ':'22-e', 'ပါရစေ':'22-f', 'စေ':'22-g',
    };
    if (map[w]) refs.push(map[w]);
  }

  return { viable: refs.length > 0, refs };
}

// ═══════════════════════════════════════════════════════════════
//  EXPORT: getCompoundRefs for x-n.js compound cross-reference
// ═══════════════════════════════════════════════════════════════

export function getCompoundRefs(token, context, index, candidatePos) {
  const result = checkCompound(token, context, index, candidatePos);
  return result.refs;
}
