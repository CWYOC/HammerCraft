//! Spatial planning only: harnesses reserve space; they never create electrical nets.
use super::*;
use std::cmp::Reverse;
use std::collections::BinaryHeap;

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Package {
    pub size_mm: V,
    pub position_mm: V,
    pub rotation_deg: V,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Cable {
    pub id: String,
    pub from: String,
    pub to: String,
    pub points_mm: Vec<V>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Assembly {
    pub connector: Option<Package>,
    pub crossover: Option<Package>,
    pub clearance_mm: f64,
    /// Outside diameter of a reserved insulated harness, not conductor gauge.
    pub cable_diameter_mm: f64,
    #[serde(default)]
    pub cables: Vec<Cable>,
}
fn check(code: &str, ok: bool, ids: Vec<String>, message: String) -> placement::Check {
    placement::Check {
        code: code.into(),
        status: if ok { "pass" } else { "error" }.into(),
        part_ids: ids,
        message,
    }
}
fn validate(a: &Assembly) -> Result<(), String> {
    if !a.clearance_mm.is_finite()
        || !(0.1..=2.).contains(&a.clearance_mm)
        || !a.cable_diameter_mm.is_finite()
        || !(0.2..=2.).contains(&a.cable_diameter_mm)
        || a.cables.len() > 13
    {
        return Err(
            "Use assembly clearance 0.1–2 mm, harness diameter 0.2–2 mm and at most 13 harnesses."
                .into(),
        );
    }
    for b in [&a.connector, &a.crossover].into_iter().flatten() {
        if let Some(id)=&b.model {
            let model=hardware::connector(id).ok_or("Unknown hardware model. Choose a catalog socket or Custom envelope.")?;
            if length(sub(b.size_mm,model.size_mm))>1e-7 {
                return Err("Catalog connector dimensions were changed. Select Custom envelope to edit its size.".into());
            }
        }
        if !valid(b.position_mm)
            || !valid(b.rotation_deg)
            || b.size_mm
                .iter()
                .any(|x| !x.is_finite() || !(0.5..=30.).contains(x))
        {
            return Err("Connector and board need finite poses and dimensions 0.5–30 mm.".into());
        }
    }
    let mut ids = HashSet::new();
    for c in &a.cables {
        if c.id.is_empty()
            || c.id.len() > 100
            || !ids.insert(&c.id)
            || c.points_mm.len() < 2
            || c.points_mm.len() > 128
            || c.points_mm.iter().any(|&v| !valid(v))
            || c.points_mm
                .windows(2)
                .any(|s| length(sub(s[0], s[1])) < 1e-5)
        {
            return Err("Harness IDs must be unique; routes need 2–128 finite, distinct consecutive points.".into());
        }
    }
    Ok(())
}
fn box_mesh(b: &Package) -> Mesh {
    let s = Preset {
        id: 0,
        name: String::new(),
        size_mm: b.size_mm,
        cylindrical: false,
        outlet_mm: [0.; 3],
        outlet_axis: [0.; 3],
        outlet_diameter_mm: 1.,
        supplier_dimensioned: false,
        supplier_interface_dimensioned: false,
        dedicated_drive: false,
        rear_vent_required: false,
    };
    let mut m = envelope(&s);
    for v in &mut m.vertices {
        *v = add(b.position_mm, rotate(*v, b.rotation_deg));
    }
    m
}
fn cable_mesh(points: &[V], r: f64) -> Mesh {
    let mut m = Mesh {
        vertices: vec![],
        triangles: vec![],
    };
    let sides = 12;
    let mut previous = [1., 0., 0.];
    for (i, &p) in points.iter().enumerate() {
        let tangent = norm(sub(
            points[(i + 1).min(points.len() - 1)],
            points[i.saturating_sub(1)],
        ));
        let mut n = sub(previous, mul(tangent, dot(previous, tangent)));
        if length(n) < 1e-6 {
            n = cross(
                tangent,
                if tangent[1].abs() < 0.9 {
                    [0., 1., 0.]
                } else {
                    [0., 0., 1.]
                },
            );
        }
        n = norm(n);
        previous = n;
        let b = norm(cross(tangent, n));
        for j in 0..sides {
            let angle = j as f64 * std::f64::consts::TAU / sides as f64;
            m.vertices.push(add(
                p,
                add(mul(n, r * angle.cos()), mul(b, r * angle.sin())),
            ));
        }
    }
    for i in 0..points.len() - 1 {
        for j in 0..sides {
            let k = (j + 1) % sides;
            let a = i * sides;
            let b = a + sides;
            m.triangles
                .extend([[a + j, a + k, b + k], [a + j, b + k, b + j]]);
        }
    }
    let e = (points.len() - 1) * sides;
    let a = m.vertices.len();
    m.vertices.extend([points[0], *points.last().unwrap()]);
    for j in 0..sides {
        let k = (j + 1) % sides;
        m.triangles.extend([[a, k, j], [a + 1, e + j, e + k]]);
    }
    m
}
pub(super) fn append(a: &Assembly, parts: &mut Vec<Part>) -> Result<(), String> {
    validate(a)?;
    for (kind, b) in [("connector", &a.connector), ("crossover", &a.crossover)] {
        if let Some(b) = b {
            parts.push(Part {
                id: format!("assembly:{kind}"),
                name: format!("{kind} planning envelope"),
                kind: kind.into(),
                mesh: box_mesh(b),
                display_mesh: if kind=="connector" {hardware::connector_display(b)} else {None},
                contact_mesh: if kind=="connector" {hardware::connector_contacts(b)} else {None},
            });
        }
    }
    for c in &a.cables {
        parts.push(Part {
            id: format!("assembly:cable:{}", c.id),
            name: format!("Harness {} → {} (space reservation)", c.from, c.to),
            kind: "cable".into(),
            mesh: cable_mesh(&c.points_mm, a.cable_diameter_mm / 2.),
            display_mesh: None,
            contact_mesh: None,
        });
    }
    Ok(())
}
fn package_parts(parts: &[Part]) -> Vec<&Part> {
    parts
        .iter()
        .filter(|p| matches!(p.kind.as_str(), "driver" | "connector" | "crossover"))
        .collect()
}
fn route_segments(paths: &[PathInfo], p: &Project) -> Vec<(V, V, f64)> {
    paths
        .iter()
        .enumerate()
        .flat_map(|(i, path)| {
            // Linear interpolation error <= max |B''(t)| h² / 8. Inflate
            // chord capsules so a curve cannot slip between clearance samples.
            let c = path.control_points;
            let acceleration = 6.
                * length(add(sub(c[2], mul(c[1], 2.)), c[0]))
                    .max(length(add(sub(c[3], mul(c[2], 2.)), c[1])));
            let chord_allowance = acceleration / (8. * 64. * 64.);
            (0..64).map(move |j| {
                (
                    bezier(path.control_points, j as f64 / 64.),
                    bezier(path.control_points, (j + 1) as f64 / 64.),
                    p.drivers[i].outer_diameter_mm / 2. + chord_allowance,
                )
            })
        })
        .collect()
}
fn port(p: &Project, id: &str, other: &str) -> Option<V> {
    let a = p.assembly.as_ref()?;
    let stand = a.cable_diameter_mm / 2. + a.clearance_mm + 0.05;
    let d = p.drivers.iter().find(|d| d.id == id);
    if let Some(d) = d {
        let cat: Vec<Preset> =
            serde_json::from_str(include_str!("../../../assets/workshop/drivers.json")).ok()?;
        let s = cat.iter().find(|s| s.id == d.preset)?;
        if let Some(interface)=hardware::interface(d.preset) {
            return Some(add(d.position_mm,rotate(add(interface.terminal_group_mm,mul(interface.terminal_axis,stand)),d.rotation_deg)));
        }
        // Provisional for catalog entries without an independently documented terminal region.
        let axis = s.outlet_axis;
        let reach = (0..3)
            .map(|i| axis[i].abs() * s.size_mm[i] / 2.)
            .sum::<f64>()
            + stand;
        return Some(add(
            d.position_mm,
            rotate(mul(axis, -reach), d.rotation_deg),
        ));
    }
    let b = match id {
        "assembly:connector" => a.connector.as_ref()?,
        "assembly:crossover" => a.crossover.as_ref()?,
        _ => return None,
    };
    if id=="assembly:connector" && (p.connector_mount.is_some() || b.model.is_some()) {
        return Some(add(b.position_mm,rotate([0.,0.,-b.size_mm[2]/2.-stand],b.rotation_deg)));
    }
    let (x, y) = if id == "assembly:crossover" && other != "assembly:connector" {
        let i = p.drivers.iter().position(|d| d.id == other)?;
        let pitch = a.cable_diameter_mm + 2. * a.clearance_mm;
        (
            (i as f64 - (p.drivers.len() as f64 - 1.) / 2.) * pitch,
            b.size_mm[1] / 2. + stand,
        )
    } else {
        (0., -b.size_mm[1] / 2. - stand)
    };
    Some(add(b.position_mm, rotate([x, y, 0.], b.rotation_deg)))
}
pub(super) fn inspect(
    p: &Project,
    parts: &[Part],
    paths: &[PathInfo],
) -> Result<Vec<placement::Check>, String> {
    let Some(a) = &p.assembly else {
        return Ok(vec![]);
    };
    validate(a)?;
    let mut out = vec![];
    let packages = package_parts(parts);
    let bodies: Vec<_> = packages
        .iter()
        .map(|p| placement::Body::new(&p.mesh))
        .collect();
    for i in 0..packages.len() {
        for j in i + 1..packages.len() {
            let gap = -placement::overlap(&bodies[i], &bodies[j]);
            out.push(check(
                "assembly-clearance",
                gap >= a.clearance_mm,
                vec![packages[i].id.clone(), packages[j].id.clone()],
                format!(
                    "{} / {}: separating clearance {:.2} mm; requested {:.2} mm.",
                    packages[i].name, packages[j].name, gap, a.clearance_mm
                ),
            ));
        }
    }
    let segments = route_segments(paths, p);
    for (i, b) in bodies
        .iter()
        .enumerate()
        .filter(|(i, _)| packages[*i].kind != "driver")
    {
        let ok = segments
            .iter()
            .all(|&(u, v, r)| b.distance(u, v) >= r + a.clearance_mm);
        out.push(check(
            "assembly-sound-path",
            ok,
            vec![packages[i].id.clone()],
            format!(
                "{}: {}sound-channel clearance.",
                packages[i].name,
                if ok { "passes " } else { "insufficient " }
            ),
        ));
    }
    for (i, c) in a.cables.iter().enumerate() {
        let id = format!("assembly:cable:{}", c.id);
        let radius = a.cable_diameter_mm / 2.;
        let attached = port(p, &c.from, &c.to)
            .zip(port(p, &c.to, &c.from))
            .is_some_and(|(s, e)| {
                length(sub(s, c.points_mm[0])) < 1e-4
                    && length(sub(e, *c.points_mm.last().unwrap())) < 1e-4
            });
        out.push(check(
            "cable-anchors",
            attached,
            vec![id.clone()],
            format!(
                "Harness {}: {}. Re-route cables after moving parts.",
                c.id,
                if attached {
                    "planning anchors match"
                } else {
                    "anchors are missing or stale"
                }
            ),
        ));
        let clear = c.points_mm.windows(2).all(|s| {
            bodies
                .iter()
                .all(|b| b.distance(s[0], s[1]) >= radius + a.clearance_mm - 1e-5)
                && segments.iter().all(|&(u, v, r)| {
                    placement::segment_distance(s[0], s[1], u, v).0 >= radius + r + a.clearance_mm
                })
        });
        out.push(check(
            "cable-clearance",
            clear,
            vec![id.clone()],
            format!(
                "Harness {}: {} package and sound-path clearance.",
                c.id,
                if clear { "passes" } else { "fails" }
            ),
        ));
        for other in &a.cables[..i] {
            let ok = c.points_mm.windows(2).all(|s| {
                other.points_mm.windows(2).all(|t| {
                    placement::segment_distance(s[0], s[1], t[0], t[1]).0
                        >= 2. * radius + a.clearance_mm
                })
            });
            out.push(check(
                "cable-cable",
                ok,
                vec![id.clone(), format!("assembly:cable:{}", other.id)],
                format!(
                    "Harnesses {} / {}: {} separation.",
                    c.id,
                    other.id,
                    if ok { "pass" } else { "insufficient" }
                ),
            ));
        }
    }
    out.push(placement::Check{code:"assembly-interfaces".into(),status:"unverified".into(),part_ids:vec![],message:"Catalog sockets use manufacturer nominal envelopes; custom parts remain user dimensions. Harnesses approach documented terminal regions where available and provisional anchors otherwise. They reserve a conductor pair, not electrical nets or individual solder joints. Verify pad numbering, crossover component heights, cable insulation, bend radius and retention; schematic polarity is unchanged.".into()});
    if let Some(b)=&a.connector {
        if let Some(model)=b.model.as_deref().and_then(hardware::connector) {
            out.push(placement::Check{code:"connector-dimensions".into(),status:"pass".into(),part_ids:vec!["assembly:connector".into()],message:format!("{}: manufacturer nominal dimensions loaded; full body and solder-tail envelope reserved. Supplier tolerances and fit allowance are separate.",model.name)});
        }
    }
    Ok(out)
}

fn inside(
    tree: &solid::DistanceMesh,
    mesh: &Mesh,
    offset: f64,
    plane: Option<faceplate::Plane>,
) -> bool {
    mesh.vertices
        .iter()
        .all(|&v| tree.signed(v) < -offset && plane.is_none_or(|plane| plane.signed(v) < 0.))
        && mesh
            .triangles
            .iter()
            .all(|t| !tree.near_triangle(t.map(|i| mesh.vertices[i]), offset))
}
// A segment swept by a ball is contained if its endpoints are inside and its
// distance to every stock triangle exceeds the required radius/offset.
fn segment_inside(
    tree: &solid::DistanceMesh,
    u: V,
    v: V,
    r: f64,
    plane: Option<faceplate::Plane>,
    cap_margin: f64,
) -> bool {
    tree.signed(u) < -r
        && tree.signed(v) < -r
        && !tree.near_triangle([u, v, v], r)
        && plane.is_none_or(|plane| {
            plane.signed(u) + cap_margin < 0. && plane.signed(v) + cap_margin < 0.
        })
}
fn layout_ok(b: &Build) -> bool {
    b.export_blockers.is_empty()
        && !b.placement_checks.iter().any(|c| {
            c.status == "warning"
                && matches!(
                    c.code.as_str(),
                    "package-package" | "tube-package" | "tube-tube"
                )
        })
}

/// Deterministic, bounded greedy search. No dimensions or electrical IDs change.
pub fn arrange(mut p: Project, base: &Mesh, mount_allowance: f64) -> Result<Project, String> {
    // Validate the complete input (including construction settings) before search.
    build(&p, base)?;
    if p.connector_mount.is_none() && p.assembly.as_ref().is_some_and(|a|a.connector.is_some()) {
        // These parts will move during packing. Their old poses must not force
        // the fixed socket onto an inferior face or trap its harness anchor.
        let drivers=std::mem::take(&mut p.drivers);
        let a=p.assembly.as_mut().unwrap();
        let board=a.crossover.take();
        a.cables.clear();
        p=mounting::seat(p,base,true,mount_allowance)?;
        p.drivers=drivers;
        p.assembly.as_mut().unwrap().crossover=board;
    }
    let mut stock = base.clone();
    for v in &mut stock.vertices {
        for i in 0..3 {
            v[i] *= p.shell_scale[i];
        }
    }
    let info = super::inspect(&stock);
    if info.boundary_edges
        + info.nonmanifold_edges
        + info.inconsistent_edges
        + info.degenerate_triangles
        > 0
        || info.signed_volume_mm3 <= 0.
        || !containment::one_surface(&stock)
    {
        return Err("Auto arrange requires one closed, outward-wound shell.".into());
    }
    let tree = solid::DistanceMesh::new(&stock);
    let bounds = stock.bounds();
    let clearance = p.assembly.as_ref().map_or(0.2, |a| a.clearance_mm);
    let offset = p.construction.as_ref().map_or(0., |c| c.wall_mm) + clearance;
    let cap_plane = p
        .construction
        .as_ref()
        .map(|c| faceplate::resolve(c, &stock))
        .transpose()?;
    let plane = cap_plane.map(|plane| plane.inset(clearance));
    let step = 2.;
    let dims: Vec<usize> = (0..3)
        .map(|i| ((bounds[1][i] - bounds[0][i]) / step).ceil() as usize)
        .collect();
    if dims.iter().product::<usize>() > 60000 {
        return Err("Shell is too large for the bounded auto-arrange search. Reduce its scale or arrange manually.".into());
    }
    let mut points = vec![];
    for x in 0..dims[0] {
        for y in 0..dims[1] {
            for z in 0..dims[2] {
                let v = [x, y, z].map(|n| n as f64);
                let q = std::array::from_fn(|i| bounds[0][i] + (v[i] + 0.5) * step);
                if tree.signed(q) < -offset {
                    points.push(q);
                }
            }
        }
    }
    let original = p.drivers.clone();
    p.drivers.clear();
    let mirrored = p.mirrored;
    p.mirrored = false;
    let mut equipment = p.assembly.take();
    if let Some(a) = &mut equipment {
        a.cables.clear();
        p.assembly = Some(Assembly {
            connector: if p.connector_mount.is_some() {a.connector.clone()} else {None},
            crossover: None,
            clearance_mm: a.clearance_mm,
            cable_diameter_mm: a.cable_diameter_mm,
            cables: vec![],
        });
    }
    // Drivers are placed largest first; final serialized order remains unchanged.
    let cat: Vec<Preset> =
        serde_json::from_str(include_str!("../../../assets/workshop/drivers.json"))
            .map_err(|e| e.to_string())?;
    let mut order: Vec<_> = original.iter().collect();
    order.sort_by(|a, b| {
        let size = |d: &Driver| {
            cat.iter()
                .find(|s| s.id == d.preset)
                .unwrap()
                .size_mm
                .iter()
                .product::<f64>()
        };
        size(b).total_cmp(&size(a))
    });
    for d in order {
        let s = cat.iter().find(|s| s.id == d.preset).unwrap();
        let mut candidates = points.clone();
        candidates.push(d.position_mm);
        candidates.sort_by(|a, b| {
            length(sub(*a, d.position_mm)).total_cmp(&length(sub(*b, d.position_mm)))
        });
        let mut found = None;
        let mut attempts = 0;
        'search: for pos in candidates {
            for rot in [
                d.rotation_deg,
                [0., 0., 0.],
                [0., 0., 90.],
                [0., 0., -90.],
                [0., 0., 180.],
                [0., 90., 0.],
                [0., -90., 0.],
            ] {
                let mut mesh = envelope(s);
                for v in &mut mesh.vertices {
                    *v = add(pos, rotate(*v, rot));
                }
                if !inside(&tree, &mesh, offset, plane) {
                    continue;
                }
                let start = add(pos, rotate(s.outlet_mm, rot));
                let axis = rotate(s.outlet_axis, rot);
                // Keep the chosen acoustic outlet; route shape follows the new pose.
                if dot(sub(d.end_mm, start), axis) <= 0.5 {
                    continue;
                }
                let mut n = d.clone();
                n.position_mm = pos;
                n.rotation_deg = rot;
                let next = add(start, mul(axis, n.lead_mm));
                n.bend_mm = p.nozzle.as_ref().map_or_else(
                    || add(next, mul(sub(n.end_mm, next), 0.6)),
                    |nozzle| nozzle.bend(n.end_mm));
                p.drivers.push(n.clone());
                let b = build_inner(&p, base, false);
                let ok = b
                    .as_ref()
                    .is_ok_and(|b| layout_ok(b) && anchors_clear(&p, b, &tree, cap_plane));
                p.drivers.pop();
                attempts += 1;
                if ok {
                    found = Some(n);
                    break 'search;
                }
                if attempts >= 320 {
                    break 'search;
                }
            }
        }
        let Some(d) = found else {
            return Err(format!("Auto arrange could not fit {} with its saved sound outlet and clearance. Previous layout retained. Move the outlet, reduce the part count, or arrange manually.",s.name));
        };
        p.drivers.push(d);
    }
    p.drivers
        .sort_by_key(|d| original.iter().position(|o| o.id == d.id).unwrap());
    if let Some(mut a) = equipment {
        let equipment = [
            ("connector", a.connector.take()),
            ("crossover", a.crossover.take()),
        ];
        for (key, item) in equipment {
            let Some(mut item) = item else { continue };
            if key=="connector" && p.connector_mount.is_some() {
                a.connector=Some(item); p.assembly=Some(a.clone()); continue;
            }
            let mut candidates = points.clone();
            candidates.push(item.position_mm);
            // Connector prefers a wall-adjacent interior position; board prefers its saved pose.
            candidates.sort_by(|u, v| {
                let score = |q: V| {
                    if key == "connector" {
                        (-tree.signed(q) - offset).abs() + length(sub(q, item.position_mm)) * 0.15
                    } else {
                        length(sub(q, item.position_mm))
                    }
                };
                score(*u).total_cmp(&score(*v))
            });
            let mut found = None;
            for pos in candidates {
                item.position_mm = pos;
                let m = box_mesh(&item);
                if !inside(&tree, &m, offset, plane) {
                    continue;
                }
                if key == "connector" {
                    a.connector = Some(item.clone());
                } else {
                    a.crossover = Some(item.clone());
                }
                p.assembly = Some(a.clone());
                let b = build_inner(&p, base, false)?;
                if layout_ok(&b) && anchors_clear(&p, &b, &tree, cap_plane) {
                    found = Some(item.clone());
                    break;
                }
            }
            let Some(item) = found else {
                return Err(format!(
                    "No safe location found for the {key} envelope. Previous layout retained."
                ));
            };
            if key == "connector" {
                a.connector = Some(item);
            } else {
                a.crossover = Some(item);
            }
        }
        p.assembly = Some(a);
        route_cables(&mut p, base, &tree, bounds, cap_plane)?;
    }
    p.mirrored = mirrored;
    let result = build(&p, base)?;
    if !layout_ok(&result) {
        return Err(format!(
            "Auto arrange did not pass final geometry checks: {} Previous layout retained.",
            result
                .export_blockers
                .first()
                .map_or("route contact", String::as_str)
        ));
    }
    Ok(p)
}

/// Extend the saved final route direction to the first outward stock crossing.
/// The cutter's rounded cap opens the wall; the centre stays just inside stock.
pub fn extend_outlets(mut p: Project, base: &Mesh) -> Result<Project, String> {
    if p.nozzle.is_some() { return nozzle::align(p,base,""); }
    if !p.construction.as_ref().is_some_and(|c| c.drilled_channels) {
        return Err("Select drilled channels with shell construction enabled first.".into());
    }
    let construction = p.construction.take();
    build_inner(&p, base, false)?;
    p.construction = construction;
    let mut stock = base.clone();
    for v in &mut stock.vertices {
        for i in 0..3 {
            v[i] *= p.shell_scale[i];
        }
    }
    let tree = solid::DistanceMesh::new(&stock);
    for d in &mut p.drivers {
        let axis = norm(sub(d.end_mm, d.bend_mm));
        if length(axis) < 0.5 || tree.signed(d.end_mm) >= 0. {
            return Err(
                "Start with the channel endpoint inside the shell and a distinct bend point."
                    .into(),
            );
        }
        let origin = d.end_mm;
        let mut distance = 0.;
        while distance < 100. && tree.signed(add(origin, mul(axis, distance))) < 0. {
            distance += 0.25;
        }
        if distance >= 100. {
            return Err("No outlet wall found along the saved channel direction.".into());
        }
        let (mut lo, mut hi) = ((distance - 0.25).max(0.), distance);
        for _ in 0..30 {
            let mid = (lo + hi) / 2.;
            if tree.signed(add(origin, mul(axis, mid))) < 0. {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        d.end_mm = add(origin, mul(axis, lo - d.inner_diameter_mm * 0.125));
    }
    build(&p, base)?;
    Ok(p)
}
pub fn reroute(mut p: Project, base: &Mesh) -> Result<Project, String> {
    build(&p, base)?;
    let mut stock = base.clone();
    for v in &mut stock.vertices {
        for i in 0..3 {
            v[i] *= p.shell_scale[i];
        }
    }
    let tree = solid::DistanceMesh::new(&stock);
    let plane = p
        .construction
        .as_ref()
        .map(|c| faceplate::resolve(c, &stock))
        .transpose()?;
    route_cables(&mut p, base, &tree, stock.bounds(), plane)?;
    let b = build(&p, base)?;
    if !layout_ok(&b) {
        return Err(format!(
            "Cable routing failed final geometry checks: {}",
            b.export_blockers
                .first()
                .map_or("route contact", String::as_str)
        ));
    }
    Ok(p)
}
fn route_cables(
    p: &mut Project,
    base: &Mesh,
    tree: &solid::DistanceMesh,
    bounds: [V; 2],
    plane: Option<faceplate::Plane>,
) -> Result<(), String> {
    let Some(a) = &mut p.assembly else {
        return Err("Enable assembly planning first.".into());
    };
    a.cables.clear();
    let radius = a.cable_diameter_mm / 2.;
    let clearance = a.clearance_mm;
    let mut pairs = vec![];
    let hub = if a.crossover.is_some() {
        "assembly:crossover"
    } else {
        "assembly:connector"
    };
    if a.connector.is_some() && a.crossover.is_some() {
        pairs.push((
            "assembly:connector".to_string(),
            "assembly:crossover".to_string(),
        ));
    }
    if a.crossover.is_some() || a.connector.is_some() {
        for d in &p.drivers {
            pairs.push((hub.into(), d.id.clone()));
        }
    }
    // A common connector anchor cannot reserve multiple separate harnesses.
    if a.crossover.is_none() && p.drivers.len() > 1 {
        return Err("Enable a crossover-board envelope as a harness distribution point for multiple drivers.".into());
    }
    if let Some(b) = &a.crossover {
        let width = p.drivers.len() as f64 * (2. * radius + 2. * clearance);
        if width > b.size_mm[0] {
            return Err(format!("Board needs at least {width:.2} mm width for separate harness anchors. Increase its actual envelope width or reduce the harness diameter/clearance."));
        }
    }
    let mirror = p.mirrored;
    p.mirrored = false;
    let b = build_inner(p, base, false)?;
    p.mirrored = mirror;
    let packages = package_parts(&b.parts);
    let bodies: Vec<_> = packages
        .iter()
        .map(|p| placement::Body::new(&p.mesh))
        .collect();
    let sounds = route_segments(&b.paths, p);
    let offset = p.construction.as_ref().map_or(0., |c| c.wall_mm) + radius + clearance;
    let mut routed: Vec<Cable> = vec![];
    for (from, to) in pairs {
        let start = port(p, &from, &to).ok_or("Missing harness start anchor.")?;
        let end = port(p, &to, &from).ok_or("Missing harness end anchor.")?;
        let free = |u: V, v: V| {
            segment_inside(tree, u, v, offset, plane, radius + clearance)
                && bodies
                    .iter()
                    .all(|b| b.distance(u, v) >= radius + clearance - 1e-5)
                && sounds.iter().all(|&(a, b, r)| {
                    placement::segment_distance(u, v, a, b).0 > radius + r + clearance
                })
                && routed.iter().all(|c| {
                    c.points_mm.windows(2).all(|s| {
                        placement::segment_distance(u, v, s[0], s[1]).0 > 2. * radius + clearance
                    })
                })
        };
        let points=route_grid(start,end,bounds,&free).ok_or_else(||format!("No contained cable route from {from} to {to}. Move parts or increase available clearance. Previous layout retained."))?;
        routed.push(Cable {
            id: format!("h{}", routed.len() + 1),
            from,
            to,
            points_mm: points,
        });
    }
    p.assembly.as_mut().unwrap().cables = routed;
    Ok(())
}
fn anchors_clear(
    p: &Project,
    b: &Build,
    tree: &solid::DistanceMesh,
    plane: Option<faceplate::Plane>,
) -> bool {
    let Some(a) = &p.assembly else { return true };
    let r = a.cable_diameter_mm / 2. + a.clearance_mm;
    let offset = p.construction.as_ref().map_or(0., |c| c.wall_mm) + r;
    let packages = package_parts(&b.parts);
    let bodies: Vec<_> = packages
        .iter()
        .map(|p| placement::Body::new(&p.mesh))
        .collect();
    let sounds = route_segments(&b.paths, p);
    let mut anchors: Vec<V> = p
        .drivers
        .iter()
        .filter_map(|d| port(p, &d.id, "assembly:crossover"))
        .collect();
    if a.connector.is_some() {
        anchors.extend(port(p, "assembly:connector", "assembly:crossover"));
    }
    if a.crossover.is_some() {
        anchors.extend(port(p, "assembly:crossover", "assembly:connector"));
        for d in &p.drivers {
            anchors.extend(port(p, "assembly:crossover", &d.id));
        }
    }
    anchors.into_iter().all(|q| {
        tree.signed(q) < -offset
            && plane.is_none_or(|plane| plane.signed(q) + r < 0.)
            && bodies.iter().all(|body| body.distance(q, q) >= r - 1e-5)
            && sounds
                .iter()
                .all(|&(u, v, s)| placement::segment_distance(q, q, u, v).0 > r + s)
    })
}
fn route_grid(start: V, end: V, bounds: [V; 2], free: &impl Fn(V, V) -> bool) -> Option<Vec<V>> {
    if free(start, end) {
        return Some(vec![start, end]);
    }
    let step = (length(sub(bounds[1], bounds[0])) / 65.).max(1.);
    let dims: [usize; 3] =
        std::array::from_fn(|i| ((bounds[1][i] - bounds[0][i]) / step).ceil() as usize + 1);
    let count = dims.iter().product::<usize>();
    if count > 80000 {
        return None;
    }
    let xyz = |i: usize| {
        [
            i % dims[0],
            (i / dims[0]) % dims[1],
            i / (dims[0] * dims[1]),
        ]
    };
    let point = |i: usize| {
        let n = xyz(i);
        std::array::from_fn(|a| bounds[0][a] + n[a] as f64 * step)
    };
    let mut cost = vec![usize::MAX; count];
    let mut parent = vec![usize::MAX; count];
    let mut heap = BinaryHeap::new();
    // Multiple start/end grid neighbours prevent a single obstructed snap from failing a route.
    for i in 0..count {
        let q = point(i);
        if length(sub(q, start)) < 2. * step && free(start, q) {
            let g = (length(sub(q, start)) * 1000.) as usize;
            cost[i] = g;
            heap.push(Reverse((g + (length(sub(q, end)) * 1000.) as usize, i)));
        }
    }
    let mut found = None;
    let mut visits = 0;
    let mut visited = vec![false; count];
    while let Some(Reverse((_, i))) = heap.pop() {
        if visited[i] {
            continue;
        }
        visited[i] = true;
        let q = point(i);
        if length(sub(q, end)) < 2. * step && free(q, end) {
            found = Some(i);
            break;
        }
        visits += 1;
        if visits > 12000 {
            break;
        }
        let n = xyz(i);
        for axis in 0..3 {
            for delta in [-1isize, 1] {
                let k = n[axis] as isize + delta;
                if k < 0 || k >= dims[axis] as isize {
                    continue;
                }
                let mut next = n;
                next[axis] = k as usize;
                let j = next[0] + dims[0] * (next[1] + dims[1] * next[2]);
                let g = cost[i] + 1000;
                if g >= cost[j] || !free(q, point(j)) {
                    continue;
                }
                cost[j] = g;
                parent[j] = i;
                heap.push(Reverse((
                    g + (length(sub(point(j), end)) * 1000.) as usize,
                    j,
                )));
            }
        }
    }
    let mut i = found?;
    let mut route = vec![end];
    loop {
        route.push(point(i));
        if parent[i] == usize::MAX {
            break;
        }
        i = parent[i];
    }
    route.push(start);
    route.reverse();
    let mut smooth = vec![start];
    let mut i = 0;
    while i < route.len() - 1 {
        let j = (i + 1..route.len())
            .rev()
            .find(|&j| free(route[i], route[j]))?;
        smooth.push(route[j]);
        i = j;
    }
    Some(smooth)
}
