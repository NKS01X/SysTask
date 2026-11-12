//! System-wide TCP/UDP sockets with the process that owns each one
//! (the data behind `ss -tulpn`).

use crate::details::fmt_addr;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;

/// Upper bound on rows sent to the UI (busy servers can have tens of thousands of sockets).
const MAX_ROWS: usize = 5000;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Connection {
    /// `tcp`, `tcp6`, `udp` or `udp6`.
    pub proto: String,
    pub local: String,
    pub remote: String,
    pub state: String,
    /// `None` when the owner can't be determined (another user's process without root).
    pub pid: Option<u32>,
    pub process: Option<String>,
}

pub fn state_name(proto: &str, code: &str) -> &'static str {
    if proto.starts_with("udp") {
        return match code {
            "01" => "ESTABLISHED",
            "07" => "UNCONN",
            _ => "-",
        };
    }
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

/// Parse one `/proc/net/{tcp,tcp6,udp,udp6}` table into rows plus each socket's inode.
pub fn parse_table(proto: &str, text: &str, v6: bool) -> Vec<(Connection, u64)> {
    text.lines()
        .skip(1)
        .filter_map(|line| {
            let f: Vec<&str> = line.split_whitespace().collect();
            if f.len() < 10 {
                return None;
            }
            let inode: u64 = f[9].parse().ok()?;
            let conn = Connection {
                proto: proto.to_string(),
                local: fmt_addr(f[1], v6)?,
                remote: fmt_addr(f[2], v6)?,
                state: state_name(proto, f[3]).to_string(),
                pid: None,
                process: None,
            };
            Some((conn, inode))
        })
        .collect()
}

/// Map socket inode -> (pid, process name) by walking every readable `/proc/<pid>/fd`.
fn socket_owners() -> HashMap<u64, (u32, String)> {
    let mut map = HashMap::new();
    let Ok(dir) = fs::read_dir("/proc") else {
        return map;
    };
    for entry in dir.flatten() {
        let Some(pid) = entry.file_name().to_str().and_then(|s| s.parse::<u32>().ok()) else {
            continue;
        };
        let Ok(fds) = fs::read_dir(format!("/proc/{pid}/fd")) else {
            continue; // not ours and we aren't root
        };
        let mut name: Option<String> = None;
        for fd in fds.flatten() {
            let Ok(target) = fs::read_link(fd.path()) else {
                continue;
            };
            let target = target.to_string_lossy();
            let Some(rest) = target.strip_prefix("socket:[") else {
                continue;
            };
            let Ok(inode) = rest.trim_end_matches(']').parse::<u64>() else {
                continue;
            };
            let comm = name.get_or_insert_with(|| {
                fs::read_to_string(format!("/proc/{pid}/comm"))
                    .map(|s| s.trim().to_string())
                    .unwrap_or_default()
            });
            map.entry(inode).or_insert_with(|| (pid, comm.clone()));
        }
    }
    map
}

pub fn list() -> Vec<Connection> {
    let owners = socket_owners();
    let mut out = Vec::new();
    for (proto, v6) in [("tcp", false), ("tcp6", true), ("udp", false), ("udp6", true)] {
        let Ok(text) = fs::read_to_string(format!("/proc/net/{proto}")) else {
            continue;
        };
        for (mut conn, inode) in parse_table(proto, &text, v6) {
            if let Some((pid, name)) = owners.get(&inode) {
                conn.pid = Some(*pid);
                conn.process = Some(name.clone());
            }
            out.push(conn);
            if out.len() >= MAX_ROWS {
                return out;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{TcpListener, UdpSocket};

    const TCP: &str = "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n\
   0: 0100007F:0050 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 12345 1 0000000000000000 100 0 0 10 0\n\
   1: 0100007F:C350 0100007F:0050 01 00000000:00000000 00:00000000 00000000  1000        0 67890 1 0000000000000000 20 4 30 10 -1\n\
   2: short line\n";

    #[test]
    fn parses_tcp_table() {
        let rows = parse_table("tcp", TCP, false);
        assert_eq!(rows.len(), 2, "malformed line is skipped");
        let (c, inode) = &rows[0];
        assert_eq!(c.local, "127.0.0.1:80");
        assert_eq!(c.remote, "0.0.0.0:0");
        assert_eq!(c.state, "LISTEN");
        assert_eq!(*inode, 12345);
        assert_eq!(rows[1].0.state, "ESTABLISHED");
        assert_eq!(rows[1].0.local, "127.0.0.1:50000");
    }

    #[test]
    fn maps_state_codes_per_protocol() {
        assert_eq!(state_name("tcp", "0A"), "LISTEN");
        assert_eq!(state_name("tcp6", "06"), "TIME_WAIT");
        assert_eq!(state_name("udp", "07"), "UNCONN");
        assert_eq!(state_name("udp6", "01"), "ESTABLISHED");
        assert_eq!(state_name("udp", "0A"), "-");
        assert_eq!(state_name("tcp", "ZZ"), "?");
    }

    #[test]
    fn finds_own_tcp_listener_with_owner() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let want = format!("127.0.0.1:{port}");
        let me = std::process::id();
        let found = list()
            .into_iter()
            .find(|c| c.proto == "tcp" && c.local == want)
            .expect("listener not reported");
        assert_eq!(found.state, "LISTEN");
        assert_eq!(found.pid, Some(me));
        assert!(found.process.as_deref().is_some_and(|n| !n.is_empty()));
    }

    #[test]
    fn finds_own_udp_socket_with_owner() {
        let s = UdpSocket::bind("127.0.0.1:0").unwrap();
        let want = format!("127.0.0.1:{}", s.local_addr().unwrap().port());
        let found = list()
            .into_iter()
            .find(|c| c.proto == "udp" && c.local == want)
            .expect("udp socket not reported");
        assert_eq!(found.state, "UNCONN");
        assert_eq!(found.pid, Some(std::process::id()));
    }
}
