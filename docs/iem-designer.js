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
        chart: null,
        reverseChart: null,
        last: null,
        selectedCircuit: null,
        circuitClipboard: null,
        histories: new Map(),
        wireStart: null,
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
            output: "in",
            ground: "gnd",
            nodes: [
                { id: "in", label: "INPUT", x: 80, y: 120 },
                { id: "gnd", label: "GND", x: 450, y: 320 },
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
        if (!Array.isArray(d.circuit.filters)) d.circuit.filters = [];
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
        if (component.kind === "wire") return complex(1e-9, 0);
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
        if (filter.type === "peq") {
            const A = 10 ** ((filter.gain || 0) / 40);
            const numerator = cadd(cadd(s2, constant), complex(0, omega * w0 * A / q));
            const denominator = cadd(cadd(s2, constant), complex(0, omega * w0 / (A * q)));
            return cdiv(numerator, denominator);
        }
        return complex(1);
    }

    function circuitH(d, frequency) {
        let result = passiveCircuitH(d, frequency);
        for (const filter of ensureDriverShape(d).circuit.filters) result = cmul(result, filterH(filter, frequency));
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
        if (filter.type === "peq") return { type: "peaking_eq", frequency_hz: filter.frequency, gain_db: filter.gain, q: filter.q };
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
                    electrical: d.circuit.filters.map(toRustFilter).filter(Boolean),
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
                        <button class="iem-mini" data-circuit-undo="${d.id}">UNDO</button>
                        <button class="iem-mini" data-circuit-redo="${d.id}">REDO</button>
                        <button class="iem-mini" data-circuit-auto="${d.id}">AUTO ARRANGE</button>
                    </div>
                </div>
                <div class="iem-cad-workspace">
                    <aside class="iem-cad-palette">
                        <span class="iem-palette-title">COMPONENTS</span>
                        ${paletteButton(d.id, "resistor", "R", "RESISTOR")}
                        ${paletteButton(d.id, "capacitor", "C", "CAPACITOR")}
                        ${paletteButton(d.id, "inductor", "L", "INDUCTOR")}
                        ${paletteButton(d.id, "shunt_resistor", "R∥", "SHUNT R")}
                        ${paletteButton(d.id, "shunt_capacitor", "C∥", "SHUNT C")}
                        ${paletteButton(d.id, "shunt_inductor", "L∥", "SHUNT L")}
                        <button class="iem-cad-tool" data-add-junction="${d.id}" type="button"><strong>●</strong><span>JUNCTION</span></button>
                        <button class="iem-cad-tool" data-wire-mode="${d.id}" type="button"><strong>⌁</strong><span>WIRE</span></button>
                    </aside>
                    <div class="iem-cad-canvas-wrap">
                        <svg class="iem-cad-canvas" id="cad-${d.id}" data-cad-driver="${d.id}" viewBox="0 0 900 360" aria-label="Circuit schematic"></svg>
                        <div class="iem-cad-help">Drag nodes/components · click a component to edit · WIRE then click two nodes · mouse wheel/trackpad scrolls the page normally.</div>
                    </div>
                    <aside class="iem-cad-properties" id="cad-props-${d.id}">${circuitPropertiesHtml(d)}</aside>
                </div>
                <div class="iem-filter-editor">
                    <div class="iem-filter-head">
                        <div><span class="eyebrow">RESPONSE FILTERS</span><strong>PEQ / HP / LP</strong></div>
                        <div class="iem-filter-actions">
                            <button class="iem-mini" data-add-filter="${d.id}:peq">+ PEQ</button>
                            <button class="iem-mini" data-add-filter="${d.id}:high_pass">+ HIGH PASS</button>
                            <button class="iem-mini" data-add-filter="${d.id}:low_pass">+ LOW PASS</button>
                        </div>
                    </div>
                    <div class="iem-filter-list">${d.circuit.filters.map((filter, i) => filterNode(d, filter, i)).join("") || '<div class="iem-field-note">No PEQ/HP/LP blocks.</div>'}</div>
                </div>
            </section>`;
    }

    function paletteButton(driverId, type, symbol, label) {
        return `<button class="iem-cad-tool" draggable="true" data-cad-palette="${driverId}:${type}" type="button"><strong>${symbol}</strong><span>${label}</span></button>`;
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
        return `
            <div class="iem-filter-node" data-filter-node="${d.id}:${index}">
                <strong>${filter.type === "peq" ? "PEQ" : filter.type === "high_pass" ? "HIGH PASS" : "LOW PASS"}</strong>
                <label>FREQUENCY Hz<input data-filter-field="frequency" type="number" value="${filter.frequency}"></label>
                ${filter.type === "peq" ? `<label>GAIN dB<input data-filter-field="gain" type="number" step="0.1" value="${filter.gain}"></label>` : ""}
                <label>Q<input data-filter-field="q" type="number" step="0.01" value="${filter.q}"></label>
                <button class="iem-mini" data-remove-filter="${d.id}:${index}">REMOVE</button>
            </div>`;
    }

    function nodeById(d, id) {
        return d.circuit.nodes.find(node => node.id === id);
    }

    function componentLabel(component) {
        if (component.kind === "wire") return component.label || "WIRE";
        const unit = component.kind === "resistor" ? "Ω" : component.kind === "capacitor" ? "µF" : "mH";
        return `${component.label || component.id}  ${Number(component.value).toLocaleString()} ${unit}`;
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
        lines.push(`<rect width="900" height="360" fill="url(#grid-${d.id})"/>`);

        for (const component of circuit.components) {
            const a = nodeById(d, component.nodeA);
            const b = nodeById(d, component.nodeB);
            if (!a || !b) continue;
            const x = Number.isFinite(component.x) ? component.x : snap((a.x + b.x) / 2);
            const y = Number.isFinite(component.y) ? component.y : snap((a.y + b.y) / 2);
            component.x = x;
            component.y = y;
            const selected = state.selectedCircuit?.driverId === d.id && state.selectedCircuit.componentId === component.id;
            lines.push(`<path class="iem-cad-wire" d="M ${a.x} ${a.y} L ${x - 48} ${y} M ${x + 48} ${y} L ${b.x} ${b.y}"/>`);
            components.push(`
                <g class="iem-cad-component ${selected ? "selected" : ""} ${component.bypassed ? "bypassed" : ""}" data-cad-component="${d.id}:${component.id}" transform="translate(${x},${y})">
                    <rect x="-48" y="-22" width="96" height="44" rx="2"/>
                    <text text-anchor="middle" y="-3">${esc(component.label || component.id)}</text>
                    <text class="value" text-anchor="middle" y="13">${esc(component.kind === "wire" ? "WIRE" : componentLabel(component).replace(component.label || component.id, "").trim())}</text>
                </g>`);
        }

        for (const node of circuit.nodes) {
            const special = node.id === circuit.input ? "input" : node.id === circuit.ground ? "ground" : node.id === circuit.output ? "output" : "";
            const wireActive = state.wireStart?.driverId === d.id && state.wireStart.nodeId === node.id;
            nodes.push(`
                <g class="iem-cad-node ${special} ${wireActive ? "wire-active" : ""}" data-cad-node="${d.id}:${node.id}" transform="translate(${node.x},${node.y})">
                    <circle r="7"/>
                    <text text-anchor="middle" y="-14">${esc(node.label || node.id)}</text>
                </g>`);
        }

        if (driverNode) {
            lines.push(`<path class="iem-cad-wire" d="M ${driverNode.x} ${driverNode.y} L ${Math.min(855, driverNode.x + 70)} ${driverNode.y}"/>`);
            components.push(`
                <g class="iem-cad-driver" transform="translate(${Math.min(835, driverNode.x + 115)},${driverNode.y})">
                    <rect x="-42" y="-28" width="84" height="56" rx="2"/>
                    <text text-anchor="middle" y="-4">DRIVER</text>
                    <text class="value" text-anchor="middle" y="14">${esc(d.name)}</text>
                </g>`);
        }

        svg.innerHTML = lines.join("") + components.join("") + nodes.join("");
        bindCadSvg(d, svg);
        bindCircuitProperties(d);
    }

    function bindCadSvg(d, svg) {
        let drag = null;
        let moved = false;
        function point(event) {
            const rect = svg.getBoundingClientRect();
            return {
                x: clamp(snap((event.clientX - rect.left) * 900 / rect.width), 20, 880),
                y: clamp(snap((event.clientY - rect.top) * 360 / rect.height), 20, 340),
            };
        }

        svg.querySelectorAll("[data-cad-component]").forEach(group => {
            group.onpointerdown = event => {
                event.preventDefault();
                const [, componentId] = group.dataset.cadComponent.split(":");
                state.selectedCircuit = { driverId: d.id, componentId };
                drag = { type: "component", id: componentId, start: point(event), before: JSON.stringify(d.circuit) };
                moved = false;
                svg.setPointerCapture?.(event.pointerId);
                renderCircuitSvg(d);
            };
        });

        svg.querySelectorAll("[data-cad-node]").forEach(group => {
            group.onpointerdown = event => {
                event.preventDefault();
                const [, nodeId] = group.dataset.cadNode.split(":");
                if (state.wireStart?.driverId === d.id) {
                    finishWireMode(d, nodeId);
                    return;
                }
                drag = { type: "node", id: nodeId, start: point(event), before: JSON.stringify(d.circuit) };
                moved = false;
                svg.setPointerCapture?.(event.pointerId);
            };
        });

        svg.onpointermove = event => {
            if (!drag) return;
            const p = point(event);
            if (Math.abs(p.x - drag.start.x) + Math.abs(p.y - drag.start.y) > 5) moved = true;
            if (!moved) return;
            if (drag.type === "component") {
                const component = d.circuit.components.find(c => c.id === drag.id);
                if (component) {
                    component.x = p.x;
                    component.y = p.y;
                    const group = svg.querySelector(`[data-cad-component="${d.id}:${drag.id}"]`);
                    group?.setAttribute("transform", `translate(${p.x},${p.y})`);
                }
            } else {
                const node = nodeById(d, drag.id);
                if (node) {
                    node.x = p.x;
                    node.y = p.y;
                    const group = svg.querySelector(`[data-cad-node="${d.id}:${drag.id}"]`);
                    group?.setAttribute("transform", `translate(${p.x},${p.y})`);
                }
            }
        };
        svg.onpointerup = () => {
            const finished = drag;
            const shouldRender = Boolean(finished && moved);
            drag = null;
            if (shouldRender) {
                const history = historyFor(d);
                history.undo.push(finished.before);
                if (history.undo.length > 50) history.undo.shift();
                history.redo = [];
                renderCircuitSvg(d);
            }
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
        const prefix = kind === "resistor" ? "R" : kind === "capacitor" ? "C" : kind === "inductor" ? "L" : "W";
        let n = 1;
        const used = new Set(d.circuit.components.map(c => c.label));
        while (used.has(`${prefix}${n}`)) n++;
        return `${prefix}${n}`;
    }

    function defaultValue(kind) {
        if (kind === "capacitor") return 22;
        if (kind === "inductor") return 0.1;
        if (kind === "wire") return 0;
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
            x: snap(((oldOutput?.x || 80) + newX) / 2),
            y: oldOutput?.y || 120,
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
            x: output?.x || 450,
            y: snap(((output?.y || 120) + (ground?.y || 320)) / 2),
        });
        if (rerender) renderDrivers();
    }

    function addCadComponent(d, type) {
        mutateCircuit(d, () => {
            if (type.startsWith("shunt_")) appendShuntComponent(d, type.replace("shunt_", ""), undefined, false);
            else appendSeriesComponent(d, type, undefined, false);
        });
    }

    function addJunction(d) {
        mutateCircuit(d, () => {
            d.circuit.nodes.push({ id: uid(), label: `J${d.circuit.nodes.length - 1}`, x: 450, y: 220 });
        });
    }

    function startWireMode(d) {
        state.wireStart = { driverId: d.id, nodeId: null };
        const svg = $(`cad-${d.id}`);
        if (svg) svg.classList.add("wire-mode");
        // First node click sets start; second completes. We signal this with null.
        state.wireStart.nodeId = "__await_first__";
    }

    function finishWireMode(d, nodeId) {
        if (!state.wireStart || state.wireStart.driverId !== d.id) return;
        if (state.wireStart.nodeId === "__await_first__") {
            state.wireStart.nodeId = nodeId;
            renderCircuitSvg(d);
            return;
        }
        const start = state.wireStart.nodeId;
        state.wireStart = null;
        if (start === nodeId) {
            renderCircuitSvg(d);
            return;
        }
        mutateCircuit(d, () => {
            const a = nodeById(d, start);
            const b = nodeById(d, nodeId);
            d.circuit.components.push({
                id: uid(),
                label: nextComponentLabel(d, "wire"),
                kind: "wire",
                value: 0,
                nodeA: start,
                nodeB: nodeId,
                bypassed: false,
                x: snap(((a?.x || 0) + (b?.x || 0)) / 2),
                y: snap(((a?.y || 0) + (b?.y || 0)) / 2),
            });
        });
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

    function bindCircuitProperties(d) {
        const selection = state.selectedCircuit?.driverId === d.id ? d.circuit.components.find(c => c.id === state.selectedCircuit.componentId) : null;
        if (!selection) return;
        const props = $(`cad-props-${d.id}`);
        if (!props) return;
        const nodeA = props.querySelector('[data-cad-prop="nodeA"]');
        const nodeB = props.querySelector('[data-cad-prop="nodeB"]');
        if (nodeA) nodeA.value = selection.nodeA;
        if (nodeB) nodeB.value = selection.nodeB;

        props.querySelectorAll("[data-cad-prop]").forEach(input => {
            input.onchange = () => {
                mutateCircuit(d, () => {
                    const component = d.circuit.components.find(c => c.id === selection.id);
                    if (!component) return;
                    const key = input.dataset.cadProp;
                    if (key === "bypassed") component.bypassed = input.checked;
                    else if (key === "value") component.value = num(input.value, component.value);
                    else component[key] = input.value;
                });
            };
        });
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
        if (type === "peq") return { type, frequency: 3000, gain: -3, q: 2 };
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
        document.querySelectorAll("[data-add-junction]").forEach(button => button.onclick = () => addJunction(find(button.dataset.addJunction)));
        document.querySelectorAll("[data-wire-mode]").forEach(button => button.onclick = () => startWireMode(find(button.dataset.wireMode)));
        document.querySelectorAll("[data-circuit-undo]").forEach(button => button.onclick = () => undoCircuit(find(button.dataset.circuitUndo)));
        document.querySelectorAll("[data-circuit-redo]").forEach(button => button.onclick = () => redoCircuit(find(button.dataset.circuitRedo)));
        document.querySelectorAll("[data-circuit-auto]").forEach(button => button.onclick = () => autoArrange(find(button.dataset.circuitAuto)));
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

    function reverseFlat() {
        state.reverse = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].map(frequency => ({ frequency, db: 0 }));
        drawReverse();
    }

    function drawReverse() {
        if (!window.Chart) return;
        if (state.reverse.length < 2) reverseFlat();
        state.reverseChart?.destroy();
        state.reverseChart = new Chart($("iemReverseChart"), {
            type: "line",
            data: { datasets: [{ label: "Desired response", data: state.reverse.map(p => ({ x: p.frequency, y: p.db })), pointRadius: 4, borderWidth: 2 }] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                parsing: false,
                scales: { x: { type: "logarithmic", min: 20, max: 20000 }, y: { min: -30, max: 20 } },
            },
        });
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
            state.reverse.forEach((p, i) => {
                const distance = Math.abs(Math.log10(p.frequency) - log);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestIndex = i;
                }
            });
            const next = { frequency: clamp(frequency, 20, 20000), db: clamp(db, -30, 20) };
            if (bestDistance < 0.05) state.reverse[bestIndex] = next;
            else state.reverse.push(next);
            state.reverse.sort((a, b) => a.frequency - b.frequency);
            drawReverseDataset();
        }
        canvas.onpointerdown = event => {
            drawing = true;
            canvas.setPointerCapture(event.pointerId);
            point(event);
        };
        canvas.onpointermove = event => { if (drawing) point(event); };
        canvas.onpointerup = () => drawing = false;
        canvas.oncontextmenu = event => {
            event.preventDefault();
            if (state.reverse.length <= 2) return;
            const rect = canvas.getBoundingClientRect();
            const frequency = state.reverseChart.scales.x.getValueForPixel(event.clientX - rect.left);
            const log = Math.log10(frequency);
            let bestIndex = 0;
            let bestDistance = Infinity;
            state.reverse.forEach((p, i) => {
                const distance = Math.abs(Math.log10(p.frequency) - log);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestIndex = i;
                }
            });
            state.reverse.splice(bestIndex, 1);
            drawReverseDataset();
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
        };
        if (!window.HCAcousticEngine) {
            $("iemReverseMessage").textContent = "Build the Rust/WASM engine first for reverse optimisation.";
            return;
        }
        try {
            const results = await window.HCAcousticEngine.reverseDesign(request);
            $("iemReverseResults").innerHTML = results.map((candidate, index) => `<button class="iem-optimise-card" data-apply-rev="${index}"><span>#${index + 1}</span><strong>${candidate.score_rmse_db.toFixed(2)} dB RMSE</strong><small>${candidate.tube_diameter_mm.toFixed(2)} mm ID · ${candidate.tube_length_mm.toFixed(1)} mm · ${Math.round(candidate.damper_ohm)} Ω · ${candidate.capacitor_uf} µF · ${candidate.resistor_ohm} Ω · ${candidate.gain_db.toFixed(1)} dB</small></button>`).join("");
            document.querySelectorAll("[data-apply-rev]").forEach(button => button.onclick = () => applyRev(results[+button.dataset.applyRev], driverIndex));
        } catch (error) {
            $("iemReverseMessage").textContent = error.message || "Reverse design failed";
        }
    }

    function applyRev(candidate, index) {
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
        }
        d.circuit = createCircuit();
        if (candidate.resistor_ohm > 0) appendSeriesComponent(d, "resistor", candidate.resistor_ohm, false);
        if (candidate.capacitor_uf > 0) appendSeriesComponent(d, "capacitor", candidate.capacitor_uf, false);
        renderDrivers();
        document.querySelector('[data-iem-tab="design"]')?.click();
        calculate();
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
        localStorage.setItem("hc_iem_project", JSON.stringify({ name: $("iemProjectName").value, drivers: state.drivers, target: state.target }));
    }

    function loadProject() {
        try {
            const project = JSON.parse(localStorage.getItem("hc_iem_project") || "null");
            if (!project) return;
            $("iemProjectName").value = project.name || "Untitled IEM";
            state.drivers = (project.drivers || []).map(ensureDriverShape);
            state.target = project.target || [];
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
        $("iemProjectName").value = "Untitled IEM";
        renderDrivers();
        refreshReverseDrivers();
        calculate();
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
        $("iemReverseCopyCombined").onclick = () => {
            if (state.last?.combined) {
                state.reverse = structuredClone(state.last.combined);
                drawReverse();
            }
        };
        $("iemReverseFile").onchange = async event => {
            if (event.target.files[0]) {
                state.reverse = await parseFile(event.target.files[0], "fr");
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
})();
