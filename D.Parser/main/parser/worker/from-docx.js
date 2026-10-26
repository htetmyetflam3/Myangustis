import { runDocxWorker } from "./docx.mjs";
import { runDocxManualWorker } from "./docx-manual.mjs";

/* Image boxes are only touched when something is going to USE them:

     handling "null"   the OCR group will read them  -> extract + mark
     mode "manual"     they are re-embedded in the output -> extract + mark
     mode "default"    they are skipped entirely -> never extracted

   Anything else gets the plain text core. */
export async function runFromDocx(msg = {}) {
  const handling = String(msg.job || "extracting").toLowerCase();
  const mode = String(msg.method || "default").toLowerCase();
  const needsImages = handling === "null" || mode === "manual";
  return needsImages ? runDocxManualWorker(msg) : runDocxWorker(msg);
}
