fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "model_status",
            "save_api_key",
            "remove_api_key",
            "run_diagnostic",
            "cancel_diagnostic",
            "analyze_drawing",
            "save_analysis",
            "ocr_begin",
            "ocr_image",
            "ocr_cancel",
            "ocr_end",
        ]),
    ))
    .expect("failed to build desktop permissions");
}
