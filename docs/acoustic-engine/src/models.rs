use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DriverType {
    Dynamic,
    BalancedArmature,
    Planar,
    Magnetostatic,
    BoneConduction,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrequencyPoint {
    pub frequency_hz: f64,
    pub db: f64,
    #[serde(default)]
    pub phase_deg: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImpedancePoint {
    pub frequency_hz: f64,
    pub magnitude_ohm: f64,
    #[serde(default)]
    pub phase_deg: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ElectricalElement {
    SeriesResistor { resistance_ohm: f64 },
    SeriesCapacitor { capacitance_uf: f64 },
    SeriesInductor { inductance_mh: f64 },
    ParallelResistor { resistance_ohm: f64 },
    ParallelCapacitor { capacitance_uf: f64 },
    ParallelInductor { inductance_mh: f64 },
    PeakingEq { frequency_hz: f64, gain_db: f64, q: f64 },
    HighPass { frequency_hz: f64, q: f64 },
    LowPass { frequency_hz: f64, q: f64 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CircuitNode {
    pub id: String,
    #[serde(default)]
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CircuitComponentKind {
    Resistor { resistance_ohm: f64 },
    Capacitor { capacitance_uf: f64 },
    Inductor { inductance_mh: f64 },
    Wire,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CircuitComponent {
    pub id: String,
    #[serde(default)]
    pub label: String,
    pub node_a: String,
    pub node_b: String,
    pub kind: CircuitComponentKind,
    #[serde(default)]
    pub bypassed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CircuitNetlist {
    pub input_node: String,
    pub output_node: String,
    pub ground_node: String,
    #[serde(default)]
    pub nodes: Vec<CircuitNode>,
    #[serde(default)]
    pub components: Vec<CircuitComponent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AcousticElement {
    Tube {
        length_mm: f64,
        diameter_mm: f64,
        #[serde(default)]
        loss_factor: f64,
    },
    Damper { resistance_acoustic_ohm: f64 },
    ExpansionChamber { length_mm: f64, diameter_mm: f64 },
    Nozzle { length_mm: f64, diameter_mm: f64 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AcousticSource {
    IdealPressure,
    Characteristic {
        #[serde(default = "default_source_multiplier")]
        impedance_multiplier: f64,
    },
    OutletInertance {
        outlet_diameter_mm: f64,
        effective_length_mm: f64,
        #[serde(default)]
        resistance_acoustic_ohm: f64,
    },
}

fn default_source_multiplier() -> f64 { 1.0 }
impl Default for AcousticSource {
    fn default() -> Self { Self::IdealPressure }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AcousticLoad {
    Anechoic,
    Radiation,
    ClosedCavity {
        #[serde(default = "default_coupler_volume")]
        volume_mm3: f64,
        #[serde(default)]
        loss_resistance_acoustic_ohm: f64,
    },
    CavityWithLeak {
        #[serde(default = "default_coupler_volume")]
        volume_mm3: f64,
        #[serde(default = "default_leak_resistance")]
        leak_resistance_acoustic_ohm: f64,
    },
    Generic711Approx,
}

fn default_coupler_volume() -> f64 { 2000.0 }
fn default_leak_resistance() -> f64 { 5.0e8 }
impl Default for AcousticLoad {
    fn default() -> Self { Self::Anechoic }
}

fn default_impedance() -> f64 { 16.0 }
fn default_sensitivity_reference() -> f64 { 1000.0 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Driver {
    pub id: String,
    pub name: String,
    pub driver_type: DriverType,
    #[serde(default = "default_impedance")]
    pub nominal_impedance_ohm: f64,
    #[serde(default)]
    pub sensitivity_db: f64,
    #[serde(default = "default_sensitivity_reference")]
    pub sensitivity_reference_hz: f64,
    #[serde(default)]
    pub response_absolute_spl: bool,
    #[serde(default)]
    pub gain_db: f64,
    #[serde(default)]
    pub polarity_inverted: bool,
    #[serde(default)]
    pub response: Vec<FrequencyPoint>,
    #[serde(default)]
    pub impedance: Vec<ImpedancePoint>,

    // Legacy ordered electrical chain. Kept for backwards compatibility and
    // for active PEQ/HP/LP blocks. New passive crossover work should use
    // circuit_netlist so arbitrary branches are solved by nodal analysis.
    #[serde(default)]
    pub electrical: Vec<ElectricalElement>,

    #[serde(default)]
    pub circuit_netlist: Option<CircuitNetlist>,

    #[serde(default)]
    pub acoustic_path: Vec<AcousticElement>,
    #[serde(default)]
    pub acoustic_source: AcousticSource,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Environment {
    #[serde(default = "default_temperature")]
    pub temperature_c: f64,
    #[serde(default = "default_humidity")]
    pub relative_humidity_percent: f64,
}
fn default_temperature() -> f64 { 20.0 }
fn default_humidity() -> f64 { 50.0 }
impl Default for Environment {
    fn default() -> Self {
        Self { temperature_c: 20.0, relative_humidity_percent: 50.0 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimulationRequest {
    pub frequencies_hz: Vec<f64>,
    pub drivers: Vec<Driver>,
    #[serde(default)]
    pub environment: Environment,
    #[serde(default)]
    pub acoustic_load: AcousticLoad,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DriverResultPoint {
    pub frequency_hz: f64,
    pub db: f64,
    pub phase_deg: f64,
    pub impedance_ohm: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DriverSimulationResult {
    pub driver_id: String,
    pub driver_name: String,
    pub points: Vec<DriverResultPoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CombinedResultPoint {
    pub frequency_hz: f64,
    pub db: f64,
    pub phase_deg: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimulationResult {
    pub drivers: Vec<DriverSimulationResult>,
    pub combined: Vec<CombinedResultPoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReverseDesignRequest {
    pub base_request: SimulationRequest,
    pub target: Vec<FrequencyPoint>,
    pub driver_index: usize,
    pub min_tube_length_mm: f64,
    pub max_tube_length_mm: f64,
    pub min_tube_diameter_mm: f64,
    pub max_tube_diameter_mm: f64,
    #[serde(default)]
    pub damper_values: Vec<f64>,
    #[serde(default)]
    pub capacitor_values_uf: Vec<f64>,
    #[serde(default)]
    pub resistor_values_ohm: Vec<f64>,
    #[serde(default = "default_gain_range")]
    pub gain_range_db: f64,
    #[serde(default = "default_evaluations")]
    pub max_evaluations: usize,
    #[serde(default = "default_result_count")]
    pub result_count: usize,
    #[serde(default = "default_normalization_frequency")]
    pub normalization_frequency_hz: f64,
    #[serde(default)]
    pub absolute_match: bool,
}
fn default_gain_range() -> f64 { 8.0 }
fn default_evaluations() -> usize { 3200 }
fn default_result_count() -> usize { 10 }
fn default_normalization_frequency() -> f64 { 1000.0 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReverseCandidate {
    pub score_rmse_db: f64,
    pub tube_length_mm: f64,
    pub tube_diameter_mm: f64,
    pub damper_ohm: f64,
    pub capacitor_uf: f64,
    pub resistor_ohm: f64,
    pub gain_db: f64,
}
