
// eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
import fs from "fs";

/*
 * Myanmar Grammar Resolver — Contextual Disambiguation Edition (ESM)
 * =========================================================================
 * Built from JSON rulebook (wibat, thanbanda, paccaya).
 *
 * Key principle: For ambiguous particles (disambiguate lists), look at the
 * HOST WORD (noun vs verb classification) to determine correct particle type.
 *
 * Levels:
 * 1. wibat.disambiguate (သည်, ၏) → classify host as noun/verb
 * 2. wibat.noun.disambiguate (က, မှာ, သို့, etc.) → nested context
 * 3. Unambiguous noun/verb particles → direct lookup
 * 4. thanbanda, paccaya → contextual lookup
 *
 * Status: WORKING — contextual disambiguation functional.
 * Needs: better compound word splitting, richer lexicon, clause-level host classification.
 */

import GRAMMAR_JSON from '../library/knowledge.json' with { type: 'json' };



/*
 * Resolves Myanmar grammar using JSON rulebook with contextual disambiguation.
 * For ambiguous particles, looks at HOST WORD (noun vs verb) to determine type.
 */
export class MyanmarGrammarResolver {
  constructor(grammarJson = null, options = {}) {
    this.g = grammarJson || GRAMMAR_JSON;
    this.classifiers = {
      isNoun: options.isNoun || null,
      isVerb: options.isVerb || null,
    };
    this._buildIndexes();
  }


  _buildIndexes() {
    this.nounParticleMap = {};
    for (const [ptype, particles] of Object.entries(this.g.wibat.noun)) {
      if (ptype === 'disambiguate') continue;
      for (const p of particles) {
        if (!this.nounParticleMap[p]) this.nounParticleMap[p] = [];
        this.nounParticleMap[p].push(ptype);
      }
    }

    this.verbParticleMap = {};
    for (const [ptype, particles] of Object.entries(this.g.wibat.verb)) {
      for (const p of particles) {
        if (!this.verbParticleMap[p]) this.verbParticleMap[p] = [];
        this.verbParticleMap[p].push(ptype);
      }
    }

    this.wibatDisambiguate = new Set(this.g.wibat.disambiguate || []);
    this.nounDisambiguate = new Set(this.g.wibat.noun.disambiguate || []);

    this.thanbandaClause = {};
    for (const [ptype, particles] of Object.entries(this.g.thanbanda.clause)) {
      if (ptype === 'disambiguate') continue;
      for (const p of particles) {
        this.thanbandaClause[p] = ptype;
      }
    }

    this.thanbandaSentence = {};
    for (const [ptype, particles] of Object.entries(this.g.thanbanda.sentence)) {
      if (ptype === 'disambiguate') continue;
      for (const p of particles) {
        this.thanbandaSentence[p] = ptype;
      }
    }

    this.paccayaNoun = {};
    for (const [ptype, particles] of Object.entries(this.g.paccaya.noun)) {
      if (ptype === 'disambiguate') continue;
      for (const p of particles) {
        this.paccayaNoun[p] = ptype;
      }
    }

    this.paccayaVerb = {};
    for (const [ptype, particles] of Object.entries(this.g.paccaya.verb)) {
      if (ptype === 'disambiguate') continue;
      for (const p of particles) {
        this.paccayaVerb[p] = ptype;
      }
    }

    this.wordChangerMap = {};
    for (const [ptype, data] of Object.entries(this.g.paccaya.word_changer)) {
      if (ptype === 'disambiguate') continue;
      if (typeof data === 'object' && !Array.isArray(data)) {
        for (const [subptype, particles] of Object.entries(data)) {
          for (const p of particles) {
            this.wordChangerMap[p] = [ptype, subptype];
          }
        }
      } else {
        for (const p of data) {
          this.wordChangerMap[p] = [ptype, null];
        }
      }
    }
  }

