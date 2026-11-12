import type { Connection } from "./types";

export type ConnSortKey = "proto" | "local" | "remote" | "state" | "pid" | "process";

/** Port of `1.2.3.4:80` or `[::1]:8080`; -1 when there isn't one. */
export function portOf(addr: string): number {
  const i = addr.lastIndexOf(":");
  const n = i >= 0 ? Number(addr.slice(i + 1)) : NaN;
  return Number.isFinite(n) ? n : -1;
}

/** Sockets that accept connections (TCP LISTEN, bound UDP). */
export function isListening(c: Connection): boolean {
  return c.state === "LISTEN" || c.state === "UNCONN";
}

export function filterConns(rows: Connection[], query: string, listenOnly: boolean): Connection[] {
  const q = query.trim().toLowerCase();
  return rows.filter((c) => {
    if (listenOnly && !isListening(c)) return false;
    if (!q) return true;
    return (
      c.proto.includes(q) ||
      c.local.toLowerCase().includes(q) ||
      c.remote.toLowerCase().includes(q) ||
      c.state.toLowerCase().includes(q) ||
      (c.process ?? "").toLowerCase().includes(q) ||
      (c.pid !== null && String(c.pid).includes(q))
    );
  });
}

function compare(a: Connection, b: Connection, key: ConnSortKey): number {
  switch (key) {
    case "local":
      return portOf(a.local) - portOf(b.local) || a.local.localeCompare(b.local);
    case "remote":
      return portOf(a.remote) - portOf(b.remote) || a.remote.localeCompare(b.remote);
    case "pid":
      return (a.pid ?? -1) - (b.pid ?? -1);
    case "process":
      return (a.process ?? "").localeCompare(b.process ?? "");
    default:
      return a[key].localeCompare(b[key]);
  }
}

/** Sorted copy. Ties fall back to protocol, local address and pid so the order is stable. */
export function sortConns(rows: Connection[], key: ConnSortKey, dir: 1 | -1): Connection[] {
  return [...rows].sort(
    (a, b) =>
      compare(a, b, key) * dir ||
      a.proto.localeCompare(b.proto) ||
      portOf(a.local) - portOf(b.local) ||
      (a.pid ?? -1) - (b.pid ?? -1)
  );
}
