mod procs;

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Emitter, Manager, State};

const DEFAULT_REFRESH_MS: u64 = 1000;
const MIN_REFRESH_MS: u64 = 500;
const MAX_REFRESH_MS: u64 = 10_000;

pub struct AppState {
    monitor: Arc<Mutex<procs::Monitor>>,
    refresh_ms: Arc<AtomicU64>,
}

fn err(e: impl ToString) -> String {
    e.to_string()
}

#[tauri::command]
fn get_snapshot(state: State<AppState>) -> Result<procs::Snapshot, String> {
    Ok(state.monitor.lock().map_err(err)?.snapshot())
}

#[tauri::command]
fn kill_process(state: State<AppState>, pid: u32, signal: String) -> Result<(), String> {
    state.monitor.lock().map_err(err)?.kill(pid, &signal)
}

#[tauri::command]
fn set_refresh_rate(state: State<AppState>, ms: u64) -> Result<(), String> {
    let ms = ms.clamp(MIN_REFRESH_MS, MAX_REFRESH_MS);
    state.refresh_ms.store(ms, Ordering::Relaxed);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let monitor = Arc::new(Mutex::new(procs::Monitor::new()?));
            let refresh_ms = Arc::new(AtomicU64::new(DEFAULT_REFRESH_MS));

            let handle = app.handle().clone();
            let m = Arc::clone(&monitor);
            let ms = Arc::clone(&refresh_ms);
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_millis(ms.load(Ordering::Relaxed)));
                let snap = match m.lock() {
                    Ok(mut g) => {
                        g.refresh();
                        g.snapshot()
                    }
                    Err(_) => break,
                };
                let _ = handle.emit("snapshot", snap);
            });

            app.manage(AppState {
                monitor,
                refresh_ms,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            kill_process,
            set_refresh_rate
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
