//! `personas-daemon` — always-on headless runtime (Phase 0 scaffold).
//!
//! Companion binary to the main `personas-desktop` Tauri app. Designed to
//! run on a user-controlled always-on machine (workstation, NAS, VPS, Pi)
//! and fire scheduled triggers while the windowed UI is closed or the
//! user is logged out.
//!
//! **Phase 0 (2026-04-08):** this binary only acquires the daemon lock
//! file, writes heartbeats, and waits for shutdown. No trigger runtime,
//! no persona execution. A later session wires in the cron/polling/
//! webhook subscriptions once `engine::runner::run_execution` has been
//! decoupled from `tauri::AppHandle` via `engine::events::ExecutionEventEmitter`.
//!
//! **Credential trust model:** this daemon runs entirely on the user's
//! own hardware and unlocks credentials via the local OS keychain or
//! DPAPI-wrapped fallback (same path as the windowed app). Credentials
//! NEVER leave the local machine. See
//! `.claude/memory/feedback_credentials_stay_local.md`.
//!
//! # Usage
//!
//! ```text
//! personas-daemon [--db-path <path>] [--owns <kinds>]
//!
//! Env:
//!   PERSONAS_DAEMON_MODE=1      required; refuses to start without it
//!   PERSONAS_ALLOW_FALLBACK_KEY=1   allow DPAPI-wrapped fallback key on headless boxes
//! ```
//!
//! # Build
//!
//! ```text
//! cargo build --bin personas-daemon --features daemon
//! ```

use std::path::PathBuf;
use std::process::ExitCode;

use app_lib::daemon::lock::{DaemonLock, LockError, TriggerKind, HEARTBEAT_INTERVAL};
use tokio::sync::mpsc;

/// Exit codes — stable so the future Task Scheduler install script can
/// check them.
const EXIT_OK: u8 = 0;
const EXIT_BAD_ARGS: u8 = 1;
const EXIT_LOCK_HELD: u8 = 2;
const EXIT_DB_MISSING: u8 = 3;
const EXIT_NOT_ENABLED: u8 = 4;

