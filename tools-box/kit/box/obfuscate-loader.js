// The bootstrap rides obfuscated but not encrypted; it must run when extracted.
// The payload key is stored separately, not embedded or protected here.
// Preserve the bootModules export expected by the interpreter.
import JavaScriptObfuscator from "javascript-obfuscator";

export function obfuscateLoader(src) {
  return JavaScriptObfuscator.obfuscate(src, {
    compact: true,
    target: "browser",
    identifierNamesGenerator: "hexadecimal",
    renameGlobals: false,
    stringArray: true,
    stringArrayEncoding: ["base64"],
    stringArrayThreshold: 0.95,
    splitStrings: false,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    selfDefending: false,
    debugProtection: false,
  }).getObfuscatedCode();
}
