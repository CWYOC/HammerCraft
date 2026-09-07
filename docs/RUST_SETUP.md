# Rust/WASM setup for the Hammer Craft admin portal

The site now has a real Rust acoustic engine source tree at `acoustic-engine/` and a browser bridge at `wasm-loader.js`.

## What happens immediately

The admin page tries to load `wasm/acoustic_engine.js`. If it exists, forward simulation and reverse design use Rust/WASM. If it does not exist yet, the existing JavaScript model remains active automatically.

## First GitHub build

Commit and push the new files. The workflow `.github/workflows/build-wasm.yml` installs Rust + wasm-pack, compiles the engine, and commits generated files into `wasm/`.

After the workflow has run, these files should exist:

- `wasm/acoustic_engine.js`
- `wasm/acoustic_engine_bg.wasm`
- `wasm/acoustic_engine.d.ts`
- `wasm/acoustic_engine_bg.wasm.d.ts`

GitHub Pages can serve those files directly; no Rust server is required.

## Current engine status

Version 0.1 implements the actual browser-callable Rust path for forward and inverse calculations. It is still an engineering MVP. The next work should replace the approximate tube/damper/chamber transfer functions with a frequency-domain transmission-line network and add full complex driver impedance support.
