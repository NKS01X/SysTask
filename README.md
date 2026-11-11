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
| Keyboard shortcuts: `/` search, `Delete` signal, `Esc` cancel | Done |
| Process tree view (parent/child) | Planned |
| CPU history graphs | Planned |
| Packaged releases (`.deb`, AppImage) and CI | Planned |

## Stack

- Backend: Rust, Tauri v2, [`sysinfo`](https://crates.io/crates/sysinfo)
- Frontend: React 18, TypeScript, Vite

## Architecture

```
React UI  <--- "snapshot" event (every refresh) ---  Rust backend (sysinfo)
          --- invoke(commands) ------------------->
```

The backend refreshes system data on a background thread and emits a full snapshot (system stats + all processes) to the UI. The UI sends commands for actions.

### Commands and events

| Name | Kind | Purpose |
| --- | --- | --- |
| `get_snapshot` | command | Current snapshot, used for the first paint |
| `kill_process(pid, signal)` | command | Send a signal to a process |
| `set_refresh_rate(ms)` | command | Change the refresh interval (clamped to 500-10000 ms) |
| `snapshot` | event | Emitted every refresh with stats and processes |

## Prerequisites

- Rust (stable): https://rustup.rs
- Node.js 18+
- Linux system dependencies:

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

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

## Permissions

SysTask runs as your user. You can signal your own processes. Signaling processes owned by other users (including root) requires elevated privileges and returns a permission error otherwise.

## Icons

The bundled `icons/icon.png` is a placeholder. Generate the full set from the logo:

```bash
npm run tauri icon assets/logo.svg
```

## Project structure

```
assets/           Logo
src/              React frontend (App.tsx, App.css)
src-tauri/src/    Rust backend (lib.rs = commands + refresh loop, procs.rs = sysinfo wrapper)
src-tauri/icons/  App icons
```

## Roadmap

1. Process tree view.
2. CPU history graphs.
3. CI (clippy, tests, build) and release bundles.

## License

MIT
