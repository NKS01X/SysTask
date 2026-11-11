import type { ColumnKey, ProcInfo, SortDir } from "./types";

export interface Row {
  p: ProcInfo;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

export interface BuildOpts {
  query: string;
  mineOnly: boolean;
  me: string;
  sortKey: ColumnKey;
  sortDir: SortDir;
  tree: boolean;
  collapsed: Set<number>;
}

function sorter(key: ColumnKey, dir: SortDir) {
  const d = dir === "asc" ? 1 : -1;
  return (a: ProcInfo, b: ProcInfo) => {
    const x = a[key] ?? -1;
    const y = b[key] ?? -1;
    const c =
      typeof x === "number" && typeof y === "number"
        ? x - y
        : String(x).localeCompare(String(y));
    return c !== 0 ? c * d : a.pid - b.pid;
  };
}

export function buildRows(procs: ProcInfo[], o: BuildOpts): Row[] {
  const q = o.query.trim().toLowerCase();
  const match = (p: ProcInfo) =>
    (!o.mineOnly || p.user === o.me) &&
    (!q ||
      p.name.toLowerCase().includes(q) ||
      p.user.toLowerCase().includes(q) ||
      p.cmd.toLowerCase().includes(q) ||
      String(p.pid).includes(q));
  const cmp = sorter(o.sortKey, o.sortDir);

  if (!o.tree) {
    return procs
      .filter(match)
      .sort(cmp)
      .map((p) => ({ p, depth: 0, hasChildren: false, expanded: false }));
  }

  const byPid = new Map<number, ProcInfo>(procs.map((p) => [p.pid, p]));
  const filtering = q !== "" || o.mineOnly;
  const keep = new Set<number>();
  if (!filtering) {
    procs.forEach((p) => keep.add(p.pid));
  } else {
    for (const p of procs) {
      if (!match(p)) continue;
      let cur: ProcInfo | undefined = p;
      while (cur && !keep.has(cur.pid)) {
        keep.add(cur.pid);
        cur = cur.ppid !== null ? byPid.get(cur.ppid) : undefined;
      }
    }
  }

  const kids = new Map<number, ProcInfo[]>();
  const roots: ProcInfo[] = [];
  for (const p of procs) {
    if (!keep.has(p.pid)) continue;
    if (p.ppid !== null && p.ppid !== p.pid && keep.has(p.ppid)) {
      const list = kids.get(p.ppid);
      if (list) list.push(p);
      else kids.set(p.ppid, [p]);
    } else {
      roots.push(p);
    }
  }

  const out: Row[] = [];
  const walk = (p: ProcInfo, depth: number) => {
    const c = kids.get(p.pid) ?? [];
    const expanded = filtering ? true : !o.collapsed.has(p.pid);
    out.push({ p, depth, hasChildren: c.length > 0, expanded });
    if (expanded) {
      c.sort(cmp);
      for (const k of c) walk(k, depth + 1);
    }
  };
  roots.sort(cmp);
  roots.forEach((r) => walk(r, 0));
  return out;
}
