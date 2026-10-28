






























export const PREFIX = Object.freeze({ ok: "[+]", warn: "[-]", info: "[i]", step: "   " });


export const SILENT = () => {};


export const stdoutLog = () => (message) => process.stdout.write(`${message}\n`);






export function collect() {
  const lines = [];
  const sink = (message) => { lines.push(String(message)); };
  sink.lines = lines;
  return sink;
}


export const tee = (...sinks) => (message) => { for (const s of sinks) s(message); };








export function resolveLog({ logging = true, log } = {}) {
  if (typeof log === "function") return log;
  return (logging !== false && log !== false) ? stdoutLog() : SILENT;
}

export const ok = (log, message) => log(`${PREFIX.ok} ${message}`);
export const warn = (log, message) => log(`${PREFIX.warn} ${message}`);
export const info = (log, message) => log(`${PREFIX.info} ${message}`);
export const step = (log, message) => log(`${PREFIX.step} ${message}`);
