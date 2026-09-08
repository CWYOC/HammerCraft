# Hammer Craft IEM Designer 0.6

This build keeps the IEM Designer separate from the admin dashboard and restructures the design page around complete Driver Paths.

## Main changes

- Driver + measurements + Circuit CAD + acoustic path are now one card.
- Display normalisation frequency is user-selectable rather than fixed at 1 kHz.
- Relative and calibrated/absolute SPL display modes.
- Relative FR measurements can be anchored to entered sensitivity at a selected reference frequency.
- Driver library entries can be deleted.
- Circuit CAD supports ordered ladder elements: series R/C/L, shunt R/C/L, PEQ, second-order HP and LP.
- Circuit elements can be reordered.
- Acoustic path elements can be reordered.
- Combined response is summed as complex pressure before display normalisation. Polarity inversion therefore changes crossover summation/cancellation.
- Reverse target can be imported from TXT, CSV or FRD and has its own normalisation frequency.
- Rust reverse optimiser uses the selected normalisation frequency.
- Rust engine version 0.6.0.

## Important engineering scope

The circuit editor currently represents a ladder topology from input to driver. PEQ/HP/LP blocks are mathematical transfer blocks, while R/C/L series/shunt components are handled through an electrical two-port matrix. Arbitrary bridge circuits are not yet supported.

The generic 711 mode remains an engineering approximation, not a standards-calibrated IEC 60318-4 implementation.

## Build

No local command is required if GitHub Actions is enabled. Push `acoustic-engine/` and `.github/workflows/build-wasm.yml`; the action generates `wasm/acoustic_engine.js` and `wasm/acoustic_engine_bg.wasm`.
