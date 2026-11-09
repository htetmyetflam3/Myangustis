/*
(new/ocr) The OCR side of the input stage, up to decryption.
Image pages have no decryption stage either; what the door needs
upfront is the same two things as the other lanes: a header verdict
and a pass. validateImage names the image from its first bytes;
passOcr hands the landed image file on to the OCR worker's lane.
*/

// --- function 1: validate ------------------------------------------------
// Image magics: PNG, JPEG, TIFF (both byte orders), WebP, GIF.
export function validateImage(head) {
  const b = Buffer.isBuffer(head) ? head : Buffer.from(head ?? []);
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 4 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a))) return "tiff";
  if (b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  if (b.length >= 6 && b.subarray(0, 6).toString("latin1").startsWith("GIF8")) return "gif";
  return null;
}

// --- function 2: pass ------------------------------------------------------
// The image already landed as a tmp file at the door; the OCR lane is
// handed the file, never a re-encoded copy (OCR never encodes).
export function passOcr(file, imageKind, size = null) {
  return { kind: "ocr", path: file, imageKind, ...(size !== null ? { size } : {}) };
}
