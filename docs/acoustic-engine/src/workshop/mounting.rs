//! A socket's local +Z mating face is flush with a verified planar stock surface.
use super::*;

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Mount {
    pub origin_mm: V,
    pub normal: V,
    pub fit_clearance_mm: f64,
}
impl Mount {
    pub(super) fn plane(&self) -> nozzle::OutletPlane {
        nozzle::OutletPlane {
            origin_mm: self.origin_mm,
            normal: self.normal,
            lead_mm: 1.,
        }
    }
    pub(super) fn cut(&self, b: &assembly::Package) -> solid::Cut {
        // Full conservative body/tail pocket. Retention features are not invented.
        solid::Cut {
            shape: solid::CutShape::Box,
            center_mm: add(b.position_mm, mul(norm(self.normal), 0.5)),
            rotation_deg: b.rotation_deg,
            size_mm: [
                b.size_mm[0] + 2. * self.fit_clearance_mm,
                b.size_mm[1] + 2. * self.fit_clearance_mm,
                b.size_mm[2] + 1. + 2. * self.fit_clearance_mm,
            ],
        }
    }
    pub(super) fn validate(&self, p: &Project, stock: &Mesh) -> Result<(), String> {
        if !valid(self.origin_mm)
            || !valid(self.normal)
            || (length(self.normal) - 1.).abs() > 1e-6
            || !self.fit_clearance_mm.is_finite()
            || !(0.01..=1.).contains(&self.fit_clearance_mm)
        {
            return Err("Invalid connector surface. Use a unit normal and per-side opening allowance 0.01–1 mm.".into());
        }
        let b = p
            .assembly
            .as_ref()
            .and_then(|a| a.connector.as_ref())
            .ok_or("A surface mount requires an enabled connector.")?;
        let si = inspect(stock);
        if si.boundary_edges
            + si.nonmanifold_edges
            + si.inconsistent_edges
            + si.degenerate_triangles
            > 0
            || si.signed_volume_mm3 <= 0.
            || !containment::one_surface(stock)
        {
            return Err("Connector seating needs one closed, outward-wound shell.".into());
        }
        let plane = self.plane();
        let face = add(
            b.position_mm,
            rotate([0., 0., b.size_mm[2] / 2.], b.rotation_deg),
        );
        if plane.signed(face).abs() > 1e-7
            || length(sub(rotate([0., 0., 1.], b.rotation_deg), self.normal)) > 1e-7
        {
            return Err("Connector pose no longer matches its saved mounting surface. Seat the connector again or unlock it.".into());
        }
        let tree = solid::DistanceMesh::new(stock);
        let cut = self.cut(b);
        for x in 0..=8 {
            for y in 0..=8 {
                let q = add(
                    face,
                    rotate(
                        [
                            (x as f64 / 8. - 0.5) * cut.size_mm[0],
                            (y as f64 / 8. - 0.5) * cut.size_mm[1],
                            0.,
                        ],
                        b.rotation_deg,
                    ),
                );
                if !plane.on_surface(&tree, q) {
                    return Err("The connector opening does not fit on this flat shell surface. Choose a larger flat mounting area; curved walls require a designed mounting pad.".into());
                }
            }
        }
        if let Some(c) = &p.construction {
            let actual = c
                .connector
                .as_ref()
                .ok_or("The mounted connector requires its matching shell opening.")?;
            if !matches!(actual.shape, solid::CutShape::Box)
                || length(sub(actual.center_mm, cut.center_mm)) > 1e-7
                || length(sub(actual.size_mm, cut.size_mm)) > 1e-7
                || length(sub(actual.rotation_deg, cut.rotation_deg)) > 1e-7
            {
                return Err("Connector opening is stale. Apply the mounted connector to synchronize its cut.".into());
            }
            // Verify the pocket reaches usable cavity, not merely an exterior dimple.
            let rear = sub(
                b.position_mm,
                rotate([0., 0., b.size_mm[2] / 2.], b.rotation_deg),
            );
            if tree.signed(rear) >= -c.wall_mm || faceplate::resolve(c, stock)?.signed(rear) >= 0. {
                return Err("Connector depth does not reach the shell cavity. Reduce the wall or use a deeper socket.".into());
            }
        }
        Ok(())
    }
}
fn rotation(n: V) -> V {
    [
        0.,
        n[2].clamp(-1., 1.).acos().to_degrees(),
        n[1].atan2(n[0]).to_degrees(),
    ]
}
fn pose(p: &mut Project, mount: Mount) -> Result<(), String> {
    let b = p
        .assembly
        .as_mut()
        .and_then(|a| a.connector.as_mut())
        .ok_or("Enable assembly planning and the pin connector first.")?;
    let old_face = add(
        b.position_mm,
        rotate([0., 0., b.size_mm[2] / 2.], b.rotation_deg),
    );
    let face = sub(old_face, mul(mount.normal, mount.plane().signed(old_face)));
    b.rotation_deg = rotation(mount.normal);
    b.position_mm = sub(face, mul(mount.normal, b.size_mm[2] / 2.));
    if let Some(c) = &mut p.construction {
        c.connector = Some(mount.cut(b));
    }
    p.connector_mount = Some(mount);
    Ok(())
}
pub fn seat(mut p: Project, base: &Mesh, detect: bool, allowance: f64) -> Result<Project, String> {
    if !detect {
        let mount = p
            .connector_mount
            .clone()
            .ok_or("No saved connector mounting surface.")?;
        pose(&mut p, mount)?;
        build_inner(&p, base, false)?;
        return Ok(p);
    }
    // The normal build checks poses, sizes, models, and shell scale before searching.
    p.connector_mount = None;
    build_inner(&p, base, false)?;
    let b = p
        .assembly
        .as_ref()
        .and_then(|a| a.connector.as_ref())
        .ok_or("Enable assembly planning and the pin connector first.")?
        .clone();
    let mut stock = base.clone();
    for v in &mut stock.vertices {
        for i in 0..3 {
            v[i] *= p.shell_scale[i];
        }
    }
    let axis = rotate([0., 0., 1.], b.rotation_deg);
    let mut faces: Vec<(f64, V, V)> = vec![];
    let mut seen = HashSet::new();
    for t in &stock.triangles {
        let [a, bv, c] = t.map(|i| stock.vertices[i]);
        let n = norm(cross(sub(bv, a), sub(c, a)));
        if length(n) < 0.9 {
            continue;
        }
        let q = sub(b.position_mm, mul(n, dot(sub(b.position_mm, a), n)));
        let key = [
            (n[0] * 1e5).round() as i64,
            (n[1] * 1e5).round() as i64,
            (n[2] * 1e5).round() as i64,
            (dot(n, a) * 1e4).round() as i64,
        ];
        if !seen.insert(key) {
            continue;
        }
        // Prefer the face towards the socket's current mating direction, then proximity.
        let score = placement::point_triangle(b.position_mm, a, bv, c) + 5. * (1. - dot(axis, n));
        faces.push((score, q, n));
    }
    faces.sort_by(|a, b| a.0.total_cmp(&b.0));
    // Dense curved shells may have thousands of tiny facets. Explicitly include
    // their dominant connected flat patch before the bounded fallback search.
    if let Ok(surface) = faceplate::detect(&stock) {
        let q = sub(
            b.position_mm,
            mul(surface.normal, surface.signed(b.position_mm)),
        );
        faces.insert(0, (-1., q, surface.normal));
    }
    let mut last = "No sufficiently large flat surface found.".to_string();
    for (_, point, n) in faces.into_iter().take(128) {
        let mut candidate = p.clone();
        let mount = Mount {
            origin_mm: point,
            normal: n,
            fit_clearance_mm: allowance,
        };
        pose(&mut candidate, mount)?;
        candidate.assembly.as_mut().unwrap().cables.clear();
        match build_inner(&candidate, base, false) {
            Ok(built) => {
                // Other existing errors remain visible; never accept a colliding socket.
                if let Some(check) = built.placement_checks.iter().find(|c| {
                    c.status == "error" && c.part_ids.iter().any(|id| id == "assembly:connector")
                }) {
                    last = check.message.clone();
                    continue;
                }
                build(&candidate, base)?;
                return Ok(candidate);
            }
            Err(e) => last = e,
        }
    }
    Err(format!("Could not seat the connector: {last} Move it near a flat mounting area and try again. Previous layout retained."))
}
