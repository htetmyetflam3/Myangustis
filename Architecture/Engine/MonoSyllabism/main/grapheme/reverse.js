








export function walkReverse(reverseTree, syllable, rootTok) {
  const body = syllable.slice(1);
  if (!body) {
    return { action: 'continue', id: null };
  }

  const reversedBody = Array.from(body).reverse().join('');
  const stepKey = `St-${reversedBody.length}`;

  const stepData = reverseTree[stepKey];
  if (!stepData) {
    return { action: 'continue', id: null };
  }

  const entry = stepData[reversedBody];
  if (!entry) {
    return { action: 'continue', id: null };
  }

  for (const [suffixId, roots] of Object.entries(entry)) {
    if (roots.includes(rootTok)) {
      return { action: 'continue', id: `${rootTok}${suffixId}` };
    }
  }

  return { action: 'continue', id: null };
}
