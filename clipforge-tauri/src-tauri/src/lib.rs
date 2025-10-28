use tauri::menu::*;

mod commands;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::video_import::import_video,
            commands::metadata::extract_metadata,
            commands::export::export_timeline
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