import {
  createPdfParser as createPraserPdfParser,
  createDocxParser as createPraserDocxParser,
  closePraserManager,
  praserModuleAvailable,
} from './praser.js';

function isAnalysisIntent(intent) {
  return intent?.source === 'analysis'
    || intent?.source === 'analysis'
    || String(intent?.job || '').endsWith('-analysis');
}

function createAnalysisParser(label, factory) {
  const parser = factory();
  return {
    async parse(filePath, out = null, options = {}) {
      if (!isAnalysisIntent(options.intent)) {
        throw new Error(`${label} analysis parser refused a non-analysis upload`);
      }
      return parser.parse(filePath, out, options);
    },
    async bindIdentity(...args) {
      return parser.bindIdentity(...args);
    },
  };
}

export function createPdfAnalysisParser() {
  return createAnalysisParser('PDF', createPraserPdfParser);
}

export function createDocxAnalysisParser() {
  return createAnalysisParser('DOCX', createPraserDocxParser);
}

export { closePraserManager, praserModuleAvailable };
