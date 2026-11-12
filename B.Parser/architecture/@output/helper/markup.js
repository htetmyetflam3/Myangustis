/*
(output/helper) markup: read the parsed result's marked-up strings.
One string per page: <b>/<i> inline, <h1>/<h2> heading lines,
\n line break, \n\n paragraph break, content escaped as
&amp; &lt; &gt;. Writers render blocks from here; the plain-text
writer strips back to raw text.
*/

export function unescapeMarkup(text) {
  return String(text ?? "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

export function stripMarkup(text) {
  return unescapeMarkup(String(text ?? "").replace(/<\/?(?:b|i|h1|h2)>/gu, ""));
}

const TAG_TOKEN = /<(\/?)(b|i|h1|h2)>/gu;

function parseRuns(text) {
  const runs = [];
  let bold = false;
  let italic = false;
  let last = 0;
  for (const match of text.matchAll(TAG_TOKEN)) {
    if (match.index > last) runs.push({ text: unescapeMarkup(text.slice(last, match.index)), bold, italic });
    const closing = match[1] === "/";
    if (match[2] === "b") bold = !closing;
    else if (match[2] === "i") italic = !closing;
    last = match.index + match[0].length;
  }
  if (last < text.length) runs.push({ text: unescapeMarkup(text.slice(last)), bold, italic });
  return runs.filter((run) => run.text !== "");
}

// -> [{ tag: "h1"|"h2"|"p", lines: [[run, ...], ...] }]
export function parseMarkup(text) {
  const blocks = [];
  for (const rawBlock of String(text ?? "").split(/\n{2,}/u)) {
    const block = rawBlock.trim();
    if (!block) continue;
    let tag = "p";
    let inner = block;
    const heading = block.match(/^<h([12])>([\s\S]*)<\/h\1>$/u);
    if (heading) { tag = `h${heading[1]}`; inner = heading[2]; }
    blocks.push({ tag, lines: inner.split("\n").map((line) => parseRuns(line)) });
  }
  return blocks;
}
