













import { prepareVectorLayout } from './resolve.js';






export async function classifyScraperSource(source, inputKind, log = () => {}) {
  if (String(inputKind ?? 'pdf').toLowerCase() === 'docx') {
    return { skip: false, reason: 'docx-not-a-legacy-pdf', encodingPath: null };
  }
  try {
    const layout = await prepareVectorLayout(source, log);
    if (!layout) {

      return { skip: false, reason: 'no-legacy-layout-fonts', encodingPath: null };
    }
    return {
      skip: true,
      reason: 'legacy-font-not-convertible',


      encodingPath: layout.name ?? 'vector',
    };
  } catch {
    return { skip: false, reason: 'classify-unavailable-fail-open', encodingPath: null };
  }
}
