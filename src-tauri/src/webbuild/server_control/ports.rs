//! The LISTEN-socket table: which pid owns each listening TCP port, read once
//! per supervisor pass from the platform's own tool, plus the free-port
//! suggestion for Add app.
//!
//! - Windows: `netstat -ano`. Deliberately NOT `-p TCP`: that filter lists
//!   IPv4 only, and a Vite or Next dev server bound to `localhost` on Node 17+
//!   listens on `[::1]`, so `-p TCP` would call it stopped. The state column is
//!   localized (`LISTENING`, `ABHÖREN`, ...), so a row is read as listening
//!   from its foreign address instead: a LISTEN socket's remote port is 0
//!   (`0.0.0.0:0`, `[::]:0`) and no connection's ever is.
//! - Unix: `lsof -nP -iTCP -sTCP:LISTEN` (numeric hosts and ports).
//!
//! No maintained crate in the tree reads the socket table (`netstat2` /
//! `listeners` are not dependencies), so the parsers here are pure functions
//! over the tools' text, tested against fixtures. Both tools run through the
//! subprocess chokepoint's probe door (`cli_process::capture_output`):
//! cleared environment, no window, bounded, killed on drop.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use personas_core::types::CliArgs;

/// Listening port -> owner pid.
pub type ListenTable = HashMap<u16, u32>;

/// The first port Add app suggests.
pub const FIRST_SUGGESTED_PORT: u16 = 3000;

/// The socket-table probe's ceiling. `netstat -ano` answers in ~0.3 s.
const PROBE_TIMEOUT: Duration = Duration::from_secs(10);

/// The port of a `host:port` address (`0.0.0.0:3000`, `[::1]:5173`, `*:3000`).
fn port_of(address: &str) -> Option<u16> {
    address.rsplit_once(':')?.1.parse().ok()
}

/// Parse `netstat -ano` (Windows). TCP rows only, IPv4 and IPv6, pid 0 (the
/// idle process, which owns nothing) skipped. The first owner seen for a port
/// wins; a dual-stack server lists the same pid twice anyway.
pub fn parse_netstat(text: &str) -> ListenTable {
    let mut table = ListenTable::new();
    for line in text.lines() {
        let cols: Vec<&str> = line.split_whitespace().collect();
        // Proto, Local, Foreign, State, PID. UDP rows have no state column.
        let [proto, local, foreign, _state, pid] = cols.as_slice() else {
            continue;
        };
        if !proto.eq_ignore_ascii_case("TCP") || port_of(foreign) != Some(0) {
            continue;
        }
        let (Some(port), Ok(pid)) = (port_of(local), pid.parse::<u32>()) else {
            continue;
        };
        if port != 0 && pid != 0 {
            table.entry(port).or_insert(pid);
        }
    }
    table
}

/// Parse `lsof -nP -iTCP -sTCP:LISTEN` (Unix):
/// `COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME`, where NAME is
/// `*:3000 (LISTEN)` or `127.0.0.1:5173 (LISTEN)` or `[::1]:5173 (LISTEN)`.
pub fn parse_lsof(text: &str) -> ListenTable {
    let mut table = ListenTable::new();
    for line in text.lines().skip_while(|l| l.starts_with("COMMAND")) {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 9 || !line.contains("(LISTEN)") {
            continue;
        }
        let Ok(pid) = cols[1].parse::<u32>() else {
            continue;
        };
        // NAME follows the NODE column, which reads `TCP`.
        let Some(name) = cols
            .iter()
            .position(|c| *c == "TCP")
            .and_then(|i| cols.get(i + 1))
        else {
            continue;
        };
        if let Some(port) = port_of(name).filter(|p| *p != 0) {
            table.entry(port).or_insert(pid);
        }
    }
    table
}

/// Read the LISTEN table now.
pub async fn listen_table() -> Result<ListenTable, String> {
    #[cfg(windows)]
    let (program, args): (&str, &[&str]) = ("netstat", &["-ano"]);
    #[cfg(not(windows))]
    let (program, args): (&str, &[&str]) = ("lsof", &["-nP", "-iTCP", "-sTCP:LISTEN"]);
    let cli = CliArgs {
        command: program.to_string(),
        args: args.iter().map(|a| a.to_string()).collect(),
        env_overrides: Vec::new(),
        env_removals: Vec::new(),
        cwd: None,
    };
    let out = personas_engine::cli_process::capture_output(&cli, PROBE_TIMEOUT).await?;
    if cfg!(windows) {
        if !out.status.success() {
            return Err(format!(
                "{program} exited with {:?}: {}",
                out.status.code(),
                out.stderr.trim()
            ));
        }
        return Ok(parse_netstat(&out.stdout));
    }
    // lsof exits 1 when nothing matched, which here means "no listeners".
    if !out.status.success() && !out.stderr.trim().is_empty() {
        return Err(format!(
            "{program} exited with {:?}: {}",
            out.status.code(),
            out.stderr.trim()
        ));
    }
    Ok(parse_lsof(&out.stdout))
}

