/* tslint:disable */
/* eslint-disable */

export class ParameterEditor {
    free(): void;
    [Symbol.dispose](): void;
    form(): Element;
    constructor(parent: Element, input_json: string, imported: boolean, commit: Function, dirty: Function);
}

export function evaluate_expression(expression: string, resolver: Function): string;

export function resolve_parameters(input: string): string;

export function runtime_version(): string;

export function solve_block(input: string, progress: Function): string;

export function solve_electrical_tetra(input: string): string;

export function solve_structural_tetra(input: string): string;

export function solve_thermal_tetra(input: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_parametereditor_free: (a: number, b: number) => void;
    readonly evaluate_expression: (a: number, b: number, c: any) => [number, number, number, number];
    readonly parametereditor_form: (a: number) => any;
    readonly parametereditor_new: (a: any, b: number, c: number, d: number, e: any, f: any) => [number, number, number];
    readonly resolve_parameters: (a: number, b: number) => [number, number, number, number];
    readonly runtime_version: () => [number, number];
    readonly solve_block: (a: number, b: number, c: any) => [number, number, number, number];
    readonly solve_electrical_tetra: (a: number, b: number) => [number, number, number, number];
    readonly solve_structural_tetra: (a: number, b: number) => [number, number, number, number];
    readonly solve_thermal_tetra: (a: number, b: number) => [number, number, number, number];
    readonly wasm_bindgen_cfa29e2844175e1d___convert__closures_____invoke___web_sys_18e28c0b47453cf3___features__gen_Event__Event______true_: (a: number, b: number, c: any) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
