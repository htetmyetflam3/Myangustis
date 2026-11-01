import { createSourceRunner } from "./runtime.js";




const runDocxDefaultWorker = createSourceRunner({
  kind: "docx",
  method: "default",
});

const runDocxNullWorker = createSourceRunner({
  kind: "docx",
  method: "null",
});

export function runDocxWorker(msg = {}) {
  return String(msg.method || "default").toLowerCase() === "null"
    ? runDocxNullWorker(msg)
    : runDocxDefaultWorker(msg);
}
