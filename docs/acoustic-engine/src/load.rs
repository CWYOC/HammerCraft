use crate::models::{AcousticLoad, AcousticSource, Environment};
use crate::tube::{
    air_density, characteristic_impedance, speed_of_sound, tube_area, tube_matrix,
};
use num_complex::Complex64;
use std::f64::consts::PI;

// Generic 711 microphone termination values used by the COMSOL generic 711 model.
const GENERIC_711_MIC_COMPLIANCE_M5_PER_N: f64 = 0.62e-13;
const GENERIC_711_MIC_RESISTANCE_NS_PER_M5: f64 = 119.0e6;
const GENERIC_711_MIC_MASS_KG_PER_M4: f64 = 710.0;
const GENERIC_711_MAIN_DIAMETER_MM: f64 = 7.5;
const GENERIC_711_MAIN_LENGTH_MM: f64 = 12.5;

fn parallel(a: Complex64, b: Complex64) -> Complex64 {
    let denom = a + b;
    if denom.norm() <= 1e-18 {
        Complex64::new(1e30, 0.0)
    } else {
        (a * b) / denom
    }
}

pub fn cavity_compliance_impedance(
    frequency_hz: f64,
    volume_mm3: f64,
    environment: &Environment,
) -> Complex64 {
    let rho = air_density(environment.temperature_c);
    let c = speed_of_sound(
        environment.temperature_c,
        environment.relative_humidity_percent,
    );
    let volume_m3 = volume_mm3.max(0.001) * 1e-9;
    let compliance = volume_m3 / (rho * c * c);
    let omega = 2.0 * PI * frequency_hz.max(1.0);
    Complex64::new(0.0, -1.0 / (omega * compliance).max(1e-30))
}

pub fn radiation_impedance(
    frequency_hz: f64,
    diameter_mm: f64,
    environment: &Environment,
) -> Complex64 {
    let c = speed_of_sound(
        environment.temperature_c,
        environment.relative_humidity_percent,
    );
    let radius_m = diameter_mm.max(0.05) * 0.001 / 2.0;
    let k = 2.0 * PI * frequency_hz.max(1.0) / c;
    let ka = k * radius_m;
    let zc = characteristic_impedance(
        diameter_mm,
        environment.temperature_c,
        environment.relative_humidity_percent,
    );

    // Small-ka unflanged circular-pipe approximation.
    let r_norm = 0.5 * ka * ka;
    let x_norm = 0.6133 * ka;
    Complex64::new(zc * r_norm, zc * x_norm)
}

fn generic_711_microphone_impedance(frequency_hz: f64) -> Complex64 {
    let omega = 2.0 * PI * frequency_hz.max(1.0);
    let r = GENERIC_711_MIC_RESISTANCE_NS_PER_M5;
    let inertive = omega * GENERIC_711_MIC_MASS_KG_PER_M4;
    let compliant = -1.0 / (omega * GENERIC_711_MIC_COMPLIANCE_M5_PER_N);
    Complex64::new(r, inertive + compliant)
}

fn generic_711_matrix(frequency_hz: f64, environment: &Environment) -> crate::tube::AcousticMatrix {
    tube_matrix(
        frequency_hz,
        GENERIC_711_MAIN_LENGTH_MM,
        GENERIC_711_MAIN_DIAMETER_MM,
        environment.temperature_c,
        environment.relative_humidity_percent,
        0.0,
    )
}

fn generic_711_input_impedance(frequency_hz: f64, environment: &Environment) -> Complex64 {
    let matrix = generic_711_matrix(frequency_hz, environment);
    let zm = generic_711_microphone_impedance(frequency_hz);
    let denominator = matrix.c * zm + matrix.d;
    if denominator.norm() <= 1e-18 {
        Complex64::new(1e30, 0.0)
    } else {
        (matrix.a * zm + matrix.b) / denominator
    }
}

