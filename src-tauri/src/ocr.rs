use base64::{Engine, engine::general_purpose::STANDARD};
use serde::Serialize;
use serde_json::{Value, json};
use std::{path::PathBuf, process::Stdio, sync::Mutex, time::Duration};
use tauri::{Manager, State};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::{Mutex as AsyncMutex, watch},
};

#[derive(Debug, Serialize)]
pub struct OcrError {
    code: &'static str,
    message: String,
}
type Result<T> = std::result::Result<T, OcrError>;
fn error(code: &'static str, message: &str) -> OcrError {
    OcrError {
        code,
        message: message.into(),
    }
}
fn cancelled() -> OcrError {
    error("cancelled", "Подготовка остановлена.")
}
fn failed() -> OcrError {
    error(
        "ocr_failed",
        "Локальный OCR завершился с ошибкой. Повторите подготовку.",
    )
}

struct Worker {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}
#[derive(Default)]
pub struct OcrService {
    active: Mutex<Option<(String, watch::Sender<bool>)>>,
    worker: AsyncMutex<Option<Worker>>,
}
impl OcrService {
    fn receiver(&self, id: &str) -> Result<watch::Receiver<bool>> {
        let guard = self.active.lock().map_err(|_| failed())?;
        let Some((active, sender)) = guard.as_ref() else {
            return Err(cancelled());
        };
        if active != id {
            return Err(cancelled());
        }
        let rx = sender.subscribe();
        if *rx.borrow() {
            return Err(cancelled());
        }
        Ok(rx)
    }
}

#[tauri::command]
pub fn ocr_begin(request_id: String, state: State<'_, OcrService>) -> Result<()> {
    if request_id.is_empty()
        || request_id.len() > 64
        || !request_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err(error(
            "invalid_request",
            "Некорректный идентификатор подготовки.",
        ));
    }
    let mut guard = state.active.lock().map_err(|_| failed())?;
    if guard.is_some() {
        return Err(error("busy", "Дождитесь завершения предыдущей подготовки."));
    }
    let (sender, _) = watch::channel(false);
    *guard = Some((request_id, sender));
    Ok(())
}

