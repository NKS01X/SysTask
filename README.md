<div align="center">
  <img src="assets/logo.svg" width="96" alt="SysTask logo" />
  <h1>SysTask</h1>
  <p>htop-style process manager for Linux. Tauri (Rust) + React + TypeScript.</p>
</div>

> **Status:** in development. The current code is a todo-app scaffold; the process manager is being built on top of it. See [Roadmap](#roadmap).

## Features

| Feature | Status |
| --- | --- |
| Live process list (PID, name, user, CPU %, memory, state) | Planned |
| Sort by any column, text search/filter | Planned |
| System overview: total CPU, per-core CPU, memory, swap, uptime, load average | Planned |
| Kill / send signals (SIGTERM, SIGKILL, SIGSTOP, SIGCONT) | Planned |
| Process tree view (parent/child) | Planned |
| Adjustable refresh rate | Planned |
| Keyboard shortcuts (htop-like) | Planned |

## Stack

- Backend: Rust, Tauri v2, [`sysinfo`](https://crates.io/crates/sysinfo) for process and system data
- Frontend: React 18, TypeScript, Vite

## Architecture

```
React UI  <--- Tauri events (1s tick) ---  Rust backend (sysinfo)
          --- invoke(commands) ---------->
```

- The backend refreshes system data on an interval and emits snapshots to the UI.
- The UI sends commands for actions (kill, signal, change refresh rate).
- No database is required for core functionality.

### Planned commands

| Command | Purpose |
| --- | --- |
| `list_processes` | One-shot snapshot of all processes |
| `system_stats` | CPU (total/per-core), memory, swap, load, uptime |
| `kill_process(pid, signal)` | Send a signal to a process |
| `set_refresh_rate(ms)` | Change the polling interval |

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

## Build

```bash
npm run tauri build
```

Output bundles (`.deb`, `.AppImage`) are written to `src-tauri/target/release/bundle/`.

## Permissions

SysTask runs as your user. You can signal your own processes. Signaling processes owned by other users (including root) requires elevated privileges and will return a permission error otherwise.

## Icons

The bundled icon is a small placeholder. Generate the full set from the logo:

```bash
npm run tauri icon assets/logo.svg
```

## Project structure

```
assets/           Logo
src/              React frontend
src-tauri/src/    Rust backend (lib.rs = commands, db.rs = legacy todo storage)
src-tauri/icons/  App icons
```

## Roadmap

1. Add `sysinfo`; implement `list_processes` and `system_stats`.
2. Build process table UI with sorting and search.
3. Add CPU and memory meters.
4. Add kill/signal actions with confirmation and error handling.
5. Add tree view and per-core CPU graphs.
6. Remove legacy todo code (`db.rs`, SQLite dependency).
7. Tests, CI, `.deb` and AppImage releases.

## Contributing

Issues and pull requests are welcome. Run `npm run tauri dev` and make sure `cargo clippy` and `cargo test` pass in `src-tauri/` before opening a PR.

## License

MIT
