//! Local diagnostics for the device mesh (spark device-mesh, WP2b): the checks
//! `GET /mesh/diagnostics` answers, each with the exact fix an operator can
//! paste. Decision 4 ("via their apps ONLY") makes these first-class: when
//! discovery fails, the onboarding CLI stops and prints what this module says.
//!
//! | id | ok when |
//! |---|---|
//! | `p2p_built` | always, where this module compiles (it is `p2p`-gated) |
//! | `network_running` | the network service is up |
//! | `udp_bound` | the QUIC listener holds a port |
//! | `firewall_rule` | an ENABLED inbound rule allows UDP on that port for this app, and no block rule covers it |
//! | `network_profile` | every network with LAN traffic is Private or Domain (Public blocks mDNS) |
//! | `mdns_sees_peers` | a `discovered_peers` row was refreshed in the last 60 s |
//!
//! **An unreadable probe is never green.** A probe that cannot run (no
//! `netsh`, a timeout, localized output this parser cannot read) answers
//! `ok: false` with detail `could not read: <why>`. On a non-Windows host the
//! two Windows probes answer `ok: true`, `not checked on this platform`.
//!
//! Every subprocess goes through the repo's probe chokepoint
//! ([`crate::engine::cli_process::capture_output`]: argv array, scrubbed env,
//! `CREATE_NO_WINDOW`, bounded, killed on drop). The parsers are pure and
//! tested against captured outputs; nothing here depends on the real firewall.

use std::path::{Path, PathBuf};

use serde::Serialize;

/// One diagnostic line, exactly as the `/mesh` contract carries it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticCheck {
    pub id: &'static str,
    pub ok: bool,
    pub detail: String,
    /// The exact command or Settings path that fixes it; `None` when green or
    /// when nothing a person types would help.
    pub fix: Option<String>,
}

impl DiagnosticCheck {
    fn pass(id: &'static str, detail: impl Into<String>) -> Self {
        Self {
            id,
            ok: true,
            detail: detail.into(),
            fix: None,
        }
    }

    fn fail(id: &'static str, detail: impl Into<String>, fix: Option<String>) -> Self {
        Self {
            id,
            ok: false,
            detail: detail.into(),
            fix,
        }
    }
}

/// What the network service knows about itself, read by the caller (the door).
#[derive(Debug, Clone)]
pub struct LinkFacts {
    pub network_running: bool,
    /// The port the QUIC listener holds, `None` when unbound.
    pub quic_port: Option<u16>,
    /// The port it is configured for (what a firewall rule must name).
    pub configured_port: u16,
    /// `discovered_peers` rows (other than this device) refreshed within
    /// [`PEER_SEEN_WINDOW_MS`].
    pub peers_seen_recently: usize,
    /// This running executable, for program-scoped firewall rules.
    pub exe: Option<PathBuf>,
}

/// "mDNS sees peers" means a row refreshed within this window.
pub const PEER_SEEN_WINDOW_MS: i64 = 60_000;

/// Budget for one Windows probe. `netsh ... verbose` over ~600 rules answers
/// in well under a second on the operator's machine (measured 2026-10-13).
#[cfg_attr(not(windows), allow(dead_code))]
const PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

/// Run every check. The two Windows probes run concurrently.
pub async fn run(facts: &LinkFacts) -> Vec<DiagnosticCheck> {
    let port = facts.quic_port.unwrap_or(facts.configured_port);
    // The profile goes first: the firewall judgement needs the ACTIVE
    // profiles, because a rule for another profile does not protect this one.
    let (profile, active) = profile_check().await;
    let firewall = firewall_check(port, facts.exe.as_deref(), &active).await;
    vec![
        DiagnosticCheck::pass("p2p_built", "this build carries the device mesh (p2p)"),
        network_running_check(facts.network_running),
        udp_bound_check(facts.network_running, facts.quic_port),
        firewall,
        profile,
        mdns_check(facts.peers_seen_recently),
    ]
}

