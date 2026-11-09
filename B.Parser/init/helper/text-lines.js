/*
(init/helper) textLines: yield lines from text chunks.
Split a chunk stream into lines without joining it whole first -
a line is yielded as soon as its newline arrives, the partial
tail is carried across chunk boundaries. Shared by the output
writers (this used to live inside decoding's finalized-cmap,
whose import graph is mid-move; here it has one home).
*/
export function* textLines(chunks) {
  let pending = "";
  for (const chunk of chunks) {
    let start = 0;
    for (let i = 0; i < chunk.length; i += 1) {
      if (chunk[i] !== "\n") continue;
      yield pending + chunk.slice(start, i);
      pending = "";
      start = i + 1;
    }
    pending += chunk.slice(start);
  }
  yield pending;
}
