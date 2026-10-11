use super::{
    analysis,
    error::{AiError, AiResult},
    kimi::MODEL,
};
use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemPromptInfo {
    pub text: &'static str,
    model: &'static str,
    reasoning_effort: &'static str,
    max_completion_tokens: u32,
    app_version: &'static str,
}

#[tauri::command]
pub fn get_system_prompt() -> SystemPromptInfo {
    // Read the same constant used in the outgoing analysis request.
    SystemPromptInfo {
        text: analysis::SYSTEM_PROMPT,
        model: MODEL,
        reasoning_effort: analysis::REASONING_EFFORT,
        max_completion_tokens: analysis::MAX_COMPLETION_TOKENS,
        app_version: env!("CARGO_PKG_VERSION"),
    }
}

#[tauri::command]
pub async fn open_system_prompt(app: AppHandle) -> AiResult<()> {
    let error = |_| {
        AiError::new(
            "prompt_window_failed",
            "Не удалось открыть системный промпт. Попробуйте ещё раз.",
        )
    };
    if let Some(window) = app.get_webview_window("system-prompt") {
        window.unminimize().map_err(error)?;
        window.show().map_err(error)?;
        return window.set_focus().map_err(error);
    }
    WebviewWindowBuilder::new(
        &app,
        "system-prompt",
        WebviewUrl::App("index.html?view=system-prompt".into()),
    )
    .title("Системный промпт — ИИ СКАНЕР")
    .inner_size(960.0, 780.0)
    .min_inner_size(640.0, 480.0)
    .center()
    .build()
    .map_err(error)?;
    Ok(())
}
