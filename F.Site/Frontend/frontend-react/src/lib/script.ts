

export const MYANMAR = /[\u1000-\u109F\uA9E0-\uA9FF\uAA60-\uAA7F]/;


export const MYANMAR_ALL = /[\u1000-\u109F\uA9E0-\uA9FF\uAA60-\uAA7F]/g;


export const MYANMAR_LETTERS =
  /[\u1000-\u102A\u103F\u104E\u1050-\u1055\u105A-\u105D\u1061\u1065\u1066\u106E-\u1070\u1075-\u1081\u108E\uA9E0-\uA9E4\uA9E7-\uA9EF\uA9FA-\uA9FE\uAA60-\uAA76\uAA7A\uAA7E-\uAA7F]/g;


export const MIN_LETTERS = 12;

export type ScriptVerdict = {
  
  matched: boolean;
  
  myanmarChars: number;
  
  myanmarLetters: number;
  
  density: number;
  
  readable: boolean;
  
  kind: "none" | "unreadable" | "myanmar";
};
export function probeScript(text: string): ScriptVerdict {
  const source = text ?? "";
  const myanmarChars = (source.match(MYANMAR_ALL) || []).length;
  const myanmarLetters = (source.match(MYANMAR_LETTERS) || []).length;
  const nonWhitespace = source.replace(/\s/g, "").length;
  const readable = myanmarLetters >= MIN_LETTERS;

  return {
    matched: MYANMAR.test(source),
    myanmarChars,
    myanmarLetters,
    density: nonWhitespace ? myanmarLetters / nonWhitespace : 0,
    readable,
    kind: readable ? "myanmar" : myanmarChars > 0 ? "unreadable" : "none",
  };
}
