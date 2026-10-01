//! Chrome discovery, profile directories, the free-port helper and the process
//! guard that guarantees a launched Chrome never outlives its owner.

use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::process::{Child, Command};
use tokio::time::timeout;

use super::{LaneError, LaneMode};
use crate::commands::fleet::claude_accounts::relogin::ReloginReason;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Where candidate Chrome binaries come from, injected so discovery order is
/// testable without touching the machine.
#[derive(Debug, Clone, Default)]
pub struct ChromeEnv {
    /// `App Paths\chrome.exe` default values (HKLM first, then HKCU).
    pub registry: Vec<PathBuf>,
    pub program_files: Option<PathBuf>,
    pub program_files_x86: Option<PathBuf>,
    pub local_app_data: Option<PathBuf>,
    pub path_dirs: Vec<PathBuf>,
}

#[cfg(windows)]
const EXE_NAMES: &[&str] = &["chrome.exe"];
#[cfg(not(windows))]
const EXE_NAMES: &[&str] = &["google-chrome", "google-chrome-stable", "chrome"];

/// Candidate Chrome binaries in discovery order: registry, Program Files,
/// Program Files (x86), per-user install, then PATH. Chrome only (not
/// Chromium or Edge).
pub fn chrome_candidates(env: &ChromeEnv) -> Vec<PathBuf> {
    let tail: PathBuf = ["Google", "Chrome", "Application", "chrome.exe"]
        .iter()
        .collect();
    let mut out: Vec<PathBuf> = env.registry.clone();
    for base in [
        &env.program_files,
        &env.program_files_x86,
        &env.local_app_data,
    ]
    .into_iter()
    .flatten()
    {
        out.push(base.join(&tail));
    }
    for dir in &env.path_dirs {
        for name in EXE_NAMES {
            out.push(dir.join(name));
        }
    }
    out
}

/// First candidate for which `exists` holds.
pub fn pick_chrome(env: &ChromeEnv, exists: impl Fn(&Path) -> bool) -> Option<PathBuf> {
    chrome_candidates(env).into_iter().find(|p| exists(p))
}

/// Extract the default value from `reg query ... /ve` output.
pub fn parse_reg_default(output: &str) -> Option<PathBuf> {
    for line in output.lines() {
        let t = line.trim();
        for ty in ["REG_EXPAND_SZ", "REG_SZ"] {
            if let Some(idx) = t.find(ty) {
                let v = t[idx + ty.len()..].trim().trim_matches('"');
                if !v.is_empty() {
                    return Some(PathBuf::from(v));
                }
            }
        }
    }
    None
}

#[cfg(windows)]
async fn registry_chrome_paths() -> Vec<PathBuf> {
    let mut out = Vec::new();
    for hive in ["HKLM", "HKCU"] {
        let key = format!(r"{hive}\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe");
        let run = Command::new("reg")
            .args(["query", &key, "/ve"])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        if let Ok(Ok(o)) = timeout(Duration::from_secs(5), run).await {
            if let Some(p) = parse_reg_default(&String::from_utf8_lossy(&o.stdout)) {
                out.push(p);
            }
        }
    }
    out
}

#[cfg(not(windows))]
async fn registry_chrome_paths() -> Vec<PathBuf> {
    Vec::new()
}

/// Snapshot of this process's environment for [`pick_chrome`].
pub async fn chrome_env_from_process() -> ChromeEnv {
    let var = |k: &str| std::env::var_os(k).map(PathBuf::from);
    ChromeEnv {
        registry: registry_chrome_paths().await,
        program_files: var("ProgramFiles"),
        program_files_x86: var("ProgramFiles(x86)"),
        local_app_data: var("LOCALAPPDATA"),
        path_dirs: std::env::var_os("PATH")
            .map(|p| std::env::split_paths(&p).collect())
            .unwrap_or_default(),
    }
}

pub async fn discover_chrome() -> Result<PathBuf, LaneError> {
    let env = chrome_env_from_process().await;
    pick_chrome(&env, |p| p.is_file())
        .ok_or_else(|| LaneError::new(ReloginReason::ChromeMissing, "Chrome not found"))
}

