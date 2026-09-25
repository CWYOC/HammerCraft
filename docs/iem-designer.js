(function () {
    "use strict";

    const $ = id => document.getElementById(id);
    const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const uid = () => crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random()}`;
    const snap = value => Math.round(value / 20) * 20;
    // Catalog dampers use CGS acoustic ohms. The WASM API uses Pa·s/m³ (SI).
    const ACOUSTIC_CGS_TO_SI = 1e5;

    const state = {
        products: [],
        drivers: [],
        library: [],
        databaseLibrary: [],
        databaseLibraryError: "",
        target: [],
        reverse: [],
        reverseBase: [],
        targetPeq: [],
        chart: null,
        reverseChart: null,
        reverseView: { min: 60, max: 100 },
        last: null,
        selectedCircuit: null,
        circuitClipboard: null,
        histories: new Map(),
        wireStart: null,
        wireDraft: null,
        wireRouting: "orthogonal",
        cadSymbolStandard: "iec",
        cadSnapToGrid: true,
        cadConnectPointMode: null,
        activeCircuit: null,
        calculationRevision: 0,
        reverseRevision: 0,
        importRevisions: new Map(),
    };

    const projectDefaults = {
        iemSplMode: "relative", iemNormalizeFrequency: "1000", iemNormalizeMode: "system",
        iemTemperature: "20", iemHumidity: "50", iemAcousticLoadType: "anechoic",
        iemCouplerVolume: "2000", iemLoadLossResistance: "0", iemLeakResistance: "500000000",
        iemTargetProduct: "", iemShowTarget: true, iemShowIndividual: true, iemShowCombined: true,
        iemShowValidationError: false, iemReverseMatchMode: "absolute", iemReverseNormalizeFrequency: "1000",
        iemReverseLengthMin: "3", iemReverseLengthMax: "20", iemReverseDiameterMin: "0.8", iemReverseDiameterMax: "3",
        iemReverseDampers: "330,680,1000,1500,2200", iemReverseCaps: "0,4.7,10,15,22,33,47",
        iemReverseResistors: "0,1,2.2,3.3,4.7,10", iemReverseGainRange: "8",
    };

    function esc(value) {
        return String(value ?? "").replace(/[&<>"']/g, char => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;",
        }[char]));
    }

    function createCircuit() {
        return {
            input: "in",
            output: "drv",
            ground: "gnd",
            nodes: [
                { id: "in", label: "INPUT", x: 80, y: 120 },
                { id: "drv", label: "DRIVER+", x: 750, y: 120, hidden: true },
                { id: "gnd", label: "GND", x: 750, y: 300 },
            ],
            components: [],
            filters: [],
        };
    }

    function driver() {
        return {
            id: uid(),
            name: "New Driver",
            type: "ba",
            impedance: 16,
            sensitivity: 0,
            sensitivityRef: 1000,
            responseAbsolute: false,
            gain: 0,
            polarity: 1,
            measurement: [],
            impedanceCurve: [],
            circuit: createCircuit(),
            path: [
                { type: "tube", length: 10, diameter: 2, loss: 0 },
            ],
        };
    }

    function ensureDriverShape(d) {
        if (!d || typeof d !== "object" || Array.isArray(d)) throw new Error("Invalid saved driver.");
        if (!d.id) d.id = uid();
        if (!d.name) d.name = "New Driver";
        if (!d.type) d.type = "ba";
        for (const [key, value] of Object.entries({ impedance: 16, sensitivity: 0, sensitivityRef: 1000, gain: 0, polarity: 1, responseAbsolute: false })) {
            if (d[key] === undefined || d[key] === null) d[key] = value;
        }
        if (!Array.isArray(d.measurement)) d.measurement = [];
        if (!Array.isArray(d.impedanceCurve)) d.impedanceCurve = [];
        // Migration for projects saved by the v0.6 ordered circuit editor.
        if (Array.isArray(d.circuit)) {
            const old = d.circuit;
            d.circuit = createCircuit();
            d.circuit.nodes = d.circuit.nodes.filter(node => node.id !== d.circuit.output);
            d.circuit.output = d.circuit.input;
            for (const item of old) {
                if (["peq", "high_pass", "low_pass"].includes(item.type)) {
                    d.circuit.filters.push(structuredClone(item));
                } else if (item.type.startsWith("series_")) {
                    const kind = item.type.endsWith("_r") ? "resistor" : item.type.endsWith("_c") ? "capacitor" : "inductor";
                    appendSeriesComponent(d, kind, item.value, false);
                } else if (item.type.startsWith("shunt_")) {
                    const kind = item.type.endsWith("_r") ? "resistor" : item.type.endsWith("_c") ? "capacitor" : "inductor";
                    appendShuntComponent(d, kind, item.value, false);
                }
            }
        }
        if (!d.circuit || !Array.isArray(d.circuit.nodes)) d.circuit = createCircuit();
        if (!Array.isArray(d.circuit.components)) d.circuit.components = [];
        d.circuit.components.forEach(component => {
            if (component.kind !== "wire") {
                const a = d.circuit.nodes.find(n => n.id === component.nodeA);
                const b = d.circuit.nodes.find(n => n.id === component.nodeB);
                if (!Number.isFinite(component.x)) component.x = snap(((a?.x ?? 350) + (b?.x ?? 450)) / 2);
                if (!Number.isFinite(component.y)) component.y = snap(((a?.y ?? 180) + (b?.y ?? 180)) / 2);
            }
            if (component.rotationDeg === undefined || component.rotationDeg === null || !Number.isFinite(Number(component.rotationDeg))) {
                component.rotationDeg = null;
            } else {
                component.rotationDeg = ((Math.round(Number(component.rotationDeg) / 45) * 45) % 360 + 360) % 360;
            }
        });
        if (!Array.isArray(d.circuit.filters)) d.circuit.filters = [];
        // PEQ is a target-curve authoring tool only. Never keep PEQ in the IEM tuning chain.
        d.circuit.filters = d.circuit.filters.filter(filter => filter.type !== "peq");
        if (!d.circuit.input) d.circuit.input = "in";
        if (!d.circuit.ground) d.circuit.ground = "gnd";
        if (!d.circuit.output) d.circuit.output = d.circuit.input;
        if (!Array.isArray(d.path)) d.path = [];
        if (d.databaseDriverId && d.measurement.length) {
            // Recover newly supported couplers in existing saved projects too.
            const recoveredLoad = !d.measurementReferenceLoad && referenceCouplerLoad(d.measurementReferenceCoupler);
            if (recoveredLoad) d.measurementReferenceLoad = recoveredLoad;
            const reference = referenceInfo(d);
            if (!reference.complete) d.measurementReferenceCompensation = false;
            else if (recoveredLoad || d.measurementReferenceCompensation == null) d.measurementReferenceCompensation = true;
        }
        // A measured response alone does not identify the receiver's source
        // impedance. Use an explicit finite estimate for de-embedding, anchored
        // to the reference bore once, never to an edited design/candidate bore.
        if (!d.sourceModel) d.sourceModel = d.measurementReferenceCompensation ? "estimated_resistance" : "ideal_pressure";
        if (d.sourceReferenceDiameterMm == null) {
            d.sourceReferenceDiameterMm = finitePositive(d.measurementReferencePath?.find(e => e.element_type === "tube")?.inner_diameter_mm)
                || finitePositive(d.path.find(e => e.type === "tube" || e.type === "nozzle")?.diameter) || 2;
        }
        if (d.sourceResistanceCgs == null || d.sourceModel === "estimated_resistance") {
            const area = Math.PI * (d.sourceReferenceDiameterMm * 0.001 / 2) ** 2;
            const rho = 1.2929 * 273.15 / 293.15;
            const c = 331.3 + 0.606 * 20 + 0.0124 * 50;
            d.sourceResistanceCgs = rho * c / area / ACOUSTIC_CGS_TO_SI;
        }
        return d;
    }

    function logFreq(count = 240) {
        const a = Math.log10(20);
        const b = Math.log10(20000);
        return Array.from({ length: count }, (_, index) => 10 ** (a + (b - a) * index / (count - 1)));
    }

    function interp(points, frequency, key = "db") {
        if (!points?.length) return 0;
        const sorted = points.map(p => ({ frequency: p.frequency ?? p.frequency_hz, [key]: num(p[key]) }))
            .sort((a, b) => a.frequency - b.frequency);
        if (frequency <= sorted[0].frequency) return sorted[0][key];
        if (frequency >= sorted[sorted.length - 1].frequency) return sorted[sorted.length - 1][key];
        for (let i = 0; i < sorted.length - 1; i++) {
            const left = sorted[i];
            const right = sorted[i + 1];
            if (frequency >= left.frequency && frequency <= right.frequency) {
                const ratio = (Math.log10(frequency) - Math.log10(left.frequency)) /
                    (Math.log10(right.frequency) - Math.log10(left.frequency));
                return left[key] + (right[key] - left[key]) * ratio;
            }
        }
        return 0;
    }

    // ---------------------------------------------------------------------
    // Complex helpers used by the browser fallback and phase-aware sum.
    // ---------------------------------------------------------------------

    const complex = (re, im = 0) => ({ re, im });
    const cadd = (a, b) => ({ re: a.re + b.re, im: a.im + b.im });
    const csub = (a, b) => ({ re: a.re - b.re, im: a.im - b.im });
    const cmul = (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
    function cdiv(a, b) {
        const denominator = b.re * b.re + b.im * b.im || 1e-30;
        return {
            re: (a.re * b.re + a.im * b.im) / denominator,
            im: (a.im * b.re - a.re * b.im) / denominator,
        };
    }
    const cabs = a => Math.hypot(a.re, a.im);
    const cphase = a => Math.atan2(a.im, a.re);
    const cpolar = (magnitude, phase) => ({ re: magnitude * Math.cos(phase), im: magnitude * Math.sin(phase) });

    function speed() {
        return 331.3 + 0.606 * num($("iemTemperature")?.value, 20) + 0.0124 * num($("iemHumidity")?.value, 50);
    }

    function rawDb(d, frequency) {
        if (d.measurement.length) {
            let value = interp(d.measurement, frequency);
            if (!d.responseAbsolute && d.sensitivity !== 0) {
                value = value - interp(d.measurement, d.sensitivityRef) + d.sensitivity;
            }
            return value;
        }
        return d.sensitivity || 0;
    }

    function impedanceAt(d, frequency) {
        if (!d.impedanceCurve.length) return complex(Math.max(0.01, d.impedance), 0);
        const ohm = interp(d.impedanceCurve, frequency, "ohm");
        const phase = interp(d.impedanceCurve, frequency, "phase") * Math.PI / 180;
        return cpolar(Math.max(0.001, ohm), phase);
    }

    function componentZ(component, frequency) {
        const omega = 2 * Math.PI * frequency;
        if (component.kind === "capacitor") {
            return complex(0, -1 / (omega * Math.max(1e-12, component.value * 1e-6)));
        }
        if (component.kind === "inductor") {
            return complex(0, omega * Math.max(0, component.value) * 1e-3);
        }
        if (component.kind === "wire" || component.kind === "low_pass") return complex(1e-9, 0);
        return complex(Math.max(1e-12, component.value), 0);
    }

    function solveComplexLinear(matrix, rhs) {
        const n = rhs.length;
        const a = matrix.map(row => row.map(v => ({ ...v })));
        const b = rhs.map(v => ({ ...v }));
        for (let pivot = 0; pivot < n; pivot++) {
            let best = pivot;
            let bestNorm = cabs(a[pivot][pivot]);
            for (let row = pivot + 1; row < n; row++) {
                const norm = cabs(a[row][pivot]);
                if (norm > bestNorm) {
                    bestNorm = norm;
                    best = row;
                }
            }
            if (bestNorm < 1e-18) return null;
            if (best !== pivot) {
                [a[pivot], a[best]] = [a[best], a[pivot]];
                [b[pivot], b[best]] = [b[best], b[pivot]];
            }
            const pv = a[pivot][pivot];
            for (let col = pivot; col < n; col++) a[pivot][col] = cdiv(a[pivot][col], pv);
            b[pivot] = cdiv(b[pivot], pv);
            const pivotRow = a[pivot].map(v => ({ ...v }));
            const pivotB = { ...b[pivot] };
            for (let row = 0; row < n; row++) {
                if (row === pivot) continue;
                const factor = a[row][pivot];
                if (cabs(factor) < 1e-30) continue;
                for (let col = pivot; col < n; col++) {
                    a[row][col] = csub(a[row][col], cmul(factor, pivotRow[col]));
                }
                b[row] = csub(b[row], cmul(factor, pivotB));
            }
        }
        return b;
    }

    function passiveCircuitH(d, frequency) {
        const circuit = window.HCCircuit.compile(ensureDriverShape(d).circuit).circuit;
        if (circuit.output === circuit.input) return complex(1, 0);

        const allNodes = new Set(circuit.nodes.map(n => n.id));
        allNodes.add(circuit.input);
        allNodes.add(circuit.output);
        allNodes.add(circuit.ground);
        circuit.components.forEach(c => {
            allNodes.add(c.nodeA);
            allNodes.add(c.nodeB);
        });

        const unknown = [...allNodes].filter(id => id !== circuit.input && id !== circuit.ground);
        const index = new Map(unknown.map((id, i) => [id, i]));
        const matrix = Array.from({ length: unknown.length }, () => Array.from({ length: unknown.length }, () => complex(0)));
        const rhs = Array.from({ length: unknown.length }, () => complex(0));
        const fixed = new Map([[circuit.input, complex(1)], [circuit.ground, complex(0)]]);

        function addBranch(nodeA, nodeB, y) {
            const ia = index.get(nodeA);
            const ib = index.get(nodeB);
            const va = fixed.get(nodeA);
            const vb = fixed.get(nodeB);
            if (ia !== undefined) {
                matrix[ia][ia] = cadd(matrix[ia][ia], y);
                if (ib !== undefined) matrix[ia][ib] = csub(matrix[ia][ib], y);
                else if (vb) rhs[ia] = cadd(rhs[ia], cmul(y, vb));
            }
            if (ib !== undefined) {
                matrix[ib][ib] = cadd(matrix[ib][ib], y);
                if (ia !== undefined) matrix[ib][ia] = csub(matrix[ib][ia], y);
                else if (va) rhs[ib] = cadd(rhs[ib], cmul(y, va));
            }
        }

        circuit.components.forEach(component => {
            const z = component.bypassed ? complex(1e-12) : componentZ(component, frequency);
            addBranch(component.nodeA, component.nodeB, cdiv(complex(1), z));
        });

        const driverZ = impedanceAt(d, frequency);
        addBranch(circuit.output, circuit.ground, cdiv(complex(1), driverZ));
        const solution = solveComplexLinear(matrix, rhs);
        if (!solution) return complex(0);
        const outputIndex = index.get(circuit.output);
        return outputIndex === undefined ? complex(0) : solution[outputIndex];
    }

    function shelfBiquadH(type, frequency, centerFrequency, gainDb, qValue) {
        // RBJ-style shelving biquad. The UI exposes Q for consistency with
        // common headphone target-EQ editors; Q controls the shelf transition.
        const fs = 192000;
        const f0 = clamp(Number(centerFrequency) || 1000, 1, fs * 0.49);
        const f = clamp(Number(frequency) || 1, 0, fs * 0.49);
        const A = 10 ** ((Number(gainDb) || 0) / 40);
        const q = Math.max(0.05, Number(qValue) || 0.707);
        const w0 = 2 * Math.PI * f0 / fs;
        const w = 2 * Math.PI * f / fs;
        const cos0 = Math.cos(w0);
        const sin0 = Math.sin(w0);
        const alpha = sin0 / (2 * q);
        const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;

        let b0, b1, b2, a0, a1, a2;
        if (type === "low_shelf") {
            b0 = A * ((A + 1) - (A - 1) * cos0 + twoSqrtAAlpha);
            b1 = 2 * A * ((A - 1) - (A + 1) * cos0);
            b2 = A * ((A + 1) - (A - 1) * cos0 - twoSqrtAAlpha);
            a0 = (A + 1) + (A - 1) * cos0 + twoSqrtAAlpha;
            a1 = -2 * ((A - 1) + (A + 1) * cos0);
            a2 = (A + 1) + (A - 1) * cos0 - twoSqrtAAlpha;
        } else {
            b0 = A * ((A + 1) + (A - 1) * cos0 + twoSqrtAAlpha);
            b1 = -2 * A * ((A - 1) + (A + 1) * cos0);
            b2 = A * ((A + 1) + (A - 1) * cos0 - twoSqrtAAlpha);
            a0 = (A + 1) - (A - 1) * cos0 + twoSqrtAAlpha;
            a1 = 2 * ((A - 1) - (A + 1) * cos0);
            a2 = (A + 1) - (A - 1) * cos0 - twoSqrtAAlpha;
        }

        const z1 = complex(Math.cos(-w), Math.sin(-w));
        const z2 = cmul(z1, z1);
        const numerator = cadd(cadd(complex(b0, 0), cmul(complex(b1, 0), z1)), cmul(complex(b2, 0), z2));
        const denominator = cadd(cadd(complex(a0, 0), cmul(complex(a1, 0), z1)), cmul(complex(a2, 0), z2));
        return cdiv(numerator, denominator);
    }

    function filterH(filter, frequency) {
        const omega = 2 * Math.PI * frequency;
        const s = complex(0, omega);
        const w0 = 2 * Math.PI * Math.max(1, filter.frequency || 1000);
        const q = Math.max(0.05, filter.q || 0.707);
        const s2 = cmul(s, s);
        const damping = complex(0, omega * w0 / q);
        const constant = complex(w0 * w0, 0);
        if (filter.type === "high_pass") return cdiv(s2, cadd(cadd(s2, constant), damping));
        if (filter.type === "low_pass") return cdiv(constant, cadd(cadd(s2, constant), damping));
        if (filter.type === "low_shelf" || filter.type === "high_shelf") {
            return shelfBiquadH(filter.type, frequency, filter.frequency, filter.gain || 0, filter.q);
        }
        if (filter.type === "peq") {
            // Used only by the manual target-curve PEQ editor, never by the IEM circuit chain.
            const A = 10 ** ((filter.gain || 0) / 40);
            const numerator = cadd(cadd(s2, constant), complex(0, omega * w0 * A / q));
            const denominator = cadd(cadd(s2, constant), complex(0, omega * w0 / (A * q)));
            return cdiv(numerator, denominator);
        }
        return complex(1);
    }

    function circuitH(d, frequency) {
        let result = passiveCircuitH(d, frequency);
        for (const filter of ensureDriverShape(d).circuit.filters) {
            if (filter.type !== "peq") result = cmul(result, filterH(filter, frequency));
        }
        for (const component of window.HCCircuit.compile(d.circuit).activeComponents) {
            if (component.kind === "low_pass" && !component.bypassed) {
                result = cmul(result, filterH({ type: "low_pass", frequency: component.frequency || 400, q: component.q || 0.707 }, frequency));
            }
        }
        return result;
    }

    function acousticDbPhaseForPath(path, frequency) {
        let db = 0;
        let phase = 0;
        const c = speed();
        let length = 0;
        for (const element of path || []) {
            if (element.type === "tube" || element.type === "nozzle") {
                const L = Math.max(0.1, element.length) / 1000;
                const D = Math.max(0.2, element.diameter);
                const fq = c / (4 * (L + 0.0003 * D));
                const ratio = Math.max(0.001, frequency / fq);
                db += 2 * Math.exp(-0.5 * (Math.log2(ratio) / 0.25) ** 2)
                    - 0.18 * (L * 1000 / 10) * Math.sqrt(frequency / 10000) * (2 / D);
                length += L;
            } else if (element.type === "damper") {
                db -= Math.log10(1 + Math.max(0, element.value) / 220) * 2 * Math.pow(clamp(frequency / 1000, 0, 20), 0.28);
            } else if (element.type === "chamber") {
                const fc = 9000 / Math.max(1, (element.diameter * element.diameter / 2.25) * Math.sqrt(element.length));
                db -= 10 * Math.log10(1 + (frequency / fc) ** 2);
                length += element.length / 1000;
            }
        }
        phase -= 2 * Math.PI * frequency * length / c;
        return { db, phase };
    }

    function acousticDbPhase(d, frequency) {
        const design = acousticDbPhaseForPath(d.path, frequency);
        if (!d.measurementReferenceCompensation || !d.measurementReferencePath?.length) return design;
        const refPath = d.measurementReferencePath.map(measurementReferenceToDesign).filter(Boolean);
        const reference = acousticDbPhaseForPath(refPath, frequency);
        return { db: design.db - reference.db, phase: design.phase - reference.phase };
    }

    function fallback() {
        const frequencies = logFreq();
        const per = state.drivers.map(d => frequencies.map(frequency => {
            const h = circuitH(d, frequency);
            const acoustic = acousticDbPhase(d, frequency);
            const amplitude = 10 ** ((rawDb(d, frequency) + d.gain + acoustic.db) / 20) * cabs(h);
            const measuredPhase = d.databaseDriverId ? 0 : interp(d.measurement, frequency, "phase") * Math.PI / 180;
            const phase = measuredPhase + cphase(h) + acoustic.phase + (d.polarity < 0 ? Math.PI : 0);
            return {
                frequency,
                db: 20 * Math.log10(Math.max(1e-12, amplitude)),
                phase: phase * 180 / Math.PI,
            };
        }));
        const combined = frequencies.map((frequency, index) => {
            let pressure = complex(0);
            for (const response of per) {
                const point = response[index];
                pressure = cadd(pressure, cpolar(10 ** (point.db / 20), point.phase * Math.PI / 180));
            }
            return {
                frequency,
                db: 20 * Math.log10(Math.max(1e-12, cabs(pressure))),
                phase: cphase(pressure) * 180 / Math.PI,
            };
        });
        return { drivers: per, combined };
    }

    // ---------------------------------------------------------------------
    // Rust request conversion.
    // ---------------------------------------------------------------------

    function loadObj() {
        const type = $("iemAcousticLoadType")?.value || "anechoic";
        if (type === "closed_cavity") {
            return {
                type,
                volume_mm3: num($("iemCouplerVolume")?.value, 2000),
                loss_resistance_acoustic_ohm: num($("iemLoadLossResistance")?.value),
            };
        }
        if (type === "cavity_with_leak") {
            return {
                type,
                volume_mm3: num($("iemCouplerVolume")?.value, 2000),
                leak_resistance_acoustic_ohm: num($("iemLeakResistance")?.value, 5e8),
            };
        }
        if (type === "generic_711_approx") return { type: "generic711_approx" };
        return { type };
    }

    function referenceLoadToRust(load) {
        if (!load) return null;
        if (load.type === "generic_711_approx") return { type: "generic711_approx" };
        return { ...load };
    }

    function toRustPath(element) {
        if (element.type === "tube") return { type: "tube", length_mm: element.length, diameter_mm: element.diameter, loss_factor: element.loss || 0 };
        if (element.type === "damper") return { type: "damper", resistance_acoustic_ohm: element.value * ACOUSTIC_CGS_TO_SI };
        if (element.type === "chamber") return { type: "expansion_chamber", length_mm: element.length, diameter_mm: element.diameter };
        return { type: "nozzle", length_mm: element.length, diameter_mm: element.diameter };
    }

    function finitePositive(value) {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? n : null;
    }

    function measurementReferenceToRust(element) {
        if (element.element_type === "tube") {
            const length = finitePositive(element.length_mm);
            const diameter = finitePositive(element.inner_diameter_mm);
            return length && diameter ? { type: "tube", length_mm: length, diameter_mm: diameter, loss_factor: 0 } : null;
        }
        if (element.element_type === "damper") {
            const resistance = finitePositive(element.damper_ohm);
            return resistance ? { type: "damper", resistance_acoustic_ohm: resistance * ACOUSTIC_CGS_TO_SI } : null;
        }
        if (element.element_type === "chamber") {
            const length = finitePositive(element.length_mm);
            const diameter = finitePositive(element.inner_diameter_mm);
            return length && diameter ? { type: "expansion_chamber", length_mm: length, diameter_mm: diameter } : null;
        }
        return null;
    }

    function applyMeasurementReferenceLoadToUi(d) {
        const load = d?.measurementReferenceLoad;
        const select = $("iemAcousticLoadType");
        if (!load || !select) return false;

        if (load.type === "generic_711_approx") {
            select.value = "generic_711_approx";
            select.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
        }
        if (load.type === "closed_cavity") {
            select.value = "closed_cavity";
            if ($("iemCouplerVolume") && Number.isFinite(Number(load.volume_mm3))) {
                $("iemCouplerVolume").value = Number(load.volume_mm3);
            }
            if ($("iemLoadLossResistance")) $("iemLoadLossResistance").value = num(load.loss_resistance_acoustic_ohm);
            select.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
        }
        return false;
    }

    function measurementReferenceToDesign(element) {
        const rust = measurementReferenceToRust(element);
        if (!rust) return null;
        if (rust.type === "tube") return { type: "tube", length: rust.length_mm, diameter: rust.diameter_mm, loss: 0 };
        if (rust.type === "damper") return { type: "damper", value: rust.resistance_acoustic_ohm / ACOUSTIC_CGS_TO_SI };
        if (rust.type === "expansion_chamber") return { type: "chamber", length: rust.length_mm, diameter: rust.diameter_mm };
        return null;
    }

    function referenceInfo(d) {
        const raw = d.measurementReferencePath || [];
        const modelled = raw.map(measurementReferenceToDesign).filter(Boolean);
        const couplerModelled = Boolean(d.measurementReferenceLoad);
        const unsupported = raw.filter(e => e.element_type !== "coupler" && !measurementReferenceToDesign(e));
        // A coupler record is not evidence of a zero-length reference adapter.
        const hasGeometry = modelled.some(e => ["tube", "chamber", "nozzle"].includes(e.type));
        const complete = couplerModelled && hasGeometry && unsupported.length === 0;
        const partial = (couplerModelled || modelled.length) && !complete;
        return { raw, modelled, unsupported, couplerModelled, hasGeometry, complete, status: complete ? "APPROXIMATE" : partial ? "INCOMPLETE" : "UNAVAILABLE" };
    }

    function databaseReferenceError(d) {
        if (!d.databaseDriverId || !d.measurement?.length) return "";
        const info = referenceInfo(d);
        if (info.unsupported.length) return `Reference adapter geometry is missing or unsupported (${info.unsupported.map(e => e.description || e.element_type).join(", ")}).`;
        if (!info.hasGeometry) return "Reference tube/adapter dimensions are missing; a coupler name alone is insufficient.";
        if (!info.couplerModelled) return "The measurement coupler has no supported load approximation.";
        if (!d.measurementReferenceCompensation) return "Measurement-reference compensation is disabled.";
        return "";
    }

    function referenceSummaryHtml(d) {
        if (!d.databaseDriverId) return "";
        const info = referenceInfo(d);
        const parts = info.modelled.map(e => e.type === "tube" ? `Tube ${e.length} mm × ${e.diameter} mm ID` : e.type === "damper" ? `Damper ${e.value} CGS acoustic Ω` : `Chamber ${e.length} mm × ${e.diameter} mm`);
        const unknown = info.unsupported.map(e => e.description || e.element_type).filter(Boolean);
        return `<div class="iem-reference-panel"><div><span class="eyebrow">MEASUREMENT REFERENCE</span> <strong>${esc(d.measurementReferenceCoupler || "Coupler not specified")}</strong></div><div class="iem-field-note">${parts.length ? esc(parts.join(" · ")) : "No modelled tube/damper geometry"}${unknown.length ? ` · Unmodelled: ${esc(unknown.join(", "))}` : ""}</div><div class="iem-reference-actions"><span class="iem-engine-badge">CORRECTION ${info.status}</span>${info.complete ? `<button class="outline-button" type="button" data-use-reference-path="${d.id}">CHECK REFERENCE UNITY</button>` : ""}</div><div class="iem-field-note" data-reference-validation-readout="${d.id}">FR pipeline: manufacturer magnitude baseline + modelled electrical/acoustic delta. Manufacturer phase unavailable where not supplied; model phase is used. A unity pass checks arithmetic consistency only.${d.referenceValidationMode ? (() => { const vi = state.drivers.indexOf(d); const v = state.last?.validation?.[vi]; return ` · REFERENCE UNITY CHECK: matched geometry tests cancellation, not prediction accuracy.${v ? ` · UNITY ${v.pass ? "PASS" : "FAIL"} over measured FR span ${Math.round(v.minFrequencyHz)}–${Math.round(v.maxFrequencyHz)} Hz · max error ${v.maxAbsDb.toFixed(3)} dB @ ${Math.round(v.maxErrorFrequencyHz)} Hz · RMS ${v.rmsDb.toFixed(3)} dB · ${v.sampleCount} samples` : " · Press CALCULATE to run measured-span unity check."}`; })() : ""}</div></div>`;
    }

    function toRustFilter(filter) {
        if (filter.type === "high_pass") return { type: "high_pass", frequency_hz: filter.frequency, q: filter.q };
        if (filter.type === "low_pass") return { type: "low_pass", frequency_hz: filter.frequency, q: filter.q };
        return null;
    }

    function toRustNetlist(d, compiled = window.HCCircuit.compile(ensureDriverShape(d).circuit)) {
        const circuit = compiled.circuit;
        return {
            input_node: circuit.input,
            output_node: circuit.output,
            ground_node: circuit.ground,
            nodes: circuit.nodes.map(node => ({ id: node.id, label: node.label || node.id })),
            components: circuit.components.map(component => ({
                id: component.id,
                label: component.label || component.id,
                node_a: component.nodeA,
                node_b: component.nodeB,
                bypassed: Boolean(component.bypassed),
                kind: component.kind === "resistor"
                    ? { type: "resistor", resistance_ohm: component.value }
                    : component.kind === "capacitor"
                        ? { type: "capacitor", capacitance_uf: component.value }
                        : component.kind === "inductor"
                            ? { type: "inductor", inductance_mh: component.value }
                            : component.kind === "low_pass"
                                ? { type: "wire" }
                                : { type: "wire" },
            })),
        };
    }

    function rustRequest(frequencies = logFreq(), includeMeasuredBaseline = false) {
        return {
            frequencies_hz: frequencies,
            environment: {
                temperature_c: num($("iemTemperature")?.value, 20),
                relative_humidity_percent: num($("iemHumidity")?.value, 50),
            },
            acoustic_load: loadObj(),
            drivers: state.drivers.map(raw => {
                const d = ensureDriverShape(raw);
                const compiled = window.HCCircuit.compile(d.circuit);
                const hasDatabaseBaseline = Boolean(d.databaseDriverId && d.measurement.length);
                const measurement = d.measurement.length ? d.measurement : [{ frequency: d.sensitivityRef, db: d.sensitivity, phase: 0 }];
                return {
                    id: d.id,
                    name: d.name,
                    driver_type: ({ dd: "dynamic", ba: "balanced_armature", planar: "planar", magnetostatic: "magnetostatic", bc: "bone_conduction" }[d.type] || "other"),
                    nominal_impedance_ohm: d.impedance,
                    sensitivity_db: hasDatabaseBaseline ? 0 : d.sensitivity,
                    sensitivity_reference_hz: d.sensitivityRef,
                    response_absolute_spl: hasDatabaseBaseline ? includeMeasuredBaseline : d.responseAbsolute,
                    gain_db: hasDatabaseBaseline && !includeMeasuredBaseline ? 0 : d.gain,
                    polarity_inverted: d.polarity < 0,
                    response: hasDatabaseBaseline && !includeMeasuredBaseline
                        ? []
                        : measurement.map(p => ({
                            frequency_hz: p.frequency,
                            db: hasDatabaseBaseline ? rawDb(d, p.frequency) : p.db,
                            // Match the forward pipeline: database measurements supply magnitude only.
                            phase_deg: hasDatabaseBaseline ? 0 : p.phase || 0,
                        })),
                    impedance: d.impedanceCurve.map(p => ({ frequency_hz: p.frequency, magnitude_ohm: p.ohm, phase_deg: p.phase || 0 })),
                    electrical: [
                        ...d.circuit.filters.map(toRustFilter).filter(Boolean),
                        ...compiled.activeComponents.filter(component => component.kind === "low_pass" && !component.bypassed).map(component => ({ type: "low_pass", frequency_hz: component.frequency || 400, q: component.q || 0.707 }))
                    ],
                    circuit_netlist: toRustNetlist(d, compiled),
                    acoustic_path: d.path.map(toRustPath),
                    measurement_reference_path: d.measurementReferenceCompensation
                        ? (d.measurementReferencePath || []).map(measurementReferenceToRust).filter(Boolean)
                        : [],
                    measurement_reference_load: d.measurementReferenceCompensation
                        ? referenceLoadToRust(d.measurementReferenceLoad)
                        : null,
                    acoustic_source: d.sourceModel === "ideal_pressure" ? { type: "ideal_pressure" } : {
                        // Fixed physical R in both paths, using the existing R+M
                        // source with M=0. Characteristic would change R whenever
                        // the design bore differs from the reference bore.
                        type: "outlet_inertance", outlet_diameter_mm: d.sourceReferenceDiameterMm,
                        effective_length_mm: 0, resistance_acoustic_ohm: d.sourceResistanceCgs * ACOUSTIC_CGS_TO_SI,
                    },
                };
            }),
        };
    }

    function physicalInputErrors() {
        const errors = [];
        const numeric = value => value !== "" && value !== null && value !== undefined && Number.isFinite(Number(value));
        const positive = value => numeric(value) && Number(value) > 0;
        const nonnegative = value => numeric(value) && Number(value) >= 0;
        if (!state.drivers.length) errors.push("Add a driver path before calculating.");
        if (!numeric($("iemTemperature").value) || Number($("iemTemperature").value) <= -273.15) errors.push("Enter a valid temperature above absolute zero.");
        if (!nonnegative($("iemHumidity").value) || Number($("iemHumidity").value) > 100) errors.push("Humidity must be between 0 and 100%.");
        const loadType = $("iemAcousticLoadType").value;
        if (["closed_cavity", "cavity_with_leak"].includes(loadType) && !positive($("iemCouplerVolume").value)) errors.push("Coupler volume must be greater than zero.");
        if (loadType === "closed_cavity" && !nonnegative($("iemLoadLossResistance").value)) errors.push("Load resistance must be non-negative.");
        if (loadType === "cavity_with_leak" && !positive($("iemLeakResistance").value)) errors.push("Leak resistance must be greater than zero.");
        for (const d of state.drivers) {
            ensureDriverShape(d);
            const referenceError = databaseReferenceError(d);
            if (referenceError) errors.push(`${d.name}: acoustic prediction unavailable. ${referenceError} Add verified measurement-fixture data to the driver reference before simulating.`);
            if (!["ideal_pressure", "estimated_resistance", "custom_resistance"].includes(d.sourceModel)) errors.push(`${d.name}: select a valid source model.`);
            if (d.sourceModel !== "ideal_pressure" && !positive(d.sourceResistanceCgs)) errors.push(`${d.name}: source resistance must be greater than zero.`);
            if (!positive(d.sourceReferenceDiameterMm)) errors.push(`${d.name}: source reference bore must be greater than zero.`);
            if (!positive(d.impedance)) errors.push(`${d.name}: impedance must be greater than zero.`);
            if (!positive(d.sensitivityRef)) errors.push(`${d.name}: sensitivity reference frequency must be greater than zero.`);
            if (!numeric(d.sensitivity) || !numeric(d.gain)) errors.push(`${d.name}: sensitivity and gain must be finite numbers.`);
            for (const [i, element] of d.path.entries()) {
                const label = `${d.name}: ${element.type} ${i + 1}`;
                if (element.type === "damper") {
                    if (!nonnegative(element.value)) errors.push(`${label} resistance must be non-negative.`);
                } else {
                    if (!positive(element.length)) errors.push(`${label} length must be greater than zero.`);
                    if (!positive(element.diameter)) errors.push(`${label} diameter must be greater than zero.`);
                    if (!nonnegative(element.loss ?? 0)) errors.push(`${label} loss must be non-negative.`);
                }
            }
            const filters = [...d.circuit.filters, ...d.circuit.components.filter(c => c.kind === "low_pass" && !c.bypassed)];
            for (const filter of filters) {
                const frequency = filter.frequency ?? (filter.kind === "low_pass" ? 400 : undefined);
                if (!positive(frequency) || Number(frequency) >= 96000 || !positive(filter.q ?? 0.707)) {
                    errors.push(`${d.name}: filters need a positive Q and a cutoff between 0 and 96,000 Hz.`);
                }
            }
        }
        return errors;
    }

    async function calculate() {
        syncAll();
        const revision = ++state.calculationRevision;
        const circuitErrors = state.drivers.flatMap(d =>
            window.HCCircuit.compile(ensureDriverShape(d).circuit).errors.map(message => `${d.name}: ${message}`));
        const inputErrors = physicalInputErrors();
        if (circuitErrors.length || inputErrors.length) {
            state.last = null;
            state.chart?.destroy(); state.chart = null;
            state.validationChart?.destroy(); state.validationChart = null;
            updateValidationPanel(null);
            $("iemEngineStatus").textContent = inputErrors.length ? "CHECK INPUTS" : "CHECK CIRCUIT";
            $("iemSimulationMessage").textContent = [...inputErrors, ...circuitErrors].join(" ");
            updateReferenceValidationReadouts();
            metrics();
            return;
        }
        let result;
        try {
            if (window.HCAcousticEngine) {
                const rust = await window.HCAcousticEngine.simulate(rustRequest());
                if (revision !== state.calculationRevision) return;
                const rustDrivers = rust.drivers.map(item => item.points.map(p => ({
                    frequency: p.frequency_hz,
                    db: p.db,
                    phase: p.phase_deg,
                })));

                // Database FR is the measured manufacturer baseline. Rust
                // returns the electrical/acoustic DESIGN DELTA for database
                // drivers; compose it explicitly here so the measured curve
                // can never be replaced by a flat transfer-function trace.
                const composedDrivers = rustDrivers.map((response, index) => {
                    const d = state.drivers[index];
                    if (!d?.databaseDriverId || !d.measurement?.length) return response;
                    return response.map(point => ({
                        frequency: point.frequency,
                        db: rawDb(d, point.frequency) + point.db + num(d.gain),
                        // Manufacturer phase is currently unavailable for the
                        // digitised datasets, so model phase is retained.
                        phase: point.phase,
                    }));
                });

                // Re-sum the composed driver pressures. The combined curve
                // must use the same baseline-aware responses shown as the
                // individual traces.
                const combined = (composedDrivers[0] || []).map((_, pointIndex) => {
                    let pressure = complex(0);
                    for (const response of composedDrivers) {
                        const point = response[pointIndex];
                        if (!point) continue;
                        pressure = cadd(pressure, cpolar(
                            10 ** (point.db / 20),
                            num(point.phase) * Math.PI / 180
                        ));
                    }
                    return {
                        frequency: composedDrivers[0][pointIndex].frequency,
                        db: 20 * Math.log10(Math.max(1e-12, cabs(pressure))),
                        phase: cphase(pressure) * 180 / Math.PI,
                    };
                });

                const validation = composedDrivers.map((response, index) => {
                    const d=state.drivers[index];
                    if(!d?.databaseDriverId||!d.referenceValidationMode||!d.measurement?.length)return null;
                    const measured=d.measurement.filter(p=>Number.isFinite(p.frequency)&&Number.isFinite(p.db)).sort((a,b)=>a.frequency-b.frequency);
                    if(measured.length<2)return null;
                    const lo=measured[0].frequency, hi=measured[measured.length-1].frequency;
                    const errorCurve=response.filter(p=>Number.isFinite(p.frequency)&&Number.isFinite(p.db)&&p.frequency>=lo&&p.frequency<=hi).map(p=>{
                        const baselineDb=interp(measured,p.frequency)+num(d.gain);
                        return{frequency:p.frequency,errorDb:p.db-baselineDb,predictedDb:p.db,baselineDb};
                    }).filter(p=>Number.isFinite(p.errorDb));
                    if(!errorCurve.length)return null;
                    let worst=errorCurve[0];
                    for(const p of errorCurve)if(Math.abs(p.errorDb)>Math.abs(worst.errorDb))worst=p;
                    const maxAbsDb=Math.abs(worst.errorDb);
                    const rmsDb=Math.sqrt(errorCurve.reduce((sum,p)=>sum+p.errorDb*p.errorDb,0)/errorCurve.length);
                    return{maxAbsDb,rmsDb,maxErrorFrequencyHz:worst.frequency,sampleCount:errorCurve.length,
                        minFrequencyHz:lo,maxFrequencyHz:hi,errorCurve,pass:maxAbsDb<=0.05};
                });

                result = { drivers: composedDrivers, combined, validation };
                const activeValidation = validation.filter(Boolean);
                const validationText = activeValidation.length
                    ? (() => {
                        const worst = activeValidation.reduce((a, b) => a.maxAbsDb >= b.maxAbsDb ? a : b);
                        return ` · UNITY ${activeValidation.every(v => v.pass) ? "PASS" : "FAIL"} · max ${worst.maxAbsDb.toFixed(3)} dB @ ${Math.round(worst.maxErrorFrequencyHz)} Hz`;
                    })()
                    : "";
                const version = await window.HCAcousticEngine.version();
                if (revision !== state.calculationRevision) return;
                $("iemEngineStatus").textContent = `${version} · BASELINE + MODEL DELTA${validationText}`;
                const statusText = activeValidation.length
                    ? (() => {
                        const worst = activeValidation.reduce((a, b) => a.maxAbsDb >= b.maxAbsDb ? a : b);
                        return `Reference unity check: ${activeValidation.every(v => v.pass) ? "PASS" : "FAIL"} · max ${worst.maxAbsDb.toFixed(3)} dB @ ${Math.round(worst.maxErrorFrequencyHz)} Hz · RMS ${worst.rmsDb.toFixed(3)} dB · ${worst.sampleCount} samples · ${Math.round(worst.minFrequencyHz)}–${Math.round(worst.maxFrequencyHz)} Hz`;
                    })()
                    : "Simulation complete.";
                if ($("iemSimulationMessage")) $("iemSimulationMessage").textContent = statusText;
                $("iemEngineStatus").title = statusText;
            } else {
                throw new Error("WASM unavailable");
            }
        } catch (error) {
            if (revision !== state.calculationRevision) return;
            console.warn("Rust engine unavailable, using JS fallback", error);
            result = fallback();
            $("iemEngineStatus").textContent = "JS FALLBACK";
            if ($("iemSimulationMessage")) {
                $("iemSimulationMessage").textContent = `WASM calculation error: ${error?.message || error}. Using approximate JS fallback; output-load effects and reference validation are unavailable.`;
            }
        }
        if (revision !== state.calculationRevision) return;
        state.last = result;

        // Do not call renderDrivers() here: it replaces the Calculate button
        // and other DOM nodes after their handlers were attached. Update the
        // validation readout in place instead.
        updateReferenceValidationReadouts();
        draw();
        metrics();
    }

    // ---------------------------------------------------------------------
    // Display graph and normalization.
    // ---------------------------------------------------------------------

    function displaySeries(series, kind = "driver") {
        if ($("iemSplMode")?.value === "absolute") return series;
        const frequency = clamp(num($("iemNormalizeFrequency")?.value, 1000), 20, 20000);
        const mode = $("iemNormalizeMode")?.value || "system";
        let offset;

        // Individual-driver traces must be stable when another driver is
        // added/removed. In relative view they are therefore normalized to
        // their own response. "System" normalization belongs to the combined
        // trace only.
        if (kind === "driver" || mode === "each" || kind === "target") {
            offset = interp(series, frequency);
        } else {
            offset = state.last?.combined?.length
                ? interp(state.last.combined, frequency)
                : interp(series, frequency);
        }
        return series.map(point => ({ ...point, db: point.db - offset }));
    }

    function updateValidationPanel(v){
        const panel=$("iemValidationPanel"),wrap=$("iemValidationErrorWrap"); if(!panel)return;
        if(!v){panel.hidden=true;if(wrap)wrap.hidden=true;return}
        panel.hidden=false;panel.dataset.result=v.pass?"pass":"fail";
        $("iemValidationResult").textContent=v.pass?"✓ PASS":"✕ FAIL";
        $("iemValidationMax").textContent=`${v.maxAbsDb.toFixed(3)} dB`;
        $("iemValidationRms").textContent=`${v.rmsDb.toFixed(3)} dB`;
        $("iemValidationFrequency").textContent=`${Math.round(v.maxErrorFrequencyHz)} Hz`;
        $("iemValidationRange").textContent=`${Math.round(v.minFrequencyHz)}–${Math.round(v.maxFrequencyHz)} Hz`;
        if(wrap)wrap.hidden=!$("iemShowValidationError")?.checked;
    }
    function drawValidationError(v){
        const c=$("iemValidationErrorChart");if(!c||!window.Chart)return;
        if(state.validationChart){state.validationChart.destroy();state.validationChart=null}
        if(!v||!$("iemShowValidationError")?.checked)return;
        const peak=Math.max(.05,...v.errorCurve.map(p=>Math.abs(p.errorDb)));
        const lim=Math.max(.1,Math.ceil(peak*10)/10);
        state.validationChart=new Chart(c,{type:"line",data:{datasets:[
            {label:"Validation error",data:v.errorCurve.map(p=>({x:p.frequency,y:p.errorDb})),pointRadius:0,borderWidth:2},
            {label:"0 dB ideal",data:[{x:v.minFrequencyHz,y:0},{x:v.maxFrequencyHz,y:0}],pointRadius:0,borderWidth:1,borderDash:[5,5]}
        ]},options:{animation:false,responsive:true,maintainAspectRatio:false,parsing:false,
            scales:{x:{type:"logarithmic",min:v.minFrequencyHz,max:v.maxFrequencyHz,title:{display:true,text:"Frequency (Hz)"}},
            y:{min:-lim,max:lim,title:{display:true,text:"Error (dB)"}}}}});
    }

    function draw() {
        updateModelNotes();
        if (!state.last || !window.Chart) return;
        const datasets = [];
        if ($("iemShowIndividual")?.checked) {
            state.last.drivers.forEach((response, index) => {
                const d = state.drivers[index];
                datasets.push({
                    label: d?.name || `Driver ${index + 1}`,
                    data: displaySeries(response, "driver").map(point => ({ x: point.frequency, y: point.db })),
                    pointRadius: 0,
                    borderWidth: 1.5,
                });

                if (d?.databaseDriverId && d.measurement?.length > 1) {
                    const baseline = d.measurement.map(point => ({
                        frequency: point.frequency,
                        db: point.db,
                        phase: point.phase || 0,
                    }));
                    datasets.push({
                        label: `${d.name} · Datasheet baseline`,
                        data: displaySeries(baseline, "driver").map(point => ({ x: point.frequency, y: point.db })),
                        pointRadius: 0,
                        borderWidth: 1.25,
                        borderDash: [6, 5],
                    });
                }
            });
        }
        if ($("iemShowCombined")?.checked) {
            datasets.push({
                label: "Combined",
                data: displaySeries(state.last.combined, "combined").map(point => ({ x: point.frequency, y: point.db })),
                pointRadius: 0,
                borderWidth: 3,
            });
        }
        if ($("iemShowTarget")?.checked && state.target.length > 1) {
            datasets.push({
                label: "Target",
                data: displaySeries(state.target, "target").map(point => ({ x: point.frequency, y: point.db })),
                pointRadius: 0,
                borderWidth: 2,
                borderDash: [7, 6],
            });
        }
        state.chart?.destroy();
        // Validation measures the physical response, independently of graph
        // normalization, trace visibility, and driver names.
        const validations = (state.last.validation || []).filter((v, index) =>
            v && state.drivers[index]?.referenceValidationMode);
        const visibleValidation = validations.length
            ? validations.reduce((worst, v) => v.maxAbsDb > worst.maxAbsDb ? v : worst)
            : null;
        updateValidationPanel(visibleValidation);
        drawValidationError(visibleValidation);

        state.chart = new Chart($("iemResponseChart"), {
            type: "line",
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                parsing: false,
                scales: {
                    x: { type: "logarithmic", min: 20, max: 20000, title: { display: true, text: "Frequency (Hz)" } },
                    y: { suggestedMin: $("iemSplMode")?.value === "absolute" ? undefined : -30, suggestedMax: $("iemSplMode")?.value === "absolute" ? undefined : 15, title: { display: true, text: $("iemSplMode")?.value === "absolute" ? "SPL (dB)" : "Relative SPL (dB)" } },
                },
                plugins: { legend: { position: "bottom" } },
            },
        });
    }

    function metrics() {
        const c = speed();
        let resonance = 0;
        let delay = 0;
        let volume = 0;
        for (const d of state.drivers) {
            let pathLength = 0;
            for (const element of d.path) {
                if (["tube", "nozzle", "chamber"].includes(element.type)) {
                    pathLength += element.length / 1000;
                    volume += Math.PI * (element.diameter / 2) ** 2 * element.length;
                }
            }
            // Geometric estimates only: serial sections add to the travel
            // distance. Their individual lengths are not separate full paths.
            if (pathLength > 0) {
                const f = c / (4 * pathLength);
                if (!resonance || f < resonance) resonance = f;
                delay = Math.max(delay, pathLength / c * 1000);
            }
        }
        $("iemPrimaryResonance").textContent = resonance ? `${(resonance / 1000).toFixed(2)} kHz` : "—";
        $("iemTubeDelay").textContent = `${delay.toFixed(3)} ms`;
        $("iemTubeVolume").textContent = `${volume.toFixed(1)} mm³`;

        let crossover = "—";
        if (state.last?.drivers.length > 1) {
            let best = Infinity;
            let bestFrequency = 0;
            for (let i = 0; i < state.last.combined.length; i++) {
                const difference = Math.abs(state.last.drivers[0][i].db - state.last.drivers[1][i].db);
                if (difference < best) {
                    best = difference;
                    bestFrequency = state.last.combined[i].frequency;
                }
            }
            if (bestFrequency) crossover = bestFrequency >= 1000 ? `${(bestFrequency / 1000).toFixed(2)} kHz` : `${Math.round(bestFrequency)} Hz`;
        }
        $("iemEstimatedCrossover").textContent = crossover;

        if (state.target.length > 1 && state.last?.combined.length) {
            const normFrequency = clamp(num($("iemNormalizeFrequency")?.value, 1000), 20, 20000);
            const actualNorm = interp(state.last.combined, normFrequency);
            const targetNorm = interp(state.target, normFrequency);
            let sum = 0;
            let count = 0;
            for (const p of state.last.combined) {
                const error = (p.db - actualNorm) - (interp(state.target, p.frequency) - targetNorm);
                sum += error * error;
                count++;
            }
            $("iemTargetRmse").textContent = count ? `${Math.sqrt(sum / count).toFixed(2)} dB` : "—";
        } else {
            $("iemTargetRmse").textContent = "—";
        }
    }

    // ---------------------------------------------------------------------
    // Driver cards.
    // ---------------------------------------------------------------------

    function updateModelNotes() {
        const notes = [];
        if (state.drivers.some(d => d.sourceModel === "estimated_resistance")) notes.push("Acoustic prediction uses an estimated source resistance, not a measured receiver model. Tube changes remain approximate.");
        if (state.drivers.some(d => d.sourceModel === "ideal_pressure")) notes.push("Ideal-pressure source selected: zero source impedance can exaggerate tube/coupler resonances.");
        if (state.drivers.some(d => d.sourceModel === "custom_resistance")) notes.push("Custom source resistance is frequency-independent; it does not describe the receiver's full acoustic impedance.");
        if (loadObj().type === "generic711_approx" || state.drivers.some(d => d.measurementReferenceCompensation && referenceLoadToRust(d.measurementReferenceLoad)?.type === "generic711_approx")) notes.push("Simplified 711: main tube and microphone only; damping side cavities are missing. This is not a validated IEC 711 coupler, especially for treble predictions.");
        if (state.drivers.some(d => d.measurementReferenceCompensation && d.measurementReferenceLoad?.type === "closed_cavity")) notes.push("The reference cavity uses a volume-only approximation; microphone and adapter resonances are not calibrated.");
        if (state.drivers.some(d => d.measurementReferenceCompensation && JSON.stringify(referenceLoadToRust(d.measurementReferenceLoad)) !== JSON.stringify(loadObj()))) notes.push("Output load differs from the measurement reference: the curve includes a change of test fixture as well as your acoustic path.");
        const node = $("iemModelNotes");
        if (node) { node.textContent = notes.join(" "); node.hidden = !notes.length; }
    }

    function updateReferenceValidationReadouts() {
        state.drivers.forEach((d, index) => {
            const node = document.querySelector(`[data-reference-validation-readout="${d.id}"]`);
            if (!node) return;
            const base = "FR pipeline: manufacturer magnitude baseline + modelled electrical/acoustic delta. Manufacturer phase unavailable where not supplied; model phase is used. A unity pass checks arithmetic consistency only.";
            if (!d.referenceValidationMode) {
                node.textContent = base;
                return;
            }
            const v = state.last?.validation?.[index];
            node.textContent = v
                ? `${base} · REFERENCE UNITY CHECK: matched geometry tests cancellation, not prediction accuracy. · UNITY ${v.pass ? "PASS" : "FAIL"} over measured FR span ${Math.round(v.minFrequencyHz)}–${Math.round(v.maxFrequencyHz)} Hz · max error ${v.maxAbsDb.toFixed(3)} dB @ ${Math.round(v.maxErrorFrequencyHz)} Hz · RMS ${v.rmsDb.toFixed(3)} dB · ${v.sampleCount} samples`
                : `${base} · REFERENCE UNITY CHECK: matched geometry tests cancellation, not prediction accuracy. · Press CALCULATE to run measured-span unity check.`;
        });
    }

    function renderDrivers() {
        const root = $("iemDriverPaths");
        root.innerHTML = state.drivers.map((raw, index) => {
            const d = ensureDriverShape(raw);
            window.HCCircuit.makeEditable(d.circuit);
            return `
                <article class="iem-driver-card" data-driver-id="${d.id}">
                    <div class="iem-driver-card-head">
                        <div>
                            <span class="eyebrow">DRIVER PATH ${index + 1}</span>
                            <h3>${esc(d.name)}</h3>
                        </div>
                        <div class="iem-driver-card-actions">
                            <button class="outline-button" data-save-driver="${d.id}">SAVE TO LIBRARY</button>
                            <button class="danger-button" data-delete-driver="${d.id}">REMOVE</button>
                        </div>
                    </div>
                    <section class="iem-driver-section">
                        <div class="iem-driver-grid">
                            <label>NAME<input data-f="name" value="${esc(d.name)}"></label>
                            <label>TYPE<select data-f="type">${["dd", "ba", "planar", "magnetostatic", "bc", "other"].map(type => `<option ${d.type === type ? "selected" : ""} value="${type}">${type.toUpperCase()}</option>`).join("")}</select></label>
                            <label>IMPEDANCE Ω<input data-f="impedance" type="number" value="${d.impedance}" step="0.1"></label>
                            <label>GAIN dB<input data-f="gain" type="number" value="${d.gain}" step="0.1"></label>
                            <label>POLARITY<select data-f="polarity"><option value="1" ${d.polarity > 0 ? "selected" : ""}>Normal</option><option value="-1" ${d.polarity < 0 ? "selected" : ""}>Inverted</option></select></label>
                            <label>SENSITIVITY dB SPL<input data-f="sensitivity" type="number" value="${d.sensitivity}" step="0.1"></label>
                            <label>SENSITIVITY REF Hz<input data-f="sensitivityRef" type="number" value="${d.sensitivityRef}"></label>
                            <label>FR DATA TYPE<select data-f="responseAbsolute"><option value="relative" ${!d.responseAbsolute ? "selected" : ""}>Relative</option><option value="absolute" ${d.responseAbsolute ? "selected" : ""}>Absolute SPL</option></select></label>
                        </div>
                        <div class="iem-driver-grid" style="margin-top:12px">
                            <label>FR / PHASE FILE<input type="file" data-fr-file="${d.id}" accept=".txt,.csv,.frd"></label>
                            <label>IMPEDANCE FILE<input type="file" data-z-file="${d.id}" accept=".txt,.csv,.zma"></label>
                        </div>
                        <div class="iem-file-status">FR: ${d.measurement.length} points · Z: ${d.impedanceCurve.length} points</div>
                    </section>
                    ${circuitHtml(d)}
                    ${pathHtml(d)}
                </article>`;
        }).join("");
        bindDriverEvents();
        state.drivers.forEach(d => renderCircuitSvg(d));
    }

    // ---------------------------------------------------------------------
    // VituixCAD-style schematic editor.
    // ---------------------------------------------------------------------

    function circuitHtml(d) {
        const check = window.HCCircuit.compile(d.circuit);
        const selected = state.selectedCircuit?.driverId === d.id && d.circuit.components.find(c => c.id === state.selectedCircuit.componentId);
        return `
            <section class="iem-driver-section iem-cad-section">
                <div class="iem-panel-title">
                    <div><span class="eyebrow">CIRCUIT CAD</span><h3>Passive crossover schematic.</h3></div>
                    <div class="iem-cad-history">
                        <label class="iem-cad-standard">
                            <span>SYMBOL STANDARD</span>
                            <select data-cad-symbol-standard>
                                <option value="iec" ${state.cadSymbolStandard === "iec" ? "selected" : ""}>IEC</option>
                                <option value="ansi" ${state.cadSymbolStandard === "ansi" ? "selected" : ""}>ANSI</option>
                            </select>
                        </label>
                        <button class="iem-mini" data-circuit-undo="${d.id}">UNDO</button>
                        <button class="iem-mini" data-circuit-redo="${d.id}">REDO</button>
                        <button class="iem-mini" data-circuit-auto="${d.id}">AUTO ARRANGE</button>
                        <label class="iem-cad-snap-toggle" title="Snap dragged schematic objects to the 20 px grid">
                            <input type="checkbox" data-cad-snap-toggle ${state.cadSnapToGrid ? "checked" : ""}>
                            <span>SNAP GRID</span>
                        </label>
                        <button class="iem-mini" data-circuit-properties="${d.id}" type="button" ${selected ? "" : "disabled"}>PROPERTIES</button>
                        <button class="iem-mini" data-circuit-duplicate="${d.id}" type="button" ${selected && selected.kind !== "wire" ? "" : "disabled"}>DUPLICATE</button>
                        <button class="iem-mini" data-circuit-delete="${d.id}" type="button" ${selected ? "" : "disabled"}>DELETE</button>
                    </div>
                </div>
                <div class="iem-cad-workspace">
                    <aside class="iem-cad-palette">
                        <span class="iem-palette-title">COMPONENTS</span>
                        ${paletteButton(d.id, "resistor", "RESISTOR")}
                        ${paletteButton(d.id, "capacitor", "CAPACITOR")}
                        ${paletteButton(d.id, "inductor", "INDUCTOR")}
                        <button class="iem-cad-tool iem-connect-point-tool ${state.cadConnectPointMode === d.id ? "active" : ""}" data-add-connect-point="${d.id}" type="button"><strong>●</strong><span>CONNECT POINT</span></button>
                        <button class="iem-cad-tool iem-wire-tool" data-wire-mode="${d.id}" type="button"><strong>⌁</strong><span>WIRE</span></button>
                        <label class="iem-cad-route-mode"><span>ROUTING</span><select data-wire-routing><option value="orthogonal" ${state.wireRouting === "orthogonal" ? "selected" : ""}>90°</option><option value="45" ${state.wireRouting === "45" ? "selected" : ""}>45°</option><option value="free" ${state.wireRouting === "free" ? "selected" : ""}>FREE</option></select></label>
                    </aside>
                    <div class="iem-cad-canvas-wrap">
                        <div class="iem-cad-status ${check.errors.length ? 'needs-attention' : ''}" role="status">${esc([...check.errors, ...check.warnings].join(" ") || "Circuit connected. Ready to calculate.")}</div>
                        <svg class="iem-cad-canvas" id="cad-${d.id}" data-cad-driver="${d.id}" viewBox="0 0 900 360" tabindex="0" aria-label="Circuit schematic"></svg>
                        <div class="iem-cad-help">Drag parts to move · Click terminals to wire; click the grid for bends · Crossed wires connect only at a junction · CONNECT POINT on a wire creates a branch · Esc cancels · Shift disables snapping · Double-click a part for properties · Driver − shares GND.</div>
                    </div>
                </div>
                <div class="iem-filter-editor">
                    <div class="iem-filter-head">
                        <div><span class="eyebrow">RESPONSE FILTERS</span><strong>High / Low Pass</strong></div>
                        <div class="iem-filter-actions">
                            <button class="iem-mini" data-add-filter="${d.id}:high_pass">+ HIGH PASS</button>
                            <button class="iem-mini" data-add-filter="${d.id}:low_pass">+ LOW PASS</button>
                        </div>
                    </div>
                    <div class="iem-filter-order-wrap"><span class="eyebrow">SIGNAL ORDER</span>${filterOrderHtml(d)}</div><div class="iem-filter-list">${d.circuit.filters.map((filter, i) => filterNode(d, filter, i)).join("") || '<div class="iem-field-note">No response filters. These ideal filters affect the response; use R, L and C parts for a physical crossover.</div>'}</div>
                </div>
            </section>`;
    }

    function paletteButton(driverId, type, label) {
        return `<button class="iem-cad-tool" draggable="true" data-cad-palette="${driverId}:${type}" type="button"><span class="iem-cad-tool-symbol">${paletteSymbolSvg(type)}</span><span>${label}</span></button>`;
    }

    function paletteSymbolSvg(type) {
        const kind = type.replace("shunt_", "");
        const shunt = type.startsWith("shunt_");
        let symbol = "";
        if (kind === "resistor") {
            symbol = state.cadSymbolStandard === "ansi"
                ? '<path d="M3 15 H7 L9 9 L13 21 L17 9 L21 21 L23 15 H27"/>'
                : '<path d="M3 15 H8 M22 15 H27"/><rect x="8" y="10" width="14" height="10"/>' ;
        } else if (kind === "capacitor") {
            symbol = '<path d="M3 15 H12 M18 15 H27 M12 7 V23 M18 7 V23"/>';
        } else if (kind === "inductor") {
            symbol = '<path d="M3 15 H7 C7 9 11 9 11 15 C11 9 15 9 15 15 C15 9 19 9 19 15 C19 9 23 9 23 15 H27"/>';
        } else if (kind === "low_pass") {
            symbol = '<path d="M2 15 H6 M24 15 H28"/><rect x="6" y="7" width="18" height="16" rx="2"/><text x="15" y="18" text-anchor="middle" font-size="7">LP</text>';
        } else {
            symbol = '<path d="M3 15 H27"/>';
        }
        const branch = shunt ? '<path d="M15 23 V28 M10 28 H20"/>' : '';
        return `<svg viewBox="0 0 30 30" aria-hidden="true">${symbol}${branch}</svg>`;
    }

    function componentSymbolSvg(component) {
        const bypass = component.bypassed ? '<path class="iem-cad-bypass-line" d="M-48 0 H48"/>' : '';
        if (component.kind === "wire") {
            return '<path class="iem-cad-symbol" d="M-48 0 H48"/>';
        }
        if (component.kind === "resistor") {
            const body = state.cadSymbolStandard === "ansi"
                ? '<path class="iem-cad-symbol" d="M-48 0 H-30 L-24 -11 L-14 11 L-4 -11 L6 11 L16 -11 L26 11 L32 0 H48"/>'
                : '<path class="iem-cad-symbol" d="M-48 0 H-25 M25 0 H48"/><rect class="iem-cad-symbol" x="-25" y="-10" width="50" height="20"/>' ;
            return body + bypass;
        }
        if (component.kind === "capacitor") {
            return '<path class="iem-cad-symbol" d="M-48 0 H-9 M9 0 H48 M-9 -18 V18 M9 -18 V18"/>' + bypass;
        }
        if (component.kind === "inductor") {
            return '<path class="iem-cad-symbol" d="M-48 0 H-28 C-28 -14 -16 -14 -16 0 C-16 -14 -4 -14 -4 0 C-4 -14 8 -14 8 0 C8 -14 20 -14 20 0 C20 -14 32 -14 32 0 H48"/>' + bypass;
        }
        if (component.kind === "low_pass") {
            return '<path class="iem-cad-symbol" d="M-48 0 H-30 M30 0 H48"/><rect class="iem-cad-symbol" x="-30" y="-16" width="60" height="32" rx="4"/><text class="iem-cad-filter-label" text-anchor="middle" y="5">LP</text>' + bypass;
        }
        return '<path class="iem-cad-symbol" d="M-48 0 H48"/>' + bypass;
    }

    function groundSymbolSvg(x, y) {
        return `<g class="iem-cad-ground-symbol" transform="translate(${x},${y})">
            <path d="M0 -12 V0 M-18 0 H18 M-12 6 H12 M-6 12 H6"/>
        </g>`;
    }

    function driverSymbolSvg(d, x, y) {
        return `<g class="iem-cad-driver-symbol" transform="translate(${x},${y})">
            <circle r="30"/>
            <path d="M-12 -16 V16 M-12 -13 L12 -23 V23 L-12 13"/>
            <text text-anchor="middle" y="46">${esc(d.name)}</text>
        </g>`;
    }

    function filterNode(d, filter, index) {
        const label = filter.type === "peq" ? "PEQ" : filter.type === "high_pass" ? "HIGH PASS" : "LOW PASS";
        const details = filter.type === "peq"
            ? `${Number(filter.frequency).toLocaleString()} Hz · ${Number(filter.gain).toFixed(1)} dB · Q ${Number(filter.q).toFixed(3)}`
            : `${Number(filter.frequency).toLocaleString()} Hz · Q ${Number(filter.q).toFixed(3)}`;
        return `
            <div class="iem-filter-node" draggable="true" data-filter-node="${d.id}:${index}" data-filter-drag="${d.id}:${index}">
                <div><strong>${label}</strong><span>${details}</span></div>
                <div class="iem-filter-node-actions">
                    <button class="iem-mini" data-filter-earlier="${d.id}:${index}" type="button">← EARLIER</button>
                    <button class="iem-mini" data-filter-later="${d.id}:${index}" type="button">LATER →</button>
                    <button class="iem-mini" data-filter-properties="${d.id}:${index}" type="button">PROPERTIES</button>
                    <button class="iem-mini" data-remove-filter="${d.id}:${index}" type="button">REMOVE</button>
                </div>
            </div>`;
    }

    function filterOrderHtml(d) {
        if (!d.circuit.filters.length) return '<div class="iem-field-note">No response filters. Add a high-pass or low-pass filter here.</div>';
        return `<div class="iem-order-strip" data-filter-order="${d.id}">
            <span class="iem-order-fixed">INPUT</span>
            ${d.circuit.filters.map((filter, index) => {
                const name = filter.type === "peq" ? "PEQ" : filter.type === "high_pass" ? "HP" : "LP";
                return `<button class="iem-order-chip" draggable="true" data-filter-chip="${d.id}:${index}" type="button"><strong>${name}${index + 1}</strong><span>${Number(filter.frequency).toLocaleString()} Hz</span></button><span class="iem-order-arrow">→</span>`;
            }).join("")}
            <span class="iem-order-fixed">DRIVER</span>
        </div>`;
    }

    function openFilterPropertyPage(d, index) {
        const filter = d?.circuit?.filters?.[index];
        const modal = $("iemCadPropertyModal");
        const body = $("iemCadPropertyBody");
        if (!filter || !modal || !body) return;
        const label = filter.type === "peq" ? "Peaking EQ" : filter.type === "high_pass" ? "High-Pass Filter" : "Low-Pass Filter";
        body.innerHTML = `
            <div class="iem-property-hero">
                <div class="iem-property-symbol iem-property-filter-symbol"><strong>${filter.type === "peq" ? "PEQ" : filter.type === "high_pass" ? "HP" : "LP"}</strong></div>
                <div><span class="eyebrow">FILTER PROPERTY</span><h2>${label}</h2><p>Edit the filter here. Changes are staged until Apply Changes is pressed.</p></div>
            </div>
            <div class="iem-property-grid">
                <section class="iem-property-section"><span class="eyebrow">FILTER</span>
                    <label>TYPE<select data-filter-property="type"><option value="high_pass" ${filter.type === "high_pass" ? "selected" : ""}>High Pass</option><option value="low_pass" ${filter.type === "low_pass" ? "selected" : ""}>Low Pass</option></select></label>
                    <label>CUTOFF / CENTRE FREQUENCY Hz<input data-filter-property="frequency" type="number" min="1" step="1" value="${filter.frequency}"></label>
                    <label class="filter-gain-property" ${filter.type === "peq" ? "" : "hidden"}>GAIN dB<input data-filter-property="gain" type="number" step="0.1" value="${filter.gain || 0}"></label>
                    <label>Q<input data-filter-property="q" type="number" min="0.05" step="0.01" value="${filter.q || 0.707}"></label>
                </section>
                <section class="iem-property-section"><span class="eyebrow">POSITION</span>
                    <p class="iem-property-note">Reorder the filter without deleting and rebuilding it.</p>
                    <div class="iem-property-position">Position <strong>${index + 1}</strong> of <strong>${d.circuit.filters.length}</strong></div>
                </section>
                <section class="iem-property-section"><span class="eyebrow">BEHAVIOUR</span><div class="iem-property-calculated"><p>${filter.type === "low_pass" ? "Attenuates frequencies above the selected cutoff." : filter.type === "high_pass" ? "Attenuates frequencies below the selected cutoff." : "Boosts or cuts around the centre frequency."}</p><div><span>Current order</span><strong>${index + 1}</strong></div></div></section>
            </div>`;
        const typeSelect = body.querySelector('[data-filter-property="type"]');
        const gainLabel = body.querySelector('.filter-gain-property');
        typeSelect?.addEventListener('change', () => { if (gainLabel) gainLabel.hidden = typeSelect.value !== 'peq'; });
        body.querySelectorAll('[data-property-filter-move]').forEach(button => button.onclick = () => {
            const direction = Number(button.dataset.propertyFilterMove);
            const next = clamp(index + direction, 0, d.circuit.filters.length - 1);
            if (next === index) return;
            mutateCircuit(d, () => move(d.circuit.filters, index, direction));
            closeCircuitPropertyPage();
            renderDrivers();
            calculate();
        });
        modal.dataset.mode = "filter";
        modal.dataset.driverId = d.id;
        modal.dataset.filterIndex = String(index);
        delete modal.dataset.componentId;
        modal.hidden = false;
        document.body.classList.add("iem-property-open");
    }

    function nodeById(d, id) {
        return d.circuit.nodes.find(node => node.id === id);
    }

    function componentLabel(component) {
        if (component.kind === "wire") return component.label || "WIRE";
        if (component.kind === "low_pass") return `${component.label || component.id}  ${Number(component.frequency || 400).toLocaleString()} Hz · Q ${Number(component.q || 0.707).toFixed(3)}`;
        const unit = component.kind === "resistor" ? "Ω" : component.kind === "capacitor" ? "µF" : "mH";
        return `${component.label || component.id}  ${Number(component.value).toLocaleString()} ${unit}`;
    }

    function normalizeRotation45(value) {
        return ((Math.round(num(value, 0) / 45) * 45) % 360 + 360) % 360;
    }

    function componentAutoAngle(d, component) {
        const a = nodeById(d, component.nodeA);
        const b = nodeById(d, component.nodeB);
        if (!a || !b) return 0;
        return Math.abs(b.y - a.y) > Math.abs(b.x - a.x) ? 90 : 0;
    }

    function componentDisplayAngle(d, component) {
        return component.rotationDeg === null || component.rotationDeg === undefined
            ? componentAutoAngle(d, component)
            : normalizeRotation45(component.rotationDeg);
    }

    function rotationHandleSvg(d, component, angle) {
        if (component.kind === "wire") return "";
        return `
            <g class="iem-cad-rotation-handle" data-cad-rotate="${d.id}:${component.id}" aria-label="Rotate component in 45 degree steps">
                <path class="iem-cad-rotation-stem" d="M0 -34 V-58"/>
                <circle class="iem-cad-rotation-circle" cx="0" cy="-67" r="10"/>
                <path class="iem-cad-rotation-arrow" d="M-4 -71 A7 7 0 1 1 4 -63 M4 -63 L0 -63 M4 -63 L4 -67"/>
                <text class="iem-cad-rotation-text" text-anchor="middle" y="-84">${angle}°</text>
            </g>`;
    }

    function rotateComponentBy(d, componentId, delta) {
        const component = d?.circuit?.components?.find(item => item.id === componentId);
        if (!component || component.kind === "wire") return;
        mutateCircuit(d, () => {
            const base = component.rotationDeg === null || component.rotationDeg === undefined
                ? componentAutoAngle(d, component)
                : component.rotationDeg;
            component.rotationDeg = normalizeRotation45(base + delta);
        });
        state.selectedCircuit = { driverId: d.id, componentId };
        renderDrivers();
    }

    function cadTerminalPoint(d, endpoint, fallbackNodeId) {
        if (endpoint?.componentId) {
            const component = d.circuit.components.find(c => c.id === endpoint.componentId);
            if (component && component.kind !== "wire") {
                const angle = componentDisplayAngle(d, component) * Math.PI / 180;
                const sign = endpoint.side === "a" ? -1 : 1;
                return {
                    x: num(component.x, 450) + sign * 48 * Math.cos(angle),
                    y: num(component.y, 180) + sign * 48 * Math.sin(angle),
                };
            }
        }
        if (endpoint?.driverTerminal) {
            return endpoint.driverTerminal === "plus" ? { x: 762, y: 120 } : { x: 800, y: 158 };
        }
        const node = nodeById(d, endpoint?.nodeId || fallbackNodeId);
        return node ? { x: node.x, y: node.y } : null;
    }

    function terminalConnectionCount(d, componentId, side) {
        const component = d.circuit.components.find(c => c.id === componentId);
        const node = component?.[side === "a" ? "nodeA" : "nodeB"];
        if (!node) return 0;
        return Number([d.circuit.input, d.circuit.output, d.circuit.ground].includes(node)) +
            d.circuit.components.filter(c => c.id !== componentId && (c.nodeA === node || c.nodeB === node)).length;
    }

    function driverTerminalConnectionCount(d, side) {
        const node = side === "plus" ? d.circuit.output : d.circuit.ground;
        return Number(node === d.circuit.input || side === "minus") +
            d.circuit.components.filter(c => c.nodeA === node || c.nodeB === node).length;
    }

    function wireGeometry(d, wire) {
        const start = cadTerminalPoint(d, wire.endpointA, wire.nodeA);
        const end = cadTerminalPoint(d, wire.endpointB, wire.nodeB);
        return start && end ? window.HCCircuit.wirePoints(start, end, wire) : [];
    }

    function closestWireSegment(points, p) {
        let best = { index: 1, point: p, distance: Infinity };
        for (let i = 1; i < points.length; i++) {
            const a = points[i - 1], b = points[i];
            const dx = b.x - a.x, dy = b.y - a.y;
            const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
            const projected = { x: a.x + t * dx, y: a.y + t * dy };
            const distance = Math.hypot(p.x - projected.x, p.y - projected.y);
            if (distance < best.distance) best = { index: i, point: projected, distance };
        }
        return best;
    }

    function legacyConnectionSvg(d) {
        // Old projects and generated crossovers connect pins by shared node ID.
        // Show those connections explicitly without changing their saved graph.
        const circuit = d.circuit;
        const lines = [];
        for (const component of circuit.components.filter(c => c.kind !== "wire")) {
            for (const side of ["a", "b"]) {
                const nodeId = component[side === "a" ? "nodeA" : "nodeB"];
                const node = nodeById(d, nodeId);
                if (!node) continue;
                const shared = circuit.components.some(c => c.id !== component.id && (
                    (c.nodeA === nodeId && (c.kind !== "wire" || !c.endpointA?.componentId)) ||
                    (c.nodeB === nodeId && (c.kind !== "wire" || !c.endpointB?.componentId))));
                if (!shared && ![circuit.input, circuit.output, circuit.ground].includes(nodeId)) continue;
                const pin = cadTerminalPoint(d, { componentId: component.id, side });
                const anchor = nodeId === circuit.output && nodeId !== circuit.input ? { x: 762, y: 120 } : node;
                const points = window.HCCircuit.wirePoints(pin, anchor, { routing: "orthogonal" });
                lines.push(`<path class="iem-cad-wire legacy-lead" d="${points.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ")}"/>`);
                if (shared && ![circuit.input, circuit.output, circuit.ground].includes(nodeId)) {
                    lines.push(`<circle class="iem-cad-junction-dot" cx="${anchor.x}" cy="${anchor.y}" r="4"/>`);
                }
            }
        }
        return lines.join("");
    }

    function renderCircuitSvg(d) {
        const svg = $(`cad-${d.id}`);
        if (!svg) return;
        const circuit = d.circuit;
        const driverNode = nodeById(d, circuit.output) || nodeById(d, circuit.input);
        const lines = [];
        const components = [];
        const nodes = [];

        lines.push(`<defs><pattern id="grid-${d.id}" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(23,23,23,.07)" stroke-width="1"/></pattern></defs>`);
        lines.push(`<rect class="iem-cad-background" width="900" height="360" fill="url(#grid-${d.id})"/>`);
        lines.push(`<g data-legacy-connections="${d.id}">${legacyConnectionSvg(d)}</g>`);

        for (const component of circuit.components) {
            const a = nodeById(d, component.nodeA);
            const b = nodeById(d, component.nodeB);
            if (!a || !b) continue;

            if (component.kind === "wire") {
                const startPoint = cadTerminalPoint(d, component.endpointA, component.nodeA) || a;
                const endPoint = cadTerminalPoint(d, component.endpointB, component.nodeB) || b;
                const pts = window.HCCircuit.wirePoints(startPoint, endPoint, component);
                const dPath = pts.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ");
                const selected = state.selectedCircuit?.driverId === d.id && state.selectedCircuit.componentId === component.id;
                // Wide transparent hit path fixes the old hard-to-click line behaviour.
                lines.push(`<path class="iem-cad-wire-hit" data-cad-wire="${d.id}:${component.id}" d="${dPath}"/>`);
                lines.push(`<path class="iem-cad-wire user-wire ${selected ? "selected" : ""}" data-cad-wire-visual="${d.id}:${component.id}" d="${dPath}"/>`);
                (component.route || []).forEach((p, i) => nodes.push(`<circle class="iem-wire-bend ${selected ? "selected" : ""}" data-wire-bend="${d.id}:${component.id}:${i}" cx="${p.x}" cy="${p.y}" r="6"/>`));
                continue;
            }

            const x = Number.isFinite(component.x) ? component.x : snap((a.x + b.x) / 2);
            const y = Number.isFinite(component.y) ? component.y : snap((a.y + b.y) / 2);
            const selected = state.selectedCircuit?.driverId === d.id && state.selectedCircuit.componentId === component.id;
            const angle = componentDisplayAngle(d, component);
            const rad = angle * Math.PI / 180;
            const tx1 = x - 48 * Math.cos(rad);
            const ty1 = y - 48 * Math.sin(rad);
            const tx2 = x + 48 * Math.cos(rad);
            const ty2 = y + 48 * Math.sin(rad);

            components.push(`
                <g class="iem-cad-component ${selected ? "selected" : ""} ${component.bypassed ? "bypassed" : ""}" data-cad-component="${d.id}:${component.id}" transform="translate(${x},${y})">
                    <rect class="iem-cad-component-hit" x="-38" y="-38" width="76" height="78"/>
                    <g class="iem-cad-symbol-rotator" transform="rotate(${angle})">${componentSymbolSvg(component)}<circle class="iem-cad-component-terminal ${terminalConnectionCount(d, component.id, "a") ? "connected" : ""}" data-cad-terminal="${d.id}:${component.id}:a" cx="-48" cy="0" r="7"/><circle class="iem-cad-component-terminal ${terminalConnectionCount(d, component.id, "b") ? "connected" : ""}" data-cad-terminal="${d.id}:${component.id}:b" cx="48" cy="0" r="7"/></g>
                    ${rotationHandleSvg(d, component, angle)}
                    <text class="ref" text-anchor="middle" y="-25">${esc(component.label || component.id)}</text>
                    <text class="value" text-anchor="middle" y="31">${esc(componentLabel(component).replace(component.label || component.id, "").trim())}</text>
                </g>`);
        }

        for (const node of circuit.nodes) {
            if (node.hidden && node.id !== circuit.input && node.id !== circuit.ground) continue;
            if (node.id === circuit.output && node.id !== circuit.input && !node.connectPoint) continue;
            const special = node.id === circuit.input ? "input" : node.id === circuit.ground ? "ground" : node.id === circuit.output ? "output" : "";
            const wireActive = state.wireStart?.driverId === d.id && state.wireStart.nodeId === node.id;
            if (node.id === circuit.ground) {
                nodes.push(`
                    <g class="iem-cad-node ground ${wireActive ? "wire-active" : ""}" data-cad-node="${d.id}:${node.id}" transform="translate(${node.x},${node.y})">
                        ${groundSymbolSvg(0, 12)}
                        <circle cx="0" cy="0" r="5"/>
                        <text x="0" y="-25" text-anchor="middle">${esc(node.label || node.id)}</text>
                    </g>`);
            } else if (node.id === circuit.input) {
                nodes.push(`
                    <g class="iem-cad-node input ${wireActive ? "wire-active" : ""}" data-cad-node="${d.id}:${node.id}" transform="translate(${node.x},${node.y})">
                        <circle r="7" class="terminal"/>
                        <text text-anchor="middle" y="-14">${esc(node.label || node.id)}</text>
                    </g>`);
            } else {
                nodes.push(`
                    <g class="iem-cad-node ${special} ${wireActive ? "wire-active" : ""}" data-cad-node="${d.id}:${node.id}" transform="translate(${node.x},${node.y})">
                        <circle r="5"/>
                        <text text-anchor="middle" y="-14">${esc(node.label || node.id)}</text>
                    </g>`);
            }
        }

        if (driverNode) {
            const driverX = 800;
            const driverY = 120;
            const ground = nodeById(d, circuit.ground);
            if (ground) lines.push(`<path class="iem-cad-wire fixed-return" d="M800 158 V${ground.y} H${ground.x}"/>`);
            if (circuit.output === circuit.input) lines.push(`<path class="iem-cad-wire" d="M${driverNode.x} ${driverNode.y} H762 V120"/>`);
            components.push(`<g data-cad-driver-symbol="${d.id}">${driverSymbolSvg(d, driverX, driverY)}<circle class="iem-cad-component-terminal ${driverTerminalConnectionCount(d, "plus") ? "connected" : ""}" data-cad-driver-terminal="${d.id}:plus" cx="${driverX - 38}" cy="${driverY}" r="7"/><circle class="iem-cad-component-terminal connected" data-cad-driver-terminal="${d.id}:minus" cx="${driverX}" cy="${driverY + 38}" r="7"/></g>`);
        }

        if (state.wireDraft?.driverId === d.id && state.wireDraft.points?.length) {
            const fixed = state.wireDraft.points;
            const preview = state.wireDraft.cursor ? [...fixed, state.wireDraft.cursor] : fixed;
            const dPath = preview.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ");
            lines.push(`<path class="iem-cad-wire wire-preview" data-wire-preview="${d.id}" d="${dPath}"/>`);
        }

        svg.innerHTML = lines.join("") + components.join("") + nodes.join("");
        bindCadSvg(d, svg);
    }

    function bindCadSvg(d, svg) {
        const point = event => {
            // Respect viewBox letterboxing and page zoom, not just the SVG box.
            const cursor = svg.createSVGPoint();
            cursor.x = event.clientX; cursor.y = event.clientY;
            const local = cursor.matrixTransform(svg.getScreenCTM().inverse());
            const shouldSnap = state.cadSnapToGrid && !event.shiftKey;
            return {
                x: clamp(shouldSnap ? snap(local.x) : local.x, 20, 880),
                y: clamp(shouldSnap ? snap(local.y) : local.y, 20, 340),
            };
        };

        const setSelection = componentId => {
            state.activeCircuit = d.id;
            svg.focus();
            state.selectedCircuit = { driverId: d.id, componentId };
            const selected = d.circuit.components.find(c => c.id === componentId);
            document.querySelector(`[data-circuit-properties="${d.id}"]`).disabled = !selected;
            document.querySelector(`[data-circuit-delete="${d.id}"]`).disabled = !selected;
            document.querySelector(`[data-circuit-duplicate="${d.id}"]`).disabled = !selected || selected.kind === "wire";
            svg.querySelectorAll("[data-cad-component]").forEach(el => {
                const [, id] = el.dataset.cadComponent.split(":");
                el.classList.toggle("selected", id === componentId);
            });
            svg.querySelectorAll("[data-cad-wire-visual]").forEach(el => {
                const [, id] = el.dataset.cadWireVisual.split(":");
                el.classList.toggle("selected", id === componentId);
            });
            svg.querySelectorAll("[data-wire-bend]").forEach(el => {
                const [, id] = el.dataset.wireBend.split(":");
                el.classList.toggle("selected", id === componentId);
            });
        };

        const updateGeometry = () => {
            const legacy = svg.querySelector(`[data-legacy-connections="${d.id}"]`);
            if (legacy) legacy.innerHTML = legacyConnectionSvg(d);
            for (const component of d.circuit.components) {
                const a = nodeById(d, component.nodeA);
                const b = nodeById(d, component.nodeB);
                if (!a || !b) continue;
                if (component.kind === "wire") {
                    const startPoint = cadTerminalPoint(d, component.endpointA, component.nodeA) || a;
                    const endPoint = cadTerminalPoint(d, component.endpointB, component.nodeB) || b;
                    const pts = window.HCCircuit.wirePoints(startPoint, endPoint, component);
                    const path = pts.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ");
                    svg.querySelector(`[data-cad-wire="${d.id}:${component.id}"]`)?.setAttribute("d", path);
                    svg.querySelector(`[data-cad-wire-visual="${d.id}:${component.id}"]`)?.setAttribute("d", path);
                    (component.route || []).forEach((p, i) => {
                        const bend = svg.querySelector(`[data-wire-bend="${d.id}:${component.id}:${i}"]`);
                        if (bend) { bend.setAttribute("cx", p.x); bend.setAttribute("cy", p.y); }
                    });
                    continue;
                }
                const x = Number(component.x);
                const y = Number(component.y);
                const angle = componentDisplayAngle(d, component);
                const rad = angle * Math.PI / 180;
                const tx1 = x - 48 * Math.cos(rad);
                const ty1 = y - 48 * Math.sin(rad);
                const tx2 = x + 48 * Math.cos(rad);
                const ty2 = y + 48 * Math.sin(rad);
                svg.querySelector(`[data-cad-component="${d.id}:${component.id}"]`)?.setAttribute("transform", `translate(${x},${y})`);
                svg.querySelector(`[data-cad-lead="${d.id}:${component.id}"]`)?.setAttribute("d", `M ${a.x} ${a.y} L ${tx1} ${ty1} M ${tx2} ${ty2} L ${b.x} ${b.y}`);
            }

            for (const node of d.circuit.nodes) {
                svg.querySelector(`[data-cad-node="${d.id}:${node.id}"]`)?.setAttribute("transform", `translate(${node.x},${node.y})`);
            }

            const ground = nodeById(d, d.circuit.ground);
            if (ground) svg.querySelector(".fixed-return")?.setAttribute("d", `M800 158 V${ground.y} H${ground.x}`);
        };

        const commitDrag = before => {
            if (JSON.stringify(d.circuit) === before) return;
            const history = historyFor(d);
            history.undo.push(before);
            if (history.undo.length > 50) history.undo.shift();
            history.redo = [];
        };

        svg.querySelectorAll("[data-cad-component]").forEach(group => {
            group.onpointerdown = event => {
                if (event.button !== 0 || event.target.closest?.("[data-cad-rotate]")) return;
                event.preventDefault();
                event.stopPropagation();
                const [, componentId] = group.dataset.cadComponent.split(":");
                const component = d.circuit.components.find(c => c.id === componentId);
                if (!component) return;
                setSelection(componentId);

                const startPoint = point(event);
                const before = JSON.stringify(d.circuit);
                const offsetX = num(component.x) - startPoint.x;
                const offsetY = num(component.y) - startPoint.y;
                let moved = false;
                const move = ev => {
                    ev.preventDefault();
                    const p = point(ev);
                    if (!moved && Math.hypot(p.x - startPoint.x, p.y - startPoint.y) < 3) return;
                    moved = true;
                    component.x = clamp(p.x + offsetX, 60, 740);
                    component.y = clamp(p.y + offsetY, 40, 300);
                    if (state.cadSnapToGrid && !ev.shiftKey) {
                        component.x = snap(component.x);
                        component.y = snap(component.y);
                    }
                    updateGeometry();
                };

                const up = () => {
                    window.removeEventListener("pointermove", move);
                    window.removeEventListener("pointerup", up);
                    window.removeEventListener("pointercancel", up);
                    if (moved) {
                        commitDrag(before);
                        renderCircuitSvg(d);
                    }
                };

                window.addEventListener("pointermove", move, { passive: false });
                window.addEventListener("pointerup", up, { once: true });
                window.addEventListener("pointercancel", up, { once: true });
            };
            group.ondblclick = event => {
                event.preventDefault();
                event.stopPropagation();
                const [, componentId] = group.dataset.cadComponent.split(":");
                setSelection(componentId);
                openCircuitPropertyPage(d, componentId);
            };
        });

        svg.querySelectorAll("[data-cad-rotate]").forEach(handle => {
            handle.onpointerdown = event => {
                event.preventDefault();
                event.stopPropagation();
            };
            handle.onclick = event => {
                event.preventDefault();
                event.stopPropagation();
                const [, componentId] = handle.dataset.cadRotate.split(":");
                rotateComponentBy(d, componentId, 45);
                calculate();
            };
        });

        const endpointFromElement = el => {
            const componentTerminal = el?.closest?.("[data-cad-terminal]");
            if (componentTerminal) {
                const [, componentId, side] = componentTerminal.dataset.cadTerminal.split(":");
                const component = d.circuit.components.find(c => c.id === componentId);
                if (!component) return null;
                const nodeId = side === "a" ? component.nodeA : component.nodeB;
                return { endpoint: { componentId, side, nodeId }, point: cadTerminalPoint(d, { componentId, side, nodeId }, nodeId) };
            }
            const driverTerminal = el?.closest?.("[data-cad-driver-terminal]");
            if (driverTerminal) {
                const [, side] = driverTerminal.dataset.cadDriverTerminal.split(":");
                const nodeId = side === "plus" ? d.circuit.output : d.circuit.ground;
                return { endpoint: { nodeId, driverTerminal: side }, point: side === "plus" ? { x: 762, y: 120 } : { x: 800, y: 158 } };
            }
            const nodeEl = el?.closest?.("[data-cad-node]");
            if (nodeEl) {
                const [, nodeId] = nodeEl.dataset.cadNode.split(":");
                const node = nodeById(d, nodeId);
                if (node) return { endpoint: { nodeId }, point: { x: node.x, y: node.y } };
            }
            return null;
        };

        // Terminal clicks define connectivity; grid clicks only shape the route.
        const handleEndpointClick = (event, info) => {
            if (event.button !== 0 || !info) return;
            state.activeCircuit = d.id;
            state.cadConnectPointMode = null;
            event.preventDefault();
            event.stopPropagation();

            if (!state.wireStart || state.wireStart.driverId !== d.id) {
                state.wireStart = { driverId: d.id, nodeId: info.endpoint.nodeId, endpoint: info.endpoint };
                state.wireDraft = { driverId: d.id, startNode: info.endpoint.nodeId, points: [info.point], cursor: info.point };
                renderCircuitSvg(d);
                return;
            }

            const first = state.wireStart.endpoint || {};
            const sameTerminal =
                first.componentId === info.endpoint.componentId &&
                first.side === info.endpoint.side &&
                first.driverTerminal === info.endpoint.driverTerminal &&
                first.nodeId === info.endpoint.nodeId;
            if (sameTerminal) {
                cancelWireMode(d);
                return;
            }

            finishWireEndpoint(d, info.endpoint, info.point);
        };

        svg.querySelectorAll("[data-cad-terminal]").forEach(terminal => {
            terminal.onpointerdown = event => handleEndpointClick(event, endpointFromElement(terminal));
        });

        svg.querySelectorAll("[data-cad-driver-terminal]").forEach(terminal => {
            terminal.onpointerdown = event => handleEndpointClick(event, endpointFromElement(terminal));
        });

        svg.querySelectorAll("[data-cad-node]").forEach(group => {
            group.onpointerdown = event => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                state.activeCircuit = d.id;
                svg.focus();
                const [, nodeId] = group.dataset.cadNode.split(":");
                const node = nodeById(d, nodeId);
                if (!node) return;
                if (state.wireStart?.driverId === d.id) {
                    finishWireEndpoint(d, { nodeId }, { x: node.x, y: node.y });
                    return;
                }
                const start = point(event);
                const before = JSON.stringify(d.circuit);
                const offsetX = node.x - start.x;
                const offsetY = node.y - start.y;
                let moved = false;
                const move = ev => {
                    ev.preventDefault();
                    const p = point(ev);
                    if (!moved && Math.hypot(p.x - start.x, p.y - start.y) < 3) return;
                    moved = true;
                    node.x = clamp(p.x + offsetX, 20, 880);
                    node.y = clamp(p.y + offsetY, 20, 340);
                    if (state.cadSnapToGrid && !ev.shiftKey) {
                        node.x = snap(node.x);
                        node.y = snap(node.y);
                    }
                    updateGeometry();
                };
                const up = () => {
                    window.removeEventListener("pointermove", move);
                    window.removeEventListener("pointerup", up);
                    window.removeEventListener("pointercancel", up);
                    if (moved) {
                        commitDrag(before);
                        renderCircuitSvg(d);
                    } else {
                        handleEndpointClick(event, { endpoint: { nodeId }, point: { x: node.x, y: node.y } });
                    }
                };
                window.addEventListener("pointermove", move, { passive: false });
                window.addEventListener("pointerup", up, { once: true });
                window.addEventListener("pointercancel", up, { once: true });
            };
        });

        svg.querySelectorAll("[data-cad-wire]").forEach(path => {
            path.onpointerdown = event => {
                event.preventDefault();
                event.stopPropagation();
                const [, componentId] = path.dataset.cadWire.split(":");
                if (state.cadConnectPointMode === d.id) {
                    const wire = d.circuit.components.find(c => c.id === componentId);
                    const points = wireGeometry(d, wire);
                    mutateCircuit(d, () => window.HCCircuit.splitWire(d.circuit, componentId, points, point(event)));
                    state.cadConnectPointMode = null;
                    renderDrivers();
                } else {
                    setSelection(componentId);
                }
            };
            path.ondblclick = event => {
                event.preventDefault(); event.stopPropagation();
                const [, componentId] = path.dataset.cadWire.split(":");
                const wire = d.circuit.components.find(c => c.id === componentId && c.kind === "wire");
                if (!wire) return;
                const before = JSON.stringify(d.circuit);
                const p = point(event);
                const points = wireGeometry(d, wire);
                const nearest = closestWireSegment(points, p);
                // Insert into the nearest segment, preserving the path order.
                wire.route = [...points.slice(1, nearest.index), nearest.point, ...points.slice(nearest.index, -1)];
                wire.routing = state.wireRouting;
                commitDrag(before);
                setSelection(componentId);
                renderCircuitSvg(d);
            };
        });

        svg.querySelectorAll("[data-wire-bend]").forEach(handle => {
            handle.onpointerdown = event => {
                event.preventDefault();
                event.stopPropagation();
                const [, componentId, indexText] = handle.dataset.wireBend.split(":");
                const component = d.circuit.components.find(c => c.id === componentId);
                const index = Number(indexText);
                if (!component?.route?.[index]) return;
                const before = JSON.stringify(d.circuit);
                const move = ev => {
                    ev.preventDefault();
                    component.route[index] = point(ev);
                    if (state.cadSnapToGrid && !ev.shiftKey) {
                        component.route[index].x = snap(component.route[index].x);
                        component.route[index].y = snap(component.route[index].y);
                    }
                    updateGeometry();
                };
                const up = () => {
                    window.removeEventListener("pointermove", move);
                    window.removeEventListener("pointerup", up);
                    window.removeEventListener("pointercancel", up);
                    commitDrag(before);
                    renderCircuitSvg(d);
                };
                window.addEventListener("pointermove", move, { passive: false });
                window.addEventListener("pointerup", up, { once: true });
                window.addEventListener("pointercancel", up, { once: true });
            };
        });

        const updateWirePreview = event => {
            if (!state.wireDraft || state.wireDraft.driverId !== d.id) return;
            const last = state.wireDraft.points[state.wireDraft.points.length - 1];
            state.wireDraft.cursor = routedPoint(last, point(event));
            const pts = window.HCCircuit.wirePoints(state.wireDraft.points[0], point(event), {
                route: state.wireDraft.points.slice(1), routing: state.wireRouting
            });
            const path = pts.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ");
            svg.querySelector(`[data-wire-preview="${d.id}"]`)?.setAttribute("d", path);
        };

        svg.onpointermove = event => updateWirePreview(event);
        svg.onclick = event => {
            if (state.cadConnectPointMode === d.id) {
                if (event.target.closest?.("[data-cad-node], [data-cad-component], [data-cad-wire], [data-cad-terminal], [data-cad-driver-terminal]")) return;
                const p = point(event);
                addJunction(d, p.x, p.y);
                return;
            }
            if (!state.wireDraft || state.wireDraft.driverId !== d.id) return;
            if (event.target.closest?.("[data-cad-node], [data-cad-component], [data-cad-wire], [data-cad-terminal], [data-cad-driver-terminal]")) return;
            addWireBend(d, point(event));
        };

        svg.ondragover = event => event.preventDefault();
        svg.ondrop = event => {
            event.preventDefault();
            const payload = event.dataTransfer.getData("text/plain");
            if (!payload.startsWith(`${d.id}:`)) return;
            const type = payload.split(":")[1];
            addCadComponent(d, type, point(event));
        };
    }

    function historyFor(d) {
        if (!state.histories.has(d.id)) state.histories.set(d.id, { undo: [], redo: [] });
        return state.histories.get(d.id);
    }

    function mutateCircuit(d, mutation, rerender = true) {
        if (!d) return;
        syncAll();
        const before = JSON.stringify(d.circuit);
        mutation();
        if (before === JSON.stringify(d.circuit)) return;
        const history = historyFor(d);
        history.undo.push(before);
        if (history.undo.length > 50) history.undo.shift();
        history.redo = [];
        state.activeCircuit = d.id;
        if (rerender) renderDrivers();
        calculate();
    }

    function restoreCircuitHistory(d, from, to) {
        if (!d) return;
        const history = historyFor(d);
        if (!history[from].length) return;
        syncAll();
        history[to].push(JSON.stringify(d.circuit));
        d.circuit = JSON.parse(history[from].pop());
        state.selectedCircuit = null;
        state.wireStart = null;
        state.wireDraft = null;
        state.cadConnectPointMode = null;
        state.activeCircuit = d.id;
        renderDrivers();
        calculate();
    }

    function undoCircuit(d) { restoreCircuitHistory(d, "undo", "redo"); }
    function redoCircuit(d) { restoreCircuitHistory(d, "redo", "undo"); }

    function nextComponentLabel(d, kind) {
        const prefix = kind === "resistor" ? "R" : kind === "capacitor" ? "C" : kind === "inductor" ? "L" : kind === "low_pass" ? "LP" : "W";
        let n = 1;
        const used = new Set(d.circuit.components.map(c => c.label));
        while (used.has(`${prefix}${n}`)) n++;
        return `${prefix}${n}`;
    }

    function defaultValue(kind) {
        if (kind === "capacitor") return 22;
        if (kind === "inductor") return 0.1;
        if (kind === "wire") return 0;
        if (kind === "low_pass") return 400;
        return 3.3;
    }

    function appendSeriesComponent(d, kind, value = defaultValue(kind), rerender = true) {
        ensureDriverShape(d);
        const circuit = d.circuit;
        const oldOutput = nodeById(d, circuit.output) || nodeById(d, circuit.input);
        const newNodeId = uid();
        const newX = clamp((oldOutput?.x || 80) + 160, 160, 760);
        const newNode = { id: newNodeId, label: `N${circuit.nodes.length}`, x: newX, y: oldOutput?.y || 120 };
        circuit.nodes.push(newNode);
        circuit.components.push({
            id: uid(),
            label: nextComponentLabel(d, kind),
            kind,
            value,
            nodeA: circuit.output,
            nodeB: newNodeId,
            bypassed: false,
            rotationDeg: null,
            x: snap(((oldOutput?.x || 80) + newX) / 2),
            y: oldOutput?.y || 120,
            ...(kind === "low_pass" ? { frequency: value || 400, q: 0.707 } : {}),
        });
        circuit.output = newNodeId;
        if (rerender) renderDrivers();
    }

    function appendShuntComponent(d, kind, value = defaultValue(kind), rerender = true) {
        ensureDriverShape(d);
        const output = nodeById(d, d.circuit.output) || nodeById(d, d.circuit.input);
        const ground = nodeById(d, d.circuit.ground);
        d.circuit.components.push({
            id: uid(),
            label: nextComponentLabel(d, kind),
            kind,
            value,
            nodeA: d.circuit.output,
            nodeB: d.circuit.ground,
            bypassed: false,
            rotationDeg: null,
            x: output?.x || 450,
            y: snap(((output?.y || 120) + (ground?.y || 320)) / 2),
        });
        if (rerender) renderDrivers();
    }

    function addCadComponent(d, type, position) {
        // v0.19: components are electrically isolated when placed.
        // The user must cable every terminal manually; placement never creates a connection.
        mutateCircuit(d, () => {
            ensureDriverShape(d);
            const kind = type.replace("shunt_", "");
            const nodeA = uid(), nodeB = uid();
            d.circuit.nodes.push(
                { id: nodeA, label: `${nextComponentLabel(d, kind)}A`, x: 360, y: 180, hidden: true },
                { id: nodeB, label: `${nextComponentLabel(d, kind)}B`, x: 460, y: 180, hidden: true }
            );
            const label = nextComponentLabel(d, kind);
            const count = d.circuit.components.filter(c => c.kind !== "wire").length;
            const x = clamp(position?.x ?? 260 + (count % 4) * 140, 60, 740);
            const y = clamp(position?.y ?? 120 + (Math.floor(count / 4) % 2) * 120, 40, 300);
            d.circuit.components.push({
                id: uid(), label, kind, value: defaultValue(kind), nodeA, nodeB,
                bypassed: false, rotationDeg: 0, x: state.cadSnapToGrid ? snap(x) : x, y: state.cadSnapToGrid ? snap(y) : y,
                ...(kind === "low_pass" ? { frequency: 400, q: 0.707 } : {})
            });
        });
    }

    function addJunction(d, x = 450, y = 220) {
        mutateCircuit(d, () => {
            const manualCount = d.circuit.nodes.filter(n => !n.hidden && ![d.circuit.input, d.circuit.ground, d.circuit.output].includes(n.id)).length + 1;
            d.circuit.nodes.push({ id: uid(), label: `CP${manualCount}`, x: snap(x), y: snap(y), connectPoint: true });
        }, false);
        state.cadConnectPointMode = null;
        renderDrivers();
    }

    function toggleConnectPointMode(d) {
        state.cadConnectPointMode = state.cadConnectPointMode === d.id ? null : d.id;
        state.wireStart = null;
        state.wireDraft = null;
        renderDrivers();
    }

    function startWireMode(d) {
        state.wireStart = { driverId: d.id, nodeId: "__await_first__" };
        state.wireDraft = null;
        renderCircuitSvg(d);
        const svg = $(`cad-${d.id}`);
        if (svg) svg.classList.add("wire-mode");
    }

    function routedPoint(last, raw) {
        if (!last || state.wireRouting === "free") return { x: raw.x, y: raw.y };
        const dx = raw.x - last.x, dy = raw.y - last.y;
        if (state.wireRouting === "orthogonal") {
            return Math.abs(dx) >= Math.abs(dy) ? { x: raw.x, y: last.y } : { x: last.x, y: raw.y };
        }
        const angle = Math.atan2(dy, dx);
        const step = Math.PI / 4;
        const a = Math.round(angle / step) * step;
        const len = Math.hypot(dx, dy);
        return { x: snap(last.x + Math.cos(a) * len), y: snap(last.y + Math.sin(a) * len) };
    }

    function addWireBend(d, rawPoint) {
        if (!state.wireDraft || state.wireDraft.driverId !== d.id) return;
        const last = state.wireDraft.points[state.wireDraft.points.length - 1];
        const p = routedPoint(last, rawPoint);
        if (Math.hypot(p.x - last.x, p.y - last.y) < 1) return;
        state.wireDraft.points.push(p);
        state.wireDraft.cursor = null;
        renderCircuitSvg(d);
    }

    function finishWireEndpoint(d, endpoint, endpointPoint) {
        if (!state.wireStart || state.wireStart.driverId !== d.id) return;
        const nodeId = endpoint?.nodeId;
        const node = nodeById(d, nodeId);
        if (!node) return;
        const visualPoint = endpointPoint || { x: node.x, y: node.y };

        if (state.wireStart.nodeId === "__await_first__") {
            state.wireStart.nodeId = nodeId;
            state.wireStart.endpoint = endpoint;
            state.wireDraft = { driverId: d.id, startNode: nodeId, points: [visualPoint], cursor: null };
            renderCircuitSvg(d);
            return;
        }

        const startEndpoint = state.wireStart.endpoint || { nodeId: state.wireStart.nodeId };
        const route = state.wireDraft?.points?.slice(1) || [];
        state.wireStart = null;
        state.wireDraft = null;
        mutateCircuit(d, () => window.HCCircuit.createWire(d.circuit, startEndpoint, endpoint, {
            route, routing: state.wireRouting, label: nextComponentLabel(d, "wire")
        }));
        renderCircuitSvg(d);
    }

    function cancelWireMode(d) {
        if (state.wireStart?.driverId !== d.id) return;
        state.wireStart = null; state.wireDraft = null; renderCircuitSvg(d);
    }

    function autoArrange(d) {
        mutateCircuit(d, () => {
            const circuit = d.circuit;
            const input = nodeById(d, circuit.input);
            const ground = nodeById(d, circuit.ground);
            if (input) Object.assign(input, { x: 80, y: 120 });
            if (ground) Object.assign(ground, { x: 450, y: 320 });
            const others = circuit.nodes.filter(n => n.id !== circuit.input && n.id !== circuit.ground);
            others.forEach((node, index) => {
                node.x = 220 + index * Math.min(140, 520 / Math.max(1, others.length));
                node.y = 120;
            });
            for (const component of circuit.components) {
                const a = nodeById(d, component.nodeA);
                const b = nodeById(d, component.nodeB);
                component.x = snap(((a?.x || 0) + (b?.x || 0)) / 2);
                component.y = snap(((a?.y || 0) + (b?.y || 0)) / 2);
                if (component.nodeB === circuit.ground || component.nodeA === circuit.ground) component.x += 40;
            }
        });
    }

    function openCircuitPropertyPage(d, componentId) {
        const component = d?.circuit?.components?.find(c => c.id === componentId);
        const modal = $("iemCadPropertyModal");
        const body = $("iemCadPropertyBody");
        if (!component || !modal || !body) return;

        const draft = structuredClone(component);
        const meta = component.kind === "resistor"
            ? { title: "Resistor", unit: "Ω", extra: "" }
            : component.kind === "capacitor"
            ? { title: "Capacitor", unit: "µF", extra: "" }
            : component.kind === "inductor"
            ? { title: "Inductor", unit: "mH", extra: "" }
            : component.kind === "low_pass"
            ? { title: "Low-Pass Filter", unit: "Hz", extra: `<label>Q<input data-property-field="q" type="number" min="0.05" step="0.01" value="${component.q || 0.707}"></label>` }
            : { title: "Wire", unit: "", extra: "" };

        body.innerHTML = `
            <div class="iem-property-hero">
                <div class="iem-property-symbol"><svg viewBox="-60 -35 120 70" aria-hidden="true">${componentSymbolSvg(component)}</svg></div>
                <div><span class="eyebrow">COMPONENT PROPERTY</span><h2>${meta.title} ${esc(component.label || component.id)}</h2><p>Changes are staged here. The circuit is only updated when you press Apply Changes.</p></div>
            </div>
            <div class="iem-property-grid">
                <section class="iem-property-section"><span class="eyebrow">COMPONENT</span>
                    <label>REFERENCE<input data-property-field="label" value="${esc(draft.label || "")}"></label>
                    ${component.kind === "low_pass" ? `<label>CUTOFF FREQUENCY Hz<input data-property-field="frequency" type="number" min="1" step="1" value="${draft.frequency || 400}"></label>` : component.kind !== "wire" ? `<label>VALUE ${meta.unit}<input data-property-field="value" type="number" step="0.01" value="${draft.value}"></label>` : ""}
                    ${meta.extra}
                </section>
                <section class="iem-property-section"><span class="eyebrow">CONNECTION</span>
                    <p class="iem-field-note">Connect or disconnect terminals on the canvas. Moving or rotating this part keeps its connections.</p>
                    <label class="iem-cad-check"><input data-property-field="bypassed" type="checkbox" ${draft.bypassed ? "checked" : ""}> BYPASS / SHORT</label>
                    ${component.kind !== "wire" ? `<div class="iem-property-rotation"><span class="eyebrow">ORIENTATION</span><label>ANGLE<select data-property-field="rotationDeg"><option value="auto" ${draft.rotationDeg === null || draft.rotationDeg === undefined ? "selected" : ""}>Auto from connection</option>${[0,45,90,135,180,225,270,315].map(angle => `<option value="${angle}" ${draft.rotationDeg !== null && draft.rotationDeg !== undefined && normalizeRotation45(draft.rotationDeg) === angle ? "selected" : ""}>${angle}°</option>`).join("")}</select></label><div class="iem-property-rotate-actions"><button class="outline-button" data-property-rotate="-45" type="button">↶ ROTATE -45°</button><button class="outline-button" data-property-rotate="45" type="button">ROTATE +45° ↷</button></div></div>` : ""}
                </section>
                <section class="iem-property-section"><span class="eyebrow">CALCULATED DATA</span><div id="iemPropertyCalculated" class="iem-property-calculated"></div></section>
            </div>`;
        const propertySymbol = body.querySelector('.iem-property-symbol svg');
        if (propertySymbol) propertySymbol.style.transform = `rotate(${componentDisplayAngle(d, component)}deg)`;

        body.querySelectorAll('[data-property-rotate]').forEach(button => button.onclick = () => {
            const select = body.querySelector('[data-property-field="rotationDeg"]');
            const current = select?.value === "auto"
                ? componentDisplayAngle(d, component)
                : num(select?.value, componentDisplayAngle(d, component));
            if (select) select.value = String(normalizeRotation45(current + Number(button.dataset.propertyRotate)));
            const symbol = body.querySelector('.iem-property-symbol svg');
            if (symbol) symbol.style.transform = `rotate(${normalizeRotation45(current + Number(button.dataset.propertyRotate))}deg)`;
        });
        const rotationSelect = body.querySelector('[data-property-field="rotationDeg"]');
        if (rotationSelect) rotationSelect.addEventListener('change', () => {
            const symbol = body.querySelector('.iem-property-symbol svg');
            if (!symbol) return;
            const angle = rotationSelect.value === "auto" ? componentAutoAngle(d, component) : normalizeRotation45(rotationSelect.value);
            symbol.style.transform = `rotate(${angle}deg)`;
        });

        const updateCalculated = () => {
            const box = $("iemPropertyCalculated");
            const value = num(body.querySelector('[data-property-field="value"]')?.value, draft.value || 0);
            if (!box) return;
            if (component.kind === "capacitor") {
                const rows = [100,400,1000,3000,8000].map(f => `<div><span>${f >= 1000 ? (f/1000)+" kHz" : f+" Hz"}</span><strong>${value > 0 ? (1/(2*Math.PI*f*value*1e-6)).toFixed(2) : "∞"} Ω</strong></div>`).join("");
                box.innerHTML = `<p>Capacitive reactance</p>${rows}`;
            } else if (component.kind === "inductor") {
                box.innerHTML = `<p>Inductive reactance</p>${[100,400,1000,3000,8000].map(f => `<div><span>${f >= 1000 ? (f/1000)+" kHz" : f+" Hz"}</span><strong>${(2*Math.PI*f*value*1e-3).toFixed(2)} Ω</strong></div>`).join("")}`;
            } else if (component.kind === "resistor") box.innerHTML = `<p>Resistance</p><div><span>Nominal</span><strong>${value.toFixed(3)} Ω</strong></div>`;
            else if (component.kind === "low_pass") {
                const fc = num(body.querySelector('[data-property-field="frequency"]')?.value, component.frequency || 400);
                const q = num(body.querySelector('[data-property-field="q"]')?.value, component.q || 0.707);
                box.innerHTML = `<p>2nd-order response-domain low-pass</p><div><span>Cutoff</span><strong>${fc.toLocaleString()} Hz</strong></div><div><span>Q</span><strong>${q.toFixed(3)}</strong></div>`;
            }
            else box.innerHTML = '<p>Ideal wire / short connection.</p>';
        };
        body.querySelectorAll("[data-property-field]").forEach(input => input.addEventListener("input", updateCalculated));
        updateCalculated();

        modal.dataset.mode = "component";
        modal.dataset.driverId = d.id;
        modal.dataset.componentId = component.id;
        delete modal.dataset.filterIndex;
        modal.hidden = false;
        document.body.classList.add("iem-property-open");
    }

    function closeCircuitPropertyPage() {
        const modal = $("iemCadPropertyModal");
        if (modal) modal.hidden = true;
        document.body.classList.remove("iem-property-open");
    }

    function applyCircuitPropertyPage() {
        const modal = $("iemCadPropertyModal");
        const body = $("iemCadPropertyBody");
        if (!modal || !body) return;
        const d = find(modal.dataset.driverId);
        if (!d) return;
        if (modal.dataset.mode === "filter") {
            const index = Number(modal.dataset.filterIndex);
            const filter = d.circuit.filters[index];
            if (!filter) return;
            mutateCircuit(d, () => {
                body.querySelectorAll("[data-filter-property]").forEach(input => {
                    const key = input.dataset.filterProperty;
                    filter[key] = key === "type" ? input.value : num(input.value, filter[key] || 0);
                });
                if (filter.type !== "peq") delete filter.gain;
                else if (!Number.isFinite(filter.gain)) filter.gain = 0;
            });
            closeCircuitPropertyPage();
            renderDrivers();
            calculate();
            return;
        }
        const id = modal.dataset.componentId;
        mutateCircuit(d, () => {
            const component = d.circuit.components.find(c => c.id === id);
            if (!component) return;
            body.querySelectorAll("[data-property-field]").forEach(input => {
                const key = input.dataset.propertyField;
                if (key === "bypassed") component[key] = input.checked;
                else if (key === "value" || key === "frequency" || key === "q") component[key] = num(input.value, component[key]);
                else if (key === "rotationDeg") component[key] = input.value === "auto" ? null : normalizeRotation45(input.value);
                else component[key] = input.value;
            });
        });
        closeCircuitPropertyPage();
        renderDrivers();
        calculate();
    }

    function copyCircuitComponent(d, id) {
        const component = d.circuit.components.find(c => c.id === id);
        if (component && component.kind !== "wire") state.circuitClipboard = structuredClone(component);
    }

    function pasteCircuitComponent(d, original) {
        if (!d || !original || original.kind === "wire") return;
        mutateCircuit(d, () => {
            const copy = window.HCCircuit.duplicateComponent(d.circuit, original, nextComponentLabel(d, original.kind));
            state.selectedCircuit = { driverId: d.id, componentId: copy.id };
        });
    }

    function duplicateCircuitComponent(d, id) {
        pasteCircuitComponent(d, d?.circuit.components.find(c => c.id === id));
    }

    function deleteCircuitComponent(d, id) {
        mutateCircuit(d, () => {
            window.HCCircuit.removeComponent(d.circuit, id);
            if (state.selectedCircuit?.componentId === id) state.selectedCircuit = null;
            state.wireStart = null;
            state.wireDraft = null;
        });
    }

    // ---------------------------------------------------------------------
    // Acoustic path editor.
    // ---------------------------------------------------------------------

    function sourceNote(d) {
        if (d.sourceModel === "estimated_resistance") return `Source R estimated from a fixed ${d.sourceReferenceDiameterMm} mm reference bore at 20°C; no measured receiver source impedance is available. The same source is used for the reference and design.`;
        if (d.sourceModel === "custom_resistance") return "Enter a frequency-independent acoustic source resistance. 1 CGS acoustic Ω = 100,000 Pa·s/m³.";
        return "Ideal pressure holds the driver outlet pressure constant for every load. Use it to inspect the limiting case; it can produce very sharp resonances.";
    }

    function pathHtml(d) {
        return `
            <section class="iem-driver-section">
                <div class="iem-panel-title"><div><span class="eyebrow">ACOUSTIC PATH</span><h3>Driver to nozzle.</h3></div></div>
                ${referenceSummaryHtml(d)}
                <div class="iem-driver-grid">
                    <label>ACOUSTIC SOURCE<select data-f="sourceModel">${[["estimated_resistance", "Finite resistance estimate"], ["custom_resistance", "Custom resistance"], ["ideal_pressure", "Ideal pressure (diagnostic)"]].map(([value, label]) => `<option value="${value}" ${d.sourceModel === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
                    <label>SOURCE R · CGS ACOUSTIC Ω<input data-f="sourceResistanceCgs" type="number" min="0.001" step="any" value="${Math.round(d.sourceResistanceCgs * 1000) / 1000}" ${d.sourceModel !== "custom_resistance" ? "disabled" : ""}></label>
                </div>
                <p class="iem-field-note" data-source-note>${esc(sourceNote(d))}</p>
                <div class="iem-path-toolbar">
                    ${[["tube", "+ TUBE"], ["damper", "+ DAMPER"], ["chamber", "+ CHAMBER"], ["nozzle", "+ NOZZLE"]].map(item => `<button class="iem-mini" data-add-path="${d.id}:${item[0]}">${item[1]}</button>`).join("")}
                </div>
                <div class="iem-path-list">${d.path.map((element, index) => pathNode(d, element, index)).join("") || '<div class="iem-field-note">No acoustic elements.</div>'}</div>
            </section>`;
    }

    function pathNode(d, element, index) {
        let fields = "";
        if (element.type === "damper") {
            fields = `<label>RESISTANCE · CGS ACOUSTIC Ω<input data-path-field="value" value="${element.value}" type="number"></label>`;
        } else {
            fields = `<label>LENGTH mm<input data-path-field="length" value="${element.length}" type="number" step="0.1"></label><label>DIAMETER mm<input data-path-field="diameter" value="${element.diameter}" type="number" step="0.05"></label>${element.type === "tube" ? `<label>LOSS<input data-path-field="loss" value="${element.loss || 0}" type="number" step="0.0001"></label>` : ""}`;
        }
        return `<div class="iem-node" data-path-node="${d.id}:${index}"><strong>${esc(element.type.toUpperCase())}</strong><div class="iem-node-fields">${fields}</div><div class="iem-node-tools"><button class="iem-mini" data-move-path="${d.id}:${index}:-1">↑</button><button class="iem-mini" data-move-path="${d.id}:${index}:1">↓</button><button class="iem-mini" data-remove-path="${d.id}:${index}">REMOVE</button></div></div>`;
    }

    function newFilter(type) {
        return { type, frequency: type === "high_pass" ? 500 : 5000, q: 0.707 };
    }

    function newPath(type) {
        if (type === "damper") return { type, value: 1000 };
        if (type === "chamber") return { type, length: 4, diameter: 3 };
        if (type === "nozzle") return { type, length: 3, diameter: 2 };
        return { type, length: 10, diameter: 2, loss: 0 };
    }

    function find(id) {
        return state.drivers.find(d => d.id === id);
    }

    function move(array, index, direction) {
        const next = clamp(index + direction, 0, array.length - 1);
        [array[index], array[next]] = [array[next], array[index]];
    }

    function syncNode(node, property) {
        const [id, index] = node.dataset[property + "Node"].split(":");
        const owner = find(id);
        if (property === "path" && owner) owner.referenceValidationMode = false;
        const element = owner[property][+index];
        node.querySelectorAll(`[data-${property}-field]`).forEach(input => element[input.dataset[property + "Field"]] = num(input.value));
    }

    function syncDriverField(d, input) {
        const key = input.dataset.f;
        if (key === "name" || key === "type" || key === "sourceModel") d[key] = input.value;
        else if (key === "polarity") d.polarity = num(input.value, 1);
        else if (key === "responseAbsolute") d.responseAbsolute = input.value === "absolute";
        else d[key] = num(input.value, d[key]);
    }

    function markDesignDirty() {
        ++state.calculationRevision;
        state.last = null;
        state.chart?.destroy(); state.chart = null;
        state.validationChart?.destroy(); state.validationChart = null;
        updateValidationPanel(null);
        $("iemEngineStatus").textContent = "RECALCULATE";
        $("iemSimulationMessage").textContent = "Design changed. Calculate to update the response.";
        updateReferenceValidationReadouts();
        updateModelNotes();
        metrics();
    }

    function syncAll() {
        document.querySelectorAll(".iem-driver-card").forEach(card => {
            const d = find(card.dataset.driverId);
            if (!d) return;
            card.querySelectorAll("[data-f]").forEach(input => syncDriverField(d, input));
        });
    }

    function bindDriverEvents() {
        document.querySelectorAll(".iem-driver-card").forEach(card => {
            card.querySelectorAll("[data-f]").forEach(input => {
                input.oninput = input.onchange = () => {
                    const d = find(card.dataset.driverId);
                    if (!d) return;
                    syncDriverField(d, input);
                    markDesignDirty();
                    if (input.dataset.f === "name") refreshReverseDrivers();
                    if (input.dataset.f === "sourceModel") {
                        ensureDriverShape(d);
                        const resistance = card.querySelector('[data-f="sourceResistanceCgs"]');
                        resistance.disabled = d.sourceModel !== "custom_resistance";
                        resistance.value = Math.round(d.sourceResistanceCgs * 1000) / 1000;
                        card.querySelector("[data-source-note]").textContent = sourceNote(d);
                    }
                };
            });
        });
        document.querySelectorAll("[data-delete-driver]").forEach(button => button.onclick = () => {
            if (confirm("Remove this driver path?")) {
                state.drivers = state.drivers.filter(d => d.id !== button.dataset.deleteDriver);
                renderDrivers();
                refreshReverseDrivers();
                calculate();
            }
        });
        document.querySelectorAll("[data-save-driver]").forEach(button => button.onclick = () => saveLibrary(button.dataset.saveDriver));

        document.querySelectorAll("[data-cad-palette]").forEach(button => {
            const [id, type] = button.dataset.cadPalette.split(":");
            button.onclick = () => addCadComponent(find(id), type);
            button.ondragstart = event => event.dataTransfer.setData("text/plain", `${id}:${type}`);
        });
        document.querySelectorAll("[data-add-connect-point]").forEach(button => button.onclick = () => toggleConnectPointMode(find(button.dataset.addConnectPoint)));
        document.querySelectorAll("[data-wire-mode]").forEach(button => button.onclick = () => startWireMode(find(button.dataset.wireMode)));
        document.querySelectorAll("[data-wire-routing]").forEach(select => select.onchange = () => { state.wireRouting = select.value; renderDrivers(); });
        document.querySelectorAll("[data-circuit-undo]").forEach(button => button.onclick = () => undoCircuit(find(button.dataset.circuitUndo)));
        document.querySelectorAll("[data-circuit-redo]").forEach(button => button.onclick = () => redoCircuit(find(button.dataset.circuitRedo)));
        document.querySelectorAll("[data-circuit-auto]").forEach(button => button.onclick = () => autoArrange(find(button.dataset.circuitAuto)));
        document.querySelectorAll("[data-circuit-properties]").forEach(button => button.onclick = () => {
            const d = find(button.dataset.circuitProperties);
            const selected = state.selectedCircuit?.driverId === d?.id ? state.selectedCircuit.componentId : null;
            if (selected) openCircuitPropertyPage(d, selected);
        });
        document.querySelectorAll("[data-circuit-duplicate]").forEach(button => button.onclick = () => {
            const d = find(button.dataset.circuitDuplicate);
            if (state.selectedCircuit?.driverId === d?.id) duplicateCircuitComponent(d, state.selectedCircuit.componentId);
        });
        document.querySelectorAll("[data-circuit-delete]").forEach(button => button.onclick = () => {
            const d = find(button.dataset.circuitDelete);
            if (state.selectedCircuit?.driverId === d?.id) deleteCircuitComponent(d, state.selectedCircuit.componentId);
        });
        document.querySelectorAll("[data-cad-symbol-standard]").forEach(select => select.onchange = () => {
            state.cadSymbolStandard = select.value === "ansi" ? "ansi" : "iec";
            state.drivers.forEach(driver => renderCircuitSvg(driver));
            renderDrivers();
        });
        document.querySelectorAll("[data-cad-snap-toggle]").forEach(toggle => toggle.onchange = () => {
            state.cadSnapToGrid = Boolean(toggle.checked);
            document.querySelectorAll("[data-cad-snap-toggle]").forEach(other => {
                other.checked = state.cadSnapToGrid;
            });
        });
        document.querySelectorAll("[data-cad-copy]").forEach(button => button.onclick = () => {
            const [id, componentId] = button.dataset.cadCopy.split(":");
            copyCircuitComponent(find(id), componentId);
        });
        document.querySelectorAll("[data-cad-duplicate]").forEach(button => button.onclick = () => {
            const [id, componentId] = button.dataset.cadDuplicate.split(":");
            duplicateCircuitComponent(find(id), componentId);
        });
        document.querySelectorAll("[data-cad-delete]").forEach(button => button.onclick = () => {
            const [id, componentId] = button.dataset.cadDelete.split(":");
            deleteCircuitComponent(find(id), componentId);
        });

        document.querySelectorAll("[data-add-filter]").forEach(button => button.onclick = () => {
            const [id, type] = button.dataset.addFilter.split(":");
            const d = find(id);
            mutateCircuit(d, () => d.circuit.filters.push(newFilter(type)));
        });
        document.querySelectorAll("[data-remove-filter]").forEach(button => button.onclick = () => {
            const [id, index] = button.dataset.removeFilter.split(":");
            const d = find(id);
            mutateCircuit(d, () => d.circuit.filters.splice(+index, 1));
        });
        document.querySelectorAll("[data-filter-properties]").forEach(button => button.onclick = () => {
            const [id, index] = button.dataset.filterProperties.split(":");
            openFilterPropertyPage(find(id), +index);
        });
        document.querySelectorAll("[data-filter-earlier]").forEach(button => button.onclick = () => {
            const [id, index] = button.dataset.filterEarlier.split(":");
            const d = find(id);
            mutateCircuit(d, () => move(d.circuit.filters, +index, -1));
        });
        document.querySelectorAll("[data-filter-later]").forEach(button => button.onclick = () => {
            const [id, index] = button.dataset.filterLater.split(":");
            const d = find(id);
            mutateCircuit(d, () => move(d.circuit.filters, +index, 1));
        });
        let draggedFilter = null;
        document.querySelectorAll("[data-filter-chip], [data-filter-drag]").forEach(item => {
            item.ondragstart = event => { draggedFilter = item.dataset.filterChip || item.dataset.filterDrag; event.dataTransfer.effectAllowed = "move"; };
            item.ondragover = event => event.preventDefault();
            item.ondrop = event => {
                event.preventDefault();
                const target = item.dataset.filterChip || item.dataset.filterDrag;
                if (!draggedFilter || !target) return;
                const [sourceDriver, sourceIndex] = draggedFilter.split(":");
                const [targetDriver, targetIndex] = target.split(":");
                if (sourceDriver !== targetDriver) return;
                const d = find(sourceDriver);
                mutateCircuit(d, () => {
                    const [moved] = d.circuit.filters.splice(+sourceIndex, 1);
                    d.circuit.filters.splice(+targetIndex, 0, moved);
                });
                draggedFilter = null;
            };
        });
        document.querySelectorAll("[data-filter-node]").forEach(node => node.oninput = () => {
            const [id, index] = node.dataset.filterNode.split(":");
            const filter = find(id).circuit.filters[+index];
            node.querySelectorAll("[data-filter-field]").forEach(input => filter[input.dataset.filterField] = num(input.value));
        });

        document.querySelectorAll("[data-use-reference-path]").forEach(button => button.onclick = async () => {
            const d = find(button.dataset.useReferencePath);
            const referencePath = (d?.measurementReferencePath || []).map(measurementReferenceToDesign).filter(Boolean);
            if (!d || !referencePath.length) return;
            d.path = structuredClone(referencePath);
            d.referenceValidationMode = applyMeasurementReferenceLoadToUi(d);
            renderDrivers();
            await calculate();
        });

        document.querySelectorAll("[data-add-path]").forEach(button => button.onclick = () => {
            const [id, type] = button.dataset.addPath.split(":");
            find(id).path.push(newPath(type));
            find(id).referenceValidationMode = false;
            markDesignDirty();
            renderDrivers();
        });
        document.querySelectorAll("[data-remove-path]").forEach(button => button.onclick = () => {
            const [id, index] = button.dataset.removePath.split(":");
            find(id).path.splice(+index, 1);
            find(id).referenceValidationMode = false;
            markDesignDirty();
            renderDrivers();
        });
        document.querySelectorAll("[data-move-path]").forEach(button => button.onclick = () => {
            const [id, index, direction] = button.dataset.movePath.split(":");
            move(find(id).path, +index, +direction);
            find(id).referenceValidationMode = false;
            markDesignDirty();
            renderDrivers();
        });
        document.querySelectorAll("[data-path-node]").forEach(node => node.oninput = () => { syncNode(node, "path"); markDesignDirty(); });

        document.querySelectorAll("[data-fr-file]").forEach(input => input.onchange = async () => {
            const file = input.files[0];
            if (file) await importDriverFile(find(input.dataset.frFile), file, "fr");
        });
        document.querySelectorAll("[data-z-file]").forEach(input => input.onchange = async () => {
            const file = input.files[0];
            if (file) await importDriverFile(find(input.dataset.zFile), file, "z");
        });
    }

    async function importDriverFile(d, file, mode) {
        if (!d) return;
        const key = `${d.id}:${mode}`;
        const revision = (state.importRevisions.get(key) || 0) + 1;
        state.importRevisions.set(key, revision);
        try {
            const points = await parseFile(file, mode);
            if (!state.drivers.includes(d) || revision !== state.importRevisions.get(key)) return;
            if (mode === "z") d.impedanceCurve = points;
            else {
                d.measurement = points;
                // A user FR upload has its own phase and measurement conditions.
                // Do not apply the database sample's reference correction to it.
                for (const field of ["databaseDriverId", "databaseMeasurementId", "databaseSource", "databaseSparseResponse",
                    "measurementReferencePath", "measurementReferenceCoupler", "measurementReferenceLoad"]) delete d[field];
                d.measurementReferenceCompensation = false;
                d.referenceValidationMode = false;
            }
            markDesignDirty();
            renderDrivers();
            $("iemSimulationMessage").textContent = `Imported ${points.length} ${mode === "z" ? "impedance" : "response"} points. Calculate to update the response.`;
        } catch (error) {
            if (state.drivers.includes(d) && revision === state.importRevisions.get(key)) {
                $("iemSimulationMessage").textContent = `${d.name}: ${error.message}`;
            }
        }
    }

    async function parseFile(file, mode) {
        const output = new Map();
        for (const raw of (await file.text()).split(/\r?\n/)) {
            const line = raw.trim();
            if (!line || line.startsWith("#") || line.startsWith(";")) continue;
            const columns = line.split(/[\s,;\t]+/).filter(Boolean);
            const frequency = +columns[0];
            const value = +columns[1];
            const phase = columns[2] === undefined ? 0 : Number(columns[2]);
            if (Number.isFinite(frequency) && Number.isFinite(value) && Number.isFinite(phase) && frequency > 0 && (mode !== "z" || value > 0)) {
                output.set(frequency, mode === "z"
                    ? { frequency, ohm: value, phase }
                    : { frequency, db: value, phase });
            }
        }
        if (!output.size) throw new Error(`No valid ${mode === "z" ? "impedance" : "response"} points found. Use numeric frequency, magnitude and optional phase columns.`);
        return [...output.values()].sort((a, b) => a.frequency - b.frequency);
    }

    // ---------------------------------------------------------------------
    // Driver library.
    // ---------------------------------------------------------------------

    function saveLibrary(id) {
        syncAll();
        try {
            const d = structuredClone(find(id));
            if (!d) return;
            d.id = uid();
            const saved = JSON.parse(localStorage.getItem("hc_iem_driver_library") || "[]");
            if (!Array.isArray(saved)) throw new Error("Saved library is invalid.");
            saved.push(d);
            localStorage.setItem("hc_iem_driver_library", JSON.stringify(saved));
            state.library = saved;
            $("iemSimulationMessage").textContent = `${d.name} saved to the driver library.`;
            renderLibrary();
        } catch (error) {
            $("iemSimulationMessage").textContent = `Unable to save driver: ${error.message}`;
        }
    }

    function databaseDriverToDesign(row) {
        const d = driver();
        d.name = [row.manufacturer, row.model].filter(Boolean).join(" ");
        d.type = String(row.driver_type || "ba").toLowerCase();
        d.impedance = num(row.nominal_impedance_ohm, 16);
        d.sensitivity = num(row.sensitivity_db, 0);
        d.sensitivityRef = 1000;
        d.responseAbsolute = true;
        d.measurement = (row.fr || []).map(p => ({
            frequency: num(p.frequency_hz),
            db: num(p.magnitude_db),
            phase: num(p.phase_deg, 0),
        })).filter(p => p.frequency > 0).sort((a, b) => a.frequency - b.frequency);
        d.impedanceCurve = (row.impedance_curve || []).map(p => ({
            frequency: num(p.frequency_hz),
            ohm: num(p.impedance_ohm),
            phase: num(p.phase_deg, 0),
        })).filter(p => p.frequency > 0 && p.ohm > 0).sort((a, b) => a.frequency - b.frequency);
        d.databaseDriverId = row.id;
        d.databaseMeasurementId = row.measurement_id || null;
        d.databaseSource = row.source_name || row.measurement_name || "Database";
        d.databaseSparseResponse = d.measurement.length < 20;
        d.measurementReferencePath = structuredClone(row.reference_path || []);
        d.measurementReferenceCoupler = row.coupler || null;
        d.measurementReferenceLoad = referenceCouplerLoad(row.coupler);
        d.measurementReferenceCompensation = d.measurementReferencePath.length > 0 && Boolean(d.measurementReferenceLoad);
        d.databaseImpedanceSource = row.impedance_source || row.measurement_name || null;
        return ensureDriverShape(d);
    }

    function referenceCouplerLoad(coupler) {
        const text = String(coupler || "").trim().toLowerCase();
        if (!text) return null;
        if (/\b711\b/.test(text) || text.includes("iec711") || text.includes("60318-4") || text.includes("60318 4")) {
            return { type: "generic_711_approx" };
        }
        // Lumped-volume approximation, not a complete calibrated 2 cc fixture.
        if (/\b2\s*(?:cc|cm(?:\^?3|³))\b/.test(text) || text.includes("60318-5")) {
            return { type: "closed_cavity", volume_mm3: 2000, loss_resistance_acoustic_ohm: 0 };
        }
        return null;
    }

    async function loadDatabaseLibrary() {
        let db = null;
        try {
            db = window.HCAuth?.getSupabase?.() || window.hcSupabase || null;
        } catch (error) {
            state.databaseLibrary = [];
            state.databaseLibraryError = error.message || "Supabase client is unavailable.";
            return;
        }
        if (!db) {
            state.databaseLibrary = [];
            state.databaseLibraryError = "Supabase client is unavailable.";
            return;
        }

        state.databaseLibraryError = "";
        const { data: drivers, error } = await db
            .from("iem_drivers")
            .select("id,manufacturer,model,driver_type,nominal_impedance_ohm,sensitivity_db,sensitivity_reference,rated_power_mw,notes")
            .order("manufacturer")
            .order("model");
        if (error) {
            console.warn("Unable to load database driver library:", error);
            state.databaseLibrary = [];
            state.databaseLibraryError = error.message || "Database driver query failed.";
            return;
        }

        const rows = [];
        for (const drv of drivers || []) {
            const { data: sets, error: setError } = await db
                .from("iem_driver_measurements")
                .select("id,measurement_name,source_type,source_name,is_default,fixture,coupler,drive_voltage_v,notes")
                .eq("driver_id", drv.id)
                .order("is_default", { ascending: false });
            if (setError) console.warn("Unable to load measurement set:", setError);

            const set = sets?.[0] || null;
            let fr = [], impedance_curve = [], reference_path = [];
            if (set) {
                const [frResult, zResult, pathResult] = await Promise.all([
                    db.from("iem_driver_fr")
                        .select("frequency_hz,magnitude_db,phase_deg")
                        .eq("measurement_id", set.id).order("frequency_hz"),
                    db.from("iem_driver_impedance")
                        .select("frequency_hz,impedance_ohm,phase_deg")
                        .eq("measurement_id", set.id).order("frequency_hz"),
                    db.from("iem_driver_measurement_paths")
                        .select("element_order,element_type,length_mm,inner_diameter_mm,damper_ohm,volume_mm3,description")
                        .eq("measurement_id", set.id).order("element_order")
                ]);
                if (frResult.error) console.warn("Unable to load driver FR:", frResult.error);
                if (zResult.error) console.warn("Unable to load driver impedance:", zResult.error);
                if (pathResult.error) console.warn("Unable to load measurement reference path:", pathResult.error);
                fr = frResult.data || [];
                impedance_curve = zResult.data || [];
                reference_path = pathResult.data || [];

                if (!impedance_curve.length) {
                    for (const impedanceSet of (sets || []).filter(item => item.id !== set.id)) {
                        const zFallback = await db.from("iem_driver_impedance")
                            .select("frequency_hz,impedance_ohm,phase_deg")
                            .eq("measurement_id", impedanceSet.id)
                            .order("frequency_hz");
                        if (zFallback.error) {
                            console.warn("Unable to load fallback driver impedance:", zFallback.error);
                            continue;
                        }
                        if (zFallback.data?.length) {
                            impedance_curve = zFallback.data;
                            set.impedance_source = impedanceSet.measurement_name;
                            break;
                        }
                    }
                }
            }
            rows.push({
                ...drv,
                measurement_id: set?.id || null,
                measurement_name: set?.measurement_name || null,
                source_name: set?.source_name || null,
                coupler: set?.coupler || null,
                fr,
                impedance_curve,
                reference_path,
                impedance_source: set?.impedance_source || set?.measurement_name || null
            });
        }
        state.databaseLibrary = rows;
    }

    async function renderLibrary() {
        $("iemLibraryMessage").textContent = "";
        try {
            const saved = JSON.parse(localStorage.getItem("hc_iem_driver_library") || "[]");
            if (!Array.isArray(saved)) throw new Error("Expected a driver list.");
            state.library = saved.map(ensureDriverShape);
        } catch (error) {
            state.library = [];
            $("iemLibraryMessage").textContent = `Unable to read saved drivers: ${error.message}. The saved data has been kept.`;
        }
        try {
            await loadDatabaseLibrary();
        } catch (error) {
            state.databaseLibrary = [];
            state.databaseLibraryError = error.message || "Unable to reach the driver database.";
        }

        const databaseCards = state.databaseLibrary.map((row, i) => {
            const frCount = row.fr?.length || 0;
            const zCount = row.impedance_curve?.length || 0;
            const sparse = frCount > 0 && frCount < 20;
            const referenceError = databaseReferenceError(databaseDriverToDesign(row));
            return `<article class="iem-library-card">
                <span class="eyebrow">DATABASE · ${esc(String(row.driver_type || "DRIVER").toUpperCase())}</span>
                <h4>${esc(row.manufacturer)} ${esc(row.model)}</h4>
                <p>${row.nominal_impedance_ohm ?? "—"} Ω · ${row.sensitivity_db ?? "—"} dB SPL</p>
                <p class="iem-field-note">${esc(row.measurement_name || "No measurement set")} · FR ${frCount} pts · Z ${zCount} pts${sparse ? " · sparse datasheet landmarks" : ""}${referenceError ? " · ACOUSTIC PREDICTION UNAVAILABLE: " + esc(referenceError) : frCount ? " · approximate reference compensation available" : ""}${row.impedance_source && row.impedance_source !== row.measurement_name ? " · Z from " + esc(row.impedance_source) : ""}</p>
                <div class="iem-library-actions"><button class="outline-button" data-db-lib-use="${i}">ADD TO DESIGN</button></div>
            </article>`;
        }).join("");

        const localCards = state.library.map((d, i) => `<article class="iem-library-card">
            <span class="eyebrow">LOCAL · ${esc(d.type.toUpperCase())}</span>
            <h4>${esc(d.name)}</h4>
            <p>${d.impedance} Ω · ${d.sensitivity || "—"} dB SPL</p>
            <div class="iem-library-actions"><button class="outline-button" data-lib-use="${i}">ADD TO DESIGN</button><button class="danger-button" data-lib-delete="${i}">DELETE</button></div>
        </article>`).join("");

        const dbStatus = state.databaseLibraryError
            ? `<div class="loading-card"><strong>DATABASE LIBRARY ERROR</strong><br>${esc(state.databaseLibraryError)}<br><button class="outline-button" id="iemReloadDatabaseLibrary" type="button">RELOAD DATABASE</button></div>`
            : `<div class="iem-field-note" style="margin-bottom:12px">DATABASE: ${state.databaseLibrary.length} DRIVER${state.databaseLibrary.length === 1 ? "" : "S"} LOADED · <button class="outline-button" id="iemReloadDatabaseLibrary" type="button">RELOAD</button></div>`;
        $("iemDriverLibrary").innerHTML = dbStatus + databaseCards + localCards;
        $("iemReloadDatabaseLibrary")?.addEventListener("click", () => renderLibrary());

        document.querySelectorAll("[data-db-lib-use]").forEach(button => button.onclick = () => {
            const d = databaseDriverToDesign(state.databaseLibrary[+button.dataset.dbLibUse]);
            d.id = uid();
            state.drivers.push(d);
            renderDrivers();
            refreshReverseDrivers();
            document.querySelector('[data-iem-tab="design"]')?.click();
            calculate();
        });
        document.querySelectorAll("[data-lib-use]").forEach(button => button.onclick = () => {
            const d = structuredClone(state.library[+button.dataset.libUse]);
            d.id = uid();
            state.drivers.push(d);
            renderDrivers();
            refreshReverseDrivers();
            document.querySelector('[data-iem-tab="design"]')?.click();
            calculate();
        });
        document.querySelectorAll("[data-lib-delete]").forEach(button => button.onclick = () => {
            if (confirm("Delete this reusable driver from the library?")) {
                state.library.splice(+button.dataset.libDelete, 1);
                localStorage.setItem("hc_iem_driver_library", JSON.stringify(state.library));
                renderLibrary();
            }
        });
    }

    // ---------------------------------------------------------------------
    // Tabs and reverse design.
    // ---------------------------------------------------------------------

    function tabs() {
        document.querySelectorAll("[data-iem-tab]").forEach(button => button.onclick = () => {
            document.querySelectorAll("[data-iem-tab]").forEach(item => item.classList.toggle("active", item === button));
            document.querySelectorAll("[data-iem-panel]").forEach(panel => {
                const active = panel.dataset.iemPanel === button.dataset.iemTab;
                panel.hidden = !active;
                panel.classList.toggle("active", active);
            });
            if (button.dataset.iemTab === "library") renderLibrary();
            if (button.dataset.iemTab === "reverse") drawReverse();
        });
    }

    function refreshReverseDrivers() {
        const select = $("iemReverseDriver");
        const selectedId = select.selectedOptions?.[0]?.dataset.driverId;
        select.innerHTML = state.drivers.map((d, i) => `<option value="${i}" data-driver-id="${d.id}">${esc(d.name)}</option>`).join("");
        const index = state.drivers.findIndex(d => d.id === selectedId);
        if (index >= 0) select.value = String(index);
    }

    function targetPeqOffsetDb(frequency) {
        return state.targetPeq.reduce((sum, filter) => {
            if (filter.enabled === false) return sum;
            const type = ["peq", "high_pass", "low_pass", "low_shelf", "high_shelf"].includes(filter.type) ? filter.type : "peq";
            const gainDb = num(filter.gain, 0);
            const isShapeWithInternalGain = type === "peq" || type === "low_shelf" || type === "high_shelf";
            const h = filterH(
                {
                    type,
                    frequency: filter.frequency,
                    // PK/LSQ/HSQ use gain internally. HP/LP use gain as a post-filter level offset.
                    gain: isShapeWithInternalGain ? gainDb : 0,
                    q: filter.q,
                },
                frequency
            );
            const shapeDb = 20 * Math.log10(Math.max(1e-12, cabs(h)));
            return sum + shapeDb + (isShapeWithInternalGain ? 0 : gainDb);
        }, 0);
    }

    function rebuildReverseFromBase(redraw = true) {
        state.reverse = (state.reverseBase || []).map(point => ({
            frequency: point.frequency,
            db: point.db + targetPeqOffsetDb(point.frequency),
        }));
        if (redraw) {
            if (state.reverseChart) drawReverseDataset();
            else drawReverse();
        }
    }

    function renderTargetPeq() {
        const holder = $("iemTargetPeqList");
        if (!holder) return;
        if (!state.targetPeq.length) {
            holder.innerHTML = '<div class="iem-target-peq-empty">No target filters. Press + to add one.</div>';
            return;
        }
        holder.innerHTML = state.targetPeq.map((filter, index) => {
            const type = ["peq", "high_pass", "low_pass", "low_shelf", "high_shelf"].includes(filter.type) ? filter.type : "peq";
            const gainDisabled = false;
            return `<div class="iem-target-peq-row" data-target-peq-row="${index}">
                <label class="iem-target-peq-enable" title="Enable filter"><input data-target-peq-field="enabled" data-target-peq-index="${index}" type="checkbox" ${filter.enabled === false ? "" : "checked"}></label>
                <select class="iem-target-eq-type" data-target-peq-field="type" data-target-peq-index="${index}" aria-label="Filter type">
                    <option value="peq" ${type === "peq" ? "selected" : ""}>PK</option>
                    <option value="low_shelf" ${type === "low_shelf" ? "selected" : ""}>LSQ</option>
                    <option value="high_shelf" ${type === "high_shelf" ? "selected" : ""}>HSQ</option>
                    <option value="high_pass" ${type === "high_pass" ? "selected" : ""}>HP</option>
                    <option value="low_pass" ${type === "low_pass" ? "selected" : ""}>LP</option>
                </select>
                <div class="iem-target-eq-input"><input data-target-peq-field="frequency" data-target-peq-index="${index}" type="number" min="20" max="20000" step="1" value="${Math.round(filter.frequency)}"><span>Hz</span></div>
                <div class="iem-target-eq-input"><input data-target-peq-field="gain" data-target-peq-index="${index}" type="number" min="-30" max="30" step="0.1" value="${Number(filter.gain || 0).toFixed(1)}" ${gainDisabled ? "disabled" : ""}><span>dB</span></div>
                <div class="iem-target-eq-input"><input data-target-peq-field="q" data-target-peq-index="${index}" type="number" min="0.05" max="30" step="0.05" value="${Number(filter.q || 0.707).toFixed(2)}"></div>
                <button class="iem-target-eq-row-remove" data-target-peq-remove="${index}" type="button" title="Remove filter" aria-label="Remove filter">×</button>
            </div>`;
        }).join("");
        holder.querySelectorAll("[data-target-peq-field]").forEach(input => {
            const update = () => {
                const index = +input.dataset.targetPeqIndex;
                const filter = state.targetPeq[index];
                if (!filter) return;
                const field = input.dataset.targetPeqField;
                if (field === "enabled") filter.enabled = input.checked;
                else if (field === "type") { filter.type = input.value; renderTargetPeq(); }
                else if (field === "frequency") filter.frequency = clamp(num(input.value, filter.frequency), 20, 20000);
                else if (field === "gain") filter.gain = clamp(num(input.value, filter.gain), -30, 30);
                else if (field === "q") filter.q = clamp(num(input.value, filter.q), 0.05, 30);
                rebuildReverseFromBase(true);
            };
            input.addEventListener(input.type === "checkbox" || input.tagName === "SELECT" ? "change" : "input", update);
        });
        holder.querySelectorAll("[data-target-peq-remove]").forEach(button => button.onclick = () => {
            state.targetPeq.splice(+button.dataset.targetPeqRemove, 1);
            renderTargetPeq();
            rebuildReverseFromBase(true);
        });
    }

    function setReverseBase(points, clearPeq = true) {
        state.reverseBase = structuredClone(points || []);
        if (clearPeq) state.targetPeq = [];
        rebuildReverseFromBase(false);
        renderTargetPeq();
    }

    function makeDefaultTargetPoints(count = 50) {
        const absolute = $("iemReverseMatchMode")?.value !== "relative";
        const baseline = absolute ? 80 : 0;
        const minFrequency = 20;
        const maxFrequency = 20000;
        const logMin = Math.log10(minFrequency);
        const logMax = Math.log10(maxFrequency);
        return Array.from({ length: Math.max(2, count) }, (_, index) => {
            const t = index / (Math.max(2, count) - 1);
            const frequency = 10 ** (logMin + (logMax - logMin) * t);
            return { frequency, db: baseline };
        });
    }

    function reverseFlat() {
        const absolute = $("iemReverseMatchMode")?.value !== "relative";
        setReverseBase(makeDefaultTargetPoints(50), true);
        if (absolute) state.reverseView = { min: 60, max: 100 };
        else state.reverseView = { min: -30, max: 20 };
        syncReverseViewInputs();
        drawReverse();
    }

    function syncReverseViewInputs() {
        if ($("iemReverseYMin")) $("iemReverseYMin").value = Math.round(state.reverseView.min * 10) / 10;
        if ($("iemReverseYMax")) $("iemReverseYMax").value = Math.round(state.reverseView.max * 10) / 10;
    }

    function setReverseView(min, max, redraw = true) {
        min = num(min, 60);
        max = num(max, 100);
        if (max - min < 5) max = min + 5;
        state.reverseView = { min, max };
        syncReverseViewInputs();
        if (state.reverseChart) {
            state.reverseChart.options.scales.y.min = min;
            state.reverseChart.options.scales.y.max = max;
            state.reverseChart.update("none");
        } else if (redraw) {
            drawReverse();
        }
    }

    function panReverseView(deltaDb) {
        setReverseView(state.reverseView.min + deltaDb, state.reverseView.max + deltaDb);
    }

    function autoFitReverseView() {
        if (!state.reverse.length) return;
        const values = state.reverse.map(p => num(p.db)).filter(Number.isFinite);
        if (!values.length) return;
        let min = Math.min(...values);
        let max = Math.max(...values);
        const span = Math.max(10, max - min);
        const pad = Math.max(5, span * 0.18);
        min = Math.floor((min - pad) / 5) * 5;
        max = Math.ceil((max + pad) / 5) * 5;
        if (max - min < 20) {
            const center = (max + min) / 2;
            min = center - 10;
            max = center + 10;
        }
        setReverseView(min, max);
    }

    function resetReverseView() {
        if ($("iemReverseMatchMode")?.value === "relative") setReverseView(-30, 20);
        else setReverseView(60, 100);
    }

    function drawReverse() {
        if (!window.Chart) return;
        if (!state.reverseBase.length && state.reverse.length) state.reverseBase = structuredClone(state.reverse);
        if (state.reverseBase.length < 2) return reverseFlat();
        rebuildReverseFromBase(false);
        renderTargetPeq();
        state.reverseChart?.destroy();
        state.reverseChart = new Chart($("iemReverseChart"), {
            type: "line",
            data: { datasets: [{ label: "Desired response", data: state.reverse.map(p => ({ x: p.frequency, y: p.db })), pointRadius: 4, borderWidth: 2 }] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                parsing: false,
                scales: { x: { type: "logarithmic", min: 20, max: 20000 }, y: { min: state.reverseView.min, max: state.reverseView.max, title: { display: true, text: $("iemReverseMatchMode")?.value === "relative" ? "Relative level (dB)" : "SPL (dB)" } } },
            },
        });
        syncReverseViewInputs();
        bindReverseDraw();
    }

    function bindReverseDraw() {
        const canvas = $("iemReverseChart");
        if (canvas.dataset.bound) return;
        canvas.dataset.bound = "1";
        let drawing = false;
        function point(event) {
            const rect = canvas.getBoundingClientRect();
            const frequency = state.reverseChart.scales.x.getValueForPixel(event.clientX - rect.left);
            const db = state.reverseChart.scales.y.getValueForPixel(event.clientY - rect.top);
            if (!Number.isFinite(frequency) || !Number.isFinite(db)) return;
            const log = Math.log10(frequency);
            let bestIndex = -1;
            let bestDistance = Infinity;
            state.reverseBase.forEach((p, i) => {
                const distance = Math.abs(Math.log10(p.frequency) - log);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestIndex = i;
                }
            });
            const f = clamp(frequency, 20, 20000);
            const desiredDb = clamp(db, state.reverseView.min, state.reverseView.max);
            const next = { frequency: f, db: desiredDb - targetPeqOffsetDb(f) };
            if (bestDistance < 0.05) state.reverseBase[bestIndex] = next;
            else state.reverseBase.push(next);
            state.reverseBase.sort((a, b) => a.frequency - b.frequency);
            rebuildReverseFromBase(true);
        }
        canvas.onpointerdown = event => {
            drawing = true;
            canvas.setPointerCapture(event.pointerId);
            point(event);
        };
        canvas.onpointermove = event => { if (drawing) point(event); };
        canvas.onpointerup = () => drawing = false;
        canvas.onwheel = event => {
            event.preventDefault();
            const direction = Math.sign(event.deltaY || 0);
            if (!direction) return;
            const step = event.shiftKey ? 10 : 2;
            panReverseView(direction * step);
        };
        canvas.oncontextmenu = event => {
            event.preventDefault();
            if (state.reverseBase.length <= 2) return;
            const rect = canvas.getBoundingClientRect();
            const frequency = state.reverseChart.scales.x.getValueForPixel(event.clientX - rect.left);
            const log = Math.log10(frequency);
            let bestIndex = 0;
            let bestDistance = Infinity;
            state.reverseBase.forEach((p, i) => {
                const distance = Math.abs(Math.log10(p.frequency) - log);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestIndex = i;
                }
            });
            state.reverseBase.splice(bestIndex, 1);
            rebuildReverseFromBase(true);
        };
    }

    function drawReverseDataset() {
        if (!state.reverseChart) return;
        state.reverseChart.data.datasets[0].data = state.reverse.map(p => ({ x: p.frequency, y: p.db }));
        state.reverseChart.update("none");
    }

    function listNums(value) {
        return String(value).split(",").map(text => text.trim()).filter(Boolean).map(Number);
    }

    function reverseContextKey(driverId) {
        return JSON.stringify({ driverId, selectedDriverId: state.drivers[Number($("iemReverseDriver").value)]?.id,
            request: rustRequest(logFreq(120), true), target: state.reverse,
            settings: Object.fromEntries(Object.keys(projectDefaults).filter(id => id.startsWith("iemReverse")).map(id => [id, $(id).value])) });
    }

    async function reverseRun() {
        syncAll();
        const revision = ++state.reverseRevision;
        $("iemReverseResults").innerHTML = "";
        $("iemReverseMessage").textContent = "";
        if (state.reverse.length < 2) { $("iemReverseMessage").textContent = "Add at least two target response points."; return; }
        const driverIndex = +$("iemReverseDriver").value;
        const selectedDriver = state.drivers[driverIndex];
        if (!selectedDriver) { $("iemReverseMessage").textContent = "Select a driver to optimise."; return; }
        // The optimiser replaces the selected driver's circuit with each candidate.
        const errors = [...physicalInputErrors(), ...state.drivers.flatMap((d, index) => index === driverIndex ? [] :
            window.HCCircuit.compile(d.circuit).errors.map(message => `${d.name}: ${message}`))];
        for (const [name, minId, maxId] of [["Tube length", "iemReverseLengthMin", "iemReverseLengthMax"], ["Tube diameter", "iemReverseDiameterMin", "iemReverseDiameterMax"]]) {
            const min = Number($(minId).value), max = Number($(maxId).value);
            if (!(Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min)) errors.push(`${name}: use a positive minimum and a maximum at least as large.`);
        }
        for (const [name, id] of [["Dampers", "iemReverseDampers"], ["Capacitors", "iemReverseCaps"], ["Resistors", "iemReverseResistors"]]) {
            const values = listNums($(id).value);
            if (!values.length || values.some(value => !Number.isFinite(value) || value < 0)) errors.push(`${name}: enter a list of non-negative numbers.`);
        }
        const gainRange = Number($("iemReverseGainRange").value);
        if (!Number.isFinite(gainRange) || gainRange < 0 || $("iemReverseGainRange").value === "") errors.push("Gain range must be a non-negative number.");
        if (errors.length) { $("iemReverseMessage").textContent = errors.join(" "); return; }
        const request = {
            // The optimiser scores full SPL; the forward renderer alone adds
            // the database baseline back to a delta-only engine response.
            base_request: rustRequest(logFreq(120), true),
            target: state.reverse.map(p => ({ frequency_hz: p.frequency, db: p.db, phase_deg: 0 })),
            driver_index: driverIndex,
            min_tube_length_mm: num($("iemReverseLengthMin").value, 3),
            max_tube_length_mm: num($("iemReverseLengthMax").value, 20),
            min_tube_diameter_mm: num($("iemReverseDiameterMin").value, 0.8),
            max_tube_diameter_mm: num($("iemReverseDiameterMax").value, 3),
            damper_values: listNums($("iemReverseDampers").value).map(value => value * ACOUSTIC_CGS_TO_SI),
            capacitor_values_uf: listNums($("iemReverseCaps").value),
            resistor_values_ohm: listNums($("iemReverseResistors").value),
            gain_range_db: num($("iemReverseGainRange").value, 8),
            max_evaluations: 3200,
            result_count: 10,
            normalization_frequency_hz: num($("iemReverseNormalizeFrequency").value, 1000),
            absolute_match: $("iemReverseMatchMode")?.value !== "relative",
            // Reverse Design is physical/electrical only. PEQ belongs exclusively to target authoring.
            allow_peq: false,
            max_peq_filters: 0,
        };
        if (!window.HCAcousticEngine) {
            $("iemReverseMessage").textContent = "Build the Rust/WASM engine first for reverse optimisation.";
            return;
        }
        const driverId = selectedDriver.id;
        const contextKey = reverseContextKey(driverId);
        const runButton = $("iemReverseRunButton");
        runButton.disabled = true;
        $("iemReverseMessage").textContent = "Searching for designs…";
        try {
            const engineResults = await window.HCAcousticEngine.reverseDesign(request);
            const results = engineResults.map(candidate => ({ ...candidate, damper_ohm: candidate.damper_ohm / ACOUSTIC_CGS_TO_SI }));
            if (revision !== state.reverseRevision) return;
            if (contextKey !== reverseContextKey(driverId)) {
                $("iemReverseMessage").textContent = "Design changed during the search. Run Find Design again.";
                return;
            }
            $("iemReverseResults").innerHTML = results.map((candidate, index) => `
                <article class="iem-reverse-result-card">
                    <div class="iem-reverse-result-head">
                        <div><span class="eyebrow">CANDIDATE ${index + 1}</span><strong>${candidate.tube_diameter_mm.toFixed(2)} mm ID · ${candidate.tube_length_mm.toFixed(1)} mm</strong></div>
                        <strong>${(candidate.physical_rmse_db ?? candidate.score_rmse_db).toFixed(2)} dB RMSE</strong>
                    </div>
                    <p class="iem-field-note">${Math.round(candidate.damper_ohm)} CGS acoustic Ω damper · ${candidate.capacitor_uf} µF series C · ${candidate.resistor_ohm} Ω series R · ${candidate.gain_db.toFixed(1)} dB gain</p>
                    <div class="iem-reverse-actions">
                        <button class="primary-button" type="button" data-apply-rev-physical="${index}">APPLY PHYSICAL DESIGN</button>
                    </div>
                </article>`).join("");

            $("iemReverseMessage").textContent = results.length ? `${results.length} candidate designs found.` : "No candidates found for these constraints.";
            document.querySelectorAll("[data-apply-rev-physical]").forEach(button => button.onclick = () => {
                syncAll();
                const currentIndex = state.drivers.findIndex(d => d.id === driverId);
                if (currentIndex < 0 || contextKey !== reverseContextKey(driverId)) {
                    $("iemReverseResults").innerHTML = "";
                    $("iemReverseMessage").textContent = "Design or target changed. Run Find Design again before applying a result.";
                    return;
                }
                applyRevPhysical(results[+button.dataset.applyRevPhysical], currentIndex);
                $("iemReverseResults").innerHTML = "";
                $("iemReverseMessage").textContent = "Candidate applied.";
            });
        } catch (error) {
            if (revision === state.reverseRevision) $("iemReverseMessage").textContent = error.message || "Reverse design failed";
        } finally {
            if (revision === state.reverseRevision) runButton.disabled = false;
        }
    }

    function applyRevPhysical(candidate, index, recalc = true) {
        if (!candidate || !state.drivers[index]) return;
        const d = ensureDriverShape(state.drivers[index]);
        d.gain = candidate.gain_db;
        let tube = d.path.find(element => element.type === "tube");
        if (!tube) d.path.unshift(tube = { type: "tube", length: 10, diameter: 2, loss: 0 });
        tube.length = candidate.tube_length_mm;
        tube.diameter = candidate.tube_diameter_mm;
        let damper = d.path.find(element => element.type === "damper");
        if (candidate.damper_ohm > 0) {
            if (!damper) d.path.push(damper = { type: "damper", value: 1000 });
            damper.value = candidate.damper_ohm;
        } else {
            d.path = d.path.filter(element => element.type !== "damper");
        }
        const existingFilters = [
            ...structuredClone(d.circuit?.filters || []),
            ...window.HCCircuit.compile(d.circuit).activeComponents
                .filter(c => c.kind === "low_pass" && !c.bypassed)
                .map(c => ({ type: "low_pass", frequency: c.frequency || 400, q: c.q || 0.707 })),
        ];
        d.circuit = createCircuit();
        // Generated series chains start at the source, as in the optimiser.
        // The empty CAD template deliberately has an unconnected driver node.
        d.circuit.nodes = d.circuit.nodes.filter(node => node.id !== d.circuit.output);
        d.circuit.output = d.circuit.input;
        d.circuit.filters = existingFilters;
        d.referenceValidationMode = false;
        if (candidate.resistor_ohm > 0) appendSeriesComponent(d, "resistor", candidate.resistor_ohm, false);
        if (candidate.capacitor_uf > 0) appendSeriesComponent(d, "capacitor", candidate.capacitor_uf, false);
        if (recalc) {
            renderDrivers();
            document.querySelector('[data-iem-tab="design"]')?.click();
            calculate();
        }
    }

    // ---------------------------------------------------------------------
    // Target product and project persistence.
    // ---------------------------------------------------------------------

    async function loadTargetProduct(id) {
        if (!id || !window.hcSupabase) {
            state.target = [];
            draw();
            return;
        }
        for (const table of ["product_frequency_response", "product_frequency_responses"]) {
            const { data, error } = await window.hcSupabase.from(table).select("frequency_hz,db").eq("product_id", id).order("frequency_hz");
            if (!error) {
                state.target = (data || []).map(p => ({ frequency: +p.frequency_hz, db: +p.db }));
                draw();
                return;
            }
        }
    }

    function saveProject() {
        syncAll();
        try {
            localStorage.setItem("hc_iem_project", JSON.stringify({
                version: 2,
                name: $("iemProjectName").value,
                drivers: state.drivers,
                target: state.target,
                reverseBase: state.reverseBase,
                targetPeq: state.targetPeq,
                settings: Object.fromEntries(Object.entries(projectDefaults).map(([id, fallback]) =>
                    [id, typeof fallback === "boolean" ? $(id).checked : $(id).value])),
                reverseView: state.reverseView,
                cadSettings: { wireRouting: state.wireRouting, cadSymbolStandard: state.cadSymbolStandard, cadSnapToGrid: state.cadSnapToGrid },
            }));
            $("iemProjectMessage").textContent = "Project saved in this browser.";
        } catch (error) {
            $("iemProjectMessage").textContent = `Unable to save project: ${error.message}`;
        }
    }

    function restoreProjectSettings(settings = {}) {
        settings ||= {};
        for (const [id, fallback] of Object.entries(projectDefaults)) {
            const value = settings[id] ?? fallback;
            if (typeof fallback === "boolean") $(id).checked = Boolean(value);
            else $(id).value = String(value);
        }
        $("iemReverseNormalizeFrequency").disabled = $("iemReverseMatchMode").value !== "relative";
    }

    function resetCadSession() {
        markDesignDirty();
        state.histories.clear();
        state.activeCircuit = null;
        state.selectedCircuit = null;
        state.wireStart = null;
        state.wireDraft = null;
        state.cadConnectPointMode = null;
        state.importRevisions.clear();
        ++state.reverseRevision;
        $("iemReverseResults").innerHTML = "";
        $("iemReverseMessage").textContent = "";
        $("iemReverseRunButton").disabled = false;
    }

    function loadProject() {
        try {
            const project = JSON.parse(localStorage.getItem("hc_iem_project") || "null");
            if (!project) { $("iemProjectMessage").textContent = "No saved project in this browser."; return; }
            if (!Array.isArray(project.drivers)) throw new Error("Saved project has no driver list.");
            const drivers = project.drivers.map(ensureDriverShape);
            for (const key of ["target", "reverseBase", "targetPeq"]) {
                if (project[key] !== undefined && !Array.isArray(project[key])) throw new Error(`Invalid saved ${key}.`);
            }
            resetCadSession();
            restoreProjectSettings(project.settings);
            state.wireRouting = ["orthogonal", "45", "free"].includes(project.cadSettings?.wireRouting) ? project.cadSettings.wireRouting : "orthogonal";
            state.cadSymbolStandard = project.cadSettings?.cadSymbolStandard === "ansi" ? "ansi" : "iec";
            state.cadSnapToGrid = project.cadSettings?.cadSnapToGrid !== false;
            $("iemProjectName").value = project.name || "Untitled IEM";
            state.drivers = drivers;
            state.target = project.target || [];
            state.reverseBase = project.reverseBase || [];
            state.targetPeq = project.targetPeq || [];
            rebuildReverseFromBase(false);
            renderTargetPeq();
            renderDrivers();
            refreshReverseDrivers();
            setReverseView(project.reverseView?.min ?? 60, project.reverseView?.max ?? 100, false);
            drawReverse();
            $("iemProjectMessage").textContent = "Project loaded.";
            calculate();
        } catch (error) {
            console.error("Unable to load IEM project", error);
            $("iemProjectMessage").textContent = `Unable to load project: ${error.message}`;
        }
    }

    function newProject() {
        resetCadSession();
        restoreProjectSettings();
        state.drivers = [driver()];
        state.target = [];
        state.targetPeq = [];
        state.reverseBase = makeDefaultTargetPoints(50);
        state.reverse = structuredClone(state.reverseBase);
        renderTargetPeq();
        $("iemProjectName").value = "Untitled IEM";
        $("iemProjectMessage").textContent = "New project.";
        renderDrivers();
        refreshReverseDrivers();
        calculate();
        setReverseView(60, 100, false);
        drawReverse();
    }

    function bind() {
        tabs();
        $("iemAddDriverButton").onclick = () => {
            state.drivers.push(driver());
            markDesignDirty();
            renderDrivers();
            refreshReverseDrivers();
        };
        $("iemCalculateButton").onclick = calculate;
        $("iemShowValidationError").onchange = draw;
        $("iemSaveProjectButton").onclick = saveProject;
        $("iemLoadProjectButton").onclick = loadProject;
        $("iemNewProjectButton").onclick = newProject;
        $("iemTargetProduct").onchange = event => loadTargetProduct(event.target.value);
        ["iemSplMode", "iemNormalizeFrequency", "iemNormalizeMode", "iemShowTarget", "iemShowIndividual", "iemShowCombined"].forEach(id => $(id).onchange = draw);
        ["iemTemperature", "iemHumidity", "iemAcousticLoadType", "iemCouplerVolume", "iemLoadLossResistance", "iemLeakResistance"].forEach(id => {
            $(id).onchange = () => {
                // A previous unity check no longer describes this load/environment.
                state.drivers.forEach(d => d.referenceValidationMode = false);
                markDesignDirty();
            };
        });
        $("iemReverseFlat").onclick = reverseFlat;
        const addTargetFilter = (type) => {
            if (!state.reverseBase.length) reverseFlat();
            const defaults = type === "high_pass"
                ? { type, frequency: 80, gain: 0, q: 0.707, enabled: true }
                : type === "low_pass"
                    ? { type, frequency: 12000, gain: 0, q: 0.707, enabled: true }
                    : { type: "peq", frequency: 3000, gain: 3, q: 1, enabled: true };
            state.targetPeq.push(defaults);
            renderTargetPeq();
            rebuildReverseFromBase(true);
        };
        $("iemTargetPeqAdd").onclick = () => addTargetFilter("peq");
        $("iemTargetPeqRemoveLast").onclick = () => {
            if (!state.targetPeq.length) return;
            state.targetPeq.pop();
            renderTargetPeq();
            rebuildReverseFromBase(true);
        };
        $("iemTargetPeqSort").onclick = () => {
            state.targetPeq.sort((a, b) => Number(a.frequency || 0) - Number(b.frequency || 0));
            renderTargetPeq();
            rebuildReverseFromBase(true);
        };
        $("iemTargetPeqReset").onclick = () => {
            state.targetPeq = [];
            renderTargetPeq();
            rebuildReverseFromBase(true);
        };
        $("iemReverseMatchMode").onchange = () => {
            const relative = $("iemReverseMatchMode").value === "relative";
            $("iemReverseNormalizeFrequency").disabled = !relative;
            resetReverseView();
            drawReverse();
        };
        $("iemReverseYMin").onchange = () => setReverseView($("iemReverseYMin").value, $("iemReverseYMax").value);
        $("iemReverseYMax").onchange = () => setReverseView($("iemReverseYMin").value, $("iemReverseYMax").value);
        $("iemReverseUp10").onclick = () => panReverseView(10);
        $("iemReverseDown10").onclick = () => panReverseView(-10);
        $("iemReverseAutoFit").onclick = autoFitReverseView;
        $("iemReverseResetView").onclick = resetReverseView;
        $("iemReverseCopyCombined").onclick = () => {
            if (state.last?.combined) {
                setReverseBase(state.last.combined, true);
                autoFitReverseView();
                drawReverse();
            }
        };
        $("iemReverseFile").onchange = async event => {
            if (event.target.files[0]) {
                try {
                    const points = await parseFile(event.target.files[0], "fr");
                    if (points.length < 2) throw new Error("A target needs at least two valid response points.");
                    setReverseBase(points, true);
                    if ($("iemReverseMatchMode")) $("iemReverseMatchMode").value = "absolute";
                    if ($("iemReverseNormalizeFrequency")) $("iemReverseNormalizeFrequency").disabled = true;
                    autoFitReverseView();
                    drawReverse();
                    $("iemReverseMessage").textContent = `Imported ${points.length} target points.`;
                } catch (error) { $("iemReverseMessage").textContent = error.message; }
            }
        };
        $("iemReverseRunButton").onclick = reverseRun;

        document.addEventListener("keydown", event => {
            const editing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || "") || event.target?.isContentEditable;
            if (editing || !(event.ctrlKey || event.metaKey)) return;
            const d = find(state.activeCircuit || state.selectedCircuit?.driverId);
            if (!d) return;
            const key = event.key.toLowerCase();
            if (key === "c" && state.selectedCircuit?.driverId === d.id) {
                event.preventDefault();
                copyCircuitComponent(d, state.selectedCircuit.componentId);
            } else if (key === "v" && state.circuitClipboard) {
                event.preventDefault();
                pasteCircuitComponent(d, state.circuitClipboard);
            } else if (key === "z") {
                event.preventDefault();
                if (event.shiftKey) redoCircuit(d); else undoCircuit(d);
            } else if (key === "y") {
                event.preventDefault();
                redoCircuit(d);
            }
        });
    }

    function populateTargetProducts(products) {
        state.products = products || [];
        const select = $("iemTargetProduct");
        if (select) select.innerHTML = '<option value="">No target</option>' + state.products.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
    }

    async function init() {
        state.drivers = [driver()];
        renderDrivers();
        refreshReverseDrivers();
        bind();
        state.reverseBase = makeDefaultTargetPoints(50);
        state.reverse = structuredClone(state.reverseBase);
        state.reverseView = $("iemReverseMatchMode")?.value === "relative"
            ? { min: -30, max: 20 }
            : { min: 60, max: 100 };
        renderTargetPeq();
        syncReverseViewInputs();
        drawReverse();
        try {
            if (window.HCAcousticEngine) {
                await window.HCAcousticEngine.load();
                $("iemEngineStatus").textContent = await window.HCAcousticEngine.version();
            }
        } catch (error) {
            console.warn(error);
            $("iemEngineStatus").textContent = "JS FALLBACK";
        }
        calculate();
    }

    window.HCIemDesigner = { init, populateTargetProducts };

    document.addEventListener("click", event => {
        if (event.target.closest("#iemCadPropertyCancel") || event.target.closest("#iemCadPropertyClose")) closeCircuitPropertyPage();
        if (event.target.closest("#iemCadPropertyApply")) applyCircuitPropertyPage();
        const del = event.target.closest("#iemCadPropertyDelete");
        if (del) {
            const modal = $("iemCadPropertyModal");
            const d = find(modal?.dataset.driverId);
            if (!d || !modal) return;
            if (modal.dataset.mode === "filter") {
                const index = Number(modal.dataset.filterIndex);
                if (Number.isInteger(index) && confirm("Delete this filter?")) {
                    mutateCircuit(d, () => d.circuit.filters.splice(index, 1));
                    closeCircuitPropertyPage();
                    renderDrivers();
                    calculate();
                }
            } else if (modal.dataset.componentId && confirm("Delete this component?")) {
                deleteCircuitComponent(d, modal.dataset.componentId);
                closeCircuitPropertyPage();
                calculate();
            }
        }
    });

    window.addEventListener("keydown", event => {
        const editing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "") || document.activeElement?.isContentEditable;
        if (!editing && (event.key === "Delete" || event.key === "Backspace") && state.selectedCircuit) {
            event.preventDefault();
            const d = find(state.selectedCircuit.driverId);
            if (d) { deleteCircuitComponent(d, state.selectedCircuit.componentId); state.selectedCircuit = null; calculate(); }
            return;
        }
        if (event.key === "Escape") {
            const d = find(state.wireStart?.driverId || state.cadConnectPointMode);
            state.wireStart = null;
            state.wireDraft = null;
            state.cadConnectPointMode = null;
            if (d) renderDrivers();
        }
    });

})();
