import fs from "node:fs";
import path from "node:path";
import { MAP_DIR } from "../core/paths.mjs";

const RULES_PATH = path.join(MAP_DIR, "zg2uni-rules.json");

function pyReplToJs(to) {
  
  return to.replace(/\$/g, "$$").replace(/\\(\d)/g, "$$$1");
}

function adaptSource(src) {
  
  if (src.endsWith("$") && !src.endsWith("\\$")) return `${src.slice(0, -1)}(?=\n?$)`;
  return src;
}

function compileLocal() {
  const rules = JSON.parse(fs.readFileSync(RULES_PATH, "utf8"));
  return rules.map((r) => [new RegExp(adaptSource(r.from), "u"), pyReplToJs(r.to)]);
}

let compiled = null;
let external = null;

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
  external = {
    external: false,
    fn: (text) => {
      for (const [rx, to] of compiled) text = text.replace(new RegExp(rx.source, "gu"), to);
      return text;
    },
  };
  return external;
}

export class Rabbit {
  static zg2uni(text) {
    if (external === null) {
      
      
      if (compiled === null) compiled = compileLocal();
      for (const [rx, to] of compiled) text = text.replace(new RegExp(rx.source, "gu"), to);
      return text;
    }
    return external.fn(text);
  }
}

export async function initRabbit() {
  await load();
  return { external: external.external };
}


export function ruleCount() {
  if (compiled === null) compiled = compileLocal();
  return compiled.length;
}
