# HeadphoneWorkshop website port

Status: **IEM layout, automatic assembly planning and shell-construction milestones implemented; full native application migration remains incomplete.**

The website now has `headphone-workshop.html`, linked from the IEM Designer's **3D WORKSHOP** button. Geometry runs in the existing Rust crate, compiled to browser WebAssembly. A module worker handles STL parsing, geometry generation, inspection and export. The JavaScript interface edits parameters and draws the Rust-generated meshes using WebGL. Deployment remains compatible with the existing static website; no Rust server is required.

## What works in this milestone

- Original native starter shell (24,474 triangles), with import of binary or ASCII STL, explicit units and centring.
- Independent X/Y/Z shell scaling; whole-assembly X reflection with corrected triangle winding.
- All 18 native IEM package presets, including published-versus-planning dimension flags, outlet positions and axes, rear-vent notes and dedicated-electronics warnings. Up to 12 packages per assembly.
- Driver XYZ placement and Euler rotation (X, then Y, then Z). Acoustic path inlet and tangent follow the catalog outlet and transformed package pose.
- Editable cubic Bézier sound paths, constant bore/outer diameter, physical path length and bore-volume estimates. The Rust tube API also supports the native inlet taper, checked against C++ fixtures; the current interface exposes constant-diameter tubes.
- Mesh edge-topology/orientation inspection and structured placement checks: rotated convex package overlap, tube/package penetration, possible route contact, local folds and nonlocal self-contact. Errors, warnings and unverified requirements are shown separately. See the [placement implementation report](reports/2026-10-01-iem-placement-checks/report.md).
- Optional Rust shell construction: sampled inner offset, separate faceplate using automatic broad-face detection, either side of X/Y/Z, or a custom outward normal, seam gap, sound-bore subtraction and a rotated rectangular/cylindrical connector opening. Full package faces are checked against the requested inner offset and cap plane. See the [construction report](reports/2026-10-01-shell-construction/report.md) and [cap placement fix](reports/2026-10-01-faceplate-placement/report.md).
- Complete represented package and tube surfaces must stay inside the actual curved shell envelope before STL export. Tube outside diameter, concave shell crossings and float32 export positions are checked. Violations are highlighted red; invalid or unverified containment blocks STL exports and affected acoustic links while allowing project saving. See the [containment report](reports/2026-10-01-shell-containment/report.md).
- Project save/open using a versioned `.hcworkshop.json` file containing the source mesh and parameters. Failed imports/edits retain the worker's previous accepted state.
- Individual STL exports: constructed body and faceplate when enabled, otherwise unmachined stock; package envelopes and swept tubes. Explicit millimetre units. JSON path-dimension export for manual transfer into acoustic design.
- Orbit/zoom, keyboard view controls, selected-driver highlighting and shell/faceplate/path visibility. Constructed shells render as opaque surfaces; hide the cap to inspect the cavity or hide the shell to inspect internal parts.

The [Design Studio](DESIGN_STUDIO.md) now combines the workshop and acoustic designer in one shared project. Explicit driver/tube links synchronise an accepted 3D route's length and bore into one acoustic tube section. The standalone editors also remain available. A package preset does not imply that matching acoustic calibration exists.

Automatic driver, connector/board-envelope placement, harness-space routing, undo, improved schematic arrangement and integral drilled channels are available in engine 0.23.0. See [usage and limits](AUTO_ARRANGE.md).

## Native capabilities still to port

| Area | Current limitation / next implementation |
| --- | --- |
| Shell construction | Initial hollow body, faceplate and cut features implemented. Integral drilled channels are implemented. Native nozzle machining, connector-specific seats, faceplate retention and exact post-cut wall checks remain pending. Surface generation has a native C++ parity fixture; this is not full native finished-shell parity. |
| Fit / collision | Complete part triangles are checked against a closed connected shell surface; constructed-mode packages also require wall-offset/cap-plane clearance. Actual material allowances, tube-to-wall fit/sealing, remaining wall thickness and rear-vent geometry remain unverified. Error layouts stay editable; failed or unverified containment blocks STL export and affected linked acoustic calculations. |
| Ear-fit | Port ear-profile schema, surface fitting and constraints. |
| Acoustic integration | Shared project and explicit driver/tube links implemented in Design Studio. Stepped routes, physical damper placement, manifolds and net-aware 3D electrical wiring remain pending (harness-space routing is available); matching measurement data must still be supplied. |
| Measurement evidence | Native file imports, sample/reseat tracking and release gates are not part of this geometry page. The website's existing physical-validation protocol still applies. |
| Stereo workflow | Reflection of one assembly only; independently editable linked left/right projects are pending. |
| Persistence | Native `.fmp` migration and compatibility fixtures are pending. JSON is the new web-only format. |
| Manufacturing | Assembly unions, 3MF, BOM, manufacturing packages and release reports are pending. Constructed parts are geometry previews, not qualified printable IEMs. |
| Other product families | Over-ear headphone and speaker workflows have not been ported. |
| Surrogate AI | Not ported. The supplied native model is trained on synthetic responses and does not establish measured physical accuracy. |

Even a closed, consistently wound mesh can self-intersect or fail fit/clearance checks. The present edge checks do not certify printability. No new coupler measurements were obtained in this work; the earlier damping/frequency-response validation gaps are unchanged.

## Implementation boundaries

