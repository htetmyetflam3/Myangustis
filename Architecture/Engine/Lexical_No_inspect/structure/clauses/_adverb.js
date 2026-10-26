import { W, L } from '../../abstract/kernel.js';
import C from '../sentences/const.js';
["§121","§122","§152"].forEach(r => W.register("wakyarore_adverb_clause", r, 0.9));
function classifyAdverbClause(tokens, index, context) {
    const t = tokens[index];
    if (!t) return null;
    const text = t.text;
    const matches = [];
    if (C.ADVERB_PARTICLE_MAP[text]) {
        const info = C.ADVERB_PARTICLE_MAP[text];
        const window = tokens.slice(Math.max(0, index - 6), index);
        const hasVerb = window.some((tok, i) => L.isVerbLike(tok, window, i));
        if (hasVerb) {
            matches.push({
                module: "wakyarore_adverb_clause",
                category: "အမှီဝါကျကဏ္ဍအမျိုးအစား",
                type: info.type,
                subtype_id: info.id,
                scope: "clause_type",
                rule_ref: info.ref,
                confidence: 0.92,
                particle: text,
                note: `Adverb clause subtype ${info.type} (id:${info.id}) ending with ${text}.`
            });
            if (context && context.hub) {
                context.hub.postConstraint(index, "clause_boundary", {
                    type: "dependent",
                    subtype: "adverb_clause",
                    subtype_id: info.id,
                    particle: text,
                    rule_ref: info.ref
                });
            }
        }
    }
    if (L.isVerbLike(t, tokens, index)) {
        const before = tokens.slice(0, index);
        const adverbEnd = before.map((tok, i) =>
            C.ADVERB_PARTICLE_MAP[tok.text] ? i : -1
        ).filter(i => i !== -1).pop();
        if (adverbEnd !== undefined) {
            const info = C.ADVERB_PARTICLE_MAP[before[adverbEnd].text];
            matches.push({
                module: "wakyarore_adverb_clause",
                category: "ဝါကျကဏ္ဍတာဝန်",
                type: "adverb_clause_modifier",
                subtype: info.type,
                subtype_id: info.id,
                scope: "clause_function",
                rule_ref: "§152",
                confidence: 0.88,
                modified_verb: text,
                note: `Preceding adverb clause (${info.type}) modifies verb ${text}.`
            });
            if (context && context.hub) {
                context.hub.postConstraint(index, "modified_by", {
                    modifier_type: "adverb_clause",
                    subtype: info.type,
                    rule_ref: "§152"
                });
            }
        }
    }
    return matches.length ? matches : null;
}
function extractAdverbClause(tokens, startIdx) {
    const particles = Object.keys(C.ADVERB_PARTICLE_MAP);
    for (let i = startIdx; i < tokens.length; i++) {
        if (particles.includes(tokens[i].text)) {
            const slice = tokens.slice(startIdx, i + 1);
            const hasVerb = slice.some((t, idx) => L.isVerbLike(t, slice, idx));
            if (hasVerb) {
                const info = C.ADVERB_PARTICLE_MAP[tokens[i].text];
                return {
                    start: startIdx,
                    end: i,
                    tokens: slice,
                    particle: tokens[i].text,
                    subtype: info.type,
                    subtype_id: info.id
                };
            }
        }
    }
    return null;
}
export {
    classify: classifyAdverbClause,
    extractAdverbClause,
    ADVERB_CLAUSE_TYPES: C.ADVERB_CLAUSE_TYPES,
    ADVERB_CLAUSE_DUTY: C.ADVERB_CLAUSE_DUTY,
    ADVERB_PARTICLE_MAP: C.ADVERB_PARTICLE_MAP
};