import { loadMapJson } from "../core/json-map.js";
import { createReplacementPipeline } from "./stream-replace.js";

function pyReplToJs(to) {
  
  return to.replace(/\$/g, "$$").replace(/\\(\d)/g, "$$$1");
}

function adaptSource(src) {
  
  if (src.endsWith("$") && !src.endsWith("\\$")) return `${src.slice(0, -1)}(?=\n?$)`;
  return src;
}

function compileLocal() {
  const rules = loadMapJson("zg2uni-rules.json");
  return rules.map((r) => [new RegExp(adaptSource(r.from), "u"), pyReplToJs(r.to)]);
}

let compiled = null;
let external = null;

function keepRule(rx, to, { preserveSpaces = false } = {}) {
  // Engine owns final spacing in the PDF pipeline.
  if (preserveSpaces && rx.source === " ့" && to === "့") return false;
  return true;
}

function applyLocal(text, options = {}) {
  for (const [rx, to] of compiled) {
    if (!keepRule(rx, to, options)) continue;
    text = text.replace(new RegExp(rx.source, "gu"), to);
  }
  return text;
}

async function load() {
  if (external !== null) return external;
  const mod = process.env.PRASER_RABBIT_MODULE;
  if (mod) {
    const imported = await import(mod);
    const fn = imported.zg2uni ?? imported.default?.zg2uni;
    if (typeof fn !== "function") {
      throw new TypeError(`${mod} does not export a zg2uni function`);
    }
    external = { external: true, fn };
    return external;
  }
  compiled = compiled ?? compileLocal();
  external = { external: false, fn: applyLocal };
  return external;
}

export class Rabbit {
  static zg2uni(text, options = {}) {
    if (external === null) {
      if (compiled === null) compiled = compileLocal();
      return applyLocal(text, options);
    }
    return external.fn(text, options);
  }
}

// Convert a whole page as a stream. All rules still see the original page in
// order; only the intermediate representations are kept in bounded chunks.
export function createRabbitStream(onChunk, options = {}) {
  if (external?.external) throw new Error("An external Rabbit module does not expose streaming conversion");
  if (compiled === null) compiled = compileLocal();
  const rules = compiled.filter(([rx, to]) => keepRule(rx, to, options));
  return createReplacementPipeline(rules, onChunk);
}

export async function initRabbit() {
  await load();
  return { external: external.external };
}


export function ruleCount() {
  if (compiled === null) compiled = compileLocal();
  return compiled.length;
}
