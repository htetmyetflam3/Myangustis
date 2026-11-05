// Site entry support (shared by public + authenticated callers)
// Original: F.Site/Backend/gateway/queue/managerHandoff.js
// Function: managerPayload(intent, { executionTask }) → { job, method, output }
// Role: Converts Site upload intent into Manager job payload (job/method/output).
// Used by: site/praser.js createPraserParser for both public and authenticated callers
// Path: site → managerPayload → manager.dispatch('site', ...) → #dispatch → #submit
