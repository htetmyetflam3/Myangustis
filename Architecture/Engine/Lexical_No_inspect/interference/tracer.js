/* --- /Engine/tracer.js --- */
export function formatTraceLine(lineResult) {
  const parts = [];
  for (const token of lineResult.tokens) {
    if (!token.isAmbiguous || !token.trace) continue;

    const { winner, candidates, fallback } = token.trace;
    const raw = token.rawPos.join('၊');

    if (!winner) {
      parts.push(
        `line:${lineResult.lineIndex} pos:${token.position} ` +
        `${token.joinedIds}{${raw}}→${fallback ?? token.finalPos} ` +
        `winner:FALLBACK(no_rules_fired)`
      );
      continue;
    }

    const cands = (candidates || [])
      .map(c => `${c.rule_ref ?? '?'}=${(c.confidence ?? 0).toFixed(2)}`)
      .join(',');

    parts.push(
      `line:${lineResult.lineIndex} pos:${token.position} ` +
      `${token.joinedIds}{${raw}}→${token.finalPos} ` +
      `winner:${winner.rule_ref ?? '?'}=${(winner.confidence ?? 0).toFixed(2)} ` +
      `js_ref:${winner.js_rule_ref ?? 'none'} ` +
      `type:${winner.type ?? '?'}|scope:${winner.scope ?? '?'} ` +
      `all:[${cands}]`
    );
  }
  return parts.join('\n');
}

export async function writeTrace(ruleGen, writer) {
  for await (const lineResult of ruleGen) {
    const line = formatTraceLine(lineResult);
    if (line) writer.writeLine([line]);
  }
  writer.flush();
}
