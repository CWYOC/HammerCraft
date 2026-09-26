# Sonion 2356 frequency-response investigation

The screenshot is reproducible in the shipped WASM engine. It is a source/load-model problem, not a chart-rendering error. An exact reference match was hiding it because the acoustic model cancels itself.

For the 2026-09-26 polarity control, experimental resonant-source model and damper calibration workflow, see [Polarity and acoustic damping](POLARITY_AND_DAMPING.md). That follow-up distinguishes software checks from calibration against real damped measurements.

## Reproduction

The live database's default Sonion 2356 measurement contains 38 digitised magnitude points, no measured phase, and this reference fixture:

- 4.5 mm tube, 1.4 mm inside diameter;
- 11 mm tube, 1.9 mm inside diameter;
- IEC 711 coupler, 0.100 V RMS drive.

With the screenshot's 12 mm × 2 mm tube, zero additional loss, the existing simplified 711 load, 20°C and 50% humidity, the old forced ideal-pressure source produces the same distinctive extrema. The comparison below uses the same engine, baseline and load for both source assumptions. Values are rounded from a 2,001-point logarithmic sweep.

| Frequency | Previous ideal-pressure model | Finite source estimate |
| --- | ---: | ---: |
| 817 Hz | 92.8 dB | 106.1 dB |
| 1.122 kHz | 128.4 dB | 107.4 dB |
| 2.670 kHz | 123.9 dB | 118.8 dB |
| 9.717 kHz | 82.7 dB | 101.3 dB |
| 12.634 kHz | 118.3 dB | 94.6 dB |
| 15.067 kHz | 117.8 dB | 90.6 dB |

![Source-model comparison](diagnostics/sonion-2356-source-comparison.png)

These are model results, not measured validation. The smoother estimate is not evidence that it is the real Sonion response.

## Why the reference alone looked correct

The acoustic correction is `H(design, load, source) / H(reference, reference load, source)`. With identical geometry and loads, this equals one for either source assumption, even when the model is physically incomplete. The reference button also replaces the design geometry and output load. A unity pass therefore verifies cancellation, not the ability to predict another tube.

The old request always specified zero acoustic source impedance. Changing tube geometry then moves sharp resonances in the model: division by the reference resonance creates a dip, while the new design resonance creates a peak. The 817 Hz / 1.122 kHz pair is a direct reproduction of this effect. Thermoviscous tube losses already exist when the UI's additional LOSS is zero; zero LOSS does not mean a completely lossless tube.

