// Minimal pdf-images stub.
// Original pdf-images.js was never in the JS repo; this provides the
// runPdfImageWorker export so from-pdf.js can import it.
export async function runPdfImageWorker(msg = {}) {
  return {
    ok: false,
    error: "runPdfImageWorker not implemented — pdf-images.js was never in the JS repo",
    msg,
  };
}
