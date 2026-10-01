# IEM validation protocol

**1 October update:** [Per-driver passive source models and measurement fitting](ACOUSTIC_SOURCE_CALIBRATION.md) are now available for all ten acoustic-library receivers. The [current all-driver report](reports/2026-10-01-all-driver-damping/README.md) and [new acquisition packet](reports/2026-10-01-all-driver-damping/measurement-packet.zip) supersede the software counts and packet below. Physical validation is still incomplete. The dated results below describe the original 29 September baseline.

Started 29 September 2026. **Software validation is passing; physical acoustic validation is incomplete.** The first deliverable is a corrected voltage pipeline, an independent-measurement comparison runner and a blank acquisition packet for all ten current drivers. No new laboratory measurements or calibrated receiver models are included.

Verified locally: **112 regression tests passed**, **170/170 all-driver functional checks passed**, and **4,750 numerical sweep cases passed**. All 133 generated setup requests returned finite responses and matched their template hashes. The measurement runner reports **133 awaiting measurements**, not 133 physical passes. Browser checks used a local fixture preview; voltage edits, calculation and save/load passed. The export action reported success, but its downloaded file could not be independently retrieved through the in-app browser's download event. The packet generator provides the same setup format directly.

## What has changed

- New database drivers retain their baseline measurement voltage and use the common input voltage, initially 0.10 V RMS. The correction is `20 log10(input voltage / baseline voltage)`, assuming linear response.
- At 0.10 V, 17A003 receives +3.098 dB relative to its 0.07 V baseline; 28UAP01 receives −4.082 dB relative to its 0.16 V baseline. The other eight selected baselines were measured at 0.10 V.
- Forward calculation, the datasheet overlay, the same-geometry undamped comparison, reverse scoring and exported setups use the same corrected baseline. Optimizer gain remains a separate adjustment.
- Older projects retain their previous levels in **Keep reference level** mode. To migrate, enter the actual baseline voltage, remove any voltage adjustment previously included in Gain, then select **Common input voltage**. New FR imports reset voltage metadata because the old file's conditions no longer apply.
- Supplied database phase is retained. Missing phase remains identifiable; historical placeholder zeros do not count as measured phase in validation exports. This does not supply the missing phase for the existing library.
- **EXPORT VALIDATION SETUP** saves the full prediction request and its calibration metadata. The export is not a measurement or accuracy certificate.

## Start with Sonion 2356

1. Identify the exact coupler, microphone, interface/analyzer and calibration records. Record frequency-dependent uncertainty, timing reference, drive source impedance and the actual signal voltage. A microphone sensitivity calibration does not by itself characterize coupler impedance.
2. Document the fixture, insertion stop, seals, rear vents, internal damping, tube material and actual internal dimensions. Choose one specimen and establish remount repeatability before fitting any model.
3. Measure the reference and the packet's fitting cases, including full electrical impedance and phase under several known acoustic loads. Use those measurements to identify the receiver model and check the coupler model independently.
4. Freeze model parameters and engine version. Generate a new packet with the final parameters before examining validation cases. Retain the old packet and raw files.
5. Measure the held-out cases. Start with the 12 × 2 mm straight tube and its 1500/2200 CGS acoustic-ohm dampers at 6 mm from the receiver. Then test geometry, damper placement, electrical components and polarity.
6. The three additional 2356 cases use **7 × 1.5 + 2.5 × 2.1 + 3 × 2.5 mm** tubing: undamped, 1500 CGS acoustic Ω at 7 mm, and 1500 CGS acoustic Ω at 9.5 mm. These define new experiments. The published guide does not establish its exact damper position or drive level, so they are not claimed as exact reproductions of that measurement.

After the first specimen is repeatable, an initial study can use three specimens and three independent remounts per configuration. These are proposed pilot sample counts, not a statistical certification rule. Add cases for each specimen/remount rather than averaging away variation. If a validation result is used to tune the model, it becomes fitting data; collect or reserve new independent cases.

## Packet and commands

The attached [measurement packet](reports/2026-09-29-iem-validation-start/measurement-packet.zip) contains 133 setups, blank acquisition templates, a manifest and driver readiness records. It covers 30 fitting cases and 103 validation cases. All 133 currently await measurements.

From the repository root, generate a fresh packet into a directory that does not already exist:

```sh
node tests/diagnostics/prepare-iem-validation.mjs /tmp/iem-measurements-run-2
```

The generator refuses to overwrite an existing packet. Its setups use the current library assumptions, not a calibrated fixture. Inspect and correct the physical setup before acquisition. Export a corrected setup from the designer when necessary; update its template hash with the exported file's JSON hash using the `hash()` helper in `measurement-validation.mjs`.

Copy completed templates from `measurement-templates/` into `measurements/` using the filenames in `manifest.json`. Do not put empty templates into `measurements/`. Duplicate manifest cases with distinct IDs and files for each specimen/remount; point each damped case to its corresponding undamped case.

Run the comparator, replacing the paths with your extracted packet and a new result directory:

```sh
node tests/diagnostics/validate-iem-measurements.mjs \
  /tmp/iem-measurements-run-2/manifest.json \
  /tmp/iem-measurements-run-2-results
```

