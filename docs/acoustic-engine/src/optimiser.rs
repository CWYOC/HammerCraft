use crate::models::{
    AcousticElement, CircuitComponent, CircuitComponentKind, CircuitNetlist, CircuitNode,
    ElectricalElement, FrequencyPoint, ReverseCandidate, ReverseDesignRequest,
};
use crate::simulation::simulate;

fn interpolate_target(target: &[FrequencyPoint], frequency_hz: f64) -> f64 {
    if target.is_empty() { return 0.0; }
    if frequency_hz <= target[0].frequency_hz { return target[0].db; }
    let last = &target[target.len() - 1];
    if frequency_hz >= last.frequency_hz { return last.db; }

    for pair in target.windows(2) {
        let a = &pair[0];
        let b = &pair[1];
        if frequency_hz >= a.frequency_hz && frequency_hz <= b.frequency_hz {
            let r = (frequency_hz.log10() - a.frequency_hz.log10())
                / (b.frequency_hz.log10() - a.frequency_hz.log10());
            return a.db + (b.db - a.db) * r;
        }
    }
    0.0
}

fn interpolate_combined(response: &[crate::models::CombinedResultPoint], frequency_hz: f64) -> f64 {
    if response.is_empty() { return 0.0; }
    if frequency_hz <= response[0].frequency_hz { return response[0].db; }
    let last = &response[response.len() - 1];
    if frequency_hz >= last.frequency_hz { return last.db; }
    for pair in response.windows(2) {
        let a = &pair[0];
        let b = &pair[1];
        if frequency_hz >= a.frequency_hz && frequency_hz <= b.frequency_hz {
            let r = (frequency_hz.log10() - a.frequency_hz.log10())
                / (b.frequency_hz.log10() - a.frequency_hz.log10());
            return a.db + (b.db - a.db) * r;
        }
    }
    last.db
}

fn rmse(simulation: &crate::models::SimulationResult, target: &[FrequencyPoint], normalization_frequency_hz: f64) -> f64 {
    if simulation.combined.is_empty() || target.is_empty() { return f64::INFINITY; }
    let f_norm = normalization_frequency_hz.clamp(20.0, 20000.0);
    let sim_norm = interpolate_combined(&simulation.combined, f_norm);
    let target_norm = interpolate_target(target, f_norm);
    let mut sum = 0.0;
    let mut count = 0usize;

    for point in &simulation.combined {
        let desired = interpolate_target(target, point.frequency_hz) - target_norm;
        let actual = point.db - sim_norm;
        let err = actual - desired;
        sum += err * err;
        count += 1;
    }
    if count == 0 { f64::INFINITY } else { (sum / count as f64).sqrt() }
}

fn set_candidate(
    driver: &mut crate::models::Driver,
    length: f64,
    diameter: f64,
    damper: f64,
    cap: f64,
    resistor: f64,
    gain: f64,
) {
    driver.gain_db = gain;
    let mut tube_done = false;
    let mut damper_done = false;
    for element in driver.acoustic_path.iter_mut() {
        match element {
            AcousticElement::Tube { length_mm, diameter_mm, .. } if !tube_done => {
                *length_mm = length;
                *diameter_mm = diameter;
                tube_done = true;
            }
            AcousticElement::Damper { resistance_acoustic_ohm } if !damper_done => {
                *resistance_acoustic_ohm = damper;
                damper_done = true;
            }
            _ => {}
        }
    }
    if !tube_done {
        driver.acoustic_path.insert(0, AcousticElement::Tube {
            length_mm: length,
            diameter_mm: diameter,
            loss_factor: 0.0,
        });
    }
    if damper > 0.0 && !damper_done {
        driver.acoustic_path.push(AcousticElement::Damper { resistance_acoustic_ohm: damper });
    }
    if damper <= 0.0 {
        driver.acoustic_path.retain(|e| !matches!(e, AcousticElement::Damper { .. }));
    }

    // Reverse optimisation searches a simple passive series R/C branch, but
    // it now writes that branch into the same nodal netlist used by the CAD.
    // Active PEQ/HP/LP blocks remain in driver.electrical.
    driver.electrical.retain(|e| matches!(e,
        ElectricalElement::PeakingEq { .. }
            | ElectricalElement::HighPass { .. }
            | ElectricalElement::LowPass { .. }
    ));

    let mut nodes = vec![
        CircuitNode { id: "in".to_string(), label: "INPUT".to_string() },
        CircuitNode { id: "gnd".to_string(), label: "GND".to_string() },
    ];
    let mut components = Vec::new();
    let mut previous = "in".to_string();
    let mut stage = 0usize;

    if resistor > 0.0 {
        stage += 1;
        let next = format!("rev_n{}", stage);
        nodes.push(CircuitNode { id: next.clone(), label: next.clone() });
        components.push(CircuitComponent {
            id: "REV_R".to_string(),
            label: "R1".to_string(),
            node_a: previous.clone(),
            node_b: next.clone(),
            kind: CircuitComponentKind::Resistor { resistance_ohm: resistor },
            bypassed: false,
        });
        previous = next;
    }

    if cap > 0.0 {
        stage += 1;
        let next = format!("rev_n{}", stage);
        nodes.push(CircuitNode { id: next.clone(), label: next.clone() });
        components.push(CircuitComponent {
            id: "REV_C".to_string(),
            label: "C1".to_string(),
            node_a: previous.clone(),
            node_b: next.clone(),
            kind: CircuitComponentKind::Capacitor { capacitance_uf: cap },
            bypassed: false,
        });
        previous = next;
    }

    driver.circuit_netlist = Some(CircuitNetlist {
        input_node: "in".to_string(),
        output_node: previous,
        ground_node: "gnd".to_string(),
        nodes,
        components,
    });
}

