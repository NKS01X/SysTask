import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Graph from "./components/Graph";
import Popover from "./components/Popover";
import ProcTable from "./components/ProcTable";
import DetailsPanel from "./components/DetailsPanel";
import { COLUMNS } from "./columns";
import { useSettings } from "./settings";
import { buildRows } from "./tree";
import { fmtBytes, fmtRate, fmtUptime, level, push } from "./util";
import type { ActFn, ColumnKey, Snapshot, Theme } from "./types";

const SIGNALS = ["TERM", "KILL", "INT", "HUP", "STOP", "CONT"];
const RATES = [500, 1000, 2000, 5000];

interface History {
  cpu: number[];
  mem: number[];
  dr: number[];
  dw: number[];
  rx: number[];
  tx: number[];
}

const EMPTY_HISTORY: History = { cpu: [], mem: [], dr: [], dw: [], rx: [], tx: [] };

interface AlertItem {
  id: number;
  title: string;
  body: string;
}

function Meter({ label, percent, detail }: { label: string; percent: number; detail: string }) {
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
  const [settings, update] = useSettings();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [hist, setHist] = useState<History>(EMPTY_HISTORY);
  const [procCpu, setProcCpu] = useState<number[]>([]);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retry, setRetry] = useState<{ label: string; run: () => void } | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [signal, setSignal] = useState("TERM");
  const [confirm, setConfirm] = useState<{ tree: boolean; asRoot: boolean } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [showDetails, setShowDetails] = useState(true);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);

  const searchRef = useRef<HTMLInputElement>(null);
  const pausedRef = useRef(false);
  const selectedRef = useRef<number | null>(null);
  const procHist = useRef<{ pid: number | null; data: number[] }>({ pid: null, data: [] });
  const track = useRef({
    cpu: { since: 0, fired: false },
    mem: { since: 0, fired: false },
  });

  const ingest = useCallback((s: Snapshot) => {
    if (pausedRef.current) return;
    setSnap(s);
    const st = s.stats;
    const memPct = st.mem_total > 0 ? (st.mem_used / st.mem_total) * 100 : 0;
    setHist((h) => ({
      cpu: push(h.cpu, st.cpu_total),
      mem: push(h.mem, memPct),
      dr: push(h.dr, st.disk_read_bps),
      dw: push(h.dw, st.disk_write_bps),
      rx: push(h.rx, st.net_rx_bps),
      tx: push(h.tx, st.net_tx_bps),
    }));
    const sel = selectedRef.current;
    if (sel !== procHist.current.pid) procHist.current = { pid: sel, data: [] };
    if (sel !== null) {
      const p = s.processes.find((x) => x.pid === sel);
      if (p) {
        procHist.current.data = push(procHist.current.data, p.cpu);
        setProcCpu(procHist.current.data);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    invoke<Snapshot>("get_snapshot")
      .then(ingest)
      .catch((e) => setError(String(e)));
    listen<Snapshot>("snapshot", (e) => ingest(e.payload)).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [ingest]);

  useEffect(() => {
    invoke("set_refresh_rate", { ms: settings.rate }).catch((e) => setError(String(e)));
  }, [settings.rate]);

  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", settings.theme);
  }, [settings.theme]);

  useEffect(() => {
    selectedRef.current = selected;
    procHist.current = { pid: selected, data: [] };
    setProcCpu([]);
  }, [selected]);

  const togglePause = () => {
    const next = !paused;
    pausedRef.current = next;
    setPaused(next);
    if (!next) {
      invoke<Snapshot>("get_snapshot")
        .then(ingest)
        .catch((e) => setError(String(e)));
    }
  };

  const rows = useMemo(() => {
    if (!snap) return [];
    return buildRows(snap.processes, {
      query,
      mineOnly: settings.mineOnly,
      me: snap.me,
      sortKey: settings.sortKey,
      sortDir: settings.sortDir,
      tree: settings.tree,
      collapsed,
    });
  }, [snap, query, settings.mineOnly, settings.sortKey, settings.sortDir, settings.tree, collapsed]);

  const selectedProc = useMemo(
    () => snap?.processes.find((p) => p.pid === selected) ?? null,
    [snap, selected]
  );

  useEffect(() => {
    if (!selectedProc) setConfirm(null);
  }, [selectedProc]);

  const needsRoot = !!selectedProc && !!snap && selectedProc.user === "root" && !snap.is_root;

  const openConfirm = useCallback(
    (tree: boolean) => setConfirm({ tree, asRoot: needsRoot }),
    [needsRoot]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLSelectElement;
      if (e.key === "Escape") {
        if (confirm) setConfirm(null);
        else if (typing) (document.activeElement as HTMLElement).blur();
        else setSelected(null);
      } else if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "Delete" && !typing && selectedProc) {
        openConfirm(e.shiftKey);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm, selectedProc, openConfirm]);

  const act: ActFn = (label, fn, preferElevated = false) => {
    const exec = async (elevated: boolean) => {
      try {
        const msg = await fn(elevated);
        setError(null);
        setRetry(null);
        setNotice(msg || `${label}: done`);
      } catch (e) {
        const m = String(e);
        setNotice(null);
        setError(m);
        if (!elevated && /permission|not permitted|denied/i.test(m)) {
          setRetry({ label, run: () => void exec(true) });
        } else {
          setRetry(null);
        }
      }
    };
    void exec(preferElevated);
  };

  const sortBy = (key: ColumnKey) => {
    if (key === settings.sortKey) {
      update({ sortDir: settings.sortDir === "asc" ? "desc" : "asc" });
    } else {
      const numeric = COLUMNS.find((c) => c.key === key)?.numeric;
      update({ sortKey: key, sortDir: numeric ? "desc" : "asc" });
    }
  };

  const sendSignal = () => {
    if (!selectedProc || !confirm) return;
    const { tree, asRoot } = confirm;
    const pid = selectedProc.pid;
    act(
      `SIG${signal} ${selectedProc.name}`,
      (el) => invoke<string>("kill_process", { pid, signal, tree, elevated: el }),
      asRoot
    );
    setConfirm(null);
  };

  const collapseAll = () => {
    if (!snap) return;
    const s = new Set<number>();
    snap.processes.forEach((p) => {
      if (p.ppid !== null) s.add(p.ppid);
    });
    setCollapsed(s);
  };

  const toggleNode = (pid: number) =>
    setCollapsed((cur) => {
      const n = new Set(cur);
      if (n.has(pid)) n.delete(pid);
      else n.add(pid);
      return n;
    });

  // High CPU / memory alerts
  useEffect(() => {
    const a = settings.alerts;
    if (!snap || !a.enabled) return;
    const now = Date.now();
    const st = snap.stats;
    const memPct = st.mem_total > 0 ? (st.mem_used / st.mem_total) * 100 : 0;
    const fire = (title: string, body: string) => {
      setAlerts((prev) => [{ id: now, title, body }, ...prev].slice(0, 3));
      invoke("notify", { title, body }).catch(() => {});
    };
    const check = (key: "cpu" | "mem", value: number, limit: number, text: () => string) => {
      const t = track.current[key];
      if (value >= limit) {
        if (t.since === 0) t.since = now;
        if (!t.fired && now - t.since >= a.seconds * 1000) {
          t.fired = true;
          fire(key === "cpu" ? "High CPU usage" : "High memory usage", text());
        }
      } else if (value < limit - 5) {
        t.since = 0;
        t.fired = false;
      }
    };
    check("cpu", st.cpu_total, a.cpu, () => {
      const top = [...snap.processes].sort((x, y) => y.cpu - x.cpu)[0];
      return `CPU at ${st.cpu_total.toFixed(0)}%${top ? ` · top: ${top.name} (${top.cpu.toFixed(0)}%)` : ""}`;
    });
    check("mem", memPct, a.mem, () => {
      const top = [...snap.processes].sort((x, y) => y.mem - x.mem)[0];
      return `Memory at ${memPct.toFixed(0)}%${top ? ` · top: ${top.name} (${fmtBytes(top.mem)})` : ""}`;
    });
  }, [snap, settings.alerts]);

  const visibleCols = COLUMNS.filter((c) => c.locked || settings.columns.includes(c.key));
  const toggleColumn = (key: ColumnKey) => {
    const cols = settings.columns.includes(key)
      ? settings.columns.filter((k) => k !== key)
      : [...settings.columns, key];
    update({ columns: cols });
  };

  const s = snap?.stats;
  const memPct = s && s.mem_total > 0 ? (s.mem_used / s.mem_total) * 100 : 0;
  const swapPct = s && s.swap_total > 0 ? (s.swap_used / s.swap_total) * 100 : 0;
  const a = settings.alerts;
  const setAlert = (patch: Partial<typeof a>) => update({ alerts: { ...a, ...patch } });

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <img src="/logo.svg" alt="" width={28} height={28} />
          <h1>SysTask</h1>
          {snap?.is_root && <span className="badge">root</span>}
          {paused && <span className="badge warn">paused</span>}
        </div>
        {s && (
          <div className="sysinfo muted">
            <span>{snap?.processes.length ?? 0} processes</span>
            <span>up {fmtUptime(s.uptime)}</span>
            <span>load {s.load.map((l) => l.toFixed(2)).join(" ")}</span>
          </div>
        )}
      </header>

      {alerts.map((al) => (
        <div className="alert" key={al.id}>
          <span>
            <strong>{al.title}</strong> — {al.body}
          </span>
          <button className="ghost" onClick={() => setAlerts((p) => p.filter((x) => x.id !== al.id))}>
            Dismiss
          </button>
        </div>
      ))}

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

      {s && settings.showGraphs && (
        <section className="graphs">
          <Graph
            label="CPU history"
            value={`${s.cpu_total.toFixed(1)}%`}
            max={100}
            series={[{ data: hist.cpu, color: "var(--accent)" }]}
          />
          <Graph
            label="Memory history"
            value={`${memPct.toFixed(1)}%`}
            max={100}
            series={[{ data: hist.mem, color: "var(--ok)" }]}
          />
          <Graph
            label="Disk I/O"
            value={`R ${fmtRate(s.disk_read_bps)} · W ${fmtRate(s.disk_write_bps)}`}
            series={[
              { data: hist.dr, color: "var(--ok)" },
              { data: hist.dw, color: "var(--warn)" },
            ]}
          />
          <Graph
            label="Network"
            value={`↓ ${fmtRate(s.net_rx_bps)} · ↑ ${fmtRate(s.net_tx_bps)}`}
            series={[
              { data: hist.rx, color: "var(--accent)" },
              { data: hist.tx, color: "var(--hot)" },
            ]}
          />
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
        <label className="check">
          <input
            type="checkbox"
            checked={settings.mineOnly}
            onChange={(e) => update({ mineOnly: e.target.checked })}
          />
          My processes
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.tree}
            onChange={(e) => update({ tree: e.target.checked })}
          />
          Tree
        </label>
        {settings.tree && (
          <>
            <button className="ghost" onClick={() => setCollapsed(new Set())}>
              Expand all
            </button>
            <button className="ghost" onClick={collapseAll}>
              Collapse all
            </button>
          </>
        )}
        <button className={paused ? "warnbtn" : "ghost"} onClick={togglePause}>
          {paused ? "▶ Resume" : "⏸ Pause"}
        </button>
        <label className="muted">
          Refresh
          <select
            value={settings.rate}
            onChange={(e) => update({ rate: Number(e.target.value) })}
          >
            {RATES.map((r) => (
              <option key={r} value={r}>
                {r / 1000}s
              </option>
            ))}
          </select>
        </label>
        <Popover label="Columns">
          {COLUMNS.map((c) => (
            <label key={c.key} className="check block">
              <input
                type="checkbox"
                checked={c.locked || settings.columns.includes(c.key)}
                disabled={c.locked}
                onChange={() => toggleColumn(c.key)}
              />
              {c.label}
            </label>
          ))}
          <label className="check block">
            <input
              type="checkbox"
              checked={settings.showGraphs}
              onChange={(e) => update({ showGraphs: e.target.checked })}
            />
            Show graphs
          </label>
        </Popover>
        <Popover label="Alerts">
          <label className="check block">
            <input
              type="checkbox"
              checked={a.enabled}
              onChange={(e) => setAlert({ enabled: e.target.checked })}
            />
            Enable alerts
          </label>
          <label className="field">
            CPU ≥ %
            <input
              type="number"
              min={1}
              max={100}
              value={a.cpu}
              onChange={(e) => setAlert({ cpu: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            Memory ≥ %
            <input
              type="number"
              min={1}
              max={100}
              value={a.mem}
              onChange={(e) => setAlert({ mem: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            Sustained (s)
            <input
              type="number"
              min={0}
              max={600}
              value={a.seconds}
              onChange={(e) => setAlert({ seconds: Number(e.target.value) })}
            />
          </label>
        </Popover>
        <select
          value={settings.theme}
          onChange={(e) => update({ theme: e.target.value as Theme })}
          title="Theme"
        >
          <option value="system">Theme: system</option>
          <option value="dark">Theme: dark</option>
          <option value="light">Theme: light</option>
        </select>
        <div className="spacer" />
        <select value={signal} onChange={(e) => setSignal(e.target.value)}>
          {SIGNALS.map((sg) => (
            <option key={sg} value={sg}>
              SIG{sg}
            </option>
          ))}
        </select>
        <button className="danger" disabled={!selectedProc} onClick={() => openConfirm(false)}>
          Send signal
        </button>
        <button className="danger" disabled={!selectedProc} onClick={() => openConfirm(true)}>
          Kill tree
        </button>
        <button className="ghost" onClick={() => setShowDetails(!showDetails)}>
          {showDetails ? "Hide details" : "Details"}
        </button>
      </section>

      {confirm && selectedProc && (
        <section className="confirm">
          <span>
            Send SIG{signal} to <strong>{selectedProc.name}</strong> (PID {selectedProc.pid})
            {confirm.tree ? " and all its children" : ""}?
          </span>
          <label className="check">
            <input
              type="checkbox"
              checked={confirm.asRoot}
              onChange={(e) => setConfirm({ ...confirm, asRoot: e.target.checked })}
            />
            As root (pkexec)
          </label>
          <button className="danger" onClick={sendSignal}>
            Confirm
          </button>
          <button className="ghost" onClick={() => setConfirm(null)}>
            Cancel
          </button>
        </section>
      )}

      <div className="main">
        <div className="table-wrap">
          <ProcTable
            rows={rows}
            columns={visibleCols}
            sortKey={settings.sortKey}
            sortDir={settings.sortDir}
            onSort={sortBy}
            selected={selected}
            onSelect={setSelected}
            onToggle={toggleNode}
            tree={settings.tree}
          />
        </div>
        {selectedProc && showDetails && (
          <DetailsPanel
            proc={selectedProc}
            cpuHistory={procCpu}
            cores={s?.cpu_cores.length ?? 0}
            elevate={needsRoot}
            act={act}
            onClose={() => setSelected(null)}
          />
        )}
      </div>

      <footer className="status">
        {error ? (
          <span className="err">{error}</span>
        ) : notice ? (
          <span>{notice}</span>
        ) : (
          <span className="muted">
            Click a row to select · Delete: signal · Shift+Delete: kill tree · /: search · Esc: cancel
          </span>
        )}
        {retry && (
          <button className="danger small" onClick={retry.run}>
            Retry as root
          </button>
        )}
      </footer>
    </div>
  );
}