Outputs are `report.md` and `results.json`. Exit 0 means all declared validation cases passed; exit 1 means a numerical threshold or input validity failed; exit 2 means evidence is incomplete. Fitting cases are reported but do not count toward validation passes. Identical acquisition records cannot serve as both fitting and validation evidence.

The runner records the engine binary hash, setup hashes and measured-data hashes. Preserve these outputs with raw instrument exports and calibration records. Run results are specific to those inputs and that engine.

## Measurement format

Each completed JSON file needs:

- `kind: "physical_measurement"`, `setup_confirmed: true` and the template's `setup_sha256`, only after checking the actual assembly against the frozen setup.
- Actual `specimen_id`, `mount_id`, `coupler_model` including serial/adapter details, `calibration_id`, and `acquired_at` timestamp.
- Actual `input_voltage_v` measured at the circuit input, before the test crossover. This differs from `measurement_voltage_v` in the setup, which describes the voltage at the receiver terminals during baseline measurement. Use RMS volts consistently.
- `expanded_uncertainty_db`, a conservative bound over the comparison band. Keep the full uncertainty budget and coverage factor in the calibration records. The initial gate requires this bound to be at most half the SPL RMS target.
- `phase_reference`, describing the common timing reference and fixed instrument-delay correction. Do not independently align each driver or optimize delay against the prediction.
- A common `pair_id` for damped/undamped measurements of the same specimen and fixture session. Record remount IDs individually even when they belong to the same pair.
- `points`, ordered by strictly increasing frequency, with `frequency_hz`, `db` (absolute dB SPL), and `phase_deg`. Missing phase is `null`, not zero. Preserve the raw instrument export as well.

Point structure, shown as notation rather than sample measurements:

```text
{ "frequency_hz": measured frequency, "db": measured SPL, "phase_deg": measured phase or null }
```

The data must cover the full requested band. The runner does not extrapolate, fit gain, normalize each curve, or fit phase. It samples 240 equally spaced log-frequency points and rejects a physical pass when measurement gaps exceed 1/4 octave. That is a minimum coverage check; acquire a substantially denser sweep around sharp resonances. Missing phase, missing calibration, unknown baseline voltage or insufficient baseline frequency coverage leave a case incomplete even when SPL error is small.

## Initial criteria

These are engineering targets for this project, **not IEC limits**. Agree on them before collecting held-out data and tighten or revise them based on repeatability and the intended design accuracy.

| Metric | Initial limit |
|---|---:|
| SPL RMS error | 1 dB |
| SPL 95th-percentile absolute error | 2 dB |
| Phase RMS error over the declared comparison band | 15° |
| Damped-minus-undamped change RMS error | 1 dB |
| Peak level error, when a peak window is explicitly declared | 2 dB |
| Peak frequency error, when a peak window is explicitly declared | 5% |

The packet does not guess peak windows for all drivers. Add `peak_bands_hz`, such as separate windows around clearly identified resonances, before examining the held-out prediction errors. The runner flags peaks at window boundaries. It does not yet score isolated-peak bandwidth/Q, distortion, phase uncertainty, or a manufacturing-population confidence interval. Those require additional analysis and must remain explicit items in the final laboratory report.

The damping check compares the measured damped-minus-undamped change against the predicted change. It verifies that voltage, geometry, circuit, specimen, calibration and pair identity agree; only design dampers may differ. Adjacent identical tube sections are merged for this comparison. An undamped comparison removes external design dampers only; integrated receiver dampers remain part of the baseline.

## Scope and remaining work

The initial packet covers 100 Hz–8 kHz where the baseline supports it; EST65DA01 starts at 1 kHz. This is a pilot, not full-band validation of the EST or every driver's usable range. IEC 60318-4 defines ear simulation from 100 Hz to 10 kHz, with additional coupler use outside that range; it does not establish universal real-ear accuracy outside its specified simulation band. [IEC scope](https://webstore.iec.ch/en/publication/1445)

For upper-treble/EST work, characterize the exact extended-frequency fixture, transformer and input conditions. Record leaks and low-frequency seal sensitivity separately. Receiver identification using multiple acoustic loads is supported by [Kim and Allen's two-port study](https://jontalle.web.engr.illinois.edu/Public/Allen-pdf/KimAllen13.pdf); a single reference magnitude curve does not identify that model.

Before claiming system-level validation, add complete multi-driver assemblies with measured individual and combined responses, both polarity settings and physical crossovers. Shared bores require a model of their coupling. Build at least one reverse-optimized candidate and compare its measured result without retuning the model to that result. Record any unsupported regions and failures in each driver's final validation statement.

The original [software audit](reports/2026-09-29-iem-validation-start/software-audit.json) passed the common-voltage check. The original [Sonion benchmark](reports/2026-09-29-iem-validation-start/sonion-2356-benchmark.json) showed the damping discrepancy; the [1 October guide fit](reports/2026-10-01-damper/README.md) improves that example with explicitly limited evidence. The [initial measurement report](reports/2026-09-29-iem-validation-start/report.md) deliberately shows all measurements as pending.
