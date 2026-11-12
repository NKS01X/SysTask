//! Mounted filesystems and their usage (the data behind `df`).

use serde::Serialize;
use std::collections::HashSet;
use std::ffi::CString;
use std::fs;

#[derive(Serialize, Clone, Debug)]
pub struct Filesystem {
    pub device: String,
    pub mount: String,
    pub fstype: String,
    pub total: u64,
    pub used: u64,
    /// Space available to unprivileged users (can be less than total - used).
    pub avail: u64,
}

/// Pseudo, in-memory, container and read-only image filesystems that only add noise.
const SKIP_TYPES: &[&str] = &[
    "proc",
    "sysfs",
    "devtmpfs",
    "devpts",
    "tmpfs",
    "ramfs",
    "cgroup",
    "cgroup2",
    "pstore",
    "bpf",
    "debugfs",
    "tracefs",
    "securityfs",
    "configfs",
    "fusectl",
    "mqueue",
    "hugetlbfs",
    "autofs",
    "binfmt_misc",
    "overlay",
    "squashfs",
    "nsfs",
    "efivarfs",
    "rpc_pipefs",
    "fuse.portal",
    "fuse.gvfsd-fuse",
];

pub fn is_real_fs(fstype: &str) -> bool {
    !SKIP_TYPES.contains(&fstype)
}

/// Undo the octal escapes the kernel uses in `/proc/mounts` (`\040` is a space).
pub fn unescape(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'\\' && i + 3 < b.len() {
            let o = &b[i + 1..i + 4];
            if o.iter().all(|c| (b'0'..=b'7').contains(c)) {
                let v = u32::from(o[0] - b'0') * 64 + u32::from(o[1] - b'0') * 8 + u32::from(o[2] - b'0');
                out.push(v as u8);
                i += 4;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// `(device, mount point, fstype)` for every line of a mounts table.
pub fn parse_mounts(text: &str) -> Vec<(String, String, String)> {
    text.lines()
        .filter_map(|line| {
            let mut f = line.split_whitespace();
            let device = unescape(f.next()?);
            let mount = unescape(f.next()?);
            let fstype = f.next()?.to_string();
            Some((device, mount, fstype))
        })
        .collect()
}

/// `(total, used, avail)` in bytes for a mount point.
#[allow(clippy::unnecessary_cast)] // statvfs field widths differ between targets
pub fn usage(mount: &str) -> Option<(u64, u64, u64)> {
    let path = CString::new(mount).ok()?;
    let mut st: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(path.as_ptr(), &mut st) } != 0 {
        return None;
    }
    let unit = st.f_frsize as u64;
    let total = (st.f_blocks as u64).saturating_mul(unit);
    let free = (st.f_bfree as u64).saturating_mul(unit);
    let avail = (st.f_bavail as u64).saturating_mul(unit);
    Some((total, total.saturating_sub(free), avail))
}

pub fn list() -> Vec<Filesystem> {
    let text = fs::read_to_string("/proc/self/mounts")
        .or_else(|_| fs::read_to_string("/proc/mounts"))
        .unwrap_or_default();
    let mut seen_devices: HashSet<String> = HashSet::new();
    let mut out = Vec::new();
    for (device, mount, fstype) in parse_mounts(&text) {
        if !is_real_fs(&fstype) {
            continue;
        }
        // Bind mounts and btrfs subvolumes show the same device repeatedly; keep the first.
        if device.starts_with('/') && !seen_devices.insert(device.clone()) {
            continue;
        }
        let Some((total, used, avail)) = usage(&mount) else {
            continue;
        };
        if total == 0 {
            continue;
        }
        out.push(Filesystem {
            device,
            mount,
            fstype,
            total,
            used,
            avail,
        });
    }
    out.sort_by(|a, b| a.mount.cmp(&b.mount));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unescapes_octal_sequences() {
        assert_eq!(unescape("/mnt/My\\040Disk"), "/mnt/My Disk");
        assert_eq!(unescape("a\\134b"), "a\\b");
        assert_eq!(unescape("plain"), "plain");
        // a trailing or malformed escape is left alone
        assert_eq!(unescape("x\\04"), "x\\04");
        assert_eq!(unescape("x\\089"), "x\\089");
    }

    #[test]
    fn parses_mounts_table() {
        let t = "/dev/sda1 / ext4 rw,relatime 0 0\n\
                 proc /proc proc rw,nosuid 0 0\n\
                 /dev/sdb1 /mnt/My\\040Disk ntfs3 rw 0 0\n";
        let m = parse_mounts(t);
        assert_eq!(m.len(), 3);
        assert_eq!(m[0], ("/dev/sda1".into(), "/".into(), "ext4".into()));
        assert_eq!(m[2].1, "/mnt/My Disk");
    }

    #[test]
    fn filters_pseudo_filesystems() {
        assert!(is_real_fs("ext4"));
        assert!(is_real_fs("btrfs"));
        assert!(is_real_fs("vfat"));
        assert!(!is_real_fs("proc"));
        assert!(!is_real_fs("tmpfs"));
        assert!(!is_real_fs("overlay"));
        assert!(!is_real_fs("squashfs"));
    }

    #[test]
    fn statvfs_works_on_root_and_rejects_bad_paths() {
        let (total, used, avail) = usage("/").unwrap();
        assert!(total > 0);
        assert!(used <= total);
        assert!(avail <= total);
        assert!(usage("/definitely/not/a/mount").is_none());
        assert!(usage("bad\0path").is_none());
    }

    #[test]
    fn list_has_only_real_nonempty_filesystems() {
        for f in list() {
            assert!(is_real_fs(&f.fstype), "{} leaked through", f.fstype);
            assert!(f.total > 0);
            assert!(f.used <= f.total);
        }
    }
}
