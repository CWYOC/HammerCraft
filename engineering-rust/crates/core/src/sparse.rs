//! Sorted sparse rows and deterministic Jacobi-preconditioned conjugate gradients.
use std::collections::BTreeMap;
pub struct Matrix {
    pub rows: Vec<BTreeMap<usize, f64>>,
}
impl Matrix {
    pub fn new(n: usize) -> Self {
        Self {
            rows: vec![BTreeMap::new(); n],
        }
    }
    pub fn add(&mut self, i: usize, j: usize, v: f64) {
        *self.rows[i].entry(j).or_default() += v;
    }
    pub fn multiply(&self, x: &[f64]) -> Vec<f64> {
        self.rows
            .iter()
            .map(|r| r.iter().map(|(j, v)| v * x[*j]).sum())
            .collect()
    }
    pub fn solve(
        &self,
        rhs: &[f64],
        fixed: &BTreeMap<usize, f64>,
        reference: f64,
    ) -> Result<(Vec<f64>, usize, f64), String> {
        self.solve_with_limit(rhs, fixed, reference, 5000)
    }
    pub fn solve_with_limit(
        &self,
        rhs: &[f64],
        fixed: &BTreeMap<usize, f64>,
        reference: f64,
        max_iterations: usize,
    ) -> Result<(Vec<f64>, usize, f64), String> {
        let n = self.rows.len();
        let free: Vec<_> = (0..n).filter(|i| !fixed.contains_key(i)).collect();
        let mut x = vec![0.; n];
        for (i, v) in fixed {
            x[*i] = v - reference;
        }
        let reference_vec = vec![reference; n];
        let base = self.multiply(&reference_vec);
        let initial = self.multiply(&x);
        let mut r = vec![0.; n];
        let mut p = vec![0.; n];
        let mut z = vec![0.; n];
        let mut diagonal = vec![1.; n];
        let mut rhs2 = 0.;
        for i in &free {
            let d = *self.rows[*i].get(i).ok_or("Missing stiffness diagonal.")?;
            if !d.is_finite() || d <= 0. {
                return Err("The FEM system is not positive definite.".into());
            }
            diagonal[*i] = d;
            r[*i] = rhs[*i] - base[*i] - initial[*i];
            z[*i] = r[*i] / d;
            p[*i] = z[*i];
            rhs2 += r[*i] * r[*i];
        }
        let norm = rhs2.sqrt();
        let tolerance = (1e-10 * norm).max(1e-12);
        let mut rz = dot(&r, &z);
        let mut iterations = 0;
        while dot(&r, &r).sqrt() > tolerance && iterations < max_iterations {
            let ap = self.multiply(&p);
            let denom = dot(&p, &ap);
            if !denom.is_finite() || denom <= 0. {
                return Err("FEM became ill-conditioned.".into());
            }
            let alpha = rz / denom;
            for i in &free {
                x[*i] += alpha * p[*i];
                r[*i] -= alpha * ap[*i];
                z[*i] = r[*i] / diagonal[*i];
            }
            let next = dot(&r, &z);
            let beta = next / rz;
            for i in &free {
                p[*i] = z[*i] + beta * p[*i];
            }
            rz = next;
            iterations += 1;
        }
        if dot(&r, &r).sqrt() > tolerance {
            return Err(
                "FEM CG did not converge. Refine poor cells or reduce material/boundary contrast."
                    .into(),
            );
        }
        for v in &mut x {
            *v += reference;
        }
        let ax = self.multiply(&x);
        let mut residual2 = 0.;
        let mut scale2 = 0.;
        for i in &free {
            residual2 += (ax[*i] - rhs[*i]).powi(2);
            let scale = self.rows[*i]
                .iter()
                .map(|(j, v)| v.abs() * x[*j].abs())
                .sum::<f64>()
                + rhs[*i].abs();
            scale2 += scale * scale;
        }
        let residual = residual2.sqrt() / scale2.sqrt().max(1e-12);
        if !residual.is_finite() || residual > 1e-7 || x.iter().any(|v| !v.is_finite()) {
            return Err("Excessive FEM equation residual.".into());
        }
        Ok((x, iterations, residual))
    }
}
fn dot(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}