- `acoustic-engine/src/workshop.rs`: Rust mesh/STL types, bounded input validation, native swept-tube port, catalog-based transforms, metrics and exports.
- `acoustic-engine/src/workshop/placement.rs`: placement diagnostics against represented geometry, with explicit missing-data coverage.
- `acoustic-engine/src/workshop/containment.rs`: full-face shell/cavity containment at STL coordinate precision and rejection of unsupported shell surfaces.
- `acoustic-engine/src/workshop/assembly.rs`: bounded placement search, optional connector/board envelopes, harness anchors, routing and clearance checks.
- `acoustic-engine/src/workshop/solid.rs`: mesh distance field, bounded marching tetrahedra, hollowing/cuts, STL-precision cleanup and sampled cavity checks.
- `acoustic-engine/src/lib.rs`: additive `workshop_*` WASM exports; acoustic simulation equations are unchanged.
- `workshop-worker.js`: transactional shell/project state and asynchronous calculation.
- `workshop-viewer.js`: presentation-only WebGL buffers and camera controls.
- `headphone-workshop.js`: form handling and file actions.
- `assets/workshop/drivers.json`: native catalog extraction, including source URLs; no new supplier verification is claimed.
- `tests/workshop.test.mjs`: tests against the compiled browser WASM, including all 18 presets, C++ parity, transformations, STL round trips, invalid data and worker transactions.

Limits: 16 MB STL, 300,000 triangles per mesh, 32 MB project file, 12 drivers, 0.25–4 shell scales. Input coordinates must be finite and within 10,000 mm. Construction permits 0.2–1 mm grid spacing, at most 650,000 grid points / 128 cells per axis, and features at least three grid spacings across. These bounds prevent accidental unbounded tessellation/memory work; they are not IEM manufacturing tolerances.

## Build and test

Use the repository's existing wasm-pack CI workflow, or run:

```sh
cd docs/acoustic-engine
wasm-pack build --target web --release --out-dir ../wasm --out-name acoustic_engine
cd ../..
node --test tests/*.test.mjs
```

The checked-in browser WASM uses wasm-bindgen 0.2.129, matching `Cargo.lock`. Geometry exports were added in engine 0.19.0, placement checking in 0.20.0, shell construction in 0.21.0, shell containment/export blocking in 0.22.0, arrangement/integral drilled channels in 0.23.0, and oriented faceplate detection in 0.24.0. The browser wrapper and binary cache versions move together.

For a local interface test without an account or database connection:

```sh
node tests/diagnostics/serve-workshop-preview.mjs
```

Open `http://127.0.0.1:8765/headphone-workshop.html` or `http://127.0.0.1:8765/design-studio.html`. This loopback-only test server replaces these pages' auth scripts and those of the embedded circuit designer with a local fixture. It does not alter production HTML, create an account or read private account data. The deployed pages continue to use `HCAuth.requireAdmin()`.

## Native provenance and parity fixtures

Source supplied by the user: `/Users/bearcheung/Documents/HeadphoneWorkshop`.

SHA-256 at extraction:

- `src/core/Mesh.cpp`: `4805fad22085d3001f455728a40acfbb601337c0ac1aacd95d3143e950562524`
- `src/app/ProductExperience.cpp`: `9959ff1d8f3c49474499e9a023c38505c3d6ba742666ad550c674f47f59cc655`
- `assets/headphone_workshop/solid_shell.stl`: `082d3ddb630383596c1b457b0a800ca0a8f3b25429a1e97af4552d0f308e7f87`

`tests/native/export-workshop-fixtures.cpp` links against the native engine. Its no-argument output is the three constant/tapered/degenerate-tangent tube reference meshes; any argument produces the 18-preset catalog. Output coordinates are converted from native metres to millimetres. Regenerate from the website root after building the native engine:

```sh
c++ -std=c++20 -O2 \
  -I/Users/bearcheung/Documents/HeadphoneWorkshop/include \
  tests/native/export-workshop-fixtures.cpp \
  /Users/bearcheung/Documents/HeadphoneWorkshop/build/src/*/*.o \
  -o /tmp/hc-workshop-fixtures
/tmp/hc-workshop-fixtures > tests/fixtures/workshop-native-tubes.json
/tmp/hc-workshop-fixtures catalog > docs/assets/workshop/drivers.json
```

The public Rust API rejects malformed/zero-length or excessively tessellated paths rather than silently repairing them. For valid native inputs, the three fixtures require identical triangle indexing and maximum vertex error below `1e-10 mm`. This checks code-port equivalence, not physical acoustics.

The additional `tests/native/export-solid-fixture.cpp` fixture checks oriented triangle coordinates of the native implicit-surface generator on an analytic hollow sphere. Vertex IDs can differ because allocation occurs at different stages; coordinates agree within `1e-10 mm`. Regenerate it using:

```sh
c++ -std=c++20 -O2 \
  -I/Users/bearcheung/Documents/HeadphoneWorkshop/include \
  tests/native/export-solid-fixture.cpp \
  /Users/bearcheung/Documents/HeadphoneWorkshop/build/src/core/Mesh.o \
  -o /tmp/hc-export-solid-fixture
/tmp/hc-export-solid-fixture > tests/fixtures/workshop-native-solid.json
```

Generated construction meshes additionally share exact grid-point crossings and weld identical float32 positions before topology validation. This avoids collapsed triangles in binary STL, whose coordinate precision is lower than Rust's calculations. These export safeguards are tested separately from native surface parity.

See [the implementation test report](reports/2026-09-30-workshop-port/report.md).

See the [design-rule audit](reports/2026-10-01-design-rules/report.md) for enforced limits, confirmed fixes, native-rule differences and manufacturing checks still missing.
