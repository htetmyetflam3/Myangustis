// Use only on a comparison copy, or after the ZawCode lane is selected.
export function withoutZeroWidthSpace(text) {
  return String(text ?? "").replace(/\u200b/gu, "");
}
