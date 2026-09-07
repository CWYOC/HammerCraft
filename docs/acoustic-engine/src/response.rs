use crate::complex::{db_to_amplitude, polar};
use crate::models::FrequencyPoint;
use num_complex::Complex64;

pub fn interpolate_frequency_response(points: &[FrequencyPoint], frequency_hz: f64) -> FrequencyPoint {
    if points.is_empty() {
        return FrequencyPoint { frequency_hz, db: 0.0, phase_deg: 0.0 };
    }
    if frequency_hz <= points[0].frequency_hz {
        return FrequencyPoint { frequency_hz, db: points[0].db, phase_deg: points[0].phase_deg };
    }
    let last = &points[points.len() - 1];
    if frequency_hz >= last.frequency_hz {
        return FrequencyPoint { frequency_hz, db: last.db, phase_deg: last.phase_deg };
    }

    for pair in points.windows(2) {
        let a = &pair[0];
        let b = &pair[1];
        if frequency_hz >= a.frequency_hz && frequency_hz <= b.frequency_hz {
            let ratio = (frequency_hz.log10() - a.frequency_hz.log10())
                / (b.frequency_hz.log10() - a.frequency_hz.log10());
            return FrequencyPoint {
                frequency_hz,
                db: a.db + (b.db - a.db) * ratio,
                phase_deg: a.phase_deg + (b.phase_deg - a.phase_deg) * ratio,
            };
        }
    }

    FrequencyPoint { frequency_hz, db: 0.0, phase_deg: 0.0 }
}

pub fn frequency_point_to_complex(point: &FrequencyPoint) -> Complex64 {
    polar(db_to_amplitude(point.db), point.phase_deg)
}
