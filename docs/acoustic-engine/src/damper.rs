use crate::tube::AcousticMatrix;
use num_complex::Complex64;

pub fn damper_matrix(resistance_acoustic_ohm: f64) -> AcousticMatrix {
    AcousticMatrix {
        a: Complex64::new(1.0, 0.0),
        b: Complex64::new(resistance_acoustic_ohm.max(0.0), 0.0),
        c: Complex64::new(0.0, 0.0),
        d: Complex64::new(1.0, 0.0),
    }
}
