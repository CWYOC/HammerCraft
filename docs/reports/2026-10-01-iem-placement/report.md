# IEM component placement review — 1 October 2026

**There are important placement requirements, but there is no single correct arrangement for every IEM.** Physical fit, acoustic paths, vents, electrical packaging and assembly access must be designed together. A visually tidy layout is not evidence that the assembly fits or produces the predicted response.

This review compares the website's current Rust geometry code, its 18 placement presets, the original HeadphoneWorkshop code and manufacturer guidance. It covers the wired IEM workflow. It adds documentation and diagnostic observations; it does not implement new placement checks or certify a physical assembly.

## What to check when placing each component

The checks below are engineering recommendations for this project. Exact dimensions, mounting restrictions and acceptance limits must come from the selected part drawing and a qualified manufacturing process. The source notes below distinguish manufacturer guidance from proposed software rules.

| Component / interface | Placement requirement | Appropriate system behavior |
| --- | --- | --- |
| Driver package | Fit the complete part inside the finished cavity, including protruding spouts, terminals, mounting material and assembly allowances. Prevent unintended intersections with other parts. | Check actual transformed geometry against the cavity and nearby parts. Allow explicitly defined bonded/contact interfaces. A surrounding bounding box is only a preliminary check. |
| Driver mounting | Support the permitted package surfaces; keep pressure, adhesive and tools away from membranes, outlets and required vents. Select rigid or compliant mounting for the actual device. | Store allowed mounting regions and protected regions per part. Missing mounting information should remain unverified. |
| Driver outlet | Provide a continuous, sealed connection to its intended acoustic path. A smaller or larger tube needs a designed transition and adequate sealing engagement. | Validate spout/adapter/tube geometry and the intended connection. Do not require every outlet diameter to equal the tube bore. |
| Sound tube or printed channel | Preserve the intended internal cross-section and actual path length. Avoid pinching, self-intersection, unintended junctions and intersections with other components. | Check the entire route with its outside diameter and applicable clearance. Use tubing-specific bend limits or printed-channel process limits. |
| Damper | Reserve its body, seat, insertion space and any required replacement access. Record its position along the acoustic path, not just its resistance. Prevent an unintended bypass around the damper. | Link a physical damper and its route position to the acoustic model. Treat position as a tuning variable. |
| Rear vent / front and rear volumes | Connect each port to the air region required by that exact receiver. Preserve the designed volume and intentional vent path; avoid accidental front-to-rear leaks. | Model port direction, protected space and cavity connectivity. An “unobstructed” vent may open into an internal back chamber; it does not necessarily mean a hole to the outside. |
| Shared bore / collector | Give every intended branch connection a defined position, section and volume. Prevent accidental connections between otherwise separate bores. | Validate junction geometry and solve its acoustic loading as a connected network. Independent driver sums do not establish shared-bore behavior. |
| Nozzle / tip / wax protection | Reserve room for bore walls, filters, retention features and the chosen tip. Verify the intended insertion angle, depth and seal. | Check finished nozzle geometry and record the measurement fixture and insertion condition. Interior package fit alone does not establish ear fit. |
| Crossover / drive electronics | Reserve the real package, solder joints, insulation and wire access. Keep components out of moving/vented/acoustic regions and support them against movement. | Add physical component and board envelopes linked to the schematic. Dedicated-drive parts also need their electronics represented. |
| Inductors, when used | Assess magnetic interaction between nearby coils and nearby metal. Spacing and perpendicular coil axes can reduce coupling. | Use a component-specific recommendation or measured limit. Do not apply a universal 90-degree orientation rule to all receiver bodies. |
| Connector / wires | Support connector insertion and removal loads through its mount. Leave space for the mating plug, insulated wires, bends, soldering and strain relief. Prevent pinched wires at the faceplate. | Check both installed geometry and assembly/tool/plug access volumes. Wires drawn on a schematic are not physical routes. |
| Faceplate / assembly sequence | Ensure parts can actually be inserted, bonded, connected and inspected before closure. Preserve the bonding land and any cleaning/access needs. | Evaluate a proposed assembly order, not only the final arrangement. |
| Left / right assemblies | Reuse real components through feasible rotations/translations. Confirm outlet and terminal access independently on each side. | Mirroring a shell must not silently require a mirrored version of an asymmetric purchased component. Verify both assemblies and their acoustic paths. |

## Manufacturer guidance and its limits

