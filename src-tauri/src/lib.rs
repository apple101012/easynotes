use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

mod db;

#[derive(Clone)]
struct AppPaths {
    themes_dir: PathBuf,
    settings_path: PathBuf,
}

struct ShortcutStateStore {
    toggle_shortcut: Mutex<String>,
}

#[derive(Serialize)]
struct ThemeFile {
    name: String,
    json: String,
}

#[derive(Clone, Deserialize, Serialize)]
struct AppSettings {
    #[serde(default = "default_toggle_shortcut")]
    toggle_shortcut: String,
    #[serde(default = "default_previous_note_shortcut")]
    previous_note_shortcut: String,
    #[serde(default = "default_next_note_shortcut")]
    next_note_shortcut: String,
    #[serde(default = "default_mouse_note_buttons_enabled")]
    mouse_note_buttons_enabled: bool,
}

fn default_toggle_shortcut() -> String {
    "Alt+A".to_string()
}

fn default_previous_note_shortcut() -> String {
    "Ctrl+Shift+ArrowLeft".to_string()
}

fn default_next_note_shortcut() -> String {
    "Ctrl+Shift+ArrowRight".to_string()
}

fn default_mouse_note_buttons_enabled() -> bool {
    true
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            toggle_shortcut: default_toggle_shortcut(),
            previous_note_shortcut: default_previous_note_shortcut(),
            next_note_shortcut: default_next_note_shortcut(),
            mouse_note_buttons_enabled: default_mouse_note_buttons_enabled(),
        }
    }
}

fn load_settings(settings_path: &PathBuf) -> AppSettings {
    fs::read_to_string(settings_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<AppSettings>(&raw).ok())
        .unwrap_or_default()
}

fn save_settings(settings_path: &PathBuf, settings: &AppSettings) -> Result<(), String> {
    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(settings_path, json).map_err(|e| e.to_string())
}

fn migrate_legacy_data(app_data_dir: &PathBuf) {
    let Some(parent) = app_data_dir.parent() else {
        return;
    };
    let legacy_dir = parent.join("com.khurram.noted");
    if !legacy_dir.exists() {
        return;
    }

    for file_name in ["notes.db", "notes.db-shm", "notes.db-wal", "settings.json"] {
        let source = legacy_dir.join(file_name);
        let target = app_data_dir.join(file_name);
        if source.exists() && !target.exists() {
            let _ = fs::copy(source, target);
        }
    }

    // Do not migrate legacy theme files. EasyNotes ships original themes only.
}

fn toggle_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        match window.is_visible() {
            Ok(true) => {
                let _ = window.hide();
            }
            _ => {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
                let _ = window.set_always_on_top(true);
            }
        }
    }
}

fn safe_theme_filename(name: &str) -> String {
    let safe: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == ' ' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .to_string();

    let safe = if safe.is_empty() {
        "theme".to_string()
    } else {
        safe
    };
    format!("{}.json", safe)
}

#[tauri::command]
fn list_notes(state: tauri::State<'_, db::Database>) -> Result<Vec<db::Note>, String> {
    state.list_notes()
}

#[tauri::command]
fn create_note(state: tauri::State<'_, db::Database>) -> Result<db::Note, String> {
    state.create_note()
}

#[tauri::command]
fn save_note(
    id: i64,
    content: String,
    state: tauri::State<'_, db::Database>,
) -> Result<(), String> {
    state.save_note(id, &content)
}

#[tauri::command]
fn delete_note(id: i64, state: tauri::State<'_, db::Database>) -> Result<(), String> {
    state.delete_note(id)
}

#[tauri::command]
fn list_theme_files(paths: tauri::State<'_, AppPaths>) -> Result<Vec<ThemeFile>, String> {
    fs::create_dir_all(&paths.themes_dir).map_err(|e| e.to_string())?;

    let mut themes = Vec::new();
    for entry in fs::read_dir(&paths.themes_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }

        let json = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let name = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("theme")
            .to_string();
        themes.push(ThemeFile { name, json });
    }

    Ok(themes)
}

