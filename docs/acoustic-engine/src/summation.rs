use crate::complex::amplitude_to_db;
use crate::models::CombinedResultPoint;
use num_complex::Complex64;

pub fn sum_complex_pressures(frequency_hz: f64, pressures: &[Complex64]) -> CombinedResultPoint {
    let total = pressures.iter().copied().fold(Complex64::new(0.0, 0.0), |acc, x| acc + x);
    CombinedResultPoint {
        frequency_hz,
        db: amplitude_to_db(total.norm()),
        phase_deg: total.arg().to_degrees(),
    }
}
