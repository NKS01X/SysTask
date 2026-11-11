use crate::sysio::IoTotals;
use serde::Serialize;
use std::collections::HashMap;
use std::time::Instant;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, Signal, System, Users};

#[derive(Serialize, Clone, Debug)]
pub struct ProcInfo {
    pub pid: u32,
    pub ppid: Option<u32>,
    pub name: String,
    pub user: String,
    /// Percent of one core; can exceed 100 for multi-threaded processes.
    pub cpu: f32,
    /// Resident memory in bytes.
    pub mem: u64,
    pub status: String,
    pub cmd: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct Stats {
    pub cpu_total: f32,
    pub cpu_cores: Vec<f32>,
    pub mem_total: u64,
    pub mem_used: u64,
    pub swap_total: u64,
    pub swap_used: u64,
    pub uptime: u64,
    pub load: [f64; 3],
    pub disk_read_bps: f64,
    pub disk_write_bps: f64,
    pub net_rx_bps: f64,
    pub net_tx_bps: f64,
}

#[derive(Serialize, Clone, Debug)]
pub struct Snapshot {
    pub stats: Stats,
    pub processes: Vec<ProcInfo>,
    /// User name this app runs as.
    pub me: String,
    pub is_root: bool,
}

pub struct Monitor {
    sys: System,
    users: Users,
    io_prev: IoTotals,
    io_at: Instant,
    /// disk read, disk write, net rx, net tx (bytes/sec)
    io_rates: [f64; 4],
}

impl Monitor {
    pub fn new() -> Result<Self, String> {
        let mut m = Self {
            sys: System::new().map_err(|e| e.to_string())?,
            users: Users::new_with_refreshed_list().map_err(|e| e.to_string())?,
            io_prev: IoTotals::read(),
            io_at: Instant::now(),
            io_rates: [0.0; 4],
        };
        m.refresh();
        Ok(m)
    }

    pub fn refresh(&mut self) {
        self.sys.refresh_cpu_usage();
        self.sys.refresh_memory();
        self.sys.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::everything(),
        );

        let now = Instant::now();
        let dt = now.duration_since(self.io_at).as_secs_f64();
        if dt >= 0.2 {
            let cur = IoTotals::read();
            let rate = |c: u64, p: u64| c.saturating_sub(p) as f64 / dt;
            self.io_rates = [
                rate(cur.disk_read, self.io_prev.disk_read),
                rate(cur.disk_write, self.io_prev.disk_write),
                rate(cur.net_rx, self.io_prev.net_rx),
                rate(cur.net_tx, self.io_prev.net_tx),
            ];
            self.io_prev = cur;
            self.io_at = now;
        }
    }

    pub fn snapshot(&self) -> Snapshot {
        let load = System::load_average()
            .map(|l| [l.one, l.five, l.fifteen])
            .unwrap_or([0.0; 3]);
        let stats = Stats {
            cpu_total: self.sys.global_cpu_usage(),
            cpu_cores: self.sys.cpus().iter().map(|c| c.usage()).collect(),
            mem_total: self.sys.total_memory(),
            mem_used: self.sys.used_memory(),
            swap_total: self.sys.total_swap(),
            swap_used: self.sys.used_swap(),
            uptime: System::uptime().unwrap_or(0),
            load,
            disk_read_bps: self.io_rates[0],
            disk_write_bps: self.io_rates[1],
            net_rx_bps: self.io_rates[2],
            net_tx_bps: self.io_rates[3],
        };

        let processes: Vec<ProcInfo> = self
            .sys
            .processes()
            .values()
            .map(|p| {
                let user = p
                    .user_id()
                    .map(|uid| {
                        self.users
                            .get_user_by_id(uid)
                            .map(|u| u.name().to_string())
                            .unwrap_or_else(|| uid.to_string())
                    })
                    .unwrap_or_default();
                let cmd = p
                    .cmd()
                    .iter()
                    .map(|s| s.to_string_lossy())
                    .collect::<Vec<_>>()
                    .join(" ");
                ProcInfo {
                    pid: p.pid().as_u32(),
                    ppid: p.parent().map(|pp| pp.as_u32()),
                    name: p.name().to_string_lossy().into_owned(),
                    user,
                    cpu: p.cpu_usage(),
                    mem: p.memory(),
                    status: p.status().to_string(),
                    cmd,
                }
            })
            .collect();

        let me_pid = std::process::id();
        let me = processes
            .iter()
            .find(|p| p.pid == me_pid)
            .map(|p| p.user.clone())
            .unwrap_or_default();
        let is_root = unsafe { libc::geteuid() } == 0;

        Snapshot {
            stats,
            processes,
            me,
            is_root,
        }
    }

    fn signal_one(&self, pid: u32, sig: Signal) -> bool {
        self.sys
            .process(Pid::from_u32(pid))
            .and_then(|p| p.kill_with(sig))
            .unwrap_or(false)
    }

