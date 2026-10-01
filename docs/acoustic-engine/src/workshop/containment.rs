//! Containment of complete represented part surfaces in a closed shell envelope.
//! Bounds and vertex sampling alone cannot detect a triangle bridging a concavity.
use super::*;

// Numerical separation only, not an assembly/manufacturing allowance.
const SEPARATION_MM: f64 = 1e-5;

fn one_surface(mesh: &Mesh) -> bool {
    let mut parent: Vec<usize> = (0..mesh.vertices.len()).collect();
    fn root(parent: &mut [usize], mut i: usize) -> usize {
        while parent[i] != i {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        i
    }
    for &[a, b, c] in &mesh.triangles {
        let r = root(&mut parent, a);
        for i in [b, c] {
            let s = root(&mut parent, i);
            parent[s] = r;
        }
    }
    let r = root(&mut parent, mesh.triangles[0][0]);
    mesh.triangles.iter().all(|t| root(&mut parent, t[0]) == r)
}

pub fn inspect_parts(p: &Project, parts: &[Part], info: &MeshInfo) -> Vec<placement::Check> {
    let stock = &parts[0].mesh;
    let usable = info.boundary_edges
        + info.nonmanifold_edges
        + info.inconsistent_edges
        + info.degenerate_triangles
        == 0
        && info.signed_volume_mm3 > 0.
        && one_surface(stock);
    let tree = usable.then(|| solid::DistanceMesh::new(stock));
    let bounds = stock.bounds();
    let mut checks = vec![];
    for part in parts
        .iter()
        .filter(|part| part.kind == "driver" || part.kind == "path")
    {
        let cavity = if part.kind == "driver" {
            p.construction.as_ref()
        } else {
            None
        };
        let code = if cavity.is_some() {
            "package-cavity"
        } else if part.kind == "driver" {
            "package-shell"
        } else {
            "tube-shell"
        };
        let offset = cavity.map_or(0., |c| c.wall_mm);
        let plane = cavity.map(|c| {
            (
                c.faceplate_axis,
                bounds[1][c.faceplate_axis] - c.faceplate_depth_mm,
            )
        });
        let region = if cavity.is_some() {
            "requested shell cavity"
        } else {
            "curved shell envelope"
        };
        // WebGL and binary STL both store float32 positions. Validate those
        // exact surfaces so rounding cannot move a supposedly contained part out.
        let vertices: Vec<V> = part
            .mesh
            .vertices
            .iter()
            .map(|v| v.map(|x| (x as f32) as f64))
            .collect();
        let (status, detail) = if let Some(tree) = &tree {
            let outside = vertices.iter().any(|&v| {
                tree.signed(v) > -offset + SEPARATION_MM
                    || plane.is_some_and(|(axis, cut)| v[axis] > cut - SEPARATION_MM)
            });
            if outside {
                ("error", format!("extends outside or touches the {region}. Move/rotate the part or shorten/reroute the tube; its full outside diameter must fit."))
            } else if part
                .mesh
                .triangles
                .iter()
                .any(|t| tree.near_triangle(t.map(|i| vertices[i]), offset + SEPARATION_MM))
            {
                ("error", format!("a face crosses or approaches the {region} too closely. All corners being inside is insufficient on a curved or concave shell."))
            } else {
                ("pass", format!("complete represented mesh stays inside the {region}; numerical separation exceeds 0.00001 mm. Manufacturing allowance is separate."))
            }
        } else {
            ("unverified", "containment cannot be established: use a closed, outward-wound shell with one connected surface. Repair the shell before exporting parts.".into())
        };
        checks.push(placement::Check {
            code: code.into(),
            status: status.into(),
            part_ids: vec![part.id.clone()],
            message: format!("{}: {detail}", part.name),
        });
    }
    checks
}
