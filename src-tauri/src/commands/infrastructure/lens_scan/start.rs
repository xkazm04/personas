//! Starting a lens-scan run: `node <lens-scan>/scripts/drive.mjs ...` as a
//! light child of the app.
//!
//! `drive.mjs` is deterministic glue: it reads the store, decides which items
//! or features need a run and starts `claude -p` once per run. Personas points
//! that `claude` at its own `personas-run` shim (`LENS_SCAN_CLAUDE_BIN`), so
//! every session drive opens enters the fleet's ONE admission queue as origin
//! `lens_scan`, carrying `PERSONAS_RUN_LABEL` in its run label.
//!
//! The three actions map onto drive's verbs: `execute` -> `execute`,
//! `measure` -> `cover` (with `--features` when the person named some),
//! `propagate` -> `propagate` (lens-scan 1.7.0; `--ids` or `--standard` names
//! the landed upgrade). What this module never does: pass `--approve-proposed`
//! (approval is a person's `lens_scan_decide`, never a side effect of starting
//! a build).

use std::path::{Path, PathBuf};

use futures_util::FutureExt;
use personas_core::types::CliArgs;
use tokio::io::AsyncReadExt;

use super::tooling::{is_safe_token, plain, validate_ids, LensScanScripts};
use crate::db::models::{LensScanStartAction, LensScanStartRequest, LensScanStartResult};
use crate::engine::cli_process::CliProcessDriver;
use crate::error::AppError;

/// A lens id as drive accepts it: a safe token of sane length.
fn validate_lens(lens: &str) -> Result<(), AppError> {
    if is_safe_token(lens) && lens.len() <= 80 {
        Ok(())
    } else {
        Err(AppError::Validation(format!(
            "lens {lens:?} must match [A-Za-z0-9._:-]+ (80 characters at most)"
        )))
    }
}

/// A house standard line as drive accepts it (`house:<subject>/<line>`):
/// letters, digits and `. _ : / -`, not starting with `-`, 200 at most.
fn validate_standard(standard: &str) -> Result<(), AppError> {
    let ok = !standard.is_empty()
        && standard.len() <= 200
        && !standard.starts_with('-')
        && standard
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '/' | '-'));
    if ok {
        Ok(())
    } else {
        Err(AppError::Validation(format!(
            "standard {standard:?} must be a house line (house:<subject>/<line>)"
        )))
    }
}

/// The drive.mjs argv for a request: the verb and its flags. `execute` NEVER
/// carries `--approve-proposed`.
pub(super) fn drive_args(req: &LensScanStartRequest, root: &Path) -> Result<Vec<String>, AppError> {
    validate_lens(&req.lens)?;
    let root = root.to_string_lossy().into_owned();
    let verb = |v: &str| {
        vec![
            v.to_string(),
            "--lens".into(),
            req.lens.clone(),
            "--root".into(),
            root.clone(),
        ]
    };
    match req.action {
        LensScanStartAction::Execute => {
            if req.features.is_some() || req.standard.is_some() {
                return Err(AppError::Validation(
                    "execute takes a lens and optional ids; features and standard belong to measure and propagate".into(),
                ));
            }
            let mut args = verb("execute");
            if let Some(ids) = &req.ids {
                validate_ids(ids)?;
                args.push("--ids".into());
                args.push(ids.join(","));
            }
            Ok(args)
        }
        LensScanStartAction::Measure => {
            if req.ids.is_some() || req.standard.is_some() {
                return Err(AppError::Validation(
                    "measure takes a lens and optional features".into(),
                ));
            }
            let mut args = verb("cover");
            // absent or empty = every gap of the lens; named = exactly those, a re-measure
            if let Some(features) = req.features.as_ref().filter(|f| !f.is_empty()) {
                validate_ids(features)?;
                args.push("--features".into());
                args.push(features.join(","));
            }
            Ok(args)
        }
        LensScanStartAction::Propagate => {
            if req.features.is_some() {
                return Err(AppError::Validation(
                    "propagate takes a lens and the upgrade (ids or standard), not features".into(),
                ));
            }
            if req.ids.is_some() && req.standard.is_some() {
                return Err(AppError::Validation(
                    "propagate names its upgrade by ids or by standard, not both".into(),
                ));
            }
            // neither = every landed baseline-upgrade of the lens
            let mut args = verb("propagate");
            if let Some(ids) = &req.ids {
                validate_ids(ids)?;
                args.push("--ids".into());
                args.push(ids.join(","));
            }
            if let Some(standard) = &req.standard {
                validate_standard(standard)?;
                args.push("--standard".into());
                args.push(standard.clone());
            }
            Ok(args)
        }
    }
}

