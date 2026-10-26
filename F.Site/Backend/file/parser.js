import fs from 'fs/promises';
export function createParser({
  saveOriginal,
  pdfParser,
  docxParser,
  analysisPdfParser = null,
  analysisDocxParser = null,
} = {}) {
  
  return async function parseFile(file, out = null, options = {}) {
    // When the caller already saved the original (the upload endpoint saves
    // and enqueues BEFORE responding, then parses in the background), the
    // pre-saved path is used and onSaved is not fired again.
    const savedPath = options.savedPath ?? (await saveOriginal(file));
    if (!options.savedPath && options.onSaved) await options.onSaved(savedPath);
    const ext = file.originalname.split('.').pop().toLowerCase();
    let textContent;
    const intent = options.intent || {};
    const analysis = intent.source === 'analysis';
    if (ext === 'txt') {
      textContent = await fs.readFile(savedPath, 'utf8');
    } else if (ext === 'pdf') {
      const selectedPdfParser = analysis && analysisPdfParser ? analysisPdfParser : pdfParser;
      if (!selectedPdfParser) throw new Error('PDF parser not configured');
      textContent = await selectedPdfParser(savedPath, out, options);
    } else if (ext === 'docx') {
      const selectedDocxParser = analysis && analysisDocxParser ? analysisDocxParser : docxParser;
      if (!selectedDocxParser) throw new Error('DOCX parser not configured');
      textContent = await selectedDocxParser(savedPath, out, options);
    } else {
      throw new Error(`Unsupported file type: ${ext}`);
    }
    return { textContent, savedPath, originalName: file.originalname };
  };
}