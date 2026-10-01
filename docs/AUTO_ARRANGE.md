# Automatic arrangement and drilled channels

Available in engine **0.23.0** in the standalone Headphone Workshop and embedded Design Studio.

## Arrange the assembly

1. Add the required driver presets and choose distinct sound-path endpoints. Automatic arrangement keeps those endpoints, driver IDs, dimensions and electrical connections.
2. Under **Electronics & cabling**, enable **Include assembly planning**. Enable a connector and/or crossover-board envelope and enter the actual outside dimensions. Include pins, solder and component heights. Defaults are illustrative planning values.
3. Set the part clearance and insulated harness outside diameter. Enable **Construct hollow shell** to include the requested wall offset and faceplate plane in placement checks.
4. Press **Auto arrange assembly**. Rust places the larger drivers first, then connector/board envelopes, and searches for contained cable routes. It checks the final layout before accepting the result.
5. Inspect the placement results. **Route cables** preserves the current part poses and recalculates harness space. **Undo arrange** restores the previous accepted project after either automatic action; applying another edit clears this undo slot.

The search is deterministic and bounded, not an optimal-packing proof. It preserves the shell and purchased-part sizes. It can fail even when a manually arranged solution exists. Failure retains the previous accepted geometry. Move sound outlets, adjust the layout or use a different shell when no solution is found.

The connector prefers an interior location near the wall, with clearance for its cable anchor. Its mounting cut remains a separate, manually positioned feature under Shell. This version does not align a specific connector seat or retention mechanism automatically.

The board represents the **combined occupied volume** of a crossover and its components. It is not an automatically populated PCB. Harness routes reserve insulated wiring space from connector to board and from board to drivers; a single driver can route directly from a connector. These routes do not generate electrical nets or assign pin polarity. Solder-pad anchors, pin pitch, individual component placement, bend radii and assembly access require the real hardware drawings.

## Arrange the electrical schematic

Use **Auto arrange** in each acoustic driver's circuit editor. It orders component graphics from the input connection, gives every component its own slot, and resets wire graphics to orthogonal routing. It retains all node/component IDs, values, bypass states and electrical connections. Existing circuit Undo/Redo remains available. This changes drawing geometry only.

## Make a channel in the shell

1. Enable **Construct hollow shell**.
2. Select **Drilled channels integral to shell** and leave **Cut sound paths through shell** enabled.
3. Set the bore and **Outer Ø**. In this mode, Outer Ø is the diameter of material retained around the bore, not a separately inserted tube. Its radial wall `(outer − bore) / 2` must be at least three grid spacings, as must the bore diameter, shell wall and cap depth.
4. Use **Extend drilled outlets to shell** to extend each saved final path direction to its first outward crossing. The endpoint starts inside the stock and remains slightly inside so the subtractive cutter opens the wall.
5. Run **Auto arrange assembly** if the larger surround produces a bend or placement error. Inspect the opening and the channel in the shell. Export the **Shell body with drilled channels** and faceplate.

The solid builder retains channel surrounds inside the original stock, joins them to the hollow shell field, and subtracts the bores. This produces integral channel geometry in the shell STL. Translucent cyan channel guides are visualization aids and cannot be exported as standalone tube parts. Cable guides are also excluded from STL export.

This is curved-channel CAD for an integral shell, not a conventional drill-tool machining plan. Straight-tool access, printing supports, trapped resin, actual wall thickness and acoustic sealing are unverified. The exported length is the geometric centreline length; it is not a measured effective acoustic length. No new acoustic calibration or physical measurement validation is implied.

### Starter-shell example

For the default RAF driver: enable construction, use **0.30 mm** grid spacing, **1.50 mm** shell wall, **2.50 mm** cap depth, **1.60 mm** bore and **3.40 mm** outer surround. Select drilled mode, extend the outlets, then auto arrange. The original tight bend may fail before arrangement; this is an intentional export block. Enable electronics planning and arrange again to add connector, board and harness reservations.

## Persistence and safeguards

- Old projects remain readable. Assembly planning is optional and drilled mode defaults off.
- Workshop and shared Design Studio files retain the new parameters and routes. Geometry links continue to synchronize centreline length and bore by the existing IDs.
- Moving a part after routing produces a stale-anchor error. Re-route cables before export.
- Complete connector, board and cable meshes are checked against the stock/cavity. Part separation, sound-path clearance, cable separation and anchor consistency are checked separately.
- Subtractive channel guides have different containment rules from physical tubes: the cutter may open the outlet, while the retained material is clipped to stock. Dead-end channels, unresolved channel walls, invalid generated topology and disconnected channel material block construction/export.
- The sampled mesher snaps field values within `grid spacing × 0.00001` to a grid crossing in drilled mode to avoid sub-float32 sliver triangles. Final STL precision and closed-solid topology are still checked.

## Verification

The shipped WASM is exercised by `tests/assembly-arrange.test.mjs`: all 18 driver presets, source-shell/hollow-shell workflows, deterministic placement and reflection, two-driver harness routing, stale anchors, failure rollback, guide export rejection, drilled bore air/material occupancy on the generated surface, and native-shell drilling/save round trips. Circuit tests verify that arrangement retains the electrical graph, calculated complex response and undo behavior.

These are software geometry and integration checks, not manufactured fit or measured acoustic validation. Run `node --test tests/*.test.mjs` and `cargo test --manifest-path docs/acoustic-engine/Cargo.toml`.
