//! Manufacturer-derived outlines. Clearance uses conservative enclosing solids.
use super::*;
#[derive(Deserialize)]
pub(super) struct Connector {
    pub id: String,
    pub name: String,
    pub size_mm: V,
    pieces: Vec<Piece>,
}
#[derive(Deserialize)]
struct Piece {
    shape: String,
    size_mm: V,
    position_mm: V,
    rotation_deg: V,
}
#[derive(Deserialize)]
pub(super) struct Interface {
    pub preset_id: usize,
    pub terminal_group_mm: V,
    pub terminal_axis: V,
    pub confidence: String,
    pub wiring: String,
    pub mount: String,
    pub missing: String,
    #[serde(default)]
    pieces: Vec<Piece>,
    #[serde(default)]
    contact_pieces: Vec<Piece>,
}
#[derive(Deserialize)]
struct Library {
    connectors: Vec<Connector>,
    driver_interfaces: Vec<Interface>,
}
fn library() -> Library {
    serde_json::from_str(include_str!("../../../assets/workshop/hardware.json"))
        .expect("checked hardware library")
}
pub(super) fn connector(id: &str) -> Option<Connector> {
    library().connectors.into_iter().find(|c| c.id == id)
}
pub(super) fn interface(id: usize) -> Option<Interface> {
    library()
        .driver_interfaces
        .into_iter()
        .find(|c| c.preset_id == id)
}
pub(super) fn box_shape(size: V) -> Mesh {
    let s = Preset {
        id: 0,
        name: String::new(),
        size_mm: size,
        cylindrical: false,
        outlet_mm: [0.; 3],
        outlet_axis: [0.; 3],
        outlet_diameter_mm: 1.,
        supplier_dimensioned: false,
        supplier_interface_dimensioned: false,
        dedicated_drive: false,
        rear_vent_required: false,
    };
    envelope(&s)
}
fn pieces(parts: Vec<Piece>, pos: V, rot: V) -> Option<Mesh> {
    if parts.is_empty() {
        return None;
    }
    let mut result = Mesh {
        vertices: vec![],
        triangles: vec![],
    };
    for part in parts {
        let mut mesh = if part.shape == "two_pin_face" {
            socket_face(part.size_mm)
        } else if part.shape == "cylinder" {
            // Use the established closed cylinder, with its axis turned from Y to Z.
            let s = Preset {
                id: 0,
                name: String::new(),
                size_mm: [part.size_mm[0], part.size_mm[2], part.size_mm[1]],
                cylindrical: true,
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
                *v = rotate(*v, [90., 0., 0.]);
            }
            m
        } else {
            box_shape(part.size_mm)
        };
        let offset = result.vertices.len();
        for v in &mut mesh.vertices {
            *v = add(
                pos,
                rotate(add(part.position_mm, rotate(*v, part.rotation_deg)), rot),
            );
        }
        result.vertices.extend(mesh.vertices);
        result
            .triangles
            .extend(mesh.triangles.into_iter().map(|t| t.map(|i| i + offset)));
    }
    Some(result)
}
// IJ-001G-POM's two 0.70 mm contact bores, 1.80 mm pitch. Two half-face
// annuli meet at X=0; actual contact springs and corner rounds are not modeled.
fn socket_face(size: V) -> Mesh {
    let mut m = Mesh {
        vertices: vec![],
        triangles: vec![],
    };
    let sides = 64;
    for sign in [-1., 1.] {
        let centre = sign * 0.9;
        let lo = if sign < 0. { -size[0] / 2. } else { 0. };
        let hi = if sign < 0. { 0. } else { size[0] / 2. };
        let offset = m.vertices.len();
        for z in [-size[2] / 2., size[2] / 2.] {
            for inner in [false, true] {
                for j in 0..sides {
                    let angle = j as f64 * std::f64::consts::TAU / sides as f64;
                    let (s, c) = angle.sin_cos();
                    let rx = if c > 1e-10 {
                        (hi - centre) / c
                    } else if c < -1e-10 {
                        (lo - centre) / c
                    } else {
                        f64::INFINITY
                    };
                    let ry = if s.abs() > 1e-10 {
                        size[1] / 2. / s.abs()
                    } else {
                        f64::INFINITY
                    };
                    let r = if inner { 0.35 } else { rx.min(ry) };
                    m.vertices.push([centre + c * r, s * r, z]);
                }
            }
        }
        for j in 0..sides {
            let q = (j + 1) % sides;
            let (a, b, c, d) = (
                offset + j,
                offset + q,
                offset + sides + j,
                offset + sides + q,
            );
            let e = 2 * sides;
            m.triangles.extend([
                [a, d, b],
                [a, c, d],
                [a + e, b + e, d + e],
                [a + e, d + e, c + e],
                [a, b, b + e],
                [a, b + e, a + e],
                [c, d + e, d],
                [c, c + e, d + e],
            ]);
        }
    }
    m
}
pub(super) fn connector_display(b: &assembly::Package) -> Option<Mesh> {
    pieces(
        connector(b.model.as_deref()?)?.pieces,
        b.position_mm,
        b.rotation_deg,
    )
}
pub(super) fn connector_contacts(b: &assembly::Package) -> Option<Mesh> {
    if b.model.as_deref() != Some("aec-ij-001g-pom") {
        return None;
    }
    // Dark contact recess indicators inside the documented 0.70 mm bores.
    // Their shallow depth is display-only; it is not a contact spring model.
    pieces(
        [-0.9, 0.9]
            .into_iter()
            .map(|x| Piece {
                shape: "cylinder".into(),
                size_mm: [0.69, 0.69, 0.02],
                position_mm: [x, 0., 3.64],
                rotation_deg: [0.; 3],
            })
            .collect(),
        b.position_mm,
        b.rotation_deg,
    )
}
pub(super) fn driver_display(d: &Driver) -> Option<Mesh> {
    pieces(interface(d.preset)?.pieces, d.position_mm, d.rotation_deg)
}
pub(super) fn driver_contacts(d: &Driver) -> Option<Mesh> {
    pieces(interface(d.preset)?.contact_pieces, d.position_mm, d.rotation_deg)
}
