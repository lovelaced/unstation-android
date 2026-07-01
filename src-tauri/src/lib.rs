//! Android Tauri shell for Unstation.
//!
//! The command/event layer is the shared [`unstation_app`] crate (also used by the desktop
//! shell); this file is just the mobile entry point + the Android `tauri.conf.json` context.
//! Publish is OFF for the watch build (M1–M3); the camera-publish `publish` feature is
//! enabled at M4 with a capture-based source.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    unstation_app::init_logging();
    unstation_app::builder()
        .run(tauri::generate_context!())
        .expect("error while running Unstation");
}
