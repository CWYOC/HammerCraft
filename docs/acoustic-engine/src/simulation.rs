use crate::acoustic_path::{acoustic_path_matrix, input_diameter_mm, output_diameter_mm};
use crate::complex::{amplitude_to_db, db_to_amplitude};
use crate::electrical::{electrical_transfer, interpolate_impedance};
use crate::load::{load_impedance, load_pressure_transfer, source_impedance_at_frequency};
use crate::models::{
    Driver, DriverResultPoint, DriverSimulationResult, Environment, SimulationRequest,
    SimulationResult,
};
use crate::response::{frequency_point_to_complex, interpolate_frequency_response};
use crate::summation::sum_complex_pressures;
use num_complex::Complex64;

fn acoustic_transfer(
    driver: &Driver,
    frequency_hz: f64,
    environment: &Environment,
    load: &crate::models::AcousticLoad,
) -> Complex64 {
    let matrix = acoustic_path_matrix(frequency_hz, &driver.acoustic_path, environment);
    let input_diameter = input_diameter_mm(&driver.acoustic_path);
    let output_diameter = output_diameter_mm(&driver.acoustic_path);

    let zl = load_impedance(
        load,
        frequency_hz,
        output_diameter,
        environment,
    );

    let zs = source_impedance_at_frequency(
        &driver.acoustic_source,
        frequency_hz,
        input_diameter,
        environment,
    );

    // Two-port pressure transfer with finite source and load impedances:
    // Ps = p1 + Zs*U1
    // p1 = A*p2 + B*U2
    // U1 = C*p2 + D*U2
    // p2 = Zl*U2
    // => p2/Ps = Zl / [A*Zl + B + Zs*(C*Zl + D)]
    let denominator =
        matrix.a * zl
        + matrix.b
        + zs * (matrix.c * zl + matrix.d);

    if denominator.norm() <= 1e-18 {
        Complex64::new(0.0, 0.0)
    } else {
        let load_input_pressure = zl / denominator;
        load_input_pressure * load_pressure_transfer(load, frequency_hz, environment)
    }
}

pub fn simulate_driver_at_frequency(
    driver: &Driver,
    frequency_hz: f64,
    environment: &Environment,
    load: &crate::models::AcousticLoad,
) -> (DriverResultPoint, Complex64) {
    let raw = interpolate_frequency_response(&driver.response, frequency_hz);
    let mut pressure = frequency_point_to_complex(&raw);

    let impedance = interpolate_impedance(
        &driver.impedance,
        frequency_hz,
        driver.nominal_impedance_ohm,
    );

    pressure *= electrical_transfer(
        frequency_hz,
        impedance,
        &driver.electrical,
    );

    pressure *= acoustic_transfer(
        driver,
        frequency_hz,
        environment,
        load,
    );

    pressure *= db_to_amplitude(driver.gain_db);

    if driver.polarity_inverted {
        pressure = -pressure;
    }

    let result = DriverResultPoint {
        frequency_hz,
        db: amplitude_to_db(pressure.norm()),
        phase_deg: pressure.arg().to_degrees(),
        impedance_ohm: impedance.norm(),
    };

    (result, pressure)
}

pub fn simulate(request: &SimulationRequest) -> SimulationResult {
    let mut per_driver_points: Vec<Vec<DriverResultPoint>> = request
        .drivers
        .iter()
        .map(|_| Vec::with_capacity(request.frequencies_hz.len()))
        .collect();

    let mut combined = Vec::with_capacity(request.frequencies_hz.len());

    for &frequency_hz in &request.frequencies_hz {
        let mut pressures = Vec::with_capacity(request.drivers.len());

        for (idx, driver) in request.drivers.iter().enumerate() {
            let (point, pressure) = simulate_driver_at_frequency(
                driver,
                frequency_hz,
                &request.environment,
                &request.acoustic_load,
            );

            per_driver_points[idx].push(point);
            pressures.push(pressure);
        }

        combined.push(sum_complex_pressures(frequency_hz, &pressures));
    }

    let drivers = request
        .drivers
        .iter()
        .enumerate()
        .map(|(idx, driver)| DriverSimulationResult {
            driver_id: driver.id.clone(),
            driver_name: driver.name.clone(),
            points: per_driver_points[idx].clone(),
        })
        .collect();

    SimulationResult { drivers, combined }
}