The coupler also remains incomplete. Its code includes the main cylinder and microphone RLC termination, but omits the two side cavities and lossy slits. Those elements are important to the actual 711 acoustic impedance and damping. The microphone RLC values alone do not describe a full coupler. See the [COMSOL generic 711 model](https://doc.comsol.com/6.4/doc/com.comsol.help.models.aco.generic_711_coupler/generic_711_coupler.html).

## Corrections made

- Referenced measurements now default to an explicitly labelled finite-resistance estimate. It is `rho*c/area` at 20°C / 50% humidity, using a fixed reference bore: about 2.692×10⁸ Pa·s/m³ for this 1.4 mm reference. It is an assumed source resistance, not a fitted or measured Sonion parameter. Editing the design bore or running reverse optimisation does not change the source. Custom resistance and the old ideal-pressure limiting case are available for comparison.
- Catalog damper values now convert from CGS acoustic ohms to the engine's SI units: multiply by 100,000. Reference-path copying, forward simulation, reverse constraints and returned candidates use the conversion consistently. Previously a 1,000-ohm catalog damper reached the solver as 1,000 instead of 100,000,000 Pa·s/m³ and had almost no effect. This is a separate bug; the screenshot has no damper. CGS catalog ratings are documented in [Voss and Allen's measured damper study](https://jontallen.ece.illinois.edu/uploads/537.F18/Papers/Public/VossAllen94.pdf); the conversion appears in [ASTM C522's unit table](https://store.astm.org/c0522-03r16.html).
- The reference action is labelled a unity check. The UI identifies the simplified coupler and source assumptions, and identifies comparisons that also change the output load. Changing load/environment clears a previous reference-check state.
- The resonance card is labelled a geometric quarter-wave estimate, with serial path lengths summed. Transit time also uses the entire path. These are not the actual response peak or group delay.

Saved catalog damper numbers remain unchanged; conversion occurs at the WASM boundary. Old referenced projects without source settings receive the finite estimate. Explicitly selected source settings persist in saved projects. No response smoothing or clipping was introduced.

## Remaining accuracy limits

A magnitude-only response under one fixture does not determine the receiver's complex acoustic source impedance. Reliable absolute predictions for different bores, chambers and loads need a measured/manufacturer receiver model (or calibration against several known loads) and a validated coupler model. The simplified coupler has not been replaced by a full IEC model in this change. Missing manufacturer phase also limits multi-driver summation. Reverse-design scores are conditional on these assumptions, not measurements of the finished IEM.

## Verification

Run `node --disable-warning=ExperimentalWarning --test tests/*.test.mjs` from the repository root: **74 tests pass**, including nine acoustic regressions using the shipped WASM binary. They reproduce the screenshot, check source invariance, verify a damper against an independent pressure-divider calculation, exercise reference copying and reverse-search unit conversion, preserve forward/optimizer agreement, reject invalid source resistance, and check that splitting a uniform tube preserves its response and path metrics.

Local browser checks verified the 12 mm response, switching between estimated/custom source resistance, resetting the estimate after a custom value, reference unity, and clearing the reference pass after changing the output load. Production authentication was unchanged; the preview used a local fixture. Changes have not been deployed.

## Follow-up: coverage of every database driver

The complete library snapshot contains **10 default driver measurements**. All now run through the same finite-source, reference-corrected forward and reverse pipelines. This includes changes to tube length/diameter and dampers, not only reference unity. Some fixtures still require explicit assumptions; operational simulation is not physical validation.

| Driver | Effective reference setup | Confidence |
| --- | --- | --- |
| Sonion 2356 | Existing 4.5 × 1.4 mm + 11 × 1.9 mm tubes | Database geometry; approximate source/coupler |
| Sonion 17A003 | Existing database reference | Same limitations |
| Sonion 28UAP01 | 10 × 1 mm tube, 2,000 mm³ cavity | Volume-only 2 cc approximation |
| Sonion 33AJ007i/9 | Existing database reference | Same limitations |
| Sonion 38D1XJ007Mi/8a | Existing database reference | Same limitations |
| Sonion EST65DA01 | Existing database reference | Same limitations |
| Knowles RAU-34832-B148 | 1.75 × 1 mm tube | Documented tube; simplified 711 substitutes for Hi-Res coupler |
| Knowles RDI-34006-000 | No external reference tube | Documented tubeless setup; tool geometry unresolved |
| Knowles CI-22955-000 | 8.6 × 13.2 mm followed by 5 × 7.6 mm sections | Assumed DB2012 approximation; insertion depth unresolved |
| Knowles HODVTEC-31618-000 | Direct coupling | Explicit assumption; manufacturer adapter dimensions unavailable |

The [RAU performance specification, page 2](https://www.knowles.com/docs/default-source/model-downloads/rau-34832-b148.pdf?Status=Master&sfvrsn=bd3c73b1_4) specifies a 1.75 mm tube with 1 mm inner diameter and GRAS RA0402 termination. The [RDI specification, page 2](https://www.knowles.com/docs/default-source/default-document-library/rdi-34006-000.pdf?Status=Master&sfvrsn=ff0370b1_0) specifies tubeless measurement using tool T8688, with rear vents open. These performance specifications supplement incomplete library metadata; equivalence to the digitized library measurement fixture has not been calibrated.

The CI profile uses dimensions reported in [Riederer and Niska, AES 2002, page 4](https://www.kar.fi/KARAudio/Publications/publications/aes21.pdf). The two cylindrical sections are our approximation of the adapter, **not** a verified Knowles insertion setup or an exact conical model. The [HOD datasheet](https://www.knowles.com/docs/default-source/default-document-library/receiver-datasheet-hodvtec-31618-000-1.pdf?sfvrsn=0) identifies the coupler without sufficient adapter geometry; direct coupling is explicitly assumed. Neither assumption establishes measurement accuracy. The 2 mm source-model bore for CI, RDI and HOD is also assumed, not a manufacturer receiver parameter.

### Engine and workflow changes

- WASM 0.16.0 now treats an empty reference path **with a reference load** as a tubeless measurement. Previously it skipped compensation and applied the source/load transfer again. An empty path without a reference load remains unreferenced.
- Library profiles supplement known incomplete rows without rewriting the raw database metadata. Existing valid reference paths and user overrides take precedence. Previously blocked saved projects migrate once to the finite-source default; custom resistance and subsequent explicit source choices persist.
- Every database driver now has an editable measurement reference: ordered tubes, chambers, dampers, direct coupling and reference load/volume. Overrides save with the project and can be reset to the library setup. Editing invalidates stale charts, reference results and reverse candidates. Invalid geometry stops both simulation workflows.
- Assumed fixtures are labelled on library cards, reference panels and model notes below the graph. Unity checks remain arithmetic checks. Unknown future fixtures are still diagnosed instead of silently receiving an assumed zero-length path.
- JavaScript fallback uses the same resolved reference path, but remains a heuristic, not the physical WASM solver. Both the browser module and WASM binary have versioned URLs so cached older engine code is not used with the new reference handling.

### Verification

`node --disable-warning=ExperimentalWarning --test tests/*.test.mjs` passes **74 tests**. All ten library rows are exercised against the rebuilt WASM binary with matched references; 6 × 1, 12 × 2 and 20 × 3 mm design tubes; 1,000 CGS acoustic-ohm dampers; fixed source resistance; forward/optimizer baseline agreement; and reverse-search candidates. Additional regressions cover the tubeless transfer against an independent pressure-divider calculation, reference editing/persistence/reset, old project migration, incomplete future fixtures, and invalid reference dimensions. These checks validate software behavior, not real IEM accuracy.

Local browser checks verified all four new profiles, WASM 0.16.0 loading, RDI tubeless unity, reference tube editing, saving/loading the edited reference, and explicit CI/HOD assumption labels. Production authentication and database rows were unchanged. The local preview used offline fixtures. Changes have not been deployed.
