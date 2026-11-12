import { collector, collectFromText } from '../utilities/stream.js';
import { normalize, mapperStr } from '../map/loader.js';
import { InputFile } from '../../_path.js';





export async function* readAndPrepare(inputFile = InputFile()) {
  for await (const block of collector(inputFile)) {
    const cleaned = normalize(block);
    const mapped = mapperStr(cleaned);
    yield mapped;
  }
}







export async function* readFromApi(sourceText) {
  for await (const block of collectFromText(sourceText)) {
    const cleaned = normalize(block);
    const mapped = mapperStr(cleaned);
    yield mapped;
  }
}