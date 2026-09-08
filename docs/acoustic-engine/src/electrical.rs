use crate::models::{
    CircuitComponentKind, CircuitNetlist, ElectricalElement, ImpedancePoint,
};
use num_complex::Complex64;
use std::collections::{HashMap, HashSet};
use std::f64::consts::PI;

#[derive(Clone, Copy)]
struct Matrix2 {
    a: Complex64,
    b: Complex64,
    c: Complex64,
    d: Complex64,
}

impl Matrix2 {
    fn identity() -> Self {
        Self {
            a: Complex64::new(1.0, 0.0),
            b: Complex64::new(0.0, 0.0),
            c: Complex64::new(0.0, 0.0),
            d: Complex64::new(1.0, 0.0),
        }
    }

    fn mul(self, rhs: Self) -> Self {
        Self {
            a: self.a * rhs.a + self.b * rhs.c,
            b: self.a * rhs.b + self.b * rhs.d,
            c: self.c * rhs.a + self.d * rhs.c,
            d: self.c * rhs.b + self.d * rhs.d,
        }
    }
}

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
    if frequency_hz <= points[0].frequency_hz {
        return point_to_complex(&points[0]);
    }
    let last = &points[points.len() - 1];
    if frequency_hz >= last.frequency_hz {
        return point_to_complex(last);
    }

    for pair in points.windows(2) {
        let left = &pair[0];
        let right = &pair[1];
        if frequency_hz >= left.frequency_hz && frequency_hz <= right.frequency_hz {
            let ratio = (frequency_hz.log10() - left.frequency_hz.log10())
                / (right.frequency_hz.log10() - left.frequency_hz.log10());
            let magnitude = left.magnitude_ohm
                + (right.magnitude_ohm - left.magnitude_ohm) * ratio;
            let phase = left.phase_deg + (right.phase_deg - left.phase_deg) * ratio;
            return Complex64::from_polar(magnitude.max(0.001), phase.to_radians());
        }
    }
    Complex64::new(fallback_ohm.max(0.01), 0.0)
}

fn capacitor_impedance(frequency_hz: f64, capacitance_uf: f64) -> Complex64 {
    if capacitance_uf <= 0.0 || frequency_hz <= 0.0 {
        return Complex64::new(1e30, 0.0);
    }
    let omega = 2.0 * PI * frequency_hz;
    Complex64::new(0.0, -1.0 / (omega * capacitance_uf * 1e-6))
}

fn inductor_impedance(frequency_hz: f64, inductance_mh: f64) -> Complex64 {
    let omega = 2.0 * PI * frequency_hz;
    Complex64::new(0.0, omega * inductance_mh.max(0.0) * 1e-3)
}

fn series_matrix(z: Complex64) -> Matrix2 {
    Matrix2 {
        a: Complex64::new(1.0, 0.0),
        b: z,
        c: Complex64::new(0.0, 0.0),
        d: Complex64::new(1.0, 0.0),
    }
}

fn shunt_matrix(z: Complex64) -> Matrix2 {
    let y = if z.norm() <= 1e-18 {
        Complex64::new(1e18, 0.0)
    } else {
        Complex64::new(1.0, 0.0) / z
    };
    Matrix2 {
        a: Complex64::new(1.0, 0.0),
        b: Complex64::new(0.0, 0.0),
        c: y,
        d: Complex64::new(1.0, 0.0),
    }
}

fn active_filter_transfer(element: &ElectricalElement, frequency_hz: f64) -> Option<Complex64> {
    let w = 2.0 * PI * frequency_hz.max(1e-9);
    let s = Complex64::new(0.0, w);

    match element {
        ElectricalElement::HighPass { frequency_hz, q } => {
            let w0 = 2.0 * PI * frequency_hz.max(1e-6);
            let q = q.max(0.05);
            let numerator = s * s;
            let denominator = s * s + s * (w0 / q) + Complex64::new(w0 * w0, 0.0);
            Some(numerator / denominator)
        }
        ElectricalElement::LowPass { frequency_hz, q } => {
            let w0 = 2.0 * PI * frequency_hz.max(1e-6);
            let q = q.max(0.05);
            let numerator = Complex64::new(w0 * w0, 0.0);
            let denominator = s * s + s * (w0 / q) + Complex64::new(w0 * w0, 0.0);
            Some(numerator / denominator)
        }
        ElectricalElement::PeakingEq { frequency_hz, gain_db, q } => {
            let w0 = 2.0 * PI * frequency_hz.max(1e-6);
            let q = q.max(0.05);
            let a = 10_f64.powf(*gain_db / 40.0);
            let numerator = s * s + s * (w0 * a / q) + Complex64::new(w0 * w0, 0.0);
            let denominator = s * s + s * (w0 / (a * q)) + Complex64::new(w0 * w0, 0.0);
            Some(numerator / denominator)
        }
        _ => None,
    }
}

