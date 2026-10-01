//! Sampled solid construction. The edge-keyed marching-tetrahedra polygonizer
//! follows HeadphoneWorkshop Mesh::makeImplicitSurface; millimetres at this API.
use super::*;

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Construction {
    pub wall_mm: f64,
    pub resolution_mm: f64,
    pub faceplate_axis: usize,
    pub faceplate_depth_mm: f64,
    pub faceplate_gap_mm: f64,
    pub cut_sound_paths: bool,
    pub connector: Option<Cut>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Cut {
    pub shape: CutShape,
    pub center_mm: V,
    pub rotation_deg: V,
    /// Box XYZ extents; cylinder X=Y diameter, Z length in its local frame.
    pub size_mm: V,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CutShape {
    Box,
    Cylinder,
}
#[derive(Serialize)]
pub struct ConstructionInfo {
    pub resolution_mm: f64,
    pub requested_wall_mm: f64,
    pub faceplate_plane_mm: f64,
    pub grid_points: usize,
    pub cavity_volume_estimate_mm3: f64,
    pub body: MeshInfo,
    pub faceplate: MeshInfo,
}

pub struct ResultParts {
    pub body: Mesh,
    pub faceplate: Mesh,
    pub info: ConstructionInfo,
    pub checks: Vec<placement::Check>,
}

fn box_distance(p: V, h: V) -> f64 {
    let q = std::array::from_fn::<_, 3, _>(|i| p[i].abs() - h[i]);
    length(q.map(|x| x.max(0.))) + q[0].max(q[1]).max(q[2]).min(0.)
}
fn unrotate(mut p: V, deg: V) -> V {
    for axis in (0..3).rev() {
        let (s, c) = (-deg[axis]).to_radians().sin_cos();
        let a = (axis + 1) % 3;
        let b = (axis + 2) % 3;
        let (x, y) = (p[a], p[b]);
        p[a] = c * x - s * y;
        p[b] = s * x + c * y;
    }
    p
}
impl Cut {
    fn distance(&self, p: V) -> f64 {
        let p = unrotate(sub(p, self.center_mm), self.rotation_deg);
        match self.shape {
            CutShape::Box => box_distance(p, mul(self.size_mm, 0.5)),
            CutShape::Cylinder => {
                let a = (p[0] * p[0] + p[1] * p[1]).sqrt() - self.size_mm[0] / 2.;
                let b = p[2].abs() - self.size_mm[2] / 2.;
                (a.max(0.).powi(2) + b.max(0.).powi(2)).sqrt() + a.max(b).min(0.)
            }
        }
    }
}

// A BVH keeps signed-distance queries on the imported shell practical in the worker.
struct Node {
    bounds: [V; 2],
    children: Option<(usize, usize)>,
    faces: Vec<usize>,
}
pub(super) struct DistanceMesh<'a> {
    mesh: &'a Mesh,
    nodes: Vec<Node>,
}
fn bounds_distance_sq(p: V, b: [V; 2]) -> f64 {
    (0..3)
        .map(|i| (b[0][i] - p[i]).max(p[i] - b[1][i]).max(0.).powi(2))
        .sum()
}
fn ray_bounds(p: V, d: V, b: [V; 2]) -> bool {
    let (mut lo, mut hi) = (0f64, f64::INFINITY);
    for i in 0..3 {
        let a = (b[0][i] - p[i]) / d[i];
        let c = (b[1][i] - p[i]) / d[i];
        lo = lo.max(a.min(c));
        hi = hi.min(a.max(c));
    }
    hi >= lo
}
impl<'a> DistanceMesh<'a> {
    pub(super) fn new(mesh: &'a Mesh) -> Self {
        let mut tree = Self {
            mesh,
            nodes: vec![],
        };
        tree.node((0..mesh.triangles.len()).collect());
        tree
    }
    fn node(&mut self, mut faces: Vec<usize>) -> usize {
        let mut bounds = [[f64::INFINITY; 3], [f64::NEG_INFINITY; 3]];
        for &f in &faces {
            for &v in &self.mesh.triangles[f] {
                for i in 0..3 {
                    bounds[0][i] = bounds[0][i].min(self.mesh.vertices[v][i]);
                    bounds[1][i] = bounds[1][i].max(self.mesh.vertices[v][i]);
                }
            }
        }
        let n = self.nodes.len();
        self.nodes.push(Node {
            bounds,
            children: None,
            faces: vec![],
        });
        if faces.len() <= 8 {
            self.nodes[n].faces = faces;
        } else {
            let axis = (0..3)
                .max_by(|&i, &j| {
                    (bounds[1][i] - bounds[0][i]).total_cmp(&(bounds[1][j] - bounds[0][j]))
                })
                .unwrap();
            let center = |f: usize| {
                self.mesh.triangles[f]
                    .iter()
                    .map(|&v| self.mesh.vertices[v][axis])
                    .sum::<f64>()
            };
            faces.sort_unstable_by(|&a, &b| center(a).total_cmp(&center(b)));
            let other = faces.split_off(faces.len() / 2);
            let a = self.node(faces);
            let b = self.node(other);
            self.nodes[n].children = Some((a, b));
        }
        n
    }
    fn nearest(&self, n: usize, p: V, best: &mut f64) {
        let node = &self.nodes[n];
        if bounds_distance_sq(p, node.bounds) > *best * *best {
            return;
        }
        if let Some((a, b)) = node.children {
            let (a, b) = if bounds_distance_sq(p, self.nodes[a].bounds)
                < bounds_distance_sq(p, self.nodes[b].bounds)
            {
                (a, b)
            } else {
                (b, a)
            };
            self.nearest(a, p, best);
            self.nearest(b, p, best);
        } else {
            for &f in &node.faces {
                let [i, j, k] = self.mesh.triangles[f];
                *best = best.min(placement::point_triangle(
                    p,
                    self.mesh.vertices[i],
                    self.mesh.vertices[j],
                    self.mesh.vertices[k],
                ));
            }
        }
    }
    fn hits(&self, n: usize, p: V, d: V, hits: &mut Vec<f64>) {
        let node = &self.nodes[n];
        if !ray_bounds(p, d, node.bounds) {
            return;
        }
        if let Some((a, b)) = node.children {
            self.hits(a, p, d, hits);
            self.hits(b, p, d, hits);
        } else {
            for &f in &node.faces {
                let [i, j, k] = self.mesh.triangles[f];
                let a = self.mesh.vertices[i];
                let e1 = sub(self.mesh.vertices[j], a);
                let e2 = sub(self.mesh.vertices[k], a);
                let h = cross(d, e2);
                let det = dot(e1, h);
                if det.abs() < 1e-14 {
                    continue;
                }
                let s = sub(p, a);
                let u = dot(s, h) / det;
                if !(-1e-10..=1. + 1e-10).contains(&u) {
                    continue;
                }
                let q = cross(s, e1);
                let v = dot(d, q) / det;
                if v < -1e-10 || u + v > 1. + 1e-10 {
                    continue;
                }
                let t = dot(e2, q) / det;
                if t > 1e-9 {
                    hits.push(t);
                }
            }
        }
    }
    pub(super) fn signed(&self, p: V) -> f64 {
        let mut distance = f64::INFINITY;
        self.nearest(0, p, &mut distance);
        if distance < 1e-9 {
            return 0.;
        }
        let mut hits = vec![];
        self.hits(
            0,
            p,
            [1., 0.3713906763541037, 0.1195278413432208],
            &mut hits,
        );
        hits.sort_unstable_by(f64::total_cmp);
        hits.dedup_by(|a, b| (*a - *b).abs() < 1e-8);
        if hits.len() % 2 == 1 {
            -distance
        } else {
            distance
        }
    }
    /// Full triangle-to-surface clearance, not just vertex samples. Bounding
    /// boxes only prune the search; leaf decisions use triangle geometry.
    pub(super) fn near_triangle(&self, triangle: [V; 3], margin: f64) -> bool {
        let bounds = [
            std::array::from_fn(|i| triangle.iter().map(|p| p[i]).fold(f64::INFINITY, f64::min)),
            std::array::from_fn(|i| {
                triangle
                    .iter()
                    .map(|p| p[i])
                    .fold(f64::NEG_INFINITY, f64::max)
            }),
        ];
        self.near_node(0, triangle, bounds, margin)
    }
    fn near_node(&self, n: usize, t: [V; 3], b: [V; 2], margin: f64) -> bool {
        let node = &self.nodes[n];
        let gap: f64 = (0..3)
            .map(|i| {
                (b[0][i] - node.bounds[1][i])
                    .max(node.bounds[0][i] - b[1][i])
                    .max(0.)
                    .powi(2)
            })
            .sum();
        if gap > margin * margin {
            return false;
        }
        if let Some((a, c)) = node.children {
            return self.near_node(a, t, b, margin) || self.near_node(c, t, b, margin);
        }
        node.faces.iter().any(|&f| {
            let s = self.mesh.triangles[f].map(|i| self.mesh.vertices[i]);
            (0..3).any(|i| {
                placement::segment_triangle(t[i], t[(i + 1) % 3], s[0], s[1], s[2]) <= margin
                    || placement::segment_triangle(s[i], s[(i + 1) % 3], t[0], t[1], t[2]) <= margin
            })
        })
    }
}
struct Grid {
    min: V,
    step: V,
    cells: [usize; 3],
}
impl Grid {
    fn new(bounds: [V; 2], spacing: f64) -> Result<Self, String> {
        let min = sub(bounds[0], [spacing * 2.; 3]);
        let max = add(bounds[1], [spacing * 2.; 3]);
        let size = sub(max, min);
        let cells = size.map(|v| (v / spacing).ceil() as usize);
        if cells.iter().any(|&n| n > 128)
            || cells.iter().map(|n| n + 1).product::<usize>() > 650_000
        {
            return Err("Construction grid exceeds the browser budget. Increase mesh spacing or reduce shell scale.".into());
        }
        Ok(Self {
            min,
            step: std::array::from_fn(|i| size[i] / cells[i] as f64),
            cells,
        })
    }
    fn index(&self, x: usize, y: usize, z: usize) -> usize {
        (z * (self.cells[1] + 1) + y) * (self.cells[0] + 1) + x
    }
    fn point(&self, x: usize, y: usize, z: usize) -> V {
        add(
            self.min,
            [
                x as f64 * self.step[0],
                y as f64 * self.step[1],
                z as f64 * self.step[2],
            ],
        )
    }
    fn count(&self) -> usize {
        self.cells.iter().map(|n| n + 1).product()
    }
    fn points(&self) -> impl Iterator<Item = V> + '_ {
        (0..=self.cells[2]).flat_map(move |z| {
            (0..=self.cells[1])
                .flat_map(move |y| (0..=self.cells[0]).map(move |x| self.point(x, y, z)))
        })
    }
}

