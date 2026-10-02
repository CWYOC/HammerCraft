//! A shared physical outlet plane, stored in unmirrored assembly millimetres.
use super::*;

// Covers float32 STL round-off, not a manufacturing allowance.
pub(super) const SURFACE_TOLERANCE: f64 = 0.0001;
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct OutletPlane {
    pub origin_mm: V,
    pub normal: V,
    pub lead_mm: f64,
}
impl OutletPlane {
    pub(super) fn axis(&self) -> Result<V, String> {
        if !valid(self.origin_mm)
            || !valid(self.normal)
            || length(self.normal) < 1e-8
            || !self.lead_mm.is_finite()
            || !(0.1..=50.).contains(&self.lead_mm)
        {
            return Err("Nozzle plane needs a finite point, a nonzero outward normal and an exit lead of 0.1–50 mm.".into());
        }
        Ok(norm(self.normal))
    }
    pub(super) fn signed(&self, point: V) -> f64 {
        dot(norm(self.normal), sub(point, self.origin_mm))
    }
    pub(super) fn bend(&self, end: V) -> V {
        sub(end, mul(norm(self.normal), self.lead_mm))
    }
    pub(super) fn on_surface(&self, tree: &solid::DistanceMesh, point: V) -> bool {
        let n = norm(self.normal);
        tree.signed(point).abs() <= SURFACE_TOLERANCE
            && tree.signed(sub(point, mul(n, 0.002))) < -0.001
            && tree.signed(add(point, mul(n, 0.002))) > 0.001
    }
    pub(super) fn validate(
        &self,
        stock: &Mesh,
        drivers: &[Driver],
        drilled: bool,
    ) -> Result<(), String> {
        let n = self.axis()?;
        let info = inspect(stock);
        if info.boundary_edges
            + info.nonmanifold_edges
            + info.inconsistent_edges
            + info.degenerate_triangles
            > 0
            || info.signed_volume_mm3 <= 0.
            || !containment::one_surface(stock)
        {
            return Err("Nozzle alignment requires a closed, outward-wound shell with one connected surface.".into());
        }
        let tree = solid::DistanceMesh::new(stock);
        let u = norm(cross(
            n,
            if n[1].abs() < 0.9 {
                [0., 1., 0.]
            } else {
                [1., 0., 0.]
            },
        ));
        let v = cross(n, u);
        for d in drivers {
            if self.signed(d.end_mm).abs() > 1e-7
                || length(sub(d.bend_mm, self.bend(d.end_mm))) > 1e-7
            {
                return Err("Tube outlets no longer match the shared nozzle plane. Align all outlets again.".into());
            }
            let r = if drilled {
                d.inner_diameter_mm
            } else {
                d.outer_diameter_mm
            } / 2.;
            // Check the complete outlet footprint, not only its centre. A tangent
            // plane on a curved side wall is not a planar nozzle face.
            for ring in 0..=4 {
                for j in 0..64 {
                    let a = j as f64 * std::f64::consts::TAU / 64.;
                    let point = add(
                        d.end_mm,
                        mul(add(mul(u, a.cos()), mul(v, a.sin())), r * ring as f64 / 4.),
                    );
                    if !self.on_surface(&tree, point) {
                        return Err(format!("{}: outlet footprint does not fit on this flat nozzle surface. Move the outlet sideways, reduce its diameter, or choose the correct nozzle face.",d.id));
                    }
                }
            }
        }
        for (i, a) in drivers.iter().enumerate() {
            for b in drivers.iter().skip(i + 1) {
                let diameter = |d: &Driver| {
                    if drilled {
                        d.inner_diameter_mm
                    } else {
                        d.outer_diameter_mm
                    }
                };
                if length(sub(a.end_mm, b.end_mm))
                    <= (diameter(a) + diameter(b)) / 2. + SURFACE_TOLERANCE
                {
                    return Err("Nozzle outlets overlap or touch. Give each tube a separate position on the nozzle face before aligning.".into());
                }
            }
        }
        Ok(())
    }
}

