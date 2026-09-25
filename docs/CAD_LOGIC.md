# Circuit CAD

The editor separates component placement, electrical connections, and simulation.

## Editing

- Place a resistor, capacitor, or inductor from the palette. New parts start disconnected.
- Click two terminals to connect them. Click the grid between endpoints to add route waypoints. Escape cancels the current wire or junction tool.
- Choose 90°, 45°, or free routing. Moving a part reroutes its attached wires and retains manual waypoints.
- Crossed wires do not connect. Use **Connect Point** on a wire to split it into two wires at a junction, then connect another terminal to that junction.
- Drag parts immediately; Shift temporarily disables grid snapping. Rotate with the selected part's handle or the properties dialog.
- Double-click a part for properties. Select a wire and use Delete to disconnect it; double-click a wire to add a movable bend.
- Duplicate creates a new, disconnected part. Deleting a part removes its attached wires. Undo/redo restores the complete circuit operation, including connections.
- Ctrl/Cmd+C and Ctrl/Cmd+V copy and paste parts. Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z or Ctrl+Y redoes. Text fields keep their normal editing shortcuts.

The driver negative terminal shares GND. High-pass and low-pass response filters are separate from physical R/L/C components.

## Graph and solver contract

`cad-circuit.js` owns graph operations and wire geometry. Component pins have stable node IDs. Wire endpoint references identify component pins, driver terminals, or junction nodes; coordinates never create electrical connections.

`HCCircuit.compile()` creates a solver netlist without changing the saved circuit:

1. Resolve endpoints and check required ports, component types, and R/L/C values.
2. Collapse ideal wires, bypasses, and zero-ohm resistors into electrical nets.
3. Reject source-to-ground shorts and incomplete source-to-driver signal paths.
4. Exclude floating islands and report their unused parts.
5. Emit connected R/L/C branches and the input, output, and ground net IDs.

Both the JavaScript fallback and shipped WASM engine use this compiled graph. Invalid circuits clear the old response and show diagnostics. A calculation revision prevents an older asynchronous result from replacing a newer circuit result.

The electrical model uses ideal R/L/C values. Unimplemented tolerance, power, voltage-rating, and DCR controls are no longer shown.

## Saved projects

The existing project shape remains readable. Ordered legacy circuits first migrate into a connected node graph. Before presenting a circuit in the editor, `makeEditable()` converts shared-node connections and direct input-to-driver links into explicit wires with independent component pins. This conversion is idempotent and preserves the electrical response. Existing hand-routed wires preserve their paths; new wires save their routing mode and waypoints. Legacy low-pass blocks remain supported.

New/load clears selection, drawing modes, and undo history so operations cannot cross project boundaries. Save continues to use the existing local browser project storage.

## Verification

Run from the repository root:

```sh
node --disable-warning=ExperimentalWarning --test tests/*.test.mjs
```

CAD tests cover a known voltage divider against both solver implementations, isolated copies, deletion cleanup, invalid circuits, ideal shorts, geometry/topology independence, junction branching, routing constraints, stale endpoints, saved-project migration, and stale asynchronous calculations.
