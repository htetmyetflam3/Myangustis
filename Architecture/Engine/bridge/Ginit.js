import { mergedIds } from '../MonoSyllabism/utilities/formatter.js';

/* ═══════════════════════════════════════════════════════════════
   PASS-THROUGH KERNEL  (POS overriding removed)
   Reads tagger output and emits it unchanged.  finalPos is set
   to rawPos[0] so downstream (bridge.js) shape stays stable.
   ═══════════════════════════════════════════════════════════════ */

export async function* runRuleEngine(taggedLines, hash) {
  let lineIndex = 0;

  for await (const lineResult of taggedLines) {
    const resolvedTokens = [];
    const context = {
      hash,
      lineIndex: lineIndex++,
      tokenCount: lineResult.tokens.length,
      resolvedTokens,
      isEos: lineResult.isEos ?? false,
    };

    for (let i = 0; i < lineResult.tokens.length; i++) {
      const token = lineResult.tokens[i];
      const isSingleSyllable = token.ids.length === 1;
      const isAmbiguous      = token.rawPos.length > 1;

      /*  No classifier call, no override.  */
      // Owner kernel rule: a word carrying exactly the two tags n AND v (a
      // noun/verb dual with no other candidate) is collapsed to rbvn. The
      // rawPos array itself is replaced, since the raw_pos writer renders it.
      const isNounVerbOnly = token.rawPos.length === 2
        && token.rawPos.includes('n')
        && token.rawPos.includes('v');
      const finalRawPos = isNounVerbOnly ? ['rbvn'] : token.rawPos;
      const finalPos    = isNounVerbOnly ? 'rbvn'  : token.rawPos[0];

      resolvedTokens.push({
        syllables:      token.syllables,
        ids:            token.ids,
        joinedIds:      mergedIds(token.ids),
        rawPos:         finalRawPos,
        finalPos,                     // ← kept for bridge compatibility
        isSingleSyllable,
        isAmbiguous,
        position:       i,
        matches:        [],           // ← empty, no classifiers ran
      });
    }

    yield {
      tokens:   resolvedTokens,
      isEos:    lineResult.isEos ?? false,
      lineIndex: context.lineIndex,
    };
  }
}
