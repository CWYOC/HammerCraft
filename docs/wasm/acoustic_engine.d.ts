/* tslint:disable */
/* eslint-disable */

export function calculate_quarter_wave(length_mm: number, diameter_mm: number, temperature_c: number, humidity_percent: number): number;

export function calculate_tube_volume(length_mm: number, diameter_mm: number): number;

export function engine_version(): string;

export function reverse_design_json(request_json: string): string;

export function simulate_json(request_json: string): string;

export function start(): void;

export function workshop_arrange_json(project: string, shell: string, cables_only: boolean): string;

export function workshop_build_json(project: string, shell: string): string;

export function workshop_export_stl(mesh: string): Uint8Array;

export function workshop_import_stl(bytes: Uint8Array, unit_mm: number): string;

export function workshop_outlets_json(project: string, shell: string): string;

export function workshop_tube_json(tube: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly calculate_quarter_wave: (a: number, b: number, c: number, d: number) => number;
    readonly calculate_tube_volume: (a: number, b: number) => number;
    readonly engine_version: () => [number, number];
    readonly reverse_design_json: (a: number, b: number) => [number, number, number, number];
    readonly simulate_json: (a: number, b: number) => [number, number, number, number];
    readonly start: () => void;
    readonly workshop_arrange_json: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly workshop_build_json: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly workshop_export_stl: (a: number, b: number) => [number, number, number, number];
    readonly workshop_import_stl: (a: number, b: number, c: number) => [number, number, number, number];
    readonly workshop_outlets_json: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly workshop_tube_json: (a: number, b: number) => [number, number, number, number];
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
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
