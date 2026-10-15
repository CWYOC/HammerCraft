//! DC current conduction: div(sigma grad V)=0; positive terminal current enters the solid.
use crate::{
    mesh::{Mesh, dot},
    sparse::Matrix,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
pub fn settings() -> Value {
    json!({"id":"hc-electric-fem-1","library":"HammerCraft Rust","version":crate::VERSION,"linearSolver":"Jacobi CG","element":"TetP1","relativeTolerance":1e-10,"absoluteTolerance":1e-12,"maxIterations":5000})
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Request {
    pub kind: String,
    pub mesh: Mesh,
    pub conductivity: f64,
    pub boundaries: Vec<Boundary>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type")]
pub enum Boundary {
    #[serde(rename = "voltage")]
    Voltage { tag: u32, voltage: f64 },
    #[serde(rename = "current")]
    Current { tag: u32, current: f64 },
}
impl Boundary {
    fn tag(&self) -> u32 {
        match self {
            Self::Voltage { tag, .. } | Self::Current { tag, .. } => *tag,
        }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Terminal {
    pub tag: u32,
    pub kind: String,
    pub mean_voltage: f64,
    pub inward_current: f64,
    pub input_power: f64,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Solution {
    pub solver: Value,
    pub potentials: Vec<f64>,
    pub electric_field: Vec<f64>,
    pub current_density: Vec<f64>,
    pub joule_density: Vec<f64>,
    pub terminals: Vec<Terminal>,
    pub joule_power: f64,
    pub input_power: f64,
    pub current_balance: f64,
    pub power_balance: f64,
    pub iterations: usize,
    pub residual: f64,
}
pub fn solve(q: &Request, status: &mut impl FnMut(&str)) -> Result<Solution, String> {
    if q.kind != "electric-tetra"
        || !q.conductivity.is_finite()
        || !(1e-12..=1e10).contains(&q.conductivity)
        || q.boundaries.is_empty()
        || q.boundaries.len() > 128
    {
        return Err("Invalid constant conductivity or electrical conditions.".into());
    }
    status("Preparing");
    let cells = q.mesh.prepare()?;
    let n = q.mesh.nodes.len() / 3;
    let mut a = Matrix::new(n);
    for c in &cells {
        for i in 0..4 {
            for j in 0..4 {
                a.add(
                    c.ids[i],
                    c.ids[j],
                    q.conductivity * c.volume * dot(c.gradients[i], c.gradients[j]),
                );
            }
        }
    }
    let mut fixed = BTreeMap::new();
    let mut rhs = vec![0.; n];
    let mut tags = BTreeSet::new();
    let mut weights = BTreeMap::new();
    let mut voltage_nodes = BTreeMap::new();
    let mut reference = None;
    for b in &q.boundaries {
        let tag = b.tag();
        if !tags.insert(tag) {
            return Err("Assign each electrical surface once.".into());
        }
        let g = q
            .mesh
            .boundary
            .iter()
            .find(|g| g.tag == tag)
            .ok_or("Unknown electrical surface.")?;
        let area = g
            .triangles
            .as_chunks::<3>()
            .0
            .iter()
            .map(|t| q.mesh.area(t))
            .sum::<f64>();
        let mut weight = BTreeMap::new();
        for t in g.triangles.as_chunks::<3>().0 {
            let w = q.mesh.area(t) / area / 3.;
            for i in t {
                *weight.entry(*i).or_insert(0.) += w;
            }
        }
        match b {
            Boundary::Voltage { voltage, .. } => {
                if !voltage.is_finite() || voltage.abs() > 1e9 {
                    return Err("Voltage must be finite and within ±1e9 V.".into());
                }
                reference.get_or_insert(*voltage);
                for i in weight.keys() {
                    if fixed.insert(*i, *voltage).is_some() {
                        return Err("Voltage terminals touch at shared nodes. Choose separate non-touching surfaces.".into());
                    }
                }
                voltage_nodes.insert(tag, weight.keys().copied().collect::<Vec<_>>());
            }
            Boundary::Current { current, .. } => {
                if !current.is_finite() || current.abs() > 1e12 {
                    return Err("Current must be finite and within ±1e12 A.".into());
                }
                for (i, w) in &weight {
                    rhs[*i] += current * w;
                }
            }
        }
        weights.insert(tag, weight);
    }
    let reference =
        reference.ok_or("Assign at least one voltage terminal to set the potential reference.")?;
    status("Solving");
    let (v, iterations, residual) = a.solve(&rhs, &fixed, reference)?;
    status("Post-processing");
    let mut electric_field = Vec::new();
    let mut current_density = Vec::new();
    let mut joule_density = Vec::new();
    let mut joule_power = 0.;
    for c in &cells {
        let mut e = [0.; 3];
        for i in 0..4 {
            for (d, value) in e.iter_mut().enumerate() {
                *value -= (v[c.ids[i]] - v[c.ids[0]]) * c.gradients[i][d];
            }
        }
        let heat = q.conductivity * dot(e, e);
        electric_field.extend(e);
        current_density.extend(e.map(|x| q.conductivity * x));
        joule_density.push(heat);
        joule_power += heat * c.volume;
    }
    // Evaluate reactions relative to the reference to avoid cancellation from a gauge offset.
    let shifted: Vec<_> = v.iter().map(|x| x - reference).collect();
    let ax = a.multiply(&shifted);
    let mut terminals = Vec::new();
    for b in &q.boundaries {
        let tag = b.tag();
        let mean_voltage = weights[&tag].iter().map(|(i, w)| v[*i] * w).sum::<f64>();
        let (kind, inward_current, input_power) = match b {
            Boundary::Voltage { .. } => {
                let nodes = &voltage_nodes[&tag];
                (
                    "voltage",
                    nodes.iter().map(|i| ax[*i] - rhs[*i]).sum::<f64>(),
                    nodes
                        .iter()
                        .map(|i| v[*i] * (ax[*i] - rhs[*i]))
                        .sum::<f64>(),
                )
            }
            Boundary::Current { current, .. } => ("current", *current, current * mean_voltage),
        };
        terminals.push(Terminal {
            tag,
            kind: kind.into(),
            mean_voltage,
            inward_current,
            input_power,
        });
    }
    let current_balance = terminals.iter().map(|t| t.inward_current).sum::<f64>();
    let input_power = terminals.iter().map(|t| t.input_power).sum::<f64>();
    let power_balance = input_power - joule_power;
    let current_scale = terminals
        .iter()
        .map(|t| t.inward_current.abs())
        .sum::<f64>()
        .max(1e-12);
    let power_scale = terminals
        .iter()
        .map(|t| t.input_power.abs())
        .sum::<f64>()
        .max(joule_power)
        .max(1e-12);
    if !joule_power.is_finite()
        || !current_balance.is_finite()
        || current_balance.abs() > 1e-8 + 1e-7 * current_scale
        || !power_balance.is_finite()
        || power_balance.abs() > 1e-9 + 1e-7 * power_scale
    {
        return Err("Electrical current or power balance failed.".into());
    }
    Ok(Solution {
        solver: settings(),
        potentials: v,
        electric_field,
        current_density,
        joule_density,
        terminals,
        joule_power,
        input_power,
        current_balance,
        power_balance,
        iterations,
        residual,
    })
}