fn mesh_field(grid: &Grid, values: &[f64]) -> Result<Mesh, String> {
    let mut mesh = Mesh {
        vertices: vec![],
        triangles: vec![],
    };
    let mut edges = HashMap::new();
    const TETS: [[usize; 4]; 6] = [
        [0, 5, 1, 6],
        [0, 1, 2, 6],
        [0, 2, 3, 6],
        [0, 3, 7, 6],
        [0, 7, 4, 6],
        [0, 4, 5, 6],
    ];
    for z in 0..grid.cells[2] {
        for y in 0..grid.cells[1] {
            for x in 0..grid.cells[0] {
                let coords = [
                    [x, y, z],
                    [x + 1, y, z],
                    [x + 1, y + 1, z],
                    [x, y + 1, z],
                    [x, y, z + 1],
                    [x + 1, y, z + 1],
                    [x + 1, y + 1, z + 1],
                    [x, y + 1, z + 1],
                ];
                let ids = coords.map(|[a, b, c]| grid.index(a, b, c));
                let pts = coords.map(|[a, b, c]| grid.point(a, b, c));
                for tet in TETS {
                    let mut inside = vec![];
                    let mut outside = vec![];
                    for a in tet {
                        if values[ids[a]] < 0. {
                            inside.push(a);
                        } else {
                            outside.push(a);
                        }
                    }
                    if inside.is_empty() || outside.is_empty() {
                        continue;
                    }
                    let center = |v: &Vec<usize>| {
                        mul(
                            v.iter().fold([0.; 3], |p, &a| add(p, pts[a])),
                            1. / v.len() as f64,
                        )
                    };
                    let outward = sub(center(&outside), center(&inside));
                    let mut vertex = |mut a: usize, mut b: usize| {
                        if ids[b] < ids[a] {
                            std::mem::swap(&mut a, &mut b);
                        }
                        // Zero crossings at a grid point must share one vertex
                        // across every incident edge, including exact planar cuts.
                        let key = if values[ids[a]] == 0. {
                            (ids[a], ids[a])
                        } else if values[ids[b]] == 0. {
                            (ids[b], ids[b])
                        } else {
                            (ids[a], ids[b])
                        };
                        *edges.entry(key).or_insert_with(|| {
                            let t =
                                (values[ids[a]] / (values[ids[a]] - values[ids[b]])).clamp(0., 1.);
                            let v = mesh.vertices.len();
                            mesh.vertices.push(add(pts[a], mul(sub(pts[b], pts[a]), t)));
                            v
                        })
                    };
                    let tris = if inside.len() == 1 {
                        vec![[
                            vertex(inside[0], outside[0]),
                            vertex(inside[0], outside[1]),
                            vertex(inside[0], outside[2]),
                        ]]
                    } else if outside.len() == 1 {
                        vec![[
                            vertex(inside[0], outside[0]),
                            vertex(inside[1], outside[0]),
                            vertex(inside[2], outside[0]),
                        ]]
                    } else {
                        let a = vertex(inside[0], outside[0]);
                        let b = vertex(inside[0], outside[1]);
                        let c = vertex(inside[1], outside[1]);
                        let d = vertex(inside[1], outside[0]);
                        vec![[a, b, c], [a, c, d]]
                    };
                    for [a, mut b, mut c] in tris {
                        if a == b || b == c || a == c {
                            continue;
                        }
                        if dot(
                            cross(
                                sub(mesh.vertices[b], mesh.vertices[a]),
                                sub(mesh.vertices[c], mesh.vertices[a]),
                            ),
                            outward,
                        ) < 0.
                        {
                            std::mem::swap(&mut b, &mut c);
                        }
                        mesh.triangles.push([a, b, c]);
                    }
                }
            }
        }
    }
    mesh.validate().map_err(|_|"Constructed part is empty or exceeds the mesh budget; adjust the cut or use coarser spacing.".to_string())?;
    Ok(mesh)
}
#[cfg(test)]
fn bias(x: f64) -> f64 {
    if x.abs() <= 1e-9 {
        1e-9
    } else {
        x
    }
}
// STL stores float32 positions. Canonicalize at that exact precision before
// inspecting the solid, so a valid preview cannot become a broken STL on save.
// Only identical stored positions are welded; no spatial tolerance is used.
fn stl_precision(mesh: Mesh) -> Mesh {
    let mut vertices = vec![];
    let mut ids = HashMap::new();
    let remap: Vec<usize> = mesh
        .vertices
        .iter()
        .map(|p| {
            let p = p.map(|x| (x as f32) as f64);
            let key = p.map(|x| if x == 0. { 0 } else { x.to_bits() });
            *ids.entry(key).or_insert_with(|| {
                vertices.push(p);
                vertices.len() - 1
            })
        })
        .collect();
    let triangles = mesh
        .triangles
        .iter()
        .filter_map(|t| {
            let [a, b, c] = t.map(|i| remap[i]);
            if a == b || b == c || a == c {
                None
            } else {
                Some([a, b, c])
            }
        })
        .collect();
    Mesh {
        vertices,
        triangles,
    }
}
fn segment_distance(p: V, a: V, b: V) -> f64 {
    let v = sub(b, a);
    let t = (dot(sub(p, a), v) / dot(v, v).max(1e-30)).clamp(0., 1.);
    length(sub(p, add(a, mul(v, t))))
}
fn add_check(
    out: &mut Vec<placement::Check>,
    code: &str,
    status: &str,
    ids: Vec<String>,
    message: String,
) {
    out.push(placement::Check {
        code: code.into(),
        status: status.into(),
        part_ids: ids,
        message,
    });
}

