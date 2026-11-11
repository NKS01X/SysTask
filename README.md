# Linux Task Manager

Desktop task manager built with **Tauri (Rust)**, **React + TypeScript**, and **SQLite**.

## Stack

- Backend: Rust, Tauri v2, rusqlite (bundled SQLite)
- Frontend: React 18, TypeScript, Vite

## Prerequisites

- Rust (stable): https://rustup.rs
- Node.js 18+
- Linux system deps:

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

## Structure

```
src/              React frontend
src-tauri/src/    Rust backend (lib.rs = commands, db.rs = SQLite)
src-tauri/icons/  App icons (placeholder; run `npm run tauri icon <png>`)
```

The SQLite file `tasks.db` lives in the app data dir.

## License

MIT
