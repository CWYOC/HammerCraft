//! Browser geometry port of HeadphoneWorkshop (millimetres at the public boundary).
//! Swept tubes retain the native parallel-transport frames, taper and triangle order.
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
mod placement;
mod solid;
mod containment;
type V = [f64; 3];
fn add(a: V, b: V) -> V {
    std::array::from_fn(|i| a[i] + b[i])
}
fn sub(a: V, b: V) -> V {
    std::array::from_fn(|i| a[i] - b[i])
}
fn mul(a: V, s: f64) -> V {
    a.map(|x| x * s)
}
fn dot(a: V, b: V) -> f64 {
    (0..3).map(|i| a[i] * b[i]).sum()
}
fn cross(a: V, b: V) -> V {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
fn length(a: V) -> f64 {
    dot(a, a).sqrt()
}
fn norm(a: V) -> V {
    let l = length(a);
    if l <= 1e-9 {
        [0.; 3]
    } else {
        mul(a, 1. / l)
    }
}
fn valid(v: V) -> bool {
    v.iter().all(|x| x.is_finite() && x.abs() <= 10000.)
}
fn rotate(mut p: V, deg: V) -> V {
    for axis in 0..3 {
        let (s, c) = deg[axis].to_radians().sin_cos();
        let a = (axis + 1) % 3;
        let b = (axis + 2) % 3;
        let (x, y) = (p[a], p[b]);
        p[a] = c * x - s * y;
        p[b] = s * x + c * y;
    }
    p
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Mesh {
    pub vertices: Vec<V>,
    pub triangles: Vec<[usize; 3]>,
}
impl Mesh {
    fn validate(&self) -> Result<(), String> {
        if self.vertices.is_empty()
            || self.triangles.is_empty()
            || self.vertices.len() > 900000
            || self.triangles.len() > 300000
        {
            return Err("Mesh must contain 1–300,000 triangles.".into());
        }
        if self.vertices.iter().any(|&v| !valid(v))
            || self
                .triangles
                .iter()
                .flatten()
                .any(|&i| i >= self.vertices.len())
        {
            return Err("Mesh contains invalid coordinates or indices.".into());
        }
        Ok(())
    }
    fn bounds(&self) -> [V; 2] {
        let mut b = [[f64::INFINITY; 3], [f64::NEG_INFINITY; 3]];
        for v in &self.vertices {
            for i in 0..3 {
                b[0][i] = b[0][i].min(v[i]);
                b[1][i] = b[1][i].max(v[i]);
            }
        }
        b
    }
}
#[derive(Serialize)]
pub struct MeshInfo {
    pub size_mm: V,
    pub triangles: usize,
    pub boundary_edges: usize,
    pub nonmanifold_edges: usize,
    pub inconsistent_edges: usize,
    pub degenerate_triangles: usize,
    pub signed_volume_mm3: f64,
}
pub fn inspect(m: &Mesh) -> MeshInfo {
    let mut edges: HashMap<(usize, usize), (usize, i32)> = HashMap::new();
    let mut volume = 0.;
    let mut degenerate = 0;
    for &[a, b, c] in &m.triangles {
        let (p, q, r) = (m.vertices[a], m.vertices[b], m.vertices[c]);
        if length(cross(sub(q, p), sub(r, p))) < 1e-12 {
            degenerate += 1;
        }
        volume += dot(p, cross(q, r)) / 6.;
        for (a, b) in [(a, b), (b, c), (c, a)] {
            let e = edges.entry((a.min(b), a.max(b))).or_default();
            e.0 += 1;
            e.1 += if a < b { 1 } else { -1 };
        }
    }
    let b = m.bounds();
    MeshInfo {
        size_mm: sub(b[1], b[0]),
        triangles: m.triangles.len(),
        boundary_edges: edges.values().filter(|e| e.0 == 1).count(),
        nonmanifold_edges: edges.values().filter(|e| e.0 > 2).count(),
        inconsistent_edges: edges.values().filter(|e| e.0 == 2 && e.1 != 0).count(),
        degenerate_triangles: degenerate,
        signed_volume_mm3: volume,
    }
}
/// STL carries no unit metadata. The caller must supply millimetres per source unit.
pub fn import_stl(bytes: &[u8], unit_mm: f64) -> Result<Mesh, String> {
    if bytes.len() > 16 * 1024 * 1024 || !unit_mm.is_finite() || unit_mm <= 0. || unit_mm > 1000. {
        return Err("STL exceeds 16 MB or has invalid units.".into());
    }
    let count = if bytes.len() >= 84 {
        u32::from_le_bytes(bytes[80..84].try_into().unwrap()) as usize
    } else {
        0
    };
    let mut points = Vec::new();
    if bytes.len() >= 84 && 84 + count * 50 == bytes.len() {
        if count == 0 || count > 300000 {
            return Err("STL must contain 1–300,000 triangles.".into());
        }
        for t in 0..count {
            for j in 0..3 {
                let off = 84 + t * 50 + 12 + j * 12;
                let mut p = [0.; 3];
                for (a, x) in p.iter_mut().enumerate() {
                    *x = f32::from_le_bytes(bytes[off + a * 4..off + a * 4 + 4].try_into().unwrap())
                        as f64
                        * unit_mm;
                }
                points.push(p);
            }
        }
    } else {
        let text = std::str::from_utf8(bytes).map_err(|_| "Invalid or truncated binary STL.")?;
        let mut facet = false;
        let mut n = 0;
        let mut solid = false;
        let mut ended = false;
        for line in text.lines() {
            let w: Vec<_> = line.split_whitespace().collect();
            if w.is_empty() {
                continue;
            }
            match w[0] {
                "solid" if !facet => {
                    solid = true;
                    ended = false;
                }
                "facet" if solid && !ended && !facet => {
                    facet = true;
                    n = 0;
                }
                "vertex" if facet && w.len() == 4 => {
                    let mut p = [0.; 3];
                    for i in 0..3 {
                        p[i] =
                            w[i + 1].parse::<f64>().map_err(|_| "Invalid STL vertex.")? * unit_mm;
                    }
                    points.push(p);
                    n += 1;
                }
                "endfacet" if facet && n == 3 => {
                    facet = false;
                }
                "endsolid" if !facet && solid => {
                    ended = true;
                }
                "outer" | "endloop" if facet => {}
                _ => return Err("Invalid ASCII STL structure.".into()),
            }
            if points.len() > 900000 {
                return Err("STL exceeds 300,000 triangles.".into());
            }
        }
        if !solid || !ended || facet || points.is_empty() {
            return Err("Incomplete ASCII STL.".into());
        }
    }
    let mut m = Mesh {
        vertices: Vec::new(),
        triangles: Vec::new(),
    };
    let mut ids = HashMap::new();
    for face in points.chunks_exact(3) {
        let mut tri = [0; 3];
        for (i, &p) in face.iter().enumerate() {
            if !valid(p) {
                return Err(
                    "STL has non-finite or out-of-range coordinates; check its units.".into(),
                );
            }
            let key = p.map(|x| if x == 0. { 0 } else { x.to_bits() });
            tri[i] = *ids.entry(key).or_insert_with(|| {
                m.vertices.push(p);
                m.vertices.len() - 1
            });
        }
        m.triangles.push(tri);
    }
    m.validate()?;
    let b = m.bounds();
    let center = mul(add(b[0], b[1]), 0.5);
    for p in &mut m.vertices {
        *p = sub(*p, center);
    }
    Ok(m)
}
#[derive(Clone, Deserialize, Serialize)]
pub struct Tube {
    pub control_points: [V; 4],
    pub outer_radius_mm: f64,
    pub inner_radius_mm: f64,
    #[serde(default)]
    pub inlet_outer_radius_mm: f64,
    #[serde(default)]
    pub inlet_inner_radius_mm: f64,
    pub path_segments: usize,
    pub radial_segments: usize,
}
fn bezier(p: [V; 4], t: f64) -> V {
    let u = 1. - t;
    add(
        add(mul(p[0], u * u * u), mul(p[1], 3. * u * u * t)),
        add(mul(p[2], 3. * u * t * t), mul(p[3], t * t * t)),
    )
}
fn radius(main: f64, inlet: f64, t: f64) -> f64 {
    let a = (t / 0.4).clamp(0., 1.);
    let b = a * a * (3. - 2. * a);
    let r = if inlet > 0. { inlet } else { main };
    r + (main - r) * b
}
pub fn swept_tube(p: &Tube) -> Result<Mesh, String> {
    if p.control_points.iter().any(|&v| !valid(v))
        || !(4..=256).contains(&p.path_segments)
        || !(6..=64).contains(&p.radial_segments)
    {
        return Err("Invalid tube control points or tessellation.".into());
    }
    for (o, i) in [
        (p.outer_radius_mm, p.inner_radius_mm),
        (
            if p.inlet_outer_radius_mm > 0. {
                p.inlet_outer_radius_mm
            } else {
                p.outer_radius_mm
            },
            if p.inlet_inner_radius_mm > 0. {
                p.inlet_inner_radius_mm
            } else {
                p.inner_radius_mm
            },
        ),
    ] {
        // Decimal diameters can round a boundary wall just below 0.05 mm.
        // This tolerance covers arithmetic roundoff, not manufacturing allowance.
        if !o.is_finite() || !i.is_finite() || i < 0.05 || o > 10. || o - i < 0.05 - 1e-12 {
            return Err("Tube radii require a bore ≥0.1 mm and wall ≥0.05 mm.".into());
        }
    }
    if !p.inlet_outer_radius_mm.is_finite()
        || !p.inlet_inner_radius_mm.is_finite()
        || p.inlet_outer_radius_mm < 0.
        || p.inlet_inner_radius_mm < 0.
    {
        return Err("Invalid inlet radii.".into());
    }
    // Work in native metres so degenerate-tangent thresholds match C++ exactly.
    let points = p.control_points.map(|v| mul(v, 0.001));
    let n = p.path_segments;
    let r = p.radial_segments;
    let samples: Vec<_> = (0..=n)
        .map(|i| bezier(points, i as f64 / n as f64))
        .collect();
    if samples
        .windows(2)
        .map(|s| length(sub(s[1], s[0])))
        .sum::<f64>()
        < 1e-6
    {
        return Err("Tube path has zero length.".into());
    }
    let mut m = Mesh {
        vertices: Vec::with_capacity((n + 1) * r * 2),
        triangles: Vec::new(),
    };
    let mut frames = Vec::new();
    let mut previous = [1., 0., 0.];
    for k in 0..=n {
        let t = k as f64 / n as f64;
        let u = 1. - t;
        let mut tangent = norm(add(
            add(
                mul(sub(points[1], points[0]), 3. * u * u),
                mul(sub(points[2], points[1]), 6. * u * t),
            ),
            mul(sub(points[3], points[2]), 3. * t * t),
        ));
        if length(tangent) <= 1e-9 {
            tangent = norm(sub(samples[(k + 1).min(n)], samples[k.saturating_sub(1)]));
            if length(tangent) <= 1e-9 {
                tangent = [0., 0., 1.];
            }
        }
        let mut normal = sub(previous, mul(tangent, dot(previous, tangent)));
        if length(normal) <= 1e-6 {
            normal = cross(
                if tangent[1].abs() < 0.92 {
                    [0., 1., 0.]
                } else {
                    [1., 0., 0.]
                },
                tangent,
            );
        }
        normal = norm(normal);
        let binormal = norm(cross(tangent, normal));
        previous = normal;
        frames.push((normal, binormal));
    }
    for inner in [false, true] {
        for k in 0..=n {
            let t = k as f64 / n as f64;
            let rad = if inner {
                radius(p.inner_radius_mm, p.inlet_inner_radius_mm, t)
            } else {
                radius(p.outer_radius_mm, p.inlet_outer_radius_mm, t)
            };
            for j in 0..r {
                let a = j as f64 * std::f64::consts::TAU / r as f64;
                m.vertices.push(add(
                    mul(samples[k], 1000.),
                    add(
                        mul(frames[k].0, a.cos() * rad),
                        mul(frames[k].1, a.sin() * rad),
                    ),
                ));
            }
        }
    }
    let inside = (n + 1) * r;
    for k in 0..n {
        for j in 0..r {
            let q = (j + 1) % r;
            let a = k * r;
            let b = (k + 1) * r;
            m.triangles
                .extend([[a + j, a + q, b + q], [a + j, b + q, b + j]]);
        }
    }
    for k in 0..n {
        for j in 0..r {
            let q = (j + 1) % r;
            let a = inside + k * r;
            let b = inside + (k + 1) * r;
            m.triangles
                .extend([[a + j, b + q, a + q], [a + j, b + j, b + q]]);
        }
    }
    for j in 0..r {
        let q = (j + 1) % r;
        let e = n * r;
        m.triangles.extend([
            [j, inside + q, q],
            [j, inside + j, inside + q],
            [e + j, e + q, inside + e + q],
            [e + j, inside + e + q, inside + e + j],
        ]);
    }
    Ok(m)
}
#[derive(Deserialize)]
struct Preset {
    id: usize,
    name: String,
    size_mm: V,
    cylindrical: bool,
    outlet_mm: V,
    outlet_axis: V,
    outlet_diameter_mm: f64,
    supplier_dimensioned: bool,
    supplier_interface_dimensioned: bool,
    dedicated_drive: bool,
    rear_vent_required: bool,
}
#[derive(Deserialize, Serialize, Clone)]
pub struct Driver {
    pub id: String,
    pub preset: usize,
    pub position_mm: V,
    pub rotation_deg: V,
    pub end_mm: V,
    pub bend_mm: V,
    pub lead_mm: f64,
    pub inner_diameter_mm: f64,
    pub outer_diameter_mm: f64,
}
#[derive(Deserialize, Serialize)]
pub struct Project {
    pub format: String,
    pub version: u32,
    pub name: String,
    pub shell_scale: V,
    pub mirrored: bool,
    pub drivers: Vec<Driver>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub construction: Option<solid::Construction>,
}
#[derive(Serialize)]
pub struct Part {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub mesh: Mesh,
}
#[derive(Serialize)]
pub struct PathInfo {
    pub driver_id: String,
    pub length_mm: f64,
    pub bore_volume_mm3: f64,
    pub control_points: [V; 4],
    pub placement_errors: Vec<String>,
}
#[derive(Serialize)]
pub struct Build {
    pub parts: Vec<Part>,
    pub paths: Vec<PathInfo>,
    pub shell: MeshInfo,
    pub warnings: Vec<String>,
    pub placement_checks: Vec<placement::Check>,
    pub construction: Option<solid::ConstructionInfo>,
    pub export_blockers: Vec<String>,
}
fn envelope(s: &Preset) -> Mesh {
    if s.cylindrical {
        let r = 32;
        let mut m = Mesh {
            vertices: vec![],
            triangles: vec![],
        };
        for side in [-0.5, 0.5] {
            for j in 0..r {
                let a = j as f64 * std::f64::consts::TAU / r as f64;
                m.vertices.push([
                    a.cos() * s.size_mm[0] / 2.,
                    side * s.size_mm[1],
                    a.sin() * s.size_mm[2] / 2.,
                ]);
            }
        }
        m.vertices
            .extend([[0., -s.size_mm[1] / 2., 0.], [0., s.size_mm[1] / 2., 0.]]);
        for j in 0..r {
            let q = (j + 1) % r;
            m.triangles.extend([
                [j, r + j, r + q],
                [j, r + q, q],
                [2 * r, j, q],
                [2 * r + 1, r + q, r + j],
            ]);
        }
        m
    } else {
        let h = mul(s.size_mm, 0.5);
        Mesh {
            vertices: vec![
                [-h[0], -h[1], -h[2]],
                [h[0], -h[1], -h[2]],
                [h[0], h[1], -h[2]],
                [-h[0], h[1], -h[2]],
                [-h[0], -h[1], h[2]],
                [h[0], -h[1], h[2]],
                [h[0], h[1], h[2]],
                [-h[0], h[1], h[2]],
            ],
            triangles: vec![
                [0, 2, 1],
                [0, 3, 2],
                [4, 5, 6],
                [4, 6, 7],
                [0, 1, 5],
                [0, 5, 4],
                [3, 7, 6],
                [3, 6, 2],
                [0, 4, 7],
                [0, 7, 3],
                [1, 2, 6],
                [1, 6, 5],
            ],
        }
    }
}
pub fn build(p: &Project, base: &Mesh) -> Result<Build, String> {
    base.validate()?;
    if p.format != "hc-headphone-workshop" || p.version != 1 {
        return Err(
            "Unsupported workshop project format/version; native .fmp is not supported yet.".into(),
        );
    }
    if p.drivers.len() > 12
        || p.name.len() > 200
        || p.shell_scale
            .iter()
            .any(|x| !x.is_finite() || !(0.25..=4.).contains(x))
    {
        return Err("Use up to 12 drivers and shell scales between 0.25 and 4.".into());
    }
    let mut shell = base.clone();
    for v in &mut shell.vertices {
        for i in 0..3 {
            v[i] *= p.shell_scale[i];
        }
    }
    shell.validate()?;
    let mut info = inspect(&shell);
    let mut warnings=vec!["Layout preview: shell cavities, connector cuts, ear-fit, wall thickness and manufacturing clearance are not evaluated in this port yet.".into()];
    if info.boundary_edges
        + info.nonmanifold_edges
        + info.inconsistent_edges
        + info.degenerate_triangles
        > 0
    {
        warnings.push("Imported shell has topology defects. Export preserves them; repair before manufacturing.".into());
    }
    let mut parts = vec![Part {
        id: "shell".into(),
        name: "Unmachined shell stock".into(),
        kind: "shell".into(),
        mesh: shell,
    }];
    let mut paths = vec![];
    let mut ids = HashSet::new();
    let catalog: Vec<Preset> =
        serde_json::from_str(include_str!("../../assets/workshop/drivers.json"))
            .map_err(|e| e.to_string())?;
    for (driver_index, d) in p.drivers.iter().enumerate() {
        if d.id.is_empty()
            || d.id == "shell"
            || d.id == "faceplate"
            || d.id.starts_with("path:")
            || d.id.len() > 100
            || !ids.insert(&d.id)
        {
            return Err("Driver IDs must be unique, non-empty, non-reserved strings.".into());
        }
        if [d.position_mm, d.rotation_deg, d.end_mm, d.bend_mm]
            .iter()
            .any(|&v| !valid(v))
            || !d.lead_mm.is_finite()
            || !(0.1..=50.).contains(&d.lead_mm)
        {
            return Err("Invalid driver position, rotation or route lead.".into());
        }
        let s = catalog
            .iter()
            .find(|s| s.id == d.preset)
            .ok_or("Unknown driver preset.")?;
        let mut mesh = envelope(s);
        for v in &mut mesh.vertices {
            *v = add(rotate(*v, d.rotation_deg), d.position_mm);
        }
        if !s.supplier_dimensioned || !s.supplier_interface_dimensioned {
            warnings.push(format!(
                "{}: package or outlet includes planning dimensions; verify supplier drawing.",
                s.name
            ));
        }
        if s.dedicated_drive {
            warnings.push(format!("{} requires dedicated drive electronics.", s.name));
        }
        if s.rear_vent_required {
            warnings.push(format!("{} requires an unobstructed rear vent; this preview does not model its back volume.",s.name));
        }
        let start = add(d.position_mm, rotate(s.outlet_mm, d.rotation_deg));
        let next = add(start, mul(rotate(s.outlet_axis, d.rotation_deg), d.lead_mm));
        let tube = Tube {
            control_points: [start, next, d.bend_mm, d.end_mm],
            inner_radius_mm: d.inner_diameter_mm / 2.,
            outer_radius_mm: d.outer_diameter_mm / 2.,
            inlet_outer_radius_mm: 0.,
            inlet_inner_radius_mm: 0.,
            path_segments: 64,
            radial_segments: 16,
        };
        let route = swept_tube(&tube).map_err(|e| format!("{}: {e}", s.name))?;
        mesh.validate()?;
        route.validate()?;
        let len = (0..256)
            .map(|i| {
                length(sub(
                    bezier(tube.control_points, (i + 1) as f64 / 256.),
                    bezier(tube.control_points, i as f64 / 256.),
                ))
            })
            .sum::<f64>();
        paths.push(PathInfo {
            driver_id: d.id.clone(),
            length_mm: len,
            bore_volume_mm3: len * std::f64::consts::PI * tube.inner_radius_mm.powi(2),
            control_points: tube.control_points,
            placement_errors: vec![],
        });
        parts.push(Part {
            id: d.id.clone(),
            name: format!("{:02} · {}", driver_index + 1, s.name),
            kind: "driver".into(),
            mesh,
        });
        parts.push(Part {
            id: format!("path:{}", d.id),
            name: format!("{:02} · {} sound tube", driver_index + 1, s.name),
            kind: "path".into(),
            mesh: route,
        });
    }
    // Run before whole-assembly reflection, which preserves these distances and intersections.
    let mut placement_checks = placement::inspect_layout(p, &catalog, &parts, &paths, &info);
    let construction = if p.construction.is_some() {
        let result = solid::construct(&parts[0].mesh, p, &paths)?;
        placement_checks.extend(containment::inspect_parts(p, &parts, &info));
        parts[0].mesh = result.body;
        parts[0].name = "Constructed hollow shell body".into();
        info = inspect(&parts[0].mesh);
        parts.push(Part { id: "faceplate".into(), name: "Separate faceplate".into(), kind: "faceplate".into(), mesh: result.faceplate });
        placement_checks.retain(|c| c.code != "finished-shell");
        placement_checks.extend(result.checks);
        warnings.retain(|s| !s.starts_with("Layout preview:"));
        warnings.push("Sampled shell construction: inspect all machined openings, remaining walls and assembly access before manufacture. No process qualification is implied.".into());
        Some(result.info)
    } else {
        placement_checks.extend(containment::inspect_parts(p, &parts, &info));
        None
    };
    let export_blockers: Vec<String> = placement_checks.iter()
        .filter(|c| c.status == "error" || (c.status != "pass"
            && matches!(c.code.as_str(), "package-shell" | "package-cavity" | "tube-shell")))
        .map(|c| c.message.clone()).collect();
    for check in &placement_checks {
        if check.status == "error" || check.status == "warning" {
            warnings.push(check.message.clone());
        }
        if check.status == "error" || (check.status != "pass"
            && matches!(check.code.as_str(), "package-shell" | "package-cavity" | "tube-shell")) {
            for path in &mut paths {
                if check
                    .part_ids
                    .iter()
                    .any(|id| *id == path.driver_id || *id == format!("path:{}", path.driver_id))
                {
                    path.placement_errors.push(check.message.clone());
                }
            }
        }
    }
    if p.mirrored {
        for part in &mut parts {
            for v in &mut part.mesh.vertices {
                v[0] = -v[0];
            }
            for t in &mut part.mesh.triangles {
                t.swap(1, 2);
            }
        }
        for path in &mut paths {
            for p in &mut path.control_points {
                p[0] = -p[0];
            }
        }
        info = inspect(&parts[0].mesh);
    }
    Ok(Build {
        parts,
        paths,
        shell: info,
        warnings,
        placement_checks,
        construction,
        export_blockers,
    })
}
pub fn export_stl(m: &Mesh) -> Result<Vec<u8>, String> {
    m.validate()?;
    let mut out = vec![0; 84];
    let label = b"Hammer Craft / millimetres / geometry preview";
    out[..label.len()].copy_from_slice(label);
    out[80..84].copy_from_slice(&(m.triangles.len() as u32).to_le_bytes());
    for &[a, b, c] in &m.triangles {
        let (a, b, c) = (m.vertices[a], m.vertices[b], m.vertices[c]);
        let n = norm(cross(sub(b, a), sub(c, a)));
        for v in [n, a, b, c] {
            for x in v {
                out.extend_from_slice(&(x as f32).to_le_bytes());
            }
        }
        out.extend_from_slice(&[0, 0]);
    }
    Ok(out)
}
