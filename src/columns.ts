import type { ColumnKey } from "./types";

export interface ColumnDef {
  key: ColumnKey;
  label: string;
  width: string;
  numeric?: boolean;
  locked?: boolean;
}

export const COLUMNS: ColumnDef[] = [
  { key: "name", label: "Name", width: "minmax(180px, 1.2fr)", locked: true },
  { key: "pid", label: "PID", width: "70px", numeric: true },
  { key: "ppid", label: "PPID", width: "70px", numeric: true },
  { key: "user", label: "User", width: "100px" },
  { key: "cpu", label: "CPU %", width: "72px", numeric: true },
  { key: "mem", label: "Memory", width: "90px", numeric: true },
  { key: "mem_pct", label: "Mem %", width: "70px", numeric: true },
  { key: "cpu_secs", label: "CPU time", width: "90px", numeric: true },
  { key: "threads", label: "Threads", width: "72px", numeric: true },
  { key: "nice", label: "Nice", width: "56px", numeric: true },
  { key: "io_read_bps", label: "Disk read", width: "96px", numeric: true },
  { key: "io_write_bps", label: "Disk write", width: "96px", numeric: true },
  { key: "status", label: "State", width: "90px" },
  { key: "cmd", label: "Command", width: "minmax(200px, 2fr)" },
];
