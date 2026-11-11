use std::fs;

/// Cumulative byte counters, read straight from /proc.
#[derive(Clone, Copy, Default, Debug)]
pub struct IoTotals {
    pub disk_read: u64,
    pub disk_write: u64,
    pub net_rx: u64,
    pub net_tx: u64,
}

impl IoTotals {
    pub fn read() -> Self {
        let (disk_read, disk_write) = read_disk();
        let (net_rx, net_tx) = read_net();
        Self {
            disk_read,
            disk_write,
            net_rx,
            net_tx,
        }
    }
}

/// True for whole physical-ish disks, false for partitions and virtual devices.
pub fn is_whole_disk(name: &str) -> bool {
    const VIRTUAL: [&str; 6] = ["loop", "ram", "dm-", "zram", "sr", "md"];
    if VIRTUAL.iter().any(|p| name.starts_with(p)) {
        return false;
    }
    if name.starts_with("nvme") || name.starts_with("mmcblk") {
        // partitions look like nvme0n1p1 / mmcblk0p1; whole disks contain no 'p'
        return !name.contains('p');
    }
    !name.chars().last().map_or(false, |c| c.is_ascii_digit())
}

fn read_disk() -> (u64, u64) {
    let Ok(text) = fs::read_to_string("/proc/diskstats") else {
        return (0, 0);
    };
    let (mut r, mut w) = (0u64, 0u64);
    for line in text.lines() {
        let f: Vec<&str> = line.split_whitespace().collect();
        if f.len() < 10 || !is_whole_disk(f[2]) {
            continue;
        }
        r += f[5].parse::<u64>().unwrap_or(0) * 512;
        w += f[9].parse::<u64>().unwrap_or(0) * 512;
    }
    (r, w)
}

fn read_net() -> (u64, u64) {
    let Ok(text) = fs::read_to_string("/proc/net/dev") else {
        return (0, 0);
    };
    let (mut rx, mut tx) = (0u64, 0u64);
    for line in text.lines().skip(2) {
        let Some((iface, rest)) = line.split_once(':') else {
            continue;
        };
        if iface.trim() == "lo" {
            continue;
        }
        let f: Vec<&str> = rest.split_whitespace().collect();
        if f.len() < 9 {
            continue;
        }
        rx += f[0].parse::<u64>().unwrap_or(0);
        tx += f[8].parse::<u64>().unwrap_or(0);
    }
    (rx, tx)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whole_disk_detection() {
        assert!(is_whole_disk("sda"));
        assert!(!is_whole_disk("sda1"));
        assert!(is_whole_disk("nvme0n1"));
        assert!(!is_whole_disk("nvme0n1p2"));
        assert!(is_whole_disk("mmcblk0"));
        assert!(!is_whole_disk("mmcblk0p1"));
        assert!(!is_whole_disk("loop3"));
        assert!(!is_whole_disk("dm-0"));
    }
}
