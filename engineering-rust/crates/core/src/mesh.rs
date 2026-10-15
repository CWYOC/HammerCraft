//! SI tetrahedral topology validation, exterior orientation and exact P1 gradients.
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Mesh {
    pub nodes: Vec<f64>,
    pub tetrahedra: Vec<usize>,
    pub boundary: Vec<Surface>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Surface {
    pub tag: u32,
    pub triangles: Vec<usize>,
}
#[derive(Clone, Debug)]
pub struct Cell {
    pub ids: [usize; 4],
    pub volume: f64,
    pub gradients: [[f64; 3]; 4],
}
pub fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    std::array::from_fn(|i| a[i] - b[i])
}
pub fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}
pub fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
pub fn norm(a: [f64; 3]) -> f64 {
    dot(a, a).sqrt()
}
impl Mesh {
    pub fn point(&self, n: usize) -> [f64; 3] {
        self.nodes[n * 3..n * 3 + 3].try_into().unwrap()
    }
    pub fn area(&self, t: &[usize]) -> f64 {
        norm(cross(
            sub(self.point(t[1]), self.point(t[0])),
            sub(self.point(t[2]), self.point(t[0])),
        )) / 2.
    }
    pub fn prepare(&self) -> Result<Vec<Cell>, String> {
        let n = self.nodes.len() / 3;
        let m = self.tetrahedra.len() / 4;
        if !(4..=50000).contains(&n)
            || !(1..=100000).contains(&m)
            || !self.nodes.len().is_multiple_of(3)
            || !self.tetrahedra.len().is_multiple_of(4)
            || self
                .nodes
                .iter()
                .any(|v| !v.is_finite() || v.abs() > 10000.)
            || self.tetrahedra.iter().any(|i| *i >= n)
        {
            return Err("Invalid tetrahedral counts, coordinates or connectivity.".into());
        }
        if self.boundary.is_empty() || self.boundary.len() > 2048 {
            return Err("Invalid mesh boundary groups.".into());
        }
        let mut used = vec![false; n];
        let mut seen_cells = BTreeSet::new();
        let mut faces: BTreeMap<[usize; 3], Vec<(usize, [usize; 3])>> = BTreeMap::new();
        let mut cells = Vec::with_capacity(m);
        for (i, t) in self.tetrahedra.as_chunks::<4>().0.iter().enumerate() {
            let ids: [usize; 4] = *t;
            let mut sorted = ids;
            sorted.sort();
            if sorted.windows(2).any(|p| p[0] == p[1]) || !seen_cells.insert(sorted) {
                return Err("Duplicate or degenerate tetrahedra.".into());
            }
            for id in ids {
                used[id] = true;
            }
            let p = ids.map(|n| self.point(n));
            let e = [sub(p[1], p[0]), sub(p[2], p[0]), sub(p[3], p[0])];
            let six = dot(e[0], cross(e[1], e[2]));
            if !six.is_finite() || six <= 0. {
                return Err("Tetrahedra must have finite positive volume.".into());
            }
            let mut g = [[0.; 3]; 4];
            for (j, v) in [cross(e[1], e[2]), cross(e[2], e[0]), cross(e[0], e[1])]
                .iter()
                .enumerate()
            {
                for a in 0..3 {
                    g[j + 1][a] = v[a] / six;
                    g[0][a] -= v[a] / six;
                }
            }
            if g.iter().flatten().any(|v| !v.is_finite()) {
                return Err("Degenerate tetrahedron gradients.".into());
            }
            cells.push(Cell {
                ids,
                volume: six / 6.,
                gradients: g,
            });
            for local in [[1, 2, 3], [0, 3, 2], [0, 1, 3], [0, 2, 1]] {
                let oriented = local.map(|j| ids[j]);
                let mut key = oriented;
                key.sort();
                faces.entry(key).or_default().push((i, oriented));
            }
        }
        if used.iter().any(|v| !*v) {
            return Err("Unused mesh nodes.".into());
        }
        let mut adjacency = vec![Vec::new(); m];
        let mut exterior = BTreeMap::new();
        for (key, list) in faces {
            match list.as_slice() {
                [(i, a), (j, b)] => {
                    if cyclic(a, b) {
                        return Err("Interior faces overlap with equal orientation.".into());
                    }
                    adjacency[*i].push(*j);
                    adjacency[*j].push(*i);
                }
                [(_, oriented)] => {
                    exterior.insert(key, *oriented);
                }
                _ => return Err("Nonmanifold tetrahedral faces.".into()),
            }
        }
        let mut reached = vec![false; m];
        let mut stack = vec![0];
        reached[0] = true;
        while let Some(i) = stack.pop() {
            for j in &adjacency[i] {
                if !reached[*j] {
                    reached[*j] = true;
                    stack.push(*j);
                }
            }
        }
        if reached.iter().any(|b| !*b) {
            return Err("Mesh must be one connected solid.".into());
        }
        let mut tags = BTreeSet::new();
        let mut seen = BTreeSet::new();
        for g in &self.boundary {
            if g.tag == 0
                || !tags.insert(g.tag)
                || g.triangles.is_empty()
                || g.triangles.len() % 3 != 0
                || g.triangles.len() > 600000
                || g.triangles.iter().any(|i| *i >= n)
            {
                return Err("Invalid or repeated surface group.".into());
            }
            for t in g.triangles.as_chunks::<3>().0 {
                let oriented: [usize; 3] = *t;
                let mut key = oriented;
                key.sort();
                let Some(expected) = exterior.get(&key) else {
                    return Err("Surface is not an exterior face.".into());
                };
                if !seen.insert(key) || !cyclic(&oriented, expected) {
                    return Err("Duplicate or inward exterior triangles.".into());
                }
            }
        }
        if seen.len() != exterior.len() {
            return Err("Missing exterior boundary triangles.".into());
        }
        Ok(cells)
    }
}
fn cyclic(a: &[usize; 3], b: &[usize; 3]) -> bool {
    (0..3).any(|offset| (0..3).all(|i| a[i] == b[(i + offset) % 3]))
}
