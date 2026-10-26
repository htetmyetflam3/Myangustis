import { W, L } from '../../abstract/kernel.js';
import C from '../sentences/const.js';
["§145","§146","§147","§148"].forEach(r => W.register("wakyarore_single_dependent", r, 0.9));
function classifySingleDependent(tokens, index, context) {
    const t = tokens[index];
    if (!t) return null;
    const text = t.text;
    const matches = [];
    const next = tokens[index + 1];
    if (L.isVerbLike(t, tokens, index)) {
        const verbCount = tokens.filter((tok, i) => L.isVerbLike(tok, tokens, i)).length;
        if (verbCount === 2) {
            const verbList = tokens.filter((tok, i) => L.isVerbLike(tok, tokens, i));
            const verbIndex = verbList.indexOf(t);
            matches.push({
                module: "wakyarore_single_dependent",
                category: "ဝါကျရောခွဲစိတ်",
                type: verbIndex === 0 ? "dependent_verb" : "independent_verb",
                scope: "clause_split",
                rule_ref: "§145",
                confidence: 0.85,
                verb_position: verbIndex === 0 ? "front" : "end",
                note: `Two-verb compound: ${text} at ${verbIndex === 0 ? "front (dependent)" : "end (independent)"}.`
            });
        }
    }
    if (L.isVerbLike(t, tokens, index) && next) {
        if (C.ALL_CONNECTORS.includes(next.text)) {
            matches.push({
                module: "wakyarore_single_dependent",
                category: "ဝါကျရောခွဲစိတ်",
                type: "connector_boundary",
                scope: "clause_boundary",
                rule_ref: "§146",
                confidence: 0.9,
                connector: next.text,
                note: `Connector ${next.text} after verb ${text} marks dependent clause end.`
            });
        }
    }
    if (L.isVerbLike(t, tokens, index)) {
        const window = tokens.slice(Math.max(0, index - 5), index);
        const hasExplicitSubject = window.some((tok, i) => 
            C.SUBJECT_MARKERS.includes(tok.text) && i > 0 && L.isNounLike(window[i - 1], window, i - 1)
        );
        if (!hasExplicitSubject) {
            matches.push({
                module: "wakyarore_single_dependent",
                category: "ဝါကျရောခွဲစိတ်",
                type: "omitted_subject",
                scope: "omission",
                rule_ref: "§148",
                confidence: 0.7,
                note: "Subject may be omitted in this clause (context-dependent)."
            });
        }
    }
    return matches.length ? matches : null;
}
function extractSingleDependentClauses(tokens) {
    const verbs = tokens.map((t, i) => L.isVerbLike(t, tokens, i) ? i : -1).filter(i => i !== -1);
    if (verbs.length !== 2) return null;
    const [firstVerbIdx, secondVerbIdx] = verbs;
    let connectorIdx = -1;
    for (let i = firstVerbIdx + 1; i < secondVerbIdx; i++) {
        if (C.ALL_CONNECTORS.includes(tokens[i].text)) {
            connectorIdx = i;
            break;
        }
    }
    if (connectorIdx === -1) return null;
    return {
        dependent: { start: 0, end: connectorIdx, tokens: tokens.slice(0, connectorIdx + 1) },
        independent: { start: connectorIdx + 1, end: tokens.length - 1, tokens: tokens.slice(connectorIdx + 1) },
        connector: tokens[connectorIdx].text
    };
}
export {
    classify: classifySingleDependent,
    extractSingleDependentClauses,
    SINGLE_DEPENDENT_STRUCTURE: C.SINGLE_DEPENDENT_STRUCTURE,
    CONNECTOR_BOUNDARY_RULE: C.CONNECTOR_BOUNDARY_RULE,
    SPLIT_PROCEDURE: C.SPLIT_PROCEDURE,
    CLAUSE_SUBJECT_OMISSION: C.CLAUSE_SUBJECT_OMISSION
};