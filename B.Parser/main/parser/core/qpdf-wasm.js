import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import createQpdf from "@jspawn/qpdf-wasm";

// This runs in a child process: the emscripten CLI can call exit on errors.
const require = createRequire(import.meta.url);
const wasm = fs.readFileSync(require.resolve("@jspawn/qpdf-wasm/qpdf.wasm"));
const qpdf = await createQpdf({
  noInitialRun: true,
  print: (message) => process.stdout.write(`${message}\n`),
  printErr: (message) => process.stderr.write(`${message}\n`),
  instantiateWasm(imports, done) {
    WebAssembly.instantiate(wasm, imports).then(({ instance }) => done(instance))
      .catch((error) => { console.error(error); process.exit(1); });
    return {};
  },
});
qpdf.FS.mkdir("/host");
qpdf.FS.mount(qpdf.NODEFS, { root: path.parse(process.cwd()).root }, "/host");
const args = process.argv.slice(2);
for (let i = Math.max(0, args.length - 2); i < args.length; i += 1) {
  if (path.isAbsolute(args[i])) args[i] = `/host${args[i]}`;
}
const status = qpdf.callMain(args);
if (Number.isInteger(status)) process.exitCode = status;
