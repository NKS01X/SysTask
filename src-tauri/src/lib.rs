mod db;

use std::sync::Mutex;
use tauri::{Manager, State};

pub struct AppState {
    db: Mutex<rusqlite::Connection>,
}

fn err(e: impl ToString) -> String {
    e.to_string()
}

#[tauri::command]
fn list_tasks(state: State<AppState>) -> Result<Vec<db::Task>, String> {
    db::list(&state.db.lock().map_err(err)?).map_err(err)
}

#[tauri::command]
fn add_task(state: State<AppState>, title: String) -> Result<db::Task, String> {
    db::add(&state.db.lock().map_err(err)?, &title).map_err(err)
}

#[tauri::command]
fn toggle_task(state: State<AppState>, id: i64) -> Result<(), String> {
    db::toggle(&state.db.lock().map_err(err)?, id).map_err(err)
}

#[tauri::command]
fn delete_task(state: State<AppState>, id: i64) -> Result<(), String> {
    db::delete(&state.db.lock().map_err(err)?, id).map_err(err)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = db::open(&dir.join("tasks.db"))?;
            app.manage(AppState {
                db: Mutex::new(conn),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_tasks,
            add_task,
            toggle_task,
            delete_task
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