  classifyHost(baseWord, position, totalTokens, token = null) {
    /** Classify host word as noun or verb using injected classifiers + heuristics */
    const base = baseWord.trim();
    // eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
    const ctx = { base, position, totalTokens, token };

    if (this.classifiers.isNoun) {
      if (this.classifiers.isNoun(base, position, totalTokens, token)) return 'noun';
    }
    if (this.classifiers.isVerb) {
      if (this.classifiers.isVerb(base, position, totalTokens, token)) return 'verb';
    }

    // Fallback heuristics when no classifiers are injected
    if (position === 0 && totalTokens > 1) return 'noun';
    if (position === totalTokens - 1) return 'verb';
    if (position < totalTokens / 2) return 'noun';
    return 'verb';
  }

  resolveParticles(baseWord, particles, position, totalTokens) {
    /** Resolve particles with contextual disambiguation. */
    const hostType = this.classifyHost(baseWord, position, totalTokens);
    const resolved = [];

    for (const particle of particles) {
      const entry = {
        particle,
        host: baseWord,
        host_type: hostType,
        categories: []
      };

      // LEVEL 1: wibat.disambiguate (သည်, ၏)
      if (this.wibatDisambiguate.has(particle)) {
        if (hostType === 'noun') {
          entry.categories.push({
            level: 'wibat.disambiguate',
            resolution: 'host_is_noun',
            type: 'ကတ္တားဝိဘတ်',
            rule: '"${particle}" after noun = ကတ္တားဝိဘတ်' 
          });
        } else if (hostType === 'verb') {
          entry.categories.push({
            level: 'wibat.disambiguate',
            resolution: 'host_is_verb',
            type: 'ပစ္စုပ္ပန်ကာလပြကြိယာဝိဘတ်',
            rule: '"${particle}" after verb = ပစ္စုပ္ပန်ကာလပြကြိယာဝိဘတ်'
          });
        } else {
          entry.categories.push({
            level: 'wibat.disambiguate',
            resolution: 'unknown_host',
            possible: ['ကတ္တားဝိဘတ်', 'ပစ္စုပ္ပန်ကာလပြကြိယာဝိဘတ်'],
            rule: 'Need host classification to disambiguate'
          });
        }
        resolved.push(entry);
        continue;
      }

      // LEVEL 2: wibat.noun.disambiguate (က, မှာ, သို့, etc.)
      if (this.nounDisambiguate.has(particle)) {
        if (particle === 'က') {
          entry.categories.push({
            level: 'wibat.noun.disambiguate',
            possible_types: ['ကတ္တားဝိဘတ်', 'ကံဝိဘတ်'],
            resolution_strategy: 'Check clause role: subject→ကတ္တား, object→ကံ'
          });
        } else if (particle === 'မှာ') {
          entry.categories.push({
            level: 'wibat.noun.disambiguate',
            possible_types: ['ကတ္တားဝိဘတ်', 'နေရာပြဝိဘတ်'],
            resolution_strategy: 'Check semantics: topic→ကတ္တား, location→နေရာ'
          });
        } else if (particle === 'သို့') {
          entry.categories.push({
            level: 'wibat.noun.disambiguate',
            possible_types: ['ရှေးရှုရာပြဝိဘတ်', 'နေရာပြဝိဘတ်'],
            resolution_strategy: 'Check verb: motion verb→ရှေးရှု, static→နေရာ'
          });
        } else if (['၌', 'တွင်', 'ဝယ်'].includes(particle)) {
          entry.categories.push({
            level: 'wibat.noun.disambiguate',
            possible_types: ['နေရာပြဝိဘတ်', 'အချိန်ပြဝိဘတ်'],
            resolution_strategy: 'Check semantics: place→နေရာ, time→အချိန်'
          });
        } else if (particle === 'ဖြင့်') {
          entry.categories.push({
            level: 'wibat.noun.disambiguate',
            type: 'အသုံးခံပြဝိဘတ်',
            resolution: 'instrumental - usually unambiguous'
          });
        } else if (particle === 'နှင့်') {
          entry.categories.push({
            level: 'wibat.noun.disambiguate',
            possible_types: ['ယှဉ်တွဲပြဝိဘတ်'],
            resolution_strategy: 'Check semantics: accompaniment→ယှဉ်တွဲ'
          });
        } else if (['တိုင်တိုင်', 'တိုင်အောင်'].includes(particle)) {
          entry.categories.push({
            level: 'wibat.noun.disambiguate',
            type: 'နေရာဆက်တိုက်ပြဝိဘတ် / အချိန်ဆက်တိုက်ပြဝိဘတ်',
            resolution_strategy: 'Check host semantics for place vs time'
          });
        } else {
          entry.categories.push({
            level: 'wibat.noun.disambiguate',
            note: `${particle} needs context resolution`
          });
        }
        resolved.push(entry);
        continue;
      }

      // LEVEL 3: Unambiguous noun particles
      if (this.nounParticleMap[particle]) {
        for (const ptype of this.nounParticleMap[particle]) {
          entry.categories.push({ level: 'wibat.noun', type: ptype });
        }
        resolved.push(entry);
        continue;
      }

      // LEVEL 4: Unambiguous verb particles
      if (this.verbParticleMap[particle]) {
        for (const ptype of this.verbParticleMap[particle]) {
          entry.categories.push({ level: 'wibat.verb', type: ptype });
        }
        resolved.push(entry);
        continue;
      }

      // LEVEL 5: Thanbanda
      if (this.thanbandaClause[particle]) {
        entry.categories.push({ level: 'thanbanda.clause', type: this.thanbandaClause[particle] });
        resolved.push(entry);
        continue;
      }
      if (this.thanbandaSentence[particle]) {
        entry.categories.push({ level: 'thanbanda.sentence', type: this.thanbandaSentence[particle] });
        resolved.push(entry);
        continue;
      }

      // LEVEL 6: Paccaya
      if (this.paccayaNoun[particle]) {
        entry.categories.push({ level: 'paccaya.noun', type: this.paccayaNoun[particle] });
        resolved.push(entry);
        continue;
      }
      if (this.paccayaVerb[particle]) {
        entry.categories.push({ level: 'paccaya.verb', type: this.paccayaVerb[particle] });
        resolved.push(entry);
        continue;
      }

      // LEVEL 7: Word changers
      if (this.wordChangerMap[particle]) {
        const wc = this.wordChangerMap[particle];
        entry.categories.push({ level: 'paccaya.word_changer', type: wc[0], subtype: wc[1] });
        resolved.push(entry);
        continue;
      }

      entry.categories.push({ level: 'unknown', note: 'particle not in rulebook' });
      resolved.push(entry);
    }

    return resolved;
  }

