/*
(Support 38) Shared support, no chain position - a minimal vote stub.
This module provides the pixel/image-to-vector match exports other modules import; the real matching lives in the repair branch (Repair 11).
*/
// Minimal vote stub.
// Original vote.js was never in the JS repo; this provides the
// matchPixelsToVector and matchImageToVector exports so text/repair.js
// can dynamically import it.
export function matchPixelsToVector(source, options = {}) {
  return null;
}

export function matchImageToVector(source, options = {}) {
  return null;
}
