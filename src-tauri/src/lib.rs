#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            use tauri::Manager;
            app.manage(ai::AiService::new().map_err(|error| std::io::Error::other(error.message))?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ai::model_status,
            ai::save_api_key,
            ai::remove_api_key,
            ai::run_diagnostic,
            ai::cancel_diagnostic,
            ai::analyze_drawing,
            ai::save_analysis
        ])
        .run(tauri::generate_context!())
        .expect("could not start AI SKANER");
}
mod ai;
