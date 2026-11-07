// $ — BindParser: single parser API (engine bridge pattern)
// Accepts ONLY: { object, method, caller?, identity? }
// No file paths, no temp files, no caller-specific logic.
// Object comes from caller's side (stream reader or direct object).
// Method: "extracting" | "ocr" | "null"
export function BindParser(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new TypeError("BindParser: a request object is required");
  }
  if (!request.object || typeof request.object !== "object") {
    throw new TypeError("BindParser: object is required");
  }
  if ("inPath" in request || "outPath" in request || "work" in request) {
    throw new TypeError("BindParser: supply object, not file paths or work dirs");
  }
  const m = String(request.method ?? "").toLowerCase();
  if (m !== "extracting" && m !== "ocr" && m !== "null") {
    throw new TypeError(`BindParser: unsupported method "${m}" (use extracting/ocr/null)`);
  }
  const caller = request.caller ?? "local";
  if (caller !== "site" && caller !== "local") {
    throw new TypeError(`BindParser: unsupported caller "${caller}" (use site/local)`);
  }
  return { object: request.object, method: m, caller, identity: request.identity };
}
