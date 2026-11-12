export interface ProcInfo {
  pid: number;
  ppid: number | null;
  name: string;
  user: string;
  cpu: number;
  mem: number;
  status: string;
  cmd: string;
  threads: number;
  nice: number | null;
  /** Accumulated CPU time in seconds. */
  cpu_secs: number;
  mem_pct: number;
  /** Bytes/sec; null when unreadable (other users' processes) or not yet sampled. */
  io_read_bps: number | null;
  io_write_bps: number | null;
}

export interface Stats {
  cpu_total: number;
  cpu_cores: number[];
  mem_total: number;
  mem_used: number;
  swap_total: number;
  swap_used: number;
  uptime: number;
  load: [number, number, number];
  disk_read_bps: number;
  disk_write_bps: number;
  net_rx_bps: number;
  net_tx_bps: number;
}

export interface Snapshot {
  stats: Stats;
  processes: ProcInfo[];
  me: string;
  is_root: boolean;
}

export interface ThreadInfo {
  tid: number;
  name: string;
}

export interface Port {
  proto: string;
  local: string;
  state: string;
}

export interface Details {
  pid: number;
  exe: string;
  cwd: string;
  nice: number | null;
  threads: ThreadInfo[];
  open_files: string[];
  open_files_total: number;
  ports: Port[];
  affinity: number[];
  restricted: boolean;
}

/** A socket from the system-wide Ports view. `pid`/`process` are null when the owner isn't visible. */
export interface Connection {
  proto: string;
  local: string;
  remote: string;
  state: string;
  pid: number | null;
  process: string | null;
}

export interface Filesystem {
  device: string;
  mount: string;
  fstype: string;
  total: number;
  used: number;
  avail: number;
}

export type ColumnKey =
  | "name"
  | "pid"
  | "ppid"
  | "user"
  | "cpu"
  | "mem"
  | "mem_pct"
  | "cpu_secs"
  | "threads"
  | "nice"
  | "io_read_bps"
  | "io_write_bps"
  | "status"
  | "cmd";
export type SortDir = "asc" | "desc";
export type Theme = "system" | "dark" | "light";

/** Runs an action; on a permission error the UI offers a pkexec retry. */
export type ActFn = (
  label: string,
  fn: (elevated: boolean) => Promise<string | void>,
  preferElevated?: boolean
) => void;