/// `scripts/fleet/personas-run.mjs`: beside the app's own sources in a dev
/// build (compile-time manifest dir), else found by walking up from the
/// running executable. A packaged build carries no `scripts/` directory, so
/// there it is a `NotFound` the card can show.
pub(super) fn find_shim() -> Result<PathBuf, AppError> {
    let rel = ["scripts", "fleet", "personas-run.mjs"];
    let join = |base: &Path| rel.iter().fold(base.to_path_buf(), |p, s| p.join(s));
    let from_manifest = Path::new(env!("CARGO_MANIFEST_DIR")).parent().map(join);
    if let Some(p) = from_manifest.filter(|p| p.is_file()) {
        return Ok(plain(&p));
    }
    if let Ok(exe) = std::env::current_exe() {
        for dir in exe.ancestors().skip(1).take(8) {
            let candidate = join(dir);
            if candidate.is_file() {
                return Ok(plain(&candidate));
            }
        }
    }
    Err(AppError::NotFound(
        "the personas-run shim (scripts/fleet/personas-run.mjs) was not found beside this build"
            .into(),
    ))
}

/// The command line as a person would read it in the dock console.
fn display_command(argv: &[String]) -> String {
    let quote = |s: &str| {
        if s.is_empty() || s.contains([' ', '\t', '"']) {
            format!("\"{}\"", s.replace('"', "\\\""))
        } else {
            s.to_string()
        }
    };
    argv.iter().map(|a| quote(a)).collect::<Vec<_>>().join(" ")
}

/// The environment drive runs in: the CLI allowlist `spawn_scrubbed` keeps, plus
/// the three variables that hand its sessions to the fleet.
fn drive_env(shim: &Path, label: &str) -> Vec<(String, String)> {
    let mut env = vec![
        (
            "LENS_SCAN_CLAUDE_BIN".to_string(),
            shim.to_string_lossy().into_owned(),
        ),
        ("PERSONAS_RUN_ORIGIN".to_string(), "lens_scan".to_string()),
        ("PERSONAS_RUN_LABEL".to_string(), label.to_string()),
    ];
    // An isolated instance (its own data dir) hands runs to itself, not to the
    // operator's app.
    if let Ok(dir) = std::env::var("PERSONAS_DATA_DIR") {
        env.push(("PERSONAS_DATA_DIR".to_string(), dir));
    }
    env
}

/// Start drive for a product and return at once. The child is owned by a
/// watcher task that drains its stdout (a one-line JSON summary), reaps it and
/// logs the outcome; a panic in that task is logged, not lost. The task holds
/// the driver, and the driver kills the child on drop, so drive ends with the
/// app (its sessions end with their own fleet cancellation).
pub(super) async fn start_drive(
    scripts: &LensScanScripts,
    root: &Path,
    req: &LensScanStartRequest,
) -> Result<LensScanStartResult, AppError> {
    let tail = drive_args(req, root)?;
    let shim = find_shim()?;
    let drive = scripts.drive();
    if !drive.is_file() {
        return Err(AppError::NotFound(format!(
            "lens-scan has no drive.mjs at {}",
            drive.display()
        )));
    }
    let label = format!("personas:{}", uuid::Uuid::new_v4());
    let mut argv = vec![drive.to_string_lossy().into_owned()];
    argv.extend(tail);
    let command = display_command(&[vec!["node".to_string()], argv.clone()].concat());
    let cli = CliArgs {
        command: "node".to_string(),
        args: argv,
        env_overrides: drive_env(&shim, &label),
        env_removals: Vec::new(),
        cwd: Some(root.to_path_buf()),
    };
    let mut driver = CliProcessDriver::spawn_scrubbed(&cli, root.to_path_buf())
        .map_err(|e| AppError::ProcessSpawn(format!("node drive.mjs: {e}")))?;
    let pid = driver.pid().ok_or_else(|| {
        AppError::ProcessSpawn("node drive.mjs exited before it had a pid".into())
    })?;
    // drive reads no stdin.
    driver.close_stdin().await;
    let watched = label.clone();
    let action = format!("{:?}", req.action).to_lowercase();
    tauri::async_runtime::spawn(async move {
        let outcome = std::panic::AssertUnwindSafe(watch(driver, &watched, &action))
            .catch_unwind()
            .await;
        if outcome.is_err() {
            tracing::error!(label = %watched, "lens-scan: the drive watcher panicked");
        }
    });
    Ok(LensScanStartResult {
        label,
        command,
        pid,
    })
}

