import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface ProcInfo {
  pid: number;
  ppid: number | null;
  name: string;
  user: string;
  cpu: number;
  mem: number;
  status: string;
  cmd: string;
}

interface Stats {
  cpu_total: number;
  cpu_cores: number[];
  mem_total: number;
  mem_used: number;
  swap_total: number;
  swap_used: number;
  uptime: number;
  load: [number, number, number];
}

interface Snapshot {
  stats: Stats;
  processes: ProcInfo[];
}

type SortKey = "pid" | "name" | "user" | "cpu" | "mem" | "status";
type SortDir = "asc" | "desc";

const SIGNALS = ["TERM", "KILL", "INT", "HUP", "STOP", "CONT"];
const RATES = [500, 1000, 2000, 5000];

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "pid", label: "PID", numeric: true },
  { key: "name", label: "Name" },
  { key: "user", label: "User" },
  { key: "cpu", label: "CPU %", numeric: true },
  { key: "mem", label: "Memory", numeric: true },
  { key: "status", label: "State" },
];

function fmtBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
}

function level(p: number): string {
  if (p >= 85) return "hot";
  if (p >= 60) return "warn";
  return "ok";
}

function Meter({
  label,
  percent,
  detail,
}: {
  label: string;
  percent: number;
  detail: string;
}) {
  const p = Math.max(0, Math.min(100, percent));
  return (
    <div className="meter">
      <div className="meter-head">
        <span>{label}</span>
        <span className="muted">{detail}</span>
      </div>
      <div className="bar">
        <div className={`fill ${level(p)}`} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

export default function App() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("cpu");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selected, setSelected] = useState<number | null>(null);
  const [signal, setSignal] = useState("TERM");
  const [confirming, setConfirming] = useState(false);
  const [rate, setRate] = useState(1000);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    invoke<Snapshot>("get_snapshot")
      .then(setSnap)
      .catch((e) => setError(String(e)));
    listen<Snapshot>("snapshot", (e) => setSnap(e.payload)).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    invoke("set_refresh_rate", { ms: rate }).catch((e) => setError(String(e)));
  }, [rate]);

  const rows = useMemo(() => {
    if (!snap) return [];
    const q = query.trim().toLowerCase();
    const filtered = q
      ? snap.processes.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.user.toLowerCase().includes(q) ||
            p.cmd.toLowerCase().includes(q) ||
            String(p.pid).includes(q)
        )
      : snap.processes.slice();
    const dir = sortDir === "asc" ? 1 : -1;
    filtered.sort((a, b) => {
      const x = a[sortKey];
      const y = b[sortKey];
      const c =
        typeof x === "number" && typeof y === "number"
          ? x - y
          : String(x).localeCompare(String(y));
      return c !== 0 ? c * dir : a.pid - b.pid;
    });
    return filtered;
  }, [snap, query, sortKey, sortDir]);

  const selectedProc = useMemo(
    () => snap?.processes.find((p) => p.pid === selected) ?? null,
    [snap, selected]
  );

  useEffect(() => {
    if (!selectedProc) setConfirming(false);
  }, [selectedProc]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLSelectElement;
      if (e.key === "Escape") {
        if (confirming) setConfirming(false);
        else if (typing) (document.activeElement as HTMLElement).blur();
        else setSelected(null);
      } else if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "Delete" && !typing && selectedProc) {
        setConfirming(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming, selectedProc]);

  const sortBy = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "name" || key === "user" || key === "status" ? "asc" : "desc");
    }
  };

  const sendSignal = async () => {
    if (!selectedProc) return;
    try {
      await invoke("kill_process", { pid: selectedProc.pid, signal });
      setError(null);
      setNotice(`Sent SIG${signal} to ${selectedProc.name} (${selectedProc.pid})`);
    } catch (e) {
      setNotice(null);
      setError(String(e));
    }
    setConfirming(false);
  };

  const s = snap?.stats;
  const memPct = s && s.mem_total > 0 ? (s.mem_used / s.mem_total) * 100 : 0;
  const swapPct = s && s.swap_total > 0 ? (s.swap_used / s.swap_total) * 100 : 0;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <img src="/logo.svg" alt="" width={28} height={28} />
          <h1>SysTask</h1>
        </div>
        {s && (
          <div className="sysinfo muted">
            <span>{snap?.processes.length ?? 0} processes</span>
            <span>up {fmtUptime(s.uptime)}</span>
            <span>load {s.load.map((l) => l.toFixed(2)).join(" ")}</span>
          </div>
        )}
      </header>

      {s && (
        <section className="meters">
          <Meter
            label="CPU"
            percent={s.cpu_total}
            detail={`${s.cpu_total.toFixed(1)}% · ${s.cpu_cores.length} cores`}
          />
          <Meter
            label="Memory"
            percent={memPct}
            detail={`${fmtBytes(s.mem_used)} / ${fmtBytes(s.mem_total)}`}
          />
          {s.swap_total > 0 && (
            <Meter
              label="Swap"
              percent={swapPct}
              detail={`${fmtBytes(s.swap_used)} / ${fmtBytes(s.swap_total)}`}
            />
          )}
          <div className="cores">
            {s.cpu_cores.map((c, i) => (
              <div className="core" key={i} title={`Core ${i}: ${c.toFixed(1)}%`}>
                <div className="core-bar">
                  <div
                    className={`fill ${level(c)}`}
                    style={{ height: `${Math.max(0, Math.min(100, c))}%` }}
                  />
                </div>
                <span className="muted">{i}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="toolbar">
        <input
          ref={searchRef}
          className="search"
          type="text"
          value={query}
          placeholder="Search name, user, PID, command   ( / )"
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="muted">
          Refresh
          <select value={rate} onChange={(e) => setRate(Number(e.target.value))}>
            {RATES.map((r) => (
              <option key={r} value={r}>
                {r / 1000}s
              </option>
            ))}
          </select>
        </label>
        <div className="spacer" />
        <select value={signal} onChange={(e) => setSignal(e.target.value)}>
          {SIGNALS.map((sg) => (
            <option key={sg} value={sg}>
              SIG{sg}
            </option>
          ))}
        </select>
        <button
          className="danger"
          disabled={!selectedProc}
          onClick={() => setConfirming(true)}
        >
          Send signal
        </button>
      </section>

      {confirming && selectedProc && (
        <section className="confirm">
          <span>
            Send SIG{signal} to <strong>{selectedProc.name}</strong> (PID{" "}
            {selectedProc.pid})?
          </span>
          <button className="danger" onClick={sendSignal}>
            Confirm
          </button>
          <button className="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </section>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className={c.numeric ? "num" : ""}
                  onClick={() => sortBy(c.key)}
                >
                  {c.label}
                  {sortKey === c.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                </th>
              ))}
              <th>Command</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr
                key={p.pid}
                className={p.pid === selected ? "selected" : ""}
                onClick={() => setSelected(p.pid === selected ? null : p.pid)}
              >
                <td className="num">{p.pid}</td>
                <td>{p.name}</td>
                <td>{p.user}</td>
                <td className={`num cpu ${level(Math.min(p.cpu, 100))}`}>
                  {p.cpu.toFixed(1)}
                </td>
                <td className="num">{fmtBytes(p.mem)}</td>
                <td>{p.status}</td>
                <td className="cmd muted" title={p.cmd}>
                  {p.cmd || p.name}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {snap && rows.length === 0 && <p className="empty muted">No matching processes.</p>}
      </div>

      <footer className="status">
        {error ? (
          <span className="err">{error}</span>
        ) : notice ? (
          <span>{notice}</span>
        ) : (
          <span className="muted">
            Click a row to select · Delete: send signal · /: search · Esc: cancel
          </span>
        )}
      </footer>
    </div>
  );
}
