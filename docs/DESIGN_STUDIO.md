# Design Studio

Open `design-studio.html`, or select **DESIGN STUDIO** from the circuit designer or 3D workshop. The studio combines the existing editors into one workspace and saves their data in one `.hcdesign.json` project.

## Workflow

1. **Assembly & tubes:** import an STL shell or use the starter. Place the driver packages, edit their sound routes and click **Apply changes**. Rust calculates each route's centreline length and bore volume.
2. **Circuit & response:** build the electrical crossover and acoustic path, or use **Import browser circuit project** to bring in the circuit previously saved in this browser. Load the correct driver's response, impedance, measurement voltage and reference fixture information. A geometry preset does not include acoustic calibration.
3. **Driver links:** select the matching 3D driver, acoustic driver and tube section, then click **Link tube**. Alternatively, create a blank circuit path and complete its wiring and measurement data. Creating a blank path adds a driver; it does not replace another driver.
4. Edit the geometry. The selected acoustic tube receives the accepted route length and bore diameter, and the response is recalculated. Those two acoustic fields become read-only. Tube loss, dampers, other sections, circuit components and polarity remain editable.
5. **Save all** prepares one downloadable project containing the source shell mesh, placements, routes, circuit graphs, measurements, reference settings, targets and links. Keep that file and use **Open / import file** to reopen it. This is file-based persistence; the studio does not automatically save to an account or overwrite the older browser circuit project.

The file picker also accepts standalone `.hcworkshop.json` files and acoustic project JSON. Such imports replace the corresponding part of the current shared project. Links are retained by identity; incompatible links are flagged for repair. Import STL through the assembly editor, where units and centring are explicit.

## How the connection works

```text
Driver placement + 3D route
          │
          ▼
Rust / WebAssembly route length + bore
          │ explicit driver ID and tube-section ID
          ▼
Acoustic path + electrical circuit + calibrated baseline
          │
          ▼
Existing Rust frequency-response solver
```

The studio is the owner of the shared project and links. Each editor retains its own detailed model. The bridge applies changes to path dimensions without replacing circuit edits or measured data. Reordering acoustic sections preserves the link because it refers to a stable section ID rather than its position in a list.

Imported geometry is rebuilt before its dimensions are used; saved derived metrics are not trusted. Changing a linked package, removing a driver, or replacing a linked tube produces a visible link error. An affected acoustic driver cannot calculate until the link is repaired. **Unlink** keeps the last dimensions and makes them editable again. Unlinked acoustic drivers still contribute to the combined response; remove unwanted paths in the acoustic editor.

Opening a file validates its format and saves rollback snapshots before replacing either editor. Rejected geometry leaves the previous accepted design intact. Save and tab changes apply pending geometry fields, so invalid geometry must be corrected before those actions can complete. Opening a shared or workshop file remains available as a recovery action even when the current geometry fields or project name are invalid. A circuit-only import applies pending geometry edits first because it retains that part of the project.

Typing into an editor immediately marks the project as unsaved, including geometry edits that have not been applied yet. Project names must fit the Rust engine's 200-byte UTF-8 limit; this allows fewer than 200 characters for some languages. The studio rejects longer names before preparing a file.

Reference-unity checks replace the current acoustic path, so linked routes must be unlinked before using that diagnostic. Saving or reusing a driver in the local library retains its dimensions and measurements but removes links to the old project's geometry.

## Current scope

- A 3D route represents **one constant-bore acoustic tube section**. Other tubes, dampers, chambers and nozzles are preserved in the acoustic project but are not yet positioned or drawn along that route. Stepped bores and shared multi-driver acoustic manifolds need a richer route model.
- Geometry package selection is explicitly linked to acoustic identity by the user. The studio cannot infer matching calibration from an STL shape or package dimensions.
- Circuit wire graphics describe electrical connections. Physical wire routing and component placement inside the shell are not implemented.
- The shell remains unmachined stock. Tube solids are not subtracted as channels. Boolean machining, exact clearance, wall thickness, fit and manufacturing checks remain pending.
- Existing acoustic-model and physical-validation limits still apply. Software integration tests are not IEC 711 measurement validation, and no new physical measurements were collected.
- The shared file is limited to 64 MB on import, with up to 12 geometry drivers. Browser downloads must complete before closing the page; a persistent download link is provided. Native `.fmp` and manufacturing packages remain unsupported.

## Implementation and verification

- `design-project.mjs`: versioned project validation, identity-based links and deterministic dimension synchronisation.
- `design-studio.js`: editor coordination, shared save/import, rollback and link status.
- `design-bridge.js`: same-origin editor adapters and change notifications.
- `headphone-workshop.js`: accepted geometry snapshots and pending-edit flush.
- `iem-designer.js`: acoustic snapshots/import, managed dimensions and stale-link validation.
- `tests/design-project.test.mjs`: project round trips, preservation of circuit and baseline data, reorder/unlink/stale cases, plus real Rust geometry-to-response integration for all 18 package presets.

Run `node --test tests/*.test.mjs`. For a loopback-only interface preview without account access, run `node tests/diagnostics/serve-workshop-preview.mjs` and open `http://127.0.0.1:8765/design-studio.html`. The test server injects an auth fixture only into the local preview; production pages retain admin authentication.

See the [integration report](reports/2026-09-30-design-studio/report.md) and [geometry port status](HEADPHONE_WORKSHOP_PORT.md).

See the [design-rule audit](reports/2026-10-01-design-rules/report.md) for enforced limits, confirmed fixes, native-rule differences and manufacturing checks still missing.