  tokenize(sentence) {
    /** Tokenize and extract particles using all known suffixes */
    const cleaned = sentence.trim().replace(/[။၊]+$/g, '');
    const rawTokens = cleaned.split(/\\s+/);

    const allSuffixes = new Set();
    for (const [ptype, particles] of Object.entries(this.g.wibat.noun)) {
      if (ptype !== 'disambiguate') {
        for (const p of particles) allSuffixes.add(p);
      }
    }
    // eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
    for (const [ptype, particles] of Object.entries(this.g.wibat.verb)) {
      for (const p of particles) allSuffixes.add(p);
    }
    for (const p of (this.g.wibat.disambiguate || [])) allSuffixes.add(p);
    for (const p of (this.g.wibat.noun.disambiguate || [])) allSuffixes.add(p);

    for (const section of ['clause', 'sentence']) {
      for (const [ptype, particles] of Object.entries(this.g.thanbanda[section])) {
        if (ptype !== 'disambiguate') {
          for (const p of particles) allSuffixes.add(p);
        }
      }
    }

    for (const section of ['noun', 'verb']) {
      for (const [ptype, particles] of Object.entries(this.g.paccaya[section])) {
        if (ptype !== 'disambiguate') {
          for (const p of particles) allSuffixes.add(p);
        }
      }
    }

    for (const [ptype, data] of Object.entries(this.g.paccaya.word_changer)) {
      if (ptype === 'disambiguate') continue;
      if (typeof data === 'object' && !Array.isArray(data)) {
        // eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
        for (const [subptype, particles] of Object.entries(data)) {
          for (const p of particles) allSuffixes.add(p);
        }
      } else {
        for (const p of data) allSuffixes.add(p);
      }
    }

    const suffixes = Array.from(allSuffixes).sort((a, b) => b.length - a.length);

    const tokens = [];
    for (const tok of rawTokens) {
      const particles = [];
      let temp = tok;
      for (const s of suffixes) {
        if (temp.endsWith(s)) {
          particles.push(s);
          temp = temp.slice(0, -s.length);
        }
      }
      tokens.push({ text: tok, base: temp, particles });
    }
    return tokens;
  }

