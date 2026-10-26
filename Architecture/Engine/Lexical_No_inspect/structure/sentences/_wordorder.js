m
import { W, L } from '../../abstract/kernel.js';
import C from './const.js';
["§206","§207","§208","§209"].forEach(r => W.register("wakyarore_wordorder", r, 0.9));
function measureDistance(tokens, modifierIdx, headIdx) {
    return Math.abs(modifierIdx - headIdx);
}
function findNearestNoun(tokens, startIdx, direction = 1) {
    for (let i = startIdx; i >= 0 && i < tokens.length; i += direction) {
        if (L.isNounLike(tokens[i], tokens, i)) {
            return { index: i, token: tokens[i] };
        }
    }
    return null;
}
function findNearestVerb(tokens, startIdx, direction = 1) {
    for (let i = startIdx; i >= 0 && i < tokens.length; i += direction) {
        if (L.isVerbLike(tokens[i], tokens, i)) {
            return { index: i, token: tokens[i] };
        }
    }
    return null;
}
function detectSubjectViolation(tokens, idx) {
    const t = tokens[idx];
    if (!C.SUBJECT_MARKERS.includes(t.text)) return null;
    const prev = tokens[idx - 1];
    const next = tokens[idx + 1];
    if (!prev || !next) return null;
    const nearestVerb = findNearestVerb(tokens, idx, 1);
    if (nearestVerb) {
        const distance = measureDistance(tokens, idx, nearestVerb.index);
        const interveningVerbs = tokens.slice(idx + 1, nearestVerb.index).filter(
            (tok, i) => L.isVerbLike(tok, tokens, idx + 1 + i)
        );
        if (interveningVerbs.length > 0) {
            return {
                type: "distant_subject",
                severity: "high",
                subject: prev.text,
                intended_verb: nearestVerb.token.text,
                distance: distance,
                intervening_verbs: interveningVerbs.map(v => v.text),
                note: `Subject ${prev.text} may attach to wrong verb due to distance.`,
                fix: `Move ${prev.text} closer to ${nearestVerb.token.text}`
            };
        }
    }
    return null;
}
function detectAdjectiveViolation(tokens, idx) {
    const t = tokens[idx];
    if (!C.ADJECTIVE_CLAUSE_PARTICLES.includes(t.text)) return null;
    const prev = tokens[idx - 1];
    const next = tokens[idx + 1];
    if (!prev || !next) return null;
    if (!L.isNounLike(next, tokens, idx + 1)) {
        const nearestNoun = findNearestNoun(tokens, idx, 1);
        return {
            type: "distant_adjective",
            severity: "high",
            adjective: prev.text,
            marker: t.text,
            intended_noun: nearestNoun ? nearestNoun.token.text : null,
            actual_next: next.text,
            note: `Adjective ${prev.text}${t.text} should modify ${nearestNoun ? nearestNoun.token.text : "noun"}, not ${next.text}.`,
            fix: `Place ${prev.text}${t.text} immediately before ${nearestNoun ? nearestNoun.token.text : "intended noun"}`
        };
    }
    return null;
}
function detectAdverbViolation(tokens, idx) {
    const t = tokens[idx];
    const adverbMarkers = ["စွာ", "တတ်", "တ", "ချည်", "ချည်ချည်"];
    const timePlaceParticles = ["က", "၌", "တွင်", "မှ", "သို့"];
    if (!adverbMarkers.includes(t.text) && !timePlaceParticles.includes(t.text)) return null;
    const prev = tokens[idx - 1];
    const next = tokens[idx + 1];
    if (!prev || !next) return null;
    if (timePlaceParticles.includes(t.text)) {
        if (!L.isVerbLike(next, tokens, idx + 1)) {
            const nearestVerb = findNearestVerb(tokens, idx, 1);
            return {
                type: "distant_adverb",
                severity: "medium",
                adverb: prev.text + t.text,
                intended_verb: nearestVerb ? nearestVerb.token.text : null,
                actual_next: next.text,
                note: `Adverbial ${prev.text}${t.text} should be near verb, not ${next.text}.`,
                fix: `Place ${prev.text}${t.text} before intended verb`
            };
        }
    }
    return null;
}
function classifyWordOrder(tokens, index, context) {
    const t = tokens[index];
    if (!t) return null;
    const text = t.text;
    const matches = [];
    const subjectViolation = detectSubjectViolation(tokens, index);
    if (subjectViolation) {
        matches.push({
            module: "wakyarore_wordorder",
            category: "စကားအထားအသို",
            type: "ကတ္တားအထားအသို",
            scope: "violation",
            subtype: subjectViolation.type,
            rule_ref: "§207",
            confidence: 0.85,
            violation: subjectViolation,
            note: subjectViolation.note
        });
    }
    if (C.SUBJECT_MARKERS.includes(text)) {
        const prev = tokens[index - 1];
        const next = tokens[index + 1];
        if (prev && next && L.isNounLike(prev, tokens, index - 1) && L.isVerbLike(next, tokens, index + 1)) {
            matches.push({
                module: "wakyarore_wordorder",
                category: "စကားအထားအသို",
                type: "ကတ္တားအထားအသို",
                scope: "correct",
                rule_ref: "§207",
                confidence: 0.9,
                note: `Correct subject placement: ${prev.text}${text} before verb.`
            });
        }
    }
    const adjViolation = detectAdjectiveViolation(tokens, index);
    if (adjViolation) {
        matches.push({
            module: "wakyarore_wordorder",
            category: "စကားအထားအသို",
            type: "နာမဝိသေသနအထားအသို",
            scope: "violation",
            subtype: adjViolation.type,
            rule_ref: "§208",
            confidence: 0.85,
            violation: adjViolation,
            note: adjViolation.note
        });
    }
    if (C.ADJECTIVE_CLAUSE_PARTICLES.includes(text)) {
        const prev = tokens[index - 1];
        const next = tokens[index + 1];
        if (prev && next && L.isNounLike(next, tokens, index + 1)) {
            matches.push({
                module: "wakyarore_wordorder",
                category: "စကားအထားအသို",
                type: "နာမဝိသေသနအထားအသို",
                scope: "correct",
                rule_ref: "§208",
                confidence: 0.9,
                note: `Correct adjective placement: ${prev.text}${text} ${next.text}`
            });
        }
    }
    const advViolation = detectAdverbViolation(tokens, index);
    if (advViolation) {
        matches.push({
            module: "wakyarore_wordorder",
            category: "စကားအထားအသို",
            type: "ကြိယာဝိသေသနအထားအသို",
            scope: "violation",
            subtype: advViolation.type,
            rule_ref: "§209",
            confidence: 0.85,
            violation: advViolation,
            note: advViolation.note
        });
    }
    const adverbMarkers = ["စွာ", "တတ်", "တ", "ချည်", "ချည်ချည်"];
    if (adverbMarkers.includes(text)) {
        const prev = tokens[index - 1];
        const next = tokens[index + 1];
        if (prev && next && L.isVerbLike(next, tokens, index + 1)) {
            matches.push({
                module: "wakyarore_wordorder",
                category: "စကားအထားအသို",
                type: "ကြိယာဝိသေသနအထားအသို",
                scope: "correct",
                rule_ref: "§209",
                confidence: 0.9,
                note: `Correct adverb placement: ${prev.text}${text} before ${next.text}`
            });
        }
    }
    return matches.length ? matches : null;
}
function validateWordOrder(tokens) {
    const violations = [];
    const correct_placements = [];
    for (let i = 0; i < tokens.length; i++) {
        const result = classifyWordOrder(tokens, i, null);
        if (result) {
            for (const match of result) {
                if (match.scope === "violation") {
                    violations.push({ index: i, ...match });
                } else if (match.scope === "correct") {
                    correct_placements.push({ index: i, ...match });
                }
            }
        }
    }
    return {
        is_valid: violations.length === 0,
        violations,
        correct_placements,
        summary: {
            total_tokens: tokens.length,
            violation_count: violations.length,
            correct_count: correct_placements.length
        }
    };
}
export {
    classify: classifyWordOrder,
    validateWordOrder,
    measureDistance,
    findNearestNoun,
    findNearestVerb
};