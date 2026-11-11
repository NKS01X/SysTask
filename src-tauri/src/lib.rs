mod details;
mod elevated;
mod procs;
mod sysio;

use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
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
async fn kill_process(
    state: State<'_, AppState>,
    pid: u32,
    signal: String,
    tree: bool,
    elevated: bool,
) -> Result<String, String> {
    let name = procs::canonical_signal(&signal)?;
    if elevated {
        let pids = {
            let m = state.monitor.lock().map_err(err)?;
            if tree {
                if pid == 1 {
                    return Err("refusing to signal the whole init tree".into());
                }
                m.tree_pids(pid)
            } else {
                vec![pid]
            }
        };
        elevated::kill(&pids, name)?;
        return Ok(format!("Sent SIG{name} to {} process(es) as root", pids.len()));
    }
    let m = state.monitor.lock().map_err(err)?;
    if tree {
        let n = m.kill_tree(pid, name)?;
        Ok(format!("Sent SIG{name} to {n} processes"))
    } else {
        m.kill(pid, name)?;
        Ok(format!("Sent SIG{name} to {pid}"))
    }
}

#[tauri::command]
async fn renice(pid: u32, nice: i32, elevated: bool) -> Result<String, String> {
    if elevated {
        elevated::renice(pid, nice)?;
        Ok(format!("Set nice {nice} on {pid} as root"))
    } else {
        details::renice(pid, nice)?;
        Ok(format!("Set nice {nice} on {pid}"))
    }
}

#[tauri::command]
async fn set_affinity(pid: u32, cpus: Vec<u32>, elevated: bool) -> Result<String, String> {
    if elevated {
        elevated::affinity(pid, &cpus)?;
    } else {
        details::set_affinity(pid, &cpus)?;
    }
    Ok(format!("Pinned {pid} to {} CPU(s)", cpus.len()))
}

#[tauri::command]
async fn get_details(pid: u32) -> Result<details::Details, String> {
    details::get_details(pid)
}

#[tauri::command]
fn set_refresh_rate(state: State<AppState>, ms: u64) -> Result<(), String> {
    let ms = ms.clamp(MIN_REFRESH_MS, MAX_REFRESH_MS);
    state.refresh_ms.store(ms, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
fn notify(title: String, body: String) {
    let _ = Command::new("notify-send")
        .args(["-a", "SysTask", &title, &body])
        .status();
}

fn toggle_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let visible = w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false);
        if visible {
            let _ = w.hide();
        } else {
            let _ = w.show();
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
    }
}

fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "Show / Hide", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &quit])?;
    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("SysTask")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => toggle_window(app),
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
                toggle_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let monitor = Arc::new(Mutex::new(procs::Monitor::new()?));
            let refresh_ms = Arc::new(AtomicU64::new(DEFAULT_REFRESH_MS));

            if let Err(e) = build_tray(app.handle()) {
                eprintln!("tray unavailable: {e}");
            }

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
                if let Some(tray) = handle.tray_by_id("main") {
                    let st = &snap.stats;
                    let mem = if st.mem_total > 0 {
                        st.mem_used as f64 * 100.0 / st.mem_total as f64
                    } else {
                        0.0
                    };
                    let label = format!("CPU {:.0}% | MEM {:.0}%", st.cpu_total, mem);
                    let _ = tray.set_tooltip(Some(label.clone()));
                    let _ = tray.set_title(Some(label));
                }
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
            renice,
            set_affinity,
            get_details,
            set_refresh_rate,
            notify
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
