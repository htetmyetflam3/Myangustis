import { W, L } from '../../abstract/kernel.js';
import C from '../sentences/const.js';
["§163"].forEach(r => W.register("wakyarore_multiple_dependent_chars", r, 0.9));
function validateMultipleDependentChars(tokens, splitResult, context) {
    const { dependent_clauses, independent_clause } = splitResult;
    const checks = [];
    const allBefore = dependent_clauses.every(dc => dc.end < independent_clause.start);
    checks.push({
        char: "(က)",
        name: "all_dependents_before_independent",
        passed: allBefore,
        detail: allBefore ? "all_dependents_precede_independent" : "some_dependent_after_independent"
    });
    const depBetween = dependent_clauses.some(dc =>
        dc.start > 0 && dc.end < tokens.length - 1 &&
        dc.start > independent_clause.start && dc.end < independent_clause.end
    );
    checks.push({
        char: "(ခ)",
        name: "dependents_between_subject_verb",
        passed: true, 
        detail: { exists: depBetween, note: "dependent_clauses_may_appear_between_subject_and_verb" }
    });
    const directCount = dependent_clauses.filter(dc => dc.end < independent_clause.start).length;
    const nestedDetected = dependent_clauses.some(dc =>
        dc.tokens.some((t, i) =>
            C.ADJECTIVE_CLAUSE_PARTICLES.includes(t.text) &&
            dc.tokens.slice(0, i).some((t2, j) => L.isVerbLike(t2, dc.tokens, j))
        )
    );
    checks.push({
        char: "(ဂ)",
        name: "direct_and_nested_dependents_coexist",
        passed: true,
        detail: {
            direct_dependents: directCount,
            nested_detected: nestedDetected,
            relation_types: nestedDetected ? ["direct", "nested"] : ["direct"]
        }
    });
    const omissionChecks = dependent_clauses.map((dc, idx) => {
        const hasExplicitSubject = dc.tokens.some((t, i) =>
            i > 0 && L.isNounLike(dc.tokens[i - 1], dc.tokens, i - 1) &&
            C.SUBJECT_MARKERS.includes(t.text)
        );
        return { clause_index: idx, omitted: !hasExplicitSubject };
    });
    checks.push({
        char: "(ဃ)",
        name: "subject_omission_at_clause_level",
        passed: true,
        detail: omissionChecks
    });
    const nounHost = dependent_clauses.some(dc =>
        C.NOUN_CLAUSE_PARTICLES.includes(dc.tokens[dc.tokens.length - 1].text)
    );
    const adverbHost = dependent_clauses.some(dc =>
        C.ADVERB_HOST_PARTICLES.includes(dc.tokens[dc.tokens.length - 1].text)
    );
    checks.push({
        char: "(င)",
        name: "noun_clause_nesting_permitted",
        passed: true,
        detail: { noun_host_present: nounHost, cross_ref: "§160" }
    });
    checks.push({
        char: "(စ)",
        name: "adverb_clause_nesting_permitted",
        passed: true,
        detail: { adverb_host_present: adverbHost, cross_ref: "§162" }
    });
    const violations = checks.filter(c => !c.passed);
    return {
        valid: violations.length === 0,
        rule_ref: "§163",
        checks,
        violations
    };
}
function classifyMultipleDependentChars(tokens, index, context) {
    const t = tokens[index];
    if (!t) return null;
    const text = t.text;
    const matches = [];
    if (L.isVerbLike(t, tokens, index)) {
        const allVerbs = tokens.map((tok, i) => L.isVerbLike(tok, tokens, i) ? i : -1).filter(i => i !== -1);
        if (allVerbs.length >= 3) {
            const verbPos = allVerbs.indexOf(index);
            if (verbPos > 0 && verbPos < allVerbs.length - 1) {
                matches.push({
                    module: "wakyarore_multiple_dependent_chars",
                    category: "ဝါကျကဏ္ဍသဘောလက္ခဏာ",
                    type: "middle_dependent_verb",
                    scope: "meta",
                    rule_ref: "§163(ဂ)",
                    confidence: 0.88,
                    verb_position: verbPos,
                    total_verbs: allVerbs.length,
                    note: `Verb ${text} at position ${verbPos + 1}/${allVerbs.length} — middle dependent clause verb (may be direct or nested).`
                });
            }
        }
    }
    if (C.NOUN_CLAUSE_PARTICLES.includes(text)) {
        matches.push({
            module: "wakyarore_multiple_dependent_chars",
            category: "ဝါကျကဏ္ဍသဘောလက္ခဏာ",
            type: "noun_host_permits_nesting",
            scope: "nesting",
            rule_ref: "§163(င)",
            confidence: 0.9,
            host_type: "နာမ်ဝါကျကဏ္ဍ",
            permitted_nested: C.NESTING_MATRIX["နာမ်ဝါကျကဏ္ဍ"].nested_permitted,
            cross_ref: "§160",
            note: `Noun clause host (particle ${text}) permits nested adjective/adverb/noun clauses per §160.`
        });
    }
    if (C.ADVERB_HOST_PARTICLES.includes(text)) {
        matches.push({
            module: "wakyarore_multiple_dependent_chars",
            category: "ဝါကျကဏ္ဍသဘောလက္ခဏာ",
            type: "adverb_host_permits_nesting",
            scope: "nesting",
            rule_ref: "§163(စ)",
            confidence: 0.9,
            host_type: "ကြိယာဝိသေသနဝါကျကဏ္ဍ",
            permitted_nested: C.NESTING_MATRIX["ကြိယာဝိသေသနဝါကျကဏ္ဍ"].nested_permitted,
            cross_ref: "§162",
            note: `Adverb clause host (particle ${text}) permits nested noun/adjective/adverb clauses per §162.`
        });
    }
    if (L.isVerbLike(t, tokens, index)) {
        const window = tokens.slice(Math.max(0, index - 5), index);
        const explicitSubject = window.some((tok, i) =>
            i > 0 && L.isNounLike(window[i - 1], window, i - 1) &&
            C.SUBJECT_MARKERS.includes(tok.text)
        );
        if (!explicitSubject) {
            matches.push({
                module: "wakyarore_multiple_dependent_chars",
                category: "ဝါကျကဏ္ဍသဘောလက္ခဏာ",
                type: "subject_omission_possible",
                scope: "omission",
                rule_ref: "§163(ဃ)",
                confidence: 0.65,
                note: "No explicit subject before verb in this clause segment — omission permitted per §163(ဃ)."
            });
        }
    }
    return matches.length ? matches : null;
}
export {
    classify: classifyMultipleDependentChars,
    validateMultipleDependentChars,
    MULTIPLE_DEPENDENT_CHARACTERISTICS: C.MULTIPLE_DEPENDENT_CHARACTERISTICS
};