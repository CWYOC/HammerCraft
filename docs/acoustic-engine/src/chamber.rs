use crate::tube::{tube_matrix, AcousticMatrix};

pub fn expansion_chamber_matrix(
    frequency_hz: f64,
    length_mm: f64,
    diameter_mm: f64,
    temperature_c: f64,
    relative_humidity_percent: f64,
) -> AcousticMatrix {
    tube_matrix(
        frequency_hz,
        length_mm,
        diameter_mm,
        temperature_c,
        relative_humidity_percent,
        0.0,
    )
}
