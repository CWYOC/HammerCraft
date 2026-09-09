use crate::models::{
    AcousticElement, CircuitComponent, CircuitComponentKind, CircuitNetlist, CircuitNode,
    ElectricalElement, FrequencyPoint, ReverseCandidate, ReverseDesignRequest, ReversePeqFilter,
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

fn rmse(
    simulation: &crate::models::SimulationResult,
    target: &[FrequencyPoint],
    normalization_frequency_hz: f64,
    absolute_match: bool,
) -> f64 {
    if simulation.combined.is_empty() || target.is_empty() { return f64::INFINITY; }
    let f_norm = normalization_frequency_hz.clamp(20.0, 20000.0);
    let sim_norm = interpolate_combined(&simulation.combined, f_norm);
    let target_norm = interpolate_target(target, f_norm);
    let mut sum = 0.0;
    let mut count = 0usize;

    for point in &simulation.combined {
        let target_db = interpolate_target(target, point.frequency_hz);
        let (desired, actual) = if absolute_match {
            (target_db, point.db)
        } else {
            (target_db - target_norm, point.db - sim_norm)
        };
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

    // Preserve user response-domain filters. Reverse PEQ is added later to a clone.
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

fn candidate_request(request: &ReverseDesignRequest, candidate: &ReverseCandidate) -> crate::models::SimulationRequest {
    let mut candidate_request = request.base_request.clone();
    let driver = &mut candidate_request.drivers[request.driver_index];
    set_candidate(
        driver,
        candidate.tube_length_mm,
        candidate.tube_diameter_mm,
        candidate.damper_ohm,
        candidate.capacitor_uf,
        candidate.resistor_ohm,
        candidate.gain_db,
    );
    for peq in &candidate.peq_filters {
        driver.electrical.push(ElectricalElement::PeakingEq {
            frequency_hz: peq.frequency_hz,
            gain_db: peq.gain_db,
            q: peq.q,
        });
    }
    candidate_request
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
    let score = rmse(&simulation, &request.target, request.normalization_frequency_hz, request.absolute_match);

    ReverseCandidate {
        score_rmse_db: score,
        physical_rmse_db: score,
        tube_length_mm: length,
        tube_diameter_mm: diameter,
        damper_ohm: damper,
        capacitor_uf: cap,
        resistor_ohm: resistor,
        gain_db: gain,
        peq_filters: Vec::new(),
    }
}

fn residual_at(
    simulation: &crate::models::SimulationResult,
    target: &[FrequencyPoint],
    frequency_hz: f64,
    normalization_frequency_hz: f64,
    absolute_match: bool,
) -> f64 {
    let actual = interpolate_combined(&simulation.combined, frequency_hz);
    let desired = interpolate_target(target, frequency_hz);
    if absolute_match {
        desired - actual
    } else {
        let f_norm = normalization_frequency_hz.clamp(20.0, 20000.0);
        let sim_norm = interpolate_combined(&simulation.combined, f_norm);
        let target_norm = interpolate_target(target, f_norm);
        (desired - target_norm) - (actual - sim_norm)
    }
}

fn q_grid(min_q: f64, max_q: f64) -> Vec<f64> {
    let lo = min_q.max(0.1);
    let hi = max_q.max(lo);
    let canonical = [0.30, 0.45, 0.60, 0.80, 1.0, 1.4, 2.0, 3.0, 4.5, 6.0, 8.0, 10.0];
    let mut out: Vec<f64> = canonical.into_iter().filter(|q| *q >= lo && *q <= hi).collect();
    if out.is_empty() { out.push((lo * hi).sqrt()); }
    out
}

fn optimise_peq_for_candidate(request: &ReverseDesignRequest, mut candidate: ReverseCandidate) -> ReverseCandidate {
    if !request.allow_peq || request.max_peq_filters == 0 { return candidate; }

    let min_f = request.peq_min_frequency_hz.max(20.0);
    let max_f = request.peq_max_frequency_hz.min(20000.0).max(min_f);
    let max_boost = request.peq_max_boost_db.max(0.0);
    let max_cut = request.peq_max_cut_db.max(0.0);
    let q_values = q_grid(request.peq_min_q, request.peq_max_q);
    let max_filters = request.max_peq_filters.clamp(1, 10);

    let mut current_request = candidate_request(request, &candidate);
    let mut current_sim = simulate(&current_request);
    let mut current_rmse = rmse(&current_sim, &request.target, request.normalization_frequency_hz, request.absolute_match);

    for _ in 0..max_filters {
        // Find a handful of strongest residual regions from the target control points.
        let mut residual_points: Vec<(f64, f64)> = request.target.iter()
            .filter(|p| p.frequency_hz >= min_f && p.frequency_hz <= max_f)
            .map(|p| (p.frequency_hz, residual_at(
                &current_sim,
                &request.target,
                p.frequency_hz,
                request.normalization_frequency_hz,
                request.absolute_match,
            )))
            .collect();
        residual_points.sort_by(|a, b| b.1.abs().partial_cmp(&a.1.abs()).unwrap_or(std::cmp::Ordering::Equal));
        residual_points.truncate(5);
        if residual_points.is_empty() { break; }

        let mut best: Option<(ReversePeqFilter, f64, crate::models::SimulationResult)> = None;

        for (frequency, residual) in residual_points {
            let full_gain = residual.clamp(-max_cut, max_boost);
            if full_gain.abs() < 0.10 { continue; }
            let gains = [full_gain, full_gain * 0.70, full_gain * 0.45];

            for q in &q_values {
                for gain in gains {
                    if gain.abs() < 0.05 { continue; }
                    let filter = ReversePeqFilter { frequency_hz: frequency, gain_db: gain, q: *q };
                    let mut trial = current_request.clone();
                    trial.drivers[request.driver_index].electrical.push(ElectricalElement::PeakingEq {
                        frequency_hz: filter.frequency_hz,
                        gain_db: filter.gain_db,
                        q: filter.q,
                    });
                    let sim = simulate(&trial);
                    let score = rmse(&sim, &request.target, request.normalization_frequency_hz, request.absolute_match);

                    if best.as_ref().map(|(_, best_score, _)| score < *best_score).unwrap_or(true) {
                        best = Some((filter, score, sim));
                    }
                }
            }
        }

        let Some((filter, next_rmse, next_sim)) = best else { break; };
        let required_improvement = if request.prefer_fewer_peq_filters {
            request.peq_filter_penalty_db.max(0.0)
        } else { 0.0 };

        if current_rmse - next_rmse <= required_improvement { break; }

        candidate.peq_filters.push(filter.clone());
        current_request.drivers[request.driver_index].electrical.push(ElectricalElement::PeakingEq {
            frequency_hz: filter.frequency_hz,
            gain_db: filter.gain_db,
            q: filter.q,
        });
        current_sim = next_sim;
        current_rmse = next_rmse;
    }

    candidate.score_rmse_db = current_rmse;
    candidate
}

fn ranking_score(request: &ReverseDesignRequest, candidate: &ReverseCandidate) -> f64 {
    candidate.score_rmse_db + if request.prefer_fewer_peq_filters {
        candidate.peq_filters.len() as f64 * request.peq_filter_penalty_db.max(0.0)
    } else { 0.0 }
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

    for i in 0..global_evals {
        let u = ((i as f64 * 0.618_033_988_75).fract()).abs();
        let v = ((i as f64 * 0.414_213_562_37).fract()).abs();
        let w = ((i as f64 * 0.732_050_807_57).fract()).abs();
        let diameter = min_d + (max_d - min_d) * u;
        let length = min_l + (max_l - min_l) * v;
        let damper = choose(&request.damper_values, i, 0.0);
        let cap = choose(&request.capacitor_values_uf, i / request.damper_values.len().max(1), 0.0);
        let resistor = choose(
            &request.resistor_values_ohm,
            i / (request.damper_values.len().max(1) * request.capacitor_values_uf.len().max(1)),
            0.0,
        );
        let gain = -gain_range + 2.0 * gain_range * w;
        results.push(evaluate_candidate(request, length, diameter, damper, cap, resistor, gain));
    }

    results.sort_by(|a, b| a.score_rmse_db.partial_cmp(&b.score_rmse_db).unwrap_or(std::cmp::Ordering::Equal));

    if refine_evals > 0 && !results.is_empty() {
        let seed_count = results.len().min(12);
        let seeds: Vec<ReverseCandidate> = results[..seed_count].to_vec();
        let d_span = (max_d - min_d).max(0.05);
        let l_span = (max_l - min_l).max(0.25);
        let per_seed = (refine_evals / seed_count.max(1)).max(1);

        for (seed_index, seed) in seeds.iter().enumerate() {
            for j in 0..per_seed {
                if results.len() >= evals + seed_count { break; }
                let n = (seed_index * per_seed + j) as f64 + 1.0;
                let du = ((n * 0.754_877_666).fract() - 0.5) * 2.0;
                let dv = ((n * 0.569_840_291).fract() - 0.5) * 2.0;
                let dg = ((n * 0.438_447_187).fract() - 0.5) * 2.0;
                let diameter = (seed.tube_diameter_mm + du * d_span * 0.08).clamp(min_d, max_d);
                let length = (seed.tube_length_mm + dv * l_span * 0.08).clamp(min_l, max_l);
                let gain = (seed.gain_db + dg * gain_range * 0.10).clamp(-gain_range, gain_range);
                results.push(evaluate_candidate(
                    request, length, diameter, seed.damper_ohm, seed.capacitor_uf,
                    seed.resistor_ohm, gain,
                ));
            }
        }
    }

    results.sort_by(|a, b| a.score_rmse_db.partial_cmp(&b.score_rmse_db).unwrap_or(std::cmp::Ordering::Equal));

    // Keep a small pool of physically strong and meaningfully different candidates.
    let peq_pool_target = request.result_count.clamp(1, 50).max(8).min(16);
    let mut physical_unique: Vec<ReverseCandidate> = Vec::new();
    for candidate in results {
        let duplicate = physical_unique.iter().any(|existing| {
            (existing.tube_length_mm - candidate.tube_length_mm).abs() < 0.15
                && (existing.tube_diameter_mm - candidate.tube_diameter_mm).abs() < 0.03
                && (existing.damper_ohm - candidate.damper_ohm).abs() < 0.5
                && (existing.capacitor_uf - candidate.capacitor_uf).abs() < 0.01
                && (existing.resistor_ohm - candidate.resistor_ohm).abs() < 0.01
                && (existing.gain_db - candidate.gain_db).abs() < 0.15
        });
        if !duplicate { physical_unique.push(candidate); }
        if physical_unique.len() >= peq_pool_target { break; }
    }

    let mut final_candidates: Vec<ReverseCandidate> = physical_unique.into_iter()
        .map(|candidate| optimise_peq_for_candidate(request, candidate))
        .collect();

    final_candidates.sort_by(|a, b| {
        ranking_score(request, a)
            .partial_cmp(&ranking_score(request, b))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    final_candidates.truncate(request.result_count.clamp(1, 50));
    final_candidates
}
