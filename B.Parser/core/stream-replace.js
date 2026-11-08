/*
(PDF 25) PDF branch, position 25 in the chain - text helper for chunked conversion in the finishing step (PDF 19).
This module applies replacement rules to text that arrives in chunks, keeping enough lookahead so matches across chunk boundaries are not lost.
*/
// The Rabbit rules use local Myanmar patterns. Keep enough following text for
// their lookaheads and retain any match that reaches the unfinished boundary.
// This preserves non-overlapping global replacement across chunk boundaries.
const LOOKAHEAD = 16;

function safeBoundary(text, position) {
  let end = Math.max(0, position);
  if (end > 0 && end < text.length) {
    const before = text.charCodeAt(end - 1);
    const after = text.charCodeAt(end);
    if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) end -= 1;
  }
  return end;
}

function replacement(template, match) {
  return template.replace(/\$(\$|&|\d{1,2})/gu, (token, value) => {
    if (value === "$") return "$";
    if (value === "&") return match[0];
    let index = Number(value);
    if (index > 0 && index < match.length) return match[index] ?? "";
    if (value.length === 2) {
      index = Number(value[0]);
      if (index > 0 && index < match.length) return `${match[index] ?? ""}${value[1]}`;
    }
    return token;
  });
}

export class StreamingReplace {
  constructor(pattern, template) {
    this.source = pattern.source;
    this.template = template;
    this.pattern = new RegExp(this.source, "gu");
    this.startOnly = this.source.startsWith("^");
    this.endOnly = this.source.endsWith("(?=\\n?$)");
    this.startDone = false;
    this.buffer = "";
  }

  push(chunk, final = false) {
    this.buffer += chunk;
    if (this.startOnly) {
      if (this.startDone) { const out = this.buffer; this.buffer = ""; return out; }
      if (!final && this.buffer.length <= LOOKAHEAD) return "";
      this.startDone = true;
      const out = this.buffer.replace(this.pattern, this.template);
      this.buffer = "";
      return out;
    }
    if (this.endOnly) {
      if (final) {
        const out = this.buffer.replace(this.pattern, this.template);
        this.buffer = "";
        return out;
      }
      const end = safeBoundary(this.buffer, this.buffer.length - LOOKAHEAD);
      const out = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end);
      return out;
    }
    const safe = final ? this.buffer.length : safeBoundary(this.buffer, this.buffer.length - LOOKAHEAD);
    let out = "";
    let consumed = 0;
    let stop = safe;
    this.pattern.lastIndex = 0;
    for (let match; (match = this.pattern.exec(this.buffer)) !== null;) {
      const end = match.index + match[0].length;
      if (match.index >= safe || end > safe) {
        stop = Math.min(safe, match.index);
        break;
      }
      out += this.buffer.slice(consumed, match.index) + replacement(this.template, match);
      consumed = end;
      if (!match[0].length) this.pattern.lastIndex += 1;
    }
    out += this.buffer.slice(consumed, stop);
    this.buffer = this.buffer.slice(stop);
    return out;
  }
}

class CodePointStream {
  constructor() { this.high = ""; }

  input(chunk, final) {
    let text = this.high + chunk;
    this.high = "";
    if (!final && text.length) {
      const last = text.charCodeAt(text.length - 1);
      if (last >= 0xd800 && last <= 0xdbff) {
        this.high = text.slice(-1);
        text = text.slice(0, -1);
      }
    }
    return text;
  }
}

// These Rabbit rules collapse a run of equal characters. A run may be as
// long as the page, so keep the previous character instead of the match.
class CollapseRun extends CodePointStream {
  constructor(characters) {
    super();
    this.characters = characters;
    this.previous = "";
  }

  push(chunk, final = false) {
    let out = "";
    for (const char of this.input(chunk, final)) {
      if (!this.characters.has(char) || char !== this.previous) out += char;
      this.previous = this.characters.has(char) ? char : "";
    }
    return out;
  }
}

// ([က-အ])ေ([ျြွှ]+) moves one vowel after an arbitrarily long
// medial run. Emit the run as it arrives and delay only the vowel.
class MedialRun extends CodePointStream {
  constructor() {
    super();
    this.state = 0;
    this.base = "";
  }

  push(chunk, final = false) {
    let out = "";
    for (const char of this.input(chunk, final)) {
      if (this.state === 3) {
        if ("ျြွှ".includes(char)) { out += char; continue; }
        out += "ေ";
        this.state = 0;
      }
      if (this.state === 2) {
        if ("ျြွှ".includes(char)) {
          out += this.base + char;
          this.base = "";
          this.state = 3;
          continue;
        }
        out += `${this.base}ေ`;
        this.base = "";
        this.state = 0;
      }
      if (this.state === 1) {
        if (char === "ေ") { this.state = 2; continue; }
        out += this.base;
        this.base = "";
        this.state = 0;
      }
      if (char >= "က" && char <= "အ") {
        this.base = char;
        this.state = 1;
      } else out += char;
    }
    if (final) {
      if (this.state === 1) out += this.base;
      else if (this.state === 2) out += `${this.base}ေ`;
      else if (this.state === 3) out += "ေ";
      this.state = 0;
      this.base = "";
    }
    return out;
  }
}

function stageFor(pattern, template) {
  if (pattern.source === "([ိီွု့႕])\\1+" && template === "$1") {
    return new CollapseRun(new Set("ိီွု့႕"));
  }
  if (pattern.source === "([က-အ])ေ([ျြွှ]+)" && template === "$1$2ေ") return new MedialRun();
  for (const char of "ိ်ွ့ီ") {
    if (pattern.source === `[${char}]+` && template === char) return new CollapseRun(new Set([char]));
  }
  return new StreamingReplace(pattern, template);
}

export function createReplacementPipeline(rules, onChunk) {
  if (typeof onChunk !== "function") throw new TypeError("Expected an output callback");
  const stages = rules.map(([pattern, template]) => stageFor(pattern, template));
  let finished = false;
  return {
    push(text, final = false) {
      if (finished) throw new Error("Text replacement stream is already finished");
      let output = String(text ?? "");
      for (const stage of stages) output = stage.push(output, final);
      if (output) onChunk(output);
      if (final) finished = true;
    },
  };
}