fn network_running_check(running: bool) -> DiagnosticCheck {
    if running {
        DiagnosticCheck::pass("network_running", "the P2P network service is running")
    } else {
        DiagnosticCheck::fail(
            "network_running",
            "the P2P network service is not running (it starts a few seconds after the app)",
            Some("Wait 10 seconds and re-run; if it stays down, restart the Personas app.".into()),
        )
    }
}

fn udp_bound_check(running: bool, quic_port: Option<u16>) -> DiagnosticCheck {
    match quic_port {
        Some(p) => DiagnosticCheck::pass("udp_bound", format!("QUIC listening on UDP {p}")),
        None if !running => DiagnosticCheck::fail(
            "udp_bound",
            "no QUIC listener: the network service is not running",
            None,
        ),
        None => DiagnosticCheck::fail(
            "udp_bound",
            "the network is running but holds no UDP port (another process may own it)",
            Some("Close the other program using the port (netstat -ano -p udp), then restart the Personas app.".into()),
        ),
    }
}

fn mdns_check(seen: usize) -> DiagnosticCheck {
    if seen > 0 {
        DiagnosticCheck::pass(
            "mdns_sees_peers",
            format!("{seen} other device(s) seen in the last 60 s (by mDNS or a dialled address)"),
        )
    } else {
        DiagnosticCheck::fail(
            "mdns_sees_peers",
            "no other device seen in the last 60 s; normal while the other machine is still starting",
            Some("Start Personas on the other machine on the same LAN; keep both network profiles Private.".into()),
        )
    }
}

// ---------------------------------------------------------------------------
// Firewall
// ---------------------------------------------------------------------------

/// One inbound rule as `netsh advfirewall firewall show rule ... verbose`
/// prints it. Only the fields the judgement reads.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct FirewallRule {
    pub name: String,
    pub enabled: bool,
    pub inbound: bool,
    pub protocol: String,
    pub local_port: String,
    pub program: String,
    pub allow: bool,
    /// The profiles the rule applies to (`Domain`, `Private`, `Public`), as
    /// netsh prints them. Empty when the label was absent: read as "all".
    pub profiles: Vec<String>,
}

/// Parse `netsh advfirewall firewall show rule name=all dir=in verbose`.
///
/// `Err` when the text has content but no `Rule Name:` label: a localized
/// Windows prints translated labels, and guessing at them would turn
/// "unreadable" into a confident green.
pub fn parse_netsh_rules(text: &str) -> Result<Vec<FirewallRule>, String> {
    let mut rules = Vec::new();
    let mut current: Option<FirewallRule> = None;
    for line in text.lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let (key, value) = (key.trim(), value.trim());
        if key == "Rule Name" {
            if let Some(done) = current.take() {
                rules.push(done);
            }
            current = Some(FirewallRule {
                name: value.to_string(),
                ..FirewallRule::default()
            });
            continue;
        }
        let Some(rule) = current.as_mut() else {
            continue;
        };
        match key {
            "Enabled" => rule.enabled = value.eq_ignore_ascii_case("yes"),
            "Direction" => rule.inbound = value.eq_ignore_ascii_case("in"),
            "Protocol" => rule.protocol = value.to_string(),
            "LocalPort" => rule.local_port = value.to_string(),
            // `Program:` holds a Windows path whose drive letter carries its own
            // colon; `split_once` kept everything after the FIRST one.
            "Program" => rule.program = value.to_string(),
            "Action" => rule.allow = value.eq_ignore_ascii_case("allow"),
            "Profiles" => {
                rule.profiles = value
                    .split(',')
                    .map(|p| p.trim().to_string())
                    .filter(|p| !p.is_empty())
                    .collect();
            }
            _ => {}
        }
    }
    if let Some(done) = current.take() {
        rules.push(done);
    }
    if rules.is_empty() {
        let trimmed = text.trim();
        // netsh's own "nothing matched" sentence, or no output at all.
        if trimmed.is_empty() || trimmed.starts_with("No rules match") {
            return Ok(Vec::new());
        }
        return Err(
            "netsh printed no 'Rule Name:' field (its output is localized or its format changed)"
                .into(),
        );
    }
    Ok(rules)
}

