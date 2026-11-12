import type { ProcInfo } from "./types";

export interface CsvColumn {
  key: keyof ProcInfo;
  label: string;
}

/**
 * One CSV field. Process names and command lines are attacker-controlled, so a
 * text value that a spreadsheet would read as a formula gets a leading quote.
 * Numbers (including negative nice values) are left alone.
 */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(procs: ProcInfo[], columns: CsvColumn[]): string {
  const head = columns.map((c) => csvCell(c.label)).join(",");
  const lines = procs.map((p) => columns.map((c) => csvCell(p[c.key])).join(","));
  return [head, ...lines].join("\r\n") + "\r\n";
}
