import { runDocxWorker } from "./docx.js";
import { runDocxManualWorker } from "./docx-manual.js";








export async function runFromDocx(msg = {}) {
  const handling = String(msg.job || "extracting").toLowerCase();
  const mode = String(msg.method || "default").toLowerCase();
  const needsImages = handling === "null" || mode === "manual";
  return needsImages ? runDocxManualWorker(msg) : runDocxWorker(msg);
}
