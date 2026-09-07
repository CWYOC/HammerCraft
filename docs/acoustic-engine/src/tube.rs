use num_complex::Complex64;
use std::f64::consts::PI;

#[derive(Debug, Clone, Copy)]
pub struct AcousticMatrix {
    pub a: Complex64,
    pub b: Complex64,
    pub c: Complex64,
    pub d: Complex64,
}

impl AcousticMatrix {
    pub fn identity() -> Self {
        Self {
            a: Complex64::new(1.0, 0.0),
            b: Complex64::new(0.0, 0.0),
            c: Complex64::new(0.0, 0.0),
            d: Complex64::new(1.0, 0.0),
        }
    }

    pub fn multiply(&self, other: &Self) -> Self {
        Self {
            a: self.a * other.a + self.b * other.c,
            b: self.a * other.b + self.b * other.d,
            c: self.c * other.a + self.d * other.c,
            d: self.c * other.b + self.d * other.d,
        }
    }
}

const AIR_DYNAMIC_VISCOSITY_PA_S: f64 = 1.84e-5;
const AIR_PRANDTL: f64 = 0.71;
const AIR_GAMMA: f64 = 1.4;

pub fn speed_of_sound(temperature_c: f64, relative_humidity_percent: f64) -> f64 {
    331.3 + 0.606 * temperature_c + 0.0124 * relative_humidity_percent.clamp(0.0, 100.0)
}

pub fn air_density(temperature_c: f64) -> f64 {
    let temp_kelvin = temperature_c + 273.15;
    1.2929 * (273.15 / temp_kelvin)
}

pub fn tube_area(diameter_mm: f64) -> f64 {
    let radius_m = diameter_mm.max(0.01) * 0.001 / 2.0;
    PI * radius_m * radius_m
}

pub fn characteristic_impedance(
    diameter_mm: f64,
    temperature_c: f64,
    relative_humidity_percent: f64,
) -> f64 {
    let area = tube_area(diameter_mm);
    let rho = air_density(temperature_c);
    let c = speed_of_sound(temperature_c, relative_humidity_percent);
    rho * c / area.max(1e-14)
}

fn boundary_layer_depths(frequency_hz: f64, temperature_c: f64) -> (f64, f64) {
    let rho = air_density(temperature_c);
    let omega = 2.0 * PI * frequency_hz.max(1.0);
    let viscous = (2.0 * AIR_DYNAMIC_VISCOSITY_PA_S / (rho * omega)).sqrt();
    let thermal = viscous / AIR_PRANDTL.sqrt();
    (viscous, thermal)
}

/// High-frequency Kirchhoff / boundary-layer approximation for a circular duct.
///
/// This is substantially more realistic for IEM microtubes than a lossless line,
/// while remaining cheap enough to evaluate thousands of times in the browser.
/// When the boundary layers become comparable with the tube radius the asymptotic
/// approximation is clamped to avoid non-physical numerical growth; a future
/// Stinson/Bessel implementation can replace this function without changing the
/// rest of the transmission-line solver.
pub fn thermoviscous_line_parameters(
    frequency_hz: f64,
    diameter_mm: f64,
    temperature_c: f64,
    relative_humidity_percent: f64,
    empirical_loss_factor: f64,
) -> (Complex64, Complex64) {
    let c = speed_of_sound(temperature_c, relative_humidity_percent);
    let rho = air_density(temperature_c);
    let area = tube_area(diameter_mm);
    let radius_m = (diameter_mm.max(0.05) * 0.001 / 2.0).max(2.5e-5);
    let omega = 2.0 * PI * frequency_hz.max(1.0);
    let k0 = omega / c;
    let z0 = rho * c / area.max(1e-14);

    let (delta_v, delta_t) = boundary_layer_depths(frequency_hz, temperature_c);

    // Boundary-layer ratios. The first-order expansion is best when these are << 1.
    // Clamp to keep the approximation stable in extremely narrow ducts / very low f.
    let eps_v = (delta_v / radius_m).min(1.5);
    let eps_t = (delta_t / radius_m).min(1.5);

    let propagation_correction =
        0.5 * (eps_v + (AIR_GAMMA - 1.0) * eps_t);
    let impedance_correction =
        0.5 * (eps_v - (AIR_GAMMA - 1.0) * eps_t);

    // gamma = alpha + j*beta. Multiplication of j*k by the standard
    // (1 + (1-j)*correction) form yields positive attenuation alpha.
    let mut gamma = Complex64::new(
        k0 * propagation_correction,
        k0 * (1.0 + propagation_correction),
    );

    // Optional empirical term retained for calibration against printed tube data.
    if empirical_loss_factor > 0.0 {
        let extra_alpha = empirical_loss_factor
            * frequency_hz.max(1.0).sqrt()
            / radius_m;
        gamma.re += extra_alpha;
    }

    let zc = Complex64::new(
        z0 * (1.0 + impedance_correction),
        -z0 * impedance_correction,
    );

    (gamma, zc)
}

pub fn propagation_constant(
    frequency_hz: f64,
    diameter_mm: f64,
    temperature_c: f64,
    relative_humidity_percent: f64,
    loss_factor: f64,
) -> Complex64 {
    thermoviscous_line_parameters(
        frequency_hz,
        diameter_mm,
        temperature_c,
        relative_humidity_percent,
        loss_factor,
    ).0
}

pub fn tube_matrix(
    frequency_hz: f64,
    length_mm: f64,
    diameter_mm: f64,
    temperature_c: f64,
    relative_humidity_percent: f64,
    loss_factor: f64,
) -> AcousticMatrix {
    let length_m = length_mm.max(0.0) * 0.001;
    if length_m <= 0.0 {
        return AcousticMatrix::identity();
    }

    let (gamma, zc) = thermoviscous_line_parameters(
        frequency_hz,
        diameter_mm,
        temperature_c,
        relative_humidity_percent,
        loss_factor,
    );

    let gl = gamma * length_m;
    let cosh_gl = gl.cosh();
    let sinh_gl = gl.sinh();

    AcousticMatrix {
        a: cosh_gl,
        b: zc * sinh_gl,
        c: sinh_gl / zc,
        d: cosh_gl,
    }
}

pub fn quarter_wave_frequency(
    length_mm: f64,
    diameter_mm: f64,
    temperature_c: f64,
    relative_humidity_percent: f64,
) -> f64 {
    if length_mm <= 0.0 {
        return 0.0;
    }
    let c = speed_of_sound(temperature_c, relative_humidity_percent);
    let length_m = length_mm * 0.001;
    let radius_m = diameter_mm.max(0.0) * 0.001 / 2.0;
    let effective_length = length_m + 0.6 * radius_m;
    c / (4.0 * effective_length.max(1e-9))
}

pub fn tube_volume_mm3(length_mm: f64, diameter_mm: f64) -> f64 {
    let radius_mm = diameter_mm.max(0.0) / 2.0;
    PI * radius_mm * radius_mm * length_mm.max(0.0)
}
