/* =========================================================
   HAMMER CRAFT IEM DESIGNER
   Browser-side MVP solver / UI
========================================================= */

"use strict";

(() => {

    const state = {
        selectedDriverId: null,
        drivers: [],
        targetPoints: [],
        library: [],
        chart: null,
        reverseChart: null,
        reversePoints: [],
        lastDriverResponses: [],
        lastCombined: []
    };

    const $ = id => document.getElementById(id);
    const uid = prefix => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

    function defaultDriver(index = 0) {
        return {
            id: uid("drv"),
            name: index === 0 ? "Bass DD" : `Driver ${index + 1}`,
            type: index === 0 ? "dd" : "ba",
            impedance: index === 0 ? 16 : 20,
            sensitivity: 100,
            gainDb: 0,
            polarity: 1,
            capacitorUf: 0,
            seriesResistance: 0,
            measurement: [],
            impedanceMeasurement: [],
            path: [
                { id: uid("tube"), type: "tube", lengthMm: 10, diameterMm: 2 }
            ]
        };
    }

    function ensureInitialState() {
        if (!state.drivers.length) {
            const driver = defaultDriver(0);
            state.drivers.push(driver);
            state.selectedDriverId = driver.id;
        }
    }

    function getSelectedDriver() {
        return state.drivers.find(driver => driver.id === state.selectedDriverId) || null;
    }

    function speedOfSound() {
        const t = num($("iemTemperature")?.value, 20);
        const rh = clamp(num($("iemHumidity")?.value, 50), 0, 100);
        return 331.3 + 0.606 * t + 0.0124 * rh;
    }

    function logFrequencies(count = 260) {
        const out = [];
        const min = Math.log10(20);
        const max = Math.log10(20000);
        for (let i = 0; i < count; i++) {
            out.push(10 ** (min + (max - min) * i / (count - 1)));
        }
        return out;
    }

    function interpolate(points, frequency, key = "db") {
        if (!points?.length) return 0;
        if (frequency <= points[0].frequency) return num(points[0][key]);
        if (frequency >= points[points.length - 1].frequency) return num(points[points.length - 1][key]);
        let low = 0;
        let high = points.length - 1;
        while (high - low > 1) {
            const mid = Math.floor((low + high) / 2);
            if (points[mid].frequency <= frequency) low = mid;
            else high = mid;
        }
        const a = points[low];
        const b = points[high];
        const ratio = (Math.log(frequency) - Math.log(a.frequency)) / (Math.log(b.frequency) - Math.log(a.frequency));
        return num(a[key]) + (num(b[key]) - num(a[key])) * ratio;
    }

    function tubeTransferDb(element, frequency, c) {
        const lengthM = Math.max(0.0001, num(element.lengthMm, 10) / 1000);
        const diameterMm = Math.max(0.1, num(element.diameterMm, 2));
        const quarterWave = c / (4 * lengthM);
        const ratio = Math.max(0.001, frequency / quarterWave);
        const resonance = 2.2 * Math.exp(-0.5 * (Math.log2(ratio) / 0.23) ** 2);
        const hfLoss = -0.22 * (lengthM * 1000 / 10) * Math.sqrt(frequency / 10000) * (2 / diameterMm);
        return resonance + hfLoss;
    }

    function damperTransferDb(element, frequency) {
        const r = Math.max(0, num(element.resistance, 1000));
        const amount = Math.log10(1 + r / 220) * 2.0;
        const shape = Math.pow(clamp(frequency / 1000, 0, 20), 0.28);
        return -amount * shape;
    }

    function chamberTransferDb(element, frequency) {
        const inlet = Math.max(0.2, num(element.inletMm, 1.5));
        const diameter = Math.max(inlet, num(element.diameterMm, 2.5));
        const length = Math.max(0.2, num(element.lengthMm, 4));
        const areaRatio = (diameter * diameter) / (inlet * inlet);
        const fc = 9000 / Math.max(1, areaRatio * Math.sqrt(length));
        const x = frequency / Math.max(100, fc);
        return -10 * Math.log10(1 + x * x);
    }

    function electricalTransferDb(driver, frequency) {
        let db = num(driver.gainDb, 0);
        const z = Math.max(0.1, num(driver.impedance, 16));
        const rs = Math.max(0, num(driver.seriesResistance, 0));
        if (rs > 0) db += 20 * Math.log10(z / (z + rs));
        const capUf = Math.max(0, num(driver.capacitorUf, 0));
        if (capUf > 0) {
            const fc = 1 / (2 * Math.PI * z * capUf * 1e-6);
            const x = Math.max(0.000001, frequency / fc);
            db += 20 * Math.log10(x / Math.sqrt(1 + x * x));
        }
        return db;
    }

    function phaseDeg(driver, frequency, c) {
        let phase = 0;
        const z = Math.max(0.1, num(driver.impedance, 16));
        const capUf = Math.max(0, num(driver.capacitorUf, 0));
        if (capUf > 0) {
            const fc = 1 / (2 * Math.PI * z * capUf * 1e-6);
            phase += 90 - Math.atan2(frequency, fc) * 180 / Math.PI;
        }
        let lengthM = 0;
        driver.path.forEach(element => {
            if (element.type === "tube") lengthM += Math.max(0, num(element.lengthMm, 0)) / 1000;
            if (element.type === "chamber") lengthM += Math.max(0, num(element.lengthMm, 0)) / 1000;
        });
        phase -= 360 * frequency * lengthM / c;
        if (num(driver.polarity, 1) < 0) phase += 180;
        return phase;
    }

    function rawDriverDb(driver, frequency) {
        if (driver.measurement?.length >= 2) return interpolate(driver.measurement, frequency);
        if (driver.type === "dd") {
            const bass = -3 * Math.log10(1 + (frequency / 9000) ** 2);
            const lf = -6 * Math.log10(1 + (30 / Math.max(20, frequency)) ** 2);
            return 100 + bass + lf;
        }
        if (driver.type === "ba") {
            const low = -10 * Math.log10(1 + (450 / Math.max(20, frequency)) ** 2);
            const high = -5 * Math.log10(1 + (frequency / 12000) ** 3);
            return 101 + low + high;
        }
        if (driver.type === "bc") return 92 - 4 * Math.log10(1 + (frequency / 6000) ** 2);
        return 98 - 3 * Math.log10(1 + (frequency / 12000) ** 2);
    }

    function simulateDriver(driver, frequencies, c) {
        return frequencies.map(frequency => {
            let db = rawDriverDb(driver, frequency) + electricalTransferDb(driver, frequency) - 100;
            driver.path.forEach(element => {
                if (element.type === "tube") db += tubeTransferDb(element, frequency, c);
                if (element.type === "damper") db += damperTransferDb(element, frequency);
                if (element.type === "chamber") db += chamberTransferDb(element, frequency);
            });
            const phase = phaseDeg(driver, frequency, c);
            return { frequency, db, phase };
        });
    }

    function combineResponses(responses, frequencies) {
        return frequencies.map((frequency, index) => {
            let re = 0;
            let im = 0;
            responses.forEach(response => {
                const point = response[index];
                const amplitude = 10 ** (point.db / 20);
                const radians = point.phase * Math.PI / 180;
                re += amplitude * Math.cos(radians);
                im += amplitude * Math.sin(radians);
            });
            return { frequency, db: 20 * Math.log10(Math.max(1e-9, Math.hypot(re, im))) };
        });
    }

    function normalizeForDisplay(series) {
        if (!series.length) return series;
        const oneK = interpolate(series, 1000);
        return series.map(p => ({ ...p, db: p.db - oneK }));
    }

    function calculateMetrics(driverResponses, combined, c) {
        let primary = 0;
        let maxDelay = 0;
        let totalVolume = 0;
        state.drivers.forEach(driver => driver.path.forEach(element => {
            if (element.type === "tube") {
                const lengthM = num(element.lengthMm) / 1000;
                const resonance = c / (4 * Math.max(0.0001, lengthM));
                if (!primary || resonance < primary) primary = resonance;
                maxDelay = Math.max(maxDelay, lengthM / c * 1000);
                const radius = num(element.diameterMm) / 2;
                totalVolume += Math.PI * radius * radius * num(element.lengthMm);
            }
            if (element.type === "chamber") {
                const radius = num(element.diameterMm) / 2;
                totalVolume += Math.PI * radius * radius * num(element.lengthMm);
            }
        }));
        $("iemPrimaryResonance").textContent = primary ? `${(primary / 1000).toFixed(2)} kHz` : "—";
        $("iemTubeDelay").textContent = `${maxDelay.toFixed(3)} ms`;
        $("iemTubeVolume").textContent = `${totalVolume.toFixed(1)} mm³`;

        let crossover = null;
        if (driverResponses.length >= 2) {
            let best = Infinity;
            for (let i = 0; i < combined.length; i++) {
                const diff = Math.abs(driverResponses[0][i].db - driverResponses[1][i].db);
                if (diff < best) { best = diff; crossover = combined[i].frequency; }
            }
        }
        $("iemEstimatedCrossover").textContent = crossover ? `${Math.round(crossover)} Hz` : "—";

        if (state.targetPoints.length >= 2) {
            let sum = 0;
            let n = 0;
            const normCombined = normalizeForDisplay(combined);
            const targetNorm = normalizeForDisplay(state.targetPoints);
            normCombined.forEach(point => {
                if (point.frequency >= targetNorm[0].frequency && point.frequency <= targetNorm[targetNorm.length - 1].frequency) {
                    const error = point.db - interpolate(targetNorm, point.frequency);
                    sum += error * error;
                    n++;
                }
            });
            $("iemTargetRmse").textContent = n ? `${Math.sqrt(sum / n).toFixed(2)} dB` : "—";
        } else {
            $("iemTargetRmse").textContent = "—";
        }
    }

    function drawChart(driverResponses, combined) {
        const canvas = $("iemResponseChart");
        if (!canvas || typeof Chart === "undefined") return;
        const datasets = [];
        if ($("iemShowIndividual")?.checked) {
            driverResponses.forEach((response, index) => {
                datasets.push({
                    label: state.drivers[index]?.name || `Driver ${index + 1}`,
                    data: normalizeForDisplay(response).map(p => ({ x: p.frequency, y: p.db })),
                    borderWidth: 1.5,
                    pointRadius: 0,
                    tension: 0.12
                });
            });
        }
        if ($("iemShowCombined")?.checked) {
            datasets.push({
                label: "Combined",
                data: normalizeForDisplay(combined).map(p => ({ x: p.frequency, y: p.db })),
                borderWidth: 3,
                pointRadius: 0,
                tension: 0.12
            });
        }
        if ($("iemShowTarget")?.checked && state.targetPoints.length >= 2) {
            datasets.push({
                label: "Target",
                data: normalizeForDisplay(state.targetPoints).map(p => ({ x: p.frequency, y: p.db })),
                borderWidth: 2,
                borderDash: [8, 7],
                pointRadius: 0,
                tension: 0.1
            });
        }
        state.chart?.destroy();
        state.chart = new Chart(canvas, {
            type: "line",
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                parsing: false,
                animation: false,
                interaction: { mode: "nearest", intersect: false },
                scales: {
                    x: { type: "logarithmic", min: 20, max: 20000, title: { display: true, text: "Frequency (Hz)" } },
                    y: { suggestedMin: -20, suggestedMax: 15, title: { display: true, text: "Relative SPL (dB)" } }
                },
                plugins: { legend: { position: "bottom" } }
            }
        });
    }

    function calculate() {
        syncDriverInputs();
        const frequencies = logFrequencies();
        const c = speedOfSound();
        const driverResponses = state.drivers.map(driver => simulateDriver(driver, frequencies, c));
        const combined = combineResponses(driverResponses, frequencies);
        state.lastDriverResponses = driverResponses;
        state.lastCombined = combined;
        drawChart(driverResponses, combined);
        if (state.reverseChart) drawReverseChart();
        calculateMetrics(driverResponses, combined, c);
        setMessage("iemSimulationMessage", "Simulation updated. Browser MVP model is approximate; use measured data for better predictions.", "success");
    }

    function setMessage(id, message, type = "") {
        const el = $(id);
        if (!el) return;
        el.textContent = message || "";
        el.classList.remove("success", "error");
        if (type) el.classList.add(type);
    }

    function renderDrivers() {
        const list = $("iemDriverList");
        if (!list) return;
        list.innerHTML = state.drivers.map(driver => `
            <article class="iem-driver-card ${driver.id === state.selectedDriverId ? "selected" : ""}" data-driver-id="${driver.id}">
                <div class="iem-driver-card-top">
                    <button class="iem-driver-select" type="button" data-select-driver="${driver.id}">${escapeHtml(driver.name)}</button>
                    <button class="iem-mini-danger" type="button" data-delete-driver="${driver.id}">×</button>
                </div>
                <div class="iem-form-grid two">
                    <label>NAME<input data-driver-field="name" data-driver-id="${driver.id}" value="${escapeHtml(driver.name)}"></label>
                    <label>TYPE<select data-driver-field="type" data-driver-id="${driver.id}">
                        ${["dd","ba","planar","magnetostatic","bc"].map(type => `<option value="${type}" ${driver.type===type?"selected":""}>${type.toUpperCase()}</option>`).join("")}
                    </select></label>
                    <label>IMPEDANCE Ω<input type="number" step="0.1" data-driver-field="impedance" data-driver-id="${driver.id}" value="${driver.impedance}"></label>
                    <label>GAIN dB<input type="number" step="0.1" data-driver-field="gainDb" data-driver-id="${driver.id}" value="${driver.gainDb}"></label>
                    <label>HP CAP µF<input type="number" step="0.1" data-driver-field="capacitorUf" data-driver-id="${driver.id}" value="${driver.capacitorUf}"></label>
                    <label>SERIES R Ω<input type="number" step="0.1" data-driver-field="seriesResistance" data-driver-id="${driver.id}" value="${driver.seriesResistance}"></label>
                    <label>POLARITY<select data-driver-field="polarity" data-driver-id="${driver.id}"><option value="1" ${driver.polarity===1?"selected":""}>NORMAL</option><option value="-1" ${driver.polarity===-1?"selected":""}>REVERSED</option></select></label>
                </div>
                <div class="iem-measurement-status">${driver.measurement?.length ? `${driver.measurement.length} FR points loaded` : "No FR measurement"}</div>
            </article>
        `).join("");
        list.querySelectorAll("[data-select-driver]").forEach(button => button.addEventListener("click", () => {
            syncDriverInputs();
            state.selectedDriverId = button.dataset.selectDriver;
            renderDrivers();
            renderPath();
            populateMeasurementSelect();
        }));
        list.querySelectorAll("[data-delete-driver]").forEach(button => button.addEventListener("click", () => {
            if (state.drivers.length <= 1) return;
            state.drivers = state.drivers.filter(d => d.id !== button.dataset.deleteDriver);
            state.selectedDriverId = state.drivers[0].id;
            renderDrivers(); renderPath(); populateMeasurementSelect(); calculate();
        }));
    }

    function syncDriverInputs() {
        document.querySelectorAll("[data-driver-field]").forEach(input => {
            const driver = state.drivers.find(d => d.id === input.dataset.driverId);
            if (!driver) return;
            const field = input.dataset.driverField;
            driver[field] = ["name","type"].includes(field) ? input.value : num(input.value, field === "polarity" ? 1 : 0);
        });
        syncPathInputs();
    }

    function renderPath() {
        const editor = $("iemPathEditor");
        const driver = getSelectedDriver();
        if (!editor || !driver) return;
        const nodes = [
            `<div class="iem-path-node fixed"><span>DRIVER</span><strong>${escapeHtml(driver.name)}</strong></div>`
        ];
        driver.path.forEach((element, index) => {
            nodes.push(`<div class="iem-path-connector">↓</div>`);
            if (element.type === "tube") nodes.push(`
                <div class="iem-path-node" data-element-id="${element.id}">
                    <div class="iem-path-node-head"><span>TUBE ${index + 1}</span><button type="button" data-remove-element="${element.id}">REMOVE</button></div>
                    <div class="iem-form-grid two"><label>ID mm<input type="number" step="0.1" data-element-field="diameterMm" data-element-id="${element.id}" value="${element.diameterMm}"></label><label>LENGTH mm<input type="number" step="0.1" data-element-field="lengthMm" data-element-id="${element.id}" value="${element.lengthMm}"></label></div>
                </div>`);
            if (element.type === "damper") nodes.push(`
                <div class="iem-path-node" data-element-id="${element.id}">
                    <div class="iem-path-node-head"><span>ACOUSTIC DAMPER</span><button type="button" data-remove-element="${element.id}">REMOVE</button></div>
                    <div class="iem-form-grid one"><label>RESISTANCE Ω<input type="number" step="10" data-element-field="resistance" data-element-id="${element.id}" value="${element.resistance}"></label></div>
                </div>`);
            if (element.type === "chamber") nodes.push(`
                <div class="iem-path-node" data-element-id="${element.id}">
                    <div class="iem-path-node-head"><span>EXPANSION CHAMBER</span><button type="button" data-remove-element="${element.id}">REMOVE</button></div>
                    <div class="iem-form-grid three"><label>INLET mm<input type="number" step="0.1" data-element-field="inletMm" data-element-id="${element.id}" value="${element.inletMm}"></label><label>DIAMETER mm<input type="number" step="0.1" data-element-field="diameterMm" data-element-id="${element.id}" value="${element.diameterMm}"></label><label>LENGTH mm<input type="number" step="0.1" data-element-field="lengthMm" data-element-id="${element.id}" value="${element.lengthMm}"></label></div>
                </div>`);
        });
        nodes.push(`<div class="iem-path-connector">↓</div><div class="iem-path-node fixed"><span>OUTPUT</span><strong>NOZZLE / MERGE</strong></div>`);
        editor.innerHTML = nodes.join("");
        editor.querySelectorAll("[data-remove-element]").forEach(button => button.addEventListener("click", () => {
            driver.path = driver.path.filter(element => element.id !== button.dataset.removeElement);
            renderPath(); calculate();
        }));
    }

    function syncPathInputs() {
        const driver = getSelectedDriver();
        if (!driver) return;
        document.querySelectorAll("[data-element-field]").forEach(input => {
            const element = driver.path.find(e => e.id === input.dataset.elementId);
            if (element) element[input.dataset.elementField] = num(input.value);
        });
    }

    function addPathElement(type) {
        syncPathInputs();
        const driver = getSelectedDriver();
        if (!driver) return;
        if (type === "tube") driver.path.push({ id: uid("tube"), type, lengthMm: 8, diameterMm: 1.5 });
        if (type === "damper") driver.path.push({ id: uid("damper"), type, resistance: 1000 });
        if (type === "chamber") driver.path.push({ id: uid("chamber"), type, inletMm: 1.5, diameterMm: 2.5, lengthMm: 4 });
        renderPath();
    }

    function escapeHtml(value) {
        return String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
    }

    function setupTabs() {
        document.querySelectorAll("[data-iem-tab]").forEach(button => button.addEventListener("click", () => {
            const tab = button.dataset.iemTab;
            document.querySelectorAll("[data-iem-tab]").forEach(b => b.classList.toggle("active", b === button));
            document.querySelectorAll("[data-iem-panel]").forEach(panel => {
                const active = panel.dataset.iemPanel === tab;
                panel.hidden = !active;
                panel.classList.toggle("active", active);
            });
        }));
    }

    function populateMeasurementSelect() {
        const select = $("iemMeasurementDriver");
        if (!select) return;
        select.innerHTML = state.drivers.map(driver => `<option value="${driver.id}">${escapeHtml(driver.name)}</option>`).join("");
        select.value = state.selectedDriverId || state.drivers[0]?.id || "";
    }

    async function importMeasurement() {
        const driverId = $("iemMeasurementDriver")?.value;
        const file = $("iemMeasurementFile")?.files?.[0];
        if (!driverId || !file) { setMessage("iemMeasurementMessage", "Select a driver and file first.", "error"); return; }
        const text = await file.text();
        const rows = [];
        text.split(/\r?\n/).forEach(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) return;
            const cols = trimmed.split(/[\s,;\t]+/).filter(Boolean);
            if (cols.length < 2) return;
            const frequency = Number(cols[0]); const value = Number(cols[1]);
            if (Number.isFinite(frequency) && frequency > 0 && Number.isFinite(value)) rows.push({ frequency, db: value });
        });
        rows.sort((a,b) => a.frequency - b.frequency);
        const driver = state.drivers.find(d => d.id === driverId);
        if (!driver || rows.length < 2) { setMessage("iemMeasurementMessage", "No usable data points found.", "error"); return; }
        if (file.name.toLowerCase().endsWith(".zma")) driver.impedanceMeasurement = rows.map(p => ({ frequency: p.frequency, ohms: p.db }));
        else driver.measurement = rows;
        renderDrivers();
        setMessage("iemMeasurementMessage", `${rows.length} data points imported into ${driver.name}.`, "success");
        calculate();
    }

    async function loadTargetFromProduct(productId) {
        state.targetPoints = [];
        if (!productId || !window.hcSupabase) { calculate(); return; }
        const names = ["product_frequency_response", "product_frequency_responses"];
        for (const table of names) {
            const result = await window.hcSupabase.from(table).select("frequency_hz,db").eq("product_id", productId).order("frequency_hz", { ascending: true });
            if (!result.error) {
                state.targetPoints = (result.data || []).map(p => ({ frequency: Number(p.frequency_hz), db: Number(p.db) })).filter(p => Number.isFinite(p.frequency) && Number.isFinite(p.db));
                break;
            }
        }
        calculate();
    }

    function populateTargetProducts(products = []) {
        const select = $("iemTargetProduct");
        if (!select) return;
        const current = select.value;
        select.innerHTML = `<option value="">No target</option>` + products.map(product => `<option value="${product.id}">${escapeHtml(product.name)}</option>`).join("");
        if (products.some(p => String(p.id) === String(current))) select.value = current;
        else {
            const reference = products.find(p => p.is_reference_target === true);
            if (reference) { select.value = reference.id; loadTargetFromProduct(reference.id); }
        }
    }

    function projectObject() {
        syncDriverInputs();
        return {
            version: 1,
            name: $("iemProjectName")?.value || "Untitled IEM",
            targetProductId: $("iemTargetProduct")?.value || "",
            temperature: num($("iemTemperature")?.value, 20),
            humidity: num($("iemHumidity")?.value, 50),
            selectedDriverId: state.selectedDriverId,
            drivers: state.drivers
        };
    }

    function saveProject() {
        const project = projectObject();
        const projects = JSON.parse(localStorage.getItem("hc_iem_projects") || "{}");
        projects[project.name] = project;
        localStorage.setItem("hc_iem_projects", JSON.stringify(projects));
        setMessage("iemSimulationMessage", `Project “${project.name}” saved in this browser.`, "success");
    }

    function loadProject() {
        const projects = JSON.parse(localStorage.getItem("hc_iem_projects") || "{}");
        const names = Object.keys(projects);
        if (!names.length) { setMessage("iemSimulationMessage", "No saved IEM projects were found in this browser.", "error"); return; }
        const name = window.prompt(`Saved projects:\n${names.join("\n")}\n\nEnter project name to load:`, names[0]);
        if (!name || !projects[name]) return;
        const project = projects[name];
        state.drivers = project.drivers || [defaultDriver(0)];
        state.selectedDriverId = project.selectedDriverId || state.drivers[0].id;
        $("iemProjectName").value = project.name || name;
        $("iemTemperature").value = project.temperature ?? 20;
        $("iemHumidity").value = project.humidity ?? 50;
        if ($("iemTargetProduct")) $("iemTargetProduct").value = project.targetProductId || "";
        renderDrivers(); renderPath(); populateMeasurementSelect(); loadTargetFromProduct(project.targetProductId || "");
    }

    function newProject() {
        state.drivers = [defaultDriver(0)];
        state.selectedDriverId = state.drivers[0].id;
        state.targetPoints = [];
        $("iemProjectName").value = "Untitled IEM";
        if ($("iemTargetProduct")) $("iemTargetProduct").value = "";
        renderDrivers(); renderPath(); populateMeasurementSelect(); calculate();
    }

    function renderLibrary() {
        const container = $("iemDriverLibrary");
        if (!container) return;
        state.library = JSON.parse(localStorage.getItem("hc_iem_driver_library") || "[]");
        container.innerHTML = state.library.length ? state.library.map((driver, index) => `
            <article class="iem-library-card"><span class="eyebrow">${escapeHtml(driver.type?.toUpperCase() || "DRIVER")}</span><h4>${escapeHtml(driver.name)}</h4><p>${num(driver.impedance)} Ω</p><button type="button" class="outline-button" data-use-library="${index}">ADD TO DESIGN</button></article>
        `).join("") : `<div class="loading-card">No reusable drivers saved yet.</div>`;
        container.querySelectorAll("[data-use-library]").forEach(button => button.addEventListener("click", () => {
            const source = state.library[Number(button.dataset.useLibrary)];
            if (!source) return;
            const driver = structuredClone(source); driver.id = uid("drv"); driver.path = driver.path?.map(e => ({...e,id:uid(e.type)})) || [];
            state.drivers.push(driver); state.selectedDriverId = driver.id; renderDrivers(); renderPath(); populateMeasurementSelect(); calculate();
        }));
    }

    function addSelectedToLibrary() {
        syncDriverInputs();
        const driver = getSelectedDriver();
        if (!driver) return;
        const copy = structuredClone(driver); delete copy.id;
        state.library = JSON.parse(localStorage.getItem("hc_iem_driver_library") || "[]");
        state.library.push(copy);
        localStorage.setItem("hc_iem_driver_library", JSON.stringify(state.library));
        renderLibrary();
    }

    function optimise() {
        syncDriverInputs();
        const driver = getSelectedDriver();
        if (!driver) return;
        const minD = Math.max(0.5, num($("iemOptMinDiameter")?.value, 1));
        const maxD = Math.max(minD, num($("iemOptMaxDiameter")?.value, 2.5));
        const maxL = Math.max(2, num($("iemOptMaxLength")?.value, 15));
        const dampers = String($("iemOptDampers")?.value || "").split(",").map(v => num(v.trim(), NaN)).filter(Number.isFinite);
        const results = [];
        const frequencies = logFrequencies(150);
        const c = speedOfSound();
        for (let d = minD; d <= maxD + 1e-6; d += 0.25) {
            for (let l = 3; l <= maxL + 1e-6; l += 1) {
                for (const r of (dampers.length ? dampers : [0])) {
                    const trial = structuredClone(driver);
                    const tube = trial.path.find(e => e.type === "tube") || { id: uid("tube"), type: "tube" };
                    tube.diameterMm = d; tube.lengthMm = l;
                    if (!trial.path.includes(tube)) trial.path.push(tube);
                    let damper = trial.path.find(e => e.type === "damper");
                    if (r > 0) {
                        if (!damper) { damper = { id: uid("damper"), type: "damper", resistance: r }; trial.path.push(damper); }
                        damper.resistance = r;
                    }
                    const response = normalizeForDisplay(simulateDriver(trial, frequencies, c));
                    let score = 0;
                    if (state.targetPoints.length >= 2) {
                        const target = normalizeForDisplay(state.targetPoints);
                        response.forEach(point => { const e = point.db - interpolate(target, point.frequency); score += e * e; });
                        score = Math.sqrt(score / response.length);
                    } else {
                        response.forEach(point => { score += point.db * point.db; });
                        score = Math.sqrt(score / response.length);
                    }
                    results.push({ d, l, r, score });
                }
            }
        }
        results.sort((a,b) => a.score - b.score);
        const top = results.slice(0, 8);
        $("iemOptimiseResults").innerHTML = top.map((item, index) => `<button type="button" class="iem-optimise-card" data-opt-index="${index}"><span>#${index+1}</span><strong>${item.score.toFixed(2)} dB</strong><small>${item.d.toFixed(2)} mm ID · ${item.l.toFixed(1)} mm · ${item.r || 0} Ω</small></button>`).join("");
        $("iemOptimiseResults").querySelectorAll("[data-opt-index]").forEach(button => button.addEventListener("click", () => {
            const item = top[Number(button.dataset.optIndex)];
            let tube = driver.path.find(e => e.type === "tube"); if (!tube) { tube = {id:uid("tube"),type:"tube"}; driver.path.push(tube); }
            tube.diameterMm = item.d; tube.lengthMm = item.l;
            if (item.r > 0) { let damper = driver.path.find(e => e.type === "damper"); if (!damper) { damper={id:uid("damper"),type:"damper"}; driver.path.push(damper); } damper.resistance=item.r; }
            renderPath(); calculate(); document.querySelector('[data-iem-tab="design"]')?.click();
        }));
        setMessage("iemOptimiseMessage", `${results.length} combinations tested. Select a result to apply it.`, "success");
    }


    /* =========================================================
       REVERSE / INVERSE DESIGN
    ========================================================= */

    function defaultReversePoints() {
        return [
            20, 50, 100, 200, 500, 1000, 2000, 3000,
            5000, 8000, 10000, 15000, 20000
        ].map(frequency => ({ frequency, db: 0 }));
    }

    function ensureReversePoints() {
        if (state.reversePoints.length < 2) {
            state.reversePoints = defaultReversePoints();
        }
    }

    function normalizeEditableTarget(points) {
        if (!points?.length) return [];
        const sorted = points
            .map(p => ({ frequency: num(p.frequency), db: num(p.db) }))
            .filter(p => p.frequency > 0 && Number.isFinite(p.db))
            .sort((a, b) => a.frequency - b.frequency);
        if (sorted.length < 2) return sorted;
        const oneK = interpolate(sorted, 1000);
        return sorted.map(p => ({ ...p, db: p.db - oneK }));
    }

    async function importReverseTargetFile() {
        const input = $("iemReverseTargetFile");
        const file = input?.files?.[0];

        if (!file) {
            setMessage("iemReverseFileMessage", "Choose a TXT, CSV or FRD target file first.", "error");
            return;
        }

        try {
            const text = await file.text();
            const points = [];
            let rejected = 0;

            text.split(/\r?\n/).forEach(rawLine => {
                const line = rawLine.trim();
                if (!line || line.startsWith("#") || line.startsWith(";")) return;

                // Accept whitespace, comma, semicolon or tab separated data.
                // Expected columns: frequency_hz, dB, optional phase.
                const columns = line.split(/[\s,;\t]+/).filter(Boolean);
                if (columns.length < 2) { rejected++; return; }

                const frequency = Number(columns[0]);
                const db = Number(columns[1]);

                // Header lines such as "Frequency SPL" are ignored.
                if (!Number.isFinite(frequency) || !Number.isFinite(db) || frequency <= 0) {
                    rejected++;
                    return;
                }

                points.push({ frequency, db });
            });

            points.sort((a, b) => a.frequency - b.frequency);

            // Collapse duplicate frequencies. Last value wins.
            const unique = new Map();
            points.forEach(point => unique.set(point.frequency, point));
            const cleaned = Array.from(unique.values())
                .filter(point => point.frequency >= 10 && point.frequency <= 50000);

            if (cleaned.length < 2) {
                throw new Error("The file does not contain at least two usable frequency / dB points.");
            }

            state.reversePoints = cleaned;
            drawReverseChart();

            const first = cleaned[0].frequency;
            const last = cleaned[cleaned.length - 1].frequency;
            const ignoredText = rejected > 0 ? ` ${rejected} non-data/header lines were ignored.` : "";

            setMessage(
                "iemReverseFileMessage",
                `${cleaned.length} target points imported from ${file.name} (${Math.round(first)}–${Math.round(last)} Hz).${ignoredText} The reverse graph is normalised at 1 kHz for optimisation.`,
                "success"
            );
        } catch (error) {
            console.error("Reverse target import failed:", error);
            setMessage("iemReverseFileMessage", error.message || "Unable to import target file.", "error");
        }
    }

    function drawReverseChart() {
        const canvas = $("iemReverseChart");
        if (!canvas || typeof Chart === "undefined") return;
        ensureReversePoints();
        const datasets = [
            {
                label: "Desired response",
                data: normalizeEditableTarget(state.reversePoints).map(p => ({ x: p.frequency, y: p.db })),
                borderWidth: 3,
                pointRadius: 4,
                pointHoverRadius: 6,
                tension: 0.18
            }
        ];
        if (state.lastCombined?.length) {
            datasets.push({
                label: "Current combined",
                data: normalizeForDisplay(state.lastCombined).map(p => ({ x: p.frequency, y: p.db })),
                borderWidth: 1.5,
                pointRadius: 0,
                borderDash: [6, 6],
                tension: 0.12
            });
        }
        state.reverseChart?.destroy();
        state.reverseChart = new Chart(canvas, {
            type: "line",
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                parsing: false,
                animation: false,
                interaction: { mode: "nearest", intersect: false },
                scales: {
                    x: { type: "logarithmic", min: 20, max: 20000, title: { display: true, text: "Frequency (Hz)" } },
                    y: { min: -20, max: 15, title: { display: true, text: "Relative SPL (dB)" } }
                },
                plugins: { legend: { position: "bottom" } }
            }
        });
        updateReverseSelectedDriver();
    }

    function nearestReverseIndex(frequency) {
        if (!state.reversePoints.length) return -1;
        let best = 0;
        let bestDistance = Infinity;
        state.reversePoints.forEach((point, index) => {
            const distance = Math.abs(Math.log10(point.frequency) - Math.log10(frequency));
            if (distance < bestDistance) { bestDistance = distance; best = index; }
        });
        return best;
    }

    function setReversePointFromEvent(event) {
        if (!state.reverseChart) return;
        const rect = state.reverseChart.canvas.getBoundingClientRect();
        const xPixel = event.clientX - rect.left;
        const yPixel = event.clientY - rect.top;
        const frequency = state.reverseChart.scales.x.getValueForPixel(xPixel);
        const db = state.reverseChart.scales.y.getValueForPixel(yPixel);
        if (!Number.isFinite(frequency) || !Number.isFinite(db) || frequency < 20 || frequency > 20000) return;
        const idx = nearestReverseIndex(frequency);
        const closeEnough = idx >= 0 && Math.abs(Math.log10(state.reversePoints[idx].frequency) - Math.log10(frequency)) < 0.055;
        if (closeEnough) {
            state.reversePoints[idx].frequency = clamp(frequency, 20, 20000);
            state.reversePoints[idx].db = clamp(db, -20, 15);
        } else {
            state.reversePoints.push({ frequency: clamp(frequency, 20, 20000), db: clamp(db, -20, 15) });
        }
        state.reversePoints = normalizeEditableTarget(state.reversePoints);
        drawReverseChart();
    }

    function setupReverseGraphEditing() {
        const canvas = $("iemReverseChart");
        if (!canvas || canvas.dataset.reverseBound === "true") return;
        canvas.dataset.reverseBound = "true";
        let drawing = false;
        canvas.addEventListener("pointerdown", event => {
            if (event.button !== 0) return;
            drawing = true;
            canvas.setPointerCapture?.(event.pointerId);
            setReversePointFromEvent(event);
        });
        canvas.addEventListener("pointermove", event => {
            if (!drawing) return;
            setReversePointFromEvent(event);
        });
        const stop = event => {
            drawing = false;
            try { canvas.releasePointerCapture?.(event.pointerId); } catch (_) {}
        };
        canvas.addEventListener("pointerup", stop);
        canvas.addEventListener("pointercancel", stop);
        canvas.addEventListener("contextmenu", event => {
            event.preventDefault();
            if (!state.reverseChart || state.reversePoints.length <= 2) return;
            const rect = canvas.getBoundingClientRect();
            const frequency = state.reverseChart.scales.x.getValueForPixel(event.clientX - rect.left);
            const idx = nearestReverseIndex(frequency);
            if (idx >= 0) state.reversePoints.splice(idx, 1);
            drawReverseChart();
        });
    }

    function copyTargetToReverse() {
        if (state.targetPoints.length < 2) {
            setMessage("iemReverseMessage", "No target response is loaded. Select a target product first.", "error");
            return;
        }
        state.reversePoints = normalizeEditableTarget(state.targetPoints);
        drawReverseChart();
        setMessage("iemReverseMessage", "Target response copied into the editable reverse-design graph.", "success");
    }

    function copyCurrentToReverse() {
        if (!state.lastCombined?.length) calculate();
        state.reversePoints = normalizeEditableTarget(state.lastCombined || []);
        drawReverseChart();
        setMessage("iemReverseMessage", "Current combined response copied into the editable graph.", "success");
    }

    function resetReverseFlat() {
        state.reversePoints = defaultReversePoints();
        drawReverseChart();
        setMessage("iemReverseMessage", "Reverse-design graph reset to a flat response.");
    }

    function parseNumberList(id, fallback) {
        const parsed = String($(id)?.value || "")
            .split(",")
            .map(value => Number(value.trim()))
            .filter(Number.isFinite);
        return parsed.length ? parsed : fallback;
    }

    function candidateCombinedForDriver(candidateDriver, selectedIndex, frequencies, c) {
        const responses = state.drivers.map((driver, index) =>
            simulateDriver(index === selectedIndex ? candidateDriver : driver, frequencies, c)
        );
        return combineResponses(responses, frequencies);
    }

    function targetRmse(response, target) {
        if (!response?.length || !target?.length) return Infinity;
        const r = normalizeForDisplay(response);
        const t = normalizeEditableTarget(target);
        let sum = 0;
        let n = 0;
        for (const point of r) {
            if (point.frequency < t[0].frequency || point.frequency > t[t.length - 1].frequency) continue;
            const e = point.db - interpolate(t, point.frequency);
            sum += e * e;
            n++;
        }
        return n ? Math.sqrt(sum / n) : Infinity;
    }

    function applyReverseCandidate(item) {
        const driver = getSelectedDriver();
        if (!driver || !item) return;
        let tube = driver.path.find(e => e.type === "tube");
        if (!tube) { tube = { id: uid("tube"), type: "tube" }; driver.path.push(tube); }
        tube.diameterMm = item.diameter;
        tube.lengthMm = item.length;
        let damper = driver.path.find(e => e.type === "damper");
        if (item.damper > 0) {
            if (!damper) { damper = { id: uid("damper"), type: "damper" }; driver.path.push(damper); }
            damper.resistance = item.damper;
        } else if (damper) {
            driver.path = driver.path.filter(e => e !== damper);
        }
        driver.capacitorUf = item.cap;
        driver.seriesResistance = item.seriesR;
        driver.gainDb = item.gain;
        renderDrivers();
        renderPath();
        calculate();
        drawReverseChart();
        setMessage("iemReverseMessage", `Applied candidate with ${item.score.toFixed(2)} dB RMSE to ${driver.name}.`, "success");
    }

    function updateReverseSummary(item) {
        $("iemReverseBestRmse").textContent = item ? `${item.score.toFixed(2)} dB` : "—";
        $("iemReverseBestDiameter").textContent = item ? `${item.diameter.toFixed(2)} mm` : "—";
        $("iemReverseBestLength").textContent = item ? `${item.length.toFixed(1)} mm` : "—";
        $("iemReverseBestDamper").textContent = item ? `${Math.round(item.damper)} Ω` : "—";
        $("iemReverseBestCap").textContent = item ? `${item.cap} µF` : "—";
        $("iemReverseBestSeriesR").textContent = item ? `${item.seriesR} Ω` : "—";
        $("iemReverseBestGain").textContent = item ? `${item.gain > 0 ? "+" : ""}${item.gain.toFixed(1)} dB` : "—";
    }

    function updateReverseSelectedDriver() {
        const element = $("iemReverseSelectedDriver");
        if (!element) return;
        const driver = getSelectedDriver();
        element.textContent = `Selected driver: ${driver?.name || "—"}`;
    }

    function reverseDesign() {
        syncDriverInputs();
        ensureReversePoints();
        const driver = getSelectedDriver();
        if (!driver) return;
        const selectedIndex = state.drivers.findIndex(d => d.id === driver.id);
        if (selectedIndex < 0) return;

        const minD = Math.max(0.5, num($("iemReverseMinDiameter")?.value, 1));
        const maxD = Math.max(minD, num($("iemReverseMaxDiameter")?.value, 2.5));
        const minL = Math.max(1, num($("iemReverseMinLength")?.value, 3));
        const maxL = Math.max(minL, num($("iemReverseMaxLength")?.value, 15));
        const dampers = parseNumberList("iemReverseDampers", [0,330,680,1000,1500,2200]);
        const caps = parseNumberList("iemReverseCaps", [0,4.7,10,15,22,33,47]);
        const resistors = parseNumberList("iemReverseSeriesR", [0,1,2.2,3.3,4.7,6.8,10]);
        const gainRange = Math.max(0, num($("iemReverseGainRange")?.value, 8));
        const frequencies = logFrequencies(120);
        const c = speedOfSound();
        const target = normalizeEditableTarget(state.reversePoints);
        const results = [];

        const sampleCount = 1800;
        const spanD = Math.max(0.001, maxD - minD);
        const spanL = Math.max(0.001, maxL - minL);
        for (let i = 0; i < sampleCount; i++) {
            const u = ((i * 0.61803398875) % 1);
            const v = ((i * 0.41421356237) % 1);
            const diameter = minD + spanD * u;
            const length = minL + spanL * v;
            const damper = dampers[i % dampers.length];
            const cap = caps[Math.floor(i / dampers.length) % caps.length];
            const seriesR = resistors[Math.floor(i / (dampers.length * caps.length)) % resistors.length];
            const gainStep = ((i * 7) % 33) / 32;
            const gain = -gainRange + gainStep * gainRange * 2;

            const trial = structuredClone(driver);
            let tube = trial.path.find(e => e.type === "tube");
            if (!tube) { tube = { id: uid("tube"), type: "tube" }; trial.path.push(tube); }
            tube.diameterMm = diameter;
            tube.lengthMm = length;
            let damperElement = trial.path.find(e => e.type === "damper");
            if (damper > 0) {
                if (!damperElement) { damperElement = { id: uid("damper"), type: "damper" }; trial.path.push(damperElement); }
                damperElement.resistance = damper;
            } else if (damperElement) {
                trial.path = trial.path.filter(e => e !== damperElement);
            }
            trial.capacitorUf = cap;
            trial.seriesResistance = seriesR;
            trial.gainDb = gain;
            const combined = candidateCombinedForDriver(trial, selectedIndex, frequencies, c);
            const score = targetRmse(combined, target);
            results.push({ diameter, length, damper, cap, seriesR, gain, score });
        }

        results.sort((a, b) => a.score - b.score);
        const top = results.slice(0, 10);
        updateReverseSummary(top[0] || null);
        const container = $("iemReverseResults");
        if (container) {
            container.innerHTML = top.map((item, index) => `
                <button type="button" class="iem-optimise-card" data-reverse-index="${index}">
                    <span>#${index + 1}</span>
                    <strong>${item.score.toFixed(2)} dB RMSE</strong>
                    <small>${item.diameter.toFixed(2)} mm ID · ${item.length.toFixed(1)} mm · ${Math.round(item.damper)} Ω · ${item.cap} µF · ${item.seriesR} Ω · ${item.gain > 0 ? "+" : ""}${item.gain.toFixed(1)} dB</small>
                </button>
            `).join("");
            container.querySelectorAll("[data-reverse-index]").forEach(button => {
                button.addEventListener("click", () => applyReverseCandidate(top[Number(button.dataset.reverseIndex)]));
            });
        }
        setMessage("iemReverseMessage", `${sampleCount} inverse-design candidates tested for ${driver.name}. Click a result to write those values back into the design controls.`, "success");
    }



    function rustDriverType(type) {
        return ({ dd: "dynamic", ba: "balanced_armature", planar: "planar", magnetostatic: "magnetostatic", bc: "bone_conduction" })[type] || "other";
    }

    function buildRustRequest(frequencies = logFrequencies()) {
        syncDriverInputs();
        const loadType = $("iemAcousticLoadType")?.value || "anechoic";
        const couplerVolume = Math.max(1, num($("iemCouplerVolume")?.value, 2000));
        const loadLossR = Math.max(0, num($("iemLoadLossResistance")?.value, 0));
        const leakR = Math.max(1, num($("iemLeakResistance")?.value, 500000000));
        let acousticLoad = { type: "anechoic" };
        if (loadType === "radiation") acousticLoad = { type: "radiation" };
        if (loadType === "generic_711_approx") acousticLoad = { type: "generic_711_approx" };
        if (loadType === "closed_cavity") acousticLoad = {
            type: "closed_cavity",
            volume_mm3: couplerVolume,
            loss_resistance_acoustic_ohm: loadLossR
        };
        if (loadType === "cavity_with_leak") acousticLoad = {
            type: "cavity_with_leak",
            volume_mm3: couplerVolume,
            leak_resistance_acoustic_ohm: leakR
        };

        return {
            frequencies_hz: frequencies,
            environment: {
                temperature_c: num($("iemTemperature")?.value, 20),
                relative_humidity_percent: clamp(num($("iemHumidity")?.value, 50), 0, 100)
            },
            acoustic_load: acousticLoad,
            drivers: state.drivers.map(driver => ({
                id: driver.id,
                name: driver.name,
                driver_type: rustDriverType(driver.type),
                nominal_impedance_ohm: Math.max(0.01, num(driver.impedance, 16)),
                sensitivity_db: num(driver.sensitivity, 0),
                gain_db: num(driver.gainDb, 0),
                polarity_inverted: num(driver.polarity, 1) < 0,
                response: (driver.measurement || []).map(p => ({ frequency_hz: p.frequency, db: p.db, phase_deg: num(p.phase, 0) })),
                impedance: (driver.impedanceMeasurement || []).map(p => ({ frequency_hz: p.frequency, magnitude_ohm: Math.max(0.001, num(p.ohms, 16)), phase_deg: num(p.phase, 0) })),
                electrical: [
                    ...(num(driver.seriesResistance, 0) > 0 ? [{ type: "series_resistor", resistance_ohm: num(driver.seriesResistance, 0) }] : []),
                    ...(num(driver.capacitorUf, 0) > 0 ? [{ type: "series_capacitor", capacitance_uf: num(driver.capacitorUf, 0) }] : [])
                ],
                acoustic_source: { type: "ideal_pressure" },
                acoustic_path: (driver.path || []).map(element => {
                    if (element.type === "tube") return { type: "tube", length_mm: num(element.lengthMm, 10), diameter_mm: num(element.diameterMm, 2), loss_factor: 0 };
                    if (element.type === "damper") return { type: "damper", resistance_acoustic_ohm: num(element.resistance, 1000) };
                    if (element.type === "chamber") return { type: "expansion_chamber", length_mm: num(element.lengthMm, 4), diameter_mm: num(element.diameterMm, 2.5) };
                    return { type: "tube", length_mm: 0, diameter_mm: 2, loss_factor: 0 };
                })
            }))
        };
    }

    function rustResultToBrowser(result) {
        const driverResponses = result.drivers.map(driver => driver.points.map(p => ({ frequency: p.frequency_hz, db: p.db, phase: p.phase_deg })));
        const combined = result.combined.map(p => ({ frequency: p.frequency_hz, db: p.db, phase: p.phase_deg }));
        return { driverResponses, combined };
    }

    async function calculateRustOrFallback() {
        if (!window.HCAcousticEngine) return calculate();
        try {
            setMessage("iemSimulationMessage", "Running Rust/WASM acoustic solver…");
            const result = await window.HCAcousticEngine.simulate(buildRustRequest());
            const converted = rustResultToBrowser(result);
            state.lastDriverResponses = converted.driverResponses;
            state.lastCombined = converted.combined;
            drawChart(converted.driverResponses, converted.combined);
            if (state.reverseChart) drawReverseChart();
            calculateMetrics(converted.driverResponses, converted.combined, speedOfSound());
            const version = await window.HCAcousticEngine.version();
            setMessage("iemSimulationMessage", `${version} simulation updated.`, "success");
        } catch (error) {
            console.warn("Rust solver unavailable; using browser fallback.", error);
            calculate();
        }
    }

    async function reverseDesignRustOrFallback() {
        if (!window.HCAcousticEngine) return reverseDesign();
        syncDriverInputs();
        ensureReversePoints();
        const driver = getSelectedDriver();
        const selectedIndex = state.drivers.findIndex(d => d.id === driver?.id);
        if (!driver || selectedIndex < 0) return;
        try {
            const target = normalizeEditableTarget(state.reversePoints).map(p => ({ frequency_hz: p.frequency, db: p.db, phase_deg: 0 }));
            const request = {
                base_request: buildRustRequest(logFrequencies(120)),
                target,
                driver_index: selectedIndex,
                min_tube_length_mm: Math.max(1, num($("iemReverseMinLength")?.value, 3)),
                max_tube_length_mm: Math.max(1, num($("iemReverseMaxLength")?.value, 15)),
                min_tube_diameter_mm: Math.max(0.5, num($("iemReverseMinDiameter")?.value, 1)),
                max_tube_diameter_mm: Math.max(0.5, num($("iemReverseMaxDiameter")?.value, 2.5)),
                damper_values: parseNumberList("iemReverseDampers", [0,330,680,1000,1500,2200]),
                capacitor_values_uf: parseNumberList("iemReverseCaps", [0,4.7,10,15,22,33,47]),
                resistor_values_ohm: parseNumberList("iemReverseSeriesR", [0,1,2.2,3.3,4.7,6.8,10]),
                gain_range_db: Math.max(0, num($("iemReverseGainRange")?.value, 8)),
                max_evaluations: 3200,
                result_count: 10
            };
            setMessage("iemReverseMessage", "Rust inverse optimiser is searching…");
            const raw = await window.HCAcousticEngine.reverseDesign(request);
            const top = raw.map(item => ({
                diameter: item.tube_diameter_mm,
                length: item.tube_length_mm,
                damper: item.damper_ohm,
                cap: item.capacitor_uf,
                seriesR: item.resistor_ohm,
                gain: item.gain_db,
                score: item.score_rmse_db
            }));
            updateReverseSummary(top[0] || null);
            const container = $("iemReverseResults");
            if (container) {
                container.innerHTML = top.map((item, index) => `<button type="button" class="iem-optimise-card" data-reverse-rust-index="${index}"><span>#${index + 1}</span><strong>${item.score.toFixed(2)} dB RMSE</strong><small>${item.diameter.toFixed(2)} mm ID · ${item.length.toFixed(1)} mm · ${Math.round(item.damper)} Ω · ${item.cap} µF · ${item.seriesR} Ω · ${item.gain > 0 ? "+" : ""}${item.gain.toFixed(1)} dB</small></button>`).join("");
                container.querySelectorAll("[data-reverse-rust-index]").forEach(button => button.addEventListener("click", () => applyReverseCandidate(top[Number(button.dataset.reverseRustIndex)])));
            }
            setMessage("iemReverseMessage", `Rust/WASM tested ${request.max_evaluations} candidate designs for ${driver.name}.`, "success");
        } catch (error) {
            console.warn("Rust reverse design unavailable; using browser fallback.", error);
            reverseDesign();
        }
    }

    function setupEvents() {
        $("iemAddDriverButton")?.addEventListener("click", () => { syncDriverInputs(); const d = defaultDriver(state.drivers.length); state.drivers.push(d); state.selectedDriverId = d.id; renderDrivers(); renderPath(); populateMeasurementSelect(); });
        $("iemAddTubeButton")?.addEventListener("click", () => addPathElement("tube"));
        $("iemAddDamperButton")?.addEventListener("click", () => addPathElement("damper"));
        $("iemAddChamberButton")?.addEventListener("click", () => addPathElement("chamber"));
        $("iemCalculateButton")?.addEventListener("click", calculateRustOrFallback);
        $("iemImportMeasurementButton")?.addEventListener("click", importMeasurement);
        $("iemSaveProjectButton")?.addEventListener("click", saveProject);
        $("iemLoadProjectButton")?.addEventListener("click", loadProject);
        $("iemNewProjectButton")?.addEventListener("click", newProject);
        $("iemLibraryAddButton")?.addEventListener("click", addSelectedToLibrary);
        $("iemOptimiseButton")?.addEventListener("click", optimise);
        $("iemReverseRunButton")?.addEventListener("click", reverseDesignRustOrFallback);
        $("iemReverseImportTargetButton")?.addEventListener("click", importReverseTargetFile);
        $("iemReverseTargetFile")?.addEventListener("change", () => setMessage("iemReverseFileMessage", "Target file selected. Click IMPORT TARGET FILE to load it."));
        $("iemReverseUseTargetButton")?.addEventListener("click", copyTargetToReverse);
        $("iemReverseUseCombinedButton")?.addEventListener("click", copyCurrentToReverse);
        $("iemReverseClearButton")?.addEventListener("click", resetReverseFlat);
        $("iemTargetProduct")?.addEventListener("change", event => loadTargetFromProduct(event.target.value));
        ["iemShowTarget","iemShowIndividual","iemShowCombined"].forEach(id => $(id)?.addEventListener("change", calculate));
        setupTabs();
        setupReverseGraphEditing();
    }

    function init() {
        ensureInitialState();
        setupEvents();
        renderDrivers();
        renderPath();
        renderLibrary();
        populateMeasurementSelect();
        calculate();
        ensureReversePoints();
        drawReverseChart();
    }

    window.HCIemDesigner = {
        init,
        populateTargetProducts,
        calculate,
        getState: () => state
    };

})();
