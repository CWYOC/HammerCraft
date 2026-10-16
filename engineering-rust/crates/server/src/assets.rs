//! Bounded streaming STEP uploads. Geometry never travels in a giant JSON string.
use super::*;
use axum::body::Body;
use http_body_util::BodyExt;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
pub const MAX_STEP: u64 = 1_500_000_000;
pub fn folder(s: &Service) -> PathBuf {
    s.config.runner.parent().unwrap().join(".step-assets")
}
pub fn resolve(s: &Service, asset: &Value) -> Result<PathBuf, (StatusCode, String)> {
    let hash = asset["sha256"].as_str().unwrap_or("");
    if hash.len() != 64
        || !hash
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err((
            StatusCode::BAD_REQUEST,
            "Invalid STEP asset identity.".into(),
        ));
    }
    let path = folder(s).join(format!("{hash}.step"));
    let size=std::fs::metadata(&path).map_err(|_|(StatusCode::NOT_FOUND,"STEP source is missing on this computer. Import the original file again to restore it.".into()))?.len();
    if asset.get("bytes").is_some() && asset["bytes"].as_u64() != Some(size) {
        return Err((StatusCode::BAD_REQUEST, "STEP asset size differs.".into()));
    }
    Ok(path)
}
async fn receive(
    s: Arc<Service>,
    headers: HeaderMap,
    mut body: Body,
) -> Result<Value, (StatusCode, String)> {
    let _permit = s.upload.try_acquire().map_err(|_| {
        (
            StatusCode::CONFLICT,
            "A STEP upload is already running.".into(),
        )
    })?;
    if headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        != Some("application/octet-stream")
    {
        return Err((
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "Use application/octet-stream for STEP uploads.".into(),
        ));
    }
    let declared = match headers.get(header::CONTENT_LENGTH) {
        Some(v) => Some(
            v.to_str()
                .ok()
                .and_then(|v| v.parse::<u64>().ok())
                .ok_or((StatusCode::BAD_REQUEST, "Invalid upload length.".into()))?,
        ),
        None => None,
    };
    if declared.is_some_and(|v| v > MAX_STEP) {
        return Err((
            StatusCode::PAYLOAD_TOO_LARGE,
            "STEP uploads must not exceed 1.5 GB (1,500,000,000 bytes).".into(),
        ));
    }
    tokio::fs::create_dir_all(folder(&s))
        .await
        .map_err(internal)?;
    let temporary = tempfile::Builder::new()
        .prefix("upload-")
        .tempfile_in(folder(&s))
        .map_err(internal)?
        .into_temp_path();
    let mut file = tokio::fs::File::create(&temporary)
        .await
        .map_err(internal)?;
    let mut size = 0_u64;
    let mut hash = Sha256::new();
    let mut prefix = Vec::new();
    let mut tail = Vec::new();
    while let Some(frame) = body.frame().await {
        let frame = frame.map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                "STEP upload was interrupted.".into(),
            )
        })?;
        if let Ok(bytes) = frame.into_data() {
            size = size.checked_add(bytes.len() as u64).ok_or((
                StatusCode::PAYLOAD_TOO_LARGE,
                "STEP upload too large.".into(),
            ))?;
            if size > MAX_STEP {
                return Err((
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "STEP uploads must not exceed 1.5 GB (1,500,000,000 bytes).".into(),
                ));
            }
            if bytes
                .iter()
                .any(|b| *b < 32 && !matches!(b, b'\t' | b'\r' | b'\n'))
            {
                return Err((
                    StatusCode::BAD_REQUEST,
                    "STEP contains binary or unsupported control characters.".into(),
                ));
            }
            if prefix.len() < 4096 {
                prefix.extend_from_slice(&bytes[..bytes.len().min(4096 - prefix.len())]);
            }
            if bytes.len() >= 4096 {
                tail.clear();
                tail.extend_from_slice(&bytes[bytes.len() - 4096..]);
            } else {
                tail.extend_from_slice(&bytes);
                if tail.len() > 4096 {
                    tail.drain(..tail.len() - 4096);
                }
            }
            hash.update(&bytes);
            file.write_all(&bytes).await.map_err(internal)?;
        }
    }
    let begin = String::from_utf8_lossy(&prefix);
    let end = String::from_utf8_lossy(&tail);
    if declared.is_some_and(|v| v != size)
        || !begin
            .trim_start_matches(['\u{feff}', ' ', '\r', '\n', '\t'])
            .to_ascii_uppercase()
            .starts_with("ISO-10303-21;")
        || !end
            .trim_end()
            .to_ascii_uppercase()
            .ends_with("END-ISO-10303-21;")
    {
        return Err((
            StatusCode::BAD_REQUEST,
            "Choose a complete text STEP file; its header or terminator is missing.".into(),
        ));
    }
    file.flush().await.map_err(internal)?;
    drop(file);
    let hash = format!("{:x}", hash.finalize());
    let target = folder(&s).join(format!("{hash}.step"));
    if !target.exists() {
        temporary.persist(&target).map_err(internal)?;
    }
    Ok(json!({"sha256":hash,"bytes":size}))
}
pub async fn upload(State(s): State<Arc<Service>>, headers: HeaderMap, body: Body) -> Response {
    let result = tokio::time::timeout(Duration::from_secs(1800), receive(s, headers, body))
        .await
        .unwrap_or_else(|_| {
            Err((
                StatusCode::REQUEST_TIMEOUT,
                "STEP upload timed out after 30 minutes.".into(),
            ))
        });
    api(result, StatusCode::CREATED)
}
pub async fn download(State(s): State<Arc<Service>>, Path(hash): Path<String>) -> Response {
    let path = match resolve(&s, &json!({"sha256":hash})) {
        Ok(p) => p,
        Err(e) => return api(Err(e), StatusCode::OK),
    };
    let file = match tokio::fs::File::open(path).await {
        Ok(f) => f,
        Err(e) => return api(Err(internal(e)), StatusCode::OK),
    };
    let stream = futures_util::stream::try_unfold(file, |mut file| async move {
        let mut buffer = vec![0; 1024 * 1024];
        let n = file.read(&mut buffer).await?;
        if n == 0 {
            Ok::<_, std::io::Error>(None)
        } else {
            buffer.truncate(n);
            Ok(Some((buffer, file)))
        }
    });
    (
        [
            (header::CONTENT_TYPE, "application/octet-stream"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=solid.step",
            ),
        ],
        Body::from_stream(stream),
    )
        .into_response()
}