/// Pressure transfer from the load reference plane to the modeled microphone.
/// Ordinary terminal loads are measured at their input and therefore return 1.
pub fn load_pressure_transfer(
    load: &AcousticLoad,
    frequency_hz: f64,
    environment: &Environment,
) -> Complex64 {
    match load {
        AcousticLoad::Generic711Approx => {
            let matrix = generic_711_matrix(frequency_hz, environment);
            let zm = generic_711_microphone_impedance(frequency_hz);
            let denominator = matrix.a * zm + matrix.b;
            if denominator.norm() <= 1e-18 {
                Complex64::new(0.0, 0.0)
            } else {
                zm / denominator
            }
        }
        _ => Complex64::new(1.0, 0.0),
    }
}

pub fn load_impedance(
    load: &AcousticLoad,
    frequency_hz: f64,
    output_diameter_mm: f64,
    environment: &Environment,
) -> Complex64 {
    match load {
        AcousticLoad::Anechoic => Complex64::new(
            characteristic_impedance(
                output_diameter_mm,
                environment.temperature_c,
                environment.relative_humidity_percent,
            ),
            0.0,
        ),

        AcousticLoad::Radiation => {
            radiation_impedance(frequency_hz, output_diameter_mm, environment)
        }

        AcousticLoad::ClosedCavity {
            volume_mm3,
            loss_resistance_acoustic_ohm,
        } => {
            let compliance = cavity_compliance_impedance(
                frequency_hz,
                *volume_mm3,
                environment,
            );

            if *loss_resistance_acoustic_ohm > 0.0 {
                parallel(
                    compliance,
                    Complex64::new(*loss_resistance_acoustic_ohm, 0.0),
                )
            } else {
                compliance
            }
        }

        AcousticLoad::CavityWithLeak {
            volume_mm3,
            leak_resistance_acoustic_ohm,
        } => {
            let compliance = cavity_compliance_impedance(
                frequency_hz,
                *volume_mm3,
                environment,
            );
            let leak = Complex64::new(
                leak_resistance_acoustic_ohm.max(1e-9),
                0.0,
            );
            parallel(compliance, leak)
        }

        AcousticLoad::Generic711Approx => {
            generic_711_input_impedance(frequency_hz, environment)
        }
    }
}

pub fn source_impedance(
    source: &AcousticSource,
    input_diameter_mm: f64,
    environment: &Environment,
) -> Complex64 {
    match source {
        AcousticSource::IdealPressure => Complex64::new(0.0, 0.0),

        AcousticSource::Characteristic {
            impedance_multiplier,
        } => {
            let zc = characteristic_impedance(
                input_diameter_mm,
                environment.temperature_c,
                environment.relative_humidity_percent,
            );
            Complex64::new(zc * impedance_multiplier.max(0.0), 0.0)
        }

        AcousticSource::OutletInertance {
            outlet_diameter_mm,
            effective_length_mm,
            resistance_acoustic_ohm,
        } => {
            let rho = air_density(environment.temperature_c);
            let area = tube_area(*outlet_diameter_mm);
            let length_m = effective_length_mm.max(0.0) * 0.001;
            let inertance = rho * length_m / area.max(1e-14);
            let omega = 2.0 * PI * 1000.0;
            Complex64::new(
                resistance_acoustic_ohm.max(0.0),
                omega * inertance,
            )
        }
    }
}

pub fn source_impedance_at_frequency(
    source: &AcousticSource,
    frequency_hz: f64,
    input_diameter_mm: f64,
    environment: &Environment,
) -> Complex64 {
    match source {
        AcousticSource::OutletInertance {
            outlet_diameter_mm,
            effective_length_mm,
            resistance_acoustic_ohm,
        } => {
            let rho = air_density(environment.temperature_c);
            let area = tube_area(*outlet_diameter_mm);
            let length_m = effective_length_mm.max(0.0) * 0.001;
            let inertance = rho * length_m / area.max(1e-14);
            let omega = 2.0 * PI * frequency_hz.max(1.0);
            Complex64::new(
                resistance_acoustic_ohm.max(0.0),
                omega * inertance,
            )
        }
        _ => source_impedance(source, input_diameter_mm, environment),
    }
}
