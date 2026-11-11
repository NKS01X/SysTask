use std::process::Command;

/// Run a command through pkexec (polkit prompt). Blocks until it finishes.
pub fn run(args: &[String]) -> Result<(), String> {
    let out = Command::new("pkexec")
        .args(args)
        .output()
        .map_err(|e| format!("pkexec unavailable: {e}"))?;
    if out.status.success() {
        return Ok(());
    }
    let code = out.status.code();
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    Err(match code {
        Some(126) => "authentication dismissed or not authorized".to_string(),
        Some(127) => "authentication failed (is a polkit agent running?)".to_string(),
        _ if stderr.is_empty() => format!("pkexec exited with {code:?}"),
        _ => stderr,
    })
}

pub fn kill(pids: &[u32], signal: &str) -> Result<(), String> {
    let mut args: Vec<String> = vec!["kill".into(), "-s".into(), signal.into()];
    args.extend(pids.iter().map(|p| p.to_string()));
    run(&args)
}

pub fn renice(pid: u32, nice: i32) -> Result<(), String> {
    if !(-20..=19).contains(&nice) {
        return Err("nice must be between -20 and 19".into());
    }
    run(&[
        "renice".into(),
        "-n".into(),
        nice.to_string(),
        "-p".into(),
        pid.to_string(),
    ])
}

pub fn affinity(pid: u32, cpus: &[u32]) -> Result<(), String> {
    if cpus.is_empty() {
        return Err("select at least one CPU".into());
    }
    let list = cpus
        .iter()
        .map(|c| c.to_string())
        .collect::<Vec<_>>()
        .join(",");
    run(&[
        "taskset".into(),
        "-a".into(),
        "-c".into(),
        "-p".into(),
        list,
        pid.to_string(),
    ])
}
