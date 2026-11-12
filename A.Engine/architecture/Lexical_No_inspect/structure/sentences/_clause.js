import { W, L } from '../../abstract/kernel.js';
import C from './const.js';
["§139","§140","§141","§142","§143","§144","§145","§146","§147",
 "§148","§149","§150","§151","§152","§153","§154","§155","§156",
 "§157","§158","§159","§160","§161","§162"
].forEach(r => W.register("wakyarore_clause", r, 0.9));
function classifyClauseType(clauseTokens) {
    const lastToken = clauseTokens[clauseTokens.length - 1];
    const text = lastToken ? lastToken.text : "";
    if (C.NOUN_CLAUSE_PARTICLES.includes(text)) {
        return { type: "နာမ်ဝါကျကဏ္ဍ", role: "dependent", can_be: ["ကတ္တား", "ကံ"], ref: "§150" };
    }
    if (C.ADJECTIVE_CLAUSE_PARTICLES.includes(text)) {
        return { type: "နာမဝိသေသနဝါကျကဏ္ဍ", role: "dependent", modifies: "noun", ref: "§151" };
    }
    if (C.ADVERB_CLAUSE_PARTICLES.includes(text)) {
        return { type: "ကြိယာဝိသေသနဝါကျကဏ္ဍ", role: "dependent", modifies: "verb", ref: "§152" };
    }
    const hasVerb = clauseTokens.some(t => L.isVerbLike(t, clauseTokens, 0));
    const hasConnector = clauseTokens.some(t => C.ALL_CONNECTORS.includes(t.text));
    if (hasVerb && !hasConnector) {
        return { type: "အမှီခံဝါကျကဏ္ဍ", role: "independent", ref: "§141" };
    }
    return { type: "UNKNOWN", role: "unknown" };
}
function detectOmittedSubject(clauseTokens) {
    const hasExplicitSubject = clauseTokens.some((t, i) =>
        C.SUBJECT_MARKERS.includes(t.text) &&
        i > 0 &&
        L.isNounLike(clauseTokens[i - 1], clauseTokens, i - 1)
    );
    if (!hasExplicitSubject) {
        return { omitted: true, inferred_from: "context", note: "subject omitted, infer from context" };
    }
    return { omitted: false };
}
function detectClauseBoundaries(tokens) {
    const clauses = [];
    let current = { start: 0, tokens: [], type: null };
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (isClauseEndingParticle(t.text)) {
            current.tokens.push(t);
            current.end = i;
            current.type = classifyClauseType(current.tokens);
            clauses.push(current);
            current = { start: i + 1, tokens: [], type: null };
        } else {
            current.tokens.push(t);
        }
    }
    if (current.tokens.length > 0) {
        current.end = tokens.length - 1;
        current.type = classifyClauseType(current.tokens);
        clauses.push(current);
    }
    return clauses;
}
function isClauseEndingParticle(text) {
    return C.ALL_CLAUSE_BOUNDARY_MARKERS.includes(text);
}
function extractDependentClauses(tokens) {
    const allDepParticles = C.ALL_DEPENDENT_PARTICLES;
    const dependentClauses = [];
    for (let i = 0; i < tokens.length; i++) {
        if (allDepParticles.includes(tokens[i].text)) {
            let start = i;
            for (let j = i - 1; j >= 0; j--) {
                if (["။", "。", "\n"].includes(tokens[j].text)) { start = j + 1; break; }
                if (j === 0) { start = 0; break; }
            }
            dependentClauses.push({ start, end: i, tokens: tokens.slice(start, i + 1), ending_particle: tokens[i].text, type: "dependent" });
        }
    }
    return dependentClauses;
}
function extractIndependentClause(tokens) {
    const allIndParticles = C.ALL_INDEPENDENT_PARTICLES;
    let lastIndEnd = -1;
    for (let i = tokens.length - 1; i >= 0; i--) {
        if (allIndParticles.includes(tokens[i].text)) { lastIndEnd = i; break; }
    }
    if (lastIndEnd === -1) return null;
    let start = 0;
    for (let i = lastIndEnd - 1; i >= 0; i--) {
        if (["။", "。", "\n"].includes(tokens[i].text)) { start = i + 1; break; }
        if (C.ALL_CONNECTORS.includes(tokens[i].text)) {
            for (let j = i + 1; j < lastIndEnd; j++) {
                if (L.isNounLike(tokens[j], tokens, j) && tokens[j + 1] && C.SUBJECT_MARKERS.includes(tokens[j + 1].text)) {
                    start = j; break;
                }
            }
            if (start === 0 && i + 1 < tokens.length) start = i + 1;
            break;
        }
    }
    return { start, end: lastIndEnd, tokens: tokens.slice(start, lastIndEnd + 1), ending_particle: tokens[lastIndEnd].text, type: "independent" };
}
function analyzeClauses(tokens) {
    const clauses = detectClauseBoundaries(tokens);
    const analysis = { total_clauses: clauses.length, independent_clauses: [], dependent_clauses: [], nesting_level: 0, omissions: [] };
    for (const clause of clauses) {
        if (clause.type && clause.type.role === "independent") {
            analysis.independent_clauses.push(clause);
        } else {
            analysis.dependent_clauses.push(clause);
        }
        const omission = detectOmittedSubject(clause.tokens);
        if (omission.omitted) {
            analysis.omissions.push({ clause_index: clauses.indexOf(clause), ...omission });
        }
    }
    analysis.nesting_level = calculateNestingLevel(clauses);
    return analysis;
}
function calculateNestingLevel(clauses) {
    let maxLevel = 0;
    for (let i = 0; i < clauses.length; i++) {
        let level = 0;
        for (let j = 0; j < i; j++) {
            if (clauses[j].end > clauses[i].start) level++;
        }
        maxLevel = Math.max(maxLevel, level);
    }
    return maxLevel;
}
function analyzeCompoundSentence(tokens) {
    const result = { independent_clause: null, dependent_clauses: [], omissions: [], is_valid_compound: false };
    result.independent_clause = extractIndependentClause(tokens);
    for (let i = 0; i < tokens.length; i++) {
        if (C.ALL_CONNECTORS.includes(tokens[i].text)) {
            let depStart = i;
            for (let j = i - 1; j >= 0; j--) {
                if (["။", "。", "\n"].includes(tokens[j].text)) { depStart = j + 1; break; }
                if (j === 0) { depStart = 0; break; }
            }
            result.dependent_clauses.push({ start: depStart, end: i, tokens: tokens.slice(depStart, i + 1), ending_particle: tokens[i].text });
        }
    }
    result.is_valid_compound = result.independent_clause !== null && result.dependent_clauses.length > 0;
    if (result.independent_clause && result.dependent_clauses.length > 0) {
        const indSubject = findSubject(result.independent_clause.tokens);
        const depSubject = findSubject(result.dependent_clauses[0].tokens);
        if (indSubject && depSubject && indSubject.text === depSubject.text) {
            result.omissions.push({ type: "shared_subject", rule: "§191-က", subject: indSubject.text });
        }
    }
    return result;
}
function findSubject(clauseTokens) {
    for (let i = 0; i < clauseTokens.length - 1; i++) {
        if (L.isNounLike(clauseTokens[i], clauseTokens, i) && C.SUBJECT_MARKERS.includes(clauseTokens[i + 1].text)) {
            return { text: clauseTokens[i].text, index: i };
        }
    }
    return null;
}
function classifyClause(tokens, index, context) {
    const t = tokens[index];
    if (!t) return null;
    const text = t.text;
    const matches = [];
    const prev = tokens[index - 1];
    const next = tokens[index + 1];
    if (L.isNounLike(t, tokens, index) && next && C.SUBJECT_MARKERS.includes(next.text)) {
        matches.push({
            module: "wakyarore_clause", category: "ဝါကျကဏ္ဍ", type: "clause_start",
            scope: "clause_boundary", rule_ref: "§139", confidence: 0.85,
            note: `Clause starts: ${text} as potential subject.`
        });
    }
    const allDepParticles = C.ALL_DEPENDENT_PARTICLES;
    if (allDepParticles.includes(text)) {
        let connectorType = null, connectorInfo = null;
        if (C.DEPENDENT_CONNECTORS.wibat.particles[text]) { 
            connectorType = "ဝိဘတ်"; 
            connectorInfo = C.DEPENDENT_CONNECTORS.wibat.particles[text]; 
        }
        else if (C.DEPENDENT_CONNECTORS.pyitsi.particles[text]) { 
            connectorType = "ပစ္စည်း"; 
            connectorInfo = C.DEPENDENT_CONNECTORS.pyitsi.particles[text]; 
        }
        else if (C.DEPENDENT_CONNECTORS.thanbanda.particles[text]) { 
            connectorType = "သမ္ဗန္ဓ"; 
            connectorInfo = C.DEPENDENT_CONNECTORS.thanbanda.particles[text]; 
        }
        if (connectorInfo) {
            matches.push({
                module: "wakyarore_clause", category: "ဝါကျကဏ္ဍ", type: "dependent_clause",
                subtype: connectorInfo.role, scope: "clause_boundary", connector_type: connectorType,
                rule_ref: "§140", confidence: 0.92, particle: text, function: connectorInfo.function,
                note: `Dependent clause with ${connectorType} ${text}: ${connectorInfo.function}`
            });
        }
    }
    const allIndParticles = C.ALL_INDEPENDENT_PARTICLES;
    if (allIndParticles.includes(text)) {
        const isSentenceFinal = !next || ["။", "。", "\n"].includes(next.text);
        matches.push({
            module: "wakyarore_clause", category: "ဝါကျကဏ္ဍ", type: "independent_clause",
            scope: isSentenceFinal ? "sentence_final" : "clause_internal", rule_ref: "§141",
            confidence: isSentenceFinal ? 0.95 : 0.8, particle: text, is_sentence_final: isSentenceFinal,
            note: `Independent clause ending: ${text}${isSentenceFinal ? " at sentence end" : ""}.`
        });
    }
    if (L.isVerbLike(t, tokens, index)) {
        const hasExplicitSubject = tokens.slice(Math.max(0, index - 5), index).some(
            (tok, i) => C.SUBJECT_MARKERS.includes(tok.text) &&
                        index - 5 + i > 0 &&
                        L.isNounLike(tokens[index - 5 + i - 1], tokens, index - 5 + i - 1)
        );
        if (!hasExplicitSubject) {
            matches.push({
                module: "wakyarore_clause", category: "ဝါကျကဏ္ဍ", type: "omitted_subject",
                scope: "omission", rule_ref: "§143", confidence: 0.7,
                note: "Subject may be omitted in this clause (context-dependent)."
            });
        }
    }
    if (L.isNounLike(t, tokens, index) && next && C.SUBJECT_MARKERS.includes(next.text)) {
        for (let i = index + 2; i < tokens.length; i++) {
            if (tokens[i].text === text && tokens[i + 1] && C.SUBJECT_MARKERS.includes(tokens[i + 1].text)) {
                matches.push({
                    module: "wakyarore_clause", category: "ဝါကျကဏ္ဍ", type: "shared_subject",
                    scope: "omission", rule_ref: "§143", confidence: 0.85,
                    subject: text, duplicate_index: i,
                    note: `Shared subject ${text} appears twice — second occurrence can be omitted per §191-က.`
                });
                break;
            }
        }
    }
    if (text === "ကို" && prev && L.isNounLike(prev, tokens, index - 1)) {
        for (let i = index + 1; i < tokens.length; i++) {
            if (tokens[i].text === prev.text && tokens[i + 1] && C.SUBJECT_MARKERS.includes(tokens[i + 1].text)) {
                matches.push({
                    module: "wakyarore_clause", category: "ဝါကျကဏ္ဍ", type: "object_becomes_subject",
                    scope: "omission", rule_ref: "§143", confidence: 0.8,
                    object: prev.text, subject_index: i,
                    note: `Object ${prev.text} becomes subject of independent clause — either can be omitted per §191-ခ.`
                });
                break;
            }
        }
    }
    return matches.length ? matches : null;
}
export {
    classify: classifyClause,
    analyzeClauses,
    analyzeCompoundSentence,
    detectClauseBoundaries,
    extractDependentClauses,
    extractIndependentClause,
    classifyClauseType,
    detectOmittedSubject,
    calculateNestingLevel,
    findSubject
};