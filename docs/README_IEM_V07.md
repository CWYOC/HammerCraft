# Hammer Craft IEM Designer 0.7

This build changes the passive crossover editor from an ordered component list to a true schematic/netlist model.

## What changed

- Standalone IEM Designer remains separate from the business admin page.
- Each driver remains one complete Driver Path: measurement + circuit + acoustic path.
- Circuit CAD is now a schematic canvas inspired by the workflow of crossover editors such as VituixCAD.
- R, C and L components can be inserted as series or shunt elements.
- Junctions and wire links can be created.
- Components and circuit nodes can be dragged on a snap grid.
- Component properties include value, endpoint nodes, bypass/short, copy, duplicate and delete.
- Undo, redo and auto-arrange are included.
- PEQ, High Pass and Low Pass response filters remain available as separate filter blocks.
- Rust now receives a real passive circuit netlist rather than only an ordered electrical list.
- Rust uses complex nodal analysis at every frequency to calculate the voltage actually reaching the driver.
- The driver's measured complex impedance is the load on the netlist output node.
- Phase-aware multi-driver summation, selectable normalization, absolute SPL anchoring, reverse target file import and reverse optimisation remain included.

## Circuit data flow

`Schematic -> nodes/components -> CircuitNetlist -> Rust complex nodal analysis -> driver voltage and phase -> acoustic path -> complex pressure -> multi-driver sum`

## WASM build

The included GitHub Actions workflow builds `acoustic-engine/` into the `wasm/` folder. GitHub Pages serves the generated JavaScript/WASM files; Pages itself does not compile Rust.

## Current limitation

The arbitrary passive R/C/L netlist is real. PEQ/HP/LP blocks are intentionally kept as response-domain filter blocks rather than pretending they are passive components. Reverse optimisation currently searches a simple series R/C passive branch plus tube/damper/gain parameters, then writes the result into the same netlist format used by the CAD.
