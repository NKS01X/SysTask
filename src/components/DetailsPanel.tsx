import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Graph from "./Graph";
import type { ActFn, Details, ProcInfo } from "../types";
import { fmtBytes } from "../util";

type Tab = "overview" | "threads" | "files" | "ports";

interface Props {
  proc: ProcInfo;
  cpuHistory: number[];
  cores: number;
  /** Auto-elevate actions (root-owned process while not running as root). */
  elevate: boolean;
  act: ActFn;
  onClose: () => void;
}

export default function DetailsPanel({ proc, cpuHistory, cores, elevate, act, onClose }: Props) {
  const [d, setD] = useState<Details | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [nice, setNice] = useState(0);
  const [cpus, setCpus] = useState<Set<number>>(new Set());
  const initFor = useRef<number | null>(null);

  useEffect(() => {
    let dead = false;
    initFor.current = null;
    setD(null);
    setErr(null);
    const load = () =>
      invoke<Details>("get_details", { pid: proc.pid })
        .then((x) => {
          if (!dead) {
            setD(x);
            setErr(null);
          }
        })
        .catch((e) => {
          if (!dead) setErr(String(e));
        });
    load();
    const id = setInterval(load, 2000);
    return () => {
      dead = true;
      clearInterval(id);
    };
  }, [proc.pid]);

  useEffect(() => {
    if (d && initFor.current !== d.pid) {
      initFor.current = d.pid;
      setNice(d.nice ?? 0);
      setCpus(new Set(d.affinity));
    }
  }, [d]);

  const toggleCpu = (i: number) => {
    const n = new Set(cpus);
    if (n.has(i)) n.delete(i);
    else n.add(i);
    setCpus(n);
  };

  const applyNice = () =>
    act(
      `Renice ${proc.name}`,
      (el) => invoke<string>("renice", { pid: proc.pid, nice, elevated: el }),
      elevate
    );

  const applyAffinity = () =>
    act(
      `Affinity ${proc.name}`,
      (el) =>
        invoke<string>("set_affinity", {
          pid: proc.pid,
          cpus: [...cpus].sort((a, b) => a - b),
          elevated: el,
        }),
      elevate
    );

  return (
    <aside className="details">
      <div className="details-head">
        <div>
          <strong>{proc.name}</strong>
          <span className="muted"> · PID {proc.pid}</span>
        </div>
        <button className="ghost" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="tabs">
        {(
          [
            ["overview", "Overview"],
            ["threads", `Threads${d ? ` (${d.threads.length})` : ""}`],
            ["files", `Files${d ? ` (${d.open_files_total})` : ""}`],
            ["ports", `Ports${d ? ` (${d.ports.length})` : ""}`],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button key={k} className={tab === k ? "tab active" : "tab"} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      <div className="details-body">
        {err && <p className="err">{err}</p>}
        {d?.restricted && (
          <p className="muted">Some details are hidden (permission denied).</p>
        )}

        {tab === "overview" && (
          <>
            <Graph
              label="CPU"
              value={`${proc.cpu.toFixed(1)}%`}
              series={[{ data: cpuHistory, color: "var(--accent)" }]}
              height={48}
            />
            <dl className="kv">
              <dt>User</dt>
              <dd>{proc.user}</dd>
              <dt>PPID</dt>
              <dd>{proc.ppid ?? "-"}</dd>
              <dt>State</dt>
              <dd>{proc.status}</dd>
              <dt>Memory</dt>
              <dd>{fmtBytes(proc.mem)}</dd>
              <dt>Threads</dt>
              <dd>{d ? d.threads.length : "…"}</dd>
              <dt>Nice</dt>
              <dd>{d?.nice ?? "-"}</dd>
              <dt>CWD</dt>
              <dd className="mono">{d?.cwd || "-"}</dd>
              <dt>Exe</dt>
              <dd className="mono">{d?.exe || "-"}</dd>
              <dt>Cmd</dt>
              <dd className="mono">{proc.cmd || proc.name}</dd>
            </dl>

            <h4>Priority (nice)</h4>
            <div className="row">
              <input
                type="range"
                min={-20}
                max={19}
                value={nice}
                onChange={(e) => setNice(Number(e.target.value))}
              />
              <span className="num">{nice}</span>
              <button onClick={applyNice} disabled={!d}>
                Apply
              </button>
            </div>

            <h4>CPU affinity</h4>
            <div className="affinity">
              {Array.from({ length: cores }, (_, i) => (
                <label key={i} className="check">
                  <input type="checkbox" checked={cpus.has(i)} onChange={() => toggleCpu(i)} />
                  {i}
                </label>
              ))}
            </div>
            <div className="row">
              <button className="ghost" onClick={() => setCpus(new Set(Array.from({ length: cores }, (_, i) => i)))}>
                All
              </button>
              <button onClick={applyAffinity} disabled={!d || cpus.size === 0}>
                Apply
              </button>
            </div>
            {elevate && (
              <p className="muted">Root-owned: changes will prompt for authentication (pkexec).</p>
            )}
          </>
        )}

        {tab === "threads" && (
          <ul className="list mono">
            {d?.threads.map((t) => (
              <li key={t.tid}>
                {t.tid} <span className="muted">{t.name}</span>
              </li>
            ))}
          </ul>
        )}

        {tab === "files" && (
          <>
            <ul className="list mono">
              {d?.open_files.map((f, i) => (
                <li key={i} title={f}>
                  {f}
                </li>
              ))}
            </ul>
            {d && d.open_files_total > d.open_files.length && (
              <p className="muted">
                Showing {d.open_files.length} of {d.open_files_total}.
              </p>
            )}
          </>
        )}

        {tab === "ports" && (
          <ul className="list mono">
            {d?.ports.map((p, i) => (
              <li key={i}>
                {p.proto} {p.local} <span className="muted">{p.state}</span>
              </li>
            ))}
            {d && d.ports.length === 0 && <li className="muted">No open ports.</li>}
          </ul>
        )}
      </div>
    </aside>
  );
}