/// Drain drive's stdout (bounded), wait for it, log how it ended.
async fn watch(mut driver: CliProcessDriver, label: &str, action: &str) {
    let mut summary = String::new();
    if let Some(mut out) = driver.child.stdout.take() {
        let mut buf = Vec::new();
        // The summary is one JSON object; 1 MiB is far more than it ever is.
        let _ = (&mut out).take(1024 * 1024).read_to_end(&mut buf).await;
        summary = String::from_utf8_lossy(&buf).into_owned();
    }
    let ok = match driver.wait().await {
        Ok(status) => status.success(),
        Err(e) => {
            tracing::warn!(label, action, error = %e, "lens-scan: waiting for drive failed");
            false
        }
    };
    tracing::info!(
        label,
        action,
        ok,
        summary_bytes = summary.len(),
        "lens-scan: drive finished"
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(action: LensScanStartAction) -> LensScanStartRequest {
        LensScanStartRequest {
            action,
            lens: "design".into(),
            ids: None,
            features: None,
            standard: None,
        }
    }

    #[test]
    fn execute_never_passes_approve_proposed_and_carries_ids() {
        let root = Path::new("C:/repo");
        let mut r = req(LensScanStartAction::Execute);
        r.ids = Some(vec!["a1".into(), "b2".into()]);
        let args = drive_args(&r, root).unwrap();
        assert_eq!(
            args,
            ["execute", "--lens", "design", "--root", "C:/repo", "--ids", "a1,b2"]
        );
        for action in [LensScanStartAction::Execute, LensScanStartAction::Measure] {
            let args = drive_args(&req(action), root).unwrap();
            assert!(!args.iter().any(|a| a.contains("approve")), "{args:?}");
        }
    }

    #[test]
    fn measure_maps_to_cover_with_the_named_features() {
        let root = Path::new("/repo");
        assert_eq!(
            drive_args(&req(LensScanStartAction::Measure), root).unwrap(),
            ["cover", "--lens", "design", "--root", "/repo"]
        );
        let mut r = req(LensScanStartAction::Measure);
        r.features = Some(vec!["login".into(), "invoice-ocr".into()]);
        assert_eq!(
            drive_args(&r, root).unwrap(),
            [
                "cover",
                "--lens",
                "design",
                "--root",
                "/repo",
                "--features",
                "login,invoice-ocr"
            ]
        );
        // an empty list is "every gap", as absent
        r.features = Some(vec![]);
        assert_eq!(drive_args(&r, root).unwrap().len(), 5);
        r.features = Some(vec!["--root".into()]);
        assert!(drive_args(&r, root).is_err());
        r.features = None;
        r.standard = Some("house:x/y".into());
        assert!(drive_args(&r, root).is_err());
    }

    #[test]
    fn propagate_maps_to_drive_propagate_naming_the_upgrade_one_way() {
        let root = Path::new("/repo");
        assert_eq!(
            drive_args(&req(LensScanStartAction::Propagate), root).unwrap(),
            ["propagate", "--lens", "design", "--root", "/repo"]
        );
        let mut p = req(LensScanStartAction::Propagate);
        p.standard = Some("house:table/sticky-head".into());
        assert_eq!(
            drive_args(&p, root).unwrap(),
            [
                "propagate",
                "--lens",
                "design",
                "--root",
                "/repo",
                "--standard",
                "house:table/sticky-head"
            ]
        );
        p.ids = Some(vec!["p-1a2b3c".into()]);
        assert!(
            matches!(drive_args(&p, root), Err(AppError::Validation(m)) if m.contains("not both"))
        );
        p.standard = None;
        assert_eq!(
            drive_args(&p, root).unwrap(),
            [
                "propagate",
                "--lens",
                "design",
                "--root",
                "/repo",
                "--ids",
                "p-1a2b3c"
            ]
        );
        for bad in ["", "-x", "house:x;rm", "house:a b"] {
            let mut q = req(LensScanStartAction::Propagate);
            q.standard = Some(bad.into());
            assert!(drive_args(&q, root).is_err(), "{bad:?}");
        }
        let mut f = req(LensScanStartAction::Propagate);
        f.features = Some(vec!["login".into()]);
        assert!(drive_args(&f, root).is_err());
    }

    #[test]
    fn lens_and_ids_are_validated_before_anything_is_spawned() {
        let root = Path::new("/repo");
        for lens in ["", "-x", "a b", "a;b", "--root"] {
            let mut r = req(LensScanStartAction::Measure);
            r.lens = lens.into();
            assert!(drive_args(&r, root).is_err(), "{lens:?}");
        }
        let mut r = req(LensScanStartAction::Execute);
        r.lens = "com.xkazm04.registry".into();
        r.ids = Some(vec!["-x".into()]);
        assert!(drive_args(&r, root).is_err());
        r.ids = Some(vec![]);
        assert!(drive_args(&r, root).is_err());
    }

    #[test]
    fn the_command_line_is_displayed_with_quoting_and_the_env_hands_runs_to_the_fleet() {
        assert_eq!(
            display_command(&["node".into(), "C:/a b/drive.mjs".into(), "cover".into()]),
            "node \"C:/a b/drive.mjs\" cover"
        );
        let env = drive_env(Path::new("C:/x/personas-run.mjs"), "personas:1");
        let get = |k: &str| env.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_str());
        assert_eq!(get("LENS_SCAN_CLAUDE_BIN"), Some("C:/x/personas-run.mjs"));
        assert_eq!(get("PERSONAS_RUN_ORIGIN"), Some("lens_scan"));
        assert_eq!(get("PERSONAS_RUN_LABEL"), Some("personas:1"));
    }

    #[test]
    fn the_shim_is_found_beside_the_sources_in_a_dev_build() {
        let shim = find_shim().unwrap();
        assert!(shim.is_file() && shim.ends_with("personas-run.mjs"));
    }
}