  resolveSentence(sentence) {
    /** Full pipeline: tokenize → classify hosts → resolve particles */
    const tokens = this.tokenize(sentence);
    const total = tokens.length;

    const result = {
      input: sentence,
      tokens: [],
      summary: {
        total_tokens: total,
        host_types: { noun: 0, verb: 0, unknown: 0 },
        particle_types_found: new Set()
      }
    };

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      const hostType = this.classifyHost(tok.base, i, total, tok);
      result.summary.host_types[hostType]++;

      const resolvedParticles = this.resolveParticles(tok.base, tok.particles, i, total);

      for (const rp of resolvedParticles) {
        for (const cat of rp.categories) {
          if (cat.type) {
            result.summary.particle_types_found.add(cat.type);
          }
        }
      }

      result.tokens.push({
        position: i,
        text: tok.text,
        base: tok.base,
        host_type: hostType,
        particles: resolvedParticles
      });
    }

    result.summary.particle_types_found = Array.from(result.summary.particle_types_found).sort();
    return result;
  }

  formatResult(result) {
    /** Pretty print resolution result */
    const lines = [];
    lines.push('='.repeat(70));
    lines.push(`INPUT:${result.input}`);
    lines.push('='.repeat(70));
    lines.push(`\n📊 SUMMARY: ${result.summary.total_tokens} tokens`);
    lines.push(`Host types: ${JSON.stringify(result.summary.host_types)}`);
    lines.push(`   Particle types: ${result.summary.particle_types_found.join(', ')}`);
    lines.push('');

    for (const tok of result.tokens) {
      lines.push(`[${tok.position}] '${tok.text}' (base: '${tok.base}', host: ${tok.host_type})`);
      for (const p of tok.particles) {
        lines.push(`     └─ particle '${p.particle}':`);
        for (const cat of p.categories) {
          if (cat.type && !cat.possible_types) {
            const note = cat.rule ? ` — ${cat.rule}` : '';
            lines.push(`         → [${cat.level}] ${cat.type}${note}`);
          } else if (cat.possible_types) {
            const types = cat.possible_types.join(' / ');
            lines.push(`         → [${cat.level}] AMBIGUOUS: ${types}`);
            if (cat.resolution_strategy) {
              lines.push(`           💡 ${cat.resolution_strategy}`);
            }
          } else if (cat.note) {
            lines.push(`         → [${cat.level}] ${cat.note}`);
          }
        }
      }
      lines.push('');
    }

    lines.push('='.repeat(70));
    return lines.join('\\n');
  }
}

// ── Example usage (uncomment to run directly) ──────────────────────────
// const resolver = new MyanmarGrammarResolver();
// const tests = [
//   "သူသည် သတင်းစာကို ဖတ်သည်။",
//   "သူ သတင်းစာကို ဖတ်သည်။",
//   "မောင်ဘ၏ စာအုပ်",
//   "သူသည် ရန်ကုန်၌ နေသည်။",
//   "သူသည် အိမ်သို့ သွားသည်။",
// ];
// for (const sent of tests) {
//   console.log(resolver.formatResult(resolver.resolveSentence(sent)));
//   console.log();
// }

export default MyanmarGrammarResolver;
