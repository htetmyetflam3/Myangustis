import { W, L } from '../../abstract/kernel.js';
import C from './const.js';
[
    "§194","§195","§196","§197","§198","§199","§200",
    "§201","§202","§203","§204","§205"
].forEach(r => W.register("wakyarore_analysis", r, 0.82));
function classifyAnalysis(tokens, index, context) {
    const t = tokens[index];
    if (!t) return null;
    const matches = [];
    const meaningType = detectMeaningType(tokens, index);
    if (meaningType) {
        matches.push({
            module: "wakyarore_analysis",
            category: "ဝါကျခွဲခြမ်းစိတ်ဖြာခြင်း",
            type: meaningType.type,
            scope: "sentence_meaning_type",
            rule_ref: meaningType.ref,
            confidence: meaningType.confidence,
            note: meaningType.note
        });
    }
    const constructionType = detectConstructionType(tokens, index);
    if (constructionType) {
        matches.push({
            module: "wakyarore_analysis",
            category: "ဝါကျခွဲခြမ်းစိတ်ဖြာခြင်း",
            type: constructionType.type,
            scope: "sentence_construction_type",
            rule_ref: constructionType.ref,
            confidence: constructionType.confidence,
            note: constructionType.note
        });
    }
    const wordType = classifyWordType(tokens, index);
    if (wordType) {
        matches.push({
            module: "wakyarore_analysis",
            category: "ဝါကျခွဲခြမ်းစိတ်ဖြာခြင်း",
            type: wordType.type,
            scope: "word_type",
            rule_ref: wordType.ref,
            confidence: wordType.confidence,
            note: wordType.note
        });
    }
    const wibatType = classifyWibatType(tokens, index);
    if (wibatType) {
        matches.push({
            module: "wakyarore_analysis",
            category: "ဝါကျခွဲခြမ်းစိတ်ဖြာခြင်း",
            type: wibatType.type,
            scope: "wibat_type",
            rule_ref: wibatType.ref,
            confidence: wibatType.confidence,
            note: wibatType.note
        });
    }
    const phraseType = classifyPhraseType(tokens, index);
    if (phraseType) {
        matches.push({
            module: "wakyarore_analysis",
            category: "ဝါကျခွဲခြမ်းစိတ်ဖြာခြင်း",
            type: phraseType.type,
            scope: "phrase_type",
            rule_ref: phraseType.ref,
            confidence: phraseType.confidence,
            note: phraseType.note
        });
    }
    return matches.length ? matches : null;
}
function detectMeaningType(tokens, idx) {
    const t = tokens[idx];
    const next = tokens[idx + 1];
    const text = t.text;
    if (C.QUESTION_PARTICLES.includes(text)) {
        return {
            type: "မေးခွန်းဝါကျ",
            ref: "§196-ခ",
            confidence: 0.95,
            note: `Question sentence: ${text} particle detected.`
        };
    }
    if (text === "မ" || text === "မဟုတ်" || text === "မရှိ") {
        return {
            type: "ငြင်းပယ်ဝါကျ",
            ref: "§196-ဂ",
            confidence: 0.9,
            note: "Negative sentence: negation marker detected."
        };
    }
    if (C.IMPERATIVE_PARTICLES.includes(text)) {
        return {
            type: "တိုက်တွန်းဝါကျ",
            ref: "§196-ဃ",
            confidence: 0.95,
            note: `Imperative: ${text} particle detected.`
        };
    }
    if (text === "ပါစေ" || text === "ကြပါစေ") {
        return {
            type: "ဆန္ဒဝါကျ",
            ref: "§196-င",
            confidence: 0.9,
            note: "Optative/wish sentence detected."
        };
    }
    if (L.isVerbLike(t, tokens, idx) && next && C.STATEMENT_PARTICLES.includes(next.text)) {
        return {
            type: "ထုတ်ဖော်ဝါကျ",
            ref: "§196-က",
            confidence: 0.9,
            note: `Statement: verb + ${next.text} detected.`
        };
    }
    return null;
}
function detectConstructionType(tokens, idx) {
    const window = tokens.slice(Math.max(0, idx - 5), Math.min(tokens.length, idx + 10));
    const verbCount = window.filter(t => L.isVerbLike(t, tokens, idx)).length;
    const connectorCount = window.filter(t => C.ALL_CONNECTORS.includes(t.text)).length;
    if (verbCount >= 2 && connectorCount > 0) {
        return {
            type: "ဝါကျရော",
            ref: "§197-ခ",
            confidence: 0.85,
            note: `Compound sentence: ${verbCount} verbs, ${connectorCount} connectors detected.`
        };
    }
    if (verbCount === 1) {
        return {
            type: "ဝါကျရိုး",
            ref: "§197-က",
            confidence: 0.8,
            note: "Simple sentence: single verb, no connectors."
        };
    }
    return null;
}
function classifyWordType(tokens, idx) {
    const t = tokens[idx];
    const text = t.text;
    const prev = tokens[idx - 1];
    const next = tokens[idx + 1];
    if (text.includes("~") || C.COMPOUND_PATTERNS.includes(text)) {
        return {
            type: "ပေါင်းစပ်ပုဒ်",
            ref: "§199-ခ",
            confidence: 0.85,
            note: `Compound word: ${text}`
        };
    }
    if (hasParticleSuffix(text)) {
        return {
            type: "ပစ္စည်းရောပုဒ်",
            ref: "§199-ဂ",
            confidence: 0.8,
            note: `Particle-inflected word: ${text}`
        };
    }
    if (isPostpositionInflected(text)) {
        return {
            type: "ဝိဘတ်သွယ်ပုဒ်",
            ref: "§199-ဃ",
            confidence: 0.85,
            note: `Postposition-inflected word: ${text}`
        };
    }
    if (text.length <= 3 && !L.isParticleForm(text)) {
        return {
            type: "ပုဒ်ရိုး",
            ref: "§199-က",
            confidence: 0.7,
            note: `Simple word: ${text}`
        };
    }
    return null;
}
function classifyWibatType(tokens, idx) {
    const t = tokens[idx];
    const text = t.text;
    if (!L.isParticleForm(text)) return null;
    const wibat = C.WIBAT_TYPE_MAP ? C.WIBAT_TYPE_MAP[text] : null;
    if (wibat) {
        return {
            type: wibat.type,
            ref: wibat.ref,
            confidence: 0.9,
            note: `ဝိဘတ်သွယ်ပုဒ်: ${wibat.type}`
        };
    }
    return null;
}
function classifyPhraseType(tokens, idx) {
    const t = tokens[idx];
    const text = t.text;
    const prev = tokens[idx - 1];
    const next = tokens[idx + 1];
    if (L.isParticleForm(text) && prev && L.isNounLike(prev, tokens, idx - 1)) {
        return {
            type: "ဝိဘတ်ဆက်ပုဒ်စု",
            ref: "§202-က",
            confidence: 0.85,
            note: `Postposition phrase: ${prev.text} + ${text}`
        };
    }
    if (L.isParticleForm(text) && prev && !L.isNounLike(prev, tokens, idx - 1)) {
        return {
            type: "ပစ္စည်းဆက်ပုဒ်စု",
            ref: "§202-ခ",
            confidence: 0.8,
            note: `Particle phrase: ${prev.text} + ${text}`
        };
    }
    if (C.CONJUNCTION_PHRASE_MARKERS.includes(text)) {
        return {
            type: "သမ္ဗန္ဓဆက်ပုဒ်စု",
            ref: "§202-ဂ",
            confidence: 0.9,
            note: `Conjunction phrase with ${text}`
        };
    }
    return null;
}
function hasParticleSuffix(text) {
    return C.PARTICLE_SUFFIXES.some(suffix => text.endsWith(suffix));
}
function isPostpositionInflected(text) {
    return C.POSTPOSITION_MARKERS.some(marker => text.includes(marker));
}
function analyzeSentence(tokens) {
    const analysis = {
        meaning_type: null,
        construction_type: null,
        words: [],
        phrases: [],
        clauses: [],
        steps: []
    };
    for (let i = 0; i < tokens.length; i++) {
        const mt = detectMeaningType(tokens, i);
        if (mt) {
            analysis.meaning_type = mt;
            analysis.steps.push({ step: 1, result: mt });
            break;
        }
    }
    for (let i = 0; i < tokens.length; i++) {
        const ct = detectConstructionType(tokens, i);
        if (ct) {
            analysis.construction_type = ct;
            analysis.steps.push({ step: 2, result: ct });
            break;
        }
    }
    for (let i = 0; i < tokens.length; i++) {
        const wt = classifyWordType(tokens, i);
        if (wt) analysis.words.push({ index: i, ...wt });
        const pt = classifyPhraseType(tokens, i);
        if (pt) analysis.phrases.push({ index: i, ...pt });
        const wb = classifyWibatType(tokens, i);
        if (wb) analysis.words.push({ index: i, ...wb });
    }
    return analysis;
}
export {
    classify: classifyAnalysis,
    analyzeSentence
};