/// Lowercased, `.`/`..`-resolved, verbatim-prefix-free form for prefix tests.
fn lexical(p: &Path) -> PathBuf {
    let s = p.to_string_lossy().replace(r"\\?\", "");
    let mut out = PathBuf::new();
    for c in Path::new(&s).components() {
        match c {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str().to_string_lossy().to_lowercase()),
        }
    }
    out
}

/// Refuse the user's real Chrome profile. Chrome 136+ already refuses remote
/// debugging on the default dir, and pointing automation at the real profile
/// would expose the user's sessions; a lane profile dir must never be, or sit
/// inside, `%LOCALAPPDATA%\Google\Chrome\User Data`.
pub fn ensure_not_default_profile(
    dir: &Path,
    local_app_data: Option<&Path>,
) -> Result<(), LaneError> {
    let Some(lad) = local_app_data else {
        return Ok(());
    };
    let real = lexical(&lad.join("Google").join("Chrome").join("User Data"));
    if lexical(dir).starts_with(&real) {
        return Err(LaneError::new(
            ReloginReason::Other,
            "refusing the real Chrome profile directory",
        ));
    }
    Ok(())
}

/// `^[a-z0-9][a-z0-9_-]{0,40}$`.
pub fn valid_profile_key(key: &str) -> bool {
    let mut chars = key.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    key.len() <= 41
        && (first.is_ascii_lowercase() || first.is_ascii_digit())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
}

/// `<app_data>/claude-login-profiles/<key>`, created. The key is validated so
/// it can never carry a separator or `..`. (WP1b calls this.)
pub fn profile_dir_for(app_data: &Path, key: &str) -> Result<PathBuf, LaneError> {
    if !valid_profile_key(key) {
        return Err(LaneError::new(ReloginReason::Other, "invalid profile key"));
    }
    let dir = app_data.join("claude-login-profiles").join(key);
    std::fs::create_dir_all(&dir)
        .map_err(|e| LaneError::new(ReloginReason::Other, format!("create profile dir: {e}")))?;
    Ok(dir)
}

/// Bind 127.0.0.1:0 and release it; the caller retries on the (small) race.
pub async fn free_loopback_port() -> Result<u16, LaneError> {
    let l = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|e| LaneError::new(ReloginReason::Other, format!("free port: {e}")))?;
    let port = l
        .local_addr()
        .map_err(|e| LaneError::new(ReloginReason::Other, format!("free port: {e}")))?
        .port();
    Ok(port)
}

/// Chrome command line for one launch.
pub fn chrome_args(profile_dir: &Path, port: u16, mode: LaneMode) -> Vec<String> {
    let mut a = vec![
        format!("--user-data-dir={}", profile_dir.display()),
        format!("--remote-debugging-port={port}"),
        "--remote-debugging-address=127.0.0.1".to_string(),
        "--no-first-run".to_string(),
        "--no-default-browser-check".to_string(),
        "--disable-background-networking".to_string(),
    ];
    if mode == LaneMode::Headless {
        a.push("--headless=new".to_string());
    }
    a.push("about:blank".to_string());
    a
}

/// A launched Chrome. Dropping it kills the whole process tree, so a panic or
/// an early `?` never leaves a browser running.
pub struct ChromeProcess {
    child: Child,
    pid: u32,
    live: bool,
}

impl ChromeProcess {
    pub fn spawn(exe: &Path, args: &[String]) -> Result<Self, LaneError> {
        let mut cmd = Command::new(exe);
        cmd.args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        let child = cmd
            .spawn()
            .map_err(|e| LaneError::new(ReloginReason::ChromeMissing, format!("spawn: {e}")))?;
        let pid = child
            .id()
            .ok_or_else(|| LaneError::new(ReloginReason::Other, "chrome exited at spawn"))?;
        Ok(Self {
            child,
            pid,
            live: true,
        })
    }

