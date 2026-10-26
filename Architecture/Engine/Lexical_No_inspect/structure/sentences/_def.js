import { W, L } from '../../abstract/kernel.js';
import C from './const.js';
[
    "§180","§181","§182","§183","§184","§185","§186","§187","§188",
    "§112","§113","§114","§115","§116","§117"
].forEach(r => W.register("wakyarore", r, 0.85));
function classifyWakyarore(tokens, index, context) {
    const t = tokens[index];
    if (!t) return null;
    const text = t.text;
    const matches = [];
    const prev = tokens[index - 1];
    const next = tokens[index + 1];
    const particleSequence = extractParticleSequence(tokens, index);
    if (particleSequence) {
        const matchedPattern = matchPattern(particleSequence.sequence);
        if (matchedPattern) {
            matches.push({
                module: "wakyarore",
                category: "ဝါကျရိုး",
                type: matchedPattern.name,
                scope: "sentence_pattern",
                pattern_id: matchedPattern.id,
                slots: matchedPattern.slots,
                rule_ref: matchedPattern.ref,
                confidence: 0.85,
                note: `ဝါကျရိုး pattern ${matchedPattern.id}: ${matchedPattern.slots.join(" + ")}`
            });
        }
    }
    if (L.isAdjBase(text) && next && (L.isNounLike(next, tokens, index + 1) || L.isVerbLike(next, tokens, index + 1))) {
        matches.push({
            module: "wakyarore",
            category: "ဝါကျရိုး",
            type: "နာမဝိသေသနထည့်သွင်း",
            scope: "adjective_insertion",
            rule_ref: "§182",
            confidence: 0.8,
            note: "Adjective/adverb insertion into sentence pattern."
        });
    }
    if (C.PHRASE_MARKERS.includes(text)) {
        matches.push({
            module: "wakyarore",
            category: "ဝါကျရိုး",
            type: "ပုဒ်စုထည့်သွင်း",
            scope: "phrase_insertion",
            rule_ref: "§183",
            confidence: 0.8,
            note: "Phrase group insertion detected."
        });
    }
    if (isFrontedConstituent(tokens, index)) {
        matches.push({
            module: "wakyarore",
            category: "ဝါကျရိုး",
            type: "ရှေ့နောက်အစီအစဉ်ပြောင်း",
            scope: "reordering",
            rule_ref: "§184",
            confidence: 0.75,
            note: "Constituent fronting for emphasis detected."
        });
    }
    if (text === "( )" || text === "()") {
        matches.push({
            module: "wakyarore",
            category: "ဝါကျရိုး",
            type: "ကတ္တားမြှုပ်",
            scope: "subject_omission",
            rule_ref: "§185",
            confidence: 0.9,
            note: "Subject omission marker."
        });
    }
    if (L.isVerbLike(t, tokens, index)) {
        const sentenceType = classifySentenceType(tokens, index);
        if (sentenceType) {
            matches.push({
                module: "wakyarore",
                category: "ဝါကျရိုး",
                type: sentenceType.type,
                scope: sentenceType.scope,
                rule_ref: sentenceType.ref,
                confidence: sentenceType.confidence,
                note: sentenceType.note
            });
        }
    }
    return matches.length ? matches : null;
}
function extractParticleSequence(tokens, startIdx) {
    const maxLookahead = 10;
    const sequence = [];
    for (let i = startIdx; i < Math.min(startIdx + maxLookahead, tokens.length); i++) {
        const t = tokens[i];
        const role = C.PARTICLE_ROLE_MAP[t.text];
        if (role) {
            sequence.push({ token: t.text, role, index: i });
        } else if (L.isVerbLike(t, tokens, i)) {
            sequence.push({ token: t.text, role: "ကြိယာ", index: i });
            return { sequence, verbIndex: i };
        } else if (L.isNounLike(t, tokens, i) && sequence.length === 0) {
            sequence.push({ token: t.text, role: "ကတ္တား", index: i });
        }
    }
    return sequence.length > 0 ? { sequence, verbIndex: -1 } : null;
}
function matchPattern(particleSeq) {
    const roles = particleSeq.map(p => p.role);
    for (const pattern of C.SENTENCE_PATTERNS) {
        if (arraysEqual(roles, pattern.slots)) {
            return pattern;
        }
    }
    for (const pattern of C.SENTENCE_PATTERNS) {
        if (isSubsequence(roles, pattern.slots)) {
            return { ...pattern, partial: true };
        }
    }
    return null;
}
function isFrontedConstituent(tokens, idx) {
    if (idx === 0) return false;
    const t = tokens[idx];
    if (!t) return false;
    if (["၌", "တွင်", "မှ", "က", "သို့"].includes(t.text) && idx < 3) {
        return true;
    }
    return false;
}
function classifySentenceType(tokens, idx) {
    return null;
}
function arraysEqual(a, b) {
    if (a.length !== b.length) return false;
    return a.every((val, i) => val === b[i]);
}
function isSubsequence(small, large) {
    let i = 0, j = 0;
    while (i < small.length && j < large.length) {
        if (small[i] === large[j]) i++;
        j++;
    }
    return i === small.length;
}
export {
    classify: classifyWakyarore,
    SENTENCE_PATTERNS: C.SENTENCE_PATTERNS,
    PARTICLE_ROLE_MAP: C.PARTICLE_ROLE_MAP,
    EXTENDED_PATTERNS: C.EXTENDED_PATTERNS
};