Sonion's BA earphone guide states that tube geometry and damper position affect response. It suggests locating a damper **50–75% of the way from the receiver along the tube** as a starting point; the outlet end can be more effective but more susceptible to clogging. This is application guidance, not a mandatory position for every receiver or multi-branch design. Test the chosen arrangement with its crossover, termination and intended seal. [Sonion, *Designing Earphones with Balanced Armature Receivers*, pages 8–10, manufacturer-authored archived copy](https://datasheet.datasheetarchive.com/originals/crawler/america.sonion.com/64f5a330a4357be5bd691f46e9beae16.pdf)

For the USound MEMS family covered by its handling guide, bending and membrane contact must be avoided. The back protection sheet must remain intact, and the backport must retain its connection to the application back volume. This supports part-specific protected geometry rather than assuming every driver can be surrounded with adhesive. [USound handling guide, pages 2–3](https://www.usound.com/wp-content/uploads/2020/01/1910_MEMS-speakers-handling-guide.pdf)

Mundorf recommends spacing crossover coils and, where possible, orienting their axes at 90 degrees to reduce magnetic interaction. Nearby metal can also change behavior. This is advice about inductors; it supplies no universal millimetre spacing for IEM receiver packages. [Mundorf inductor installation guidance](https://www.mundorf.com/en/wikis/inductors)

Mounting requirements differ even within receiver technologies. Knowles' VEF application note describes a receiver with integrated vibration isolation and shielding that permits direct mounting. That example is a reason to consult the exact receiver's instructions, not to require an identical rubber cradle around every BA. The VEF is an illustrative example, not one of the website's 18 presets. [Knowles AN-11](https://www.knowles.com/docs/default-source/default-document-library/an-11-issue01.pdf?sfvrsn=ea9e75b1_2)

I found no basis in these sources for enforcing “tweeter body must be nearest the nozzle,” “all tubes must have equal length,” or one mandatory gap between all drivers. Treat these as possible layout choices to evaluate against the acoustic design. Electrical polarity reversal is also separate from physically rotating a receiver; the current simulation already applies polarity inversion independently.

## What the current website actually checks

The [Rust build function](../../acoustic-engine/src/workshop.rs) checks input validity, warns when a driver package exceeds the shell's axis-aligned bounding box, and warns when package bounding boxes overlap. Those warnings are conservative layout aids: overlap of rotated bounding boxes need not mean actual contact, and containment inside the outer box does not establish containment inside the shell cavity.

The function also warns about provisional package/interface dimensions, dedicated electronics and rear-vent requirements. It places tube starts at transformed outlet coordinates. **It does not check the physical conditions represented by those warnings.** Its generated parts are shell stock, driver envelopes and tubes; no finished cavity, physical damper, connector, wiring or crossover assembly is represented.

The tube validator's minimum 0.1 mm bore and 0.05 mm wall are numerical input bounds, not demonstrated printable or acoustically appropriate dimensions. The placement preset parser also does not consume the catalog's `outlet_diameter_mm` for adapter/seal validation.

I re-ran the existing [diagnostic script](../../../tests/diagnostics/audit-iem-rule-gaps.mjs) against the current shipped engine. The placement observations are saved in [probes.json](probes.json):

| Diagnostic | Current observation |
| --- | --- |
| Tube crosses an unrelated RAF package | Build accepted; 319 of 1,001 centreline samples are inside the actual box package. No specific route collision warning. |
| SR outlet connected to a narrower tube | Catalog outlet approximately 4.46 mm; requested bore 1.6 mm. Build accepted without a defined transition. This may be buildable with an adapter, but the adapter is not represented or checked. |

Engine reports **0.19.1**; current WASM SHA-256 is `817265c23f9ae5f4291af6d2d28dff76b121860334577b21e0109cbf637c2ce5`. These are synthetic diagnostic observations, not manufacturing acceptance passes. The earlier gap report used a different WASM hash; these results identify the binary rechecked for this review. The full regression suite was not rerun for this documentation-only change.

## Applicability across the 18 placement presets

This table reports the current catalog's metadata, not a fresh supplier qualification. “Package + interface flagged” means the catalog labels both as supplier-dimensioned; it does not mean all mounting, tolerance and vent information is complete. “Interface provisional” requires an exact outlet/terminal/vent drawing before physical approval. A false rear-vent flag must not be interpreted as supplier proof that sealing every surface is acceptable.

| ID | Preset | Catalog geometry status | Placement work still required |
| --- | --- | --- | --- |
| 0 | 9 mm Dynamic Reference | Planning | Select a real part; define front/rear volumes, mounting, terminals and vents. |
| 1 | 10 mm Dynamic Reference | Planning | Select a real part; define front/rear volumes, mounting, terminals and vents. |
| 2 | Knowles RAB-32257 | Interface provisional | Verify exact outlet/vent drawing; reserve the catalog-flagged rear-vent connection. |
| 3 | Knowles WBFK-23990 | Package + interface flagged | Design its outlet seal/transition, mount and terminal access. |
| 4 | Knowles TWFK-30017 | Interface provisional | Confirm the dual receiver's common interface and terminal arrangement. |
| 5 | 14.2 mm Planar Reference | Planning | Obtain the actual package; define diaphragm clearances, mounting and chambers. |
| 6 | USound Adap UT-P2019 | Package + interface flagged | Protect the membrane/backport and reserve the required drive electronics. |
| 7 | Knowles CI-22955 | Interface provisional | Verify exact variant and port geometry; resolve the catalog's rear-vent requirement. |
| 8 | Knowles RAU-34832 | Interface provisional | Confirm outlet and terminal geometry; evaluate the complete HF acoustic path. |
| 9 | Sonion 4100 | Interface provisional | Select the exact ordered variant and obtain its port, vent and terminal drawing. |
| 10 | xMEMS Cowell | Package + interface flagged | Verify device-specific mounting/air regions and reserve the required drive electronics. |
| 11 | xMEMS Muir | Package + interface flagged | Verify device-specific mounting/air regions and reserve the required drive electronics. |
| 12 | Knowles RAD-33518 | Planning | Obtain a controlled package/interface drawing before approval. |
| 13 | Knowles RAF-32873-P183 | Package + interface flagged | Include the spout, seal, mount and terminal access in collision checks. |
| 14 | Knowles ED-29689 | Interface provisional | Confirm exact variant and outlet/terminal geometry. |
| 15 | Knowles SR-32453-000 | Package + interface flagged | Represent the broad outlet and any sealed transition to the selected bore. |
| 16 | 5.0 mm Marketplace Planar Treble | Planning | Identify the supplier/part and obtain controlled package, vent and mounting data. |
| 17 | 5.7 mm Marketplace Planar Treble | Planning | Identify the supplier/part and obtain controlled package, vent and mounting data. |

Catalog source: [drivers.json](../../assets/workshop/drivers.json). All rows also need the common tube, shell, assembly and electrical packaging checks above. The three generic full-range/bass references and marketplace entries are insufficient to approve a purchased component's fit.

## What can be reused from the original desktop app

The native [ProductExperience.cpp](/Users/bearcheung/Documents/HeadphoneWorkshop/src/app/ProductExperience.cpp) contains more placement logic: package clearance, route samples checked against driver bounds, and inner-cavity checks for its generated shell. It defines these project defaults:

| Parameter | Native default |
| --- | --- |
| Rigid component clearance | 0.18 mm |
| Additional route clearance | 0.12 mm |
| Installed component wall clearance | 0.40 mm |
| Shell wall thickness | 1.30 mm |

These are implementation choices. I did not find qualification evidence establishing them as universal manufacturer or process limits. The native code's additional magnet spacing applies only to pairs it classifies as unshielded; it is not a complete magnetic-interaction assessment. Its sampled routing checks are a starting point, not proof that every curved route is clear between samples. Porting the constants alone would not complete website validation.

## Recommended implementation order

1. Add per-part interface geometry: solids, mounting regions, outlets, vents, terminals and access volumes. Store the drawing revision, dimension confidence and relevant process allowance.
2. Add finished-cavity containment, actual component/route intersections, minimum separations and route self-intersection/bend checks. Explicitly identify intended contacts, outlet bonds and acoustic junctions.
3. Add physical dampers, adapters, crossover parts, connectors and wires, linked to the acoustic/electrical project. Check vent/cavity connectivity and assembly access.
4. Recalculate affected acoustic paths when placement changes. A merged bore needs the corresponding network model. Revalidate a built revision with its specified fixture, insertion and electrical drive.

Show **error** for an established impossible placement, **warning** for a supported tuning recommendation, and **unverified** when necessary part/process data or checks are absent. A rule that has not been evaluated must not appear as a pass. Exact spacing should be configurable by part and process with recorded evidence, rather than hidden in a single global distance.
