// B.Parser public front door — the single integration point.
// Sketch layout (see SEPARATION.md): core / host / extend / integration.
// This file only wires the parts together; it contains no parsing logic.
//
//   core/        pure parsing logic (pdf/docx/text/codepage/io/util/ocr/manager)
//   host/        site host, unchanged (Backend + Frontend)
//   extend/      extended functions intended for other services (pipeline, classify, ...)
//   integration/ caller glue: host/ (site) and services/ (scraper, socket, local, ...)
//
// NOTE (sketch): the old core/entry.js also re-exported `closeParserManager`
// and `parserModuleAvailable` from init/init.js, but those symbols do not
// exist there — the broken re-exports were dropped, no logic was deleted.
export {
  createConverterParser,
  createPdfParser,
  createDocxParser,
} from "./integration/host/init.js";
export { SiteDispatch } from "./integration/host/dispatch.js";
export { LocalDispatchStream } from "./integration/services/local/stream.js";
export { Manager } from "./core/manager/index.js";