    pub fn kill(&self, pid: u32, signal: &str) -> Result<(), String> {
        if pid == 0 {
            return Err("invalid pid".into());
        }
        let sig = parse_signal(signal)?;
        let proc = self
            .sys
            .process(Pid::from_u32(pid))
            .ok_or_else(|| format!("process {pid} not found"))?;
        match proc.kill_with(sig) {
            Some(true) => Ok(()),
            Some(false) => Err(format!(
                "could not send {signal} to {pid} (permission denied or process exited)"
            )),
            None => Err(format!("signal {signal} is not supported")),
        }
    }

    /// Root plus all descendants, children before parents.
    pub fn tree_pids(&self, root: u32) -> Vec<u32> {
        let mut kids: HashMap<u32, Vec<u32>> = HashMap::new();
        for p in self.sys.processes().values() {
            if let Some(pp) = p.parent() {
                kids.entry(pp.as_u32()).or_default().push(p.pid().as_u32());
            }
        }
        fn walk(pid: u32, kids: &HashMap<u32, Vec<u32>>, out: &mut Vec<u32>, depth: usize) {
            if depth > 512 {
                return;
            }
            if let Some(c) = kids.get(&pid) {
                for &k in c {
                    if k != pid {
                        walk(k, kids, out, depth + 1);
                    }
                }
            }
            out.push(pid);
        }
        let mut out = Vec::new();
        walk(root, &kids, &mut out, 0);
        out
    }

    pub fn kill_tree(&self, pid: u32, signal: &str) -> Result<usize, String> {
        if pid == 0 {
            return Err("invalid pid".into());
        }
        if pid == 1 {
            return Err("refusing to signal the whole init tree".into());
        }
        let sig = parse_signal(signal)?;
        if self.sys.process(Pid::from_u32(pid)).is_none() {
            return Err(format!("process {pid} not found"));
        }
        let pids = self.tree_pids(pid);
        let ok = pids.iter().filter(|&&p| self.signal_one(p, sig)).count();
        if ok == pids.len() {
            Ok(ok)
        } else if ok == 0 {
            Err(format!(
                "could not send {signal} to tree of {pid} (permission denied or process exited)"
            ))
        } else {
            Err(format!(
                "signalled {ok} of {} processes (permission denied for the rest)",
                pids.len()
            ))
        }
    }
}

pub fn canonical_signal(name: &str) -> Result<&'static str, String> {
    let upper = name.trim().to_uppercase();
    match upper.trim_start_matches("SIG") {
        "TERM" => Ok("TERM"),
        "KILL" => Ok("KILL"),
        "STOP" => Ok("STOP"),
        "CONT" => Ok("CONT"),
        "INT" => Ok("INT"),
        "HUP" => Ok("HUP"),
        _ => Err(format!("unknown signal: {name}")),
    }
}

pub fn parse_signal(name: &str) -> Result<Signal, String> {
    match canonical_signal(name)? {
        "TERM" => Ok(Signal::Term),
        "KILL" => Ok(Signal::Kill),
        "STOP" => Ok(Signal::Stop),
        "CONT" => Ok(Signal::Continue),
        "INT" => Ok(Signal::Interrupt),
        _ => Ok(Signal::Hangup),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::process::ExitStatusExt;
    use std::process::Command;

    #[test]
    fn snapshot_has_self_and_stats() {
        let m = Monitor::new().unwrap();
        let snap = m.snapshot();
        let me = std::process::id();
        assert!(snap.processes.iter().any(|p| p.pid == me));
        assert!(snap.stats.mem_total > 0);
        assert!(!snap.stats.cpu_cores.is_empty());
        assert!(!snap.me.is_empty());
    }

    #[test]
    fn parse_signal_accepts_prefixed_and_lowercase() {
        assert!(parse_signal("SIGTERM").is_ok());
        assert!(parse_signal("kill").is_ok());
        assert!(parse_signal("bogus").is_err());
        assert_eq!(canonical_signal("sigint").unwrap(), "INT");
    }

    #[test]
    fn kill_rejects_pid_zero_and_unknown_signal() {
        let m = Monitor::new().unwrap();
        assert!(m.kill(0, "TERM").is_err());
        assert!(m.kill(std::process::id(), "NOPE").is_err());
        assert!(m.kill_tree(1, "TERM").is_err());
    }

    #[test]
    fn kill_terminates_child() {
        let mut child = Command::new("sleep").arg("60").spawn().unwrap();
        let m = Monitor::new().unwrap();
        m.kill(child.id(), "TERM").unwrap();
        let status = child.wait().unwrap();
        assert_eq!(status.signal(), Some(15));
    }

    #[test]
    fn kill_tree_terminates_children() {
        let mut parent = Command::new("sh")
            .args(["-c", "sleep 60 & sleep 60 & wait"])
            .spawn()
            .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(300));
        let m = Monitor::new().unwrap();
        let pids = m.tree_pids(parent.id());
        assert!(pids.len() >= 3);
        assert_eq!(*pids.last().unwrap(), parent.id());
        m.kill_tree(parent.id(), "TERM").unwrap();
        let status = parent.wait().unwrap();
        assert_eq!(status.signal(), Some(15));
    }
}
