/*
(init/docx - docx-object) Pass-through for DOCX, for the door.
passObject hands a DOCX on as the object itself: its runner reads the whole archive in memory anyway (the zip directory sits at the end), so landing it in a tmp file would only add a write+read round trip for nothing. The file-header verdict it is routed by (kindFromHead) lives with the read modules now (core/io/zip.js); it is re-exported here for old importers.
*/
import { collectBytes } from "../file/collect-whole.js";

export { kindFromHead } from "../../core/io/zip.js";

// Pass the DOCX on as the object: { bytes, size }, plus the trigger's
// filename when it named one.
export async function passObject(source, filename = null) {
  const bytes = await collectBytes(source);
  return { bytes, size: bytes.length, ...(filename ? { filename } : {}) };
}