fn choose(values: &[f64], index: usize, fallback: f64) -> f64 {
    if values.is_empty() { fallback } else { values[index % values.len()] }
}

fn evaluate_candidate(
    request: &ReverseDesignRequest,
    length: f64,
    diameter: f64,
    damper: f64,
    cap: f64,
    resistor: f64,
    gain: f64,
) -> ReverseCandidate {
    let mut candidate_request = request.base_request.clone();
    let driver = &mut candidate_request.drivers[request.driver_index];
    set_candidate(driver, length, diameter, damper, cap, resistor, gain);
    let simulation = simulate(&candidate_request);
    let score = rmse(&simulation, &request.target, request.normalization_frequency_hz);

    ReverseCandidate {
        score_rmse_db: score,
        tube_length_mm: length,
        tube_diameter_mm: diameter,
        damper_ohm: damper,
        capacitor_uf: cap,
        resistor_ohm: resistor,
        gain_db: gain,
    }
}

pub fn reverse_design(request: &ReverseDesignRequest) -> Vec<ReverseCandidate> {
    if request.driver_index >= request.base_request.drivers.len() || request.target.len() < 2 {
        return vec![];
    }

    let min_d = request.min_tube_diameter_mm.max(0.3);
    let max_d = request.max_tube_diameter_mm.max(min_d);
    let min_l = request.min_tube_length_mm.max(0.5);
    let max_l = request.max_tube_length_mm.max(min_l);
    let evals = request.max_evaluations.clamp(200, 20_000);
    let global_evals = ((evals as f64) * 0.72).round() as usize;
    let refine_evals = evals.saturating_sub(global_evals);
    let gain_range = request.gain_range_db.max(0.0);
    let mut results = Vec::with_capacity(evals + 32);

    // Stage 1: deterministic low-discrepancy global search.
    // This covers continuous tube dimensions/gain while cycling the
    // discrete damper/capacitor/resistor values supplied by the user.
    for i in 0..global_evals {
        let u = ((i as f64 * 0.618_033_988_75).fract()).abs();
        let v = ((i as f64 * 0.414_213_562_37).fract()).abs();
        let w = ((i as f64 * 0.732_050_807_57).fract()).abs();
        let diameter = min_d + (max_d - min_d) * u;
        let length = min_l + (max_l - min_l) * v;
        let damper = choose(&request.damper_values, i, 0.0);
        let cap = choose(
            &request.capacitor_values_uf,
            i / request.damper_values.len().max(1),
            0.0,
        );
        let resistor = choose(
            &request.resistor_values_ohm,
            i / (request.damper_values.len().max(1) * request.capacitor_values_uf.len().max(1)),
            0.0,
        );
        let gain = -gain_range + 2.0 * gain_range * w;

        results.push(evaluate_candidate(
            request,
            length,
            diameter,
            damper,
            cap,
            resistor,
            gain,
        ));
    }

    results.sort_by(|a, b| {
        a.score_rmse_db
            .partial_cmp(&b.score_rmse_db)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    // Stage 2: refine around the strongest global candidates.
    // This gives the reverse tool better numerical resolution without
    // exploding into a huge brute-force Cartesian product.
    if refine_evals > 0 && !results.is_empty() {
        let seed_count = results.len().min(12);
        let seeds: Vec<ReverseCandidate> = results[..seed_count].to_vec();
        let d_span = (max_d - min_d).max(0.05);
        let l_span = (max_l - min_l).max(0.25);
        let per_seed = (refine_evals / seed_count.max(1)).max(1);

        for (seed_index, seed) in seeds.iter().enumerate() {
            for j in 0..per_seed {
                if results.len() >= evals + seed_count {
                    break;
                }

                let n = (seed_index * per_seed + j) as f64 + 1.0;
                let du = ((n * 0.754_877_666).fract() - 0.5) * 2.0;
                let dv = ((n * 0.569_840_291).fract() - 0.5) * 2.0;
                let dg = ((n * 0.438_447_187).fract() - 0.5) * 2.0;

                let diameter = (seed.tube_diameter_mm + du * d_span * 0.08).clamp(min_d, max_d);
                let length = (seed.tube_length_mm + dv * l_span * 0.08).clamp(min_l, max_l);
                let gain = (seed.gain_db + dg * gain_range * 0.10).clamp(-gain_range, gain_range);

                results.push(evaluate_candidate(
                    request,
                    length,
                    diameter,
                    seed.damper_ohm,
                    seed.capacitor_uf,
                    seed.resistor_ohm,
                    gain,
                ));
            }
        }
    }

    results.sort_by(|a, b| {
        a.score_rmse_db
            .partial_cmp(&b.score_rmse_db)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    // Suppress near-duplicate recommendations so the result list gives
    // meaningfully different build options rather than tiny numeric variants.
    let mut unique: Vec<ReverseCandidate> = Vec::new();
    for candidate in results {
        let duplicate = unique.iter().any(|existing| {
            (existing.tube_length_mm - candidate.tube_length_mm).abs() < 0.15
                && (existing.tube_diameter_mm - candidate.tube_diameter_mm).abs() < 0.03
                && (existing.damper_ohm - candidate.damper_ohm).abs() < 0.5
                && (existing.capacitor_uf - candidate.capacitor_uf).abs() < 0.01
                && (existing.resistor_ohm - candidate.resistor_ohm).abs() < 0.01
                && (existing.gain_db - candidate.gain_db).abs() < 0.15
        });
        if !duplicate {
            unique.push(candidate);
        }
        if unique.len() >= request.result_count.clamp(1, 50) {
            break;
        }
    }

    unique
}

