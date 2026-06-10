mod client_modules;

use client_modules::{build_initialization_script, import_foundry_module, ClientModule};
use tauri::webview::{NewWindowResponse, WebviewWindowBuilder};
use tauri::{AppHandle, Manager, Url};

#[tauri::command]
async fn open_webview(
    app: AppHandle,
    url: String,
    id: String,
    title: String,
    incognito: bool,
    modules: Vec<ClientModule>,
) -> Result<(), String> {
    let parsed_url: Url = url.parse().map_err(|e| format!("Invalid URL: {}", e))?;
    let initialization_script = build_initialization_script(&parsed_url, &modules)?;

    // Sanitize ID to remove non-alphanumeric characters
    let sanitized_id: String = id.chars().filter(|c| c.is_alphanumeric()).collect();
    let mut new_id = format!("foundry{}", sanitized_id);

    // Check if a window with this label already exists
    if app.webview_windows().contains_key(&new_id) {
        let random_number = rand::random::<u32>() % 1000000;
        new_id = format!("foundry{}{}", sanitized_id, random_number);
    }

    WebviewWindowBuilder::new(&app, &new_id, tauri::WebviewUrl::External(parsed_url))
        .title(format!("Foundry VTT - {}", title))
        .incognito(incognito)
        .initialization_script(initialization_script)
        .inner_size(1280.0, 800.0)
        .focused(true)
        .center()
        .devtools(true)
        .disable_drag_drop_handler()
        .zoom_hotkeys_enabled(true)
        .maximizable(true)
        .resizable(true)
        .minimizable(true)
        .closable(true)
        .on_new_window(|_url, _features| {
            // Allow popup windows to open
            NewWindowResponse::Allow
        })
        .build()
        .map_err(|e| format!("Failed to create webview: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn open_foundry_devtools(app: AppHandle) -> Result<(), String> {
    let foundry_windows = app
        .webview_windows()
        .into_iter()
        .filter(|(label, _)| label.contains("foundry"))
        .map(|(_, window)| window)
        .collect::<Vec<_>>();

    if foundry_windows.is_empty() {
        return Err("No Foundry webview is open".to_string());
    }

    for window in &foundry_windows {
        if window.is_focused().unwrap_or(false) {
            window.open_devtools();
            return Ok(());
        }
    }

    for window in foundry_windows {
        window.open_devtools();
    }

    Ok(())
}

#[cfg(not(mobile))]
pub fn run() {
    #[cfg(target_os = "windows")]
    {
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--force-high-performance-gpu",
        )
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            import_foundry_module,
            open_webview,
            open_foundry_devtools
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
