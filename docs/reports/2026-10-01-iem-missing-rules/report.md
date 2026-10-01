# Missing IEM design requirements — 1 October 2026

**Yes: important IEM design requirements are still missing or only partially represented.** The website is useful for exploratory circuit/acoustic work and package layout, but it cannot currently determine whether a complete IEM can be assembled, driven correctly, manufactured or matched to its predicted response.

This audit extends the [previous rule-enforcement audit](../2026-10-01-design-rules/report.md). It compares the current source, synthetic executable probes and manufacturer/research guidance. It covers the existing wired/hybrid IEM workflow; wireless radio, battery, ANC and charging requirements would be a separate scope.

The current **176 regression tests still pass**. That confirms their existing software checks, not the requirements absent from those tests. No application logic was changed in this audit. The deliverables are this gap register, a reproducible diagnostic script and its observations.

## Concrete omissions reproduced

Run `node tests/diagnostics/audit-iem-rule-gaps.mjs` from the repository. [Script](../../../tests/diagnostics/audit-iem-rule-gaps.mjs) · [Raw observations and engine hash](probes.json) · [Regression results](tests.txt).

| Probe | Observed on shipped engine 0.19.1 | Meaning |
| --- | --- | --- |
| Tube through another package | Build succeeds. **319 of 1,001 centreline samples** lie strictly inside the unrelated RAF box package; no specific collision warning is issued. | A route can penetrate a driver even when the driver bodies do not overlap. The generic manufacturing-pending message is the only warning. |
| Outlet adapter unspecified | The SR preset's catalog **4.46 mm outlet** accepts a **1.6 mm tube** without a declared transition or sealing check. | Different diameters can be intentional, but their physical adapter/seal must be represented. Equality of the diameters is not a universal rule. |
| Inward-facing closed shell | Reversing all faces gives **−33,064.33 mm³** signed volume at the probe's 2× scale, zero boundary/winding-conflict counts and an accepted build. | Edge consistency does not detect globally inverted solid orientation. No specific orientation diagnostic is generated. |
| Unknown phase in a combined response | Two synthetic 90 dB responses without measured phase calculate to **96.0206 dB** under the assumed phases. | This is an assumption-dependent sum. The UI correctly warns about missing phase and exported flags remain false; a verified hardware response has not been established. |
| Frequencies beyond baseline data | A synthetic 100 Hz–10 kHz baseline returns values at 20 Hz and 20 kHz by holding the endpoint values. | Those plotted values are numerical extensions. Graphs, target scores and searches need explicit supported-band/uncertainty handling. |
| Reverse-candidate gain | Applying a synthetic candidate with **+8 dB** gain and no R/C parts succeeds, with an empty component list and no input error. | The independent gain parameter has no identified hardware implementation. A low predicted error does not prove a buildable passive candidate. This probe tests candidate application, not a newly measured or optimized product. |

These probes are diagnostic observations, **not acceptance passes**. All fixtures are synthetic; no ear, receiver or printer was measured.

## Requirements the system still needs

Priority **A** means resolve before treating a design as verified or releasing manufacturing files. **B** means needed for repeatable product development and production. These priorities are engineering recommendations for this project, not universal regulatory classifications.

