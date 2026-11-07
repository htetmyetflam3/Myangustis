import { W, L } from '../../abstract/kernel.js';
import C from '../sentences/const.js';
["§149"].forEach(r => W.register("wakyarore_dependent_types", r, 0.9));
function classifyDependentType(tokens, index, context) {
    const t = tokens[index];
    if (!t) return null;
    const text = t.text;
    const matches = [];
    if (C.DEPENDENT_TYPE_MAP[text]) {
        const info = C.DEPENDENT_TYPE_MAP[text];
        matches.push({
            module: "wakyarore_dependent_types",
            category: "အမှီဝါကျကဏ္ဍအမျိုးအစား",
            type: info.type,
            subtype: info.subtype || null,
            scope: "clause_type",
            rule_ref: info.ref,
            confidence: 0.92,
            particle: text,
            role: info.role,
            note: `Dependent clause type: ${info.type}${info.subtype ? ` (${info.subtype})` : ""} with ${text}.`
        });
        if (context && context.hub) {
            context.hub.postConstraint(index, "clause_type", {
                type: info.type,
                subtype: info.subtype || null,
                particle: text,
                role: info.role,
                rule_ref: info.ref
            });
        }
    }
    return matches.length ? matches : null;
}
export {
    classify: classifyDependentType,
    DEPENDENT_CLAUSE_TYPES: C.DEPENDENT_CLAUSE_TYPES
};