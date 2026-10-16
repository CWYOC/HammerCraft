//! Loopback compute supervisor. Native Rust scalar FEM; explicit adapters for unmigrated kernels.
mod assets;
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, State},
    http::{HeaderMap, Method, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    io::Read,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tempfile::TempDir;
const MAX_INPUT: usize = 10 * 1024 * 1024;
const MAX_OUTPUT: u64 = 32 * 1024 * 1024;
#[derive(Clone)]
pub struct Config {
    pub port: u16,
    pub origins: Vec<String>,
    pub python: PathBuf,
    pub runner: PathBuf,
    pub timeout: Duration,
    pub retention: Duration,
    pub capabilities: Vec<String>,
}
struct Job {
    folder: TempDir,
    child: Child,
    started: Instant,
    timeout: Duration,
    result_key: &'static str,
    terminal: Option<(&'static str, String)>,
}
pub struct Service {
    pub config: Config,
    jobs: Mutex<BTreeMap<String, Job>>,
    upload: tokio::sync::Semaphore,
}
impl Service {
    pub fn new(config: Config) -> Arc<Self> {
        Arc::new(Self {
            config,
            jobs: Mutex::new(BTreeMap::new()),
            upload: tokio::sync::Semaphore::new(1),
        })
    }
    pub fn collect(&self) {
        if let Ok(mut jobs) = self.jobs.lock() {
            for job in jobs.values_mut() {
                if job.terminal.is_none()
                    && job.child.try_wait().ok().flatten().is_none()
                    && job.started.elapsed() > job.timeout
                {
                    let _ = job.child.kill();
                    let _ = job.child.wait();
                    job.terminal=Some(("Failed","Computation exceeded its time limit. Use a coarser mesh or simplify the study.".into()));
                }
            }
            jobs.retain(|_, job| {
                job.started.elapsed() < self.config.retention + job.timeout
                    || job.child.try_wait().ok().flatten().is_none()
            });
        }
    }
    pub fn close(&self) {
        if let Ok(mut jobs) = self.jobs.lock() {
            for job in jobs.values_mut() {
                let _ = job.child.kill();
                let _ = job.child.wait();
            }
            jobs.clear();
        }
    }
    fn start(&self, mut data: Value) -> Result<Value, (StatusCode, String)> {
        let kind = data
            .get("kind")
            .and_then(Value::as_str)
            .ok_or((StatusCode::BAD_REQUEST, "Missing compute kind.".into()))?
            .to_string();
        if !self.config.capabilities.iter().any(|s| s == &kind) {
            return Err((StatusCode::BAD_REQUEST, "Unsupported compute job.".into()));
        }
        if kind == "thermal-tetra" {
            serde_json::from_value::<engineering_core::conduction::ThermalRequest>(data.clone())
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
        }
        // Never accept a client-selected filesystem path. Resolve only a stored digest.
        if data.get("stepPath").is_some() {
            return Err((
                StatusCode::BAD_REQUEST,
                "Filesystem paths are not accepted.".into(),
            ));
        }
        if let Some(asset) = data.get("stepAsset") {
            if !["cad-step", "gmsh-tetra"].contains(&kind.as_str()) {
                return Err((
                    StatusCode::BAD_REQUEST,
                    "This job does not accept STEP assets.".into(),
                ));
            }
            let path = assets::resolve(self, asset)?;
            data["stepPath"] = json!(path);
        }
        if let Some(operations) = data.get_mut("operations") {
            if kind != "cad-step" {
                return Err((
                    StatusCode::BAD_REQUEST,
                    "CAD operations require a CAD job.".into(),
                ));
            }
            let operations = operations.as_array_mut().filter(|v| v.len() <= 24).ok_or((
                StatusCode::BAD_REQUEST,
                "Use at most 24 CAD operations.".into(),
            ))?;
            for operation in operations {
                if operation.get("stepPath").is_some() {
                    return Err((
                        StatusCode::BAD_REQUEST,
                        "Filesystem paths are not accepted.".into(),
                    ));
                }
                if let Some(asset) = operation.get("stepAsset") {
                    let path = assets::resolve(self, asset)?;
                    operation["stepPath"] = json!(path);
                }
            }
        }
        if kind == "cad-step" && data.get("stepPath").is_none() {
            return Err((
                StatusCode::BAD_REQUEST,
                "Upload the STEP file first.".into(),
            ));
        }
        self.collect();
        let mut jobs = self
            .jobs
            .lock()
            .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Job lock failed.".into()))?;
        if jobs
            .values_mut()
            .any(|j| j.child.try_wait().ok().flatten().is_none())
        {
            return Err((
                StatusCode::CONFLICT,
                "A compute job is already running. Cancel it or wait.".into(),
            ));
        }
        while jobs.len() >= 6 {
            let key = jobs
                .iter()
                .max_by_key(|(_, j)| j.started.elapsed())
                .unwrap()
                .0
                .clone();
            jobs.remove(&key);
        }
        let folder = tempfile::Builder::new()
            .prefix("hc-rust-compute-")
            .tempdir()
            .map_err(internal)?;
        let request = folder.path().join("request.json");
        let result = folder.path().join("result.json");
        let status = folder.path().join("status.json");
        std::fs::write(&request, serde_json::to_vec(&data).map_err(internal)?).map_err(internal)?;
        let mut command =
            if ["thermal-tetra", "electric-tetra", "structural-tetra"].contains(&kind.as_str()) {
                let mut c = Command::new(std::env::current_exe().map_err(internal)?);
                c.arg("--worker");
                c
            } else {
                let mut c = Command::new(&self.config.python);
                c.arg(&self.config.runner);
                c
            };
        command
            .arg(&request)
            .arg(&result)
            .arg(&status)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        for name in [
            "OMP_NUM_THREADS",
            "OPENBLAS_NUM_THREADS",
            "MKL_NUM_THREADS",
            "VECLIB_MAXIMUM_THREADS",
        ] {
            command.env(name, "1");
        }
        let child = command.spawn().map_err(internal)?;
        let id = uuid::Uuid::new_v4().to_string();
        let result_key = if kind == "cad-step" {
            "artifact"
        } else if kind == "gmsh-tetra" {
            "mesh"
        } else {
            "solution"
        };
        jobs.insert(
            id.clone(),
            Job {
                folder,
                child,
                started: Instant::now(),
                timeout: if kind == "cad-step" {
                    Duration::from_secs(900)
                } else {
                    self.config.timeout
                },
                result_key,
                terminal: None,
            },
        );
        Ok(json!({"id":id,"state":"Queued"}))
    }
    fn read(&self, id: &str) -> Result<Value, (StatusCode, String)> {
        self.collect();
        let mut jobs = self.jobs.lock().map_err(|_| internal("Job lock failed."))?;
        let job = jobs
            .get_mut(id)
            .ok_or((StatusCode::NOT_FOUND, "Job not found or expired.".into()))?;
        if let Some((state, error)) = &job.terminal {
            return Ok(json!({"id":id,"state":state,"error":error}));
        }
        if let Some(exit) = job.child.try_wait().map_err(internal)? {
            let path = job.folder.path().join("result.json");
            let data = match read_json(&path, MAX_OUTPUT) {
                Ok(data) => data,
                Err(error) => return Ok(json!({"id":id,"state":"Failed","error":error})),
            };
            if let Some(error) = data.get("error") {
                return Ok(json!({"id":id,"state":"Failed","error":error}));
            }
            if !exit.success() {
                return Ok(
                    json!({"id":id,"state":"Failed","error":"The compute process exited unsuccessfully."}),
                );
            }
            return Ok(json!({"id":id,"state":"Completed",job.result_key:data}));
        }
        let state = read_json(&job.folder.path().join("status.json"), 4096)
            .ok()
            .and_then(|v| v.get("state").and_then(Value::as_str).map(str::to_string))
            .filter(|s| {
                [
                    "Queued",
                    "Preparing",
                    "Meshing",
                    "Solving",
                    "Post-processing",
                ]
                .contains(&s.as_str())
            })
            .unwrap_or("Queued".into());
        Ok(json!({"id":id,"state":state}))
    }
    fn cancel(&self, id: &str) -> Result<Value, (StatusCode, String)> {
        let mut jobs = self.jobs.lock().map_err(|_| internal("Job lock failed."))?;
        let job = jobs
            .get_mut(id)
            .ok_or((StatusCode::NOT_FOUND, "Job not found or expired.".into()))?;
        if job.child.try_wait().map_err(internal)?.is_none() {
            job.child.kill().map_err(internal)?;
            job.child.wait().map_err(internal)?;
        }
        job.terminal = Some(("Cancelled", String::new()));
        for name in ["request.json", "result.json", "status.json"] {
            let _ = std::fs::remove_file(job.folder.path().join(name));
        }
        Ok(json!({"id":id,"state":"Cancelled"}))
    }
}
fn internal(_: impl std::fmt::Display) -> (StatusCode, String) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        "Compute service could not complete this request.".into(),
    )
}
fn api(result: Result<Value, (StatusCode, String)>, status: StatusCode) -> Response {
    match result {
        Ok(v) => (status, Json(v)).into_response(),
        Err((code, message)) => (code, Json(json!({"error":message}))).into_response(),
    }
}
fn read_json(path: &std::path::Path, limit: u64) -> Result<Value, String> {
    let file = std::fs::File::open(path)
        .map_err(|_| "The compute process stopped before producing a result.")?;
    if file
        .metadata()
        .map_err(|_| "Cannot inspect compute output.")?
        .len()
        > limit
    {
        return Err("Compute output exceeds its size limit.".into());
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot read compute output.")?;
    if bytes.len() as u64 > limit {
        return Err("Compute output exceeds its size limit.".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "Invalid compute output.".into())
}
async fn guard(
    State(s): State<Arc<Service>>,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    let h = request.headers();
    let host = h.get(header::HOST).and_then(|v| v.to_str().ok());
    let allowed_host = [
        format!("127.0.0.1:{}", s.config.port),
        format!("localhost:{}", s.config.port),
    ];
    let origin = h
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    if !host.is_some_and(|v| allowed_host.iter().any(|a| a == v))
        || h.contains_key(header::ORIGIN)
            && !origin
                .as_ref()
                .is_some_and(|v| s.config.origins.contains(v))
    {
        return api(
            Err((
                StatusCode::FORBIDDEN,
                "Origin or Host is not permitted.".into(),
            )),
            StatusCode::OK,
        );
    }
    let mut response = if request.method() == Method::OPTIONS {
        StatusCode::NO_CONTENT.into_response()
    } else if request.uri().path() != "/health"
        && h.get("X-HC-Compute").and_then(|v| v.to_str().ok()) != Some("1")
    {
        api(
            Err((
                StatusCode::FORBIDDEN,
                "Compute API header is required.".into(),
            )),
            StatusCode::OK,
        )
    } else {
        next.run(request).await
    };
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, "nosniff".parse().unwrap());
    if let Some(origin) = origin
        && let Ok(value) = origin.parse()
    {
        headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, value);
        headers.insert(header::VARY, "Origin".parse().unwrap());
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_METHODS,
            "GET, POST, DELETE, OPTIONS".parse().unwrap(),
        );
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            "Content-Type, X-HC-Compute".parse().unwrap(),
        );
    }
    response
}
async fn health(State(s): State<Arc<Service>>) -> Json<Value> {
    Json(
        json!({"service":"hc-engineering-compute","version":1,"runtime":{"language":"Rust","version":env!("CARGO_PKG_VERSION")},"mesher":if s.config.capabilities.iter().any(|k|k=="gmsh-tetra"){Some("4.15.2")}else{None},"capabilities":s.config.capabilities,"nativeSolvers":["thermal-tetra","electric-tetra","structural-tetra"],"adapters":s.config.capabilities.iter().filter(|k|!["thermal-tetra","electric-tetra","structural-tetra"].contains(&k.as_str())).collect::<Vec<_>>(),"maxTetrahedra":100000,"maxStepBytes":assets::MAX_STEP,"thermalSolver":engineering_core::conduction::thermal_settings()}),
    )
}
async fn start(
    State(s): State<Arc<Service>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    if headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        != Some("application/json")
    {
        return api(
            Err((
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "Use application/json.".into(),
            )),
            StatusCode::OK,
        );
    }
    if body.is_empty() {
        return api(
            Err((StatusCode::BAD_REQUEST, "Empty compute request.".into())),
            StatusCode::OK,
        );
    }
    match serde_json::from_slice(&body) {
        Ok(v) => api(s.start(v), StatusCode::ACCEPTED),
        Err(e) => api(
            Err((StatusCode::BAD_REQUEST, e.to_string())),
            StatusCode::OK,
        ),
    }
}
async fn read(State(s): State<Arc<Service>>, Path(id): Path<String>) -> Response {
    api(s.read(&id), StatusCode::OK)
}
async fn cancel(State(s): State<Arc<Service>>, Path(id): Path<String>) -> Response {
    api(s.cancel(&id), StatusCode::OK)
}
pub fn router(service: Arc<Service>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/jobs", axum::routing::post(start))
        .route("/jobs/{id}", get(read).delete(cancel))
        .layer(DefaultBodyLimit::max(MAX_INPUT))
        .route(
            "/step-assets",
            axum::routing::post(assets::upload).layer(DefaultBodyLimit::disable()),
        )
        .route("/step-assets/{hash}", get(assets::download))
        .layer(middleware::from_fn_with_state(service.clone(), guard))
        .with_state(service)
}
pub fn worker(args: &[String]) -> Result<(), String> {
    if args.len() != 3 {
        return Err("Worker needs request, result and status paths.".into());
    }
    let request = PathBuf::from(&args[0]);
    let result = PathBuf::from(&args[1]);
    let progress = PathBuf::from(&args[2]);
    let status = |state: &str| {
        let pending = progress.with_extension("tmp");
        if std::fs::write(&pending, json!({"state":state}).to_string()).is_ok() {
            let _ = std::fs::rename(pending, &progress);
        }
    };
    let solve = || -> Result<Value, String> {
        let data = read_json(&request, MAX_INPUT as u64)?;
        match data.get("kind").and_then(Value::as_str) {
            Some("thermal-tetra") => {
                let q = serde_json::from_value(data)
                    .map_err(|e| format!("Invalid thermal request: {e}"))?;
                serde_json::to_value(engineering_core::conduction::solve_thermal(
                    &q,
                    &mut |state| status(state),
                )?)
                .map_err(|e| e.to_string())
            }
            Some("structural-tetra") => {
                let q = serde_json::from_value(data)
                    .map_err(|e| format!("Invalid structural request: {e}"))?;
                serde_json::to_value(engineering_core::structural::solve(&q, &mut |state| {
                    status(state)
                })?)
                .map_err(|e| e.to_string())
            }
            Some("electric-tetra") => {
                let q = serde_json::from_value(data)
                    .map_err(|e| format!("Invalid electrical request: {e}"))?;
                serde_json::to_value(engineering_core::electrical::solve(&q, &mut |state| {
                    status(state)
                })?)
                .map_err(|e| e.to_string())
            }
            _ => Err("Unsupported native Rust job.".into()),
        }
    };
    let (data, state) = match solve() {
        Ok(v) => (v, "Completed"),
        Err(e) => (json!({"error":e}), "Failed"),
    };
    let bytes = serde_json::to_vec(&data).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_OUTPUT {
        std::fs::write(
            &result,
            json!({"error":"Compute output exceeds 32 MiB."}).to_string(),
        )
        .map_err(|e| e.to_string())?;
        status("Failed");
        return Err("Output limit.".into());
    }
    std::fs::write(&result, bytes).map_err(|e| e.to_string())?;
    status(state);
    if state == "Failed" {
        Err("Solve failed.".into())
    } else {
        Ok(())
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    fn fixture(timeout: Duration) -> (TempDir, Arc<Service>) {
        let dir = tempfile::tempdir().unwrap();
        let runner = dir.path().join("test-runner.sh");
        std::fs::write(&runner, "exec sleep 30\n").unwrap();
        let service = Service::new(Config {
            port: 8766,
            origins: vec![],
            python: "/bin/sh".into(),
            runner,
            timeout,
            retention: Duration::from_secs(60),
            capabilities: vec!["gmsh-tetra".into()],
        });
        (dir, service)
    }
    #[test]
    fn cancellation_reaps_child_and_preserves_terminal_state() {
        let (_dir, s) = fixture(Duration::from_secs(30));
        let first = s.start(json!({"kind":"gmsh-tetra"})).unwrap();
        let id = first["id"].as_str().unwrap();
        assert_eq!(
            s.start(json!({"kind":"gmsh-tetra"})).unwrap_err().0,
            StatusCode::CONFLICT
        );
        assert_eq!(s.cancel(id).unwrap()["state"], "Cancelled");
        assert_eq!(s.read(id).unwrap()["state"], "Cancelled");
        let jobs = s.jobs.lock().unwrap();
        let job = &jobs[id];
        assert!(!job.folder.path().join("request.json").exists());
        drop(jobs);
        s.close();
    }
    #[test]
    fn watchdog_terminates_job_without_browser_polling() {
        let (_dir, s) = fixture(Duration::ZERO);
        let first = s.start(json!({"kind":"gmsh-tetra"})).unwrap();
        let id = first["id"].as_str().unwrap();
        s.collect();
        let response = s.read(id).unwrap();
        assert_eq!(response["state"], "Failed");
        assert!(response["error"].as_str().unwrap().contains("time limit"));
        assert!(
            s.jobs
                .lock()
                .unwrap()
                .get_mut(id)
                .unwrap()
                .child
                .try_wait()
                .unwrap()
                .is_some()
        );
        s.close();
    }
}
