//! `StandupReport` builder ("Since last standup") and the
//! `companion_standup_event` writer. WP3 owns.
//!
//! The ledger is append-only: every away act (sweep, drift note, delegated or
//! parked ask, dispatch, backfill, agent create / retune, push, stop) is ONE
//! row, written through [`append_event`] by whichever package acted. The
//! report is composed from that ledger plus two live reads - the project's
//! git history since `armed_at` and the fleet's running sessions - and
//! nothing else, so what the operator reads is what the ledger holds.
//!
//! # Detail keys the report reads (`detail_json`, always an object)
//!
//! - `ask_parked`: `options: string[]`, and `resolve: {kind, id}` where kind
//!   is [`RESOLVE_APPROVAL`] (a `companion_approval` row; resolved once it is
//!   no longer `pending`), [`RESOLVE_WORKER`] (a fleet MCP request; resolved
//!   once it is no longer pending) or [`RESOLVE_STANDUP`] (no card: open until
//!   the standup ends). A parked ask without `resolve` stays open.
//! - `agent_created`: `personaId`, `name`, and `away: bool` (or
//!   `origin: "standup-away"`, which reads as away). WP1's go-gate creates
//!   write `away: false`.
//!
//! A parked ask with no `project_id` is listed under the project id
//! [`UNSCOPED_PROJECT_ID`]: the contract carries parked asks per project only,
//! and an approval Athena filed outside any project must still reach the
//! operator.

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};

use crate::db::{DbPool, UserDbPool};
use crate::error::AppError;

use super::away_rules::{RESOLVE_APPROVAL, RESOLVE_STANDUP, RESOLVE_WORKER};
use super::model::{
    AwayRules, CreatedAgentRef, MovedCommit, ParkedAsk, StandupEvent, StandupEventKind,
    StandupItemKind, StandupItemState, StandupPlan, StandupProjectReport, StandupReport,
    StandupStatus,
};

/// The project id a project-less parked ask is listed under.
pub const UNSCOPED_PROJECT_ID: &str = "unscoped";

/// At most this many commits per project in one report.
pub const MOVED_COMMITS_CAP: usize = 50;

// ---------------------------------------------------------------------------
// The event ledger
// ---------------------------------------------------------------------------

const EVENT_COLUMNS: &str = "id, standup_id, at, kind, project_id, summary, detail_json";

struct EventRow {
    id: String,
    standup_id: String,
    at: i64,
    kind: String,
    project_id: Option<String>,
    summary: String,
    detail_json: Option<String>,
}

personas_db::row_mapper!(row_to_event -> EventRow {
    id, standup_id, at, kind, project_id, summary, detail_json,
});

impl EventRow {
    fn into_event(self) -> Result<StandupEvent, AppError> {
        let kind: StandupEventKind =
            serde_json::from_value(serde_json::Value::String(self.kind.clone())).map_err(|e| {
                AppError::Internal(format!(
                    "companion_standup_event {}: unknown kind `{}`: {e}",
                    self.id, self.kind
                ))
            })?;
        let detail = match self.detail_json.as_deref() {
            None => None,
            Some(raw) => Some(serde_json::from_str(raw).map_err(|e| {
                AppError::Internal(format!(
                    "companion_standup_event {}: detail_json is not JSON: {e}",
                    self.id
                ))
            })?),
        };
        Ok(StandupEvent {
            id: self.id,
            standup_id: self.standup_id,
            at: self.at,
            kind,
            project_id: self.project_id,
            summary: self.summary,
            detail,
        })
    }
}

/// A fresh `companion_standup_event.id`.
pub fn new_event_id() -> String {
    format!("sev_{}", uuid::Uuid::new_v4().simple())
}

/// The snake_case token of an event kind (its serde form, the SQL CHECK set).
pub fn kind_token(kind: StandupEventKind) -> &'static str {
    match kind {
        StandupEventKind::Sweep => "sweep",
        StandupEventKind::Drift => "drift",
        StandupEventKind::AskDelegated => "ask_delegated",
        StandupEventKind::AskParked => "ask_parked",
        StandupEventKind::Dispatch => "dispatch",
        StandupEventKind::Backfill => "backfill",
        StandupEventKind::AgentCreated => "agent_created",
        StandupEventKind::AgentRetuned => "agent_retuned",
        StandupEventKind::Push => "push",
        StandupEventKind::Stop => "stop",
    }
}

