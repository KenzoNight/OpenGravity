#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ShellHealth {
    app_name: String,
    version: String,
    shell: String,
    backend: String,
    sidecar_mode: String,
    features: Vec<String>,
}

#[tauri::command]
fn shell_health() -> ShellHealth {
    ShellHealth {
        app_name: "OpenGravity".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        shell: "tauri-2".into(),
        backend: "rust-core".into(),
        sidecar_mode: "planned-cpp-sidecars".into(),
        features: vec![
            "Tauri window shell".into(),
            "Rust backend commands".into(),
            "Browser-safe orchestrator core".into(),
            "C++ sidecar boundary planned".into(),
            "Browser-safe preview fallback".into(),
        ],
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![shell_health])
        .run(tauri::generate_context!())
        .expect("failed to run OpenGravity desktop shell");
}