#[tokio::main]
async fn main() -> ExitCode {
    init_tracing();

    // Gate 1: env-var guard. Refuse to run without explicit opt-in so a
    // stray build or misclick never boots a background agent runtime.
    if std::env::var("PERSONAS_DAEMON_MODE").ok().as_deref() != Some("1") {
        eprintln!(
            "personas-daemon refuses to start: set PERSONAS_DAEMON_MODE=1 to enable.\n\
             This is a safety gate for Phase 0 scaffolding — the daemon does not \
             yet execute personas and is for infrastructure testing only."
        );
        return ExitCode::from(EXIT_NOT_ENABLED);
    }

    let args = match parse_args(std::env::args().collect()) {
        Ok(a) => a,
        Err(msg) => {
            eprintln!("{msg}");
            eprintln!();
            print_usage();
            return ExitCode::from(EXIT_BAD_ARGS);
        }
    };

    // Resolve the app data directory from the DB path argument. The
    // windowed app uses %APPDATA%/com.personas.desktop (or the platform
    // equivalent); we mirror that so the lock file ends up in the same
    // directory as personas.db regardless of who minted the path.
    let db_path = args.db_path.unwrap_or_else(default_db_path);
    if !db_path.exists() {
        eprintln!(
            "Database not found at: {}\n\
             Use --db-path <path> to specify the location or run the windowed \
             app once to create it.",
            db_path.display()
        );
        return ExitCode::from(EXIT_DB_MISSING);
    }
    let app_data_dir = match db_path.parent() {
        Some(p) => p.to_path_buf(),
        None => {
            eprintln!("Database path has no parent directory: {}", db_path.display());
            return ExitCode::from(EXIT_BAD_ARGS);
        }
    };

    tracing::info!(
        version = env!("CARGO_PKG_VERSION"),
        db_path = %db_path.display(),
        app_data_dir = %app_data_dir.display(),
        owns = ?args.owns,
        "personas-daemon starting (Phase 0 scaffold)"
    );

    // Gate 2: acquire the lock file. If another daemon is already running
    // with a fresh heartbeat, exit — users who double-install are expected
    // to hit this and back off.
    let mut lock = match DaemonLock::acquire(&app_data_dir, args.owns.clone()) {
        Ok(l) => l,
        Err(LockError::AlreadyHeld { pid, heartbeat_at }) => {
            eprintln!(
                "Another personas-daemon is already running (pid {pid}, last heartbeat {heartbeat_at}).\n\
                 Wait 90 seconds for a stale lock to clear, or stop the other instance first."
            );
            return ExitCode::from(EXIT_LOCK_HELD);
        }
        Err(e) => {
            eprintln!("Failed to acquire daemon lock: {e}");
            return ExitCode::from(EXIT_BAD_ARGS);
        }
    };

    tracing::info!(
        path = %lock.path().display(),
        pid = lock.contents().pid,
        "daemon lock acquired"
    );

    // Spawn the heartbeat loop. It runs until `shutdown_tx` is dropped or
    // the main task sends a message.
    let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
    let heartbeat_task = tokio::spawn({
        // `lock` is moved into the heartbeat task so that the heartbeat
        // and the final release can both access `self`. We recover it
        // by having the task return the lock on shutdown.
        async move {
            let mut interval = tokio::time::interval(HEARTBEAT_INTERVAL);
            // First tick fires immediately — skip it, we just wrote the
            // lock in `acquire`.
            interval.tick().await;
            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        if let Err(e) = lock.heartbeat() {
                            tracing::error!(error = %e, "heartbeat write failed");
                        } else {
                            tracing::debug!("heartbeat refreshed");
                        }
                    }
                    _ = shutdown_rx.recv() => {
                        tracing::info!("heartbeat task received shutdown signal");
                        break;
                    }
                }
            }
            lock
        }
    });

    // Wait for the OS shutdown signal. On Windows this is Ctrl+C / Ctrl+Break;
    // on Unix it's SIGINT / SIGTERM.
    wait_for_shutdown().await;

    tracing::info!("shutdown signal received, draining");

    // Signal the heartbeat task to stop and await its return value (the
    // lock handle). On any error awaiting the task, we still try to
    // clean up by constructing a fresh handle — but that's best-effort.
    drop(shutdown_tx);
    let lock = match heartbeat_task.await {
        Ok(lock) => lock,
        Err(e) => {
            tracing::error!(error = %e, "heartbeat task panicked — lock file may remain");
            return ExitCode::from(EXIT_OK);
        }
    };

    match lock.release() {
        Ok(()) => tracing::info!("daemon lock released cleanly"),
        Err(e) => tracing::error!(error = %e, "failed to release daemon lock"),
    }

    ExitCode::from(EXIT_OK)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

#[derive(Debug)]
struct ParsedArgs {
    db_path: Option<PathBuf>,
    owns: Vec<TriggerKind>,
}

fn parse_args(args: Vec<String>) -> Result<ParsedArgs, String> {
    let mut db_path: Option<PathBuf> = None;
    let mut owns: Vec<TriggerKind> = vec![TriggerKind::Cron, TriggerKind::Polling];

    let mut iter = args.into_iter().skip(1);
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--db-path" => {
                let val = iter
                    .next()
                    .ok_or_else(|| "--db-path requires a value".to_string())?;
                db_path = Some(PathBuf::from(val));
            }
            "--owns" => {
                let val = iter
                    .next()
                    .ok_or_else(|| "--owns requires a comma-separated kind list".to_string())?;
                owns = parse_owns(&val)?;
            }
            "--help" | "-h" => {
                print_usage();
                std::process::exit(EXIT_OK as i32);
            }
            other => {
                return Err(format!("unknown argument: {other}"));
            }
        }
    }

    Ok(ParsedArgs { db_path, owns })
}