/// Append one away act to `companion_standup_event` (append-only).
///
/// Cross-package seam frozen by the Director before the WP1-WP3 fan-out:
/// WP3 implements it; WP1 (arm/dispatch events) and WP2 (backfill events)
/// call it.
///
/// Refuses (`Validation`) an empty id / standup id / summary and a `detail`
/// that is not a JSON object; a duplicate id is a `Database` error, never a
/// silent overwrite.
pub fn append_event(pool: &UserDbPool, event: &StandupEvent) -> Result<(), AppError> {
    personas_core::validation::require_non_empty("standup event id", &event.id)?;
    personas_core::validation::require_non_empty("standup event standup_id", &event.standup_id)?;
    personas_core::validation::require_non_empty("standup event summary", &event.summary)?;
    let detail_json = match &event.detail {
        None => None,
        Some(v) if v.is_object() => Some(v.to_string()),
        Some(_) => {
            return Err(AppError::Validation(
                "standup event: detail must be a JSON object".into(),
            ))
        }
    };
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO companion_standup_event
           (id, standup_id, at, kind, project_id, summary, detail_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            event.id,
            event.standup_id,
            event.at,
            kind_token(event.kind),
            event.project_id,
            event.summary,
            detail_json,
        ],
    )?;
    Ok(())
}

/// A standup's away acts, newest first, at most `limit` (clamped 1..=500).
/// The body of WP1's `standup_events` command.
pub fn list_events(
    pool: &UserDbPool,
    standup_id: &str,
    limit: i32,
) -> Result<Vec<StandupEvent>, AppError> {
    let limit = limit.clamp(1, 500);
    let conn = pool.get()?;
    let sql = format!(
        "SELECT {EVENT_COLUMNS} FROM companion_standup_event
         WHERE standup_id = ?1 ORDER BY at DESC, id DESC LIMIT ?2"
    );
    let mut stmt = conn.prepare_cached(&sql)?;
    let rows = stmt
        .query_map(rusqlite::params![standup_id, limit], row_to_event)?
        .collect::<Result<Vec<_>, _>>()?;
    rows.into_iter().map(EventRow::into_event).collect()
}

/// Every event of a standup, oldest first (the report's input; bounded by
/// what one armed window can produce).
fn all_events(pool: &UserDbPool, standup_id: &str) -> Result<Vec<StandupEvent>, AppError> {
    let conn = pool.get()?;
    let sql = format!(
        "SELECT {EVENT_COLUMNS} FROM companion_standup_event
         WHERE standup_id = ?1 ORDER BY at ASC, id ASC LIMIT 5000"
    );
    let mut stmt = conn.prepare_cached(&sql)?;
    let rows = stmt
        .query_map(rusqlite::params![standup_id], row_to_event)?
        .collect::<Result<Vec<_>, _>>()?;
    rows.into_iter().map(EventRow::into_event).collect()
}

/// When the newest event of `kind` was written for a standup, if ever.
pub fn last_event_at(
    pool: &UserDbPool,
    standup_id: &str,
    kind: StandupEventKind,
) -> Result<Option<i64>, AppError> {
    let conn = pool.get()?;
    let at: Option<i64> = conn.query_row(
        "SELECT MAX(at) AS at FROM companion_standup_event WHERE standup_id = ?1 AND kind = ?2",
        rusqlite::params![standup_id, kind_token(kind)],
        |r| r.get("at"),
    )?;
    Ok(at)
}

// ---------------------------------------------------------------------------
// The standup head (read-only; WP1's plan.rs owns the writes)
// ---------------------------------------------------------------------------

/// The parts of a `companion_standup` row the supervisor and the report read.
#[derive(Debug, Clone, PartialEq)]
pub struct StandupHead {
    pub id: String,
    pub revision: i32,
    pub status: StandupStatus,
    pub opened_at: i64,
    pub armed_at: Option<i64>,
    pub plan: StandupPlan,
    pub away_rules: AwayRules,
}

const HEAD_COLUMNS: &str = "id, revision, status, opened_at, armed_at, plan_json, away_rules_json";

struct HeadRow {
    id: String,
    revision: i32,
    status: String,
    opened_at: i64,
    armed_at: Option<i64>,
    plan_json: String,
    away_rules_json: String,
}

personas_db::row_mapper!(row_to_head -> HeadRow {
    id, revision, status, opened_at, armed_at, plan_json, away_rules_json,
});

