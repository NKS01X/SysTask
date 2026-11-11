#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    linux_task_manager_lib::run()
}
