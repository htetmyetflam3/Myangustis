import { W, L } from '../../abstract/kernel.js';
import C from './const.js';
["§189","§190","§191","§192","§193"].forEach(r => W.register("wakyarore_compound", r, 0.88));
function classifyCompound(tokens, index, context) {
    const t = tokens[index];
    if (!t) return null;
    const text = t.text;
    const matches = [];
    const prev = tokens[index - 1];
    const next = tokens[index + 1];
    if (C.WIBAT_CONNECTORS.includes(text)) {
        const connectorType = detectWibatConnector(tokens, index);
        if (connectorType) {
            matches.push({
                module: "wakyarore_compound",
                category: "ဝါကျရော",
                type: "ဝိဘတ်ဆက်ခြင်း",
                subtype: connectorType.subtype,
                scope: "compound_connector",
                role: connectorType.role,
                rule_ref: "§189-က",
                confidence: 0.9,
                particle: text,
                note: `ဝိဘတ် ${text}: ${connectorType.description}`
            });
            if (context && context.hub) {
                context.hub.postConstraint(index, "compound_connector", {
                    connector_type: "wibat",
                    particle: text,
                    role: connectorType.role,
                    rule_ref: "§189-က"
                });
            }
        }
    }
    if (C.PYITSI_CONNECTORS.includes(text)) {
        const connectorType = detectPyitsiConnector(tokens, index);
        if (connectorType) {
            matches.push({
                module: "wakyarore_compound",
                category: "ဝါကျရော",
                type: "ပစ္စည်းဆက်ခြင်း",
                subtype: connectorType.subtype,
                scope: "compound_connector",
                role: connectorType.role,
                rule_ref: "§189-ခ",
                confidence: 0.9,
                particle: text,
                note: `ပစ္စည်း ${text}: ${connectorType.description}`
            });
            if (context && context.hub) {
                context.hub.postConstraint(index, "compound_connector", {
                    connector_type: "pyitsi",
                    particle: text,
                    role: connectorType.role,
                    rule_ref: "§189-ခ"
                });
            }
        }
    }
    if (C.THANBANDA_CONNECTORS.includes(text)) {
        const connectorType = detectThanbandaConnector(tokens, index);
        if (connectorType) {
            matches.push({
                module: "wakyarore_compound",
                category: "ဝါကျရော",
                type: "သမ္ဗန္ဓဆက်ခြင်း",
                subtype: connectorType.subtype,
                scope: "compound_connector",
                role: connectorType.role,
                rule_ref: "§189-ဂ",
                confidence: 0.9,
                particle: text,
                note: `သမ္ဗန္ဓ ${text}: ${connectorType.description}`
            });
            if (context && context.hub) {
                context.hub.postConstraint(index, "compound_connector", {
                    connector_type: "thanbanda",
                    particle: text,
                    role: connectorType.role,
                    rule_ref: "§189-ဂ"
                });
            }
        }
    }
    if (text === "၍" || text === "ကာ") {
        const extendedType = classifyExtendedCompound(tokens, index);
        if (extendedType) {
            matches.push({
                module: "wakyarore_compound",
                category: "ဝါကျရော",
                type: extendedType.type,
                scope: "extended_compound",
                rule_ref: "§190",
                confidence: 0.85,
                note: extendedType.note
            });
        }
    }
    if (detectOmissionContext(tokens, index)) {
        matches.push({
            module: "wakyarore_compound",
            category: "ဝါကျရော",
            type: "ပုဒ်မြှုပ်ခြင်း",
            scope: "omission",
            rule_ref: "§191",
            confidence: 0.8,
            note: "Omission of shared constituents in compound sentence."
        });
    }
    return matches.length ? matches : null;
}
function detectWibatConnector(tokens, idx) {
    const t = tokens[idx];
    const prev = tokens[idx - 1];
    const next = tokens[idx + 1];
    if (!prev || !next) return null;
    if (t.text === "ကို") {
        if (prev && (prev.text === "သည်" || prev.text === "၏" || prev.text.endsWith("သည်"))) {
            return { subtype: "ကံဝိဘတ်", role: "object_nominalizer", description: "Nominalizes preceding clause as object of following clause" };
        }
    }
    if (t.text === "မှာ") {
        if (next && (L.isVerbLike(next, tokens, idx + 1) || L.isAdjLike(next, tokens, idx + 1))) {
            return { subtype: "ကတ္တားဝိဘတ်", role: "subject_nominalizer", description: "Nominalizes preceding clause as subject" };
        }
    }
    if (t.text === "က") {
        if (next && L.isVerbLike(next, tokens, idx + 1)) {
            return { subtype: "ကတ္တားဝိဘတ်", role: "subject_nominalizer", description: "Nominalizes preceding clause as subject" };
        }
    }
    return null;
}
function detectPyitsiConnector(tokens, idx) {
    const t = tokens[idx];
    const prev = tokens[idx - 1];
    const next = tokens[idx + 1];
    if (!prev || !next) return null;
    if (t.text === "ဟု") {
        const speechVerbs = ["ပြောသည်", "ဆိုသည်", "လျှောက်သည်", "ဖြေသည်", "မေးသည်"];
        if (next && speechVerbs.some(sv => next.text.includes(sv.replace("သည်", "")))) {
            return { subtype: "ဟု-ပစ္စည်း", role: "quotative", description: "Direct/indirect speech marker" };
        }
    }
    if (t.text === "သော") {
        if (next && L.isNounLike(next, tokens, idx + 1)) {
            return { subtype: "သော-ပစ္စည်း", role: "adjectivalizer", description: "Turns clause into adjective modifying following noun" };
        }
    }
    return null;
}
function detectThanbandaConnector(tokens, idx) {
    const t = tokens[idx];
    const text = t.text;
    const connectorMap = C.THANBANDA_CONNECTOR_MAP || {};
    return connectorMap[text] || null;
}
function classifyExtendedCompound(tokens, idx) {
    const t = tokens[idx];
    const next = tokens[idx + 1];
    if (t.text === "၍") {
        const hasMoreVerbsAhead = tokens.slice(idx + 1, idx + 5).some((tok, i) => 
            L.isVerbLike(tok, tokens, idx + 1 + i)
        );
        if (hasMoreVerbsAhead) {
            return { 
                type: "extended_compound",
                note: "Multi-clause compound: more than 2 clauses chained with နှင့်/၍" 
            };
        }
    }
    return null;
}
function detectOmissionContext(tokens, idx) {
    const window = tokens.slice(Math.max(0, idx - 3), Math.min(tokens.length, idx + 4));
    const hasConnector = window.some(t => 
        C.OMISSION_TRIGGER_CONNECTORS.includes(t.text)
    );
    const verbCount = window.filter(t => L.isVerbLike(t, tokens, idx)).length;
    const subjectMarkers = window.filter(t => C.SUBJECT_MARKERS.includes(t.text)).length;
    return hasConnector && verbCount >= 2 && subjectMarkers < verbCount;
}
function findClauseBoundaries(tokens) {
    const boundaries = [];
    let clauseStart = 0;
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (isClauseEnding(t, tokens, i)) {
            boundaries.push({ start: clauseStart, end: i, type: "clause" });
            clauseStart = i + 1;
        }
    }
    if (clauseStart < tokens.length) {
        boundaries.push({ start: clauseStart, end: tokens.length - 1, type: "clause" });
    }
    return boundaries;
}
function isClauseEnding(token, tokens, idx) {
    const text = token.text;
    if (C.SENTENCE_FINAL_PARTICLES.includes(text)) {
        return true;
    }
    if (C.ALL_CONNECTORS.includes(text)) {
        const next = tokens[idx + 1];
        if (next && (L.isNounLike(next, tokens, idx + 1) || L.isPronoun(next.text))) {
            return true;
        }
    }
    return false;
}
export {
    classify: classifyCompound,
    findClauseBoundaries,
    isClauseEnding
};