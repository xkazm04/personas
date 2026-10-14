//! Scheduled tasks the operator owns - the Supply deck's "don't forget" plate.
//!
//! Lists every Windows Task Scheduler task in the `\Personas\` folder and switches one on or
//! off. The folder IS the scope: any job Personas tooling schedules lands there (today the
//! `/curator --multi` night) and appears on the plate with no name hard-coded here, and a name
//! outside it can never be toggled from the app.
//!
//! Read through PowerShell (`Get-ScheduledTask` + `Get-ScheduledTaskInfo`) as JSON with the
//! times converted to UTC epoch milliseconds INSIDE the script: `schtasks /Query` prints dates
//! in the machine's locale format ("10/13/2026 11:00:00 PM" on en-US, something else on cs-CZ),
//! which is not a contract. The child runs `no_window()`: a plate that polls every 30 s must
//! not flash a console on the desktop.
//!
//! A task's `Description` carries what the plate shows: `<title>|<window>`, e.g.
//! `Curator night|23:00-07:00`. A description without `|` is shown whole as the title.
//! Off Windows there is no Task Scheduler: the list is empty and the plate does not render.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;
use ts_rs::TS;

use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// The Task Scheduler folder whose tasks are the operator's.
pub const TASK_FOLDER: &str = "\\Personas\\";

/// One scheduled task, as the plate draws it.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskView {
    /// The task's name inside `\Personas\` - the id the toggle takes.
    pub name: String,
    /// Human title from the description, else the name.
    pub title: String,
    /// The working window the task declares (`23:00-07:00`), when it declares one.
    pub window: Option<String>,
    pub enabled: bool,
    /// Task Scheduler's state: `Ready`, `Running`, `Disabled`, `Queued`.
    pub state: String,
    /// Next start, UTC epoch milliseconds; `None` when disabled or unscheduled.
    #[ts(type = "number | null")]
    pub next_run_ms: Option<i64>,
    /// Last start, UTC epoch milliseconds; `None` when it never ran.
    #[ts(type = "number | null")]
    pub last_run_ms: Option<i64>,
    /// The last run's result code (0 is success); `None` when it never ran.
    #[ts(type = "number | null")]
    pub last_result: Option<i64>,
}

/// The raw row the PowerShell script prints.
#[derive(Debug, Deserialize)]
struct RawTask {
    name: String,
    description: Option<String>,
    state: String,
    next: Option<i64>,
    last: Option<i64>,
    result: Option<i64>,
}

/// Task Scheduler reports "never ran" as a 1999-11-30 last-run time; anything before 2001 is that.
const NEVER_RAN_BEFORE_MS: i64 = 978_307_200_000;

const LIST_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$tasks = @(Get-ScheduledTask -TaskPath '\Personas\' -ErrorAction SilentlyContinue)
$rows = foreach ($t in $tasks) {
  $i = $t | Get-ScheduledTaskInfo
  $ms = { param($d) if ($d) { ([DateTimeOffset]$d).ToUnixTimeMilliseconds() } else { $null } }
  [pscustomobject]@{
    name = $t.TaskName; description = $t.Description; state = [string]$t.State
    next = (& $ms $i.NextRunTime); last = (& $ms $i.LastRunTime); result = $i.LastTaskResult
  }
}
ConvertTo-Json -InputObject @($rows) -Compress -Depth 3
"#;

const TOGGLE_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$name = $env:PERSONAS_SCHEDULED_TASK
if ($env:PERSONAS_SCHEDULED_ENABLE -eq '1') {
  Enable-ScheduledTask -TaskPath '\Personas\' -TaskName $name | Out-Null
} else {
  Disable-ScheduledTask -TaskPath '\Personas\' -TaskName $name | Out-Null
}
"#;

fn to_view(raw: RawTask) -> ScheduledTaskView {
    let (title, window) = match raw.description.as_deref().map(str::trim) {
        Some(d) if !d.is_empty() => match d.split_once('|') {
            Some((t, w)) => (
                t.trim().to_string(),
                Some(w.trim().to_string()).filter(|w| !w.is_empty()),
            ),
            None => (d.to_string(), None),
        },
        _ => (raw.name.clone(), None),
    };
    ScheduledTaskView {
        enabled: raw.state != "Disabled",
        next_run_ms: raw.next,
        last_run_ms: raw.last.filter(|&ms| ms >= NEVER_RAN_BEFORE_MS),
        last_result: raw
            .last
            .filter(|&ms| ms >= NEVER_RAN_BEFORE_MS)
            .and(raw.result),
        name: raw.name,
        title,
        window,
        state: raw.state,
    }
}

/// A task name the toggle may pass to PowerShell: what Task Scheduler names look like, and
/// nothing that could be read as script.
fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '-' | '_' | '.'))
}

/// How long one Task Scheduler call may take. A cold PowerShell start plus the ScheduledTasks
/// module import is ~1-2 s; anything near this is a hung shell, not a slow one.
const TASK_SCHEDULER_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

