use num_complex::Complex64;

pub fn db_to_amplitude(db: f64) -> f64 {
    10_f64.powf(db / 20.0)
}

pub fn amplitude_to_db(amplitude: f64) -> f64 {
    if amplitude <= 1e-15 { -300.0 } else { 20.0 * amplitude.log10() }
}

pub fn polar(amplitude: f64, phase_deg: f64) -> Complex64 {
    Complex64::from_polar(amplitude, phase_deg.to_radians())
}

// Wrapped measurements cross the ±180° branch cut along the short arc.
// Curves containing angles outside that range are explicitly unwrapped;
// preserve their full turns (for example, measured propagation delay).
pub fn interpolate_phase(left: f64, right: f64, ratio: f64, wrapped: bool) -> f64 {
    let mut delta = right - left;
    if wrapped && delta.abs() > 180.0 {
        delta = (delta + 180.0).rem_euclid(360.0) - 180.0;
    }
    left + delta * ratio
}