/// Backwards-compatible ordered ladder solver.
pub fn electrical_transfer(
    frequency_hz: f64,
    driver_impedance: Complex64,
    elements: &[ElectricalElement],
) -> Complex64 {
    let mut passive = Matrix2::identity();
    let mut active = Complex64::new(1.0, 0.0);

    for element in elements {
        match element {
            ElectricalElement::SeriesResistor { resistance_ohm } => {
                passive = passive.mul(series_matrix(Complex64::new(
                    resistance_ohm.max(0.0),
                    0.0,
                )));
            }
            ElectricalElement::SeriesCapacitor { capacitance_uf } => {
                passive = passive.mul(series_matrix(capacitor_impedance(
                    frequency_hz,
                    *capacitance_uf,
                )));
            }
            ElectricalElement::SeriesInductor { inductance_mh } => {
                passive = passive.mul(series_matrix(inductor_impedance(
                    frequency_hz,
                    *inductance_mh,
                )));
            }
            ElectricalElement::ParallelResistor { resistance_ohm } => {
                passive = passive.mul(shunt_matrix(Complex64::new(
                    resistance_ohm.max(1e-12),
                    0.0,
                )));
            }
            ElectricalElement::ParallelCapacitor { capacitance_uf } => {
                passive = passive.mul(shunt_matrix(capacitor_impedance(
                    frequency_hz,
                    *capacitance_uf,
                )));
            }
            ElectricalElement::ParallelInductor { inductance_mh } => {
                passive = passive.mul(shunt_matrix(inductor_impedance(
                    frequency_hz,
                    *inductance_mh,
                )));
            }
            _ => {
                if let Some(h) = active_filter_transfer(element, frequency_hz) {
                    active *= h;
                }
            }
        }
    }

    let denominator = passive.a * driver_impedance + passive.b;
    let passive_transfer = if denominator.norm() <= 1e-18 {
        Complex64::new(0.0, 0.0)
    } else {
        driver_impedance / denominator
    };

    passive_transfer * active
}

pub fn active_filters_transfer(elements: &[ElectricalElement], frequency_hz: f64) -> Complex64 {
    let mut result = Complex64::new(1.0, 0.0);
    for element in elements {
        if let Some(h) = active_filter_transfer(element, frequency_hz) {
            result *= h;
        }
    }
    result
}

fn component_impedance(kind: &CircuitComponentKind, frequency_hz: f64) -> Complex64 {
    match kind {
        CircuitComponentKind::Resistor { resistance_ohm } => {
            Complex64::new(resistance_ohm.max(1e-12), 0.0)
        }
        CircuitComponentKind::Capacitor { capacitance_uf } => {
            capacitor_impedance(frequency_hz, *capacitance_uf)
        }
        CircuitComponentKind::Inductor { inductance_mh } => {
            inductor_impedance(frequency_hz, *inductance_mh)
        }
        CircuitComponentKind::Wire => Complex64::new(1e-9, 0.0),
    }
}

fn component_admittance(kind: &CircuitComponentKind, frequency_hz: f64) -> Complex64 {
    let z = component_impedance(kind, frequency_hz);
    if z.norm() <= 1e-24 {
        Complex64::new(1e24, 0.0)
    } else {
        Complex64::new(1.0, 0.0) / z
    }
}

fn add_branch(
    y_matrix: &mut [Vec<Complex64>],
    rhs: &mut [Complex64],
    index: &HashMap<String, usize>,
    fixed: &HashMap<String, Complex64>,
    node_a: &str,
    node_b: &str,
    admittance: Complex64,
) {
    let ia = index.get(node_a).copied();
    let ib = index.get(node_b).copied();
    let va = fixed.get(node_a).copied();
    let vb = fixed.get(node_b).copied();

    if let Some(i) = ia {
        y_matrix[i][i] += admittance;
        if let Some(j) = ib {
            y_matrix[i][j] -= admittance;
        } else if let Some(v) = vb {
            rhs[i] += admittance * v;
        }
    }

    if let Some(j) = ib {
        y_matrix[j][j] += admittance;
        if let Some(i) = ia {
            y_matrix[j][i] -= admittance;
        } else if let Some(v) = va {
            rhs[j] += admittance * v;
        }
    }
}

