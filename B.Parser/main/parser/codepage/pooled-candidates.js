import { loadMapJson } from "../core/json-map.js";
import { normaliseFontName } from "./names.js";

// Candidate evidence is intentionally separate from repair decisions. A key
// typed on a keyboard is not a PDF byte; neither kind identifies a keyboard.
let evidence = null;
let keystrokesByOutput = null;

function pool() {
  if (evidence === null) evidence = loadMapJson("pooled-keyboard-font-evidence.json");
  return evidence;
}

export function pdfRepairCandidates(font, bytes) {
  if (!font || typeof font.fontSha256 !== "string" || typeof font.toUnicodeSha256 !== "string"
      || typeof font.baseFont !== "string" || !Number.isInteger(font.firstChar)
      || !Number.isInteger(font.lastChar) || typeof font.hasEncoding !== "boolean") {
    throw new TypeError("Expected the embedded font, ToUnicode, code range and explicit encoding evidence");
  }
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    throw new TypeError("Expected non-empty raw PDF bytes");
  }
  const scope = pool().pdf_font_scopes.find(({ scope: s }) =>
    s.font_sha256 === font.fontSha256.toLowerCase()
    && s.tounicode_sha256 === font.toUnicodeSha256.toLowerCase()
    && s.base_font === normaliseFontName(font.baseFont)
    && s.first_char === font.firstChar && s.last_char === font.lastChar
    && s.encoding === "absent" && !font.hasEncoding);
  if (!scope) return { status: "unmatched-font-resource", candidates: [] };
  const hex = Buffer.from(bytes).toString("hex").toUpperCase();
  // Runs are exact, observed contexts; do not invent a universal byte grouping.
  const entry = (bytes.length === 1 ? scope.bytes[hex] : scope.runs[hex] || scope.unresolved_runs[hex]);
  if (!entry) return { status: "unmapped", candidates: [] };
  return {
    status: entry.status,
    candidates: [...entry.candidates],
    requiresContext: entry.requires_context,
    sourcePdfSha256: scope.source_pdf_sha256,
    ...(entry.source_page ? { sourcePage: entry.source_page } : {}),
    ...(entry.source_pages ? { sourcePages: [...entry.source_pages] } : {}),
    ...(entry.reason ? { reason: entry.reason } : {}),
  };
}

export function physicalKeyCandidates(keys) {
  if (typeof keys !== "string" || !keys.length) throw new TypeError("Expected a physical key sequence");
  // This lookup is for replay evidence, NEVER for decoding a PDF character code.
  const data = pool();
  const list = Object.hasOwn(data.physical_keystrokes, keys) ? data.physical_keystrokes[keys]
    : Object.hasOwn(data.parser_exact_full_line_replays, keys) ? data.parser_exact_full_line_replays[keys] : [];
  return structuredClone(list);
}

export function evidenceForOutput(text) {
  if (typeof text !== "string" || !text.length) throw new TypeError("Expected a non-empty output string");
  const data = pool();
  if (keystrokesByOutput === null) {
    keystrokesByOutput = new Map();
    for (const [keys, candidates] of Object.entries(data.physical_keystrokes)) {
      for (const candidate of candidates) {
        const list = keystrokesByOutput.get(candidate.output) || [];
        list.push({ keys, artifactObservations: candidate.artifact_observations,
          eventStatusCounts: candidate.event_status_counts });
        keystrokesByOutput.set(candidate.output, list);
      }
    }
  }
  return {
    pdfSlots: structuredClone(Object.hasOwn(data.by_output, text) ? data.by_output[text] : []),
    physicalKeys: structuredClone(keystrokesByOutput.get(text) || []),
    sampleReplays: structuredClone(Object.hasOwn(data.parser_exact_sample_replays_by_output, text)
      ? data.parser_exact_sample_replays_by_output[text] : []),
  };
}
