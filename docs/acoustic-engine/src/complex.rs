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
