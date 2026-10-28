













import path from 'node:path';
import { BindEngine } from '../../Engine/bridge/bind-engine.js';




const RESULT_EXTENSION = 'txt';
const RESULT_MIME = 'text/plain';

function safeStem(filename) {

  const stem = path.basename(String(filename ?? 'answer')).replace(/\.[^.]*$/, '');
  const cleaned = stem.replace(/[^A-Za-z0-9._ -]/g, '_').replace(/^\.+/, '').slice(0, 200) || 'answer';
  return cleaned;
}







export async function runEngineJob({ record, sourceText }) {
  if (typeof sourceText !== 'string' || sourceText.length === 0) {
    throw new Error('runEngineJob: sourceText string is required');
  }




  const result = await BindEngine('site', { hash: record.formId, sourceText });
  if (!result.rawPosPath) {
    throw new Error('engine path-A returned no rawPosPath output');
  }
  const outputText = result.rawPos;

  const bytes = Buffer.from(outputText, 'utf8');
  return {
    filename: `${safeStem(record.filename)}.${RESULT_EXTENSION}`,
    extension: RESULT_EXTENSION,
    mime: RESULT_MIME,
    bytes,
  };
}