| ID | Priority | Missing or partial requirement | Present behavior / required addition |
| --- | --- | --- | --- |
| G01 | A | Finished-shell containment and wall thickness | The model is unmachined stock. Construct cavities, channels, connector and faceplate features first; measure the remaining wall and minimum separation against the finished solid, including around nozzle roots. |
| G02 | A | Tube-to-driver, tube-to-tube and tube-to-wall clearance | The penetration probe succeeds. Add geometric collision/clearance checks with explicit exceptions for a tube's own outlet and intentional junctions. |
| G03 | A | Tube bend feasibility and self-intersection | A positive annulus and finite Bézier path do not establish a usable bore. Check curvature, folding/cusps, self-intersection and the selected tube/process's bend capability. Flexible tubing and drilled resin channels need different criteria. |
| G04 | A | Closed-solid orientation and intersection checks | Edge topology is inspected, but global orientation, self-intersections and intersecting/disconnected shells are not a finished-solid validation. Add specific diagnostics and a manufacturing release gate. |
| G05 | A | Physical outlets, transitions and damper installation | Outlet position follows the package; outlet diameter does not constrain an adapter. Add spout/adapter geometry, seating/sealing allowance, damper body dimensions and installation/access space. The acoustic damper order already works, but its physical body is not placed in 3D. |
| A01 | A | Shared-bore and common-cavity acoustic coupling | Drivers are solved independently against a load and their pressures summed. Represent branch junctions and common volumes as one acoustic network. Avoid claiming a merged-bore simulation from independent tube traces. |
| A02 | A | Driver-specific front/rear volumes and vent topology | Rear-vent flags produce text warnings. There is no per-driver back-volume/vent geometry linked to the source model or blocked-vent check. The output-load leak parameter is not a rear-vent model. |
| A03 | A | Receiver-model identification under changing loads | Fixed measured electrical impedance and an estimated acoustic source are used separately. They do not identify full electromechanical coupling. Require measured complex source/two-port data or a declared, validated approximation for the intended loads and band. |
| A04 | A | Phase, fixture and frequency-band readiness | Missing phase is warned about and laboratory validation blocks it, but exploratory sums still render. Add per-band confidence/readiness, target-fixture compatibility and checks that prevent unsupported endpoint extensions from being treated as measured or validated predictions. |
| E01 | A | Whole-IEM input impedance and real source/cable impedance | Each driver circuit has an ideal voltage input. Compute complete assembly impedance, minimum impedance, source current and voltage drop through a shared source/cable impedance. Per-driver measured impedance alone is not the crossover-plus-parallel-system load. |
| E02 | A | Driver/component/amplifier operating limits | No limits for driver voltage, current, power, DC conditions, amplifier clipping or component voltage/power ratings. Add supplier-specific limits, waveform/level assumptions and band-dependent headroom. Clean-looking linear FR cannot establish maximum usable SPL. |
| E03 | A | Realizable crossover and gain | Ideal HP/LP response filters and independent gain affect the prediction. Mark conceptual filters separately from a physical crossover or explicit active/DSP chain; verify reverse candidates have a declared implementation at the stated voltage. |
| D01 | A | Exact part and technology compatibility | A technology name and package flag do not select or validate a technology-specific solver. Link exact ordered variant, coil/terminal configuration, polarity convention, outlet drawing and baseline fixture. Require appropriate electronics/model evidence for dedicated-drive transducers; a user-created geometry link does not verify these properties. |
| M01 | A | Manufacturing/material process profile | No material/process-specific shrinkage, minimum reliable feature, assembly allowance, trapped-resin/drainage, cleaning or curing checks. Store a qualified printer/material/process profile and actual dimensional evidence. Apply the same to adhesives, coatings and skin-contact surfaces. |
| F01 | B | Ear fit, seal and nozzle/tip interface | No ear-surface fit, insertion-depth/angle constraints, edge/retention checks, tip compatibility or seal sensitivity study. Add geometry and measured fit/seal cases. Coupler volume alone does not describe the user's fit. |
| G06 | B | Electrical packaging and assembly access | No 3D resistor/capacitor/transformer/board/connector envelopes, insulated wire routes, solder access, strain relief or assembly-order checks. Include these in clearance and BOM validation; schematic wire graphics provide none of that geometry. |
| V01 | B | Variation, left/right matching and durability | No tolerance sweep for parts, bores, damper resistance or receiver variation; mirror is not a separately validated L/R pair. Add sensitivity/worst-case studies, pair matching and project-defined retention/leak, contamination, sweat/cleaning and handling test evidence. |
| V02 | A | Complete measurements and revision-specific release | The existing comparator checks absolute SPL, phase, selected peaks and damping change. Extend it with THD/IMD, output-versus-level/compression, peak bandwidth/Q, L/R and repeatability/population analysis. Attach approved evidence to an immutable design/model/process revision; changes should invalidate affected approvals. |

“Needs checking” is not equivalent to “always fails.” Some designs intentionally use venting, tapered bores, short tubes or shared outlets. Applicability and limits must come from the exact design, part data and manufacturing process.

## Why the acoustic gaps matter

