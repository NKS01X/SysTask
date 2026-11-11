use serde::Serialize;
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
}

#[derive(Serialize, Clone, Debug)]
pub struct Snapshot {
    pub stats: Stats,
    pub processes: Vec<ProcInfo>,
}

pub struct Monitor {
    sys: System,
    users: Users,
}

impl Monitor {
    pub fn new() -> Result<Self, String> {
        let mut m = Self {
            sys: System::new().map_err(|e| e.to_string())?,
            users: Users::new_with_refreshed_list().map_err(|e| e.to_string())?,
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
        };

        let processes = self
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

        Snapshot { stats, processes }
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
}

pub fn parse_signal(name: &str) -> Result<Signal, String> {
    let upper = name.trim().to_uppercase();
    match upper.trim_start_matches("SIG") {
        "TERM" => Ok(Signal::Term),
        "KILL" => Ok(Signal::Kill),
        "STOP" => Ok(Signal::Stop),
        "CONT" => Ok(Signal::Continue),
        "INT" => Ok(Signal::Interrupt),
        "HUP" => Ok(Signal::Hangup),
        _ => Err(format!("unknown signal: {name}")),
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
    }

    #[test]
    fn parse_signal_accepts_prefixed_and_lowercase() {
        assert!(parse_signal("SIGTERM").is_ok());
        assert!(parse_signal("kill").is_ok());
        assert!(parse_signal("bogus").is_err());
    }

    #[test]
    fn kill_rejects_pid_zero_and_unknown_signal() {
        let m = Monitor::new().unwrap();
        assert!(m.kill(0, "TERM").is_err());
        assert!(m.kill(std::process::id(), "NOPE").is_err());
    }

    #[test]
    fn kill_terminates_child() {
        let mut child = Command::new("sleep").arg("60").spawn().unwrap();
        let m = Monitor::new().unwrap();
        m.kill(child.id(), "TERM").unwrap();
        let status = child.wait().unwrap();
        assert_eq!(status.signal(), Some(15));
    }
}
