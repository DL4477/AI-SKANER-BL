mod error;
mod kimi;
mod vault;

use error::{AiError, AiResult};
use kimi::{DiagnosticKind, DiagnosticReport, ENDPOINT, KimiClient, MODEL};
use serde::Serialize;
use std::sync::Mutex;
use tauri::State;
use tokio::sync::watch;
use vault::{SecretVault, WindowsVault, validate_secret};
use zeroize::Zeroizing;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInfo {
    provider: &'static str,
    model: &'static str,
    endpoint: &'static str,
    key_stored: bool,
}

impl ConnectionInfo {
    fn new(key_stored: bool) -> Self {
        Self {
            provider: "Kimi API",
            model: MODEL,
            endpoint: ENDPOINT,
            key_stored,
        }
    }
}

#[derive(Default)]
struct Operations {
    active: Option<(String, watch::Sender<bool>)>,
    cancelled_before_start: Option<String>,
}

pub struct AiService {
    vault: Box<dyn SecretVault>,
    client: KimiClient,
    operations: Mutex<Operations>,
}

impl AiService {
    async fn diagnose(&self, kind: DiagnosticKind, request_id: &str) -> AiResult<DiagnosticReport> {
        let (key, mut cancellation) = self.begin(request_id)?;
        let result = tokio::select! {
            biased;
            _ = cancellation.changed() => Err(AiError::cancelled()),
            result = self.client.diagnose(kind, &key) => result,
        };
        let mut operations = self.operations.lock().map_err(|_| AiError::busy())?;
        operations.active = None;
        result
    }

    pub fn new() -> AiResult<Self> {
        Ok(Self {
            vault: Box::new(WindowsVault),
            client: KimiClient::new()?,
            operations: Mutex::default(),
        })
    }

    fn status(&self) -> AiResult<ConnectionInfo> {
        let _operations = self.operations.lock().map_err(|_| AiError::busy())?;
        Ok(ConnectionInfo::new(self.vault.read()?.is_some()))
    }

    fn save_key(&self, api_key: String) -> AiResult<ConnectionInfo> {
        let key = Zeroizing::new(api_key);
        let key = key.trim();
        validate_secret(key)?;
        let operations = self.operations.lock().map_err(|_| AiError::busy())?;
        if operations.active.is_some() {
            return Err(AiError::busy());
        }
        self.vault.write(key)?;
        Ok(ConnectionInfo::new(true))
    }

    fn remove_key(&self) -> AiResult<ConnectionInfo> {
        let operations = self.operations.lock().map_err(|_| AiError::busy())?;
        if operations.active.is_some() {
            return Err(AiError::busy());
        }
        self.vault.delete()?;
        Ok(ConnectionInfo::new(false))
    }

    fn cancel(&self, request_id: &str) -> AiResult<()> {
        validate_request_id(request_id)?;
        let mut operations = self.operations.lock().map_err(|_| AiError::busy())?;
        if let Some((active_id, sender)) = &operations.active {
            if active_id == request_id {
                let _ = sender.send(true);
            }
        } else {
            operations.cancelled_before_start = Some(request_id.into());
        }
        Ok(())
    }

    fn begin(&self, request_id: &str) -> AiResult<(Zeroizing<String>, watch::Receiver<bool>)> {
        validate_request_id(request_id)?;
        let mut operations = self.operations.lock().map_err(|_| AiError::busy())?;
        if operations.active.is_some() {
            return Err(AiError::busy());
        }
        if operations.cancelled_before_start.take().as_deref() == Some(request_id) {
            return Err(AiError::cancelled());
        }
        let key = self
            .vault
            .read()?
            .ok_or_else(|| AiError::new("missing_key", "Сначала сохраните API-ключ Kimi."))?;
        let (sender, receiver) = watch::channel(false);
        operations.active = Some((request_id.into(), sender));
        Ok((key, receiver))
    }
}

fn validate_request_id(id: &str) -> AiResult<()> {
    if id.is_empty() || id.len() > 64 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err(AiError::new(
            "invalid_request",
            "Некорректный идентификатор проверки.",
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn model_status(state: State<'_, AiService>) -> AiResult<ConnectionInfo> {
    state.status()
}

#[tauri::command]
pub fn save_api_key(api_key: String, state: State<'_, AiService>) -> AiResult<ConnectionInfo> {
    state.save_key(api_key)
}

#[tauri::command]
pub fn remove_api_key(state: State<'_, AiService>) -> AiResult<ConnectionInfo> {
    state.remove_key()
}

#[tauri::command]
pub async fn run_diagnostic(
    kind: DiagnosticKind,
    request_id: String,
    state: State<'_, AiService>,
) -> AiResult<DiagnosticReport> {
    state.diagnose(kind, &request_id).await
}

#[tauri::command]
pub fn cancel_diagnostic(request_id: String, state: State<'_, AiService>) -> AiResult<()> {
    state.cancel(&request_id)
}

#[cfg(test)]
mod tests;
