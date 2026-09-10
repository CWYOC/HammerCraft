(function () {
    "use strict";

    const $ = id => document.getElementById(id);
    const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const uid = () => crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random()}`;
    const snap = value => Math.round(value / 20) * 20;

    const state = {
        products: [],
        drivers: [],
        library: [],
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
        cadHoldToDragMs: 220,
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
        // Migration for projects saved by the v0.6 ordered circuit editor.
        if (Array.isArray(d.circuit)) {
            const old = d.circuit;
            d.circuit = createCircuit();
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
        const circuit = ensureDriverShape(d).circuit;
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
        for (const component of d.circuit.components) {
            if (component.kind === "low_pass" && !component.bypassed) {
                result = cmul(result, filterH({ type: "low_pass", frequency: component.frequency || 400, q: component.q || 0.707 }, frequency));
            }
        }
        return result;
    }

    function acousticDbPhase(d, frequency) {
        let db = 0;
        let phase = 0;
        const c = speed();
        let length = 0;
        for (const element of d.path) {
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

    function fallback() {
        const frequencies = logFreq();
        const per = state.drivers.map(d => frequencies.map(frequency => {
            const h = circuitH(d, frequency);
            const acoustic = acousticDbPhase(d, frequency);
            const amplitude = 10 ** ((rawDb(d, frequency) + d.gain + acoustic.db) / 20) * cabs(h);
            const phase = cphase(h) + acoustic.phase + (d.polarity < 0 ? Math.PI : 0);
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
        return { type };
    }

    function toRustPath(element) {
        if (element.type === "tube") return { type: "tube", length_mm: element.length, diameter_mm: element.diameter, loss_factor: element.loss || 0 };
        if (element.type === "damper") return { type: "damper", resistance_acoustic_ohm: element.value };
        if (element.type === "chamber") return { type: "expansion_chamber", length_mm: element.length, diameter_mm: element.diameter };
        return { type: "nozzle", length_mm: element.length, diameter_mm: element.diameter };
    }

    function toRustFilter(filter) {
        if (filter.type === "high_pass") return { type: "high_pass", frequency_hz: filter.frequency, q: filter.q };
        if (filter.type === "low_pass") return { type: "low_pass", frequency_hz: filter.frequency, q: filter.q };
        return null;
    }

    function toRustNetlist(d) {
        const circuit = ensureDriverShape(d).circuit;
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

    function rustRequest(frequencies = logFreq()) {
        return {
            frequencies_hz: frequencies,
            environment: {
                temperature_c: num($("iemTemperature")?.value, 20),
                relative_humidity_percent: num($("iemHumidity")?.value, 50),
            },
            acoustic_load: loadObj(),
            drivers: state.drivers.map(raw => {
                const d = ensureDriverShape(raw);
                return {
                    id: d.id,
                    name: d.name,
                    driver_type: ({ dd: "dynamic", ba: "balanced_armature", planar: "planar", magnetostatic: "magnetostatic", bc: "bone_conduction" }[d.type] || "other"),
                    nominal_impedance_ohm: d.impedance,
                    sensitivity_db: d.sensitivity,
                    sensitivity_reference_hz: d.sensitivityRef,
                    response_absolute_spl: d.responseAbsolute,
                    gain_db: d.gain,
                    polarity_inverted: d.polarity < 0,
                    response: d.measurement.map(p => ({ frequency_hz: p.frequency, db: p.db, phase_deg: p.phase || 0 })),
                    impedance: d.impedanceCurve.map(p => ({ frequency_hz: p.frequency, magnitude_ohm: p.ohm, phase_deg: p.phase || 0 })),
                    electrical: [
                        ...d.circuit.filters.map(toRustFilter).filter(Boolean),
                        ...d.circuit.components.filter(component => component.kind === "low_pass" && !component.bypassed).map(component => ({ type: "low_pass", frequency_hz: component.frequency || 400, q: component.q || 0.707 }))
                    ],
                    circuit_netlist: toRustNetlist(d),
                    acoustic_path: d.path.map(toRustPath),
                    acoustic_source: { type: "ideal_pressure" },
                };
            }),
        };
    }

    async function calculate() {
        syncAll();
        let result;
        try {
            if (window.HCAcousticEngine) {
                const rust = await window.HCAcousticEngine.simulate(rustRequest());
                result = {
                    drivers: rust.drivers.map(item => item.points.map(p => ({ frequency: p.frequency_hz, db: p.db, phase: p.phase_deg }))),
                    combined: rust.combined.map(p => ({ frequency: p.frequency_hz, db: p.db, phase: p.phase_deg })),
                };
                $("iemEngineStatus").textContent = await window.HCAcousticEngine.version();
            } else {
                throw new Error("WASM unavailable");
            }
        } catch (error) {
            console.warn("Rust engine unavailable, using JS fallback", error);
            result = fallback();
            $("iemEngineStatus").textContent = "JS FALLBACK";
        }
        state.last = result;
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
        if (mode === "each" || kind === "target") offset = interp(series, frequency);
        else offset = state.last?.combined?.length ? interp(state.last.combined, frequency) : interp(series, frequency);
        return series.map(point => ({ ...point, db: point.db - offset }));
    }

    function draw() {
        if (!state.last || !window.Chart) return;
        const datasets = [];
        if ($("iemShowIndividual")?.checked) {
            state.last.drivers.forEach((response, index) => datasets.push({
                label: state.drivers[index]?.name || `Driver ${index + 1}`,
                data: displaySeries(response).map(point => ({ x: point.frequency, y: point.db })),
                pointRadius: 0,
                borderWidth: 1.5,
            }));
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
                    y: { title: { display: true, text: $("iemSplMode")?.value === "absolute" ? "SPL (dB)" : "Relative SPL (dB)" } },
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
            for (const element of d.path) {
                if (element.type === "tube" || element.type === "nozzle") {
                    const L = element.length / 1000;
                    const f = c / (4 * Math.max(0.0001, L));
                    if (!resonance || f < resonance) resonance = f;
                    delay = Math.max(delay, L / c * 1000);
                    volume += Math.PI * (element.diameter / 2) ** 2 * element.length;
                }
                if (element.type === "chamber") volume += Math.PI * (element.diameter / 2) ** 2 * element.length;
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

    function renderDrivers() {
        const root = $("iemDriverPaths");
        root.innerHTML = state.drivers.map((raw, index) => {
            const d = ensureDriverShape(raw);
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
                        <button class="iem-mini" data-circuit-properties="${d.id}" type="button">PROPERTIES</button>
                    </div>
                </div>
                <div class="iem-cad-workspace">
                    <aside class="iem-cad-palette">
                        <span class="iem-palette-title">COMPONENTS</span>
                        ${paletteButton(d.id, "resistor", "RESISTOR")}
                        ${paletteButton(d.id, "capacitor", "CAPACITOR")}
                        ${paletteButton(d.id, "inductor", "INDUCTOR")}
                        ${paletteButton(d.id, "low_pass", "LOW PASS")}
                        <button class="iem-cad-tool iem-connect-point-tool ${state.cadConnectPointMode === d.id ? "active" : ""}" data-add-connect-point="${d.id}" type="button"><strong>●</strong><span>CONNECT POINT</span></button>
                        <button class="iem-cad-tool iem-wire-tool" data-wire-mode="${d.id}" type="button"><strong>⌁</strong><span>WIRE (OPTIONAL)</span></button>
                        <label class="iem-cad-route-mode"><span>ROUTING</span><select data-wire-routing><option value="orthogonal" ${state.wireRouting === "orthogonal" ? "selected" : ""}>90°</option><option value="45" ${state.wireRouting === "45" ? "selected" : ""}>45°</option><option value="free" ${state.wireRouting === "free" ? "selected" : ""}>FREE</option></select></label>
                    </aside>
                    <div class="iem-cad-canvas-wrap">
                        <svg class="iem-cad-canvas" id="cad-${d.id}" data-cad-driver="${d.id}" viewBox="0 0 900 360" aria-label="Circuit schematic"></svg>
                        <div class="iem-cad-help">TIP · Click CONNECT POINT, then click the grid to place a cable junction · Click two connection points to cable them · CAD parts snap to the grid by default · Hold components to move · Shift temporarily disables snapping · Double-click for Properties.</div>
                    </div>
                </div>
                <div class="iem-filter-editor">
                    <div class="iem-filter-head">
                        <div><span class="eyebrow">RESPONSE FILTERS</span><strong>High Pass</strong></div>
                        <div class="iem-filter-actions">
                            <button class="iem-mini" data-add-filter="${d.id}:high_pass">+ HIGH PASS</button>
                        </div>
                    </div>
                    <div class="iem-filter-order-wrap"><span class="eyebrow">SIGNAL ORDER</span>${filterOrderHtml(d)}</div><div class="iem-filter-list">${d.circuit.filters.map((filter, i) => filterNode(d, filter, i)).join("") || '<div class="iem-field-note">No response filters. High Pass can be added here; Low Pass is a component in Circuit CAD.</div>'}</div>
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

    function circuitPropertiesHtml(d) {
        const selection = state.selectedCircuit?.driverId === d.id ? d.circuit.components.find(c => c.id === state.selectedCircuit.componentId) : null;
        if (!selection) {
            return `<span class="eyebrow">PROPERTIES</span><h4>Nothing selected.</h4><p>Select a component in the schematic to edit value, nodes, bypass state, copy or delete it.</p>`;
        }
        const options = d.circuit.nodes.map(node => `<option value="${node.id}">${esc(node.label || node.id)}</option>`).join("");
        const unit = selection.kind === "resistor" ? "Ω" : selection.kind === "capacitor" ? "µF" : selection.kind === "inductor" ? "mH" : "";
        return `
            <span class="eyebrow">PROPERTIES</span>
            <h4>${esc(selection.label || selection.id)}</h4>
            <label>LABEL<input data-cad-prop="label" data-cad-id="${d.id}:${selection.id}" value="${esc(selection.label || "")}"></label>
            ${selection.kind !== "wire" ? `<label>VALUE ${unit}<input data-cad-prop="value" data-cad-id="${d.id}:${selection.id}" type="number" step="0.01" value="${selection.value}"></label>` : ""}
            <label>NODE A<select data-cad-prop="nodeA" data-cad-id="${d.id}:${selection.id}">${options}</select></label>
            <label>NODE B<select data-cad-prop="nodeB" data-cad-id="${d.id}:${selection.id}">${options}</select></label>
            <label class="iem-cad-check"><input data-cad-prop="bypassed" data-cad-id="${d.id}:${selection.id}" type="checkbox" ${selection.bypassed ? "checked" : ""}> BYPASS / SHORT</label>
            <div class="iem-cad-prop-actions">
                <button class="iem-mini" data-cad-copy="${d.id}:${selection.id}">COPY</button>
                <button class="iem-mini" data-cad-duplicate="${d.id}:${selection.id}">DUPLICATE</button>
                <button class="iem-mini" data-cad-delete="${d.id}:${selection.id}">DELETE</button>
            </div>`;
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
        if (!d.circuit.filters.length) return '<div class="iem-field-note">No response filters. Add High Pass here; Low Pass is available directly in Circuit CAD.</div>';
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
                    <div class="iem-property-order-actions"><button class="outline-button" data-property-filter-move="-1" type="button">← MOVE EARLIER</button><button class="outline-button" data-property-filter-move="1" type="button">MOVE LATER →</button></div>
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
        const node = nodeById(d, endpoint?.nodeId || fallbackNodeId);
        return node ? { x: node.x, y: node.y } : null;
    }

    function terminalConnectionCount(d, componentId, side) {
        return d.circuit.components.filter(c => c.kind === "wire" && (
            (c.endpointA?.componentId === componentId && c.endpointA?.side === side) ||
            (c.endpointB?.componentId === componentId && c.endpointB?.side === side)
        )).length;
    }

    function driverTerminalConnectionCount(d, side) {
        return d.circuit.components.filter(c => c.kind === "wire" && (
            c.endpointA?.driverTerminal === side || c.endpointB?.driverTerminal === side
        )).length;
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

        for (const component of circuit.components) {
            const a = nodeById(d, component.nodeA);
            const b = nodeById(d, component.nodeB);
            if (!a || !b) continue;

            if (component.kind === "wire") {
                const startPoint = cadTerminalPoint(d, component.endpointA, component.nodeA) || a;
                const endPoint = cadTerminalPoint(d, component.endpointB, component.nodeB) || b;
                const pts = [startPoint, ...(Array.isArray(component.route) ? component.route : []), endPoint];
                const dPath = pts.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ");
                const selected = state.selectedCircuit?.driverId === d.id && state.selectedCircuit.componentId === component.id;
                // Wide transparent hit path fixes the old hard-to-click line behaviour.
                lines.push(`<path class="iem-cad-wire-hit" data-cad-wire="${d.id}:${component.id}" d="${dPath}"/>`);
                lines.push(`<path class="iem-cad-wire user-wire ${selected ? "selected" : ""}" data-cad-wire-visual="${d.id}:${component.id}" d="${dPath}"/>`);
                if (selected) {
                    (component.route || []).forEach((p, i) => nodes.push(`<circle class="iem-wire-bend" data-wire-bend="${d.id}:${component.id}:${i}" cx="${p.x}" cy="${p.y}" r="6"/>`));
                }
                continue;
            }

            const x = Number.isFinite(component.x) ? component.x : snap((a.x + b.x) / 2);
            const y = Number.isFinite(component.y) ? component.y : snap((a.y + b.y) / 2);
            component.x = x;
            component.y = y;
            const selected = state.selectedCircuit?.driverId === d.id && state.selectedCircuit.componentId === component.id;
            const angle = componentDisplayAngle(d, component);
            const rad = angle * Math.PI / 180;
            const tx1 = x - 48 * Math.cos(rad);
            const ty1 = y - 48 * Math.sin(rad);
            const tx2 = x + 48 * Math.cos(rad);
            const ty2 = y + 48 * Math.sin(rad);

            components.push(`
                <g class="iem-cad-component ${selected ? "selected" : ""} ${component.bypassed ? "bypassed" : ""}" data-cad-component="${d.id}:${component.id}" transform="translate(${x},${y})">
                    <g class="iem-cad-symbol-rotator" transform="rotate(${angle})">${componentSymbolSvg(component)}<circle class="iem-cad-component-terminal ${terminalConnectionCount(d, component.id, "a") ? "connected" : ""}" data-cad-terminal="${d.id}:${component.id}:a" cx="-48" cy="0" r="7"/><circle class="iem-cad-component-terminal ${terminalConnectionCount(d, component.id, "b") ? "connected" : ""}" data-cad-terminal="${d.id}:${component.id}:b" cx="48" cy="0" r="7"/></g>
                    ${rotationHandleSvg(d, component, angle)}
                    <text class="ref" text-anchor="middle" y="-25">${esc(component.label || component.id)}</text>
                    <text class="value" text-anchor="middle" y="31">${esc(componentLabel(component).replace(component.label || component.id, "").trim())}</text>
                </g>`);
        }

        for (const node of circuit.nodes) {
            if (node.hidden || (node.id !== circuit.input && node.id !== circuit.ground)) continue;
            const special = node.id === circuit.input ? "input" : node.id === circuit.ground ? "ground" : node.id === circuit.output ? "output" : "";
            const wireActive = state.wireStart?.driverId === d.id && state.wireStart.nodeId === node.id;
            if (node.id === circuit.ground) {
                nodes.push(`
                    <g class="iem-cad-node ground ${wireActive ? "wire-active" : ""}" data-cad-node="${d.id}:${node.id}" transform="translate(${node.x},${node.y})">
                        ${groundSymbolSvg(0, 0)}
                        <circle cx="0" cy="-12" r="5"/>
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
            driverNode.x = driverX - 38; driverNode.y = driverY; driverNode.hidden = true;
            components.push(`<g data-cad-driver-symbol="${d.id}">${driverSymbolSvg(d, driverX, driverY)}<circle class="iem-cad-component-terminal ${driverTerminalConnectionCount(d, "plus") ? "connected" : ""}" data-cad-driver-terminal="${d.id}:plus" cx="${driverX - 38}" cy="${driverY}" r="7"/><circle class="iem-cad-component-terminal ${driverTerminalConnectionCount(d, "minus") ? "connected" : ""}" data-cad-driver-terminal="${d.id}:minus" cx="${driverX}" cy="${driverY + 38}" r="7"/></g>`);
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

    function groupUpdateRotation(svg, d, component, angle) {
        const group = svg.querySelector(`[data-cad-component="${d.id}:${component.id}"]`);
        const rotator = group?.querySelector(".iem-cad-symbol-rotator");
        if (rotator) rotator.setAttribute("transform", `rotate(${angle})`);
        const text = group?.querySelector(".iem-cad-rotation-text");
        if (text) text.textContent = `${angle}°`;
    }

    function bindCadSvg(d, svg) {
        const point = event => {
            const rect = svg.getBoundingClientRect();
            const rawX = (event.clientX - rect.left) * 900 / rect.width;
            const rawY = (event.clientY - rect.top) * 360 / rect.height;
            const shouldSnap = state.cadSnapToGrid && !event.shiftKey;
            return {
                x: clamp(shouldSnap ? snap(rawX) : rawX, 20, 880),
                y: clamp(shouldSnap ? snap(rawY) : rawY, 20, 340),
            };
        };

        const setSelection = componentId => {
            state.selectedCircuit = { driverId: d.id, componentId };
            svg.querySelectorAll("[data-cad-component]").forEach(el => {
                const [, id] = el.dataset.cadComponent.split(":");
                el.classList.toggle("selected", id === componentId);
            });
            svg.querySelectorAll("[data-cad-wire-visual]").forEach(el => {
                const [, id] = el.dataset.cadWireVisual.split(":");
                el.classList.toggle("selected", id === componentId);
            });
        };

        const updateGeometry = () => {
            for (const component of d.circuit.components) {
                const a = nodeById(d, component.nodeA);
                const b = nodeById(d, component.nodeB);
                if (!a || !b) continue;
                if (component.kind === "wire") {
                    const startPoint = cadTerminalPoint(d, component.endpointA, component.nodeA) || a;
                    const endPoint = cadTerminalPoint(d, component.endpointB, component.nodeB) || b;
                    const pts = [startPoint, ...(component.route || []), endPoint];
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

            const out = nodeById(d, d.circuit.output) || nodeById(d, d.circuit.input);
            if (out) {
                const driverX = Math.min(840, out.x + 120);
                svg.querySelector(`[data-cad-driver-lead="${d.id}"]`)?.setAttribute("d", `M ${out.x} ${out.y} L ${driverX - 30} ${out.y}`);
                const holder = svg.querySelector(`[data-cad-driver-symbol="${d.id}"]`);
                if (holder) holder.innerHTML = driverSymbolSvg(d, driverX, out.y);
            }
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
                let armed = false;
                let moved = false;
                let ended = false;

                group.classList.add("hold-pending");
                const holdTimer = window.setTimeout(() => {
                    if (ended) return;
                    armed = true;
                    group.classList.remove("hold-pending");
                    group.classList.add("hold-dragging");
                }, state.cadHoldToDragMs);

                const move = ev => {
                    ev.preventDefault();
                    const p = point(ev);
                    const distance = Math.hypot(p.x - startPoint.x, p.y - startPoint.y);
                    if (!armed) {
                        // A quick movement before the hold threshold remains a selection gesture.
                        if (distance > 12) group.classList.add("hold-needs-pause");
                        return;
                    }
                    moved = true;
                    component.x = clamp(p.x + offsetX, 20, 880);
                    component.y = clamp(p.y + offsetY, 20, 340);
                    if (state.cadSnapToGrid && !ev.shiftKey) {
                        component.x = snap(component.x);
                        component.y = snap(component.y);
                    }
                    updateGeometry();
                };

                const up = () => {
                    ended = true;
                    window.clearTimeout(holdTimer);
                    group.classList.remove("hold-pending", "hold-dragging", "hold-needs-pause");
                    window.removeEventListener("pointermove", move);
                    window.removeEventListener("pointerup", up);
                    window.removeEventListener("pointercancel", up);
                    if (moved) commitDrag(before);
                    renderCircuitSvg(d);
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
                const [, componentId] = handle.dataset.cadRotate.split(":");
                const component = d.circuit.components.find(c => c.id === componentId);
                if (!component) return;
                setSelection(componentId);
                const before = JSON.stringify(d.circuit);
                const rect = svg.getBoundingClientRect();
                const toSvgPoint = ev => ({
                    x: (ev.clientX - rect.left) * 900 / rect.width,
                    y: (ev.clientY - rect.top) * 360 / rect.height,
                });
                const move = ev => {
                    ev.preventDefault();
                    const p = toSvgPoint(ev);
                    const degrees = Math.atan2(p.y - component.y, p.x - component.x) * 180 / Math.PI + 90;
                    component.rotationDeg = normalizeRotation45(degrees);
                    const angle = componentDisplayAngle(d, component);
                    groupUpdateRotation(svg, d, component, angle);
                    updateGeometry();
                };
                const up = () => {
                    window.removeEventListener("pointermove", move);
                    window.removeEventListener("pointerup", up);
                    window.removeEventListener("pointercancel", up);
                    commitDrag(before);
                    renderCircuitSvg(d);
                    calculate();
                };
                window.addEventListener("pointermove", move, { passive: false });
                window.addEventListener("pointerup", up, { once: true });
                window.addEventListener("pointercancel", up, { once: true });
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

        // v0.22: click-to-click cabling. Click one connection point, then click the
        // destination point. The route is generated automatically; dragging is no
        // longer required to make a connection.
        const handleEndpointClick = (event, info) => {
            if (event.button !== 0 || !info) return;
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
                    if (moved) commitDrag(before);
                    renderCircuitSvg(d);
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
                setSelection(componentId);
                renderCircuitSvg(d);
            };
            path.ondblclick = event => {
                event.preventDefault(); event.stopPropagation();
                const [, componentId] = path.dataset.cadWire.split(":");
                const wire = d.circuit.components.find(c => c.id === componentId && c.kind === "wire");
                if (!wire) return;
                const before = JSON.stringify(d.circuit);
                const p = point(event);
                if (!Array.isArray(wire.route)) wire.route = [];
                wire.route.push(p);
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
            const pts = [...state.wireDraft.points, state.wireDraft.cursor];
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
            if (event.target.closest?.("[data-cad-node], [data-cad-component], [data-cad-wire]")) return;
            addWireBend(d, point(event));
        };

        svg.ondragover = event => event.preventDefault();
        svg.ondrop = event => {
            event.preventDefault();
            const payload = event.dataTransfer.getData("text/plain");
            if (!payload.startsWith(`${d.id}:`)) return;
            const type = payload.split(":")[1];
            addCadComponent(d, type);
        };
    }

    function historyFor(d) {
        if (!state.histories.has(d.id)) state.histories.set(d.id, { undo: [], redo: [] });
        return state.histories.get(d.id);
    }

    function mutateCircuit(d, mutation, rerender = true) {
        const history = historyFor(d);
        history.undo.push(JSON.stringify(d.circuit));
        if (history.undo.length > 50) history.undo.shift();
        history.redo = [];
        mutation();
        if (rerender) renderDrivers();
    }

    function undoCircuit(d) {
        const history = historyFor(d);
        if (!history.undo.length) return;
        history.redo.push(JSON.stringify(d.circuit));
        d.circuit = JSON.parse(history.undo.pop());
        state.selectedCircuit = null;
        renderDrivers();
    }

    function redoCircuit(d) {
        const history = historyFor(d);
        if (!history.redo.length) return;
        history.undo.push(JSON.stringify(d.circuit));
        d.circuit = JSON.parse(history.redo.pop());
        state.selectedCircuit = null;
        renderDrivers();
    }

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

    function addCadComponent(d, type) {
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
            d.circuit.components.push({
                id: uid(), label, kind, value: defaultValue(kind), nodeA, nodeB,
                bypassed: false, rotationDeg: 0, x: snap(410), y: snap(180),
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

        const startNode = state.wireStart.nodeId;
        const startEndpoint = state.wireStart.endpoint || { nodeId: startNode };
        if (startNode === nodeId && !endpoint?.componentId && !startEndpoint?.componentId) return;
        const draft = state.wireDraft;
        const startPoint = draft?.points?.[0] || cadTerminalPoint(d, startEndpoint, startNode);
        const route = [];
        // Automatically line the two clicked connection points up. A straight wire
        // is used when possible; otherwise use a clean orthogonal dog-leg with a
        // centred trunk so moving parts remains visually predictable.
        if (startPoint) {
            const dx = Math.abs(visualPoint.x - startPoint.x);
            const dy = Math.abs(visualPoint.y - startPoint.y);
            if (dx > 1 && dy > 1) {
                const midX = snap((startPoint.x + visualPoint.x) / 2);
                route.push({ x: midX, y: startPoint.y });
                route.push({ x: midX, y: visualPoint.y });
            }
        }
        state.wireStart = null;
        state.wireDraft = null;
        mutateCircuit(d, () => {
            d.circuit.components.push({
                id: uid(), label: nextComponentLabel(d, "wire"), kind: "wire", value: 0,
                nodeA: startNode, nodeB: nodeId, bypassed: false, route,
                endpointA: startEndpoint,
                endpointB: endpoint,
            });
        });
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

    function mainSeriesPathComponents(d) {
        const result = [];
        let current = d.circuit.input;
        const visited = new Set();
        while (current !== d.circuit.output && !visited.has(current)) {
            visited.add(current);
            const candidate = d.circuit.components.find(c => !c.bypassed && c.kind !== "wire" && c.nodeA === current && c.nodeB !== d.circuit.ground);
            if (!candidate) break;
            result.push(candidate);
            current = candidate.nodeB;
        }
        return result;
    }

    function moveSeriesComponent(d, componentId, direction) {
        const series = mainSeriesPathComponents(d);
        const index = series.findIndex(c => c.id === componentId);
        const otherIndex = index + direction;
        if (index < 0 || otherIndex < 0 || otherIndex >= series.length) return;
        const a = series[index];
        const b = series[otherIndex];
        mutateCircuit(d, () => {
            // Swap component electrical identities while preserving the node chain.
            const fields = ["kind", "value", "label", "bypassed"];
            for (const field of fields) [a[field], b[field]] = [b[field], a[field]];
        });
        closeCircuitPropertyPage();
        renderDrivers();
        calculate();
    }

    function openCircuitPropertyPage(d, componentId) {
        const component = d?.circuit?.components?.find(c => c.id === componentId);
        const modal = $("iemCadPropertyModal");
        const body = $("iemCadPropertyBody");
        if (!component || !modal || !body) return;

        const draft = structuredClone(component);
        const options = d.circuit.nodes.map(node => `<option value="${node.id}">${esc(node.label || node.id)}</option>`).join("");
        const meta = component.kind === "resistor"
            ? { title: "Resistor", unit: "Ω", extra: '<label>TOLERANCE %<input data-property-extra="tolerance" type="number" min="0" step="0.1" value="1"></label><label>POWER RATING W<input data-property-extra="power" type="number" min="0" step="0.01" value="0.25"></label>' }
            : component.kind === "capacitor"
            ? { title: "Capacitor", unit: "µF", extra: '<label>TOLERANCE %<input data-property-extra="tolerance" type="number" min="0" step="0.1" value="10"></label><label>VOLTAGE RATING V<input data-property-extra="voltage" type="number" min="0" step="1" value="50"></label>' }
            : component.kind === "inductor"
            ? { title: "Inductor", unit: "mH", extra: '<label>TOLERANCE %<input data-property-extra="tolerance" type="number" min="0" step="0.1" value="10"></label><label>DCR Ω<input data-property-extra="dcr" type="number" min="0" step="0.01" value="0"></label>' }
            : component.kind === "low_pass"
            ? { title: "Low-Pass Filter", unit: "Hz", extra: `<label>Q<input data-property-field="q" type="number" min="0.05" step="0.01" value="${component.q || 0.707}"></label>` }
            : { title: "Wire", unit: "", extra: "" };

        body.innerHTML = `
            <div class="iem-property-hero">
                <div class="iem-property-symbol">${componentSymbolSvg(component)}</div>
                <div><span class="eyebrow">COMPONENT PROPERTY</span><h2>${meta.title} ${esc(component.label || component.id)}</h2><p>Changes are staged here. The circuit is only updated when you press Apply Changes.</p></div>
            </div>
            <div class="iem-property-grid">
                <section class="iem-property-section"><span class="eyebrow">COMPONENT</span>
                    <label>REFERENCE<input data-property-field="label" value="${esc(draft.label || "")}"></label>
                    ${component.kind === "low_pass" ? `<label>CUTOFF FREQUENCY Hz<input data-property-field="frequency" type="number" min="1" step="1" value="${draft.frequency || 400}"></label>` : component.kind !== "wire" ? `<label>VALUE ${meta.unit}<input data-property-field="value" type="number" step="0.01" value="${draft.value}"></label>` : ""}
                    ${meta.extra}
                </section>
                <section class="iem-property-section"><span class="eyebrow">CONNECTION</span>
                    <label>NODE A<select data-property-field="nodeA">${options}</select></label>
                    <label>NODE B<select data-property-field="nodeB">${options}</select></label>
                    <label class="iem-cad-check"><input data-property-field="bypassed" type="checkbox" ${draft.bypassed ? "checked" : ""}> BYPASS / SHORT</label>
                    ${component.kind !== "wire" ? `<div class="iem-property-rotation"><span class="eyebrow">ORIENTATION</span><label>ANGLE<select data-property-field="rotationDeg"><option value="auto" ${draft.rotationDeg === null || draft.rotationDeg === undefined ? "selected" : ""}>Auto from connection</option>${[0,45,90,135,180,225,270,315].map(angle => `<option value="${angle}" ${draft.rotationDeg !== null && draft.rotationDeg !== undefined && normalizeRotation45(draft.rotationDeg) === angle ? "selected" : ""}>${angle}°</option>`).join("")}</select></label><div class="iem-property-rotate-actions"><button class="outline-button" data-property-rotate="-45" type="button">↶ ROTATE -45°</button><button class="outline-button" data-property-rotate="45" type="button">ROTATE +45° ↷</button></div></div>` : ""}
                    <div class="iem-property-order-actions"><button class="outline-button" data-component-move="-1" type="button">← MOVE EARLIER</button><button class="outline-button" data-component-move="1" type="button">MOVE LATER →</button></div>
                </section>
                <section class="iem-property-section"><span class="eyebrow">CALCULATED DATA</span><div id="iemPropertyCalculated" class="iem-property-calculated"></div></section>
            </div>`;
        const propertySymbol = body.querySelector('.iem-property-symbol svg');
        if (propertySymbol) propertySymbol.style.transform = `rotate(${componentDisplayAngle(d, component)}deg)`;
        body.querySelector('[data-property-field="nodeA"]').value = draft.nodeA;
        body.querySelector('[data-property-field="nodeB"]').value = draft.nodeB;
        body.querySelectorAll('[data-component-move]').forEach(button => button.onclick = () => moveSeriesComponent(d, component.id, Number(button.dataset.componentMove)));
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
        if (component) state.circuitClipboard = structuredClone(component);
    }

    function duplicateCircuitComponent(d, id) {
        const component = d.circuit.components.find(c => c.id === id);
        if (!component) return;
        mutateCircuit(d, () => {
            const copy = structuredClone(component);
            copy.id = uid();
            copy.label = nextComponentLabel(d, copy.kind);
            copy.x = (copy.x || 400) + 20;
            copy.y = (copy.y || 160) + 40;
            d.circuit.components.push(copy);
        });
    }

    function deleteCircuitComponent(d, id) {
        mutateCircuit(d, () => {
            d.circuit.components = d.circuit.components.filter(c => c.id !== id);
            if (state.selectedCircuit?.componentId === id) state.selectedCircuit = null;
        });
    }

    // ---------------------------------------------------------------------
    // Acoustic path editor.
    // ---------------------------------------------------------------------

    function pathHtml(d) {
        return `
            <section class="iem-driver-section">
                <div class="iem-panel-title"><div><span class="eyebrow">ACOUSTIC PATH</span><h3>Driver to nozzle.</h3></div></div>
                <div class="iem-path-toolbar">
                    ${[["tube", "+ TUBE"], ["damper", "+ DAMPER"], ["chamber", "+ CHAMBER"], ["nozzle", "+ NOZZLE"]].map(item => `<button class="iem-mini" data-add-path="${d.id}:${item[0]}">${item[1]}</button>`).join("")}
                </div>
                <div class="iem-path-list">${d.path.map((element, index) => pathNode(d, element, index)).join("") || '<div class="iem-field-note">No acoustic elements.</div>'}</div>
            </section>`;
    }

    function pathNode(d, element, index) {
        let fields = "";
        if (element.type === "damper") {
            fields = `<label>RESISTANCE Ω<input data-path-field="value" value="${element.value}" type="number"></label>`;
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
        const element = find(id)[property][+index];
        node.querySelectorAll(`[data-${property}-field]`).forEach(input => element[input.dataset[property + "Field"]] = num(input.value));
    }

    function syncAll() {
        document.querySelectorAll(".iem-driver-card").forEach(card => {
            const d = find(card.dataset.driverId);
            if (!d) return;
            card.querySelectorAll("[data-f]").forEach(input => {
                const key = input.dataset.f;
                if (key === "name" || key === "type") d[key] = input.value;
                else if (key === "polarity") d.polarity = num(input.value, 1);
                else if (key === "responseAbsolute") d.responseAbsolute = input.value === "absolute";
                else d[key] = num(input.value, d[key]);
            });
        });
    }

    function bindDriverEvents() {
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
        document.querySelectorAll("[data-cad-symbol-standard]").forEach(select => select.onchange = () => {
            state.cadSymbolStandard = select.value === "ansi" ? "ansi" : "iec";
            state.drivers.forEach(driver => renderCircuitSvg(driver));
            renderDrivers();
        });
        document.querySelectorAll("[data-cad-snap-toggle]").forEach(toggle => toggle.onchange = () => {
            state.cadSnapToGrid = Boolean(toggle.checked);
            if (state.cadSnapToGrid) {
                state.drivers.forEach(d => {
                    ensureDriverShape(d);
                    d.circuit.components.forEach(c => {
                        if (c.kind !== "wire") { c.x = snap(num(c.x, 400)); c.y = snap(num(c.y, 180)); }
                        else if (Array.isArray(c.route)) c.route = c.route.map(p => ({ x: snap(p.x), y: snap(p.y) }));
                    });
                    d.circuit.nodes.forEach(n => { if (!n.hidden) { n.x = snap(n.x); n.y = snap(n.y); } });
                });
            }
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
            find(id).circuit.filters.push(newFilter(type));
            renderDrivers();
        });
        document.querySelectorAll("[data-remove-filter]").forEach(button => button.onclick = () => {
            const [id, index] = button.dataset.removeFilter.split(":");
            find(id).circuit.filters.splice(+index, 1);
            renderDrivers();
        });
        document.querySelectorAll("[data-filter-properties]").forEach(button => button.onclick = () => {
            const [id, index] = button.dataset.filterProperties.split(":");
            openFilterPropertyPage(find(id), +index);
        });
        document.querySelectorAll("[data-filter-earlier]").forEach(button => button.onclick = () => {
            const [id, index] = button.dataset.filterEarlier.split(":"); move(find(id).circuit.filters, +index, -1); renderDrivers(); calculate();
        });
        document.querySelectorAll("[data-filter-later]").forEach(button => button.onclick = () => {
            const [id, index] = button.dataset.filterLater.split(":"); move(find(id).circuit.filters, +index, 1); renderDrivers(); calculate();
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
                const filters = find(sourceDriver).circuit.filters;
                const [moved] = filters.splice(+sourceIndex, 1);
                filters.splice(+targetIndex, 0, moved);
                draggedFilter = null;
                renderDrivers(); calculate();
            };
        });
        document.querySelectorAll("[data-filter-node]").forEach(node => node.oninput = () => {
            const [id, index] = node.dataset.filterNode.split(":");
            const filter = find(id).circuit.filters[+index];
            node.querySelectorAll("[data-filter-field]").forEach(input => filter[input.dataset.filterField] = num(input.value));
        });

        document.querySelectorAll("[data-add-path]").forEach(button => button.onclick = () => {
            const [id, type] = button.dataset.addPath.split(":");
            find(id).path.push(newPath(type));
            renderDrivers();
        });
        document.querySelectorAll("[data-remove-path]").forEach(button => button.onclick = () => {
            const [id, index] = button.dataset.removePath.split(":");
            find(id).path.splice(+index, 1);
            renderDrivers();
        });
        document.querySelectorAll("[data-move-path]").forEach(button => button.onclick = () => {
            const [id, index, direction] = button.dataset.movePath.split(":");
            move(find(id).path, +index, +direction);
            renderDrivers();
        });
        document.querySelectorAll("[data-path-node]").forEach(node => node.oninput = () => syncNode(node, "path"));

        document.querySelectorAll("[data-fr-file]").forEach(input => input.onchange = async () => {
            const file = input.files[0];
            if (file) {
                find(input.dataset.frFile).measurement = await parseFile(file, "fr");
                renderDrivers();
            }
        });
        document.querySelectorAll("[data-z-file]").forEach(input => input.onchange = async () => {
            const file = input.files[0];
            if (file) {
                find(input.dataset.zFile).impedanceCurve = await parseFile(file, "z");
                renderDrivers();
            }
        });
    }

    async function parseFile(file, mode) {
        const output = [];
        for (const raw of (await file.text()).split(/\r?\n/)) {
            const line = raw.trim();
            if (!line || line.startsWith("#") || line.startsWith(";")) continue;
            const columns = line.split(/[\s,;\t]+/).filter(Boolean);
            const frequency = +columns[0];
            const value = +columns[1];
            const phase = +columns[2] || 0;
            if (Number.isFinite(frequency) && Number.isFinite(value) && frequency > 0) {
                output.push(mode === "z"
                    ? { frequency, ohm: value, phase }
                    : { frequency, db: value, phase });
            }
        }
        return output.sort((a, b) => a.frequency - b.frequency);
    }

    // ---------------------------------------------------------------------
    // Driver library.
    // ---------------------------------------------------------------------

    function saveLibrary(id) {
        syncAll();
        const d = structuredClone(find(id));
        d.id = uid();
        state.library = JSON.parse(localStorage.getItem("hc_iem_driver_library") || "[]");
        state.library.push(d);
        localStorage.setItem("hc_iem_driver_library", JSON.stringify(state.library));
        renderLibrary();
    }

    function renderLibrary() {
        state.library = JSON.parse(localStorage.getItem("hc_iem_driver_library") || "[]").map(ensureDriverShape);
        $("iemDriverLibrary").innerHTML = state.library.length
            ? state.library.map((d, i) => `<article class="iem-library-card"><span class="eyebrow">${esc(d.type.toUpperCase())}</span><h4>${esc(d.name)}</h4><p>${d.impedance} Ω · ${d.sensitivity || "—"} dB SPL</p><div class="iem-library-actions"><button class="outline-button" data-lib-use="${i}">ADD TO DESIGN</button><button class="danger-button" data-lib-delete="${i}">DELETE</button></div></article>`).join("")
            : '<div class="loading-card">No reusable drivers saved.</div>';
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
        $("iemReverseDriver").innerHTML = state.drivers.map((d, i) => `<option value="${i}">${esc(d.name)}</option>`).join("");
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
        return String(value).split(",").map(Number).filter(Number.isFinite);
    }

    async function reverseRun() {
        syncAll();
        if (state.reverse.length < 2) return;
        const driverIndex = +$("iemReverseDriver").value;
        const request = {
            base_request: rustRequest(logFreq(120)),
            target: state.reverse.map(p => ({ frequency_hz: p.frequency, db: p.db, phase_deg: 0 })),
            driver_index: driverIndex,
            min_tube_length_mm: num($("iemReverseLengthMin").value, 3),
            max_tube_length_mm: num($("iemReverseLengthMax").value, 20),
            min_tube_diameter_mm: num($("iemReverseDiameterMin").value, 0.8),
            max_tube_diameter_mm: num($("iemReverseDiameterMax").value, 3),
            damper_values: listNums($("iemReverseDampers").value),
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
        try {
            const results = await window.HCAcousticEngine.reverseDesign(request);
            $("iemReverseResults").innerHTML = results.map((candidate, index) => `
                <article class="iem-reverse-result-card">
                    <div class="iem-reverse-result-head">
                        <div><span class="eyebrow">CANDIDATE ${index + 1}</span><strong>${candidate.tube_diameter_mm.toFixed(2)} mm ID · ${candidate.tube_length_mm.toFixed(1)} mm</strong></div>
                        <strong>${(candidate.physical_rmse_db ?? candidate.score_rmse_db).toFixed(2)} dB RMSE</strong>
                    </div>
                    <p class="iem-field-note">${Math.round(candidate.damper_ohm)} Ω damper · ${candidate.capacitor_uf} µF series C · ${candidate.resistor_ohm} Ω series R · ${candidate.gain_db.toFixed(1)} dB gain</p>
                    <div class="iem-reverse-actions">
                        <button class="primary-button" type="button" data-apply-rev-physical="${index}">APPLY PHYSICAL DESIGN</button>
                    </div>
                </article>`).join("");

            document.querySelectorAll("[data-apply-rev-physical]").forEach(button => button.onclick = () => applyRevPhysical(results[+button.dataset.applyRevPhysical], driverIndex));
        } catch (error) {
            $("iemReverseMessage").textContent = error.message || "Reverse design failed";
        }
    }

    function applyRevPhysical(candidate, index, recalc = true) {
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
        } else if (damper) {
            d.path = d.path.filter(element => element !== damper);
        }
        const existingFilters = structuredClone(d.circuit?.filters || []);
        d.circuit = createCircuit();
        d.circuit.filters = existingFilters;
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
        localStorage.setItem("hc_iem_project", JSON.stringify({
            name: $("iemProjectName").value,
            drivers: state.drivers,
            target: state.target,
            reverseBase: state.reverseBase,
            targetPeq: state.targetPeq,
        }));
    }

    function loadProject() {
        try {
            const project = JSON.parse(localStorage.getItem("hc_iem_project") || "null");
            if (!project) return;
            $("iemProjectName").value = project.name || "Untitled IEM";
            state.drivers = (project.drivers || []).map(ensureDriverShape);
            state.target = project.target || [];
            state.reverseBase = project.reverseBase || [];
            state.targetPeq = project.targetPeq || [];
            rebuildReverseFromBase(false);
            renderTargetPeq();
            renderDrivers();
            refreshReverseDrivers();
            calculate();
        } catch (error) {
            console.error("Unable to load IEM project", error);
        }
    }

    function newProject() {
        state.drivers = [driver()];
        state.target = [];
        state.targetPeq = [];
        state.reverseBase = makeDefaultTargetPoints(50);
        state.reverse = structuredClone(state.reverseBase);
        renderTargetPeq();
        $("iemProjectName").value = "Untitled IEM";
        renderDrivers();
        refreshReverseDrivers();
        calculate();
        drawReverse();
    }

    function bind() {
        tabs();
        $("iemAddDriverButton").onclick = () => {
            state.drivers.push(driver());
            renderDrivers();
            refreshReverseDrivers();
        };
        $("iemCalculateButton").onclick = calculate;
        $("iemSaveProjectButton").onclick = saveProject;
        $("iemLoadProjectButton").onclick = loadProject;
        $("iemNewProjectButton").onclick = newProject;
        $("iemTargetProduct").onchange = event => loadTargetProduct(event.target.value);
        ["iemSplMode", "iemNormalizeFrequency", "iemNormalizeMode", "iemShowTarget", "iemShowIndividual", "iemShowCombined"].forEach(id => $(id).onchange = draw);
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
                setReverseBase(await parseFile(event.target.files[0], "fr"), true);
                if ($("iemReverseMatchMode")) $("iemReverseMatchMode").value = "absolute";
                if ($("iemReverseNormalizeFrequency")) $("iemReverseNormalizeFrequency").disabled = true;
                autoFitReverseView();
                drawReverse();
            }
        };
        $("iemReverseRunButton").onclick = reverseRun;

        document.addEventListener("keydown", event => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c" && state.selectedCircuit) {
                const d = find(state.selectedCircuit.driverId);
                copyCircuitComponent(d, state.selectedCircuit.componentId);
            }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v" && state.circuitClipboard && state.selectedCircuit) {
                const d = find(state.selectedCircuit.driverId);
                mutateCircuit(d, () => {
                    const copy = structuredClone(state.circuitClipboard);
                    copy.id = uid();
                    copy.label = nextComponentLabel(d, copy.kind);
                    copy.x = (copy.x || 400) + 40;
                    copy.y = (copy.y || 160) + 40;
                    d.circuit.components.push(copy);
                });
            }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && state.selectedCircuit) {
                event.preventDefault();
                undoCircuit(find(state.selectedCircuit.driverId));
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
                    d.circuit.filters.splice(index, 1);
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
        const editing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
        if (!editing && (event.key === "Delete" || event.key === "Backspace") && state.selectedCircuit) {
            event.preventDefault();
            const d = find(state.selectedCircuit.driverId);
            if (d) { deleteCircuitComponent(d, state.selectedCircuit.componentId); state.selectedCircuit = null; calculate(); }
            return;
        }
        if (event.key === "Escape" && state.wireStart) {
            const d = find(state.wireStart.driverId);
            if (d) cancelWireMode(d);
        }
    });

})();
