// User-confirmed raw bytes and runs from the two examined WinInnwa PDFs. Both the whole
// document and embedded font program must match: the same font can be
// re-encoded by a different PDF. These are not keyboard positions, general
// WinInnwa slots, or a claim that the surrounding legacy decode is verified.
// Evidence: jason-map/raw-byte-map.json and the source-page observations.
const PROFILES = new Map([
  ["8ff4223864f0b5e755b3162ec7f6304d47687c221035c04fd5e7486695b01797", {
    fontSha256: "9b3622c34d21de53fb2a6dacd19e698f05dc46e2d32091ddefe42e23ab7916f2",
    // The user confirmed these individual PDF codes, including 25 = stacked က.
    // Keep them independent so the mapping also works across text-show breaks.
    bytes: new Map([[0x17, "က"], [0x25, "္က"]]),
    runs: [
      { bytes: [0x06, 0x07, 0x08, 0x09], text: "သဒ္ဒါ" },
      { bytes: [0x07, 0x08], text: "ဒ္ဒ" },
      { bytes: [0x0B, 0x5C], text: "တ္တ" },
      { bytes: [0x2B, 0x5F], text: "န္တ" },
    ],
    // These stack slots require their observed upper consonants. 5F is also
    // present after 0B in the source, conflicting with the supplied rule;
    // retain the raw code outside a confirmed run, like 33/69.
    unresolved: new Set([0x08, 0x33, 0x5C, 0x5F, 0x69]),
  }],
  ["254712db152e350e69df5edcfa6ace40313bcd75f2fc571fa5bb7fdd3ec2b06c", {
    fontSha256: "31e1447e813a2b15bee4bc4b1be515764554378cfd254ee45d9f9c0a7eda686b",
    runs: [
      { bytes: [0x0B, 0x64], text: "တ္တ" },
      { bytes: [0x1D, 0x6C], text: "န္တ" },
    ],
    unresolved: new Set([0x64, 0x66, 0x6C]),
  }],
]);

export function confirmedPdfProfile(sha256) {
  return PROFILES.get(sha256) ?? null;
}

export function confirmedRunAt(profile, data, index) {
  for (const run of profile.runs) {
    if (run.bytes.every((byte, offset) => data.charCodeAt(index + offset) === byte)) return run;
  }
  return null;
}