fn solve_linear_system(
    mut a: Vec<Vec<Complex64>>,
    mut b: Vec<Complex64>,
) -> Option<Vec<Complex64>> {
    let n = b.len();
    if n == 0 {
        return Some(Vec::new());
    }

    for pivot in 0..n {
        let mut best = pivot;
        let mut best_norm = a[pivot][pivot].norm();
        for row in (pivot + 1)..n {
            let norm = a[row][pivot].norm();
            if norm > best_norm {
                best_norm = norm;
                best = row;
            }
        }

        if best_norm <= 1e-20 {
            return None;
        }

        if best != pivot {
            a.swap(best, pivot);
            b.swap(best, pivot);
        }

        let pivot_value = a[pivot][pivot];
        for col in pivot..n {
            a[pivot][col] /= pivot_value;
        }
        b[pivot] /= pivot_value;

        let pivot_row = a[pivot].clone();
        let pivot_rhs = b[pivot];

        for row in 0..n {
            if row == pivot {
                continue;
            }
            let factor = a[row][pivot];
            if factor.norm() <= 1e-30 {
                continue;
            }
            for col in pivot..n {
                a[row][col] -= factor * pivot_row[col];
            }
            b[row] -= factor * pivot_rhs;
        }
    }

    Some(b)
}

/// Solve a true passive R/C/L crossover netlist using complex nodal analysis.
/// The input node is an ideal 1 V source, the ground node is 0 V and the
/// driver's measured complex impedance is connected from output_node to ground.
/// The returned complex value is V_driver / V_input.
pub fn circuit_netlist_transfer(
    frequency_hz: f64,
    driver_impedance: Complex64,
    netlist: &CircuitNetlist,
) -> Complex64 {
    if netlist.output_node == netlist.input_node {
        // Still solve any shunt branches attached to the input/output node only
        // insofar as an ideal voltage source maintains 1 V there. The driver
        // therefore sees exactly the source voltage.
        return Complex64::new(1.0, 0.0);
    }

    let mut node_ids: HashSet<String> = netlist.nodes.iter().map(|n| n.id.clone()).collect();
    node_ids.insert(netlist.input_node.clone());
    node_ids.insert(netlist.output_node.clone());
    node_ids.insert(netlist.ground_node.clone());
    for component in &netlist.components {
        node_ids.insert(component.node_a.clone());
        node_ids.insert(component.node_b.clone());
    }

    let unknown_nodes: Vec<String> = node_ids
        .into_iter()
        .filter(|id| id != &netlist.input_node && id != &netlist.ground_node)
        .collect();

    let index: HashMap<String, usize> = unknown_nodes
        .iter()
        .enumerate()
        .map(|(i, id)| (id.clone(), i))
        .collect();

    let n = unknown_nodes.len();
    let mut y_matrix = vec![vec![Complex64::new(0.0, 0.0); n]; n];
    let mut rhs = vec![Complex64::new(0.0, 0.0); n];

    let mut fixed = HashMap::new();
    fixed.insert(netlist.input_node.clone(), Complex64::new(1.0, 0.0));
    fixed.insert(netlist.ground_node.clone(), Complex64::new(0.0, 0.0));

    for component in &netlist.components {
        if component.bypassed {
            // Bypass means an electrical short between the component terminals.
            add_branch(
                &mut y_matrix,
                &mut rhs,
                &index,
                &fixed,
                &component.node_a,
                &component.node_b,
                Complex64::new(1e12, 0.0),
            );
            continue;
        }

        let y = component_admittance(&component.kind, frequency_hz);
        add_branch(
            &mut y_matrix,
            &mut rhs,
            &index,
            &fixed,
            &component.node_a,
            &component.node_b,
            y,
        );
    }

    // Driver load from output to ground.
    let y_driver = if driver_impedance.norm() <= 1e-18 {
        Complex64::new(1e18, 0.0)
    } else {
        Complex64::new(1.0, 0.0) / driver_impedance
    };
    add_branch(
        &mut y_matrix,
        &mut rhs,
        &index,
        &fixed,
        &netlist.output_node,
        &netlist.ground_node,
        y_driver,
    );

    let solution = match solve_linear_system(y_matrix, rhs) {
        Some(v) => v,
        None => return Complex64::new(0.0, 0.0),
    };

    if netlist.output_node == netlist.input_node {
        Complex64::new(1.0, 0.0)
    } else if let Some(output_index) = index.get(&netlist.output_node) {
        solution[*output_index]
    } else {
        Complex64::new(0.0, 0.0)
    }
}
