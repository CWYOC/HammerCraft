> **Current default:** Start `engineering-rust/target/release/engineering-server` after following [the Rust build instructions](../../engineering-rust/README.md). Rust owns the HTTP supervisor and thermal/DC electrical/static structural solvers; this directory retains Gmsh and modal/harmonic adapters, independent thermal/static references and the legacy Python HTTP service for regression testing. The static implementation below describes that reference. Do not run both servers on port 8766. The legacy Python server does not implement DC conduction.

# Local Engineering compute service

The optional compute service generates first-order tetrahedral meshes from exact STEP snapshots and solves steady heat conduction and static linear elasticity and undamped natural modes using scikit-fem/SciPy. Browser CAD and the existing block thermal solver continue to work without it. This is a loopback development/local-compute adapter, not a production cloud deployment.

## Install and run

From the repository root, using Python 3.12 or later:

```sh
python3 -m venv tools/engineering-compute/.venv
tools/engineering-compute/.venv/bin/python -m pip install -r tools/engineering-compute/requirements.txt
tools/engineering-compute/.venv/bin/python tools/engineering-compute/server.py
```

On Linux the Gmsh wheel also needs `libGLU` (Ubuntu: `sudo apt-get install libglu1-mesa`). The pinned packages are Gmsh 4.15.2, NumPy 2.4.4, scikit-fem 12.0.2 and SciPy 1.18.1. The virtual environment and caches are ignored by Git; binaries are installed from PyPI, not checked into the repository.

Run the existing preview separately:

```sh
node tests/diagnostics/serve-workshop-preview.mjs
```

Open Engineering Studio at `http://127.0.0.1:8765/engineering-studio.html`, choose **Simulate → Tetrahedral mesh**, and **Check local mesher**. Configure sizes or a preset and generate. The default service accepts only the preview's exact localhost origins. `--origin` explicitly changes that allowlist. The service always binds to `127.0.0.1`; it has no remote-user authentication, TLS, account isolation or public hosting configuration. Browser restrictions may prevent a remotely hosted HTTPS page from reaching this local HTTP service; production deployment needs a secured compute adapter.

## Execution contract

- `GET /health` reports the service version and actual compute capabilities.
- `POST /jobs` queues one registered `gmsh-tetra`, `thermal-tetra` or `structural-tetra` / `modal-tetra` request. Mesh requests contain STEP text, SI size settings and the browser CAD volume. `X-HC-Compute: 1` and `Content-Type: application/json` are required. It returns a random job ID.
- `GET /jobs/<id>` returns lifecycle state and the final mesh/thermal/structural/modal solution or failure diagnostic. `DELETE /jobs/<id>` terminates its subprocess and removes temporary files.
- Origin and Host validation plus the custom API header prevent ordinary cross-site form requests. There are no arbitrary scripts, filesystem paths, shell commands or Gmsh option names in the request API.
- One process/job at a time. A watchdog kills jobs after 90 seconds even if the browser disappears. At most six recent server records are kept, expiring after ten minutes. Project records are saved by the browser, not by the service.
- Request limit: 10 MiB; text STEP: 8 MiB; final output: 32 MiB; 50,000 nodes and 100,000 tetrahedra. The element-count cap is checked after generation; the service is intended for trusted local CAD and is not a hardened untrusted-compute sandbox.

Gmsh imports STEP using `Geometry.OCCTargetUnit=M`. All service/mesh coordinates and sizing are SI metres, independent of the source STEP units. Exactly one solid is required; additional loose surfaces are rejected. The transferred CAD volume must match the browser's exact volume within `1e-5` relative difference. Mesh generation uses single-thread Delaunay tetrahedra with fixed random seed, first-order triangles/tetrahedra, configured size bounds/curvature resolution and default optimization. A mesh whose volume differs from CAD by more than 5% is rejected with a refinement diagnostic.

The browser independently checks finite coordinates, index bounds, positive tetrahedral volumes, element quality, duplicate cells, opposite internal face orientation, connected cell regions and complete exterior boundary groups. It calculates mean-ratio quality as `12 (3 V)^(2/3) / Σ(edge length²)`. Values below 0.1 are flagged. These are validity/quality diagnostics, not simulation-accuracy certification. Imported project meshes are marked unverified.

Surface tags in the exported mesh identify surfaces of that STEP snapshot. They are not persistent geometric references for later physics assignment. CAD thermal and structural FEM resolve geometric face references to these tags for each submitted mesh.

## Verification

```sh
tools/engineering-compute/.venv/bin/python -m unittest discover -s tools/engineering-compute -p "test_*.py"
node --test tests/engineering-volume-mesh.test.mjs tests/engineering-fem.test.mjs tests/engineering-structural.test.mjs tests/engineering-modal.test.mjs
```

Node tests use the local virtual environment when present; set `ENGINEERING_PYTHON` to a different interpreter with the pinned dependencies installed, or install them into `python3`. Tests exercise Gmsh directly and the HTTP adapter, exact box/curved-hole geometry, unit transfer, deterministic meshing, malformed inputs, cancellation/timeouts, boundary/quality checks, source persistence, stale results, cutaways and Gmsh MSH re-import.

