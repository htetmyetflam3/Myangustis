import { W, L } from '../../abstract/kernel.js';
import C from '../../../../../vite.config.js';
W.register("wakyarore_adjective_clause", "§151", 0.9);
function classifyAdjectiveClause(tokens, index, context) {
    const t = tokens[index];
    if (!t) return null;
    const text = t.text;
    const matches = [];
    if (C.ADJECTIVE_CLAUSE_PARTICLES.includes(text)) {
        const window = tokens.slice(Math.max(0, index - 6), index);
        const hasVerb = window.some((tok, i) => L.isVerbLike(tok, window, i));
        if (hasVerb) {
            matches.push({
                module: "wakyarore_adjective_clause",
                category: "အမှီဝါကျကဏ္ဍအမျိုးအစား",
                type: "နာမဝိသေသနဝါကျကဏ္ဍ",
                scope: "clause_type",
                rule_ref: "§151",
                confidence: 0.92,
                particle: text,
                particle_type: "နာမဝိသေသနပုဒ်ပြောင်းပစ္စည်း",
                note: `Adjective clause boundary marker ${text}. Modifies preceding noun in independent clause.`
            });
            if (context && context.hub) {
                context.hub.postConstraint(index, "clause_boundary", {
                    type: "dependent",
                    subtype: "adjective_clause",
                    particle: text,
                    rule_ref: "§151"
                });
            }
        }
    }
    if (L.isNounLike(t, tokens, index)) {
        const after = tokens.slice(index + 1, index + 8);
        const adjParticleIdx = after.findIndex((tok, i) =>
            C.ADJECTIVE_CLAUSE_PARTICLES.includes(tok.text) &&
            after.slice(0, i).some((t2, j) => L.isVerbLike(t2, after, j))
        );
        if (adjParticleIdx !== -1) {
            matches.push({
                module: "wakyarore_adjective_clause",
                category: "ဝါကျကဏ္ဍတာဝန်",
                type: "adjective_clause_modifier",
                scope: "clause_function",
                rule_ref: "§151",
                confidence: 0.88,
                modified_noun: text,
                note: `Noun ${text} is modified by preceding adjective clause ending with ${after[adjParticleIdx].text}.`
            });
            if (context && context.hub) {
                context.hub.postConstraint(index, "modified_by", {
                    modifier_type: "adjective_clause",
                    clause_end_particle: after[adjParticleIdx].text,
                    rule_ref: "§151"
                });
            }
        }
    }
    return matches.length ? matches : null;
}
function extractAdjectiveClause(tokens, startIdx) {
    for (let i = startIdx; i < tokens.length; i++) {
        if (C.ADJECTIVE_CLAUSE_PARTICLES.includes(tokens[i].text)) {
            const slice = tokens.slice(startIdx, i + 1);
            const hasVerb = slice.some((t, idx) => L.isVerbLike(t, slice, idx));
            if (hasVerb) {
                return {
                    start: startIdx,
                    end: i,
                    tokens: slice,
                    particle: tokens[i].text,
                    modifies: null 
                };
            }
        }
    }
    return null;
}
export {
    classify: classifyAdjectiveClause,
    extractAdjectiveClause,
    ADJECTIVE_CLAUSE_RULE: C.ADJECTIVE_CLAUSE_RULE
};