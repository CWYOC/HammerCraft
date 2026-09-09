# Hammer Craft IEM Designer v0.13 — Free Component Placement

## CAD interaction changes

- Resistors, capacitors, inductors and other schematic components can be dragged freely to any position on the CAD canvas.
- Circuit nodes/junctions can also be dragged freely.
- Moving a component changes only its visual x/y position; it does not change its electrical nodes or the Rust netlist.
- Connected visual leads redraw while the component moves so the schematic stays readable.
- Grid snapping is now optional and is OFF by default.
- Enable **SNAP GRID** in the CAD toolbar to snap objects to the 20-unit drawing grid.
- Hold **Shift** while dragging to temporarily disable snapping even when SNAP GRID is enabled.
- 45° rotation, manual cabling, cable bend editing, component Properties, and Rust/WASM circuit solving are preserved.

## Important distinction

Component position and rotation are presentation data only. Electrical connectivity is defined by the manually created nodes/wires/netlist passed to the Rust solver.