#[tauri::command]
fn save_theme_file(
    name: String,
    json: String,
    paths: tauri::State<'_, AppPaths>,
) -> Result<(), String> {
    // Validate that the payload is JSON before writing it to disk.
    serde_json::from_str::<serde_json::Value>(&json).map_err(|e| e.to_string())?;
    fs::create_dir_all(&paths.themes_dir).map_err(|e| e.to_string())?;

    let path = paths.themes_dir.join(safe_theme_filename(&name));
    fs::write(path, json).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_app_settings(paths: tauri::State<'_, AppPaths>) -> AppSettings {
    load_settings(&paths.settings_path)
}

#[tauri::command]
fn set_toggle_shortcut(
    app: tauri::AppHandle,
    shortcut: String,
    paths: tauri::State<'_, AppPaths>,
    store: tauri::State<'_, ShortcutStateStore>,
) -> Result<AppSettings, String> {
    let shortcut = shortcut.trim().to_string();
    if shortcut.is_empty() {
        return Err("Enter a shortcut such as Alt+A.".to_string());
    }

    let previous = store
        .toggle_shortcut
        .lock()
        .map_err(|_| "Shortcut state is unavailable.".to_string())?
        .clone();

    let manager = app.global_shortcut();
    if !previous.is_empty() {
        let _ = manager.unregister(previous.as_str());
    }

    if let Err(error) = manager.register(shortcut.as_str()) {
        let _ = manager.register(previous.as_str());
        return Err(format!("Could not register {shortcut}: {error}"));
    }

    {
        let mut current = store
            .toggle_shortcut
            .lock()
            .map_err(|_| "Shortcut state is unavailable.".to_string())?;
        *current = shortcut.clone();
    }

    let settings = AppSettings {
        toggle_shortcut: shortcut,
        previous_note_shortcut: load_settings(&paths.settings_path).previous_note_shortcut,
        next_note_shortcut: load_settings(&paths.settings_path).next_note_shortcut,
        mouse_note_buttons_enabled: load_settings(&paths.settings_path).mouse_note_buttons_enabled,
    };
    save_settings(&paths.settings_path, &settings)?;
    Ok(settings)
}

#[tauri::command]
fn set_mouse_note_buttons_enabled(
    enabled: bool,
    paths: tauri::State<'_, AppPaths>,
) -> Result<AppSettings, String> {
    let mut settings = load_settings(&paths.settings_path);
    settings.mouse_note_buttons_enabled = enabled;
    save_settings(&paths.settings_path, &settings)?;
    Ok(settings)
}

#[tauri::command]
fn set_note_shortcuts(
    previous_shortcut: String,
    next_shortcut: String,
    paths: tauri::State<'_, AppPaths>,
) -> Result<AppSettings, String> {
    let previous_shortcut = previous_shortcut.trim().to_string();
    let next_shortcut = next_shortcut.trim().to_string();
    if previous_shortcut.is_empty() || next_shortcut.is_empty() {
        return Err("Enter shortcuts for both previous and next note.".to_string());
    }
    if previous_shortcut == next_shortcut {
        return Err("Previous and next note shortcuts must be different.".to_string());
    }

    let mut settings = load_settings(&paths.settings_path);
    settings.previous_note_shortcut = previous_shortcut;
    settings.next_note_shortcut = next_shortcut;
    save_settings(&paths.settings_path, &settings)?;
    Ok(settings)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            // Tauri resolves this to the correct per-user writable location on each OS.
            // Tauri resolves this to the correct per-user writable location on each OS.
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to get app data dir");
            fs::create_dir_all(&app_data_dir).expect("failed to create app data dir");
            migrate_legacy_data(&app_data_dir);

            let themes_dir = app_data_dir.join("themes");
            fs::create_dir_all(&themes_dir).expect("failed to create themes dir");
            let settings_path = app_data_dir.join("settings.json");
            let settings = load_settings(&settings_path);

            let database = db::Database::new(app_data_dir).expect("failed to initialize database");
            app.manage(database);
            app.manage(AppPaths {
                themes_dir,
                settings_path,
            });
            app.manage(ShortcutStateStore {
                toggle_shortcut: Mutex::new(settings.toggle_shortcut.clone()),
            });

            let _ = app
                .get_webview_window("main")
                .map(|window| window.set_always_on_top(true));

            let show = MenuItemBuilder::with_id("show", "Show").build(app)?;
            let hide = MenuItemBuilder::with_id("hide", "Hide").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app)
                .items(&[&show, &hide, &quit])
                .build()?;
            let mut tray_builder = TrayIconBuilder::new()
                .tooltip("EasyNotes")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.set_always_on_top(true);
                        }
                    }
                    "hide" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_main_window(tray.app_handle());
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }
            tray_builder.build(app)?;

            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(|app, _shortcut, event| {
                        if event.state == ShortcutState::Pressed {
                            toggle_main_window(app);
                        }
                    })
                    .build(),
            )?;
            app.global_shortcut()
                .register(settings.toggle_shortcut.as_str())
                .map_err(|e| format!("failed to register shortcut: {e}"))?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_notes,
            create_note,
            save_note,
            delete_note,
            list_theme_files,
            save_theme_file,
            get_app_settings,
            set_toggle_shortcut,
            set_note_shortcuts,
            set_mouse_note_buttons_enabled
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