Manufacturer guidance treats source impedance, target response, headroom, distortion, nozzle/tube geometry, eartips and damper placement as interacting design choices. This supports adding checks beyond frequency-response error alone. Historical example dimensions are useful starting points, not universal constraints for every receiver. [Sonion, *Designing Earphones with Balanced Armature Receivers*, manufacturer-authored guide, archived copy](https://datasheet.datasheetarchive.com/originals/crawler/america.sonion.com/64f5a330a4357be5bd691f46e9beae16.pdf)

The more fundamental model issue is feedback between electrical and acoustic loading. Kim and Allen identify a balanced-armature two-port model using electrical impedance measured under multiple acoustic loads. The present website instead applies an electrical transfer and an acoustic correction to a baseline. My conclusion is that this is a useful approximation with a restricted validation scope; a different curve under a new load is not automatically a measured-quality prediction. [Kim and Allen, 2013](https://jontalle.web.engr.illinois.edu/Public/Allen-pdf/KimAllen13.pdf)

Venting requirements also vary by transducer. For the USound family covered by its handling guide, the backport connects the device to its application back volume and must not be sealed shut. That is a concrete reason to replace a generic “rear vent required” flag with part-specific geometry and volume requirements. [USound handling guide](https://www.usound.com/wp-content/uploads/2020/01/1910_MEMS-speakers-handling-guide.pdf). USound also describes dedicated amplifier integration for its MEMS devices. [USound Kore integration](https://usound.com/mems-speakers-modularization-kore-4-0/)

Leakage and insertion position affect the pressure developed in an ear simulator. The exact simulator and insertion geometry therefore belong in a validation case, and different fixtures should not share an unconditional full-band “validated” label. [GRAS ear-canal study](https://www.grasacoustics.com/fileadmin-gras/Industries/Consumer_Audio___Electronics/GRAS_Ear_Canal_WP-2024-10__1_.pdf). The standard RA0045-style 711 simulator also has a prominent high-frequency length resonance, so a plotted treble peak may involve the fixture. [GRAS RA0045](https://www.grasacoustics.com/products/ear-simulator/product/248-ra0045)

For materials, printer/resin selection and post-processing are part of the part's performance evidence. Formlabs, for example, requires specified washing and post-curing for BioMed Clear and states that final-part suitability depends on the application and manufacturing practices. This is an example of the process metadata the system lacks, not a recommendation to use that particular resin or a certification of an IEM shell. [Formlabs BioMed Clear documentation](https://formlabs.com/global/products/biomed-clear-resin/)

## Existing checks that should be retained

The following are **already present**, so they should not be reported as wholly missing:

- Circuit connectivity, short/open diagnostics, supported components and basic values.
- Driver polarity inversion and complex-pressure summation, with missing-phase warnings.
- Ordered acoustic sections, position-sensitive dampers and an undamped comparison using the same geometry.
- Reference-fixture compensation, common-input voltage scaling and baseline measurement metadata.
- Stable 3D/acoustic links, stale-link errors, bounds checks and transactional rollback of rejected geometry.
- Shell edge-topology and coarse package-overlap warnings.
- Independent measurement comparison with calibration, specimen/remount IDs, setup hashes, phase evidence and fitting/validation separation.

The missing part is often **physical coverage and a release decision**, not the complete absence of a related feature. For example, a generic leaky acoustic load exists, but it does not check whether glue blocks a specific driver's rear vent.

## Code evidence

- [Geometry build and warnings](../../acoustic-engine/src/workshop.rs): `build`, `swept_tube`, `inspect`; package data is reduced to envelopes/outlet location/axis plus warning flags.
- [Catalog integration metadata](../../assets/workshop/drivers.json): planning/supplier flags, dedicated electronics, rear vents and outlet diameters.
- [Acoustic simulation](../../acoustic-engine/src/simulation.rs): per-driver electrical/acoustic transfer followed by independent pressure summation.
- [Circuit solver](../../acoustic-engine/src/electrical.rs): `circuit_netlist_transfer` fixes the input at ideal 1 V and returns a transfer ratio, not the whole assembly's source current/power.
- [Model schema](../../acoustic-engine/src/models.rs): no shared electrical source network, acoustic junction graph, tolerance/rating or manufacturing-process schema.
- [Response interpolation](../../acoustic-engine/src/response.rs): values outside baseline coverage hold the nearest endpoint.
- [Designer UI](../../iem-designer.js): `updateModelNotes`, `applyRevPhysical`, `validationSetup`; the existing warnings are real, and reverse gain is independent of physical parts.
- [Measurement comparison](../../../tests/diagnostics/measurement-validation.mjs) and [protocol](../../IEM_VALIDATION_PROTOCOL.md): calibration/phase/band checks exist; Q, distortion and population analysis remain outside the present comparator.
- [Shared project](../../design-project.mjs): stable identities and dimension synchronisation; no manufacturing approval/evidence record.

## Implementation order

1. **Add a project readiness report first.** Each applicable rule should have `PASS`, `FAIL`, `UNKNOWN` or `NOT APPLICABLE`, evidence, scope and a revision identifier. Missing data must remain unknown. Allow exploratory editing; require the appropriate passed checks for a verified/manufacturing release.
2. **Close the proven geometry gaps:** route collisions, tube self-intersection, solid orientation, physical outlet/damper transitions, then finished-shell machining and wall/containment checks.
3. **Make the electrical and acoustic assumptions explicit:** whole-input impedance/source loading, candidate gain/filter realizability, operating limits, shared acoustic networks and technology-specific models.
4. **Build process and validation coverage:** qualified manufacturing profiles, dimensional tolerances, matched-pair/level/distortion testing and independent measured assemblies.

Do not turn a numerical floor such as the current **0.1 mm bore / 0.05 mm tube wall** into a manufacturing recommendation. Likewise, “same tube length for every driver,” “always invert the tweeter,” and “one correct target curve” should not be hard rules. Check the complete measured complex response and the actual mechanical/process constraints instead.

## Audit limits

Source reviewed at commit `d34c231`; engine identity and SHA-256 are recorded in `probes.json`. The suite passed **176/176**, and six additional synthetic probes were executed. Existing tests were not re-labelled as evidence for these missing requirements. No production data, hardware measurements, regulatory certification or universal safe-fit/material thresholds were inferred. The missing features listed above remain to be implemented or supported with evidence.