fn detect(stock: &Mesh, d: &Driver, lead_mm: f64) -> Result<OutletPlane, String> {
    let tree = solid::DistanceMesh::new(stock);
    let origin = d.bend_mm;
    let direction = norm(sub(d.end_mm, origin));
    if length(direction) < 0.5 || tree.signed(origin) >= -SURFACE_TOLERANCE {
        return Err("Aim the selected tube toward the nozzle with a distinct bend point inside the shell, then detect again.".into());
    }
    let mut nearest: Option<(f64, V)> = None;
    for t in &stock.triangles {
        let [a, b, c] = t.map(|i| stock.vertices[i]);
        let e1 = sub(b, a);
        let e2 = sub(c, a);
        let h = cross(direction, e2);
        let det = dot(e1, h);
        if det.abs() < 1e-12 {
            continue;
        }
        let delta = sub(origin, a);
        let u = dot(delta, h) / det;
        let q = cross(delta, e1);
        let v = dot(direction, q) / det;
        let distance = dot(e2, q) / det;
        if u >= -1e-9
            && v >= -1e-9
            && u + v <= 1. + 1e-9
            && distance > 0.
            && nearest.is_none_or(|(best, _)| distance < best)
        {
            nearest = Some((distance, norm(cross(e1, e2))));
        }
    }
    let (distance, normal) =
        nearest.ok_or("No nozzle surface found in the selected tube's exit direction.")?;
    if dot(normal, direction) <= 0.1 {
        return Err("The selected path grazes the shell. Aim it through the nozzle face.".into());
    }
    Ok(OutletPlane {
        origin_mm: add(origin, mul(direction, distance)),
        normal,
        lead_mm,
    })
}

/// Preserve lateral bore locations, project all centres and make the final
/// Bezier tangent normal to the face so every complete annulus is coplanar.
pub fn align(mut p: Project, base: &Mesh, driver_id: &str) -> Result<Project, String> {
    // Validate the existing inputs without requiring an already satisfied lock
    // or an already open drilled outlet.
    let previous_nozzle = p.nozzle.take();
    let construction = p.construction.take();
    build_inner(&p, base, false)?;
    p.construction = construction;
    p.nozzle = previous_nozzle;
    if p.drivers.is_empty() {
        return Err("Add a sound path before aligning nozzle outlets.".into());
    }
    let mut stock = base.clone();
    for v in &mut stock.vertices {
        for i in 0..3 {
            v[i] *= p.shell_scale[i];
        }
    }
    if !driver_id.is_empty() {
        let d = p
            .drivers
            .iter()
            .find(|d| d.id == driver_id)
            .ok_or("Select a driver to aim nozzle detection.")?;
        p.nozzle = Some(detect(
            &stock,
            d,
            p.nozzle.as_ref().map_or(3., |n| n.lead_mm),
        )?);
    }
    let nozzle = p
        .nozzle
        .as_mut()
        .ok_or("Detect the nozzle surface or enter a shared nozzle plane first.")?;
    nozzle.normal = nozzle.axis()?;
    let requested_lead = nozzle.lead_mm;
    for d in &mut p.drivers {
        d.end_mm = sub(d.end_mm, mul(nozzle.normal, nozzle.signed(d.end_mm)));
    }
    // Detection may choose a longer exit tangent to avoid folding the inlet
    // curve. Explicit manual edits keep the requested lead exactly.
    let leads = if driver_id.is_empty() {
        vec![requested_lead]
    } else {
        vec![requested_lead, 1., 2., 4., 5., 6., 8., 10.]
    };
    let mut last_error = String::new();
    for lead in leads {
        let nozzle = p.nozzle.as_mut().unwrap();
        nozzle.lead_mm = lead;
        for d in &mut p.drivers {
            d.bend_mm = nozzle.bend(d.end_mm);
        }
        let result = build_inner(&p, base, false)?;
        if let Some(error) = result.paths.iter().flat_map(|p| &p.placement_errors).next() {
            last_error = error.clone();
            continue;
        }
        build(&p, base)?;
        return Ok(p);
    }
    Err(format!("Cannot align outlets with a contained, nonintersecting route: {last_error} Adjust the exit lead or driver placement."))
}
