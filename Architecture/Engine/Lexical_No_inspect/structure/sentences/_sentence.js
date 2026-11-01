import { W, L } from '../../abstract/kernel.js';
import C from './const.js';
["§118","§119","§120","§121","§122","§123","§124","§125","§126",
 "§127","§128","§129","§130","§131","§132","§133","§134","§135",
 "§136","§137"].forEach(r => W.register("wakyarore_sentence_types", r, 0.9));
function classifySentenceType(tokens, index, context) {
    const t = tokens[index];
    if (!t) return null;
    const text = t.text;
    const matches = [];
    const next = tokens[index + 1];
    const prev = tokens[index - 1];
    if (L.isVerbLike(t, tokens, index) && next) {
        if (C.PRESENT_PAST_MARKERS.includes(next.text)) {
            matches.push({
                module: "wakyarore_sentence_types", category: "ထုတ်ဖော်ဝါကျ", type: "statement_present_past",
                scope: "sentence_type", rule_ref: "§120", confidence: 0.95, particle: next.text,
                note: `Statement (present/past): verb + ${next.text}`
            });
        }
        if (C.FUTURE_MARKERS.includes(next.text)) {
            matches.push({
                module: "wakyarore_sentence_types", category: "ထုတ်ဖော်ဝါကျ", type: "statement_future",
                scope: "sentence_type", rule_ref: "§120", confidence: 0.95, particle: next.text,
                note: `Statement (future): verb + ${next.text}`
            });
        }
    }
    if (L.isVerbLike(t, tokens, index) && (!next || C.SENTENCE_FINAL_PUNCT.includes(next.text))) {
        const hasNoParticle = !next || !C.ALL_SENTENCE_PARTICLES.includes(next.text);
        if (hasNoParticle) {
            matches.push({
                module: "wakyarore_sentence_types", category: "တိုက်တွန်းဝါကျ", type: "imperative_bare",
                scope: "sentence_type", rule_ref: "§121", confidence: 0.75,
                note: "Bare imperative: verb without particle."
            });
        }
    }
    if (C.EXPLICIT_IMPERATIVE_PARTICLES.includes(text)) {
        const verb = prev && L.isVerbLike(prev, tokens, index - 1) ? prev.text : null;
        matches.push({
            module: "wakyarore_sentence_types", category: "တိုက်တွန်းဝါကျ", type: "imperative_explicit",
            scope: "sentence_type", rule_ref: "§122", confidence: 0.95, particle: text, verb: verb,
            note: `Explicit imperative/command with ${text}.`
        });
    }
    if (C.HORTATIVE_PARTICLES.includes(text)) {
        const verb = prev && L.isVerbLike(prev, tokens, index - 1) ? prev.text : null;
        matches.push({
            module: "wakyarore_sentence_types", category: "တိုက်တွန်းဝါကျ", type: "hortative",
            scope: "sentence_type", rule_ref: "§123", confidence: 0.95, particle: text, verb: verb,
            note: `Hortative: let's do together with ${text}.`
        });
    }
    if (text === "ပါစေ") {
        const verb = prev && L.isVerbLike(prev, tokens, index - 1) ? prev.text : null;
        const subtype = classifyOptativeSubtype(verb);
        matches.push({
            module: "wakyarore_sentence_types", category: "ဆန္ဒဝါကျ", type: "optative",
            scope: "sentence_type", rule_ref: "§124", confidence: 0.9, particle: text, verb: verb, subtype: subtype,
            note: `Optative (${subtype}): ${text} after ${verb || "verb"}.`
        });
    }
    if (text === "ပါရစေ") {
        const verb = prev && L.isVerbLike(prev, tokens, index - 1) ? prev.text : null;
        matches.push({
            module: "wakyarore_sentence_types", category: "ဆန္ဒဝါကျ", type: "request",
            scope: "sentence_type", rule_ref: "§125", confidence: 0.95, particle: text, verb: verb,
            note: `Request: asking permission with ${text}.`
        });
    }
    if (text === "စေ") {
        const verb = prev && L.isVerbLike(prev, tokens, index - 1) ? prev.text : null;
        matches.push({
            module: "wakyarore_sentence_types", category: "တိုက်တွန်းဝါကျ", type: "decree",
            scope: "sentence_type", rule_ref: "§126", confidence: 0.95, particle: text, verb: verb,
            note: `Decree/official order with ${text}.`
        });
    }
    if (text === "မ" && next && L.isVerbLike(next, tokens, index + 1)) {
        matches.push({
            module: "wakyarore_sentence_types", category: "ငြင်းပယ်ဝါကျ", type: "negative",
            scope: "sentence_type", rule_ref: "§129", confidence: 0.95, marker: "မ",
            note: "Negative sentence: မ + verb."
        });
    }
    if (C.NEGATIVE_EXTENSION_PARTICLES.includes(text)) {
        const negContext = detectNegativeContext(tokens, index);
        if (negContext) {
            matches.push({
                module: "wakyarore_sentence_types", category: "ငြင်းပယ်ဝါကျ", type: "negative_extended",
                scope: "sentence_type", rule_ref: negContext.ref, confidence: 0.85, particle: text,
                note: negContext.note
            });
        }
    }
    if (C.QUESTION_PARTICLES.includes(text)) {
        const verb = prev && L.isVerbLike(prev, tokens, index - 1) ? prev.text : null;
        const qWord = findQuestionWord(tokens, index);
        matches.push({
            module: "wakyarore_sentence_types", category: "မေးခွန်းဝါကျ", type: "interrogative",
            scope: "sentence_type", rule_ref: ["နည်း","လဲ","တုံး"].includes(text) ? "§134" : "§137",
            confidence: 0.95, particle: text, verb: verb, question_word: qWord,
            note: `Question with ${text}${qWord ? ` (q-word: ${qWord})` : ""}.`
        });
    }
    return matches.length ? matches : null;
}
function classifyOptativeSubtype(verb) {
    if (!verb) return "general";
    const curseVerbs = ["ဘေးတွေ့", "ပျက်စီး", "ဆုံးရှုံး", "နာကျင်"];
    const permissionVerbs = ["ကစား", "သွား", "စား", "ဖတ်စား", "ပြောစား"];
    if (curseVerbs.includes(verb)) return "ကျိန်ဆဲခြင်း";
    if (permissionVerbs.includes(verb)) return "ခွင့်ပြုခြင်း";
    return "တောင့်တခြင်း";
}
function detectNegativeContext(tokens, idx) {
    const t = tokens[idx];
    const text = t.text;
    const window = tokens.slice(Math.max(0, idx - 4), idx);
    const hasMa = window.some(tok => tok.text === "မ");
    if (!hasMa) return null;
    if (text === "ဘူး") return { ref: "§130", note: "Negative with ဘူး" };
    if (["နဲ့", "နှင့်"].includes(text)) return { ref: "§131", note: "Negative with နဲ့/နှင့်" };
    if (text === "ပေါင်" || text === "ဘဲကို") return { ref: "§133", note: "Negative with ပေါင်/ဘဲကို" };
    return null;
}
function findQuestionWord(tokens, idx) {
    const window = tokens.slice(Math.max(0, idx - 6), idx);
    for (const tok of window) {
        for (const qw of C.QUESTION_WORDS) {
            if (tok.text.includes(qw)) return tok.text;
        }
    }
    return null;
}
function analyzeSentenceType(tokens) {
    const analysis = { meaning_type: null, construction_type: null, particles: [], confidence: 0 };
    for (let i = 0; i < tokens.length; i++) {
        const result = classifySentenceType(tokens, i, null);
        if (result) {
            for (const match of result) {
                if (match.scope === "sentence_type") {
                    analysis.particles.push({ index: i, token: tokens[i].text, ...match });
                }
            }
        }
    }
    const typeCounts = {};
    for (const p of analysis.particles) {
        typeCounts[p.category] = (typeCounts[p.category] || 0) + 1;
    }
    const dominant = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0];
    if (dominant) {
        analysis.meaning_type = dominant[0];
        analysis.confidence = Math.min(0.95, 0.7 + dominant[1] * 0.1);
    }
    return analysis;
}
export {
    classify: classifySentenceType,
    analyzeSentenceType
};