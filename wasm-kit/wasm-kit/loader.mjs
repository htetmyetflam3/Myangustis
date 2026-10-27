// FILE: loader.mjs — the in-box loader. KEYLESS BY DESIGN.
//
// The AES-256-GCM key lives OUTSIDE this module (payload.key.txt /
// PAYLOAD_KEY env) and is held only by the Node host (host.mjs). The host
// decrypts the linga.payload section BEFORE boot and hands the plaintext
// module pack to the engine, so the QuickJS side never sees a key or cipher.
//
// The committed engine.wasm shim imports only bootModules() from this file;
// keeping that export name is the whole contract. TextDecoder is polyfilled
// by the shim before any module runs.
function decode(bytes) {
  return new TextDecoder().decode(bytes);
}

// payload here is already the decrypted JSON pack {filename: source}.
export function bootModules(payload) {
  return JSON.parse(decode(payload));
}
