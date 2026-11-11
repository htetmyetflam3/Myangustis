/*
(init) BindInput — compatibility shim for the queue file reader.

`processingQueue.js` reads the queued site file once via
`BindInput({ path })` and passes the resulting object on the trigger
request (`readFileForTrigger`). The current input door is
`@entry/init.js` (`InitInput`); preparation now happens inside the
converter shim (`integration/host/init.js`), so binding here is a
passthrough: the original path is handed through untouched and no
chain-owned tmp is created (`collected: false`), so `runManager`
never deletes the caller's file.
*/

export async function BindInput({ path: filePath } = {}) {
  if (!filePath || typeof filePath !== "string") {
    throw new TypeError("BindInput: file path is required");
  }
  return { path: filePath, collected: false };
}