/// Does a `LocalPort` value (`Any`, `4242`, `4000-4300`, `80,4242`) cover `port`?
pub fn port_covered(local_port: &str, port: u16) -> bool {
    local_port.split(',').map(str::trim).any(|part| {
        if part.eq_ignore_ascii_case("any") {
            return true;
        }
        match part.split_once('-') {
            Some((lo, hi)) => match (lo.trim().parse::<u16>(), hi.trim().parse::<u16>()) {
                (Ok(lo), Ok(hi)) => (lo..=hi).contains(&port),
                _ => false,
            },
            None => part.parse::<u16>() == Ok(port),
        }
    })
}

fn same_program(rule_program: &str, exe: Option<&Path>) -> bool {
    let norm = |s: &str| s.trim().replace('/', "\\").to_ascii_lowercase();
    exe.is_some_and(|exe| norm(rule_program) == norm(&exe.to_string_lossy()))
}

/// Does the rule apply on a network whose active profiles are `active`
/// (netsh names: `Domain`, `Private`, `Public`)? A rule with no `Profiles`
/// label, or an unknown active set, is read as "applies".
fn profile_ok(rule: &FirewallRule, active: &[String]) -> bool {
    rule.profiles.is_empty()
        || active.is_empty()
        || rule.profiles.iter().any(|rp| {
            rp.eq_ignore_ascii_case("all") || active.iter().any(|a| a.eq_ignore_ascii_case(rp))
        })
}

/// Does this enabled inbound rule cover UDP `port` for this app, on `active`?
fn covers(rule: &FirewallRule, port: u16, exe: Option<&Path>, active: &[String]) -> bool {
    let proto_ok = rule.protocol.eq_ignore_ascii_case("udp")
        || rule.protocol.eq_ignore_ascii_case("any")
        || rule.protocol.is_empty();
    let program_ok = rule.program.is_empty()
        || rule.program.eq_ignore_ascii_case("any")
        || same_program(&rule.program, exe);
    rule.enabled
        && rule.inbound
        && proto_ok
        && program_ok
        && profile_ok(rule, active)
        && port_covered(&rule.local_port, port)
}

/// The command the contract names, with this device's real port and, when
/// known, the profile(s) actually in use (a rule for the wrong profile is the
/// failure this check used to miss: measured 2026-10-15, allow rules existed
/// for Public only while the active network was Private).
pub fn firewall_fix(port: u16, active: &[String]) -> String {
    let profile = if active.is_empty() {
        String::new()
    } else {
        format!(" profile={}", active.join(",").to_ascii_lowercase())
    };
    format!(
        "netsh advfirewall firewall add rule name=\"Personas P2P\" dir=in action=allow protocol=UDP localport={port}{profile}"
    )
}

/// Judge parsed rules. A covering BLOCK rule wins over any allow, exactly as
/// Windows Firewall evaluates them.
pub fn judge_firewall(
    rules: &[FirewallRule],
    port: u16,
    exe: Option<&Path>,
    active: &[String],
) -> DiagnosticCheck {
    let covering: Vec<&FirewallRule> = rules
        .iter()
        .filter(|r| covers(r, port, exe, active))
        .collect();
    if let Some(block) = covering.iter().find(|r| !r.allow) {
        return DiagnosticCheck::fail(
            "firewall_rule",
            format!(
                "the inbound BLOCK rule \"{}\" covers UDP {port} for this app, and a block rule wins over any allow",
                block.name
            ),
            Some(format!(
                "netsh advfirewall firewall set rule name=\"{}\" new enable=no",
                block.name
            )),
        );
    }
    match covering.first() {
        Some(allow) => DiagnosticCheck::pass(
            "firewall_rule",
            format!("inbound UDP {port} is allowed by \"{}\"", allow.name),
        ),
        None => DiagnosticCheck::fail(
            "firewall_rule",
            if active.is_empty() {
                format!("no enabled inbound rule allows UDP {port} for this app")
            } else {
                format!(
                    "no enabled inbound rule allows UDP {port} for this app on the active network profile ({})",
                    active.join(", ")
                )
            },
            Some(firewall_fix(port, active)),
        ),
    }
}