impl HeadRow {
    fn into_head(self) -> Result<StandupHead, AppError> {
        let bad = |what: &str, e: serde_json::Error| {
            AppError::Internal(format!("companion_standup {}: {what}: {e}", self.id))
        };
        let status: StandupStatus =
            serde_json::from_value(serde_json::Value::String(self.status.clone()))
                .map_err(|e| bad("status", e))?;
        let plan: StandupPlan =
            serde_json::from_str(&self.plan_json).map_err(|e| bad("plan_json", e))?;
        let away_rules: AwayRules =
            serde_json::from_str(&self.away_rules_json).map_err(|e| bad("away_rules_json", e))?;
        Ok(StandupHead {
            id: self.id,
            revision: self.revision,
            status,
            opened_at: self.opened_at,
            armed_at: self.armed_at,
            plan,
            away_rules,
        })
    }
}

/// The ARMED revision, if one is live (the newest by `armed_at` should two
/// ever be armed at once).
pub fn armed(pool: &UserDbPool) -> Result<Option<StandupHead>, AppError> {
    let conn = pool.get()?;
    let sql = format!(
        "SELECT {HEAD_COLUMNS} FROM companion_standup
         WHERE status = 'armed' ORDER BY armed_at DESC, revision DESC LIMIT 1"
    );
    let mut stmt = conn.prepare_cached(&sql)?;
    let mut rows = stmt.query_map([], row_to_head)?;
    match rows.next() {
        None => Ok(None),
        Some(row) => row?.into_head().map(Some),
    }
}

/// One revision by id.
pub fn head(pool: &UserDbPool, standup_id: &str) -> Result<Option<StandupHead>, AppError> {
    let conn = pool.get()?;
    let sql = format!("SELECT {HEAD_COLUMNS} FROM companion_standup WHERE id = ?1");
    let mut stmt = conn.prepare_cached(&sql)?;
    let mut rows = stmt.query_map(rusqlite::params![standup_id], row_to_head)?;
    match rows.next() {
        None => Ok(None),
        Some(row) => row?.into_head().map(Some),
    }
}

/// The projects a revision drives: every project an accepted or edited item
/// names, in plan order.
pub fn armed_projects(plan: &StandupPlan) -> Vec<String> {
    let mut seen = BTreeSet::new();
    plan.items
        .iter()
        .filter(|i| {
            matches!(
                i.state,
                StandupItemState::Accepted | StandupItemState::Edited
            )
        })
        .filter_map(|i| i.project_id.as_deref().map(str::trim))
        .filter(|p| !p.is_empty())
        .filter(|p| seen.insert(p.to_string()))
        .map(str::to_string)
        .collect()
}

// ---------------------------------------------------------------------------
// Projects -> repo roots
// ---------------------------------------------------------------------------

/// A registered project and its repository root.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectRoot {
    pub id: String,
    pub root: PathBuf,
}

/// Every registered project with a root: the Dev Tools projects (system DB)
/// first, then Athena's own registry (`companion_known_project`, user DB).
/// The two registries mint different ids; a plan item may name either, so
/// both are searched. A registry that fails to read is logged and skipped,
/// never fatal to a report.
pub fn project_roots(user_db: &UserDbPool, sys_db: &DbPool) -> Vec<ProjectRoot> {
    let mut out: Vec<ProjectRoot> = Vec::new();
    match crate::db::repos::dev_tools::list_projects(sys_db, None) {
        Ok(projects) => out.extend(
            projects
                .into_iter()
                .filter(|p| !p.root_path.trim().is_empty())
                .map(|p| ProjectRoot {
                    id: p.id,
                    root: PathBuf::from(p.root_path.trim()),
                }),
        ),
        Err(e) => tracing::warn!(error = %e, "standup: dev projects unreadable"),
    }
    extend_known_roots(user_db, &mut out);
    out
}

/// Athena's own project registry only (`companion_known_project`): what a
/// caller holding just the user DB can resolve.
#[cfg(test)]
pub fn known_project_roots(user_db: &UserDbPool) -> Vec<ProjectRoot> {
    let mut out = Vec::new();
    extend_known_roots(user_db, &mut out);
    out
}

