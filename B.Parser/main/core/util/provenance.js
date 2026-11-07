






































import fs from "node:fs";
import path from "node:path";

const RULE = "\u2500".repeat(60);

const off = () => /^(0|false|no|off)$/iu.test(String(process.env.PRASER_REGISTER ?? ""));





export function startRecord(source = "") {
  return {
    source: source ? path.basename(source) : "",
    sourcePath: source || "",
    at: new Date().toISOString(),
    pages: null,
    detection: null,
    metadata: null,
    fonts: null,
    codepage: null,
    scan: null,
    output: null,
  };
}



export function note(record, facts) {
  if (!record || !facts) return record;
  for (const [key, value] of Object.entries(facts)) {
    if (value !== undefined) record[key] = value;
  }
  return record;
}



export function registerPath(fallback) {
  const chosen = String(process.env.PRASER_REGISTER ?? "").trim();
  return chosen && !off() ? chosen : fallback;
}





export function appendRecord(record, { file, log = () => {} } = {}) {
  if (!record || off() || !file) return null;
  const entry = [
    RULE,
    record.source || "(unnamed)",
    record.at,
    RULE,
    JSON.stringify(record, null, 2),
    "",
    "",
  ].join("\n");
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, entry, "utf8");
    return file;
  } catch (error) {
    log(`[-] Register not written (${error.message})`);
    return null;
  }
}
