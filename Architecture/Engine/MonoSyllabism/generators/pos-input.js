// Group entry-holder lines into POS units, ending after two Burmese stops.
export async function* fullstopHolder(lines) {
  let unit = '';
  let stops = 0;
  let hasContent = false;
  let previousLine = false;

  for await (const line of lines) {
    if (typeof line !== 'string') continue;
    if (previousLine) unit += ' √';
    previousLine = true;
    const parts = line.split('√');
    for (let i = 0; i < parts.length; i++) {
      const core = parts[i];
      const terminated = i < parts.length - 1;
      if (!terminated && !core) continue;
      unit += core + (terminated ? '√' : '');
      if (core === '။') {
        stops++;
        hasContent = true;
        if (stops >= 2) {
          yield unit;
          unit = '';
          stops = 0;
          hasContent = false;
        }
      } else if (core.trim() !== '') {
        hasContent = true;
      }
    }
  }
  if (unit && hasContent) yield unit;
}
