import { useEffect, useRef, useState } from "react";
import type { ColumnDef } from "../columns";
import type { Row } from "../tree";
import type { ColumnKey, SortDir } from "../types";
import { fmtBytes, level } from "../util";

const ROW_H = 26;
const OVERSCAN = 8;

interface Props {
  rows: Row[];
  columns: ColumnDef[];
  sortKey: ColumnKey;
  sortDir: SortDir;
  onSort: (k: ColumnKey) => void;
  selected: number | null;
  onSelect: (pid: number | null) => void;
  onToggle: (pid: number) => void;
  tree: boolean;
}

export default function ProcTable({
  rows,
  columns,
  sortKey,
  sortDir,
  onSort,
  selected,
  onSelect,
  onToggle,
  tree,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(600);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const start = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((top + height) / ROW_H) + OVERSCAN);
  const template = columns.map((c) => c.width).join(" ");

  const cell = (c: ColumnDef, r: Row) => {
    const p = r.p;
    switch (c.key) {
      case "name":
        return (
          <div className="cell name" key={c.key} style={{ paddingLeft: tree ? r.depth * 14 : 0 }}>
            {tree &&
              (r.hasChildren ? (
                <button
                  className="twisty"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggle(p.pid);
                  }}
                >
                  {r.expanded ? "▾" : "▸"}
                </button>
              ) : (
                <span className="twisty" />
              ))}
            <span title={p.name}>{p.name}</span>
          </div>
        );
      case "pid":
        return (
          <div className="cell num" key={c.key}>
            {p.pid}
          </div>
        );
      case "ppid":
        return (
          <div className="cell num" key={c.key}>
            {p.ppid ?? ""}
          </div>
        );
      case "user":
        return (
          <div className="cell" key={c.key}>
            {p.user}
          </div>
        );
      case "cpu":
        return (
          <div className={`cell num cpu ${level(Math.min(p.cpu, 100))}`} key={c.key}>
            {p.cpu.toFixed(1)}
          </div>
        );
      case "mem":
        return (
          <div className="cell num" key={c.key}>
            {fmtBytes(p.mem)}
          </div>
        );
      case "status":
        return (
          <div className="cell" key={c.key}>
            {p.status}
          </div>
        );
      case "cmd":
        return (
          <div className="cell cmd muted" key={c.key} title={p.cmd}>
            {p.cmd || p.name}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="vt" ref={scrollRef} onScroll={(e) => setTop(e.currentTarget.scrollTop)}>
      <div className="vt-head" style={{ gridTemplateColumns: template }}>
        {columns.map((c) => (
          <div
            key={c.key}
            className={`cell head ${c.numeric ? "num" : ""}`}
            onClick={() => onSort(c.key)}
          >
            {c.label}
            {sortKey === c.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
          </div>
        ))}
      </div>
      <div style={{ height: rows.length * ROW_H, position: "relative" }}>
        <div style={{ position: "absolute", top: start * ROW_H, left: 0, right: 0 }}>
          {rows.slice(start, end).map((r) => (
            <div
              key={r.p.pid}
              className={`vt-row${r.p.pid === selected ? " selected" : ""}`}
              style={{ gridTemplateColumns: template, height: ROW_H }}
              onClick={() => onSelect(r.p.pid === selected ? null : r.p.pid)}
            >
              {columns.map((c) => cell(c, r))}
            </div>
          ))}
        </div>
      </div>
      {rows.length === 0 && <p className="empty muted">No matching processes.</p>}
    </div>
  );
}
