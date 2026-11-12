//! Per-process data read straight from `/proc`: thread count, nice, CPU time,
//! start time and disk I/O rates.

use std::collections::HashMap;
use std::fs;
use std::time::Instant;

/// I/O is only re-sampled when at least this much time has passed, so a fast
/// refresh rate can't turn tiny deltas into noisy rates.
const MIN_SAMPLE_SECS: f64 = 0.2;

/// The fields we need from `/proc/<pid>/stat`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StatInfo {
    pub nice: i32,
    pub threads: u32,
    /// utime + stime, in clock ticks.
    pub cpu_ticks: u64,
    /// Process start time, in clock ticks after boot.
    pub start_ticks: u64,
}

/// Parse the contents of `/proc/<pid>/stat`.
///
/// The command name (field 2) is wrapped in parentheses and may itself contain
/// spaces and parentheses, so parsing starts after the *last* `)`.
pub fn parse_stat(s: &str) -> Option<StatInfo> {
    let rest = &s[s.rfind(')')? + 1..];
    let f: Vec<&str> = rest.split_whitespace().collect();
    // `f[0]` is field 3 (state), so field N lives at index N - 3:
    // utime 14 -> 11, stime 15 -> 12, nice 19 -> 16, num_threads 20 -> 17, starttime 22 -> 19.
    let utime: u64 = f.get(11)?.parse().ok()?;
    let stime: u64 = f.get(12)?.parse().ok()?;
    Some(StatInfo {
        nice: f.get(16)?.parse().ok()?,
        threads: f.get(17)?.parse().ok()?,
        cpu_ticks: utime.saturating_add(stime),
        start_ticks: f.get(19)?.parse().ok()?,
    })
}

pub fn read_stat(pid: u32) -> Option<StatInfo> {
    parse_stat(&fs::read_to_string(format!("/proc/{pid}/stat")).ok()?)
}

/// Parse `/proc/<pid>/io` into `(read_bytes, write_bytes)` (bytes that actually
/// hit the storage layer).
pub fn parse_io(s: &str) -> Option<(u64, u64)> {
    let (mut read, mut write) = (None, None);
    for line in s.lines() {
        if let Some(v) = line.strip_prefix("read_bytes:") {
            read = v.trim().parse().ok();
        } else if let Some(v) = line.strip_prefix("write_bytes:") {
            write = v.trim().parse().ok();
        }
    }
    Some((read?, write?))
}

/// `None` when the file is unreadable, which is normal for other users' processes.
pub fn read_io(pid: u32) -> Option<(u64, u64)> {
    parse_io(&fs::read_to_string(format!("/proc/{pid}/io")).ok()?)
}

/// First field of `/proc/uptime`: seconds since boot.
pub fn parse_uptime(s: &str) -> Option<f64> {
    s.split_whitespace().next()?.parse().ok()
}

pub fn read_uptime() -> Option<f64> {
    parse_uptime(&fs::read_to_string("/proc/uptime").ok()?)
}

/// Clock ticks per second (`USER_HZ`), needed to turn tick counts into seconds.
pub fn clock_ticks() -> f64 {
    let t = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
    if t > 0 {
        t as f64
    } else {
        100.0
    }
}

/// Bytes per second between two counter readings.
pub fn rate(prev: u64, cur: u64, dt: f64) -> f64 {
    if dt <= 0.0 {
        0.0
    } else {
        cur.saturating_sub(prev) as f64 / dt
    }
}

/// Turns cumulative per-process I/O counters into rates.
#[derive(Default)]
pub struct IoTracker {
    prev: HashMap<u32, (u64, u64)>,
    at: Option<Instant>,
    rates: HashMap<u32, (f64, f64)>,
}