    pub fn pid(&self) -> u32 {
        self.pid
    }

    /// Has the main process already exited (e.g. the profile was in use)?
    pub fn exited(&mut self) -> bool {
        !matches!(self.child.try_wait(), Ok(None))
    }

    /// Wait up to `within` for a graceful exit; true if it exited.
    pub async fn wait_exit(&mut self, within: Duration) -> bool {
        let done = timeout(within, self.child.wait()).await.is_ok();
        if done {
            self.live = false;
        }
        done
    }

    /// Kill the process tree and reap the main process.
    pub async fn terminate(&mut self) {
        if !self.live {
            return;
        }
        self.live = false;
        #[cfg(windows)]
        {
            let _ = Command::new("taskkill")
                .args(["/T", "/F", "/PID", &self.pid.to_string()])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .creation_flags(CREATE_NO_WINDOW)
                .status()
                .await;
        }
        let _ = self.child.start_kill();
        let _ = timeout(Duration::from_secs(5), self.child.wait()).await;
    }
}

impl Drop for ChromeProcess {
    fn drop(&mut self) {
        if !self.live {
            return;
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let _ = std::process::Command::new("taskkill")
                .args(["/T", "/F", "/PID", &self.pid.to_string()])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .creation_flags(CREATE_NO_WINDOW)
                .status();
        }
        let _ = self.child.start_kill();
    }
}

const CRLF2: &[u8] = b"\r\n\r\n";

