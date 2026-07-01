// Desktop-dev entry (unused on Android, where the mobile_entry_point in lib.rs is called).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    unstation_android_lib::run();
}