impl IoTracker {
    /// Sample every pid. Pids that vanished are dropped; pids whose counters
    /// can't be read simply have no rate.
    pub fn update(&mut self, pids: &[u32]) {
        let now = Instant::now();
        let dt = self.at.map(|t| now.duration_since(t).as_secs_f64());
        if matches!(dt, Some(d) if d < MIN_SAMPLE_SECS) {
            return;
        }
        let mut cur = HashMap::with_capacity(pids.len());
        let mut rates = HashMap::new();
        for &pid in pids {
            let Some((r, w)) = read_io(pid) else { continue };
            if let (Some(dt), Some(&(pr, pw))) = (dt, self.prev.get(&pid)) {
                rates.insert(pid, (rate(pr, r, dt), rate(pw, w, dt)));
            }
            cur.insert(pid, (r, w));
        }
        self.prev = cur;
        self.rates = rates;
        self.at = Some(now);
    }

    /// `(read_bps, write_bps)` for a pid, if known.
    pub fn rate(&self, pid: u32) -> Option<(f64, f64)> {
        self.rates.get(&pid).copied()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    const STAT: &str = "1234 (my (weird) name) S 1 1234 1234 0 -1 4194560 100 0 0 0 150 50 0 0 20 -5 7 0 98765 123456 789 18446744073709551615 1 1 0 0 0 0 0 0 0 0 0 0 17 3 0 0 0 0 0";

    #[test]
    fn parses_stat_with_parens_in_comm() {
        let s = parse_stat(STAT).unwrap();
        assert_eq!(s.nice, -5);
        assert_eq!(s.threads, 7);
        assert_eq!(s.cpu_ticks, 200);
        assert_eq!(s.start_ticks, 98765);
    }

    #[test]
    fn rejects_truncated_stat() {
        assert!(parse_stat("1 (init) S 0 1").is_none());
        assert!(parse_stat("garbage").is_none());
    }

    #[test]
    fn parses_io_counters() {
        let io = "rchar: 10\nwchar: 20\nsyscr: 1\nsyscw: 2\nread_bytes: 4096\nwrite_bytes: 8192\ncancelled_write_bytes: 0\n";
        assert_eq!(parse_io(io), Some((4096, 8192)));
        assert_eq!(parse_io("rchar: 1\n"), None);
    }

    #[test]
    fn parses_uptime() {
        assert_eq!(parse_uptime("350735.47 234388.90\n"), Some(350735.47));
        assert_eq!(parse_uptime(""), None);
    }

    #[test]
    fn rate_math_saturates_and_guards_zero_dt() {
        assert_eq!(rate(100, 300, 2.0), 100.0);
        assert_eq!(rate(300, 100, 2.0), 0.0);
        assert_eq!(rate(0, 100, 0.0), 0.0);
    }

    #[test]
    fn clock_ticks_is_sane() {
        let t = clock_ticks();
        assert!((10.0..=10_000.0).contains(&t));
    }

    #[test]
    fn reads_own_stat_and_uptime() {
        let s = read_stat(std::process::id()).unwrap();
        assert!(s.threads >= 1);
        assert!(read_uptime().unwrap() > 0.0);
    }

    #[test]
    fn tracker_produces_rates_after_second_sample() {
        // Some kernels/containers don't expose /proc/<pid>/io; nothing to check there.
        let me = std::process::id();
        if read_io(me).is_none() {
            return;
        }
        let mut t = IoTracker::default();
        t.update(&[me]);
        assert!(t.rate(me).is_none(), "no rate from a single sample");
        std::thread::sleep(Duration::from_millis(250));
        t.update(&[me]);
        let (r, w) = t.rate(me).unwrap();
        assert!(r >= 0.0 && w >= 0.0);
    }

    #[test]
    fn tracker_drops_vanished_pids_and_skips_unreadable() {
        let me = std::process::id();
        let mut t = IoTracker::default();
        t.update(&[me, u32::MAX]);
        std::thread::sleep(Duration::from_millis(250));
        t.update(&[u32::MAX]);
        assert!(t.rate(u32::MAX).is_none());
        assert!(t.rate(me).is_none());
    }
}
