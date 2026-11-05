// Match only runs supplied by the selected resource profile. This helper
// does not select profiles or route by PDF/document hash.
export function confirmedRunAt(profile, data, index) {
  for (const run of profile.runs) {
    if (run.bytes.every((byte, offset) => data.charCodeAt(index + offset) === byte)) return run;
  }
  return null;
}
