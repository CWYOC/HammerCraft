#!/bin/sh
set -eu
cd "$(dirname "$0")/../../engineering-rust"
# Override CARGO_BIN / WASM_BINDGEN_BIN when rustup's bin directory is not on PATH.
HC_CARGO=${CARGO_BIN:-cargo}
HC_BINDGEN=${WASM_BINDGEN_BIN:-wasm-bindgen}
if [ "$("$HC_BINDGEN" --version)" != 'wasm-bindgen 0.2.129' ]; then
  echo 'Install the locked binding generator: cargo install wasm-bindgen-cli --version 0.2.129 --locked' >&2
  exit 1
fi
"$HC_CARGO" build --locked --release -p engineering-server
"$HC_CARGO" build --locked --release --target wasm32-unknown-unknown -p engineering-web
"$HC_BINDGEN" --target web --out-dir ../docs/engineering/rust --out-name engineering_web target/wasm32-unknown-unknown/release/engineering_web.wasm
