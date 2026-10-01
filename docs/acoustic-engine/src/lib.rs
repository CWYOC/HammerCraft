mod acoustic_path;
mod chamber;
mod complex;
mod damper;
mod electrical;
mod load;
mod models;
mod optimiser;
mod response;
mod simulation;
mod summation;
mod tube;
mod workshop;

use models::{ReverseDesignRequest, SimulationRequest};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub fn engine_version() -> String {
    "Hammer Craft Acoustic Engine 0.20.0".to_string()
}

#[wasm_bindgen]
pub fn calculate_quarter_wave(
    length_mm: f64,
    diameter_mm: f64,
    temperature_c: f64,
    humidity_percent: f64,
) -> f64 {
    tube::quarter_wave_frequency(length_mm, diameter_mm, temperature_c, humidity_percent)
}

#[wasm_bindgen]
pub fn calculate_tube_volume(length_mm: f64, diameter_mm: f64) -> f64 {
    tube::tube_volume_mm3(length_mm, diameter_mm)
}

#[wasm_bindgen]
pub fn simulate_json(request_json: &str) -> Result<String, JsValue> {
    let request: SimulationRequest = serde_json::from_str(request_json)
        .map_err(|e| JsValue::from_str(&format!("Invalid simulation request: {e}")))?;
    let result = simulation::simulate(&request);
    serde_json::to_string(&result)
        .map_err(|e| JsValue::from_str(&format!("Unable to serialize simulation result: {e}")))
}

#[wasm_bindgen]
pub fn reverse_design_json(request_json: &str) -> Result<String, JsValue> {
    let request: ReverseDesignRequest = serde_json::from_str(request_json)
        .map_err(|e| JsValue::from_str(&format!("Invalid reverse-design request: {e}")))?;
    let result = optimiser::reverse_design(&request);
    serde_json::to_string(&result)
        .map_err(|e| JsValue::from_str(&format!("Unable to serialize reverse-design result: {e}")))
}

#[wasm_bindgen]
pub fn workshop_import_stl(bytes: &[u8], unit_mm: f64) -> Result<String, JsValue> {
    let mesh = workshop::import_stl(bytes, unit_mm).map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&mesh).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn workshop_build_json(project: &str, shell: &str) -> Result<String, JsValue> {
    let project = serde_json::from_str(project)
        .map_err(|e| JsValue::from_str(&format!("Invalid project: {e}")))?;
    let shell = serde_json::from_str(shell)
        .map_err(|e| JsValue::from_str(&format!("Invalid shell: {e}")))?;
    let result = workshop::build(&project, &shell).map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn workshop_tube_json(tube: &str) -> Result<String, JsValue> {
    let tube = serde_json::from_str(tube).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let mesh = workshop::swept_tube(&tube).map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&mesh).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn workshop_export_stl(mesh: &str) -> Result<Vec<u8>, JsValue> {
    let mesh = serde_json::from_str(mesh).map_err(|e| JsValue::from_str(&e.to_string()))?;
    workshop::export_stl(&mesh).map_err(|e| JsValue::from_str(&e))
}
