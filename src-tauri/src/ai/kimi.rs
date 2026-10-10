use super::analysis::{self, AnalysisInput, AnalysisReport};
use super::error::{AiError, AiResult};
use base64::{Engine, engine::general_purpose::STANDARD};
use reqwest::{Client, Response, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::time::{Duration, Instant};

pub const ENDPOINT: &str = "https://api.moonshot.ai/v1";
pub const MODEL: &str = "kimi-k3";
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;

#[derive(Debug, Copy, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticKind {
    Access,
    Text,
    Vision,
    Json,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticReport {
    pub kind: DiagnosticKind,
    pub message: &'static str,
    pub elapsed_ms: u64,
    pub total_tokens: Option<u64>,
}

pub struct KimiClient {
    http: Client,
    base_url: String,
}

impl KimiClient {
    pub async fn analyze(&self, input: &AnalysisInput, key: &str) -> AiResult<AnalysisReport> {
        let started = Instant::now();
        let response = self
            .http
            .post(format!("{}/chat/completions", self.base_url))
            .timeout(Duration::from_secs(240))
            .bearer_auth(key)
            .json(&analysis::request_body(input, MODEL))
            .send()
            .await
            .map_err(network_error)?;
        let value = read_response(response).await?;
        let data = analysis::parse_output(&value, input)?;
        Ok(AnalysisReport {
            data,
            elapsed_ms: started.elapsed().as_millis() as u64,
            total_tokens: value.pointer("/usage/total_tokens").and_then(Value::as_u64),
            model: MODEL,
        })
    }

    pub fn new() -> AiResult<Self> {
        Ok(Self {
            http: build_http_client(Duration::from_secs(90))?,
            base_url: ENDPOINT.into(),
        })
    }

    pub async fn diagnose(&self, kind: DiagnosticKind, key: &str) -> AiResult<DiagnosticReport> {
        let started = Instant::now();
        // The UI cannot choose URLs, headers or arbitrary request bodies.
        let request = if kind == DiagnosticKind::Access {
            self.http.get(format!("{}/models", self.base_url))
        } else {
            self.http
                .post(format!("{}/chat/completions", self.base_url))
                .json(&probe_body(kind))
        };
        let response = request
            .bearer_auth(key)
            .send()
            .await
            .map_err(network_error)?;
        let value = read_response(response).await?;
        let message = validate_response(kind, &value)?;
        Ok(DiagnosticReport {
            kind,
            message,
            elapsed_ms: started.elapsed().as_millis() as u64,
            total_tokens: value.pointer("/usage/total_tokens").and_then(Value::as_u64),
        })
    }
}

fn build_http_client(timeout: Duration) -> AiResult<Client> {
    Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .user_agent("AI-SKANER/0.3.0")
        .build()
        .map_err(|_| {
            AiError::new(
                "network_init",
                "Не удалось подготовить сетевое подключение.",
            )
        })
}

fn network_error(error: reqwest::Error) -> AiError {
    if error.is_timeout() {
        AiError::new(
            "timeout",
            "Kimi не ответил за отведённое время. Проверьте соединение или повторите позже.",
        )
    } else {
        AiError::new(
            "network",
            "Не удалось связаться с Kimi. Проверьте интернет и доступ к api.moonshot.ai.",
        )
    }
}

async fn read_response(mut response: Response) -> AiResult<Value> {
    let status = response.status();
    // Do not return provider error bodies: they may contain sensitive data.
    if !status.is_success() {
        return Err(status_error(status));
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_RESPONSE_BYTES as u64)
    {
        return Err(AiError::new(
            "response_too_large",
            "Ответ превысил допустимый размер проверки.",
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(network_error)? {
        if bytes.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err(AiError::new(
                "response_too_large",
                "Ответ превысил допустимый размер проверки.",
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| AiError::invalid_response())
}

fn status_error(status: StatusCode) -> AiError {
    match status.as_u16() {
        401 => AiError::new(
            "authentication",
            "Kimi не принял ключ. Проверьте ключ API в личном кабинете и замените его здесь.",
        ),
        402 => AiError::new("balance", "На счёте Kimi недостаточно средств для запроса."),
        403 => AiError::new(
            "access_denied",
            "Доступ запрещён. Проверьте доступ к Kimi K3, баланс и ограничения аккаунта.",
        ),
        404 => AiError::new(
            "model_unavailable",
            "Модель Kimi K3 недоступна по этому API. Проверьте доступ в личном кабинете.",
        ),
        429 => AiError::new(
            "rate_limit",
            "Достигнут лимит запросов или квота Kimi. Проверьте лимиты и баланс, затем повторите позже.",
        ),
        400 | 422 => AiError::new(
            "request_rejected",
            "Kimi не принял параметры проверки. Возможно, возможности API изменились.",
        ),
        500..=599 => AiError::new(
            "provider_unavailable",
            "Сервис Kimi временно недоступен. Повторите позже.",
        ),
        300..=399 => AiError::new(
            "redirect_rejected",
            "API предложил перенаправление. Запрос остановлен; ключ не отправлен на другой адрес.",
        ),
        _ => AiError::new(
            "http_error",
            "Kimi отклонил запрос. Проверьте состояние API и доступ к модели.",
        ),
    }
}

fn probe_body(kind: DiagnosticKind) -> Value {
    let content = if kind == DiagnosticKind::Vision {
        json!([
            {"type": "text", "text": "Count the blue squares in the image. Respond with the single digit only."},
            {"type": "image_url", "image_url": {"url": format!("data:image/png;base64,{}", STANDARD.encode(include_bytes!("../../assets/vision-probe.png")))}}
        ])
    } else {
        json!(if kind == DiagnosticKind::Json {
            "Return an object with exactly one field: status, whose value is ready."
        } else {
            "Reply with exactly KIMI_READY and nothing else."
        })
    };
    let mut body = json!({
        "model": MODEL,
        "messages": [{"role": "user", "content": content}],
        "reasoning_effort": "low",
        "max_tokens": 2048,
        "stream": false
    });
    if kind == DiagnosticKind::Json {
        body["response_format"] = json!({
            "type": "json_schema",
            "json_schema": {
                "name": "connection_probe", "strict": true,
                "schema": {
                    "type": "object",
                    "properties": {"status": {"type": "string", "enum": ["ready"]}},
                    "required": ["status"], "additionalProperties": false
                }
            }
        });
    }
    body
}

fn validate_response(kind: DiagnosticKind, value: &Value) -> AiResult<&'static str> {
    if kind == DiagnosticKind::Access {
        let models = value
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(AiError::invalid_response)?;
        return if models
            .iter()
            .any(|model| model.get("id").and_then(Value::as_str) == Some(MODEL))
        {
            Ok(
                "API доступен, Kimi K3 есть в списке моделей. Возможность генерации проверяется отдельно.",
            )
        } else {
            Err(AiError::new(
                "model_unavailable",
                "Ключ принят, но Kimi K3 не найден в списке моделей этого аккаунта.",
            ))
        };
    }
    if value
        .pointer("/choices/0/finish_reason")
        .and_then(Value::as_str)
        == Some("length")
    {
        return Err(AiError::new(
            "output_limit",
            "Модель исчерпала лимит тестового ответа. Проверка не завершена.",
        ));
    }
    let content = value
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .ok_or_else(AiError::invalid_response)?
        .trim();
    match kind {
        DiagnosticKind::Text if content == "KIMI_READY" => {
            Ok("Получен правильный текстовый ответ KIMI_READY.")
        }
        DiagnosticKind::Vision if content == "3" => {
            Ok("Модель правильно определила три квадрата на учебном изображении.")
        }
        DiagnosticKind::Json => {
            let output: Value = serde_json::from_str(content).map_err(|_| {
                AiError::new("invalid_json", "Ответ модели не является корректным JSON.")
            })?;
            if output == json!({"status": "ready"}) {
                Ok(
                    "Получен JSON, соответствующий тестовой схеме. Схема чертежа будет подключена отдельно.",
                )
            } else {
                Err(AiError::new(
                    "schema_mismatch",
                    "JSON получен, но не соответствует тестовой схеме.",
                ))
            }
        }
        _ => Err(AiError::new(
            "probe_mismatch",
            "Ответ получен, но не прошёл учебную проверку. Это не подтверждает нужную возможность модели.",
        )),
    }
}

#[cfg(test)]
mod tests;
