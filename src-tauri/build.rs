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
        ]),
    ))
    .expect("failed to build desktop permissions");
}
