# Hammer Craft IEM Designer — Rust/WASM build

This package is designed for the existing flat HammerCraft GitHub Pages structure.

## Root files
- admin.html
- admin.css
- admin.js
- iem-designer.css
- iem-designer.js
- wasm-loader.js

## Rust source
- acoustic-engine/Cargo.toml
- acoustic-engine/src/*.rs

## Generated WebAssembly
GitHub Actions runs wasm-pack and writes:
- wasm/acoustic_engine.js
- wasm/acoustic_engine_bg.wasm

## Runtime behaviour
The IEM Designer first attempts to use the Rust/WASM solver. If the WASM build is missing or fails to load, the existing JavaScript engineering approximation remains available as a fallback.

## Forward design
Measured driver FR + impedance -> electrical network -> acoustic ABCD matrices -> phase-aware multi-driver summation -> graph.

## Reverse design
Drawn target -> Rust optimiser -> candidate tube ID, length, damper, capacitor, series resistor and gain -> same forward solver -> RMSE ranking.

## Important model status
This is an engineering MVP. The tube/chamber network uses complex transmission-line matrices, but driver acoustic source impedance, receiver volume velocity, viscothermal loss and ear/coupler termination are still simplified. Keep measured prototype validation as the final authority.

## Reverse-design target file import

The Reverse Design tab now accepts `.txt`, `.csv`, and `.frd` target files. The first two numeric columns are interpreted as:

```text
frequency_hz    dB
```

A third phase column may be present and is ignored for reverse target matching. Comment lines beginning with `#` or `;`, blank lines, and text headers are ignored. Commas, semicolons, tabs, and whitespace are accepted as separators.

Example:

```text
20      -8.0
100     -3.0
1000     0.0
3000     4.5
10000   -1.0
20000   -5.0
```

The target is normalised at 1 kHz before the inverse-design error calculation, matching the editable graph workflow. The package includes `reverse-target-example.txt`.

## Reverse optimiser update

The Rust inverse optimiser now uses a two-stage search. It first performs a deterministic low-discrepancy global search, then refines tube length, tube diameter, and gain around the strongest global candidates. Near-duplicate recommendations are filtered before the best candidates are returned. This keeps the browser workload bounded while giving finer results than the earlier single-pass search.

## Acoustic engine 0.4 update

The Rust solver now supports finite acoustic source/load termination instead of only the earlier matched-load approximation. The two-port acoustic network uses:

`p2/Ps = ZL / [A*ZL + B + ZS*(C*ZL + D)]`

where `ZS` is the driver-side acoustic source impedance, `ZL` is the output load, and `A/B/C/D` come from the complete acoustic path matrix.

Available output loads are:

- `anechoic` — matched characteristic load; closest to the previous behaviour.
- `radiation` — small-ka unflanged circular-pipe radiation approximation.
- `closed_cavity` — sealed acoustic compliance using the entered coupler/ear volume, with optional parallel loss resistance.
- `cavity_with_leak` — sealed compliance with a parallel resistive leak path.

The admin UI exposes output load type, coupler volume, load loss resistance and leak resistance. Reverse design uses the same selected load model because it uses the same forward simulation request.

The driver source currently defaults to `ideal_pressure`. Rust also contains source models for characteristic source impedance and outlet inertance, ready for a later per-driver UI and calibration workflow.

Reverse target import remains available for `.txt`, `.csv` and `.frd` files. The first numeric column is frequency in Hz and the second is dB; a third phase column is accepted but phase is not yet used as a reverse-design target.

### Accuracy note

The load/source framework is now physically better structured, but it still needs calibration against measured IEM prototypes. In particular, actual BA/DD acoustic source impedance, IEC 60318-4 / 711 coupler geometry, damper ratings and viscothermal microtube losses should be fitted to measurement rather than assumed from generic values.

## Acoustic engine 0.5 additions

This revision adds an automatic thermoviscous boundary-layer correction to every circular tube section. The solver now estimates frequency-dependent attenuation, propagation speed, and complex characteristic impedance from the viscous and thermal boundary-layer thicknesses. The existing `loss_factor` remains available as an extra empirical calibration term, but no manual loss factor is required to obtain basic microtube damping.

A **Generic 711 / IEC 60318-4 approx** load is also available. It models the 7.5 mm principal cavity with an approximately 12.5 mm length, thermoviscous propagation, and an RCL microphone termination. The predicted pressure is transferred to the modeled microphone plane rather than simply using the pressure at the coupler entrance.

This 711 option is intentionally labelled an approximation. A conforming IEC 60318-4 simulator includes additional side cavities/slits and dimensional/tolerance requirements that are not fully represented by this compact browser model. Use it for design comparison and calibration against your own 711 measurements, not for standards-compliance certification.
