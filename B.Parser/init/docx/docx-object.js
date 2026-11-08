/*
(init/docx - docx-object) Pre-determination and pass-through for DOCX, for the door.
This module owns the two DOCX decisions at the door: kindFromHead reads the first bytes and names what arrived ("%PDF-" a PDF, PK a zip container - a DOCX, anything else other), and passObject hands a DOCX on as the object itself: its runner reads the whole archive in memory anyway (the zip directory sits at the end), so landing it in a tmp file would only add a write+read round trip for nothing.
*/
import { collectBytes } from "../file/collect-whole.js";

// Pre-determination from the first bytes - the same magics the
// converter worker sniffs when it chooses its runner.
export function kindFromHead(head) {
  if (head.length >= 5 && head.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (head.length >= 2 && head[0] === 0x50 && head[1] === 0x4b) return "docx";
  return "other";
}

// Pass the DOCX on as the object: { bytes, size }, plus the trigger's
// filename when it named one.
export async function passObject(source, filename = null) {
  const bytes = await collectBytes(source);
  return { bytes, size: bytes.length, ...(filename ? { filename } : {}) };
}
