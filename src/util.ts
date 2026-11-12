export const HISTORY = 120;

export function fmtBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function fmtRate(n: number): string {
  return `${fmtBytes(n)}/s`;
}

export function fmtUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
}

/** Accumulated CPU time, htop style: `m:ss.cc`, or `h:mm:ss` once past an hour. */
export function fmtCpuTime(secs: number): string {
  const s = Number.isFinite(secs) && secs > 0 ? secs : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(Math.floor(rest)).padStart(2, "0")}`;
  return `${m}:${rest.toFixed(2).padStart(5, "0")}`;
}

export function level(p: number): string {
  if (p >= 85) return "hot";
  if (p >= 60) return "warn";
  return "ok";
}

export function push(arr: number[], v: number): number[] {
  const n = [...arr, v];
  return n.length > HISTORY ? n.slice(n.length - HISTORY) : n;
}

/** `used / total` as a 0-100 percentage; 0 when total is 0. */
export function pct(used: number, total: number): number {
  const v = (used / total) * 100;
  return total > 0 && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
}
