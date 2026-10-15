# Engineering Studio: Rust migration

This is the live Rust foundation for Engineering Studio, integrated into the existing website. It is a **partial migration**, not a completed rewrite of the original general-purpose engineering platform. Existing IEM/acoustic tools are outside this migration.

## Working Rust components

| Component | Implementation and integration |
| --- | --- |
| `engineering-core` | Bounded SI expression parser, parameter dependency/cycle validation, conservative block thermal FVM, tetrahedral mesh validation, sparse assembly/CG, CAD thermal P1 FEM, DC electrical P1 FEM and static structural vector-P1 FEM. Same source compiles natively and to WebAssembly. |
| `engineering-web` | WebAssembly exports used by the live unit engine and block thermal worker. Rust owns the parameter-editor DOM, events, diagnostics and lifetime. FEM exports provide native/WASM equivalence testing; production CAD FEM runs in a cancellable native subprocess. |
| `engineering-server` | Axum/Tokio loopback job supervisor with native thermal/electrical/static structural workers and explicit Python adapters for Gmsh, eigenfrequencies and harmonic response. Actual solver identity is retained in result provenance. |

The remaining UI, project validation/persistence/history, CAD orchestration, field rendering and post-processing are JavaScript. OpenCascade and PlaneGCS remain C++/WASM kernels. Gmsh meshing and modal/harmonic mechanics remain Python/native-library adapters. The Python static solver is retained as an independent regression reference. Existing saved results keep their original solver metadata. No silent JavaScript fallback is used for migrated calculations.

## Build and run

Install Rust through the official rustup distribution. The workspace pins Rust **1.99.0**, including `wasm32-unknown-unknown`, rustfmt and Clippy. From the repository root:

```sh
cargo install wasm-bindgen-cli --version 0.2.129 --locked
tools/engineering-rust/build.sh
engineering-rust/target/release/engineering-server
```

The build uses `Cargo.lock` and generates the browser glue, type declarations and WASM in `docs/engineering/rust/`. These assets are served with the existing static website; no Node server is needed for production static assets. If rustup is not on PATH, set `CARGO_BIN` and `WASM_BINDGEN_BIN` to its executable paths when running the build script.

Run the development preview separately:

```sh
node tests/diagnostics/serve-workshop-preview.mjs
```

Open `http://127.0.0.1:8765/engineering-studio.html`. The service defaults to port 8766 and binds only to `127.0.0.1`. Do not start the legacy Python HTTP server on the same port. Options: `--port`, `--origin` (repeatable), `--python`, and `--root` (repository location when relocating the binary).

For CAD meshing, modal/harmonic adapters and independent reference tests, install their pinned dependencies:

```sh
python3 -m venv tools/engineering-compute/.venv
tools/engineering-compute/.venv/bin/python -m pip install -r tools/engineering-compute/requirements.txt
```

Native Rust thermal, electrical and static structural jobs work without Python against existing valid meshes. Adapter capabilities are advertised only if the runner exists and Gmsh 4.15.2, NumPy 2.4.4, scikit-fem 12.0.2 and SciPy 1.18.1 pass the startup probe. On Linux, Gmsh requires libGLU. See the existing [adapter documentation](../tools/engineering-compute/README.md) for numerical methods and external-kernel licensing. Rust dependencies are recorded in Cargo.lock; this migration does not replace or relicense the CAD/meshing kernels.

## Static structural elasticity

The native Rust solver assembles vector-P1 isotropic elasticity on the existing CAD tetrahedra. It supports fixed or partially prescribed displacement surfaces, total surface force, inward pressure and gravity. It eliminates prescribed degrees of freedom, checks all six rigid motions are restrained, then uses Jacobi-preconditioned CG with relative tolerance `1e-10`, absolute tolerance `1e-12` and at most 10,000 iterations. It returns displacements, restrained reactions, tensor strain/stress, ordered principal stresses, von Mises stress, strain energy and force/moment balance. The same implementation is available as a WASM export for parity checks.

The browser independently reconstructs element fields, internal nodal forces, applied loads, reactions and equilibrium before retaining results. Existing Python results remain readable with their original provenance. Scope remains one connected, small-strain, constant isotropic solid. No contact, plasticity, large deformation or thermal expansion is implied by this port. Linear tetrahedral bending accuracy and near-incompressible locking still require mesh-convergence assessment. See the [structural migration verification](../docs/reports/2026-10-15-engineering-rust-structural/README.md).

## DC conduction

