// Bound the UTF-8 text retained while waiting for the next line boundary.
export const MAX_LINE_BYTES = 5 * 1024 * 1024;

export async function* toLineStrings(seg) {
  let line = '';
  let bytes = 0;
  let discarded = false;
  for await (const item of seg) {
    if (item === '\n') {
      if (line.length || !discarded) yield line;
      line = '';
      bytes = 0;
      discarded = false;
      continue;
    }
    if (typeof item !== 'string') continue;
    const nextBytes = Buffer.byteLength(item, 'utf8');
    if (bytes + nextBytes > MAX_LINE_BYTES) {
      line = '';
      bytes = 0;
      discarded = true;
      continue;
    }
    line += item;
    bytes += nextBytes;
  }
  if (line.length) yield line;
}
