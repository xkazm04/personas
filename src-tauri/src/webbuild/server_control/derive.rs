//! The state table, as one pure function.
//!
//! Every input is passed in (the config row, what the registry owns, the
//! in-flight flags, whether our server answered HTTP, the LISTEN owner of the
//! port, and the clock), so each row of the contract's table is a unit test
//! rather than a scenario that needs real processes.
//!
//! | condition (first match wins) | state |
//! |---|---|
//! | a scan for this project is in flight | `scanning` |
//! | a stop is in flight | `stopping` |
//! | a recorded failure (spawn error, exit before healthy, failed scan) | `failed` |
//! | ours, answered HTTP now or at any point since it started | `running` |
//! | ours, not yet answering, under 120 s since start | `starting` |
//! | ours, never answered, 120 s or more since start | `failed` |
//! | not ours, the port has a LISTEN owner | `external` |
//! | no `dev_command` | `unconfigured` |
//! | otherwise | `stopped` |
//!
//! Two readings the contract leaves open, decided here:
//! - "No HTTP within 120 s" is derived, not recorded: if a slow first compile
//!   answers after the window, the server reads `running` from then on rather
//!   than staying `failed` while it serves. Failures that ARE recorded (exit,
//!   spawn error, scan) stick until the next start or stop.
//! - Once a server has answered, a missed probe (a dev server busy recompiling
//!   for more than the probe's read timeout) keeps it `running`; it does not
//!   flap back to `starting`.

use crate::db::repos::dev::dev_servers::DevServerConfig;
use crate::webbuild::devserver::OwnedServer;

use super::{DevServerState, DevServerView};

/// How long a server we started may take to answer HTTP before it is `failed`.
pub const STARTUP_GRACE_SECS: i64 = 120;

/// Everything observed about one project at one instant.
#[derive(Debug, Clone, Copy)]
pub struct Observed<'a> {
    pub scanning: bool,
    pub stopping: bool,
    /// A recorded failure, sticky until the next start or stop.
    pub failure: Option<&'a str>,
    /// The server Personas owns for this project, if any.
    pub ours: Option<OwnedServer>,
    /// Our server answered HTTP on this pass.
    pub responds: bool,
    /// The pid owning the LISTEN socket on the project's port, if any.
    pub listener_pid: Option<u32>,
    /// Unix epoch seconds.
    pub now: i64,
}

/// Derive one row of the view.
pub fn derive_view(cfg: &DevServerConfig, dev_port: u16, obs: &Observed<'_>) -> DevServerView {
    let (state, error) = derive_state(cfg.dev_command.is_some(), obs);
    DevServerView {
        project_id: cfg.id.clone(),
        project_name: cfg.name.clone(),
        root_path: cfg.root_path.clone(),
        workspace_id: cfg.workspace_id.clone(),
        tech_stack: cfg.tech_stack.clone().filter(|t| !t.trim().is_empty()),
        dev_command: cfg.dev_command.clone(),
        dev_port,
        state,
        pid: obs.ours.map(|o| o.pid),
        external_pid: if state == DevServerState::External {
            obs.listener_pid
        } else {
            None
        },
        started_at: obs.ours.map(|o| o.started_at),
        url: format!("http://localhost:{dev_port}"),
        error,
    }
}

