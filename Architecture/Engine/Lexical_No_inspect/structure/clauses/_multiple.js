import { W, L } from '../../abstract/kernel.js';
import C from '../sentences/const.js';
["§156","§157","§158","§159","§160","§161","§162"].forEach(r => W.register("wakyarore_multiple_dependent", r, 0.9));
function classifyMultipleDependent(tokens, index, context) {
    const t = tokens[index];
    if (!t) return null;
    const text = t.text;
    const matches = [];
    if (L.isVerbLike(t, tokens, index)) {
        const verbIndices = tokens.map((tok, i) => L.isVerbLike(tok, tokens, i) ? i : -1).filter(i => i !== -1);
        if (verbIndices.length >= 3) {
            const verbPos = verbIndices.indexOf(index);
            if (verbPos !== -1) {
                const isFinal = verbPos === verbIndices.length - 1;
                matches.push({
                    module: "wakyarore_multiple_dependent",
                    category: "ဝါကျရောခွဲစိတ်",
                    type: isFinal ? "independent_verb" : "dependent_verb",
                    scope: "clause_split",
                    rule_ref: "§156",
                    confidence: 0.9,
                    verb_index: verbPos,
                    total_verbs: verbIndices.length,
                    verb_position: isFinal ? "end" : "front",
                    note: `Multi-verb compound (${verbIndices.length} verbs): ${text} at ${isFinal ? "end (independent)" : "front (dependent #" + (verbPos + 1) + ")"}.`
                });
            }
        }
    }
    if (L.isVerbLike(t, tokens, index)) {
        const verbIndices = tokens.map((tok, i) => L.isVerbLike(tok, tokens, i) ? i : -1).filter(i => i !== -1);
        const verbPos = verbIndices.indexOf(index);
        if (verbPos !== -1 && verbPos < verbIndices.length - 1) {
            const nextVerbIdx = verbIndices[verbPos + 1];
            const foundConnector = tokens.slice(index + 1, nextVerbIdx).some(tok => C.ALL_CONNECTORS.includes(tok.text));
            if (foundConnector) {
                matches.push({
                    module: "wakyarore_multiple_dependent",
                    category: "ဝါကျရောခွဲစိတ်",
                    type: "dependent_clause_boundary",
                    scope: "clause_boundary",
                    rule_ref: "§157",
                    confidence: 0.9,
                    note: `Connector found between verb ${verbPos + 1} and verb ${verbPos + 2} — marks dependent clause boundary.`
                });
            }
        }
    }
    if (C.ADJECTIVE_CLAUSE_PARTICLES.includes(text)) {
        const window = tokens.slice(Math.max(0, index - 4), index);
        const hasVerb = window.some((tok, i) => L.isVerbLike(tok, window, i));
        if (hasVerb) {
            matches.push({
                module: "wakyarore_multiple_dependent",
                category: "ထပ်ဆင့်ဝါကျကဏ္ဍ",
                type: "nested_adjective_clause",
                scope: "nesting",
                rule_ref: "§158",
                confidence: 0.85,
                note: "Adjective clause marker inside dependent clause segment — indicates nesting."
            });
        }
    }
    if (C.HOST_INDICATORS[text]) {
        const hostInfo = C.HOST_INDICATORS[text];
        const nestingInfo = C.NESTING_MATRIX[hostInfo.host];
        matches.push({
            module: "wakyarore_multiple_dependent",
            category: "ထပ်ဆင့်ဝါကျကဏ္ဍ",
            type: "host_clause_nesting_permitted",
            scope: "nesting",
            rule_ref: hostInfo.ref,
            confidence: 0.88,
            host_type: hostInfo.host,
            permitted_nested: nestingInfo ? nestingInfo.nested_permitted : [],
            note: `Host clause type ${hostInfo.host} (per ${hostInfo.ref}) may contain nested: ${nestingInfo ? nestingInfo.nested_permitted.join(", ") : "unknown"}.`
        });
    }
    return matches.length ? matches : null;
}
function extractMultipleDependentClauses(tokens) {
    const verbIndices = tokens.map((t, i) => L.isVerbLike(t, tokens, i) ? i : -1).filter(i => i !== -1);
    if (verbIndices.length < 3) return null;
    const dependentClauses = [];
    let lastBoundary = 0;
    for (let v = 0; v < verbIndices.length - 1; v++) {
        const verbIdx = verbIndices[v];
        const nextVerbIdx = verbIndices[v + 1];
        let connectorIdx = -1;
        for (let i = verbIdx + 1; i < nextVerbIdx; i++) {
            if (C.ALL_CONNECTORS.includes(tokens[i].text)) {
                connectorIdx = i;
                break;
            }
        }
        if (connectorIdx !== -1) {
            dependentClauses.push({
                start: lastBoundary,
                end: connectorIdx,
                tokens: tokens.slice(lastBoundary, connectorIdx + 1),
                connector: tokens[connectorIdx].text,
                verb_index: verbIdx
            });
            lastBoundary = connectorIdx + 1;
        }
    }
    return {
        dependent_clauses: dependentClauses,
        independent_clause: {
            start: lastBoundary,
            end: tokens.length - 1,
            tokens: tokens.slice(lastBoundary)
        }
    };
}
function validateNesting(hostType, nestedType) {
    const hostInfo = C.NESTING_MATRIX[hostType];
    if (!hostInfo) return { valid: false, reason: "unknown_host_type" };
    return {
        valid: hostInfo.nested_permitted.includes(nestedType),
        host_type: hostType,
        nested_type: nestedType,
        permitted: hostInfo.nested_permitted,
        refs: hostInfo.refs
    };
}
export {
    classify: classifyMultipleDependent,
    extractMultipleDependentClauses,
    validateNesting
};