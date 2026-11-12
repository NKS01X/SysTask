<div align="center">
  <img src="assets/logo.svg" width="112" alt="SysTask logo" />
  <h1>SysTask</h1>
  <p><strong>An htop-style process manager for the Linux desktop.</strong></p>
  <p>Live system stats, a sortable process tree, and safe signalling, built with Tauri (Rust) and React.</p>

  [![CI](https://github.com/NKS01X/SysTask/actions/workflows/ci.yml/badge.svg)](https://github.com/NKS01X/SysTask/actions/workflows/ci.yml)
  [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
  ![Platform: Linux](https://img.shields.io/badge/platform-Linux-informational)
</div>

---

## Contents

- [Features](#features)
- [Install](#install)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Permissions](#permissions)
- [Build from source](#build-from-source)
- [Architecture](#architecture)
- [Project structure](#project-structure)
- [Development](#development)
- [Releasing](#releasing)
- [Roadmap](#roadmap)
- [License](#license)

## Features

**Monitoring**

- Live process list: PID, name, user, CPU %, memory, state, command, with per-column visibility.
- System overview: total and per-core CPU, memory, swap, uptime and load average.
- CPU, memory, disk and network history graphs; disk and network I/O rates read from `/proc`.
- Process tree with collapse and expand, plus a details panel (threads, open files, ports, cwd, exe).
- Virtualized table that stays smooth with thousands of processes.

**Control**

- Send signals (`TERM`, `KILL`, `INT`, `HUP`, `STOP`, `CONT`) with a confirmation step.
- Kill a whole process tree, renice, and pin a process to specific CPUs.
- Elevated actions through `pkexec` when a process belongs to another user.

**Comfort**

- Search by name, user, PID or command; "my processes" filter; pause updates.
- Adjustable refresh rate (0.5 s to 5 s).
- High CPU and memory alerts, in the app and as desktop notifications, plus a tray icon.
- Dark, light or system theme. Sort, columns, refresh rate, theme and alert settings persist between runs.

## Install

Download a package from the [Releases](https://github.com/NKS01X/SysTask/releases) page.

**Debian / Ubuntu (`.deb`)**

```bash
sudo apt install ./SysTask_<version>_amd64.deb
```

**Any distribution (AppImage)**

```bash
chmod +x SysTask_<version>_amd64.AppImage
./SysTask_<version>_amd64.AppImage
```

Optional runtime tools: `libnotify-bin` (`notify-send`) for desktop alerts, and polkit (`pkexec`) with an authentication agent for elevated actions. The `.deb` recommends both.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `↑` `↓` | Move the selection |
| `PageUp` `PageDown` | Move the selection by 10 rows |
| `Home` `End` | Jump to the first or last row |
| `→` `←` | Expand or collapse the selected node (tree view) |
| `/` | Focus the search box |
| `Delete` | Send the chosen signal to the selected process |
| `Shift` + `Delete` | Signal the selected process and all its children |
| `Esc` | Cancel a confirmation, leave the search box, or clear the selection |

## Permissions

SysTask runs as your user. You can signal and renice your own processes. For processes owned by other users, including root, the app offers **Retry as root** and runs the action through `pkexec`, which prompts for authentication. Root-owned processes are elevated automatically. Signalling PID 1's whole tree is refused.

## Build from source

**Prerequisites**

- Rust (stable): <https://rustup.rs>
- Node.js 18 or newer
- Linux system libraries:

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev \
  libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

**Run in development**

```bash
npm install
npm run tauri dev
```

**Produce release bundles**

```bash
npm run tauri build
```

The `.deb` and AppImage are written to `src-tauri/target/release/bundle/`.

## Architecture

```
React UI  <---- "snapshot" event (every refresh) ----  Rust backend (sysinfo + /proc)
          ----- invoke(commands) ------------------->
```

The backend refreshes system data on a background thread and emits a full snapshot (system stats, I/O rates, every process) to the UI. The UI sends commands for actions. Settings are stored in the webview's `localStorage`.

### Commands and events

| Name | Kind | Purpose |
| --- | --- | --- |
| `get_snapshot` | command | Current snapshot, used for the first paint |
| `get_details(pid)` | command | Threads, open files, ports, cwd, exe, nice, affinity |
| `kill_process(pid, signal, tree, elevated)` | command | Signal a process or its whole tree |
| `renice(pid, nice, elevated)` | command | Change priority (-20 to 19) |
| `set_affinity(pid, cpus, elevated)` | command | Pin a process to CPUs |
| `set_refresh_rate(ms)` | command | Change the refresh interval (clamped to 500–10000 ms) |
| `notify(title, body)` | command | Desktop notification via `notify-send` |
| `list_connections` | command | System-wide sockets and their owning process (backend ready, no UI yet) |
| `list_filesystems` | command | Mounted filesystems (backend ready, no UI yet) |
| `set_close_to_tray(enabled)` | command | Hide to the tray on close (backend ready, no UI yet) |
| `snapshot` | event | Emitted every refresh with stats and processes |

## Project structure

```
assets/              Logo
src/                 React frontend
  App.tsx            Layout, shortcuts, alerts, actions
  components/        ProcTable, DetailsPanel, Graph, Popover
  tree.ts            Filtering, sorting and tree building
  settings.ts        Persisted settings
  nav.ts             Keyboard selection helpers
  App.css, polish.css  Styles
src-tauri/           Rust backend and bundling config
  src/lib.rs         Commands, refresh loop, tray
  src/procs.rs       sysinfo wrapper, signals, tree kill
  src/details.rs     /proc details, renice, affinity
  src/sysio.rs       Disk and network counters
  src/elevated.rs    pkexec helpers
  src/conns.rs       Socket listing
  src/fsinfo.rs      Filesystem listing
  icons/             App icons, generated from assets/logo.svg
tests/               Frontend unit tests
.github/workflows/   CI and release pipelines
```

## Development

```bash
npm test                    # frontend unit tests
cd src-tauri && cargo test  # backend tests
```

CI runs clippy, the tests and a build on every push and pull request.

To regenerate the icons after changing the logo:

```bash
npm run tauri icon assets/logo.svg
```

## Releasing

1. Set the same version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`.
2. Commit, then tag and push:

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

3. The **Release** workflow builds the `.deb` and AppImage and attaches them to a draft GitHub release. Review the draft and publish it.

## Roadmap

- Network connections and filesystems views (the backend commands already exist).
- Close-to-tray option in the settings.
- Export the process list to CSV.

## License

MIT. See [LICENSE](LICENSE).
