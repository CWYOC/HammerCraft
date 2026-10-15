use engineering_server::{Config, Service};
use std::{path::PathBuf, time::Duration};
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("--worker") {
        return engineering_server::worker(&args[1..]).map_err(Into::into);
    }
    let mut root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let mut port = 8766;
    let mut python_override = None;
    let mut origins = vec![];
    let mut i = 0;
    while i < args.len() {
        let value = args.get(i + 1).ok_or("Every option needs a value.")?;
        match args[i].as_str() {
            "--port" => port = value.parse()?,
            "--python" => python_override = Some(PathBuf::from(value)),
            "--root" => root = PathBuf::from(value),
            "--origin" => origins.push(value.clone()),
            _ => return Err("Unknown option.".into()),
        }
        i += 2;
    }
    let root = root.canonicalize()?;
    let python =
        python_override.unwrap_or_else(|| root.join("tools/engineering-compute/.venv/bin/python"));
    let runner = root.join("tools/engineering-compute/runner.py");
    if origins.is_empty() {
        origins = vec![
            "http://127.0.0.1:8765".into(),
            "http://localhost:8765".into(),
        ];
    }
    let probe=std::process::Command::new(&python).args(["-c","import gmsh,skfem,scipy,numpy;assert (gmsh.__version__,skfem.__version__,scipy.__version__,numpy.__version__)==('4.15.2','12.0.2','1.18.1','2.4.4')"]).output();
    let mut capabilities = vec![
        "thermal-tetra".into(),
        "electric-tetra".into(),
        "structural-tetra".into(),
    ];
    if runner.is_file() && probe.is_ok_and(|p| p.status.success()) {
        capabilities.extend(["gmsh-tetra", "modal-tetra", "harmonic-tetra"].map(String::from));
    } else {
        eprintln!(
            "CAD and mechanics adapters unavailable: install the pinned Python requirements. Native Rust thermal, electrical and static structural FEM remain available."
        );
    }
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await?;
    let port = listener.local_addr()?.port();
    let service = Service::new(Config {
        port,
        origins,
        python,
        runner,
        timeout: Duration::from_secs(90),
        retention: Duration::from_secs(600),
        capabilities,
    });
    let watchdog = service.clone();
    let watch = tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(1));
        loop {
            tick.tick().await;
            watchdog.collect();
        }
    });
    println!("Engineering Rust compute: http://127.0.0.1:{port}");
    let router = engineering_server::router(service.clone());
    axum::serve(listener, router)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    watch.abort();
    service.close();
    Ok(())
}