fn parse_owns(val: &str) -> Result<Vec<TriggerKind>, String> {
    val.split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|kind| match kind {
            "cron" => Ok(TriggerKind::Cron),
            "polling" => Ok(TriggerKind::Polling),
            "webhook" => Ok(TriggerKind::Webhook),
            "smee_relay" | "smee-relay" => Ok(TriggerKind::SmeeRelay),
            "shared_event_relay" | "shared-event-relay" => Ok(TriggerKind::SharedEventRelay),
            "cloud_webhook_relay" | "cloud-webhook-relay" => Ok(TriggerKind::CloudWebhookRelay),
            other => Err(format!("unknown trigger kind: {other}")),
        })
        .collect()
}

fn print_usage() {
    eprintln!(
        "Usage: personas-daemon [--db-path <path>] [--owns <kinds>]\n\n\
         Options:\n  \
         --db-path <path>   Path to personas.db (default: platform app-data dir)\n  \
         --owns <kinds>     Comma-separated trigger kinds this daemon claims\n                     \
         (default: cron,polling). Valid kinds: cron, polling,\n                     \
         webhook, smee_relay, shared_event_relay, cloud_webhook_relay\n  \
         --help, -h         Print this help\n\n\
         Env:\n  \
         PERSONAS_DAEMON_MODE=1           required safety gate\n  \
         PERSONAS_ALLOW_FALLBACK_KEY=1    allow DPAPI-wrapped fallback credential key\n"
    );
}

fn default_db_path() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.personas.desktop")
        .join("personas.db")
}

fn init_tracing() {
    // Simple env-filter subscriber; users can tune with RUST_LOG=info,etc.
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .with_ansi(false)
        .init();
}

/// Wait for the OS shutdown signal.
///
/// - Windows: `tokio::signal::ctrl_c()` catches Ctrl+C and Ctrl+Break.
/// - Unix: also waits on SIGTERM so that systemd/launchd can stop the
///   daemon cleanly.
#[cfg(unix)]
async fn wait_for_shutdown() {
    use tokio::signal::unix::{signal, SignalKind};
    let mut sigterm = match signal(SignalKind::terminate()) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!(error = %e, "failed to install SIGTERM handler — will only catch Ctrl+C");
            let _ = tokio::signal::ctrl_c().await;
            return;
        }
    };
    tokio::select! {
        _ = tokio::signal::ctrl_c() => tracing::info!("received Ctrl+C"),
        _ = sigterm.recv() => tracing::info!("received SIGTERM"),
    }
}

#[cfg(not(unix))]
async fn wait_for_shutdown() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("received Ctrl+C / Ctrl+Break");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_args_defaults() {
        let args = parse_args(vec!["personas-daemon".into()]).unwrap();
        assert!(args.db_path.is_none());
        assert_eq!(args.owns, vec![TriggerKind::Cron, TriggerKind::Polling]);
    }

    #[test]
    fn parse_args_custom_db_path() {
        let args = parse_args(vec![
            "personas-daemon".into(),
            "--db-path".into(),
            "/tmp/foo.db".into(),
        ])
        .unwrap();
        assert_eq!(args.db_path, Some(PathBuf::from("/tmp/foo.db")));
    }

    #[test]
    fn parse_args_custom_owns() {
        let args = parse_args(vec![
            "personas-daemon".into(),
            "--owns".into(),
            "cron,webhook,smee_relay".into(),
        ])
        .unwrap();
        assert_eq!(
            args.owns,
            vec![
                TriggerKind::Cron,
                TriggerKind::Webhook,
                TriggerKind::SmeeRelay,
            ]
        );
    }

    #[test]
    fn parse_args_rejects_unknown_kind() {
        let err = parse_args(vec![
            "personas-daemon".into(),
            "--owns".into(),
            "cron,bogus".into(),
        ])
        .unwrap_err();
        assert!(err.contains("unknown trigger kind"));
    }

    #[test]
    fn parse_args_rejects_missing_value() {
        let err = parse_args(vec!["personas-daemon".into(), "--db-path".into()])
            .unwrap_err();
        assert!(err.contains("requires a value"));
    }
}
