use super::error::{AiError, AiResult};
use serde::Serialize;
use serde_json::{Value, json};

// SSE carries repeated JSON envelopes and discarded reasoning, not just final JSON.
// This is a traffic counter; the entire stream is never buffered in memory.
const MAX_STREAM_BYTES: usize = 32 * 1024 * 1024;
const MAX_EVENT_BYTES: usize = 256 * 1024;
const MAX_CONTENT_BYTES: usize = 1024 * 1024;

#[cfg(test)]
pub(super) fn limits() -> Value {
    json!({"wire_bytes":MAX_STREAM_BYTES,"event_bytes":MAX_EVENT_BYTES,"content_bytes":MAX_CONTENT_BYTES})
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AnalysisPhase {
    Connecting,
    Waiting,
    Thinking,
    Receiving,
    Validating,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisProgress {
    pub phase: AnalysisPhase,
    pub content_bytes: usize,
}

// Keep only the final JSON text. Reasoning and provider errors never reach the UI/log.
pub struct StreamDecoder {
    pending: Vec<u8>,
    event: String,
    received: usize,
    content: String,
    finish_reason: Option<String>,
    usage: Value,
    pub done: bool,
    pub phase: AnalysisPhase,
}

impl Default for StreamDecoder {
    fn default() -> Self {
        Self {
            pending: Vec::new(),
            event: String::new(),
            received: 0,
            content: String::new(),
            finish_reason: None,
            usage: Value::Null,
            done: false,
            phase: AnalysisPhase::Waiting,
        }
    }
}

impl StreamDecoder {
    pub fn progress(&self) -> AnalysisProgress {
        AnalysisProgress {
            phase: self.phase,
            content_bytes: self.content.len(),
        }
    }

    pub fn push(&mut self, bytes: &[u8]) -> AiResult<()> {
        self.received += bytes.len();
        if self.received > MAX_STREAM_BYTES {
            return Err(AiError::new(
                "stream_size_limit",
                "Поток Kimi превысил 32 МиБ с учётом служебных данных. Неполный результат не принят.",
            ));
        }
        self.pending.extend_from_slice(bytes);
        while let Some(end) = self.pending.iter().position(|b| *b == b'\n') {
            let line = self.pending.drain(..=end).collect::<Vec<_>>();
            let line = std::str::from_utf8(&line[..line.len() - 1])
                .map_err(|_| AiError::invalid_response())?
                .trim_end_matches('\r');
            if line.is_empty() {
                self.dispatch()?;
                if self.done {
                    self.pending.clear();
                    break;
                }
            } else if let Some(data) = line.strip_prefix("data:") {
                self.event.push_str(data.strip_prefix(' ').unwrap_or(data));
                self.event.push('\n');
            }
            if self.event.len() > MAX_EVENT_BYTES {
                return Err(event_too_large());
            }
        }
        if self.pending.len() + self.event.len() > MAX_EVENT_BYTES {
            return Err(event_too_large());
        }
        Ok(())
    }

    fn dispatch(&mut self) -> AiResult<()> {
        let event = std::mem::take(&mut self.event);
        let event = event.trim();
        if event.is_empty() {
            return Ok(());
        }
        if event == "[DONE]" {
            self.done = true;
            return Ok(());
        }
        let value: Value = serde_json::from_str(event).map_err(|_| AiError::invalid_response())?;
        if value.get("error").is_some() {
            return Err(AiError::new(
                "stream_error",
                "Kimi прервал генерацию ответа. Неполный результат не принят.",
            ));
        }
        if let Some(usage) = value.get("usage").filter(|u| u.is_object()) {
            self.usage = usage.clone();
        }
        let choices = value["choices"]
            .as_array()
            .ok_or_else(AiError::invalid_response)?;
        for choice in choices {
            if choice["index"].as_u64() != Some(0) {
                return Err(AiError::invalid_response());
            }
            if let Some(usage) = choice.get("usage").filter(|u| u.is_object()) {
                self.usage = usage.clone();
            }
            if let Some(reason) = choice["finish_reason"].as_str() {
                self.finish_reason = Some(reason.into());
            }
            if choice["delta"]["tool_calls"]
                .as_array()
                .is_some_and(|a| !a.is_empty())
            {
                return Err(AiError::invalid_response());
            }
            if choice["delta"]["reasoning_content"]
                .as_str()
                .is_some_and(|s| !s.is_empty())
                && self.content.is_empty()
            {
                self.phase = AnalysisPhase::Thinking;
            }
            if let Some(content) = choice["delta"]["content"]
                .as_str()
                .filter(|s| !s.is_empty())
            {
                if self.content.len() + content.len() > MAX_CONTENT_BYTES {
                    return Err(AiError::new(
                        "analysis_content_limit",
                        "Итоговый JSON превысил 1 МиБ. Неполный результат не принят.",
                    ));
                }
                self.content.push_str(content);
                self.phase = AnalysisPhase::Receiving;
            }
        }
        Ok(())
    }

    pub fn finish(self) -> AiResult<Value> {
        if !self.done || self.finish_reason.is_none() {
            return Err(AiError::new(
                "stream_incomplete",
                "Соединение оборвалось до завершения ответа Kimi. Неполный JSON не принят.",
            ));
        }
        Ok(
            json!({"choices":[{"finish_reason":self.finish_reason,"message":{"content":self.content}}],"usage":self.usage}),
        )
    }

    #[cfg(test)]
    pub fn statistics(&self) -> Value {
        json!({"wire_bytes":self.received,"buffered_event_bytes":self.pending.len()+self.event.len(),"content_bytes":self.content.len(),"phase":self.phase})
    }
}

fn event_too_large() -> AiError {
    AiError::new(
        "stream_event_limit",
        "Одна запись потока Kimi превысила 256 КиБ. Неполный результат не принят.",
    )
}

#[cfg(test)]
mod tests;
