import { W, L } from '../../abstract/kernel.js';
import C from '../sentences/const.js';
["§120","§150"].forEach(r => W.register("wakyarore_noun_clause", r, 0.9));
function classifyNounClause(tokens, index, context) {
    const t = tokens[index];
    if (!t) return null;
    const text = t.text;
    const matches = [];
    if (C.NOUN_CLAUSE_PARTICLES.includes(text)) {
        const window = tokens.slice(Math.max(0, index - 6), index);
        const hasVerb = window.some((tok, i) => L.isVerbLike(tok, window, i));
        const hasSubject = window.some((tok, i) =>
            L.isNounLike(tok, window, i) && i + 1 < window.length && L.isVerbLike(window[i + 1], window, i + 1)
        );
        if (hasVerb) {
            matches.push({
                module: "wakyarore_noun_clause",
                category: "အမှီဝါကျကဏ္ဍအမျိုးအစား",
                type: "နာမ်ဝါကျကဏ္ဍ",
                scope: "clause_type",
                rule_ref: "§120",
                confidence: hasSubject ? 0.92 : 0.8,
                particle: text,
                particle_type: "နာမ်ဝိဘတ်",
                role_hint: text === "မှာ" ? "ကတ္တား" : "ကံ",
                note: `Noun clause boundary marker ${text}. Dependent clause ends with noun case particle.`
            });
            if (context && context.hub) {
                context.hub.postConstraint(index, "clause_boundary", {
                    type: "dependent",
                    subtype: "noun_clause",
                    particle: text,
                    role_hint: text === "မှာ" ? "ကတ္တား" : "ကံ",
                    rule_ref: "§120"
                });
            }
        }
    }
    if (L.isVerbLike(t, tokens, index)) {
        const before = tokens.slice(0, index);
        const nounClauseEnd = before.map((tok, i) =>
            C.NOUN_CLAUSE_PARTICLES.includes(tok.text) && i > 0 ? i : -1
        ).filter(i => i !== -1).pop();
        if (nounClauseEnd !== undefined) {
            const clauseSlice = tokens.slice(0, nounClauseEnd + 1);
            const clauseHasVerb = clauseSlice.some((tok, i) => L.isVerbLike(tok, clauseSlice, i));
            if (clauseHasVerb) {
                matches.push({
                    module: "wakyarore_noun_clause",
                    category: "ဝါကျကဏ္ဍတာဝန်",
                    type: "noun_clause_argument",
                    scope: "clause_function",
                    rule_ref: "§150",
                    confidence: 0.88,
                    clause_end: tokens[nounClauseEnd].text,
                    note: `Preceding noun clause (ending ${tokens[nounClauseEnd].text}) serves as argument to verb ${text}.`
                });
            }
        }
    }
    return matches.length ? matches : null;
}
function extractNounClause(tokens, startIdx) {
    for (let i = startIdx; i < tokens.length; i++) {
        if (C.NOUN_CLAUSE_PARTICLES.includes(tokens[i].text)) {
            const slice = tokens.slice(startIdx, i + 1);
            const hasVerb = slice.some((t, idx) => L.isVerbLike(t, slice, idx));
            if (hasVerb) {
                return {
                    start: startIdx,
                    end: i,
                    tokens: slice,
                    particle: tokens[i].text,
                    role_hint: tokens[i].text === "မှာ" ? "ကတ္တား" : "ကံ"
                };
            }
        }
    }
    return null;
}
export {
    classify: classifyNounClause,
    extractNounClause,
    NOUN_CLAUSE_RULE: C.NOUN_CLAUSE_RULE,
    NOUN_CLAUSE_DUTY: C.NOUN_CLAUSE_DUTY
};