#[cfg(windows)]
async fn firewall_check(port: u16, exe: Option<&Path>, active: &[String]) -> DiagnosticCheck {
    let cli = probe_args(
        "netsh",
        &[
            "advfirewall",
            "firewall",
            "show",
            "rule",
            "name=all",
            "dir=in",
            "verbose",
        ],
    );
    match crate::engine::cli_process::capture_output(&cli, PROBE_TIMEOUT).await {
        Ok(out) => match parse_netsh_rules(&out.stdout) {
            Ok(rules) => judge_firewall(&rules, port, exe, active),
            Err(why) => could_not_read("firewall_rule", &why, Some(firewall_fix(port, active))),
        },
        Err(why) => could_not_read("firewall_rule", &why, Some(firewall_fix(port, active))),
    }
}

#[cfg(not(windows))]
async fn firewall_check(_port: u16, _exe: Option<&Path>, _active: &[String]) -> DiagnosticCheck {
    DiagnosticCheck::pass("firewall_rule", "not checked on this platform")
}

// ---------------------------------------------------------------------------
// Network profile
// ---------------------------------------------------------------------------

/// One `Get-NetConnectionProfile` row, as the probe prints it:
/// `<InterfaceAlias>|<NetworkCategory>|<IPv4Connectivity>`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NetProfile {
    pub alias: String,
    pub category: String,
    pub ipv4: String,
}

/// The PowerShell the probe runs. Enum values print as their invariant names
/// (`Public`, `Private`, `DomainAuthenticated`; `Internet`, `LocalNetwork`),
/// so this does not depend on the display language.
pub const PROFILE_PS: &str = "Get-NetConnectionProfile | ForEach-Object { '{0}|{1}|{2}' -f $_.InterfaceAlias, $_.NetworkCategory, $_.IPv4Connectivity }";

pub fn parse_profiles(text: &str) -> Vec<NetProfile> {
    text.lines()
        .filter_map(|line| {
            let mut parts = line.trim().splitn(3, '|');
            let alias = parts.next()?.trim();
            let category = parts.next()?.trim();
            let ipv4 = parts.next().unwrap_or("").trim();
            (!alias.is_empty() && !category.is_empty()).then(|| NetProfile {
                alias: alias.to_string(),
                category: category.to_string(),
                ipv4: ipv4.to_string(),
            })
        })
        .collect()
}

/// A network carries LAN traffic when its IPv4 side reaches the local network
/// or beyond. An adapter with `NoTraffic` (a disconnected virtual switch) is
/// listed but cannot block discovery.
fn carries_lan(p: &NetProfile) -> bool {
    p.ipv4.eq_ignore_ascii_case("localnetwork") || p.ipv4.eq_ignore_ascii_case("internet")
}

fn is_private(p: &NetProfile) -> bool {
    p.category.eq_ignore_ascii_case("private")
        || p.category.eq_ignore_ascii_case("domainauthenticated")
}