fn extend_known_roots(user_db: &UserDbPool, out: &mut Vec<ProjectRoot>) {
    match crate::companion::projects::list(user_db) {
        Ok(projects) => {
            for p in projects {
                if p.path.trim().is_empty() || out.iter().any(|r| r.id == p.id) {
                    continue;
                }
                out.push(ProjectRoot {
                    id: p.id,
                    root: PathBuf::from(p.path.trim()),
                });
            }
        }
        Err(e) => tracing::warn!(error = %e, "standup: known projects unreadable"),
    }
}

fn norm_path(p: &str) -> String {
    p.trim()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_ascii_lowercase()
}

/// The project whose root contains `cwd` (the longest root wins).
pub fn project_for_cwd<'a>(roots: &'a [ProjectRoot], cwd: &str) -> Option<&'a str> {
    let cwd = norm_path(cwd);
    if cwd.is_empty() {
        return None;
    }
    roots
        .iter()
        .filter_map(|r| {
            let root = norm_path(&r.root.to_string_lossy());
            let inside = !root.is_empty() && (cwd == root || cwd.starts_with(&format!("{root}/")));
            inside.then_some((root.len(), r.id.as_str()))
        })
        .max_by_key(|(len, _)| *len)
        .map(|(_, id)| id)
}

/// The commits that landed on the project's main branch since `since_ms`,
/// newest first, at most `limit`. `Err` when the root is no repository or
/// git cannot answer. Blocking (one `git log`).
pub fn moved_commits(root: &Path, since_ms: i64, limit: usize) -> Result<Vec<MovedCommit>, String> {
    let base = crate::lifecycle::evidence::resolve_base(root, None)
        .ok_or_else(|| format!("{}: no main/master branch", root.display()))?;
    let since = chrono::DateTime::from_timestamp_millis(since_ms)
        .ok_or_else(|| format!("since {since_ms}: out of range"))?
        .to_rfc3339();
    let limit = limit.max(1).to_string();
    let raw = personas_engine::git_checkpoint::run_git_blocking(
        root,
        &[
            "log",
            &base,
            &format!("--since={since}"),
            "-n",
            &limit,
            "--format=%H%x1f%s",
        ],
    )?;
    Ok(parse_log(&raw))
}

fn parse_log(raw: &str) -> Vec<MovedCommit> {
    raw.lines()
        .filter_map(|line| {
            let (sha, summary) = line.split_once('\u{1f}')?;
            let sha = sha.trim();
            (!sha.is_empty()).then(|| MovedCommit {
                sha: sha.to_string(),
                summary: summary.trim().to_string(),
            })
        })
        .collect()
}