/// Run a script through the subprocess chokepoint (`capture_output`): argv as an array, a
/// chosen environment rather than the app's (no tokens reach PowerShell), no console window,
/// both pipes drained, killed on timeout. `env` carries the script's only inputs.
async fn powershell(script: &str, env: &[(&str, &str)]) -> Result<String, AppError> {
    use personas_core::types::CliArgs;
    let cli_args = CliArgs {
        command: "powershell.exe".into(),
        args: [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ]
        .iter()
        .map(|a| (*a).to_string())
        .collect(),
        env_overrides: env
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect(),
        env_removals: Vec::new(),
        cwd: Some(std::env::temp_dir()),
    };
    let out = crate::engine::cli_process::capture_output(&cli_args, TASK_SCHEDULER_TIMEOUT)
        .await
        .map_err(|e| AppError::Execution(format!("Task Scheduler: {e}")))?;
    if !out.status.success() {
        return Err(AppError::Execution(format!(
            "Task Scheduler: {}",
            out.stderr.trim()
        )));
    }
    Ok(out.stdout)
}

/// Every task in `\Personas\`. Empty off Windows, and empty when the folder does not exist.
pub async fn list_tasks() -> Result<Vec<ScheduledTaskView>, AppError> {
    if !cfg!(windows) {
        return Ok(Vec::new());
    }
    let stdout = powershell(LIST_SCRIPT, &[]).await?;
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let rows: Vec<RawTask> = serde_json::from_str(trimmed)?;
    let mut views: Vec<ScheduledTaskView> = rows.into_iter().map(to_view).collect();
    views.sort_by_key(|v| v.title.to_lowercase());
    Ok(views)
}

/// The operator's scheduled tasks (the `\Personas\` Task Scheduler folder).
#[tauri::command]
pub async fn fleet_scheduled_tasks(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ScheduledTaskView>, AppError> {
    require_auth(&state).await?;
    list_tasks().await
}

/// Switch one of the operator's scheduled tasks on or off; returns the refreshed list.
/// Only a name the `\Personas\` listing holds is accepted.
#[tauri::command]
pub async fn fleet_scheduled_task_set_enabled(
    state: State<'_, Arc<AppState>>,
    name: String,
    enabled: bool,
) -> Result<Vec<ScheduledTaskView>, AppError> {
    require_auth(&state).await?;
    if !cfg!(windows) {
        return Err(AppError::Validation(
            "scheduled tasks exist only on Windows".into(),
        ));
    }
    if !valid_name(&name) || !list_tasks().await?.iter().any(|t| t.name == name) {
        return Err(AppError::NotFound(format!(
            "no scheduled task {name:?} in {TASK_FOLDER}"
        )));
    }
    powershell(
        TOGGLE_SCRIPT,
        &[
            ("PERSONAS_SCHEDULED_TASK", &name),
            ("PERSONAS_SCHEDULED_ENABLE", if enabled { "1" } else { "0" }),
        ],
    )
    .await?;
    list_tasks().await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(description: Option<&str>, state: &str, last: Option<i64>) -> RawTask {
        RawTask {
            name: "CuratorNight".into(),
            description: description.map(str::to_string),
            state: state.into(),
            next: Some(1_760_389_200_000),
            last,
            result: Some(0),
        }
    }

    #[test]
    fn description_carries_title_and_window() {
        let v = to_view(raw(Some("Curator night|23:00-07:00"), "Ready", None));
        assert_eq!(v.title, "Curator night");
        assert_eq!(v.window.as_deref(), Some("23:00-07:00"));
        assert!(v.enabled);
    }

    #[test]
    fn no_description_falls_back_to_the_name() {
        let v = to_view(raw(None, "Disabled", None));
        assert_eq!(v.title, "CuratorNight");
        assert!(v.window.is_none());
        assert!(!v.enabled);
    }

    #[test]
    fn the_never_ran_sentinel_is_no_last_run() {
        let v = to_view(raw(Some("x"), "Ready", Some(943_920_000_000))); // 1999-11-30
        assert!(v.last_run_ms.is_none());
        assert!(v.last_result.is_none());
        let ran = to_view(raw(Some("x"), "Ready", Some(1_760_300_000_000)));
        assert_eq!(ran.last_result, Some(0));
    }

    #[test]
    fn a_name_that_could_be_script_is_refused() {
        assert!(valid_name("CuratorNight"));
        assert!(!valid_name("x'; Remove-Item C:\\ -Recurse; '"));
        assert!(!valid_name(""));
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn the_live_listing_parses() {
        // Whatever this machine holds in \Personas\, the script's JSON must parse - under the
        // chokepoint's cleared environment, which is where a missing PSModulePath would bite.
        let tasks = list_tasks().await.expect("Task Scheduler listing parses");
        // And where schtasks itself sees the curator night, the listing must carry it whole.
        let probe = crate::engine::cli_process::capture_output(
            &personas_core::types::CliArgs {
                command: "schtasks".into(),
                args: vec![
                    "/Query".into(),
                    "/TN".into(),
                    "\\Personas\\CuratorNight".into(),
                ],
                env_overrides: Vec::new(),
                env_removals: Vec::new(),
                cwd: None,
            },
            TASK_SCHEDULER_TIMEOUT,
        )
        .await;
        if matches!(&probe, Ok(o) if o.status.success()) {
            let night = tasks
                .iter()
                .find(|t| t.name == "CuratorNight")
                .expect("listed");
            assert_eq!(night.title, "Curator night");
            assert!(night.window.is_some());
        }
    }
}
