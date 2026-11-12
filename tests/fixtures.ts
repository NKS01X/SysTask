import type { ProcInfo } from "../src/types";

export function mk(pid: number, ppid: number | null, name: string, over: Partial<ProcInfo> = {}): ProcInfo {
  return {
    pid,
    ppid,
    name,
    user: "me",
    cpu: 0,
    mem: 0,
    status: "Sleeping",
    cmd: name,
    threads: 1,
    nice: 0,
    cpu_secs: 0,
    mem_pct: 0,
    io_read_bps: null,
    io_write_bps: null,
    ...over,
  };
}
