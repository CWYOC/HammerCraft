use engineering_core::{conduction, electrical};
use serde_json::{Value, json};
fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../../../tests/fixtures/engineering-rust/scalar-fem.json"
    ))
    .unwrap()
}
#[test]
fn native_thermal_matches_independent_scipy_reference() {
    let f = fixture();
    for case in f["cases"].as_array().unwrap() {
        let mut q = case["request"].clone();
        q["mesh"] = f["mesh"].clone();
        let solution =
            conduction::solve_thermal(&serde_json::from_value(q).unwrap(), &mut |_| {}).unwrap();
        for (i, t) in solution.temperatures.iter().enumerate() {
            assert!((t - case["reference"]["temperatures"][i].as_f64().unwrap()).abs() < 1e-7);
        }
    }
}
#[test]
fn native_electrical_uniform_bar_matches_resistance_and_joule_law() {
    let f = fixture();
    let groups = f["mesh"]["boundary"].as_array().unwrap();
    let low = groups
        .iter()
        .min_by(|a, b| {
            a["center"][0]
                .as_f64()
                .partial_cmp(&b["center"][0].as_f64())
                .unwrap()
        })
        .unwrap()["tag"]
        .clone();
    let high = groups
        .iter()
        .max_by(|a, b| {
            a["center"][0]
                .as_f64()
                .partial_cmp(&b["center"][0].as_f64())
                .unwrap()
        })
        .unwrap()["tag"]
        .clone();
    let q = json!({"kind":"electric-tetra","mesh":f["mesh"],"conductivity":100,"boundaries":[{"tag":low,"type":"voltage","voltage":0},{"tag":high,"type":"voltage","voltage":2}]});
    let solution = electrical::solve(&serde_json::from_value(q).unwrap(), &mut |_| {}).unwrap();
    assert!((solution.joule_power - 4. / 3.).abs() < 1e-8);
    assert!((solution.terminals[1].inward_current - 2. / 3.).abs() < 1e-8);
    assert!(solution.current_balance.abs() < 1e-8);
}
