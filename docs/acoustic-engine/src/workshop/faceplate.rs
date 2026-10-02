//! One outward-facing plane shared by cap CSG, cavity checks and assembly routing.
use super::*;

#[derive(Clone, Copy, Default, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    // Old project files keep their explicit positive-axis cut.
    #[default]
    Axis,
    Auto,
    Normal,
}

pub fn is_axis(mode: &Mode) -> bool {
    *mode == Mode::Axis
}
pub fn is_false(value: &bool) -> bool {
    !value
}

#[derive(Clone, Copy)]
pub(super) struct Plane {
    pub normal: V,
    pub offset: f64,
    pub detected_area: Option<f64>,
}
impl Plane {
    pub fn signed(self, point: V) -> f64 {
        dot(self.normal, point) - self.offset
    }
    pub fn inset(self, distance: f64) -> Self {
        Self {
            offset: self.offset - distance,
            ..self
        }
    }
}

/// Find a dominant connected planar patch, independent of STL orientation.
/// Area (not triangle count) prevents finely tessellated nozzles winning.
pub(super) fn detect(stock: &Mesh) -> Result<Plane, String> {
    let mut adjacent = vec![vec![]; stock.vertices.len()];
    let faces: Vec<_> = stock
        .triangles
        .iter()
        .enumerate()
        .map(|(i, t)| {
            for &v in t {
                adjacent[v].push(i);
            }
            let [a, b, c] = t.map(|v| stock.vertices[v]);
            let cross = cross(sub(b, a), sub(c, a));
            (
                norm(cross),
                length(cross) / 2.,
                mul(add(add(a, b), c), 1. / 3.),
            )
        })
        .collect();
    let total_area: f64 = faces.iter().map(|f| f.1).sum();
    let mut order: Vec<_> = (0..faces.len()).collect();
    order.sort_by(|&a, &b| faces[b].1.total_cmp(&faces[a].1));
    let mut visited = vec![false; faces.len()];
    let mut patches = vec![];
    for seed in order {
        if visited[seed] || faces[seed].1 < 1e-12 {
            continue;
        }
        let normal = faces[seed].0;
        let offset = dot(normal, faces[seed].2);
        let mut queue = vec![seed];
        visited[seed] = true;
        let (mut area, mut centroid, mut normals) = (0., [0.; 3], [0.; 3]);
        while let Some(i) = queue.pop() {
            let (n, a, c) = faces[i];
            area += a;
            centroid = add(centroid, mul(c, a));
            normals = add(normals, mul(n, a));
            for &v in &stock.triangles[i] {
                for &j in &adjacent[v] {
                    if !visited[j]
                        && dot(normal, faces[j].0) > 0.99985
                        && stock.triangles[j]
                            .iter()
                            .all(|&k| (dot(normal, stock.vertices[k]) - offset).abs() < 0.02)
                    {
                        visited[j] = true;
                        queue.push(j);
                    }
                }
            }
        }
        let n = norm(normals);
        patches.push(Plane {
            normal: n,
            offset: dot(n, mul(centroid, 1. / area)),
            detected_area: Some(area),
        });
    }
    patches.sort_by(|a, b| {
        b.detected_area
            .unwrap()
            .total_cmp(&a.detected_area.unwrap())
    });
    let fail = "Cannot identify a unique broad, flat faceplate surface. Choose a manual faceplate side or custom outward normal, then inspect the cap.";
    let best = *patches.first().ok_or(fail)?;
    let area = best.detected_area.unwrap();
    // Parallel terraces belong to the same side; equally large opposing or
    // differently oriented faces (e.g. a cube) are genuinely ambiguous.
    if area < total_area * 0.05
        || patches
            .iter()
            .skip(1)
            .any(|p| dot(best.normal, p.normal) < 0.98 && p.detected_area.unwrap() > area * 0.8)
    {
        return Err(fail.into());
    }
    // A large internal ledge is not an exterior cap face.
    let extent = stock
        .vertices
        .iter()
        .map(|&v| dot(best.normal, v))
        .fold(f64::NEG_INFINITY, f64::max);
    if extent - best.offset > 0.5 {
        return Err(fail.into());
    }
    Ok(best)
}

pub(super) fn resolve(c: &solid::Construction, stock: &Mesh) -> Result<Plane, String> {
    if c.faceplate_axis > 2 {
        return Err("Faceplate axis must be X, Y or Z.".into());
    }
    let surface = match c.faceplate_mode {
        Mode::Auto => detect(stock)?,
        Mode::Axis | Mode::Normal => {
            let normal = if matches!(c.faceplate_mode, Mode::Normal) {
                let n = c
                    .faceplate_normal
                    .ok_or("Enter a custom outward faceplate normal.")?;
                if !valid(n) || length(n) < 1e-9 || !length(n).is_finite() {
                    return Err("Faceplate normal must be finite and nonzero.".into());
                }
                norm(n)
            } else {
                let mut n = [0.; 3];
                n[c.faceplate_axis] = if c.faceplate_negative { -1. } else { 1. };
                n
            };
            Plane {
                normal,
                offset: stock
                    .vertices
                    .iter()
                    .map(|&v| dot(normal, v))
                    .fold(f64::NEG_INFINITY, f64::max),
                detected_area: None,
            }
        }
    };
    let plane = surface.inset(c.faceplate_depth_mm);
    let min = stock
        .vertices
        .iter()
        .map(|&v| dot(plane.normal, v))
        .fold(f64::INFINITY, f64::min);
    if !c.faceplate_depth_mm.is_finite()
        || c.faceplate_depth_mm <= 0.
        || plane.offset <= min + c.wall_mm
    {
        return Err("Faceplate cut leaves no usable shell body; reduce its depth.".into());
    }
    Ok(plane)
}
