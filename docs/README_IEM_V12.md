# Hammer Craft IEM Designer v0.12 — Manual Cabling

Circuit CAD manual wiring update.

## Wiring
1. Press WIRE.
2. Click the first electrical node/terminal.
3. Click empty canvas positions to place as many cable bends as required.
4. Click the destination node/terminal to finish.
5. Press Escape to cancel an unfinished cable.

Routing modes: 90 degree orthogonal, 45 degree snap, and free routing.

Existing user wires are selectable. Selecting a wire displays its bend handles; drag a handle to reroute that cable. Double-click a wire to open its Properties page or delete it.

Wires are not decorative: each completed wire remains a `wire` element in the Rust circuit netlist, so the Rust nodal solver treats the connected endpoints as an electrical short.
