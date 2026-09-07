use crate::models::{ElectricalElement, ImpedancePoint};
use num_complex::Complex64;
use std::f64::consts::PI;

fn point_to_complex(point: &ImpedancePoint) -> Complex64 {
    Complex64::from_polar(
        point.magnitude_ohm.max(0.001),
        point.phase_deg.to_radians(),
    )
}

pub fn interpolate_impedance(
    points: &[ImpedancePoint],
    frequency_hz: f64,
    fallback_ohm: f64,
) -> Complex64 {
    if points.is_empty() {
        return Complex64::new(fallback_ohm.max(0.01), 0.0);
    }
    if frequency_hz <= points[0].frequency_hz { return point_to_complex(&points[0]); }
    let last = &points[points.len() - 1];
    if frequency_hz >= last.frequency_hz { return point_to_complex(last); }

    for pair in points.windows(2) {
        let left = &pair[0];
        let right = &pair[1];
        if frequency_hz >= left.frequency_hz && frequency_hz <= right.frequency_hz {
            let ratio = (frequency_hz.log10() - left.frequency_hz.log10())
                / (right.frequency_hz.log10() - left.frequency_hz.log10());
            let magnitude = left.magnitude_ohm + (right.magnitude_ohm - left.magnitude_ohm) * ratio;
            let phase = left.phase_deg + (right.phase_deg - left.phase_deg) * ratio;
            return Complex64::from_polar(magnitude.max(0.001), phase.to_radians());
        }
    }
    Complex64::new(fallback_ohm.max(0.01), 0.0)
}

fn capacitor_impedance(frequency_hz: f64, capacitance_uf: f64) -> Complex64 {
    if capacitance_uf <= 0.0 || frequency_hz <= 0.0 { return Complex64::new(1e30, 0.0); }
    let omega = 2.0 * PI * frequency_hz;
    Complex64::new(0.0, -1.0 / (omega * capacitance_uf * 1e-6))
}

fn inductor_impedance(frequency_hz: f64, inductance_mh: f64) -> Complex64 {
    let omega = 2.0 * PI * frequency_hz;
    Complex64::new(0.0, omega * inductance_mh.max(0.0) * 1e-3)
}

pub fn electrical_transfer(
    frequency_hz: f64,
    driver_impedance: Complex64,
    elements: &[ElectricalElement],
) -> Complex64 {
    let mut series = Complex64::new(0.0, 0.0);
    let mut load = driver_impedance;

    for element in elements {
        match element {
            ElectricalElement::SeriesResistor { resistance_ohm } => {
                series += Complex64::new(resistance_ohm.max(0.0), 0.0);
            }
            ElectricalElement::SeriesCapacitor { capacitance_uf } => {
                series += capacitor_impedance(frequency_hz, *capacitance_uf);
            }
            ElectricalElement::SeriesInductor { inductance_mh } => {
                series += inductor_impedance(frequency_hz, *inductance_mh);
            }
            ElectricalElement::ParallelResistor { resistance_ohm } => {
                if *resistance_ohm > 0.0 {
                    let r = Complex64::new(*resistance_ohm, 0.0);
                    load = (load * r) / (load + r);
                }
            }
        }
    }

    let total = series + load;
    if total.norm() <= 1e-15 { Complex64::new(0.0, 0.0) } else { load / total }
}
