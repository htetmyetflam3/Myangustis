// $ — Single parser API
// Accepts ONLY: { object, method }
// No file paths, no temp files, no caller-specific logic.
// Object comes from caller's side (stream reader or direct object).
// Method: "extracting" | "ocr" | "null"
export function singleApi({ object, method }) {
  if (!object || typeof object !== "object") {
    throw new TypeError("singleApi: object is required");
  }
  const m = String(method ?? "").toLowerCase();
  if (m !== "extracting" && m !== "ocr" && m !== "null") {
    throw new TypeError(`singleApi: unsupported method "${m}" (use extracting/ocr/null)`);
  }
  // Caller-side object is already resolved; dispatch to worker lane happens here.
  return { object, method: m };
}
