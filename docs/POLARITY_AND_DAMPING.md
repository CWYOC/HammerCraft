# Polarity and acoustic damping — 2026-09-26

The polarity control is now an **INVERT POLARITY (180°)** checkbox. It multiplies that driver's complex pressure by −1, without changing the electrical netlist. The card badge and response legend identify inverted drivers. A single driver's SPL magnitude stays unchanged; interference with other drivers changes. The setting persists in saved projects and reverse-design candidates.

## Why the damper did not behave like the example

The WASM damper already uses a series acoustic resistance, with matrix `[1, R; 0, 1]`. Catalog CGS acoustic ohms are converted to SI by multiplying by 100,000. This is not a low-pass filter applied to the final graph: its effect depends on the source, load and its position between acoustic elements.

The remaining limitation is the receiver model. The default uses constant source resistance and applies a modelled transfer ratio to a fixed manufacturer magnitude curve. That can damp tube/load resonances, but it cannot reliably determine how the receiver's own resonances react to loading. One undamped magnitude curve does not establish the receiver's complex source impedance. More complete balanced-armature models use coupled electrical, mechanical and acoustic elements and measurements under multiple loads; see [Kim and Allen, 2013](https://www.sciencedirect.com/science/article/pii/S0378595513000580).

The JavaScript fallback previously approximated a damper by a frequency-dependent attenuation term. That fallback cannot predict changes in Q or placement. Damper and resonant-source calculations now require WASM; a load/runtime failure clears the graph and reports the problem instead of substituting that approximation.

## A usable model for experiments

**ACOUSTIC SOURCE → Resonant source (RLC estimate)** adds one passive series resistance, inertance and compliance at the acoustic source port. Its impedance is:

`Zs(f) = R × [1 + j Q × (f/f0 − f0/f)]`

Equivalently, `M = R Q / (2πf0)` and `C = 1 / (2πf0 R Q)`. These are acoustic quantities; the existing electrical impedance curve is not a substitute for them.

For a purely resistive load `RL` and series damper `Rd`, the loaded resonance has:

- Peak pressure ratio: `RL / (R + RL + Rd)`.
- Loaded Q: `R Q / (R + RL + Rd)`.

Increasing damper resistance therefore lowers the peak and broadens its bandwidth in this test circuit. For a tube/coupler network, the full complex matrix calculation determines the response. No graph smoothing, peak clipping or damping EQ is applied. The same source parameters are used for the reference, design and optimizer.

This is an **experimental one-mode approximation**, not an identified Sonion/Knowles model. It is opt-in. The initial frequency of 3 kHz and Q of 2 are starting values, not manufacturer data. R, frequency and Q all need fitting; source frequency/Q generally differ from the frequency/Q of a peak measured through a tube and coupler. Multiple receiver modes, venting and electrical/acoustic feedback need a more complete model when one mode is insufficient.

## How to calibrate it

1. Keep the receiver, drive voltage, tube dimensions, insertion depth, coupler and damper position fixed. Measure the undamped response and responses with at least two known damper resistances. Record the resistance convention and any existing reference damper. CSV/FRD magnitude and, when available, phase are preferable to a screenshot.
2. Set the measurement reference and design to that same setup. Confirm the baseline condition, then put the damper at its actual location. The path runs from receiver to coupler. To model a damper partway along a tube, split the tube into two sections and place the damper between them. The editor shows its distance along the path.
3. Use absolute SPL and the same gain for every comparison. Fit source R, frequency and Q jointly to the difference between the undamped curve and one damped curve. Relative normalization can conceal overall attenuation. A unity check alone does not constrain these source parameters.
4. Validate the fit against the other damper curve, which was not used for fitting. If peak heights, widths or phase remain wrong, revise the source/coupler model rather than forcing the graph to appear smooth. Magnitude-only fitting can be ambiguous; phase and additional known loads improve identification.

The screenshot does not specify enough receiver/fixture data to calibrate every driver. This change supplies a physical damping mechanism and controls; it does not claim all library predictions now match real damped measurements.

## Verification

The suite contains **79 passing tests** against the shipped WASM engine. New tests verify unchanged single-driver magnitude under inversion, a 180° phase difference, cancellation of identical opposite-polarity drivers, unchanged wiring, and saved polarity. Damping tests independently calculate peak gain and −3 dB bandwidth for 0, 320, 680, 1500 and 2200 CGS acoustic-ohm dampers and verify decreasing Q. Additional checks cover position sensitivity, reference cancellation, forward/optimizer consistency, persistence and rejection of invalid parameters or unavailable WASM.

Browser checks verify WASM 0.17.0, the checkbox/indicator, opt-in RLC controls, damper positioning and calculation. These software checks are not measurement-based calibration. Changes are local and have not been deployed.