pub fn judge_profiles(profiles: &[NetProfile]) -> DiagnosticCheck {
    let listing = profiles
        .iter()
        .map(|p| format!("{} = {} ({})", p.alias, p.category, p.ipv4))
        .collect::<Vec<_>>()
        .join("; ");
    if profiles.is_empty() {
        return DiagnosticCheck::fail(
            "network_profile",
            "no active network connection",
            Some("Connect this machine to the same LAN as the other one.".into()),
        );
    }
    let public: Vec<&NetProfile> = profiles
        .iter()
        .filter(|p| carries_lan(p) && !is_private(p))
        .collect();
    match public.first() {
        None => DiagnosticCheck::pass("network_profile", listing),
        Some(first) => DiagnosticCheck::fail(
            "network_profile",
            format!(
                "{} is a Public network, which blocks mDNS discovery. All: {listing}",
                public
                    .iter()
                    .map(|p| format!("\"{}\"", p.alias))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            Some(format!(
                "Set-NetConnectionProfile -InterfaceAlias \"{}\" -NetworkCategory Private  (in an elevated PowerShell; or Settings > Network & internet > {} > Network profile type > Private network)",
                first.alias, first.alias
            )),
        ),
    }
}

/// The netsh profile names (`Domain`, `Private`, `Public`) of the networks that
/// carry LAN traffic; empty when none is known.
pub fn active_profile_names(profiles: &[NetProfile]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for p in profiles.iter().filter(|p| carries_lan(p)) {
        let name = if p.category.eq_ignore_ascii_case("private") {
            "Private"
        } else if p.category.eq_ignore_ascii_case("public") {
            "Public"
        } else if p.category.eq_ignore_ascii_case("domainauthenticated") {
            "Domain"
        } else {
            continue;
        };
        if !out.iter().any(|o| o == name) {
            out.push(name.to_string());
        }
    }
    out
}

#[cfg(windows)]
async fn profile_check() -> (DiagnosticCheck, Vec<String>) {
    let cli = probe_args(
        "powershell.exe",
        &["-NoProfile", "-NonInteractive", "-Command", PROFILE_PS],
    );
    match crate::engine::cli_process::capture_output(&cli, PROBE_TIMEOUT).await {
        Ok(out) if out.status.success() => {
            let profiles = parse_profiles(&out.stdout);
            (judge_profiles(&profiles), active_profile_names(&profiles))
        }
        Ok(out) => (
            could_not_read(
                "network_profile",
                &format!(
                    "Get-NetConnectionProfile exited {}: {}",
                    out.status,
                    first_line(&out.stderr)
                ),
                None,
            ),
            Vec::new(),
        ),
        Err(why) => (could_not_read("network_profile", &why, None), Vec::new()),
    }
}

#[cfg(not(windows))]
async fn profile_check() -> (DiagnosticCheck, Vec<String>) {
    (
        DiagnosticCheck::pass("network_profile", "not checked on this platform"),
        Vec::new(),
    )
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/// A probe that could not answer is RED, never green.
#[cfg_attr(not(windows), allow(dead_code))]
fn could_not_read(id: &'static str, why: &str, fix: Option<String>) -> DiagnosticCheck {
    DiagnosticCheck::fail(id, format!("could not read: {why}"), fix)
}

#[cfg_attr(not(windows), allow(dead_code))]
fn first_line(s: &str) -> String {
    s.lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("no output")
        .chars()
        .take(200)
        .collect()
}

#[cfg(windows)]
fn probe_args(command: &str, args: &[&str]) -> personas_core::types::CliArgs {
    personas_core::types::CliArgs {
        command: command.to_string(),
        args: args.iter().map(|a| a.to_string()).collect(),
        env_overrides: Vec::new(),
        env_removals: Vec::new(),
        cwd: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Captured from `netsh advfirewall firewall show rule name=all dir=in
    /// verbose` on the operator's machine (2026-10-13), trimmed to three rules,
    /// plus the two shapes this module must judge: an allow and a block.
    const NETSH: &str = "
Rule Name:                            sundial
----------------------------------------------------------------------
Description:                          sundial
Enabled:                              Yes
Direction:                            In
Profiles:                             Private,Public
Protocol:                             UDP
LocalPort:                            Any
Program:                              C:\\t\\sundial.exe
Action:                               Allow

Rule Name:                            Personas P2P
----------------------------------------------------------------------
Enabled:                              Yes
Direction:                            In
Profiles:                             Domain,Private,Public
Protocol:                             UDP
LocalPort:                            4242
Program:                              Any
Action:                               Allow

Rule Name:                            personas-desktop.exe
----------------------------------------------------------------------
Enabled:                              Yes
Direction:                            In
Profiles:                             Public
Protocol:                             UDP
LocalPort:                            Any
Program:                              C:\\Apps\\Personas\\personas-desktop.exe
Action:                               Block
Ok.
";

    fn exe() -> PathBuf {
        PathBuf::from("C:\\Apps\\Personas\\personas-desktop.exe")
    }

    #[test]
    fn netsh_rules_parse_including_the_drive_colon_in_program() {
        let rules = parse_netsh_rules(NETSH).unwrap();
        assert_eq!(rules.len(), 3);
        assert_eq!(rules[0].program, "C:\\t\\sundial.exe");
        assert_eq!(rules[1].name, "Personas P2P");
        assert!(rules[1].enabled && rules[1].inbound && rules[1].allow);
        assert_eq!(rules[1].local_port, "4242");
        assert!(!rules[2].allow, "Action: Block");
    }

    #[test]
    fn a_port_rule_for_any_program_is_green() {
        let rules = parse_netsh_rules(NETSH).unwrap();
        let only_port: Vec<FirewallRule> = rules[..2].to_vec();
        let c = judge_firewall(&only_port, 4242, Some(&exe()), &[]);
        assert!(c.ok, "{c:?}");
        assert!(c.detail.contains("Personas P2P"), "{c:?}");
        assert_eq!(c.fix, None);
    }

    #[test]
    fn a_block_rule_for_this_exe_wins_over_an_allow() {
        let c = judge_firewall(&parse_netsh_rules(NETSH).unwrap(), 4242, Some(&exe()), &[]);
        assert!(!c.ok, "{c:?}");
        assert!(c.detail.contains("BLOCK"), "{c:?}");
        assert_eq!(
            c.fix.as_deref(),
            Some("netsh advfirewall firewall set rule name=\"personas-desktop.exe\" new enable=no")
        );
    }

    #[test]
    fn another_programs_rule_and_another_port_do_not_count() {
        let rules = parse_netsh_rules(NETSH).unwrap();
        // sundial's rule is for sundial.exe only; Personas P2P names 4242.
        let c = judge_firewall(&rules[..2], 4301, Some(&exe()), &[]);
        assert!(!c.ok, "{c:?}");
        assert_eq!(c.fix, Some(firewall_fix(4301, &[])));
        assert!(c
            .fix
            .as_deref()
            .unwrap()
            .ends_with("protocol=UDP localport=4301"));
    }

    #[test]
    fn a_disabled_rule_does_not_count() {
        let mut rules = parse_netsh_rules(NETSH).unwrap()[..2].to_vec();
        rules[1].enabled = false;
        assert!(!judge_firewall(&rules, 4242, Some(&exe()), &[]).ok);
    }

    #[test]
    fn an_exe_scoped_allow_counts_for_any_port() {
        let rule = FirewallRule {
            name: "Personas".into(),
            enabled: true,
            inbound: true,
            protocol: "UDP".into(),
            local_port: "Any".into(),
            program: "c:/apps/personas/PERSONAS-DESKTOP.EXE".into(),
            allow: true,
            profiles: Vec::new(),
        };
        assert!(judge_firewall(&[rule], 4301, Some(&exe()), &[]).ok);
    }

    #[test]
    fn port_ranges_and_lists_are_read() {
        assert!(port_covered("Any", 4242));
        assert!(port_covered("80, 4242", 4242));
        assert!(port_covered("4000-4300", 4242));
        assert!(!port_covered("4000-4100", 4242));
        assert!(!port_covered("42420", 4242));
        assert!(!port_covered("", 4242));
    }

    #[test]
    fn localized_or_empty_netsh_output_is_never_green() {
        let czech = "Název pravidla:   Personas\n-----\nPovoleno:   Ano\n";
        assert!(parse_netsh_rules(czech).is_err());
        assert_eq!(
            parse_netsh_rules("\r\nNo rules match the specified criteria.\r\n").unwrap(),
            vec![]
        );
        let red = could_not_read("firewall_rule", "netsh did not answer within 20s", None);
        assert!(!red.ok);
        assert!(red.detail.starts_with("could not read: "));
    }

    /// Captured from this machine's `PROFILE_PS` (2026-10-13).
    const PROFILES: &str = "Wi-Fi 2|Public|Internet\r\nTailscale|Private|LocalNetwork\r\n";

    #[test]
    fn a_public_lan_profile_is_red_with_its_exact_fix() {
        let profiles = parse_profiles(PROFILES);
        assert_eq!(profiles.len(), 2);
        let c = judge_profiles(&profiles);
        assert!(!c.ok, "{c:?}");
        assert!(
            c.detail.contains("\"Wi-Fi 2\" is a Public network"),
            "{c:?}"
        );
        assert!(c.fix.as_deref().unwrap().starts_with(
            "Set-NetConnectionProfile -InterfaceAlias \"Wi-Fi 2\" -NetworkCategory Private"
        ));
    }

    #[test]
    fn private_and_domain_profiles_are_green_and_idle_adapters_are_ignored() {
        let c = judge_profiles(&parse_profiles(
            "Ethernet|Private|Internet\nCorp|DomainAuthenticated|LocalNetwork\nvEthernet (WSL)|Public|NoTraffic\n",
        ));
        assert!(c.ok, "{c:?}");
        assert!(c.detail.contains("Ethernet = Private"), "{c:?}");
        assert!(!judge_profiles(&[]).ok, "no network at all is not green");
    }

    fn allow_for(profiles: &[&str]) -> FirewallRule {
        FirewallRule {
            name: "Personas mesh".into(),
            enabled: true,
            inbound: true,
            protocol: "UDP".into(),
            local_port: "4242".into(),
            program: "Any".into(),
            allow: true,
            profiles: profiles.iter().map(|p| p.to_string()).collect(),
        }
    }

    #[test]
    fn an_allow_for_another_profile_is_red_and_the_fix_names_the_active_one() {
        let rules = [allow_for(&["Public"])];
        let private = vec!["Private".to_string()];
        let c = judge_firewall(&rules, 4242, Some(&exe()), &private);
        assert!(!c.ok, "{c:?}");
        assert!(
            c.detail.contains("active network profile (Private)"),
            "{c:?}"
        );
        assert!(c
            .fix
            .as_deref()
            .unwrap()
            .ends_with("localport=4242 profile=private"));
        // The same rule is green while Public is the active profile.
        let public = vec!["Public".to_string()];
        assert!(judge_firewall(&rules, 4242, Some(&exe()), &public).ok);
        // A multi-profile rule covers Private.
        assert!(
            judge_firewall(
                &[allow_for(&["Domain", "Private"])],
                4242,
                Some(&exe()),
                &private
            )
            .ok
        );
    }

    #[test]
    fn the_netsh_profiles_label_is_parsed_and_active_names_map_from_categories() {
        let rules = parse_netsh_rules(NETSH).unwrap();
        assert_eq!(rules[0].profiles, vec!["Private", "Public"]);
        assert_eq!(rules[1].profiles, vec!["Domain", "Private", "Public"]);
        let active = active_profile_names(&parse_profiles(
            "Wi-Fi|Private|Internet
Corp|DomainAuthenticated|LocalNetwork
vEth|Public|NoTraffic
",
        ));
        assert_eq!(active, vec!["Private", "Domain"]);
    }

    #[test]
    fn the_link_checks_say_what_they_saw() {
        assert!(network_running_check(true).ok);
        assert!(!network_running_check(false).ok);
        assert!(udp_bound_check(true, Some(4242)).detail.contains("4242"));
        assert!(!udp_bound_check(true, None).ok);
        assert!(mdns_check(1).ok);
        let none = mdns_check(0);
        assert!(!none.ok && none.fix.is_some());
    }
}
