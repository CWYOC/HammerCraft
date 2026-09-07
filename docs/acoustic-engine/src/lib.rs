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

use wasm_bindgen::prelude::*;
use models::{ReverseDesignRequest, SimulationRequest};

#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub fn engine_version() -> String {
    "Hammer Craft Acoustic Engine 0.5.0".to_string()
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