/// Live fleet sessions (`is_live_state`) per project, from the registry.
pub fn running_by_project(roots: &[ProjectRoot]) -> HashMap<String, i32> {
    let mut out: HashMap<String, i32> = HashMap::new();
    for s in crate::commands::fleet::registry::registry().list_dto() {
        if !crate::commands::fleet::registry::is_live_state(s.state) {
            continue;
        }
        if let Some(pid) = project_for_cwd(roots, &s.cwd) {
            *out.entry(pid.to_string()).or_default() += 1;
        }
    }
    out
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/// Compose the report for a standup revision from its event ledger, the
/// fleet and the projects' git history since `armed_at`.
///
/// Cross-package seam: WP3 implements it; WP1's `standup_end` command and
/// `standup_open` (the recall of the previous revision) call it.
///
/// With only the user DB, project roots come from Athena's own registry
/// (`companion_known_project`); a caller that holds the system DB should call
/// [`build_with`] so Dev Tools project ids resolve too. Blocking (git): call
/// it from `spawn_blocking`.
#[cfg(test)]
pub fn build(pool: &UserDbPool, standup_id: &str) -> Result<StandupReport, AppError> {
    build_from_roots(pool, &known_project_roots(pool), standup_id)
}

/// [`build`] with the system DB, so plan items naming a Dev Tools project
/// (`dev_projects`, the registry fleet cwd validation and charters use)
/// resolve to their repo root.
pub fn build_with(
    user_db: &UserDbPool,
    sys_db: &DbPool,
    standup_id: &str,
) -> Result<StandupReport, AppError> {
    build_from_roots(user_db, &project_roots(user_db, sys_db), standup_id)
}

fn build_from_roots(
    user_db: &UserDbPool,
    roots: &[ProjectRoot],
    standup_id: &str,
) -> Result<StandupReport, AppError> {
    let head = head(user_db, standup_id)?
        .ok_or_else(|| AppError::NotFound(format!("standup {standup_id}")))?;
    let since = head.armed_at.unwrap_or(head.opened_at);
    let events = all_events(user_db, standup_id)?;
    let projects = report_projects(&head, &events);

    let mut moved: HashMap<String, Vec<MovedCommit>> = HashMap::new();
    for pid in &projects {
        let Some(root) = roots.iter().find(|r| &r.id == pid) else {
            continue;
        };
        match moved_commits(&root.root, since, MOVED_COMMITS_CAP) {
            Ok(commits) => {
                moved.insert(pid.clone(), commits);
            }
            Err(e) => tracing::warn!(project = %pid, error = %e, "standup report: git log failed"),
        }
    }
    let running = running_by_project(roots);
    let resolved = |detail: &serde_json::Value| parked_ask_resolved(user_db, detail);
    Ok(compose(&head, &events, &moved, &running, &resolved))
}

/// Whether a parked ask's card / request has been answered. A read failure
/// keeps it OPEN (the operator sees it once more rather than never).
fn parked_ask_resolved(user_db: &UserDbPool, detail: &serde_json::Value) -> bool {
    let resolve = &detail["resolve"];
    let id = resolve["id"].as_str().unwrap_or_default();
    match resolve["kind"].as_str() {
        Some(RESOLVE_APPROVAL) if !id.is_empty() => {
            let status: Result<Option<String>, AppError> =
                user_db.get().map_err(AppError::from).and_then(|conn| {
                    use rusqlite::OptionalExtension;
                    conn.query_row(
                        "SELECT status FROM companion_approval WHERE id = ?1",
                        rusqlite::params![id],
                        |r| r.get::<_, String>("status"),
                    )
                    .optional()
                    .map_err(AppError::from)
                });
            match status {
                Ok(Some(s)) => s != "pending",
                // The row is gone: nothing left to decide.
                Ok(None) => true,
                Err(e) => {
                    tracing::warn!(error = %e, approval_id = %id, "standup report: approval status unreadable");
                    false
                }
            }
        }
        Some(RESOLVE_WORKER) if !id.is_empty() => {
            !crate::companion::orchestration::mcp::pending::is_pending(id)
        }
        Some(RESOLVE_STANDUP) | None | Some(_) => false,
    }
}

/// The projects the report covers: the revision's armed projects in plan
/// order, then any project an event names, then [`UNSCOPED_PROJECT_ID`] when
/// a project-less parked ask exists.
fn report_projects(head: &StandupHead, events: &[StandupEvent]) -> Vec<String> {
    let mut out = armed_projects(&head.plan);
    for e in events {
        if let Some(p) = e
            .project_id
            .as_deref()
            .map(str::trim)
            .filter(|p| !p.is_empty())
        {
            if !out.iter().any(|x| x == p) {
                out.push(p.to_string());
            }
        }
    }
    out
}

/// The pure part of the report: everything is already read.
pub fn compose(
    head: &StandupHead,
    events: &[StandupEvent],
    moved: &HashMap<String, Vec<MovedCommit>>,
    running: &HashMap<String, i32>,
    resolved: &dyn Fn(&serde_json::Value) -> bool,
) -> StandupReport {
    let since_ms = head.armed_at.unwrap_or(head.opened_at);
    let mut projects = report_projects(head, events);

    let mut parked: HashMap<String, Vec<ParkedAsk>> = HashMap::new();
    let mut created_agents: Vec<CreatedAgentRef> = Vec::new();
    for e in events {
        match e.kind {
            StandupEventKind::AskParked => {
                let detail = e.detail.clone().unwrap_or(serde_json::Value::Null);
                if resolved(&detail) {
                    continue;
                }
                let options = detail["options"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(|o| o.as_str().map(str::to_string))
                            .collect()
                    })
                    .unwrap_or_default();
                let key = e
                    .project_id
                    .as_deref()
                    .map(str::trim)
                    .filter(|p| !p.is_empty())
                    .unwrap_or(UNSCOPED_PROJECT_ID)
                    .to_string();
                parked.entry(key).or_default().push(ParkedAsk {
                    event_id: e.id.clone(),
                    summary: e.summary.clone(),
                    options,
                });
            }
            StandupEventKind::AgentCreated => {
                let d = e.detail.clone().unwrap_or(serde_json::Value::Null);
                let Some(persona_id) = d["personaId"].as_str().filter(|s| !s.is_empty()) else {
                    continue;
                };
                if created_agents.iter().any(|a| a.persona_id == persona_id) {
                    continue;
                }
                let away = d["away"].as_bool().unwrap_or(false)
                    || d["origin"].as_str() == Some(super::supervisor::AWAY_ORIGIN);
                created_agents.push(CreatedAgentRef {
                    persona_id: persona_id.to_string(),
                    name: d["name"].as_str().unwrap_or(persona_id).to_string(),
                    away,
                });
            }
            _ => {}
        }
    }
    if parked.contains_key(UNSCOPED_PROJECT_ID)
        && !projects.iter().any(|p| p == UNSCOPED_PROJECT_ID)
    {
        projects.push(UNSCOPED_PROJECT_ID.to_string());
    }

    let reports = projects
        .into_iter()
        .map(|pid| {
            let parked = parked.remove(&pid).unwrap_or_default();
            let next_decide = next_decide(head, &pid, &parked);
            StandupProjectReport {
                moved: moved.get(&pid).cloned().unwrap_or_default(),
                running: running.get(&pid).copied().unwrap_or(0),
                parked,
                next_decide,
                project_id: pid,
            }
        })
        .collect();
    StandupReport {
        since_ms,
        projects: reports,
        created_agents,
    }
}

