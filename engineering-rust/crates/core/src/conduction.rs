//! Vector-independent scalar FEM: steady thermal conduction on actual CAD tetrahedra.
use crate::mesh::{Mesh, dot};
use crate::sparse::Matrix;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
pub fn thermal_settings() -> Value {
    json!({"id":"hc-thermal-fem-1","library":"HammerCraft Rust","version":crate::VERSION,"linearSolver":"Jacobi CG","element":"TetP1","relativeTolerance":1e-10,"absoluteTolerance":1e-12,"maxIterations":5000})
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThermalRequest {
    pub kind: String,
    pub mesh: Mesh,
    pub conductivity: f64,
    pub heat_generation: f64,
    pub boundaries: Vec<ThermalBoundary>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type")]
pub enum ThermalBoundary {
    #[serde(rename = "temperature")]
    Temperature { tag: u32, temperature: f64 },
    #[serde(rename = "convection")]
    Convection {
        tag: u32,
        ambient: f64,
        coefficient: f64,
    },
}
impl ThermalBoundary {
    fn tag(&self) -> u32 {
        match self {
            Self::Temperature { tag, .. } | Self::Convection { tag, .. } => *tag,
        }
    }
    fn reference(&self) -> f64 {
        match self {
            Self::Temperature { temperature, .. } => *temperature,
            Self::Convection { ambient, .. } => *ambient,
        }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThermalSolution {
    pub solver: Value,
    pub temperatures: Vec<f64>,
    pub gradients: Vec<f64>,
    pub heat_flux: Vec<f64>,
    pub iterations: usize,
    pub residual: f64,
    pub balance: Balance,
    pub volume_mean_temperature: f64,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Balance {
    pub generated: f64,
    pub fixed_outward: f64,
    pub convection_outward: f64,
    pub error: f64,
}
pub fn solve_thermal(
    q: &ThermalRequest,
    status: &mut impl FnMut(&str),
) -> Result<ThermalSolution, String> {
    if q.kind != "thermal-tetra"
        || !q.conductivity.is_finite()
        || !(1e-6..=1e6).contains(&q.conductivity)
        || !q.heat_generation.is_finite()
        || q.heat_generation.abs() > 1e12
        || q.boundaries.is_empty()
        || q.boundaries.len() > 128
    {
        return Err("Invalid thermal FEM request.".into());
    }
    status("Preparing");
    let cells = q.mesh.prepare()?;
    let n = q.mesh.nodes.len() / 3;
    let mut a = Matrix::new(n);
    let mut rhs = vec![0.; n];
    let mut volume = 0.;
    for cell in &cells {
        volume += cell.volume;
        for i in 0..4 {
            rhs[cell.ids[i]] += q.heat_generation * cell.volume / 4.;
            for j in 0..4 {
                a.add(
                    cell.ids[i],
                    cell.ids[j],
                    q.conductivity * cell.volume * dot(cell.gradients[i], cell.gradients[j]),
                );
            }
        }
    }
    let mut fixed = BTreeMap::new();
    let mut used = BTreeSet::new();
    let mut convection = Vec::new();
    for bc in &q.boundaries {
        let tag = bc.tag();
        if !used.insert(tag) {
            return Err("Conditions must reference distinct surfaces.".into());
        }
        let g = q
            .mesh
            .boundary
            .iter()
            .find(|g| g.tag == tag)
            .ok_or("Unknown boundary surface.")?;
        let temperature = bc.reference();
        if !temperature.is_finite() || !(0. ..=5000.).contains(&temperature) {
            return Err("Invalid thermal boundary temperature.".into());
        }
        match bc {
            ThermalBoundary::Temperature { temperature, .. } => {
                for node in &g.triangles {
                    if let Some(old) = fixed.insert(*node, *temperature)
                        && (old - temperature).abs() > 1e-8
                    {
                        return Err("Different fixed temperatures meet at shared nodes. Choose non-touching surfaces or equal temperatures.".into());
                    }
                }
            }
            ThermalBoundary::Convection {
                ambient,
                coefficient,
                ..
            } => {
                if !coefficient.is_finite() || !(1e-6..=1e8).contains(coefficient) {
                    return Err("Invalid convection coefficient.".into());
                }
                let mut load = vec![0.; n];
                for t in g.triangles.as_chunks::<3>().0 {
                    let area = q.mesh.area(t);
                    for i in 0..3 {
                        rhs[t[i]] += coefficient * ambient * area / 3.;
                        load[t[i]] += area / 3.;
                        for j in 0..3 {
                            a.add(
                                t[i],
                                t[j],
                                coefficient * area / 12. * if i == j { 2. } else { 1. },
                            );
                        }
                    }
                }
                convection.push((*coefficient, *ambient, load));
            }
        }
    }
    let reference = q
        .boundaries
        .iter()
        .map(ThermalBoundary::reference)
        .sum::<f64>()
        / q.boundaries.len() as f64;
    status("Solving");
    let (t, iterations, residual) = a.solve(&rhs, &fixed, reference)?;
    if t.iter().any(|v| *v < 0. || *v > 1e7) {
        return Err("Nonphysical temperatures; no result retained.".into());
    }
    status("Post-processing");
    let mut gradients = Vec::with_capacity(cells.len() * 3);
    let mut heat_flux = Vec::with_capacity(cells.len() * 3);
    let mut weighted = 0.;
    for cell in &cells {
        let mut grad = [0.; 3];
        for i in 0..4 {
            for (a, value) in grad.iter_mut().enumerate() {
                *value += (t[cell.ids[i]] - t[cell.ids[0]]) * cell.gradients[i][a];
            }
            weighted += t[cell.ids[i]] * cell.volume / 4.;
        }
        gradients.extend(grad);
        heat_flux.extend(grad.map(|v| -q.conductivity * v));
    }
    let ax = a.multiply(&t);
    let fixed_outward = -fixed.keys().map(|i| ax[*i] - rhs[*i]).sum::<f64>();
    let convection_outward = convection
        .iter()
        .map(|(h, ambient, load)| {
            h * load
                .iter()
                .zip(&t)
                .map(|(w, t)| w * (t - ambient))
                .sum::<f64>()
        })
        .sum::<f64>();
    let generated = q.heat_generation * volume;
    let error = fixed_outward + convection_outward - generated;
    let scale = fixed_outward
        .abs()
        .max(convection_outward.abs())
        .max(generated.abs())
        .max(1.);
    if !error.is_finite() || error.abs() > 1e-7 * scale {
        return Err("Thermal energy balance failed.".into());
    }
    Ok(ThermalSolution {
        solver: thermal_settings(),
        temperatures: t,
        gradients,
        heat_flux,
        iterations,
        residual,
        balance: Balance {
            generated,
            fixed_outward,
            convection_outward,
            error,
        },
        volume_mean_temperature: weighted / volume,
    })
}
