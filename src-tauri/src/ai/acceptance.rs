//! Explicitly opt-in, single paid run of the current no-OCR pipeline.
//! Never runs in normal cargo test. Existing results are never overwritten.
use super::{
    analysis::{self, AnalysisInput},
    kimi::KimiClient,
    vault::{SecretVault, WindowsVault},
};
use serde_json::Value;
use std::path::PathBuf;

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
    for variant in ["native_text_no_ocr"] {
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
            "{variant}: starting one paid request; identical model and generation parameters"
        );
        match client.analyze(&input, &key, |_| {}).await {
            Ok(report) => {
                std::fs::write(&result_path, serde_json::to_vec_pretty(&report).unwrap()).unwrap();
                eprintln!(
                    "{variant}: {} ms, {:?} tokens",
                    report.elapsed_ms, report.total_tokens
                );
            }
            Err(error) => {
                std::fs::write(error_path, serde_json::to_vec_pretty(&error).unwrap()).unwrap();
                eprintln!(
                    "{variant}: {} (saved; no automatic paid retry)",
                    error.code
                );
                failures += 1;
            }
        }
    }
    assert_eq!(
        failures, 0,
        "One or more comparison variants failed; errors were recorded without paid retries"
    );
}
