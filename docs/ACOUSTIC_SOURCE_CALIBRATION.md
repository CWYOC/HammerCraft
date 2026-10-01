# Per-driver damping models

Every acoustic-library driver, and imported custom drivers, can now use an individual passive source network. **The controls are available for all drivers; physical calibration is not complete.** The Sonion 2356 guide fit remains the only supplied example fitted to paired published curves. It is not independently validated and must not be copied to other receivers.

An undamped frequency response describes a receiver driving a particular fixture. It does not uniquely determine the receiver's acoustic source impedance. Changing that impedance changes how an external damper reduces resonances. Smoothing or attenuating a measured curve cannot identify this interaction.

## In the designer

1. Open a driver's **Acoustic path** panel. Select **Passive source network (per driver)** or **USE PASSIVE SOURCE ESTIMATE**. The button resets to an uncalibrated starting network; the dropdown reuses an existing network when present. Converting the 2356 guide fit to a manually editable network keeps its parameters but removes its guide-fit status.
2. Edit series resistance, inertance and compliance, and add parallel RLC modes when supported by measurements. Resistances displayed in the UI use CGS acoustic ohms; JSON source resistances use SI units (`CGS × 100,000`). These values describe the receiver source, not its electrical impedance or the measured SPL peak's Q.
3. Place a **damper** in the ordered design path. For example, a damper between two 6 mm tube sections sits 6 mm from the receiver. Calculate to compare it with the **same geometry, dampers removed** response. The source network stays fixed when you change damper value or position.
4. Use **FITTED SOURCE PROFILE JSON** to import a receiver-specific fit produced below. Import checks the receiver, baseline, baseline voltage, impedance data and reference fixture. It preserves the current design path and electrical circuit. A changed baseline or reference requires a new fit; manual edits remove the imported fit's provenance.

New 711 library entries use the published 711 lumped side-cavity model. Saved projects keep their existing load; **USE 711 SIDE-CAVITY MODEL** explicitly upgrades an older generic 711 reference and selects that output load. Sonion 28UAP01 keeps its 2 cc reference approximation. A nominal 711 circuit is not calibration of a particular adapter or high-resolution coupler.

The passive source and side-cavity load require the Rust/WASM engine. If it is unavailable, calculation reports that requirement instead of silently using the simplified fallback.

## Collect fitting data

Follow the [measurement protocol](IEM_VALIDATION_PROTOCOL.md) for calibration, voltage, dimensions, seals, remounts, uncertainty and phase. From the repository root, generate a new packet:

```sh
node tests/diagnostics/prepare-iem-validation.mjs /tmp/iem-fit-session
```

This creates 133 frozen prediction setups and blank forms across ten drivers: 30 fitting and 103 held-out validation cases. It creates **no measured data**. The fit cases for each receiver are its reference fixture, a 6 × 2 mm straight tube, and a 12 × 2 mm tube with a 680 CGS acoustic-ohm damper at its midpoint. Reference/reference unity checks the baseline but cannot identify the source, so the fitter requires at least two other distinct source-sensitive configurations. These are a pilot design, not a guarantee of unique identification; acquire additional known loads and phase when parameter uncertainty remains high.

Check actual receiver and transformer ratings before choosing the acquisition voltage. Confirm the real fixture before collecting data. Correct a setup and its hash **before** acquisition if the planned geometry differs. Copy completed JSON forms into `measurements/` at the filenames listed in `manifest.json`. Preserve raw instrument exports separately. Do not mark templates confirmed, populate them with predictions, or reuse fitting records as held-out measurements.

For physical measurements, each file needs schema version 1, `kind: "physical_measurement"`, its confirmed setup hash, actual input voltage, specimen/mount/coupler/calibration identifiers, acquisition timestamp, and ordered absolute-SPL points covering the declared band. The full validation protocol additionally requires uncertainty, phase and pairing metadata. The fitting routine supports magnitude-only published curves with `kind: "published_curve"`, a `source_url` and `notes` documenting fixture assumptions; these cannot produce a physical validation pass.

## Fit each receiver

```sh
node tests/diagnostics/fit-driver-sources.mjs \
  /tmp/iem-fit-session/manifest.json \
  /tmp/iem-source-fits \
  1
```

The final argument is the number of parallel modes: 0, 1 (default), or 2. Start with the least complex model supported by the fitting data. More modes need more independent acoustic loads; a lower training residual alone does not establish a better receiver model.

The batch runner groups by driver, reads only `role: "fit"` cases and fits positive passive parameters with the production WASM solver. It compares absolute SPL without a fitted gain correction or baseline modification. It refuses extrapolation beyond measurement/baseline coverage, stale setup hashes and source-insensitive duplicate configurations. It writes:

- `*.source.json` for receivers with complete usable fitting data, always labelled **FIT_NOT_VALIDATED**.
- `report.json` covering every manifest driver, with **AWAITING_MEASUREMENTS** or **NEEDS_ATTENTION** where necessary. Missing measurements never generate a profile.

Exit 0 means every manifest receiver produced an unvalidated fit, 2 means at least one remains pending or needs attention, and 1 means the batch could not start. Existing output folders are never overwritten. Keep the fit report, source files, source records and raw data together; inspect residuals and repeatability before using a result. The optimizer reports a candidate, not proof of convergence, uniqueness or physical validity.

## Freeze and independently validate

Import the appropriate `.source.json` into the matching receiver's designer panel. To create a new acquisition packet using all matching fitted profiles, pass the profile directory:

```sh
node tests/diagnostics/prepare-iem-validation.mjs \
  /tmp/iem-held-out-session \
  /tmp/iem-source-fits
```

The generator copies each matching fitted network into every setup for that receiver and hashes the final request. Receivers without a matching fit remain explicitly uncalibrated in `driver-readiness.json`; mismatched baseline/reference profiles are rejected. Review that inventory before acquisition. This command supports the library's standard reference fixtures; for a custom baseline or fixture, export the frozen setups directly from the designer.

Collect new held-out measurements against those frozen setups and then run:

```sh
node tests/diagnostics/validate-iem-measurements.mjs \
  /tmp/iem-held-out-session/manifest.json \
  /tmp/iem-held-out-results
```

The comparator reports missing evidence rather than treating it as a pass. Keep the original fitting packet and do not rewrite old hashes to make a changed model look prospectively validated. If validation results influence another fit, reserve new independent data for the next validation.

The initial band is 100 Hz–8 kHz where each baseline supports it; EST65DA01 starts at 1 kHz. Extended treble, exact high-resolution couplers, transformer conditions, integrated venting, phase, distortion and complete multi-driver/shared-bore assemblies still need their own evidence. See the [all-driver software and data-readiness report](reports/2026-10-01-all-driver-damping/README.md).
