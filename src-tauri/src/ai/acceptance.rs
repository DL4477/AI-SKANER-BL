//! Explicitly opt-in, single paid run of the current no-OCR pipeline.
//! Never runs in normal cargo test. Existing results are never overwritten.
use super::{
    analysis::{self, AnalysisInput},
    kimi::KimiClient,
    vault::{SecretVault, WindowsVault},
};
use serde_json::Value;
use std::path::PathBuf;

pub(super) fn capture_stream_failure(
    error: &super::error::AiError,
    statistics: Value,
    elapsed_ms: u128,
) {
    if let (Some(path), Ok(run)) = (
        std::env::var_os("KIMI_ACCEPTANCE_FILE"),
        std::env::var("KIMI_ACCEPTANCE_RUN"),
    ) {
        let path = PathBuf::from(path).with_extension(format!("v050_{run}.stream-error.json"));
        std::fs::write(
            path,
            serde_json::to_vec_pretty(
                &serde_json::json!({"error":error,"statistics":statistics,"elapsed_ms":elapsed_ms}),
            )
            .unwrap(),
        )
        .unwrap();
    }
}

// Test-only evidence, including schema failures. StreamDecoder has already discarded
// reasoning_content. Never write the key or request headers; never runs in production.
pub(super) fn capture_response(response: &Value) {
    let (Some(path), Ok(run)) = (
        std::env::var_os("KIMI_ACCEPTANCE_FILE"),
        std::env::var("KIMI_ACCEPTANCE_RUN"),
    ) else {
        return;
    };
    let path = PathBuf::from(path).with_extension(format!("v050_{run}.response.json"));
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .expect("Unique capture path");
    file.write_all(&serde_json::to_vec_pretty(response).unwrap())
        .unwrap();
}

#[tokio::test]
#[ignore = "Paid Kimi comparison using the saved key; requires KIMI_ACCEPTANCE_FILE"]
async fn compare_prepared_drawing_with_saved_key() {
    let path = PathBuf::from(
        std::env::var_os("KIMI_ACCEPTANCE_FILE").expect("Set one *.pdf.prepared.json fixture path"),
    );
    let prepared: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    let key = WindowsVault
        .read()
        .unwrap()
        .expect("Save a Kimi key in the app first");
    let client = KimiClient::new().unwrap();
    let mut failures = 0;
    // Keep measurements for different effort levels and token limits in separate files.
    for variant in [format!(
        "v050_{}_native_text_no_ocr_{}_{}",
        std::env::var("KIMI_ACCEPTANCE_RUN").expect("Set unique run label"),
        analysis::REASONING_EFFORT,
        analysis::MAX_COMPLETION_TOKENS
    )] {
        // Snapshot the exact prompt/schema/settings for every paid experiment (no key).
        let manifest_path = path.with_extension(format!("{variant}.manifest.json"));
        let result_path = path.with_extension(format!("{variant}.kimi.json"));
        let error_path = path.with_extension(format!("{variant}.error.json"));
        if error_path.exists() {
            eprintln!("{variant}: previous failed attempt retained; no paid retry");
            failures += 1;
            continue;
        }
        if result_path.exists() {
            eprintln!("{variant}: existing result retained");
            continue;
        }
        let run = std::env::var("KIMI_ACCEPTANCE_RUN").unwrap();
        if manifest_path.exists()
            || path
                .with_extension(format!("v050_{run}.response.json"))
                .exists()
        {
            eprintln!(
                "{variant}: previous request may have been sent; choose a new run label only for an explicitly authorized retry"
            );
            failures += 1;
            continue;
        }
        let mut preparation = prepared.clone();
        let pages = preparation
            .as_object_mut()
            .unwrap()
            .remove("pages")
            .unwrap();
        let name = std::env::var("KIMI_ACCEPTANCE_NAME")
            .unwrap_or_else(|_| path.file_name().unwrap().to_string_lossy().into_owned());
        let input: AnalysisInput = serde_json::from_value(serde_json::json!({
            "name":name,"kind":"pdf","pages":pages,"preparation":preparation
        }))
        .unwrap();
        analysis::validate_input(&input).unwrap();
        eprintln!(
            "{variant}: starting one paid request; reasoning_effort={}, max_completion_tokens={}",
            analysis::REASONING_EFFORT,
            analysis::MAX_COMPLETION_TOKENS
        );
        std::fs::write(
            manifest_path,
            serde_json::to_vec_pretty(&serde_json::json!({
                "app_version":env!("CARGO_PKG_VERSION"), "system_prompt":analysis::SYSTEM_PROMPT,
                "schema":analysis::schema(), "reasoning_effort":analysis::REASONING_EFFORT,
                "max_completion_tokens":analysis::MAX_COMPLETION_TOKENS,
                "stream_limits":super::stream::limits(),
                "source_name":input.name, "prepared_file":path
            }))
            .unwrap(),
        )
        .unwrap();
        let last_phase = std::sync::atomic::AtomicUsize::new(usize::MAX);
        match client
            .analyze(&input, &key, |p| {
                if last_phase.swap(p.phase as usize, std::sync::atomic::Ordering::Relaxed)
                    != p.phase as usize
                {
                    eprintln!("Phase {:?}, content {} bytes", p.phase, p.content_bytes);
                }
            })
            .await
        {
            Ok(report) => {
                std::fs::write(&result_path, serde_json::to_vec_pretty(&report).unwrap()).unwrap();
                eprintln!(
                    "{variant}: {} ms, {:?} tokens",
                    report.elapsed_ms, report.total_tokens
                );
            }
            Err(error) => {
                std::fs::write(error_path, serde_json::to_vec_pretty(&error).unwrap()).unwrap();
                eprintln!("{variant}: {} (saved; no automatic paid retry)", error.code);
                failures += 1;
            }
        }
    }
    assert_eq!(
        failures, 0,
        "One or more comparison variants failed; errors were recorded without paid retries"
    );
}