/// The next decision the operator owns on a project: the oldest open parked
/// ask, else a direction still unpicked on the revision, else none.
fn next_decide(head: &StandupHead, project_id: &str, parked: &[ParkedAsk]) -> Option<String> {
    if let Some(first) = parked.first() {
        let more = parked.len() - 1;
        return Some(if more == 0 {
            format!("Decide: {}", first.summary)
        } else {
            format!("Decide: {} (+{more} more parked)", first.summary)
        });
    }
    let unpicked = head.plan.items.iter().any(|i| {
        i.project_id.as_deref() == Some(project_id)
            && i.kind == StandupItemKind::Direction
            && i.state == StandupItemState::Proposed
    });
    unpicked.then(|| "Pick a direction for this project".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::companion::standup::away_rules::default_rules;
    use crate::companion::standup::model::{StandupItem, StandupWindow};

    fn item(id: &str, project: &str, state: StandupItemState) -> StandupItem {
        StandupItem {
            id: id.into(),
            kind: StandupItemKind::Direction,
            project_id: Some(project.into()),
            device_id: "dev-1".into(),
            state,
            proposals: Vec::new(),
            chosen: Some("finish the importer".into()),
            persona_id: None,
            create_spec: None,
            retune_spec: None,
            window: StandupWindow::Any,
            not_before_ms: None,
            priority: 1,
            evidence: "3 merges".into(),
        }
    }

    fn insert_standup(
        pool: &UserDbPool,
        id: &str,
        status: &str,
        armed_at: Option<i64>,
        plan: &StandupPlan,
    ) -> Result<(), AppError> {
        pool.get()?
            .execute(
                "INSERT INTO companion_standup
                   (id, revision, status, device_id, opened_at, armed_at, plan_json, away_rules_json)
                 VALUES (?1, 1, ?2, 'dev-1', 1000, ?3, ?4, ?5)",
                rusqlite::params![
                    id,
                    status,
                    armed_at,
                    serde_json::to_string(plan).unwrap(),
                    serde_json::to_string(&default_rules()).unwrap()
                ],
            )?;
        Ok(())
    }

    fn ev(
        standup: &str,
        at: i64,
        kind: StandupEventKind,
        project: Option<&str>,
        summary: &str,
        detail: Option<serde_json::Value>,
    ) -> StandupEvent {
        StandupEvent {
            id: new_event_id(),
            standup_id: standup.into(),
            at,
            kind,
            project_id: project.map(str::to_string),
            summary: summary.into(),
            detail,
        }
    }

    #[test]
    fn append_then_list_round_trips_every_kind_newest_first() {
        let pool = crate::db::init_test_user_db().unwrap();
        let kinds = [
            StandupEventKind::Sweep,
            StandupEventKind::Drift,
            StandupEventKind::AskDelegated,
            StandupEventKind::AskParked,
            StandupEventKind::Dispatch,
            StandupEventKind::Backfill,
            StandupEventKind::AgentCreated,
            StandupEventKind::AgentRetuned,
            StandupEventKind::Push,
            StandupEventKind::Stop,
        ];
        for (n, k) in kinds.iter().enumerate() {
            // The token is the serde form, which is also the SQL CHECK set.
            assert_eq!(serde_json::to_value(k).unwrap(), kind_token(*k));
            let e = ev(
                "su-1",
                n as i64,
                *k,
                Some("kp"),
                "x",
                Some(serde_json::json!({"n": n})),
            );
            append_event(&pool, &e).unwrap();
        }
        let back = list_events(&pool, "su-1", 100).unwrap();
        assert_eq!(back.len(), kinds.len());
        assert_eq!(back[0].kind, StandupEventKind::Stop, "newest first");
        assert_eq!(back[0].detail, Some(serde_json::json!({"n": 9})));
        assert_eq!(
            last_event_at(&pool, "su-1", StandupEventKind::Sweep).unwrap(),
            Some(0)
        );
        assert_eq!(
            last_event_at(&pool, "su-2", StandupEventKind::Sweep).unwrap(),
            None
        );
    }

    #[test]
    fn append_refuses_a_non_object_detail_and_a_duplicate_id() {
        let pool = crate::db::init_test_user_db().unwrap();
        let mut e = ev(
            "su-1",
            1,
            StandupEventKind::Sweep,
            None,
            "s",
            Some(serde_json::json!([1])),
        );
        assert!(matches!(
            append_event(&pool, &e),
            Err(AppError::Validation(_))
        ));
        e.detail = None;
        append_event(&pool, &e).unwrap();
        assert!(
            append_event(&pool, &e).is_err(),
            "append-only: no overwrite"
        );
        e.summary = "  ".into();
        e.id = new_event_id();
        assert!(matches!(
            append_event(&pool, &e),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn armed_reads_only_the_armed_revision() {
        let pool = crate::db::init_test_user_db().unwrap();
        let plan = StandupPlan::default();
        insert_standup(&pool, "su-draft", "draft", None, &plan).unwrap();
        assert!(armed(&pool).unwrap().is_none());
        insert_standup(&pool, "su-armed", "armed", Some(2000), &plan).unwrap();
        let h = armed(&pool).unwrap().expect("armed");
        assert_eq!(h.id, "su-armed");
        assert_eq!(h.status, StandupStatus::Armed);
        assert_eq!(h.away_rules, default_rules());
    }

    #[test]
    fn build_lists_parked_asks_with_options_created_agents_and_next_decide() -> Result<(), AppError>
    {
        let pool = crate::db::init_test_user_db().unwrap();
        let plan = StandupPlan {
            items: vec![
                item("i1", "kp", StandupItemState::Accepted),
                item("i2", "pof", StandupItemState::Proposed),
                item("i3", "skipped-one", StandupItemState::Skipped),
            ],
        };
        insert_standup(&pool, "su-1", "armed", Some(5000), &plan).unwrap();

        // One parked card still pending, one already answered.
        let conn = pool.get()?;
        for (id, status) in [("appr_open", "pending"), ("appr_done", "approved")] {
            conn.execute(
                "INSERT INTO companion_approval (id, session_id, kind, payload, status)
                 VALUES (?1, 'default', 'op_execute', '{}', ?2)",
                rusqlite::params![id, status],
            )
            .unwrap();
        }
        drop(conn);
        let parked = |appr: &str| {
            Some(serde_json::json!({
                "options": ["Approve", "Reject"],
                "resolve": {"kind": "approval", "id": appr},
            }))
        };
        for e in [
            ev(
                "su-1",
                6000,
                StandupEventKind::AskParked,
                Some("kp"),
                "Parked for you: delete_goal (data)",
                parked("appr_open"),
            ),
            ev(
                "su-1",
                6100,
                StandupEventKind::AskParked,
                Some("kp"),
                "answered",
                parked("appr_done"),
            ),
            ev(
                "su-1",
                6200,
                StandupEventKind::AskParked,
                None,
                "Parked for you: reconnect_credential (secrets)",
                parked("appr_open"),
            ),
            ev(
                "su-1",
                6300,
                StandupEventKind::AgentCreated,
                Some("kp"),
                "Created Triage",
                Some(
                    serde_json::json!({"personaId": "p-9", "name": "Triage", "origin": "standup-away"}),
                ),
            ),
            ev(
                "su-1",
                6400,
                StandupEventKind::AgentCreated,
                None,
                "Created at the gate",
                Some(serde_json::json!({"personaId": "p-1", "name": "Gate Hire", "away": false})),
            ),
        ] {
            append_event(&pool, &e).unwrap();
        }

        let report = build(&pool, "su-1").unwrap();
        assert_eq!(report.since_ms, 5000);
        let ids: Vec<&str> = report
            .projects
            .iter()
            .map(|p| p.project_id.as_str())
            .collect();
        assert_eq!(
            ids,
            vec!["kp", UNSCOPED_PROJECT_ID],
            "accepted items + unscoped asks"
        );

        let kp = &report.projects[0];
        assert_eq!(kp.parked.len(), 1, "the answered ask is gone");
        assert_eq!(kp.parked[0].options, vec!["Approve", "Reject"]);
        assert_eq!(
            kp.next_decide.as_deref(),
            Some("Decide: Parked for you: delete_goal (data)")
        );
        assert!(kp.moved.is_empty(), "no registered root for kp in this DB");
        assert_eq!(kp.running, 0);
        assert_eq!(report.projects[1].parked.len(), 1);

        assert_eq!(
            report.created_agents,
            vec![
                CreatedAgentRef {
                    persona_id: "p-9".into(),
                    name: "Triage".into(),
                    away: true
                },
                CreatedAgentRef {
                    persona_id: "p-1".into(),
                    name: "Gate Hire".into(),
                    away: false
                },
            ]
        );
        Ok(())
    }

    #[test]
    fn build_of_an_unknown_standup_is_not_found() {
        let pool = crate::db::init_test_user_db().unwrap();
        assert!(matches!(build(&pool, "nope"), Err(AppError::NotFound(_))));
    }

    #[test]
    fn next_decide_points_at_an_unpicked_direction_when_nothing_is_parked() {
        let head = StandupHead {
            id: "su".into(),
            revision: 1,
            status: StandupStatus::Armed,
            opened_at: 1,
            armed_at: Some(2),
            plan: StandupPlan {
                items: vec![
                    item("a", "kp", StandupItemState::Accepted),
                    item("b", "kp", StandupItemState::Proposed),
                ],
            },
            away_rules: default_rules(),
        };
        let r = compose(
            &head,
            &[],
            &HashMap::new(),
            &HashMap::from([("kp".to_string(), 2)]),
            &|_| false,
        );
        assert_eq!(r.projects[0].running, 2);
        assert_eq!(
            r.projects[0].next_decide.as_deref(),
            Some("Pick a direction for this project")
        );
    }

    #[test]
    fn moved_commits_reads_the_main_branch_since_armed_at() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let git =
            |args: &[&str]| personas_engine::git_checkpoint::run_git_blocking(root, args).unwrap();
        git(&["init", "-q", "-b", "main"]);
        git(&["config", "user.email", "t@t"]);
        git(&["config", "user.name", "t"]);
        std::fs::write(root.join("a.txt"), "1").unwrap();
        git(&["add", "a.txt"]);
        git(&["commit", "-q", "-m", "feat: first"]);
        std::fs::write(root.join("a.txt"), "2").unwrap();
        git(&["commit", "-q", "-am", "fix: second"]);

        let all = moved_commits(root, 0, 10).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].summary, "fix: second", "newest first");
        assert_eq!(all[0].sha.len(), 40);
        assert_eq!(moved_commits(root, 0, 1).unwrap().len(), 1, "bounded");
        let future = chrono::Utc::now().timestamp_millis() + 3_600_000;
        assert!(moved_commits(root, future, 10).unwrap().is_empty());
        assert!(moved_commits(&root.join("missing"), 0, 10).is_err());
    }

    #[test]
    fn project_for_cwd_picks_the_longest_root() {
        let roots = vec![
            ProjectRoot {
                id: "outer".into(),
                root: PathBuf::from("C:\\repo"),
            },
            ProjectRoot {
                id: "inner".into(),
                root: PathBuf::from("C:/repo/sub/"),
            },
        ];
        assert_eq!(project_for_cwd(&roots, "c:/repo/sub/x"), Some("inner"));
        assert_eq!(project_for_cwd(&roots, "C:\\repo\\y"), Some("outer"));
        assert_eq!(project_for_cwd(&roots, "C:/repository"), None);
        assert_eq!(project_for_cwd(&roots, ""), None);
    }
}