/// The state and, for `failed`, its reason.
fn derive_state(configured: bool, obs: &Observed<'_>) -> (DevServerState, Option<String>) {
    if obs.scanning {
        return (DevServerState::Scanning, None);
    }
    if obs.stopping {
        return (DevServerState::Stopping, None);
    }
    if let Some(reason) = obs.failure {
        return (DevServerState::Failed, Some(reason.to_string()));
    }
    if let Some(ours) = obs.ours {
        if obs.responds || ours.healthy_once {
            return (DevServerState::Running, None);
        }
        if obs.now.saturating_sub(ours.started_at) < STARTUP_GRACE_SECS {
            return (DevServerState::Starting, None);
        }
        return (
            DevServerState::Failed,
            Some(format!(
                "no HTTP answer on port {} within {STARTUP_GRACE_SECS} s",
                ours.port
            )),
        );
    }
    if obs.listener_pid.is_some() {
        return (DevServerState::External, None);
    }
    if !configured {
        return (DevServerState::Unconfigured, None);
    }
    (DevServerState::Stopped, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_800_000_000;

    fn cfg(command: Option<&str>) -> DevServerConfig {
        DevServerConfig {
            id: "p1".into(),
            name: "Shop".into(),
            root_path: "C:/repos/shop".into(),
            workspace_id: Some("ws".into()),
            tech_stack: Some("Next.js,React".into()),
            dev_command: command.map(str::to_string),
            dev_port: Some(3000),
        }
    }

    fn ours(started_at: i64, healthy_once: bool) -> OwnedServer {
        OwnedServer {
            pid: 4242,
            port: 3000,
            started_at,
            healthy_once,
            persistent: true,
        }
    }

    fn idle() -> Observed<'static> {
        Observed {
            scanning: false,
            stopping: false,
            failure: None,
            ours: None,
            responds: false,
            listener_pid: None,
            now: NOW,
        }
    }

    fn view(command: Option<&str>, obs: Observed<'_>) -> DevServerView {
        derive_view(&cfg(command), 3000, &obs)
    }

    #[test]
    fn scanning_wins_over_everything() {
        let v = view(
            None,
            Observed {
                scanning: true,
                stopping: true,
                failure: Some("x"),
                ours: Some(ours(NOW, true)),
                listener_pid: Some(9),
                ..idle()
            },
        );
        assert_eq!(v.state, DevServerState::Scanning);
        assert_eq!(v.error, None);
    }

    #[test]
    fn stopping_wins_over_a_failure_and_a_live_server() {
        let v = view(
            Some("npm run dev"),
            Observed {
                stopping: true,
                failure: Some("x"),
                ours: Some(ours(NOW, true)),
                ..idle()
            },
        );
        assert_eq!(v.state, DevServerState::Stopping);
        assert_eq!(v.pid, Some(4242));
    }

    #[test]
    fn a_recorded_failure_sticks_and_carries_its_reason() {
        let v = view(
            Some("npm run dev"),
            Observed {
                failure: Some("the server exited with code 1 before answering HTTP"),
                listener_pid: Some(77),
                ..idle()
            },
        );
        assert_eq!(v.state, DevServerState::Failed);
        assert_eq!(
            v.error.as_deref(),
            Some("the server exited with code 1 before answering HTTP")
        );
        // Not external: the failure row wins, and external_pid is only for
        // the external state.
        assert_eq!(v.external_pid, None);
    }

    #[test]
    fn ours_answering_is_running() {
        let v = view(
            Some("npm run dev"),
            Observed {
                ours: Some(ours(NOW - 5, false)),
                responds: true,
                ..idle()
            },
        );
        assert_eq!(v.state, DevServerState::Running);
        assert_eq!(v.pid, Some(4242));
        assert_eq!(v.started_at, Some(NOW - 5));
        assert_eq!(v.error, None);
    }

    #[test]
    fn ours_that_answered_before_stays_running_through_a_missed_probe() {
        let v = view(
            Some("npm run dev"),
            Observed {
                ours: Some(ours(NOW - 3_600, true)),
                responds: false,
                ..idle()
            },
        );
        assert_eq!(v.state, DevServerState::Running);
    }

    #[test]
    fn ours_not_yet_answering_within_the_grace_is_starting() {
        let v = view(
            Some("npm run dev"),
            Observed {
                ours: Some(ours(NOW - STARTUP_GRACE_SECS + 1, false)),
                ..idle()
            },
        );
        assert_eq!(v.state, DevServerState::Starting);
        assert_eq!(v.error, None);
    }

    #[test]
    fn ours_silent_past_the_grace_is_failed_with_a_reason() {
        let v = view(
            Some("npm run dev"),
            Observed {
                ours: Some(ours(NOW - STARTUP_GRACE_SECS, false)),
                ..idle()
            },
        );
        assert_eq!(v.state, DevServerState::Failed);
        assert_eq!(
            v.error.as_deref(),
            Some("no HTTP answer on port 3000 within 120 s")
        );
        assert_eq!(v.pid, Some(4242));
    }

    #[test]
    fn a_listener_we_did_not_start_is_external() {
        let v = view(
            Some("npm run dev"),
            Observed {
                listener_pid: Some(31_092),
                ..idle()
            },
        );
        assert_eq!(v.state, DevServerState::External);
        assert_eq!(v.external_pid, Some(31_092));
        assert_eq!(v.pid, None);
        assert_eq!(v.started_at, None);
    }

    #[test]
    fn external_is_reported_even_without_a_command() {
        let v = view(
            None,
            Observed {
                listener_pid: Some(5),
                ..idle()
            },
        );
        assert_eq!(v.state, DevServerState::External);
    }

    #[test]
    fn our_own_server_is_never_external() {
        // The LISTEN owner of our server is a descendant of the pid we hold
        // (cmd -> npm -> node), so the listener pid differs from ours. It is
        // still ours.
        let v = view(
            Some("npm run dev"),
            Observed {
                ours: Some(ours(NOW - 1, false)),
                listener_pid: Some(99_999),
                ..idle()
            },
        );
        assert_eq!(v.state, DevServerState::Starting);
        assert_eq!(v.external_pid, None);
    }

    #[test]
    fn no_command_is_unconfigured() {
        let v = view(None, idle());
        assert_eq!(v.state, DevServerState::Unconfigured);
        assert_eq!(v.dev_command, None);
    }

    #[test]
    fn otherwise_stopped_with_every_absent_value_null() {
        let v = view(Some("npm run dev"), idle());
        assert_eq!(v.state, DevServerState::Stopped);
        assert_eq!(v.pid, None);
        assert_eq!(v.external_pid, None);
        assert_eq!(v.started_at, None);
        assert_eq!(v.error, None);
        assert_eq!(v.url, "http://localhost:3000");
        assert_eq!(v.dev_port, 3000);
        assert_eq!(v.project_name, "Shop");
        assert_eq!(v.workspace_id.as_deref(), Some("ws"));
    }

    #[test]
    fn a_blank_tech_stack_is_null_not_empty() {
        let mut c = cfg(Some("npm run dev"));
        c.tech_stack = Some("  ".into());
        assert_eq!(derive_view(&c, 3000, &idle()).tech_stack, None);
    }
}
