use std::sync::{Arc, Mutex};
use tauri::menu::*;

mod commands;

#[cfg(target_os = "macos")]
mod capture;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize recording module and perform startup cleanup
    commands::recording::initialize_recording_module();

    // Initialize recording manager state
    let recording_manager = Arc::new(Mutex::new(commands::recording::RecordingManager::new()));

    // Initialize preview state
    let preview_state = Arc::new(Mutex::new(commands::preview::PreviewState::new()));

    // Initialize preview capture session
    let preview_capture_session =
        Arc::new(Mutex::new(commands::preview::PreviewCaptureSession::new()));

    tauri::Builder::default()
        .manage(recording_manager)
        .manage(preview_state)
        .manage(preview_capture_session)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::video_import::import_video,
            commands::metadata::extract_metadata,
            commands::export::export_timeline,
            commands::recording::check_permission,
            commands::recording::request_permission,
            commands::recording::get_recording_state,
            commands::recording::start_recording,
            commands::recording::stop_recording,
            commands::recording::pause_recording,
            commands::recording::resume_recording,
            commands::recording::validate_config,
            commands::recording::get_preset_config,
            commands::recording::list_quality_presets,
            commands::recording::get_supported_codecs,
            commands::recording::cleanup_orphaned_files,
            commands::recording::cleanup_temp_files,
            commands::recording::check_disk_space,
            commands::recording::get_disk_space_info,
            commands::recording::get_error_details,
            commands::recording::validate_device_availability,
            commands::recording::get_long_recording_config,
            commands::recording::validate_long_recording_config,
            commands::recording::save_webcam_recording,
            commands::recording::save_pip_metadata,
            commands::thumbnail::generate_thumbnail,
            commands::thumbnail::cleanup_old_thumbnails,
            commands::screen_sources::enumerate_sources,
            commands::screen_sources::enumerate_screens,
            commands::screen_sources::enumerate_windows,
            commands::camera_sources::enumerate_cameras,
            commands::camera_sources::get_default_camera,
            commands::preview::start_preview,
            commands::preview::stop_preview,
            commands::preview::update_preview_settings,
            commands::preview::get_preview_metrics,
            commands::preview::get_preview_settings,
            commands::preview::start_preview_for_source,
            commands::preview::stop_preview_for_source
        ])
        .setup(|app| {
            // Create the menu
            let menu = MenuBuilder::new(app)
                .items(&[
                    &SubmenuBuilder::new(app, "File")
                        .items(&[
                            &MenuItemBuilder::with_id("new", "New")
                                .accelerator("CmdOrCtrl+N")
                                .build(app)?,
                            &MenuItemBuilder::with_id("open", "Open...")
                                .accelerator("CmdOrCtrl+O")
                                .build(app)?,
                            &PredefinedMenuItem::separator(app)?,
                            &MenuItemBuilder::with_id("save", "Save")
                                .accelerator("CmdOrCtrl+S")
                                .build(app)?,
                            &MenuItemBuilder::with_id("save_as", "Save As...")
                                .accelerator("CmdOrCtrl+Shift+S")
                                .build(app)?,
                            &PredefinedMenuItem::separator(app)?,
                            &MenuItemBuilder::with_id("export", "Export Timeline...")
                                .accelerator("CmdOrCtrl+E")
                                .build(app)?,
                            &PredefinedMenuItem::separator(app)?,
                            &PredefinedMenuItem::close_window(app, None)?,
                        ])
                        .build()?,
                    &SubmenuBuilder::new(app, "Edit")
                        .items(&[
                            &PredefinedMenuItem::undo(app, None)?,
                            &PredefinedMenuItem::redo(app, None)?,
                            &PredefinedMenuItem::separator(app)?,
                            &PredefinedMenuItem::cut(app, None)?,
                            &PredefinedMenuItem::copy(app, None)?,
                            &PredefinedMenuItem::paste(app, None)?,
                            &PredefinedMenuItem::select_all(app, None)?,
                        ])
                        .build()?,
                    &SubmenuBuilder::new(app, "View")
                        .items(&[
                            &MenuItemBuilder::with_id("toggle_fullscreen", "Toggle Fullscreen")
                                .accelerator("CmdOrCtrl+F")
                                .build(app)?,
                            &PredefinedMenuItem::separator(app)?,
                            &MenuItemBuilder::with_id("zoom_in", "Zoom In")
                                .accelerator("CmdOrCtrl+Plus")
                                .build(app)?,
                            &MenuItemBuilder::with_id("zoom_out", "Zoom Out")
                                .accelerator("CmdOrCtrl+Minus")
                                .build(app)?,
                            &MenuItemBuilder::with_id("zoom_reset", "Reset Zoom")
                                .accelerator("CmdOrCtrl+0")
                                .build(app)?,
                        ])
                        .build()?,
                ])
                .build()?;

            // Set the menu for the app
            app.set_menu(menu)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
