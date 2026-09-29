// Run the existing tests against a downloaded production WASM without replacing
// repository assets. HC_AUDIT_WASM must point at the binary to test.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';

if (!process.env.HC_AUDIT_WASM) throw Error('Set HC_AUDIT_WASM to the WASM binary under test.');
const original = fs.readFileSync;
const shippedPath = fileURLToPath(new URL('../../docs/wasm/acoustic_engine_bg.wasm', import.meta.url));
const replacement = path.resolve(process.env.HC_AUDIT_WASM);
fs.readFileSync = function (filename, ...options) {
    const resolved = filename instanceof URL ? fileURLToPath(filename) : typeof filename === 'string' ? path.resolve(filename) : null;
    return original.call(this, resolved === shippedPath ? replacement : filename, ...options);
};
syncBuiltinESMExports();