pub fn construct(stock: &Mesh, p: &Project, paths: &[PathInfo]) -> Result<ResultParts, String> {
    let c = p.construction.as_ref().unwrap();
    let si = inspect(stock);
    if si.boundary_edges + si.nonmanifold_edges + si.inconsistent_edges + si.degenerate_triangles
        > 0
        || si.signed_volume_mm3 <= 0.
    {
        return Err("Shell construction requires a closed, outward-wound stock mesh without edge/topology defects.".into());
    }
    if c.faceplate_axis > 2
        || !c.resolution_mm.is_finite()
        || !(0.2..=1.).contains(&c.resolution_mm)
        || !c.wall_mm.is_finite()
        || c.wall_mm < 3. * c.resolution_mm
        || c.wall_mm > 5.
        || !c.faceplate_depth_mm.is_finite()
        || c.faceplate_depth_mm < 3. * c.resolution_mm
        || !c.faceplate_gap_mm.is_finite()
        || !(0. ..=1.).contains(&c.faceplate_gap_mm)
    {
        return Err("Use mesh spacing 0.2–1 mm, wall and faceplate depth at least 3× spacing, wall ≤5 mm, and a faceplate gap of 0–1 mm.".into());
    }
    let bounds = stock.bounds();
    let plane = bounds[1][c.faceplate_axis] - c.faceplate_depth_mm;
    if plane <= bounds[0][c.faceplate_axis] + c.wall_mm {
        return Err("Faceplate cut leaves no usable shell body; reduce its depth.".into());
    }
    if let Some(cut) = &c.connector {
        if !valid(cut.center_mm)
            || !valid(cut.rotation_deg)
            || cut
                .size_mm
                .iter()
                .any(|&v| !v.is_finite() || v < 3. * c.resolution_mm || v > 50.)
            || matches!(cut.shape, CutShape::Cylinder)
                && (cut.size_mm[0] - cut.size_mm[1]).abs() > 1e-9
        {
            return Err("Connector cut needs finite coordinates and sizes between 3× spacing and 50 mm. Cylinder X and Y must have equal diameter.".into());
        }
    }
    if c.cut_sound_paths
        && p.drivers
            .iter()
            .any(|d| d.inner_diameter_mm < 3. * c.resolution_mm)
    {
        return Err("A sound bore is smaller than 3× mesh spacing. Refine the grid or disable sound-path cuts.".into());
    }
    let grid = Grid::new(bounds, c.resolution_mm)?;
    let source = DistanceMesh::new(stock);
    let routes: Vec<Vec<V>> = paths
        .iter()
        .map(|p| {
            (0..=64)
                .map(|i| bezier(p.control_points, i as f64 / 64.))
                .collect()
        })
        .collect();
    let mut body_values = Vec::with_capacity(grid.count());
    let mut cap_values = Vec::with_capacity(grid.count());
    let (mut cavity_samples, mut connector_samples) = (0usize, 0usize);
    let mut bore_samples = vec![0usize; paths.len()];
    for q in grid.points() {
        let d = source.signed(q);
        let cavity = d + c.wall_mm;
        if cavity < 0. && q[c.faceplate_axis] < plane {
            cavity_samples += 1;
        }
        let mut body = d.max(-cavity).max(q[c.faceplate_axis] - plane);
        let mut cap = d.max(plane + c.faceplate_gap_mm - q[c.faceplate_axis]);
        if let Some(cut) = &c.connector {
            let hole = cut.distance(q);
            if hole < 0. && body.min(cap) < 0. {
                connector_samples += 1;
            }
            body = body.max(-hole);
            cap = cap.max(-hole);
        }
        if c.cut_sound_paths && body.min(cap) < c.resolution_mm * 2. {
            for (i, route) in routes.iter().enumerate() {
                let hole = route
                    .windows(2)
                    .map(|s| segment_distance(q, s[0], s[1]))
                    .fold(f64::INFINITY, f64::min)
                    - p.drivers[i].inner_diameter_mm / 2.;
                if hole < 0. && body.min(cap) < 0. {
                    bore_samples[i] += 1;
                }
                body = body.max(-hole);
                cap = cap.max(-hole);
            }
        }
        body_values.push(if body.abs() <= 1e-9 { 0. } else { body });
        cap_values.push(if cap.abs() <= 1e-9 { 0. } else { cap });
    }
    if cavity_samples == 0 {
        return Err("Wall setting leaves no resolved internal cavity; reduce wall thickness or enlarge the stock.".into());
    }
    let body = stl_precision(mesh_field(&grid, &body_values)?);
    let faceplate = stl_precision(mesh_field(&grid, &cap_values)?);
    let body_info = inspect(&body);
    let cap_info = inspect(&faceplate);
    for (label, i) in [("body", &body_info), ("faceplate", &cap_info)] {
        if i.boundary_edges + i.nonmanifold_edges + i.inconsistent_edges + i.degenerate_triangles
            > 0
            || i.signed_volume_mm3 <= 0.
        {
            return Err(format!("Constructed {label} failed closed-solid topology checks ({} boundary, {} nonmanifold, {} winding, {} degenerate); revise the features or resolution.",i.boundary_edges,i.nonmanifold_edges,i.inconsistent_edges,i.degenerate_triangles));
        }
    }
    let mut checks = vec![];
    add_check(&mut checks,"shell-construction","unverified",vec!["shell".into(),"faceplate".into()],format!("Hollow body and faceplate generated at {:.3} mm grid spacing. Wall {:.2} mm is a requested offset, not a certified minimum after machining; inspect thin features and confirm with a finer grid.",c.resolution_mm,c.wall_mm));
    if c.connector.is_some() {
        add_check(
            &mut checks,
            "connector-cut",
            if connector_samples > 0 {
                "unverified"
            } else {
                "warning"
            },
            vec!["shell".into()],
            if connector_samples > 0 {
                "Connector opening cuts the represented solid. Verify the exact connector drawing, retention, remaining wall and assembly access.".into()
            } else {
                "Connector opening removed no sampled material. Move it onto the wall or refine the grid.".into()
            },
        );
    }
    for (i, path) in paths.iter().enumerate() {
        let id = format!("path:{}", path.driver_id);
        if c.cut_sound_paths {
            let end = source.signed(path.control_points[3]);
            add_check(
                &mut checks,
                "sound-outlet",
                if end.abs() > p.drivers[i].inner_diameter_mm / 2. {
                    "warning"
                } else {
                    "unverified"
                },
                vec![id],
                if end.abs() > p.drivers[i].inner_diameter_mm / 2. {
                    "Sound bore does not reach the stock surface near its endpoint. Place the tube end just inside the intended outlet and inspect the opening; physical tubes must not protrude.".into()
                } else {
                    format!("Sound path cut removes {0} material samples. Confirm the outlet, bore continuity and tube seal; internal tubes remain separate parts.",bore_samples[i])
                },
            );
        }
    }
    Ok(ResultParts {
        body,
        faceplate,
        info: ConstructionInfo {
            resolution_mm: c.resolution_mm,
            requested_wall_mm: c.wall_mm,
            faceplate_plane_mm: plane,
            grid_points: grid.count(),
            cavity_volume_estimate_mm3: cavity_samples as f64 * grid.step.iter().product::<f64>(),
            body: body_info,
            faceplate: cap_info,
        },
        checks,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn polygonizer_matches_native_cpp_fixture() {
        let expected: Mesh = serde_json::from_str(include_str!(
            "../../../../tests/fixtures/workshop-native-solid.json"
        ))
        .unwrap();
        let grid = Grid::new([[-4.; 3], [4.; 3]], 0.5).unwrap();
        let values: Vec<_> = grid
            .points()
            .map(|p| {
                let d = length(p) - 3.17;
                bias(d.max(-(d + 1.3)))
            })
            .collect();
        let actual = mesh_field(&grid, &values).unwrap();
        assert_eq!(actual.triangles.len(), expected.triangles.len());
        assert_eq!(actual.vertices.len(), expected.vertices.len());
        // Native assigns vertex IDs after winding correction, Rust before it.
        // Compare the actual ordered triangle coordinates, not incidental vertex IDs.
        for (a, b) in actual.triangles.iter().zip(&expected.triangles) {
            for i in 0..3 {
                assert!(length(sub(actual.vertices[a[i]], expected.vertices[b[i]])) < 1e-10);
            }
        }
    }
    #[test]
    fn imported_mesh_distance_has_correct_sign_after_rotation() {
        let catalog: Vec<Preset> =
            serde_json::from_str(include_str!("../../../assets/workshop/drivers.json")).unwrap();
        let mut m = envelope(&catalog[13]);
        for v in &mut m.vertices {
            *v = add(rotate(*v, [23., 41., 17.]), [3., 2., 1.]);
        }
        let tree = DistanceMesh::new(&m);
        assert!((tree.signed([3., 2., 1.]) + 1.29).abs() < 1e-8);
        let q = add(rotate([4., 0., 0.], [23., 41., 17.]), [3., 2., 1.]);
        assert!((tree.signed(q) - 1.425).abs() < 1e-8);
    }
    #[test]
    fn implicit_sphere_and_hollow_sphere_are_closed_and_oriented() {
        let grid = Grid::new([[-4.; 3], [4.; 3]], 0.5).unwrap();
        for hollow in [false, true] {
            let values: Vec<_> = grid
                .points()
                .map(|p| {
                    let d = length(p) - 3.;
                    bias(if hollow { d.max(-(d + 1.5)) } else { d })
                })
                .collect();
            let m = mesh_field(&grid, &values).unwrap();
            let i = inspect(&m);
            assert_eq!(
                i.boundary_edges + i.nonmanifold_edges + i.inconsistent_edges,
                0
            );
            let analytic =
                4. / 3. * std::f64::consts::PI * (27. - if hollow { 1.5f64.powi(3) } else { 0. });
            assert!((i.signed_volume_mm3 - analytic).abs() / analytic < 0.05);
        }
    }
}
