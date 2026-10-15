// Thin module loader. All expression parsing and migrated numerical work lives in Rust.
import init,* as runtime from './rust/engineering_web.js';
const wasmUrl=new URL('./rust/engineering_web_bg.wasm',import.meta.url);
if(typeof process!=='undefined'&&process.versions?.node){
  const {readFile}=await import('node:fs/promises');await init({module_or_path:await readFile(wasmUrl)});
}else await init({module_or_path:wasmUrl});
export const RUST_VERSION='0.1.0';
export {runtime};
