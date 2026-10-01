// Shared browser/offline source-profile contract. No receiver is calibrated by its name or FR peaks.
(function (root) {
    'use strict';
    const clone = value => JSON.parse(JSON.stringify(value));
    const finite = Number.isFinite;
    const positive = value => finite(value) && value > 0;
    function networkError(source) {
        if (source?.type !== 'foster') return 'Choose a passive source network.';
        if (!finite(source.resistance_acoustic_ohm) || source.resistance_acoustic_ohm < 0
            || !finite(source.inertance_kg_per_m4) || source.inertance_kg_per_m4 < 0
            || !positive(source.compliance_m3_per_pa)) return 'Source R and M must be non-negative, and compliance must be positive.';
        if (!Array.isArray(source.branches) || source.branches.length > 16
            || source.branches.some(b => !b || !positive(b.resistance_acoustic_ohm) || !positive(b.resonance_hz) || !positive(b.q))) {
            return 'Use at most 16 source branches, each with positive resistance, resonance frequency and Q.';
        }
        return '';
    }
    function seed(driver) {
        // An explicitly uncalibrated starting RMC, equivalent to the existing
        // resonant-source controls. Never derive source poles from loaded FR peaks.
        const r = positive(driver.sourceResistanceCgs) ? driver.sourceResistanceCgs * 1e5 : 1e8;
        const f = positive(driver.sourceResonanceHz) ? driver.sourceResonanceHz : 3000;
        const q = positive(driver.sourceQ) ? driver.sourceQ : 2;
        return { type: 'foster', resistance_acoustic_ohm: r,
            inertance_kg_per_m4: r * q / (2 * Math.PI * f),
            compliance_m3_per_pa: 1 / (2 * Math.PI * f * r * q), branches: [] };
    }
    function binding(driver, referencePath, referenceLoad) {
        const point = (p, magnitude) => [p.frequency, p[magnitude], finite(p.phase) ? p.phase : null];
        return { manufacturer: driver.databaseManufacturer || null, model: driver.databaseModel || driver.name,
            driver_type: driver.type, response_absolute: Boolean(driver.responseAbsolute),
            sensitivity_db: driver.sensitivity, sensitivity_reference_hz: driver.sensitivityRef,
            measurement_voltage_v: driver.measurementVoltageV ?? null,
            nominal_impedance_ohm: driver.impedance,
            measurement: driver.measurement.map(p => point(p, 'db')),
            impedance: driver.impedanceCurve.map(p => point(p, 'ohm')),
            reference_path: clone(referencePath), reference_load: clone(referenceLoad) };
    }
    function canonical(value) {
        if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
        if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
        return JSON.stringify(value);
    }
    function profileError(profile, expectedBinding) {
        if (profile?.format !== 'hc-acoustic-source-profile' || profile.version !== 1) return 'Unsupported source profile file.';
        const error = networkError(profile.source);
        if (error) return error;
        if (!profile.binding || canonical(profile.binding) !== canonical(expectedBinding)) return 'This profile belongs to a different receiver, baseline, voltage calibration or reference fixture.';
        if (!Array.isArray(profile.band_hz) || profile.band_hz.length !== 2 || !profile.band_hz.every(positive)
            || profile.band_hz[1] <= profile.band_hz[0]) return 'The source profile needs a valid fit frequency range.';
        if (!Array.isArray(profile.evidence) || profile.evidence.length < 2
            || profile.evidence.some(e => !e || typeof e.case_id !== 'string' || !e.case_id.trim()
                || !['physical_measurement', 'published_curve'].includes(e.kind)
                || typeof e.setup_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(e.setup_sha256)
                || typeof e.measurement_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(e.measurement_sha256))) return 'The profile must identify at least two source measurements and their setup hashes.';
        if (new Set(profile.evidence.map(e => e.case_id)).size !== profile.evidence.length) return 'Source measurement case IDs must be unique.';
        return '';
    }
    root.HCSourceModels = { networkError, seed, binding, canonical, profileError };
})(typeof window === 'undefined' ? globalThis : window);
