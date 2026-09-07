use crate::chamber::expansion_chamber_matrix;
use crate::damper::damper_matrix;
use crate::models::{AcousticElement, Environment};
use crate::tube::{tube_matrix, AcousticMatrix};

pub fn acoustic_path_matrix(
    frequency_hz: f64,
    path: &[AcousticElement],
    environment: &Environment,
) -> AcousticMatrix {
    let mut total = AcousticMatrix::identity();

    for element in path {
        let matrix = match element {
            AcousticElement::Tube { length_mm, diameter_mm, loss_factor } => tube_matrix(
                frequency_hz,
                *length_mm,
                *diameter_mm,
                environment.temperature_c,
                environment.relative_humidity_percent,
                *loss_factor,
            ),
            AcousticElement::Damper { resistance_acoustic_ohm } => {
                damper_matrix(*resistance_acoustic_ohm)
            }
            AcousticElement::ExpansionChamber { length_mm, diameter_mm } => expansion_chamber_matrix(
                frequency_hz,
                *length_mm,
                *diameter_mm,
                environment.temperature_c,
                environment.relative_humidity_percent,
            ),
            AcousticElement::Nozzle { length_mm, diameter_mm } => tube_matrix(
                frequency_hz,
                *length_mm,
                *diameter_mm,
                environment.temperature_c,
                environment.relative_humidity_percent,
                0.0,
            ),
        };
        total = total.multiply(&matrix);
    }

    total
}

pub fn output_diameter_mm(path: &[AcousticElement]) -> f64 {
    for element in path.iter().rev() {
        match element {
            AcousticElement::Tube { diameter_mm, .. }
            | AcousticElement::ExpansionChamber { diameter_mm, .. }
            | AcousticElement::Nozzle { diameter_mm, .. } => return (*diameter_mm).max(0.1),
            _ => {}
        }
    }
    2.0
}


pub fn input_diameter_mm(path: &[AcousticElement]) -> f64 {
    for element in path.iter() {
        match element {
            AcousticElement::Tube { diameter_mm, .. }
            | AcousticElement::ExpansionChamber { diameter_mm, .. }
            | AcousticElement::Nozzle { diameter_mm, .. } => return (*diameter_mm).max(0.1),
            _ => {}
        }
    }
    2.0
}
