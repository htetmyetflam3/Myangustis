// B — Stream reader
// Caller reads the file/stream on their side and passes the resulting object in.
// No file paths, no temp files, no reading-back from disk inside this module.
// Returns a normalized object ready for singleApi.
export function streamReader(source) {
  if (!source) {
    throw new TypeError("streamReader: a readable stream or object is required");
  }
  return { source };
}
