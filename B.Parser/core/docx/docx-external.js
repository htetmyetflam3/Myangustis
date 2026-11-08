/*
(DOCX 3) DOCX branch, position 3 in the chain - the fallback beside the main extractor (DOCX 2).
This module extracts DOCX paragraphs through the external mammoth library when the built-in extractor is not used.
*/




let mammothPromise = null;
function loadMammoth() {
  if (!mammothPromise) {
    mammothPromise = import("mammoth").catch((cause) => {
      mammothPromise = null;
      throw new Error(
        "DOCX extraction requested but mammoth is not installed " +
          "(optional dependency; install it to enable the DOCX lane): " +
          `${cause?.message || cause}`,
        { cause },
      );
    });
  }
  return mammothPromise;
}

export async function extractDocxParagraphsExternal(data) {
  const mammoth = (await loadMammoth()).default;
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const { value } = await mammoth.extractRawText({ buffer });
  return value
    .split("\n")
    .filter((line) => line.trim().length > 0);
}
