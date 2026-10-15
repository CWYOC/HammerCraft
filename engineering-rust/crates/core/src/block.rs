//! Conservative cell-centred block conduction. SI inputs, Jacobi-preconditioned CG.
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub size: [f64; 3],
    pub cells: [usize; 3],
    pub axis: usize,
    pub conductivity: f64,
    pub heat_generation: f64,
    pub boundaries: [Boundary; 2],
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Boundary {
    #[serde(rename = "type")]
    pub kind: String,
    pub temperature: f64,
    pub coefficient: Option<f64>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Solution {
    pub temperatures: Vec<f64>,
    pub iterations: usize,
    pub residual: f64,
}
fn dot(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}
pub fn solve(q: &Request, progress: &mut impl FnMut(usize, f64)) -> Result<Solution, String> {
    if q.axis > 2
        || q.size
            .iter()
            .any(|v| !v.is_finite() || *v <= 0. || *v > 1000.)
        || q.cells.iter().any(|v| *v < 2 || *v > 100)
        || q.cells.iter().product::<usize>() > 50000
        || !q.conductivity.is_finite()
        || q.conductivity <= 0.
        || q.conductivity > 1e6
        || !q.heat_generation.is_finite()
        || q.heat_generation.abs() > 1e12
    {
        return Err("Invalid block thermal inputs.".into());
    }
    let spacing = std::array::from_fn::<_, 3, _>(|a| q.size[a] / q.cells[a] as f64);
    let volume: f64 = spacing.iter().product();
    let distance = spacing[q.axis];
    let area = volume / distance;
    let mut transfers = [0.; 2];
    for (i, b) in q.boundaries.iter().enumerate() {
        if !b.temperature.is_finite() || b.temperature < 0. || b.temperature > 5000. {
            return Err("Invalid boundary temperature.".into());
        }
        transfers[i] = match b.kind.as_str() {
            "temperature" => 2. * q.conductivity * volume / distance.powi(2),
            "convection" => {
                let h = b.coefficient.ok_or("Convection coefficient is missing.")?;
                if !h.is_finite() || h <= 0. || h > 1e8 {
                    return Err("Invalid convection coefficient.".into());
                }
                area / (distance / (2. * q.conductivity) + 1. / h)
            }
            _ => return Err("Unsupported block boundary.".into()),
        };
    }
    let n = q.cells.iter().product();
    let strides = [1, q.cells[0], q.cells[0] * q.cells[1]];
    let g = spacing.map(|h| q.conductivity * volume / (h * h));
    let mut diagonal = vec![0.; n];
    let mut rhs = vec![q.heat_generation * volume; n];
    for p in 0..n {
        for a in 0..3 {
            let coord = (p / strides[a]) % q.cells[a];
            for (side, transfer) in transfers.iter().enumerate() {
                if if side == 0 {
                    coord > 0
                } else {
                    coord < q.cells[a] - 1
                } {
                    diagonal[p] += g[a];
                } else if a == q.axis {
                    diagonal[p] += transfer;
                    rhs[p] += transfer * q.boundaries[side].temperature;
                }
            }
        }
    }
    let multiply = |x: &[f64], out: &mut [f64]| {
        for p in 0..n {
            let mut value = 0.;
            for a in 0..3 {
                let coord = (p / strides[a]) % q.cells[a];
                if coord > 0 {
                    value += g[a] * (x[p] - x[p - strides[a]]);
                } else if a == q.axis {
                    value += transfers[0] * x[p];
                }
                if coord < q.cells[a] - 1 {
                    value += g[a] * (x[p] - x[p + strides[a]]);
                } else if a == q.axis {
                    value += transfers[1] * x[p];
                }
            }
            out[p] = value;
        }
    };
    let mut t = vec![(q.boundaries[0].temperature + q.boundaries[1].temperature) / 2.; n];
    let mut ap = vec![0.; n];
    multiply(&t, &mut ap);
    let mut r: Vec<_> = rhs.iter().zip(&ap).map(|(b, a)| b - a).collect();
    let mut z: Vec<_> = r.iter().zip(&diagonal).map(|(r, d)| r / d).collect();
    let mut p = z.clone();
    let norm = dot(&rhs, &rhs).sqrt().max(1e-30);
    let mut rz = dot(&r, &z);
    let mut residual = dot(&r, &r).sqrt() / norm;
    let mut iterations = 0;
    while residual > 1e-10 && iterations < 6000 {
        multiply(&p, &mut ap);
        let denominator = dot(&p, &ap);
        if denominator <= 0. || !denominator.is_finite() {
            return Err("Thermal system became ill-conditioned. Reduce mesh aspect ratio.".into());
        }
        let alpha = rz / denominator;
        for i in 0..n {
            t[i] += alpha * p[i];
            r[i] -= alpha * ap[i];
            z[i] = r[i] / diagonal[i];
        }
        let next = dot(&r, &z);
        let beta = next / rz;
        for i in 0..n {
            p[i] = z[i] + beta * p[i];
        }
        rz = next;
        residual = dot(&r, &r).sqrt() / norm;
        iterations += 1;
        if iterations % 20 == 0 {
            progress(iterations, residual);
        }
    }
    multiply(&t, &mut ap);
    for i in 0..n {
        r[i] = rhs[i] - ap[i];
    }
    residual = dot(&r, &r).sqrt() / norm;
    if !residual.is_finite() || residual > 5e-10 {
        return Err(format!(
            "Solver did not converge ({iterations} iterations). Try a coarser mesh or review extreme geometry and conductivity-to-convection ratios."
        ));
    }
    if t.iter().any(|v| !v.is_finite() || *v < 0.) {
        return Err("Solution contains invalid absolute temperatures. Check heat generation and boundary values.".into());
    }
    Ok(Solution {
        temperatures: t,
        iterations,
        residual,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn linear_patch_all_axes() {
        for axis in 0..3 {
            let q = Request {
                size: [0.06, 0.02, 0.01],
                cells: [12, 6, 6],
                axis,
                conductivity: 167.,
                heat_generation: 0.,
                boundaries: [
                    Boundary {
                        kind: "temperature".into(),
                        temperature: 353.15,
                        coefficient: None,
                    },
                    Boundary {
                        kind: "temperature".into(),
                        temperature: 293.15,
                        coefficient: None,
                    },
                ],
            };
            let r = solve(&q, &mut |_, _| {}).unwrap();
            let stride = [1, 12, 72][axis];
            for (i, t) in r.temperatures.iter().enumerate() {
                let x = ((i / stride) % q.cells[axis]) as f64 + 0.5;
                let exact = 353.15 - 60. * x / q.cells[axis] as f64;
                assert!((t - exact).abs() < 1e-7);
            }
        }
    }
}
