use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::net::{Ipv4Addr, Ipv6Addr};

const MAX_FILES: usize = 300;

#[derive(Serialize, Clone, Debug)]
pub struct ThreadInfo {
    pub tid: u32,
    pub name: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct Port {
    pub proto: String,
    pub local: String,
    pub state: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct Details {
    pub pid: u32,
    pub exe: String,
    pub cwd: String,
    pub nice: Option<i32>,
    pub threads: Vec<ThreadInfo>,
    pub open_files: Vec<String>,
    pub open_files_total: usize,
    pub ports: Vec<Port>,
    pub affinity: Vec<u32>,
    /// True when /proc entries for this process could not be read.
    pub restricted: bool,
}

pub fn task_ids(pid: u32) -> Vec<u32> {
    fs::read_dir(format!("/proc/{pid}/task"))
        .map(|d| {
            d.filter_map(|e| e.ok())
                .filter_map(|e| e.file_name().to_string_lossy().parse::<u32>().ok())
                .collect()
        })
        .unwrap_or_default()
}

fn link(path: &str) -> String {
    fs::read_link(path)
        .map(|l| l.to_string_lossy().into_owned())
        .unwrap_or_default()
}

pub fn read_nice(pid: u32) -> Option<i32> {
    let s = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let rest = &s[s.rfind(')')? + 1..];
    // fields after the comm: state is index 0, nice (field 19) is index 16
    rest.split_whitespace().nth(16)?.parse().ok()
}

pub fn get_affinity(pid: u32) -> Vec<u32> {
    let mut out = Vec::new();
    unsafe {
        let mut set: libc::cpu_set_t = std::mem::zeroed();
        if libc::sched_getaffinity(
            pid as libc::pid_t,
            std::mem::size_of::<libc::cpu_set_t>(),
            &mut set,
        ) == 0
        {
            for i in 0..(libc::CPU_SETSIZE as usize) {
                if libc::CPU_ISSET(i, &set) {
                    out.push(i as u32);
                }
            }
        }
    }
    out
}

pub fn set_affinity(pid: u32, cpus: &[u32]) -> Result<(), String> {
    if cpus.is_empty() {
        return Err("select at least one CPU".into());
    }
    if cpus.iter().any(|&c| c as usize >= libc::CPU_SETSIZE as usize) {
        return Err("cpu index out of range".into());
    }
    let tids = task_ids(pid);
    if tids.is_empty() {
        return Err(format!("process {pid} not found"));
    }
    let mut first_err: Option<String> = None;
    for tid in tids {
        let rc = unsafe {
            let mut set: libc::cpu_set_t = std::mem::zeroed();
            libc::CPU_ZERO(&mut set);
            for &c in cpus {
                libc::CPU_SET(c as usize, &mut set);
            }
            libc::sched_setaffinity(
                tid as libc::pid_t,
                std::mem::size_of::<libc::cpu_set_t>(),
                &set,
            )
        };
        if rc != 0 && first_err.is_none() {
            first_err = Some(std::io::Error::last_os_error().to_string());
        }
    }
    match first_err {
        None => Ok(()),
        Some(e) => Err(format!("set affinity failed: {e}")),
    }
}

pub fn renice(pid: u32, nice: i32) -> Result<(), String> {
    if !(-20..=19).contains(&nice) {
        return Err("nice must be between -20 and 19".into());
    }
    let tids = task_ids(pid);
    if tids.is_empty() {
        return Err(format!("process {pid} not found"));
    }
    let mut first_err: Option<String> = None;
    for tid in tids {
        let rc = unsafe { libc::setpriority(libc::PRIO_PROCESS as _, tid as libc::id_t, nice) };
        if rc != 0 && first_err.is_none() {
            first_err = Some(std::io::Error::last_os_error().to_string());
        }
    }
    match first_err {
        None => Ok(()),
        Some(e) => Err(format!("renice failed: {e}")),
    }
}

pub fn get_details(pid: u32) -> Result<Details, String> {
    if !std::path::Path::new(&format!("/proc/{pid}")).exists() {
        return Err(format!("process {pid} not found"));
    }
    let exe = link(&format!("/proc/{pid}/exe"));
    let cwd = link(&format!("/proc/{pid}/cwd"));

    let mut threads: Vec<ThreadInfo> = task_ids(pid)
        .into_iter()
        .map(|tid| ThreadInfo {
            tid,
            name: fs::read_to_string(format!("/proc/{pid}/task/{tid}/comm"))
                .map(|s| s.trim().to_string())
                .unwrap_or_default(),
        })
        .collect();
    threads.sort_by_key(|t| t.tid);

    let mut open_files = Vec::new();
    let mut inodes: HashSet<u64> = HashSet::new();
    let mut total = 0usize;
    let mut restricted = false;
    match fs::read_dir(format!("/proc/{pid}/fd")) {
        Ok(dir) => {
            for e in dir.flatten() {
                let Ok(target) = fs::read_link(e.path()) else {
                    continue;
                };
                let t = target.to_string_lossy().into_owned();
                total += 1;
                if let Some(rest) = t.strip_prefix("socket:[") {
                    if let Ok(i) = rest.trim_end_matches(']').parse::<u64>() {
                        inodes.insert(i);
                    }
                }
                if open_files.len() < MAX_FILES {
                    open_files.push(t);
                }
            }
        }
        Err(_) => restricted = true,
    }

    let mut ports = Vec::new();
    if !inodes.is_empty() {
        for (file, v6) in [("tcp", false), ("tcp6", true), ("udp", false), ("udp6", true)] {
            ports.extend(parse_net(file, v6, &inodes));
        }
    }

    Ok(Details {
        pid,
        exe,
        cwd,
        nice: read_nice(pid),
        threads,
        open_files,
        open_files_total: total,
        ports,
        affinity: get_affinity(pid),
        restricted,
    })
}

fn parse_net(file: &str, v6: bool, inodes: &HashSet<u64>) -> Vec<Port> {
    let Ok(text) = fs::read_to_string(format!("/proc/net/{file}")) else {
        return vec![];
    };
    text.lines()
        .skip(1)
        .filter_map(|line| {
            let f: Vec<&str> = line.split_whitespace().collect();
            if f.len() < 10 {
                return None;
            }
            let inode: u64 = f[9].parse().ok()?;
            if !inodes.contains(&inode) {
                return None;
            }
            let local = fmt_addr(f[1], v6)?;
            let state = if file.starts_with("tcp") {
                tcp_state(f[3])
            } else {
                "-"
            };
            Some(Port {
                proto: file.to_string(),
                local,
                state: state.to_string(),
            })
        })
        .collect()
}

pub fn fmt_addr(s: &str, v6: bool) -> Option<String> {
    let (addr, port) = s.split_once(':')?;
    let port = u16::from_str_radix(port, 16).ok()?;
    if !addr.is_ascii() {
        return None;
    }
    if v6 {
        if addr.len() != 32 {
            return None;
        }
        let mut b = [0u8; 16];
        for i in 0..4 {
            let w = u32::from_str_radix(&addr[i * 8..i * 8 + 8], 16).ok()?;
            b[i * 4..i * 4 + 4].copy_from_slice(&w.to_le_bytes());
        }
        Some(format!("[{}]:{}", Ipv6Addr::from(b), port))
    } else {
        let w = u32::from_str_radix(addr, 16).ok()?;
        Some(format!("{}:{}", Ipv4Addr::from(w.to_le_bytes()), port))
    }
}

fn tcp_state(code: &str) -> &'static str {
    match code {
        "01" => "ESTABLISHED",
        "02" => "SYN_SENT",
        "03" => "SYN_RECV",
        "04" => "FIN_WAIT1",
        "05" => "FIN_WAIT2",
        "06" => "TIME_WAIT",
        "07" => "CLOSE",
        "08" => "CLOSE_WAIT",
        "09" => "LAST_ACK",
        "0A" => "LISTEN",
        "0B" => "CLOSING",
        _ => "?",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ipv4_addr() {
        assert_eq!(fmt_addr("0100007F:0050", false).unwrap(), "127.0.0.1:80");
    }

    #[test]
    fn parses_ipv6_loopback() {
        assert_eq!(
            fmt_addr("00000000000000000000000001000000:1F90", true).unwrap(),
            "[::1]:8080"
        );
    }

    #[test]
    fn details_for_self() {
        let d = get_details(std::process::id()).unwrap();
        assert!(!d.threads.is_empty());
        assert!(!d.affinity.is_empty());
        assert!(d.nice.is_some());
    }

    #[test]
    fn renice_rejects_out_of_range() {
        assert!(renice(std::process::id(), 99).is_err());
    }
}
