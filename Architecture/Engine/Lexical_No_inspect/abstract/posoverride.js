import path from 'path';
import { fileURLToPath } from 'url';
// eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
import fs from 'fs';

// eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
      const finalPos = token.rawPos[0];

      resolvedTokens.push({
        syllables:      token.syllables,
        ids:            token.ids,
        joinedIds:      token.ids.join(''),
        rawPos:         token.rawPos,
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
