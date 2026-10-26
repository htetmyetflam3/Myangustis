import { collector, collectFromText } from '../utilities/stream.js';
import { normalize, mapperStr } from '../map/loader.js';
import { InputFile } from '../../bridge/path.js';
/**
 * Generator: raw file → normalize → mapperStr (ASCII internal).
 * Yields mapped blocks ready for the segmentor.
 * NOT file writing — belongs to object (memory/mapping).
 */
export async function* readAndPrepare(inputFile = InputFile()) {
  for await (const block of collector(inputFile)) {
    const cleaned = normalize(block);
    const mapped = mapperStr(cleaned);
    yield mapped;
  }
}

/**
 * Generator: in-memory API text → normalize → mapperStr (ASCII internal).
 * Memory twin of readAndPrepare(): an identical mapped-block yield contract
 * for the segmentor, fed by collectFromText() instead of a file stream. The
 * HTTP path never touches fs before the engine's own output writer.
 */
export async function* readFromApi(sourceText) {
  for await (const block of collectFromText(sourceText)) {
    const cleaned = normalize(block);
    const mapped = mapperStr(cleaned);
    yield mapped;
  }
}