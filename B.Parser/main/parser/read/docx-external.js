// mammoth is a heavy, OPTIONAL dependency used only by the DOCX lane. Load it
// lazily so text/PDF parsing and every module importing the pipeline does not
// require it at module-load time; a DOCX call without the package installed
// fails here with an actionable message instead of breaking the whole graph.
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
