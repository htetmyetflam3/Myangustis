// Placeholder: discard each POS unit until the caller-facing API is defined.
export async function consumePos(lines) {
  for await (const line of lines) {
    void line;
  }
  return 'pos tagging finish';
}
