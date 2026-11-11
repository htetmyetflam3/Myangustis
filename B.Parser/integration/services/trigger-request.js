/*
(integration/services) Queue -> trigger request — compatibility shim.

`managerHandoff.js` imports `buildTriggerRequest` / `keyForJob` from
here (see SEPARATION.md §4). The current converter has no worker
scripts (`converter.js` / `ocr.js`); the trigger is now just the
record the queue carries into `parse`. This shim keeps the host
contract: job/caller/key/method/output travel together.
*/

export function keyForJob(job) {
  return job === "ocr" ? "ocr" : "converter";
}

export function buildTriggerRequest({ job, caller = "public", key, method, output } = {}) {
  return {
    job: job ?? null,
    caller: caller ?? "public",
    key: key ?? keyForJob(job),
    method: method ?? "default",
    output: output ?? "txt",
  };
}