/// The first port at or above [`FIRST_SUGGESTED_PORT`] that no project is
/// configured on and nothing is listening on.
pub fn suggest_port(configured: &HashSet<u16>, listening: &ListenTable) -> Option<u16> {
    (FIRST_SUGGESTED_PORT..=u16::MAX)
        .find(|p| !configured.contains(p) && !listening.contains_key(p))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Trimmed from a real `netstat -ano` on Windows 11 (2026-10-05), with a
    /// UDP row, an established connection, a TIME_WAIT owned by pid 0, an IPv6
    /// listener and a loopback-only listener added.
    const NETSTAT: &str = "
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1360
  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       31092
  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       4410
  TCP    127.0.0.1:52011        127.0.0.1:3000         ESTABLISHED     9876
  TCP    127.0.0.1:52012        127.0.0.1:3000         TIME_WAIT       0
  TCP    [::]:3000              [::]:0                 LISTENING       31092
  TCP    [::1]:5174             [::]:0                 LISTENING       5520
  UDP    0.0.0.0:5353           *:*                                    2216
  UDP    [::]:5353              *:*                                    2216
";

    #[test]
    fn netstat_reads_ipv4_and_ipv6_listeners() {
        let t = parse_netstat(NETSTAT);
        assert_eq!(t.get(&3000), Some(&31092));
        assert_eq!(t.get(&5173), Some(&4410));
        // IPv6-only: what `-p TCP` would have missed.
        assert_eq!(t.get(&5174), Some(&5520));
        assert_eq!(t.get(&135), Some(&1360));
        assert_eq!(t.len(), 4);
    }

    #[test]
    fn netstat_ignores_connections_udp_and_pid_zero() {
        let t = parse_netstat(NETSTAT);
        assert!(
            !t.contains_key(&52011),
            "an established client port is not a listener"
        );
        assert!(!t.contains_key(&52012));
        assert!(!t.contains_key(&5353), "UDP is not TCP");
    }

    #[test]
    fn netstat_does_not_depend_on_the_localized_state_word() {
        let german = "  TCP    0.0.0.0:8080           0.0.0.0:0              ABHÖREN         777\n\
                      TCP    10.0.0.2:50000         1.2.3.4:443            HERGESTELLT     778\n";
        let t = parse_netstat(german);
        assert_eq!(t.get(&8080), Some(&777));
        assert_eq!(t.len(), 1);
    }

    #[test]
    fn netstat_survives_noise() {
        assert!(parse_netstat("").is_empty());
        assert!(parse_netstat("garbage line\n  TCP  nonsense").is_empty());
    }

    const LSOF: &str = "\
COMMAND   PID  USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
node    40211 kazda   23u  IPv6 0x9a1b2c3d4e5f6a7b      0t0  TCP *:3000 (LISTEN)
node    40388 kazda   21u  IPv4 0x1a2b3c4d5e6f7a8b      0t0  TCP 127.0.0.1:5173 (LISTEN)
node    40388 kazda   22u  IPv6 0x2b3c4d5e6f7a8b9c      0t0  TCP [::1]:5173 (LISTEN)
rapportd  512 kazda    4u  IPv4 0x3c4d5e6f7a8b9cad      0t0  TCP *:49152 (LISTEN)
";

    #[test]
    fn lsof_reads_listeners() {
        let t = parse_lsof(LSOF);
        assert_eq!(t.get(&3000), Some(&40211));
        assert_eq!(t.get(&5173), Some(&40388));
        assert_eq!(t.get(&49152), Some(&512));
        assert_eq!(t.len(), 3);
        assert!(parse_lsof("").is_empty());
    }

    #[test]
    fn the_suggestion_skips_configured_and_listening_ports() {
        let configured: HashSet<u16> = [3000, 3002].into_iter().collect();
        let listening: ListenTable = [(3001, 9)].into_iter().collect();
        assert_eq!(suggest_port(&configured, &listening), Some(3003));
        assert_eq!(
            suggest_port(&HashSet::new(), &ListenTable::new()),
            Some(FIRST_SUGGESTED_PORT)
        );
    }

    #[test]
    fn the_suggestion_runs_out_honestly() {
        let configured: HashSet<u16> = (FIRST_SUGGESTED_PORT..=u16::MAX).collect();
        assert_eq!(suggest_port(&configured, &ListenTable::new()), None);
    }

    /// The real tool on this machine, end to end through the chokepoint. Not a
    /// fixture: it proves the probe door runs the tool and the parser reads
    /// its real output (a socket bound here must show up with our pid).
    /// Ignored off Windows, where `lsof` is not guaranteed on a CI runner.
    #[tokio::test]
    #[cfg_attr(not(windows), ignore)]
    async fn the_live_table_sees_a_socket_this_process_binds() {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let table = listen_table().await.expect("socket table");
        assert_eq!(table.get(&port), Some(&std::process::id()));
    }
}