#[tauri::command]
pub fn ocr_cancel(request_id: String, state: State<'_, OcrService>) -> Result<()> {
    let guard = state.active.lock().map_err(|_| failed())?;
    if let Some((id, sender)) = guard.as_ref() {
        if id == &request_id {
            sender.send_replace(true);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn ocr_end(request_id: String, state: State<'_, OcrService>) -> Result<()> {
    {
        let guard = state.active.lock().map_err(|_| failed())?;
        if !guard.as_ref().is_some_and(|(id, _)| id == &request_id) {
            return Ok(());
        }
        if let Some((_, sender)) = guard.as_ref() {
            sender.send_replace(true);
        }
    }
    let mut worker = state.worker.lock().await;
    if let Some(mut old) = worker.take() {
        let _ = old.child.kill().await;
    }
    let mut guard = state.active.lock().map_err(|_| failed())?;
    if guard.as_ref().is_some_and(|(id, _)| id == &request_id) {
        *guard = None;
    }
    Ok(())
}

pub fn validate_image(image: &str) -> Result<()> {
    if image.len() > 6 * 1024 * 1024 {
        return Err(error(
            "image_limit",
            "Фрагмент слишком велик для локального OCR.",
        ));
    }
    let data = image
        .strip_prefix("data:image/png;base64,")
        .ok_or_else(failed)?;
    let bytes = STANDARD.decode(data).map_err(|_| failed())?;
    if bytes.len() < 33
        || bytes.len() > 4 * 1024 * 1024
        || &bytes[..8] != b"\x89PNG\r\n\x1a\n"
        || &bytes[12..16] != b"IHDR"
    {
        return Err(failed());
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
    if !(1..=2401).contains(&width) || !(1..=2401).contains(&height) {
        return Err(failed());
    }
    Ok(())
}

fn worker_path(app: &tauri::AppHandle) -> Result<PathBuf> {
    let packaged = app
        .path()
        .resource_dir()
        .map_err(|_| failed())?
        .join("ocr/ocr-worker.exe");
    if packaged.is_file() {
        return Ok(packaged);
    }
    #[cfg(debug_assertions)]
    {
        let local = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../.local/ocr-dist/ocr-worker/ocr-worker.exe");
        if local.is_file() {
            return Ok(local);
        }
    }
    Err(error(
        "ocr_missing",
        "Компонент OCR не установлен. Установите полную сборку ИИ СКАНЕР 0.4.",
    ))
}

impl Worker {
    fn spawn(path: PathBuf) -> Result<Self> {
        let mut command = Command::new(path);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let mut child = command.spawn().map_err(|_| failed())?;
        let stdin = child.stdin.take().ok_or_else(failed)?;
        let stdout = BufReader::new(child.stdout.take().ok_or_else(failed)?);
        Ok(Self {
            child,
            stdin,
            stdout,
        })
    }
    async fn exchange(&mut self, input: &Value) -> Result<Value> {
        let mut encoded = serde_json::to_vec(input).map_err(|_| failed())?;
        encoded.push(b'\n');
        self.stdin.write_all(&encoded).await.map_err(|_| failed())?;
        self.stdin.flush().await.map_err(|_| failed())?;
        let mut line = Vec::new();
        (&mut self.stdout)
            .take(4 * 1024 * 1024 + 1)
            .read_until(b'\n', &mut line)
            .await
            .map_err(|_| failed())?;
        if line.len() > 4 * 1024 * 1024 || line.last() != Some(&b'\n') {
            return Err(failed());
        }
        let response: Value = serde_json::from_slice(&line).map_err(|_| failed())?;
        if response.get("ok") != Some(&Value::Bool(true)) {
            return Err(failed());
        }
        let data = response.get("data").ok_or_else(failed)?;
        if !data.get("regions").is_some_and(Value::is_array)
            || !data.get("engines").is_some_and(Value::is_object)
        {
            return Err(failed());
        }
        Ok(data.clone())
    }
}

#[tauri::command]
pub async fn ocr_image(
    request_id: String,
    image: String,
    mode: String,
    dpi: Option<f64>,
    app: tauri::AppHandle,
    state: State<'_, OcrService>,
) -> Result<Value> {
    validate_image(&image)?;
    if !matches!(mode.as_str(), "primary" | "secondary") {
        return Err(failed());
    }
    let dpi = dpi.unwrap_or(if mode == "primary" { 300.0 } else { 600.0 });
    if !dpi.is_finite() || dpi <= 0.0 || dpi > 600.00001 {
        return Err(failed());
    }
    let mut cancellation = state.receiver(&request_id)?;
    let mut guard = state.worker.lock().await;
    if *cancellation.borrow() {
        return Err(cancelled());
    }
    if guard.is_none() {
        *guard = Some(Worker::spawn(worker_path(&app)?)?);
    }
    let input = json!({"mode":mode,"image":image,"dpi":dpi});
    let result = tokio::select! {
        biased;
        _=cancellation.changed()=>Err(cancelled()),
        result=tokio::time::timeout(Duration::from_secs(180),guard.as_mut().unwrap().exchange(&input))=>result.unwrap_or_else(|_|Err(error("ocr_timeout","Локальный OCR превысил время обработки фрагмента. Повторите подготовку."))),
    };
    if result.is_err() {
        if let Some(mut old) = guard.take() {
            let _ = old.child.kill().await;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn image_limits_precede_worker_start() {
        assert!(validate_image("http://invalid/image.png").is_err());
        assert!(validate_image(&"x".repeat(6 * 1024 * 1024 + 1)).is_err());
        let mut png = vec![0u8; 33];
        png[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        png[12..16].copy_from_slice(b"IHDR");
        png[16..20].copy_from_slice(&2402u32.to_be_bytes());
        png[20..24].copy_from_slice(&1u32.to_be_bytes());
        assert!(
            validate_image(&format!("data:image/png;base64,{}", STANDARD.encode(png))).is_err()
        );
    }
    #[test]
    fn stale_and_cancelled_ids_cannot_use_worker() {
        let service = OcrService::default();
        let (sender, _) = watch::channel(false);
        *service.active.lock().unwrap() = Some(("run-1".into(), sender.clone()));
        assert!(service.receiver("run-2").is_err());
        assert!(service.receiver("run-1").is_ok());
        sender.send_replace(true);
        assert!(service.receiver("run-1").is_err());
    }
}