/// GET `path` from the DevTools HTTP endpoint on loopback and return the body.
pub async fn devtools_http_get(port: u16, path: &str) -> Result<String, LaneError> {
    let fail = |d: String| LaneError::new(ReloginReason::Other, d);
    let run = async {
        let mut s = TcpStream::connect(("127.0.0.1", port))
            .await
            .map_err(|e| fail(format!("devtools connect: {e}")))?;
        // Chrome's DevTools HTTP server rejects HTTP/1.0.
        let req =
            format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
        s.write_all(req.as_bytes())
            .await
            .map_err(|e| fail(format!("devtools write: {e}")))?;
        // Chrome keeps the socket open despite `Connection: close`, so read to
        // Content-Length rather than to EOF.
        let mut buf: Vec<u8> = Vec::new();
        let mut chunk = [0u8; 4096];
        loop {
            if let Some(end) = buf.windows(4).position(|w| w == CRLF2) {
                let head = String::from_utf8_lossy(&buf[..end]).to_string();
                if !head.lines().next().unwrap_or("").contains(" 200") {
                    return Err(fail("devtools: non-200 response".into()));
                }
                let want = head
                    .lines()
                    .find_map(|l| {
                        let (k, v) = l.split_once(':')?;
                        k.eq_ignore_ascii_case("content-length")
                            .then(|| v.trim().parse::<usize>().ok())
                            .flatten()
                    })
                    .ok_or_else(|| fail("devtools: no content-length".into()))?;
                if buf.len() >= end + 4 + want {
                    break;
                }
            }
            let n = s
                .read(&mut chunk)
                .await
                .map_err(|e| fail(format!("devtools read: {e}")))?;
            if n == 0 {
                break;
            }
            buf.extend_from_slice(&chunk[..n]);
        }
        let text = String::from_utf8_lossy(&buf).into_owned();
        let (_, body) = text
            .split_once("\r\n\r\n")
            .ok_or_else(|| fail("devtools: malformed response".into()))?;
        Ok(body.to_string())
    };
    timeout(Duration::from_secs(3), run)
        .await
        .map_err(|_| LaneError::new(ReloginReason::Timeout, "devtools http timed out"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env() -> ChromeEnv {
        ChromeEnv {
            registry: vec![PathBuf::from(r"R:\reg\chrome.exe")],
            program_files: Some(PathBuf::from(r"C:\PF")),
            program_files_x86: Some(PathBuf::from(r"C:\PF86")),
            local_app_data: Some(PathBuf::from(r"C:\LAD")),
            path_dirs: vec![PathBuf::from(r"D:\bin")],
        }
    }

    #[test]
    fn discovery_order_is_registry_pf_pfx86_user_path() {
        let c = chrome_candidates(&env());
        assert_eq!(c[0], PathBuf::from(r"R:\reg\chrome.exe"));
        assert!(c[1].starts_with(r"C:\PF") && !c[1].starts_with(r"C:\PF86"));
        assert!(c[2].starts_with(r"C:\PF86"));
        assert!(c[3].starts_with(r"C:\LAD"));
        assert!(c[4].starts_with(r"D:\bin"));
        assert_eq!(c.len(), 4 + EXE_NAMES.len());
    }

    #[test]
    fn pick_takes_the_first_existing_candidate() {
        let e = env();
        let all = chrome_candidates(&e);
        let want = all[3].clone();
        assert_eq!(pick_chrome(&e, |p| p == want || p == all[4]), Some(want));
        assert_eq!(pick_chrome(&e, |_| false), None);
    }

    #[test]
    fn reg_output_parses() {
        let out = "\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\...\\chrome.exe\r\n    (Default)    REG_SZ    C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\r\n";
        assert_eq!(
            parse_reg_default(out),
            Some(PathBuf::from(
                r"C:\Program Files\Google\Chrome\Application\chrome.exe"
            ))
        );
        assert_eq!(parse_reg_default("ERROR: not found"), None);
    }

    #[tokio::test]
    async fn free_port_is_bindable_loopback() {
        let p = free_loopback_port().await.expect("port");
        assert!(p > 0);
        TcpListener::bind(("127.0.0.1", p)).await.expect("rebind");
    }

    #[test]
    fn profile_keys() {
        for ok in ["a", "0abc", "acct_1-b", &"a".repeat(41)] {
            assert!(valid_profile_key(ok), "{ok}");
        }
        for bad in [
            "",
            "..",
            "a/b",
            r"a\b",
            "A",
            "aB",
            "_a",
            "-a",
            "a b",
            &"a".repeat(42),
        ] {
            assert!(!valid_profile_key(bad), "{bad}");
        }
    }

    #[test]
    fn profile_dir_for_creates_under_root_and_rejects_bad_keys() {
        let tmp = tempfile::tempdir().expect("tmp");
        let d = profile_dir_for(tmp.path(), "main-1").expect("dir");
        assert!(d.is_dir());
        assert_eq!(d, tmp.path().join("claude-login-profiles").join("main-1"));
        assert!(profile_dir_for(tmp.path(), "../x").is_err());
        assert!(profile_dir_for(tmp.path(), "").is_err());
    }

    #[test]
    fn default_profile_guard() {
        let lad = PathBuf::from(r"C:\Users\u\AppData\Local");
        let real = lad.join("Google/Chrome/User Data");
        assert!(ensure_not_default_profile(&real, Some(&lad)).is_err());
        assert!(ensure_not_default_profile(&real.join("Default"), Some(&lad)).is_err());
        // Case and `..` tricks are normalised away.
        let sneaky = lad.join("google/chrome/user data/../User Data/x");
        assert!(ensure_not_default_profile(&sneaky, Some(&lad)).is_err());
        let ok = lad.join("personas/claude-login-profiles/a");
        assert!(ensure_not_default_profile(&ok, Some(&lad)).is_ok());
        assert!(ensure_not_default_profile(&real, None).is_ok());
    }

    #[test]
    fn args_carry_isolation_flags() {
        let a = chrome_args(Path::new("P"), 9333, LaneMode::Headless);
        assert!(a.contains(&"--headless=new".to_string()));
        assert!(a.contains(&"--remote-debugging-address=127.0.0.1".to_string()));
        assert!(a.contains(&"--remote-debugging-port=9333".to_string()));
        assert!(a.contains(&"--user-data-dir=P".to_string()));
        let h = chrome_args(Path::new("P"), 9333, LaneMode::Headed);
        assert!(!h.contains(&"--headless=new".to_string()));
    }
}
