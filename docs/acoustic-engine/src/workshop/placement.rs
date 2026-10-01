//! Checks of the represented package envelopes and routes, not a manufacturing certificate.
//! Curves are adaptively bounded by line segments. Possible capsule contact is a warning;
//! an actual point inside a package or a positive convex-package overlap is an error.
use super::*;

const EPS: f64 = 1e-7;
const CURVE_TOLERANCE_MM: f64 = 0.01;

#[derive(Serialize)]
pub struct Check {
    pub code: String,
    pub status: String,
    pub part_ids: Vec<String>,
    pub message: String,
}
fn push(out: &mut Vec<Check>, code: &str, status: &str, ids: &[&str], message: String) {
    out.push(Check {
        code: code.into(),
        status: status.into(),
        part_ids: ids.iter().map(|s| s.to_string()).collect(),
        message,
    });
}
fn point_segment(p: V, a: V, b: V) -> f64 {
    let v = sub(b, a);
    let t = (dot(sub(p, a), v) / dot(v, v).max(1e-30)).clamp(0., 1.);
    length(sub(p, add(a, mul(v, t))))
}
// Closest distance and parameters on two finite line segments, including point segments.
fn segment_distance(a: V, b: V, c: V, d: V) -> (f64, f64, f64) {
    let (u, v, w) = (sub(b, a), sub(d, c), sub(a, c));
    let (aa, bb, cc, dd, ee) = (dot(u, u), dot(u, v), dot(v, v), dot(u, w), dot(v, w));
    let (mut s, mut t);
    if aa <= 1e-20 && cc <= 1e-20 {
        return (length(w), 0., 0.);
    }
    if aa <= 1e-20 {
        s = 0.;
        t = (ee / cc).clamp(0., 1.);
    } else if cc <= 1e-20 {
        t = 0.;
        s = (-dd / aa).clamp(0., 1.);
    } else {
        let denom = aa * cc - bb * bb;
        s = if denom > 1e-14 * aa * cc {
            ((bb * ee - cc * dd) / denom).clamp(0., 1.)
        } else {
            0.
        };
        t = (bb * s + ee) / cc;
        if t < 0. {
            t = 0.;
            s = (-dd / aa).clamp(0., 1.);
        } else if t > 1. {
            t = 1.;
            s = ((bb - dd) / aa).clamp(0., 1.);
        }
    }
    (length(sub(add(a, mul(u, s)), add(c, mul(v, t)))), s, t)
}
fn point_triangle(p: V, a: V, b: V, c: V) -> f64 {
    let n = norm(cross(sub(b, a), sub(c, a)));
    let q = sub(p, mul(n, dot(sub(p, a), n)));
    if length(n) > 0.
        && [(a, b), (b, c), (c, a)]
            .iter()
            .all(|&(x, y)| dot(cross(sub(y, x), sub(q, x)), n) >= -1e-12)
    {
        dot(sub(p, a), n).abs()
    } else {
        point_segment(p, a, b)
            .min(point_segment(p, b, c))
            .min(point_segment(p, c, a))
    }
}
fn segment_triangle(a: V, b: V, p: V, q: V, r: V) -> f64 {
    let n = norm(cross(sub(q, p), sub(r, p)));
    let den = dot(sub(b, a), n);
    if den.abs() > 1e-14 {
        let t = dot(sub(p, a), n) / den;
        if (0. ..=1.).contains(&t) && point_triangle(add(a, mul(sub(b, a), t)), p, q, r) < 1e-9 {
            return 0.;
        }
    }
    let mut d = point_triangle(a, p, q, r).min(point_triangle(b, p, q, r));
    for (x, y) in [(p, q), (q, r), (r, p)] {
        d = d.min(segment_distance(a, b, x, y).0);
    }
    d
}
fn add_axis(axes: &mut Vec<V>, v: V) {
    let v = norm(v);
    if length(v) > 0. && !axes.iter().any(|&a| dot(a, v).abs() > 1. - 1e-10) {
        axes.push(v);
    }
}
struct Body<'a> {
    mesh: &'a Mesh,
    planes: Vec<(V, V)>,
    axes: Vec<V>,
    edges: Vec<V>,
    bounds: [V; 2],
}
impl<'a> Body<'a> {
    fn new(mesh: &'a Mesh) -> Self {
        let (mut planes, mut axes, mut edges) = (vec![], vec![], vec![]);
        for &[i, j, k] in &mesh.triangles {
            let (a, b, c) = (mesh.vertices[i], mesh.vertices[j], mesh.vertices[k]);
            let n = norm(cross(sub(b, a), sub(c, a)));
            if !planes
                .iter()
                .any(|&(v, p)| dot(v, n) > 1. - 1e-10 && dot(n, sub(a, p)).abs() < EPS)
            {
                planes.push((n, a));
            }
            add_axis(&mut axes, n);
            for (p, q) in [(a, b), (b, c), (c, a)] {
                add_axis(&mut edges, sub(q, p));
            }
        }
        Self {
            mesh,
            planes,
            axes,
            edges,
            bounds: mesh.bounds(),
        }
    }
    fn inside(&self, p: V) -> bool {
        self.planes.iter().all(|&(n, a)| dot(n, sub(p, a)) < -EPS)
    }
    fn distance(&self, a: V, b: V) -> f64 {
        if self.inside(a) || self.inside(b) {
            return 0.;
        }
        self.mesh
            .triangles
            .iter()
            .map(|&[i, j, k]| {
                segment_triangle(
                    a,
                    b,
                    self.mesh.vertices[i],
                    self.mesh.vertices[j],
                    self.mesh.vertices[k],
                )
            })
            .fold(f64::INFINITY, f64::min)
    }
}
fn ranges_overlap(a: [V; 2], b: [V; 2], margin: f64) -> bool {
    (0..3).all(|i| a[0][i] <= b[1][i] + margin && b[0][i] <= a[1][i] + margin)
}
fn segment_bounds(a: V, b: V) -> [V; 2] {
    [
        std::array::from_fn(|i| a[i].min(b[i])),
        std::array::from_fn(|i| a[i].max(b[i])),
    ]
}
fn projection(m: &Mesh, axis: V) -> [f64; 2] {
    m.vertices
        .iter()
        .fold([f64::INFINITY, f64::NEG_INFINITY], |r, &v| {
            let x = dot(v, axis);
            [r[0].min(x), r[1].max(x)]
        })
}
// SAT is exact for the represented convex box / faceted cylinder, including rotations.
fn overlap(a: &Body, b: &Body) -> f64 {
    if !ranges_overlap(a.bounds, b.bounds, EPS) {
        return -1.;
    }
    let mut axes = a.axes.clone();
    for &n in &b.axes {
        add_axis(&mut axes, n);
    }
    for &x in &a.edges {
        for &y in &b.edges {
            add_axis(&mut axes, cross(x, y));
        }
    }
    let mut depth = f64::INFINITY;
    for n in axes {
        let (p, q) = (projection(a.mesh, n), projection(b.mesh, n));
        let d = p[1].min(q[1]) - p[0].max(q[0]);
        if d < -EPS {
            return d;
        }
        depth = depth.min(d);
    }
    depth
}
#[derive(Clone)]
struct Segment {
    a: V,
    b: V,
    error: f64,
    start: f64,
    end: f64,
}
fn flatten(p: [V; 4], depth: u32, out: &mut Vec<Segment>) {
    // A Bezier lies in its control hull; distance to the chord segment is convex.
    let error = point_segment(p[1], p[0], p[3]).max(point_segment(p[2], p[0], p[3]));
    if error <= CURVE_TOLERANCE_MM || depth == 10 {
        let start = out.last().map_or(0., |s| s.end);
        out.push(Segment {
            a: p[0],
            b: p[3],
            error,
            start,
            end: start + length(sub(p[3], p[0])),
        });
    } else {
        let a = mul(add(p[0], p[1]), 0.5);
        let b = mul(add(p[1], p[2]), 0.5);
        let c = mul(add(p[2], p[3]), 0.5);
        let d = mul(add(a, b), 0.5);
        let e = mul(add(b, c), 0.5);
        let f = mul(add(d, e), 0.5);
        flatten([p[0], a, d, f], depth + 1, out);
        flatten([f, e, c, p[3]], depth + 1, out);
    }
}
fn velocity(p: [V; 4], t: f64) -> V {
    add(
        add(
            mul(sub(p[1], p[0]), 3. * (1. - t).powi(2)),
            mul(sub(p[2], p[1]), 6. * t * (1. - t)),
        ),
        mul(sub(p[3], p[2]), 3. * t * t),
    )
}
fn acceleration(p: [V; 4], t: f64) -> V {
    add(
        mul(add(sub(p[2], mul(p[1], 2.)), p[0]), 6. * (1. - t)),
        mul(add(sub(p[3], mul(p[2], 2.)), p[1]), 6. * t),
    )
}
fn stationary_reversal(p: [V; 4]) -> bool {
    for axis in 0..3 {
        let a = 3. * (-p[0][axis] + 3. * p[1][axis] - 3. * p[2][axis] + p[3][axis]);
        let b = 6. * (p[0][axis] - 2. * p[1][axis] + p[2][axis]);
        let c = 3. * (p[1][axis] - p[0][axis]);
        let roots = if a.abs() < 1e-12 {
            if b.abs() < 1e-12 {
                vec![]
            } else {
                vec![-c / b]
            }
        } else {
            let disc = b * b - 4. * a * c;
            if disc < 0. {
                vec![]
            } else {
                vec![(-b - disc.sqrt()) / (2. * a), (-b + disc.sqrt()) / (2. * a)]
            }
        };
        for t in roots {
            if t > 1e-6
                && t < 1. - 1e-6
                && length(velocity(p, t)) < 1e-7
                && dot(norm(velocity(p, t - 1e-6)), norm(velocity(p, t + 1e-6))) < -0.5
            {
                return true;
            }
        }
    }
    false
}

