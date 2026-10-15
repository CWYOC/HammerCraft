# Native Rust static structural migration

Verified 15 October 2026. Engineering Studio now routes `structural-tetra` jobs to the native Rust solver. This completes the static elastic solver port; the broader Rust migration and platform requirements remain in progress.

## Implementation

`engineering-rust/crates/core/src/structural.rs` assembles three displacement degrees of freedom per node on the existing first-order tetrahedra. It supports constant isotropic elasticity, fixed and partial prescribed displacement, total surface forces, inward pressure and uniform gravity. It checks constraint conflicts and restraint of all six rigid motions, eliminates prescribed degrees of freedom, and solves with Jacobi-preconditioned CG. Results include displacement, restrained reactions, tensor strain/stress, ordered principal stresses, von Mises stress, energy and integrated force/moment balance.

The Rust HTTP supervisor launches this solver in its cancellable native subprocess. Static solving no longer requires Python when a valid mesh is available. Gmsh, eigenfrequency and harmonic jobs remain explicit Python/native-library adapters. The shared structural implementation also compiles to WASM for equivalence testing.

The existing UI now identifies the actual retained solver. Legacy scikit-fem results retain their metadata. Independent JavaScript result validation reconstructs element fields and consistent nodal loads, checks internal forces against support reactions, and checks free-node equilibrium. Equal/opposite forged reactions that preserve global force and moment totals are rejected. Source snapshots, staleness, result retention and import verification rules remain in effect.

## Automated verification

- **573/573 repository JavaScript tests passed**, no failures or skips, 40.44 seconds on this machine.
- **11 native Rust tests passed**, including analytical axial loading, principal tensors, scalar reference solutions and process supervision.
- The focused structural run passed **15/15 tests**: six new Rust integration tests plus nine existing structural tests.
- Rustfmt and Clippy with warnings as errors passed. Native release and browser WASM builds completed successfully using the locked build script.
- Nine independently assembled Python reference cases cover axial loading, negative Poisson ratio, pressure, nonzero prescribed displacement, gravity, zero load and three cantilever mesh refinements. Complete displacement/reaction/stress/strain/principal/von-Mises fields and energy are compared. The refinement test checks the trend toward the continuum bending reference, not just agreement between implementations.
- Native/WASM agreement, missing restraints, conflicting displacement, invalid materials, source history, legacy results, imported verification status and actual HTTP dispatch are covered.

The 36-test Python suite passed in the preceding migration milestone. Its implementation did not change in this port; the focused new tests invoke it to generate independent structural references.

## Saved-project integration

The previously exported revision-138 rounded/chamfered CAD plate was loaded through the production project validator, solved using the production `ComputeWorker` HTTP transport, validated independently, appended to result history, serialized, read back and validated as an imported project. The portable output retains both the old Python result and new Rust result, all 14 named source versions and the other study records. Imported numerical results are marked unverified.

The mesh has **1,311 nodes and 4,639 tetrahedra**. Demonstration material: E = 70 GPa, ν = 0.33, density = 2,700 kg/m³. Surface 7 is fixed, surface 10 has a total −10 N Z load, and gravity is −9.81 m/s² in Z.

| Quantity | Rust result |
| --- | --- |
| Maximum displacement | 1.349459 µm |
| Maximum von Mises stress | 1.651163 MPa |
| Strain energy | 6.684862 µJ |
| Applied Z force, including gravity | −10.261079108519 N |
| Support Z reaction | +10.261079108505 N |
| CG iterations / backward residual | 417 / 3.928 × 10⁻¹⁵ |
| Maximum displacement difference from Python | 5.527 × 10⁻²⁰ m |
| Maximum stress-component difference from Python | 1.463 × 10⁻⁵ Pa |

One observed HTTP run took 338 ms including polling; this is not a general performance benchmark. Exact results, balance vectors and field differences are in [project-results.json](project-results.json). Nodal CSV (1,311 rows) and tensor/vector VTK exports were also generated and checked. The 32.86 MB portable project was saved as `Thermal_block-rust-structural.hcengineering.json` in Downloads; the browser's persisted project was not replaced.

## Browser verification limit

The browser tool refused to acquire the existing preview tab because its current document was reported with a protocol outside the allowed HTTP/HTTPS protocols. No alternate browser surface or policy workaround was attempted. Consequently, this report makes **no claim of a new browser display, reload or download interaction test**, and contains no new UI screenshot. HTTP preview availability and numerical/project integration passed. The [earlier structural browser evidence](../2026-10-12-engineering-structural/README.md) covers the existing interface before this port.

## Remaining scope

Static analysis still assumes a single connected solid, constant isotropic material and small strain. Contact, plasticity, thermal expansion, multiple regions, nonlinear geometry and structural transients are not added. Linear tetrahedra can be too stiff in bending or near incompressibility; solver convergence alone does not establish physical accuracy.

Most UI/project/history/rendering code remains JavaScript; CAD/constraints remain C++/WASM; Gmsh and modal/harmonic solvers retain foreign adapters. Multi-body CAD, assemblies, broader physics, circuits, generic coupling, adaptive meshing, optimization, manufacturing and production infrastructure remain open in the [coverage ledger](../../ENGINEERING_PROGRESS.md). No commit, push or deployment was performed.
