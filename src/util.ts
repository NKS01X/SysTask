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

export function level(p: number): string {
  if (p >= 85) return "hot";
  if (p >= 60) return "warn";
  return "ok";
}

export function push(arr: number[], v: number): number[] {
  const n = [...arr, v];
  return n.length > HISTORY ? n.slice(n.length - HISTORY) : n;
}