Generate a compatible tetrahedral mesh, assign a material with constant electrical conductivity, and choose **DC conduction → Create DC conduction study**. Assign voltage or total inward current to CAD surfaces. At least one voltage reference is required; distinct voltage terminal surfaces may not share nodes. Unassigned surfaces are insulated.

The solver assembles `∫ σ ∇Ni·∇Nj dV` and consistent surface loads, then solves `K V = I` with prescribed potentials eliminated. It reports nodal potential, cell `E = −∇V`, `J = σE`, volumetric Joule heat `σ|E|²`, area-weighted terminal voltages, currents, input power and conservation errors. Positive terminal current enters the solid. Two-voltage-terminal resistance is `ΔV² / P`. CSV retains SI node potentials; VTK also retains vector fields and heat density. Results retain immutable source/mesh snapshots and import verification status. Up to three electrical solutions are retained.

Scope: one connected solid, isotropic constant conductivity, linear steady DC, at most 50,000 nodes / 100,000 tetrahedra. No circuits, electrostatics, magnetic fields, AC, contact resistance, temperature dependence or Joule-to-thermal coupling. Whole-cell cutaways are not interpolated planar slices. Numerical convergence and a conservation check do not establish physical accuracy; mesh/material/boundary validation remains necessary.

## Service contract

`GET /health`; `POST /jobs` with registered `kind`; `GET /jobs/{id}`; `DELETE /jobs/{id}`. The browser transport retains API version 1. Origin and Host allowlists, `X-HC-Compute: 1`, bounded JSON input, no-cache responses and one active child process protect the local workflow. Jobs time out after 90 seconds; up to six records expire after ten minutes. Cancellation kills/reaps the process and removes payload files. Ctrl-C cleans up active children.

This is trusted local compute, not a publicly exposed multi-user service or an OS sandbox. There is no OS-level memory quota, remote authentication, cloud queue, account isolation, deployment or production certificate configuration. Input/output caps are 10/32 MiB. The browser's existing project-size limit still applies to aggregate retained results.

## Verification

```sh
cargo fmt --manifest-path engineering-rust/Cargo.toml --all --check
cargo test --manifest-path engineering-rust/Cargo.toml --workspace --locked
cargo clippy --manifest-path engineering-rust/Cargo.toml --workspace --all-targets --locked -- -D warnings
node --test tests/engineering-rust.test.mjs tests/engineering-rust-structural.test.mjs
node --test tests/*.test.mjs
tools/engineering-compute/.venv/bin/python -m unittest discover -s tools/engineering-compute -p 'test_*.py'
```

The scalar fixture in `tests/fixtures/engineering-rust/scalar-fem.json` is a real Gmsh box mesh with independent scikit-fem/SciPy thermal solutions: fixed-temperature, convection, uniform generation and all-Robin cases. Both native Rust and WASM are checked against those references. Electrical tests use the analytical uniform-bar solution, current excitation, gauge shifts, scaling, zero excitation, malformed inputs, independent JS element integration, project history, import/export, native/WASM agreement, HTTP access controls and real adapter dispatch. Supervisor unit tests cover concurrent-job rejection, cancellation/reaping and watchdog termination.

Structural checks compare complete fields against independently assembled scikit-fem/SciPy solutions for axial loading, negative Poisson ratio, pressure, prescribed displacement, gravity, zero load and three bending refinements. Native tests check analytical axial stress/Poisson contraction and principal values. Project tests reject forged reactions even when their global force and moment totals remain balanced, preserve legacy metadata and mark imported results unverified.

## Remaining migration and platform work

1. Port shared project schema, materials, history, persistence and validation into Rust with backwards-compatible fixtures; expand Rust-owned UI beyond parameters.
2. Port modal/harmonic assembly and numerical methods with independent continuum and dense-reference benchmarks. Choose maintained sparse/eigen/complex libraries before replacing validated adapters.
3. Retain explicit foreign-kernel interfaces for CAD/constraints/meshing, or undertake a separately benchmarked kernel replacement. “Rust application” does not make OpenCascade or Gmsh Rust libraries.
4. Complete original platform scope: multi-body CAD/assemblies and advanced features/surfaces, acoustic/fluid/magnetic/electrostatic domains, circuits, generic coupled/transient/nonlinear studies, adaptive/high-order meshing, broader optimization, manufacturing and collaborative production infrastructure.

The complete feature ledger is [ENGINEERING_PROGRESS.md](../docs/ENGINEERING_PROGRESS.md). A working migration milestone must not be described as “everything rebuilt” or the whole platform finished.