Gmsh is an external GPL-licensed dependency; see its [official distribution/license information](https://gmsh.info/doc/texinfo/gmsh.html#Copying-conditions) and [Python/STEP API manual](https://gmsh.info/doc/texinfo/gmsh.html#t20). This project has not modified or bundled the Gmsh runtime.

## Thermal FEM jobs

`runner.py` dispatches the registered `gmsh-tetra`, `thermal-tetra` `structural-tetra` and `modal-tetra` modules. A thermal job supplies the actual SI mesh, constant isotropic conductivity, uniform generation and resolved surface-tag temperature/convection conditions. The browser derives tags from CAD references; tags are not permanent physics identities. All unassigned surfaces are insulated. The backend independently validates mesh connectivity, connectedness, complete exterior coverage and boundary values before assembly. Conflicting prescribed values on shared nodes fail explicitly. Pure-insulation problems are not accepted.

The job returns `solution` rather than `mesh`: nodal kelvin temperatures, per-element K/m gradients and W/m² flux, pinned solver metadata, iteration/residual diagnostics, volume mean and integrated heat balance. `Solving` is a supported progress state. CG uses Jacobi preconditioning, relative tolerance 1e-10, absolute tolerance 1e-12 and at most 5,000 iterations; version mismatches fail explicitly. The supervisor constrains common numerical-library thread settings to one and retains the same 90-second wall-time cap. There is no OS-level memory quota.

The frontend keeps at most three complete FEM solutions. Shape/sizing changes require a compatible new mesh; conductivity and boundary changes reuse mesh geometry. Source snapshots still mark older fields outdated. This is limited to one region and linear steady conduction; nonlinear conduction is unavailable. scikit-fem, NumPy and SciPy are independently installed dependencies; consult their packaged BSD license notices. [scikit-fem source](https://github.com/kinnala/scikit-fem) and [SciPy source](https://github.com/scipy/scipy) provide the upstream implementations.

## Structural FEM jobs

`structural-tetra` accepts the actual SI tetrahedral mesh, constant Young’s modulus, Poisson ratio and density, optional yield strength, uniform gravity, and surface-tag fixed/displacement/force/pressure conditions. Partial prescribed displacement uses `null` for a free component. Force is a total XYZ resultant over the meshed surface. Pressure is positive inward. The shared mesh validator requires one connected region with complete exterior grouping.

`structural_fem.py` assembles scikit-fem vector P1 isotropic elasticity. It rejects conflicting shared-node constraints and restraints whose six-mode rigid-body matrix has rank below six. Prescribed DOFs are eliminated before Jacobi-preconditioned CG (`rtol=1e-10`, `atol=1e-12`, maximum 10,000 iterations). Unconverged solves, excessive backward residual and failed force/moment equilibrium are rejected. No stabilization spring substitutes for missing restraints.

Returned fields are nodal displacement (m), prescribed-DOF reaction (N), per-cell strain/stress tensors, descending principal stresses, von Mises stress, energy and equilibrium/convergence diagnostics. Six-component tensors use `xx, yy, zz, xy, yz, xz`; strain shear components are tensor shear. Moments are about the mean node position. The frontend independently checks derived fields, accounting and provenance before saving at most three solutions. Deformation scaling is display-only.

The service’s 32 MiB output cap and 90-second watchdog can limit large structural jobs before the mesh node/element caps are reached. No OS memory quota, nonlinear/contact mechanics, dynamics or production remote deployment is supplied. Linear tetrahedral bending stiffness and near-incompressible locking require careful convergence assessment. Tests include exact axial/Poisson and prescribed-displacement patches, pressure sign, gravity and moments, zero load, bad restraints/materials, and a three-grid cantilever refinement comparison.

## Eigenfrequency jobs

`modal-tetra` accepts one actual SI mesh, constant E/ν/density, 1–12 requested modes, and fixed or zero-component displacement surface restraints. Free-body and partially restrained cases are supported; forces, pressure, gravity, nonzero displacement, prestress and damping do not enter this eigenproblem. Modal limits are 10,000 nodes and 40,000 tetrahedra, below the general meshing cap.

`elasticity.py` shares vector-P1 space, stiffness and constraint/rank assembly with the static module. The modal module assembles consistent mass and solves `Kφ=λMφ` using SciPy `eigsh` with a deterministic start vector, relative tolerance 1e-9, maximum 10,000 iterations, and negative shift `−1e-6 E/(ρL²)` for mesh bounding diagonal L. The shift changes the numerical factorization, not physical stiffness; the original equation is checked afterward. Modes are sorted, rigid modes classified using geometric restraint rank, and shapes normalized to maximum nodal vector magnitude 1 with a canonical sign.

Results include frequencies, normalized shapes, modal mass/stiffness, global translational participation/effective mass, total mesh mass, free DOFs, expected rigid modes, residuals, mass orthogonality and pinned settings. The browser independently integrates the actual P1 stiffness/mass fields and verifies the eigen-equations before saving. Sparse factorization can hit the 90-second or 32 MiB response cap; there is no OS memory quota. Partial ARPACK convergence fails the job. Harmonic/damped/transient response and general eigensolver configuration are not yet supported.

## Large STEP source adapter

`cad_step.py` provides the native preview for streamed STEP assets managed by the Rust service. The legacy Python HTTP service rejects filesystem-path and asset-reference requests; only the Rust service resolves trusted stored digests to internal paths. Meshing accepts those internal source paths without copying the STEP into JSON. See the [large STEP setup and limitations](../../engineering-rust/README.md#large-step-imports).

The CAD preview adapter also accepts up to 24 STEP-part Boolean/placement/pattern operations and up to 64 output bodies. Generated STEP files are hashed into the same local asset folder. Final-geometry export preserves declared SI units, and FEM uses the generated asset rather than the original input. The tetrahedral adapter still requires one solid.
