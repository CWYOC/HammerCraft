//! Small-strain isotropic vector-P1 elasticity on the shared tetrahedral mesh.
use crate::{
    mesh::{Mesh, cross, dot, norm, sub},
    sparse::Matrix,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

pub fn settings() -> Value {
    json!({"id":"hc-structural-fem-1","library":"HammerCraft Rust","version":crate::VERSION,"linearSolver":"Jacobi CG","element":"VectorTetP1","relativeTolerance":1e-10,"absoluteTolerance":1e-12,"maxIterations":10000})
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub kind: String,
    pub mesh: Mesh,
    pub young_modulus: f64,
    pub poisson_ratio: f64,
    pub density: f64,
    pub yield_strength: Option<f64>,
    pub gravity: [f64; 3],
    pub boundaries: Vec<Boundary>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Boundary {
    Fixed { tag: u32 },
    Displacement { tag: u32, values: [Option<f64>; 3] },
    Force { tag: u32, values: [f64; 3] },
    Pressure { tag: u32, pressure: f64 },
}
impl Boundary {
    fn tag(&self) -> u32 {
        match self {
            Self::Fixed { tag }
            | Self::Displacement { tag, .. }
            | Self::Force { tag, .. }
            | Self::Pressure { tag, .. } => *tag,
        }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Balance {
    pub origin: [f64; 3],
    pub applied_force: [f64; 3],
    pub reaction_force: [f64; 3],
    pub applied_moment: [f64; 3],
    pub reaction_moment: [f64; 3],
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Solution {
    pub solver: Value,
    pub displacements: Vec<f64>,
    pub reactions: Vec<f64>,
    pub strains: Vec<f64>,
    pub stresses: Vec<f64>,
    pub principal: Vec<f64>,
    pub von_mises: Vec<f64>,
    pub strain_energy: f64,
    pub iterations: usize,
    pub residual: f64,
    pub balance: Balance,
    pub max_strain: f64,
    pub max_displacement_ratio: f64,
}
fn bounded(v: f64, lo: f64, hi: f64, label: &str) -> Result<(), String> {
    if !v.is_finite() || !(lo..=hi).contains(&v) {
        Err(format!("Invalid {label}; expected {lo}–{hi} in SI units."))
    } else {
        Ok(())
    }
}

// Eigenvalues of a real symmetric 3×3 tensor, scaled before computing its invariants.
// Packed order: xx, yy, zz, xy, yz, xz; tensor shear, not engineering shear.
pub fn principal(t: [f64; 6]) -> [f64; 3] {
    let scale = t.iter().fold(0_f64, |s, v| s.max(v.abs()));
    if scale == 0. {
        return [0.; 3];
    }
    let a = t.map(|v| v / scale);
    let q = (a[0] + a[1] + a[2]) / 3.;
    let mut b = a;
    for v in &mut b[..3] {
        *v -= q;
    }
    let p = ((b[0] * b[0]
        + b[1] * b[1]
        + b[2] * b[2]
        + 2. * (b[3] * b[3] + b[4] * b[4] + b[5] * b[5]))
        / 6.)
        .sqrt();
    if p < 1e-16 {
        return [q * scale; 3];
    }
    let b = b.map(|v| v / p);
    let det = b[0] * b[1] * b[2] + 2. * b[3] * b[4] * b[5]
        - b[0] * b[4] * b[4]
        - b[1] * b[5] * b[5]
        - b[2] * b[3] * b[3];
    let phi = (det / 2.).clamp(-1., 1.).acos() / 3.;
    let hi = q + 2. * p * phi.cos();
    let lo = q + 2. * p * (phi + 2. * std::f64::consts::PI / 3.).cos();
    let mut values = [hi * scale, (3. * q - hi - lo) * scale, lo * scale];
    values.sort_by(|a, b| b.total_cmp(a));
    values
}
fn restraint_rank(mesh: &Mesh, fixed: &BTreeMap<usize, f64>, origin: [f64; 3], span: f64) -> usize {
    let mut basis: Vec<[f64; 6]> = Vec::new();
    for dof in fixed.keys() {
        let axis = dof % 3;
        let r = sub(mesh.point(dof / 3), origin).map(|v| v / span);
        let rotation = [[0., -r[2], r[1]], [r[2], 0., -r[0]], [-r[1], r[0], 0.]];
        let mut row = [0.; 6];
        row[axis] = 1.;
        for j in 0..3 {
            row[3 + j] = rotation[j][axis];
        }
        for _ in 0..2 {
            for b in &basis {
                let projection = row.iter().zip(b).map(|(x, y)| x * y).sum::<f64>();
                for j in 0..6 {
                    row[j] -= projection * b[j];
                }
            }
        }
        let length = row.iter().map(|v| v * v).sum::<f64>().sqrt();
        if length > 1e-10 {
            basis.push(row.map(|v| v / length));
        }
        if basis.len() == 6 {
            break;
        }
    }
    basis.len()
}
pub fn solve(q: &Request, status: &mut impl FnMut(&str)) -> Result<Solution, String> {
    if q.kind != "structural-tetra" {
        return Err("Unsupported structural compute job.".into());
    }
    bounded(q.young_modulus, 1e3, 1e13, "Young modulus")?;
    bounded(q.poisson_ratio, -0.99, 0.49, "Poisson ratio")?;
    bounded(q.density, 1e-9, 1e6, "density")?;
    if let Some(v) = q.yield_strength {
        bounded(v, 1e-9, 1e15, "yield strength")?;
    }
    for g in q.gravity {
        bounded(g, -1e6, 1e6, "gravity")?;
    }
    if q.boundaries.is_empty() || q.boundaries.len() > 128 {
        return Err("Assign 1–128 structural surface conditions.".into());
    }
    status("Preparing");
    let cells = q.mesh.prepare()?;
    let n = q.mesh.nodes.len() / 3;
    let mut origin = [0.; 3];
    let mut lo = [f64::INFINITY; 3];
    let mut hi = [f64::NEG_INFINITY; 3];
    for i in 0..n {
        let p = q.mesh.point(i);
        for a in 0..3 {
            origin[a] += p[a] / n as f64;
            lo[a] = lo[a].min(p[a]);
            hi[a] = hi[a].max(p[a]);
        }
    }
    let span = norm(sub(hi, lo));
    let mut fixed = BTreeMap::new();
    let mut used = BTreeSet::new();
    let mut loads = vec![0.; n * 3];
    for c in &cells {
        for node in c.ids {
            for a in 0..3 {
                loads[node * 3 + a] += q.gravity[a] * q.density * c.volume / 4.;
            }
        }
    }
    for bc in &q.boundaries {
        let tag = bc.tag();
        if !used.insert(tag) {
            return Err("Conditions must reference distinct mesh surfaces.".into());
        }
        let g = q
            .mesh
            .boundary
            .iter()
            .find(|g| g.tag == tag)
            .ok_or("Unknown structural mesh surface.")?;
        match bc {
            Boundary::Fixed { .. } | Boundary::Displacement { .. } => {
                let values = match bc {
                    Boundary::Displacement { values, .. } => *values,
                    _ => [Some(0.); 3],
                };
                if values.iter().all(Option::is_none) {
                    return Err("Prescribe at least one displacement component.".into());
                }
                for (axis, value) in values.iter().enumerate() {
                    if let Some(value) = value {
                        bounded(*value, -1000., 1000., "prescribed displacement")?;
                        for node in &g.triangles {
                            if let Some(old) = fixed.insert(node * 3 + axis, *value)
                                && (old - value).abs() > 1e-12
                            {
                                return Err(
                                    "Conflicting prescribed displacements meet at shared nodes."
                                        .into(),
                                );
                            }
                        }
                    }
                }
            }
            Boundary::Force { .. } | Boundary::Pressure { .. } => {
                let area = g
                    .triangles
                    .as_chunks::<3>()
                    .0
                    .iter()
                    .map(|t| q.mesh.area(t))
                    .sum::<f64>();
                match bc {
                    Boundary::Force { values, .. } => {
                        for v in values {
                            bounded(*v, -1e12, 1e12, "surface force")?;
                        }
                    }
                    Boundary::Pressure { pressure, .. } => {
                        bounded(*pressure, -1e12, 1e12, "surface pressure")?
                    }
                    _ => unreachable!(),
                };
                for t in g.triangles.as_chunks::<3>().0 {
                    let p = t.map(|i| q.mesh.point(i));
                    let normal = cross(sub(p[1], p[0]), sub(p[2], p[0])).map(|v| v / 2.);
                    let a = norm(normal);
                    let force = match bc {
                        Boundary::Force { values, .. } => values.map(|v| v * a / area),
                        Boundary::Pressure { pressure, .. } => normal.map(|v| -pressure * v),
                        _ => unreachable!(),
                    };
                    for node in t {
                        for axis in 0..3 {
                            loads[node * 3 + axis] += force[axis] / 3.;
                        }
                    }
                }
            }
        }
    }
    if restraint_rank(&q.mesh, &fixed, origin, span) < 6 {
        return Err("The solid is under-constrained: remove all six rigid-body motions using fixed or prescribed displacement surfaces.".into());
    }
    let mu = q.young_modulus / (2. * (1. + q.poisson_ratio));
    let lambda =
        q.young_modulus * q.poisson_ratio / ((1. + q.poisson_ratio) * (1. - 2. * q.poisson_ratio));
    let mut stiffness = Matrix::new(n * 3);
    for c in &cells {
        for i in 0..4 {
            for j in 0..4 {
                let gi = c.gradients[i];
                let gj = c.gradients[j];
                for a in 0..3 {
                    for b in 0..3 {
                        let value = c.volume
                            * (lambda * gi[a] * gj[b]
                                + mu * gi[b] * gj[a]
                                + if a == b { mu * dot(gi, gj) } else { 0. });
                        stiffness.add(c.ids[i] * 3 + a, c.ids[j] * 3 + b, value);
                    }
                }
            }
        }
    }
    status("Solving");
    let (u, iterations, residual) = stiffness.solve_with_limit(&loads, &fixed, 0., 10000)?;
    status("Post-processing");
    let residual_vector = stiffness.multiply(&u);
    let mut reactions = vec![0.; n * 3];
    for dof in fixed.keys() {
        reactions[*dof] = residual_vector[*dof] - loads[*dof];
    }
    let mut strains = Vec::with_capacity(cells.len() * 6);
    let mut stresses = Vec::with_capacity(cells.len() * 6);
    let mut principal_values = Vec::with_capacity(cells.len() * 3);
    let mut von_mises = Vec::with_capacity(cells.len());
    let mut strain_energy = 0.;
    let mut max_strain = 0_f64;
    for c in &cells {
        let mut gradient = [[0.; 3]; 3];
        for (a, row) in gradient.iter_mut().enumerate() {
            for (b, value) in row.iter_mut().enumerate() {
                for i in 0..4 {
                    *value += (u[c.ids[i] * 3 + a] - u[c.ids[0] * 3 + a]) * c.gradients[i][b];
                }
            }
        }
        let e = [
            gradient[0][0],
            gradient[1][1],
            gradient[2][2],
            (gradient[0][1] + gradient[1][0]) / 2.,
            (gradient[1][2] + gradient[2][1]) / 2.,
            (gradient[0][2] + gradient[2][0]) / 2.,
        ];
        let trace = e[0] + e[1] + e[2];
        let s = std::array::from_fn::<_, 6, _>(|i| {
            2. * mu * e[i] + if i < 3 { lambda * trace } else { 0. }
        });
        let vm = (((s[0] - s[1]).powi(2) + (s[1] - s[2]).powi(2) + (s[2] - s[0]).powi(2)) / 2.
            + 3. * (s[3] * s[3] + s[4] * s[4] + s[5] * s[5]))
            .sqrt();
        strain_energy += 0.5
            * c.volume
            * (0..6)
                .map(|i| e[i] * s[i] * if i < 3 { 1. } else { 2. })
                .sum::<f64>();
        for v in principal(e) {
            max_strain = max_strain.max(v.abs());
        }
        strains.extend(e);
        stresses.extend(s);
        principal_values.extend(principal(s));
        von_mises.push(vm);
    }
    let mut balance = Balance {
        origin,
        applied_force: [0.; 3],
        reaction_force: [0.; 3],
        applied_moment: [0.; 3],
        reaction_moment: [0.; 3],
    };
    let mut applied_scale = 0.;
    let mut reaction_scale = 0.;
    let mut max_displacement = 0_f64;
    for i in 0..n {
        let applied = std::array::from_fn(|a| loads[i * 3 + a]);
        let reaction = std::array::from_fn(|a| reactions[i * 3 + a]);
        let position = sub(q.mesh.point(i), origin);
        let ma = cross(position, applied);
        let mr = cross(position, reaction);
        applied_scale += norm(applied);
        reaction_scale += norm(reaction);
        max_displacement = max_displacement.max(norm(std::array::from_fn(|a| u[i * 3 + a])));
        for a in 0..3 {
            balance.applied_force[a] += applied[a];
            balance.reaction_force[a] += reaction[a];
            balance.applied_moment[a] += ma[a];
            balance.reaction_moment[a] += mr[a];
        }
    }
    let scale = applied_scale.max(reaction_scale).max(1e-9);
    if norm(std::array::from_fn(|a| {
        balance.applied_force[a] + balance.reaction_force[a]
    })) > 1e-6 * scale
        || norm(std::array::from_fn(|a| {
            balance.applied_moment[a] + balance.reaction_moment[a]
        })) > 1e-6 * scale * span
    {
        return Err("Structural force or moment balance failed.".into());
    }
    if !strain_energy.is_finite()
        || strain_energy < 0.
        || strains
            .iter()
            .chain(&stresses)
            .chain(&principal_values)
            .chain(&von_mises)
            .chain(&reactions)
            .any(|v| !v.is_finite())
    {
        return Err("Invalid structural energy or fields.".into());
    }
    Ok(Solution {
        solver: settings(),
        displacements: u,
        reactions,
        strains,
        stresses,
        principal: principal_values,
        von_mises,
        strain_energy,
        iterations,
        residual,
        balance,
        max_strain,
        max_displacement_ratio: max_displacement / span,
    })
}