pub fn inspect_layout(
    p: &Project,
    catalog: &[Preset],
    parts: &[Part],
    paths: &[PathInfo],
    shell: &MeshInfo,
) -> Vec<Check> {
    let mut out = vec![];
    let bounds = parts[0].mesh.bounds();
    let bodies: Vec<_> = p
        .drivers
        .iter()
        .map(|d| Body::new(&parts.iter().find(|a| a.id == d.id).unwrap().mesh))
        .collect();
    let routes: Vec<Vec<Segment>> = paths
        .iter()
        .map(|path| {
            let mut s = vec![];
            flatten(path.control_points, 0, &mut s);
            s
        })
        .collect();
    if shell.boundary_edges
        + shell.nonmanifold_edges
        + shell.inconsistent_edges
        + shell.degenerate_triangles
        > 0
    {
        push(
            &mut out,
            "shell-topology",
            "error",
            &["shell"],
            "Shell has topology defects; repair it before using it as a solid.".into(),
        );
    } else if shell.signed_volume_mm3 <= EPS {
        push(&mut out,"shell-orientation","error",&["shell"],"Shell has inward or zero-volume orientation. Check solid winding and disconnected components.".into());
    } else {
        push(&mut out,"shell-topology","pass",&["shell"],"Shell edge topology and total orientation passed; self-intersections and individual solid components remain unchecked.".into());
    }
    for (i, d) in p.drivers.iter().enumerate() {
        let s = catalog.iter().find(|s| s.id == d.preset).unwrap();
        let label = format!("{:02} · {}", i + 1, s.name);
        let path_id = format!("path:{}", d.id);
        let path = paths[i].control_points;
        let r = d.outer_diameter_mm / 2.;
        let outside = (0..3).any(|a| {
            bodies[i].bounds[0][a] < bounds[0][a] - EPS
                || bodies[i].bounds[1][a] > bounds[1][a] + EPS
        });
        push(
            &mut out,
            "package-stock-bounds",
            if outside { "error" } else { "pass" },
            &[&d.id],
            if outside {
                format!("{label}: package exceeds the shell's bounding box.")
            } else {
                format!("{label}: inside stock bounds; finished cavity containment is unverified.")
            },
        );
        push(
            &mut out,
            "part-dimensions",
            if s.supplier_dimensioned && s.supplier_interface_dimensioned {
                "pass"
            } else {
                "unverified"
            },
            &[&d.id],
            if s.supplier_dimensioned && s.supplier_interface_dimensioned {
                format!("{label}: catalog marks package and outlet as supplier-dimensioned; mounting allowances remain unverified.")
            } else {
                format!("{label}: verify provisional package/outlet dimensions against the exact supplier drawing.")
            },
        );
        push(&mut out,"outlet-adapter","unverified",&[&d.id,&path_id],format!("{label}: {:.2} mm catalog outlet → {:.2} mm tube bore. Adapter, spout engagement and seal geometry are not defined.",s.outlet_diameter_mm,d.inner_diameter_mm));
        if s.rear_vent_required {
            push(&mut out,"rear-vent","unverified",&[&d.id],format!("{label}: rear vent requires a defined air region, clearance and back volume; these are not modeled."));
        }
        if s.dedicated_drive {
            push(
                &mut out,
                "drive-electronics",
                "unverified",
                &[&d.id],
                format!("{label}: dedicated drive electronics have no physical placement."),
            );
        }
        for j in i + 1..p.drivers.len() {
            let depth = overlap(&bodies[i], &bodies[j]);
            let status = if depth > EPS {
                "error"
            } else if depth >= -EPS {
                "warning"
            } else {
                "pass"
            };
            push(
                &mut out,
                "package-package",
                status,
                &[&d.id, &p.drivers[j].id],
                format!(
                    "{label} / driver {:02}: {}",
                    j + 1,
                    if status == "error" {
                        "package envelopes overlap. Move or rotate a driver."
                    } else if status == "warning" {
                        "package envelopes touch; a permitted contact and assembly allowance must be defined."
                    } else {
                        "represented package envelopes do not overlap; manufacturing clearance is unverified."
                    }
                ),
            );
        }
        let route_mesh = &parts.iter().find(|a| a.id == path_id).unwrap().mesh;
        for (j, body) in bodies.iter().enumerate() {
            let own = i == j;
            // Exact curve endpoints and rendered outer-ring vertices provide positive evidence.
            // Contacts on the outlet plane are not strict interior points, so no timed exemption
            // can hide a route that turns back into its own receiver.
            let inside = routes[i]
                .iter()
                .any(|seg| body.inside(seg.a) || body.inside(seg.b))
                || route_mesh.vertices[..route_mesh.vertices.len() / 2]
                    .iter()
                    .any(|&v| body.inside(v));
            let axis = rotate(s.outlet_axis, d.rotation_deg);
            let possible = !inside
                && routes[i].iter().any(|seg| {
                    // Capsule end caps overestimate contact behind a valid own-outlet plane.
                    if own
                        && dot(sub(seg.a, path[0]), axis) >= -EPS
                        && dot(sub(seg.b, path[0]), axis) >= -EPS
                        && body
                            .mesh
                            .vertices
                            .iter()
                            .all(|&v| dot(sub(v, path[0]), axis) <= EPS)
                    {
                        return false;
                    }
                    ranges_overlap(segment_bounds(seg.a, seg.b), body.bounds, r + seg.error)
                        && body.distance(seg.a, seg.b) <= r + seg.error + EPS
                });
            push(
                &mut out,
                if own {
                    "tube-own-package"
                } else {
                    "tube-package"
                },
                if inside {
                    "error"
                } else if possible {
                    "warning"
                } else {
                    "pass"
                },
                &[&path_id, &p.drivers[j].id],
                format!(
                    "{label}: {} driver {:02}. {}",
                    if inside {
                        "tube penetrates"
                    } else if possible {
                        "tube may contact"
                    } else {
                        "route checked against"
                    },
                    j + 1,
                    if inside {
                        "Reroute it outside the package."
                    } else if possible {
                        "Conservative route envelope overlaps; inspect and separate the parts."
                    } else {
                        "No penetration/contact detected in this check; physical outlet and assembly allowances remain unverified."
                    }
                ),
            );
        }
        let min_radius = (0..=256)
            .filter_map(|k| {
                let t = k as f64 / 256.;
                let v = velocity(path, t);
                let speed = length(v);
                let cross_len = length(cross(v, acceleration(path, t)));
                if speed > 1e-9 && cross_len > 1e-12 {
                    Some(speed.powi(3) / cross_len)
                } else {
                    None
                }
            })
            .fold(f64::INFINITY, f64::min);
        let reversal = stationary_reversal(path);
        let folded = reversal || min_radius < r - EPS;
        push(
            &mut out,
            "tube-bend",
            if folded { "error" } else { "unverified" },
            &[&path_id],
            if reversal {
                format!("{label}: route reverses at an interior zero tangent; the tube folds back on itself.")
            } else if folded {
                format!("{label}: sampled bend radius {:.3} mm is smaller than tube outside radius {:.3} mm; the sweep folds locally.",min_radius,r)
            } else {
                format!("{label}: no local fold found in 257 bend samples. A material/process minimum bend radius has not been supplied.")
            },
        );
        let loose = routes[i]
            .iter()
            .any(|seg| seg.error > CURVE_TOLERANCE_MM + EPS);
        if loose {
            push(&mut out,"curve-resolution","unverified",&[&path_id],format!("{label}: route reached the subdivision limit; contact warnings include the larger curve bound. Refine this route."));
        }
        let mut self_contact = false;
        for (a, x) in routes[i].iter().enumerate() {
            for y in routes[i].iter().skip(a + 2) {
                if y.start - x.end <= std::f64::consts::PI * r {
                    continue;
                }
                if ranges_overlap(
                    segment_bounds(x.a, x.b),
                    segment_bounds(y.a, y.b),
                    2. * r + x.error + y.error,
                ) && segment_distance(x.a, x.b, y.a, y.b).0 <= 2. * r + x.error + y.error + EPS
                {
                    self_contact = true;
                    break;
                }
            }
            if self_contact {
                break;
            }
        }
        push(
            &mut out,
            "tube-self-contact",
            if self_contact { "warning" } else { "pass" },
            &[&path_id],
            if self_contact {
                format!("{label}: nonlocal portions of the tube may overlap. Separate the returning route; conservative envelopes are used.")
            } else {
                format!("{label}: no nonlocal route contact detected; local bends are checked separately.")
            },
        );
        for j in i + 1..p.drivers.len() {
            let r2 = p.drivers[j].outer_diameter_mm / 2.;
            let mut contact = false;
            for x in &routes[i] {
                for y in &routes[j] {
                    if ranges_overlap(
                        segment_bounds(x.a, x.b),
                        segment_bounds(y.a, y.b),
                        r + r2 + x.error + y.error,
                    ) && segment_distance(x.a, x.b, y.a, y.b).0
                        <= r + r2 + x.error + y.error + EPS
                    {
                        contact = true;
                        break;
                    }
                }
                if contact {
                    break;
                }
            }
            push(
                &mut out,
                "tube-tube",
                if contact { "warning" } else { "pass" },
                &[&path_id, &format!("path:{}", p.drivers[j].id)],
                format!(
                    "{label} / driver {:02}: {}",
                    j + 1,
                    if contact {
                        "tube envelopes may overlap. Separate the routes or define a real acoustic junction; shared junctions are not modeled."
                    } else {
                        "conservative tube envelopes are separated; manufacturing clearance is unverified."
                    }
                ),
            );
        }
    }
    for (code,message) in [
        ("finished-shell","Finished cavities, tube-to-shell containment, remaining wall thickness and shell self-intersections are not evaluated."),
        ("manufacturing-clearance","No qualified material/process clearance profile is defined. Numerical geometry limits are not manufacturing allowances."),
        ("physical-assembly","Damper seats, connectors, crossover components, insulated wires, adhesive regions and assembly access are not represented in 3D."),
    ] {push(&mut out,code,"unverified",&[],message.into());}
    if p.mirrored {
        push(&mut out,"mirrored-components","unverified",&[],"Mirrored package interfaces must be realizable with actual purchased parts; handedness and both-side assembly access are not verified.".into());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn distances_cover_crossing_parallel_and_degenerate_segments() {
        assert!(segment_distance([-1., 0., 0.], [1., 0., 0.], [0., -1., 0.], [0., 1., 0.]).0 < EPS);
        assert!(
            (segment_distance([0., 0., 0.], [2., 0., 0.], [1., 3., 0.], [3., 3., 0.]).0 - 3.).abs()
                < EPS
        );
        assert!(
            (segment_distance([0., 0., 0.], [0., 0., 0.], [1., 0., 0.], [2., 0., 0.]).0 - 1.).abs()
                < EPS
        );
        assert!(
            segment_triangle(
                [0.2, 0.2, -1.],
                [0.2, 0.2, 1.],
                [0., 0., 0.],
                [1., 0., 0.],
                [0., 1., 0.]
            ) < EPS
        );
    }
    #[test]
    fn curve_bounds_cover_collinear_reversal_and_curvature() {
        let p = [[0., 0., 0.], [10., 0., 0.], [-10., 0., 0.], [1., 0., 0.]];
        assert!(stationary_reversal(p));
        let mut segments = vec![];
        flatten(p, 0, &mut segments);
        assert!(segments.len() > 1);
        for k in 0..=1000 {
            let point = bezier(p, k as f64 / 1000.);
            assert!(segments
                .iter()
                .any(|s| point_segment(point, s.a, s.b) <= s.error + EPS));
        }
        assert!(!stationary_reversal([
            [0., 0., 0.],
            [0., 0., 0.],
            [0., 0., 3.],
            [0., 0., 6.]
        ]));
    }
}
