use engineering_core::structural::{Request, principal, solve};
use serde_json::{Value, json};
fn request() -> Request {
    let f: Value = serde_json::from_str(include_str!(
        "../../../../tests/fixtures/engineering-rust/scalar-fem.json"
    ))
    .unwrap();
    let mesh = &f["mesh"];
    let groups = mesh["boundary"].as_array().unwrap();
    let surface = |a: usize, high: bool| -> Value {
        groups
            .iter()
            .min_by(|x, y| {
                let order = x["center"][a]
                    .as_f64()
                    .partial_cmp(&y["center"][a].as_f64())
                    .unwrap();
                if high { order.reverse() } else { order }
            })
            .unwrap()["tag"]
            .clone()
    };
    let mut bcs = Vec::new();
    for a in 0..3 {
        let mut values = [Value::Null, Value::Null, Value::Null];
        values[a] = json!(0);
        bcs.push(json!({"tag":surface(a,false),"type":"displacement","values":values}));
    }
    bcs.push(json!({"tag":surface(0,true),"type":"force","values":[100,0,0]}));
    serde_json::from_value(json!({"kind":"structural-tetra","mesh":mesh,"youngModulus":70e9,"poissonRatio":0.3,"density":2700,"yieldStrength":250e6,"gravity":[0,0,0],"boundaries":bcs})).unwrap()
}
#[test]
fn axial_patch_has_exact_poisson_contraction_stress_energy_and_reactions() {
    let q = request();
    let s = solve(&q, &mut |_| {}).unwrap();
    let strain = 100. / (0.02 * 0.01 * 70e9);
    for i in 0..q.mesh.nodes.len() / 3 {
        let p = q.mesh.point(i);
        for (a, x) in p.iter().enumerate() {
            let expected = x * strain * if a == 0 { 1. } else { -0.3 };
            assert!((s.displacements[i * 3 + a] - expected).abs() < 1e-14);
        }
    }
    for c in s.stresses.as_chunks::<6>().0 {
        assert!((c[0] - 500000.).abs() < 0.01);
        for v in &c[1..] {
            assert!(v.abs() < 0.01);
        }
    }
    assert!((s.balance.reaction_force[0] + 100.).abs() < 1e-7);
    assert!((s.strain_energy - 0.5 * 100. * strain * 0.06).abs() < 1e-12);
}
#[test]
fn underconstrained_and_conflicting_restraints_fail() {
    let mut q = request();
    q.boundaries.remove(1);
    assert!(
        solve(&q, &mut |_| {})
            .unwrap_err()
            .contains("under-constrained")
    );
    let mut q = request();
    q.boundaries.push(q.boundaries[0].clone());
    assert!(solve(&q, &mut |_| {}).unwrap_err().contains("distinct"));
}
#[test]
fn symmetric_tensor_eigenvalues_handle_repeated_roots_and_shear() {
    assert_eq!(principal([0.; 6]), [0.; 3]);
    assert_eq!(principal([5., 5., 5., 0., 0., 0.]), [5.; 3]);
    for (a, b) in principal([0., 0., 0., 10., 0., 0.])
        .iter()
        .zip([10., 0., -10.])
    {
        assert!((a - b).abs() < 1e-12);
    }
    for (a, b) in principal([1e-12, 2e-12, 2e-12, 0., 0., 0.])
        .iter()
        .zip([2e-12, 2e-12, 1e-12])
    {
        assert!((a - b).abs() < 1e-19);
    }
}
