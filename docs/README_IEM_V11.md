# Hammer Craft IEM Designer v0.11

Adds 45-degree schematic component rotation to the v0.10 IEM Designer.

## Rotation interaction

- Select a resistor, capacitor or inductor on the Circuit CAD canvas.
- A rotation handle appears above the selected symbol.
- Click the handle to rotate +45 degrees.
- Drag the handle around the component to snap to the nearest 45-degree angle.
- Supported angles: 0, 45, 90, 135, 180, 225, 270 and 315 degrees.
- Double-click / Properties also exposes an Orientation selector plus Rotate -45 / +45 buttons.
- `Auto from connection` keeps the previous horizontal/vertical automatic orientation.
- Rotation is visual only and does not alter the Rust electrical netlist or component node connections. Wires connect to the rotated symbol terminals.

All v0.10 low-pass, filter-order, phase-aware summation, reverse-design, Rust/WASM and standalone designer features are retained.
