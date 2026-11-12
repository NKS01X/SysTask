<div align="center">
  <img src="assets/logo.svg" width="96" alt="SysTask logo" />
  <h1>SysTask</h1>
  <p>htop-style process manager for Linux. Tauri (Rust) + React + TypeScript.</p>
</div>

## Features

| Feature | Status |
| --- | --- |
| Live process list (PID, name, user, CPU %, memory, state, command) | Done |
| Sort by any column, text search/filter | Done |
| System overview: CPU, per-core CPU, memory, swap, uptime, load average | Done |
| Send signals (TERM, KILL, INT, HUP, STOP, CONT) with confirmation | Done |
| Adjustable refresh rate (0.5s - 5s) | Done |
| Keyboard shortcuts: `/` search, `Delete` signal, `Shift+Delete` kill tree, `Esc` cancel | Done |
| Process tree view with collapse / expand | Done |
| Details panel: threads, open files, ports, cwd, exe | Done |
| Renice and CPU affinity | Done |
| Kill process tree | Done |
| CPU, memory, disk and network history graphs | Done |
| Disk and network I/O rates (from `/proc`) | Done |
| Column chooser, "my processes" filter, pause updates | Done |
| Virtualized table for large process lists | Done |
| Persisted settings: sort, columns, refresh, theme, alerts | Done |
| Elevated actions via `pkexec` (kill, renice, affinity) | Done |
| High CPU / memory alerts (in-app + `notify-send`), tray icon | Done |
| CI (clippy, tests, build) | Done |
| Packaged releases (`.deb`, AppImage) via tag-triggered workflow | Done |

## Stack

- Backend: Rust, Tauri v2, [`sysinfo`](https://crates.io/crates/sysinfo), `libc`
- Frontend: React 18, TypeScript, Vite

## Architecture

```
React UI  <--- "snapshot" event (every refresh) ---  Rust backend (sysinfo + /proc)
          --- invoke(commands) ------------------->
```

The backend refreshes system data on a background thread and emits a full snapshot (system stats, I/O rates, all processes) to the UI. The UI sends commands for actions. Settings are stored in the webview's `localStorage`.

### Commands and events

| Name | Kind | Purpose |
| --- | --- | --- |
| `get_snapshot` | command | Current snapshot, used for the first paint |
| `get_details(pid)` | command | Threads, open files, ports, cwd, exe, nice, affinity |
| `kill_process(pid, signal, tree, elevated)` | command | Signal a process or its whole tree |
| `renice(pid, nice, elevated)` | command | Change priority (-20..19) |
| `set_affinity(pid, cpus, elevated)` | command | Pin a process to CPUs |
| `set_refresh_rate(ms)` | command | Change the refresh interval (clamped to 500-10000 ms) |
| `notify(title, body)` | command | Desktop notification via `notify-send` |
| `snapshot` | event | Emitted every refresh with stats and processes |

## Prerequisites

- Rust (stable): https://rustup.rs
- Node.js 18+
- Linux system dependencies:

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

Optional runtime tools: `libnotify-bin` (`notify-send`) for desktop alerts, and polkit (`pkexec`) with an auth agent for elevated actions.

## Develop

```bash
npm install
npm run tauri dev
```

## Test

```bash
cd src-tauri && cargo test
```

## Build

```bash
npm run tauri build
```

Bundles (`.deb`, `.AppImage`) are written to `src-tauri/target/release/bundle/`.

## Release

Push a tag like `v0.1.0`. The release workflow builds the bundles and creates a draft GitHub release.

## Permissions

SysTask runs as your user. You can signal and renice your own processes. For other users' processes (including root), the app offers "Retry as root" and runs the action through `pkexec`, which prompts for authentication. Root-owned processes are elevated automatically.

## Icons

Generate the full icon set from the logo:

```bash
npm run tauri icon assets/logo.svg
```

## Project structure

```
assets/              Logo
src/                 React frontend (App.tsx, tree.ts, settings.ts, components/)
src-tauri/src/       Rust backend
  lib.rs             Commands, refresh loop, tray
  procs.rs           sysinfo wrapper, signals, tree kill
  details.rs         /proc details, renice, affinity
  sysio.rs           Disk and network counters
  elevated.rs        pkexec helpers
src-tauri/icons/     App icons
```

## License

MIT
