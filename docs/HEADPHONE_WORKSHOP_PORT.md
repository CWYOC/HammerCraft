# HeadphoneWorkshop website port

Status: **first IEM geometry milestone implemented; full native application migration remains incomplete.**

The website now has `headphone-workshop.html`, linked from the IEM Designer's **3D WORKSHOP** button. Geometry runs in the existing Rust crate, compiled to browser WebAssembly. A module worker handles STL parsing, geometry generation, inspection and export. The JavaScript interface edits parameters and draws the Rust-generated meshes using WebGL. Deployment remains compatible with the existing static website; no Rust server is required.

## What works in this milestone

- Original native starter shell (24,474 triangles), with import of binary or ASCII STL, explicit units and centring.
- Independent X/Y/Z shell scaling; whole-assembly X reflection with corrected triangle winding.
- All 18 native IEM package presets, including published-versus-planning dimension flags, outlet positions and axes, rear-vent notes and dedicated-electronics warnings. Up to 12 packages per assembly.
- Driver XYZ placement and Euler rotation (X, then Y, then Z). Acoustic path inlet and tangent follow the catalog outlet and transformed package pose.
- Editable cubic Bézier sound paths, constant bore/outer diameter, physical path length and bore-volume estimates. The Rust tube API also supports the native inlet taper, checked against C++ fixtures; the current interface exposes constant-diameter tubes.
- Mesh edge-topology inspection and coarse package bounding-box warnings.
- Project save/open using a versioned `.hcworkshop.json` file containing the source mesh and parameters. Failed imports/edits retain the worker's previous accepted state.
- Individual STL exports: unmachined shell stock, package envelopes and swept tubes. Explicit millimetre units. JSON path-dimension export for manual transfer into acoustic design.
- Orbit/zoom, keyboard view controls, selected-driver highlighting and shell/path visibility.

The [Design Studio](DESIGN_STUDIO.md) now combines the workshop and acoustic designer in one shared project. Explicit driver/tube links synchronise an accepted 3D route's length and bore into one acoustic tube section. The standalone editors also remain available. A package preset does not imply that matching acoustic calibration exists.

## Native capabilities still to port

| Area | Current limitation / next implementation |
| --- | --- |
| Shell construction | Uses imported stock. Port implicit solid fields, cavities, drilled channels, connectors, faceplates and nozzle machining, with C++ mesh parity fixtures. |
| Fit / collision | Bounding boxes only. Port shell containment, manufacturing clearance, wall thickness, rear-vent reservations and rejection/rollback of mechanically invalid moves. |
| Ear-fit | Port ear-profile schema, surface fitting and constraints. |
| Acoustic integration | Shared project and explicit driver/tube links implemented in Design Studio. Stepped routes, physical damper placement, manifolds and 3D electrical wiring remain pending; matching measurement data must still be supplied. |
| Measurement evidence | Native file imports, sample/reseat tracking and release gates are not part of this geometry page. The website's existing physical-validation protocol still applies. |
| Stereo workflow | Reflection of one assembly only; independently editable linked left/right projects are pending. |
| Persistence | Native `.fmp` migration and compatibility fixtures are pending. JSON is the new web-only format. |
| Manufacturing | Assembly booleans, 3MF, BOM, manufacturing packages and release reports are pending. Exported stock is not a finished printable IEM. |
| Other product families | Over-ear headphone and speaker workflows have not been ported. |
| Surrogate AI | Not ported. The supplied native model is trained on synthetic responses and does not establish measured physical accuracy. |

Even a closed, consistently wound mesh can self-intersect or fail fit/clearance checks. The present edge checks do not certify printability. No new coupler measurements were obtained in this work; the earlier damping/frequency-response validation gaps are unchanged.

## Implementation boundaries

- `acoustic-engine/src/workshop.rs`: Rust mesh/STL types, bounded input validation, native swept-tube port, catalog-based transforms, metrics and exports.
- `acoustic-engine/src/lib.rs`: additive `workshop_*` WASM exports; acoustic simulation equations are unchanged.
- `workshop-worker.js`: transactional shell/project state and asynchronous calculation.
- `workshop-viewer.js`: presentation-only WebGL buffers and camera controls.
- `headphone-workshop.js`: form handling and file actions.
- `assets/workshop/drivers.json`: native catalog extraction, including source URLs; no new supplier verification is claimed.
- `tests/workshop.test.mjs`: tests against the compiled browser WASM, including all 18 presets, C++ parity, transformations, STL round trips, invalid data and worker transactions.

Limits: 16 MB STL, 100,000 triangles, 32 MB project file, 12 drivers, 0.25–4 shell scales. Input coordinates must be finite and within 10,000 mm. These bounds prevent accidental unbounded tessellation/memory work; they are not IEM manufacturing tolerances.

## Build and test

Use the repository's existing wasm-pack CI workflow, or run:

```sh
cd docs/acoustic-engine
wasm-pack build --target web --release --out-dir ../wasm --out-name acoustic_engine
cd ../..
node --test tests/*.test.mjs
```

The checked-in browser WASM was built with Rust 1.98.1 and wasm-bindgen 0.2.129, matching `Cargo.lock`. Geometry exports are added to engine version 0.19.0. The browser wrapper and binary cache versions move together.

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

See [the implementation test report](reports/2026-09-30-workshop-port/report.md).

See the [design-rule audit](reports/2026-10-01-design-rules/report.md) for enforced limits, confirmed fixes, native-rule differences and manufacturing checks still missing.
