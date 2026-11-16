//! `StandupSupervisor`: the 20-minute sweep and hourly drift check of an armed
//! plan (a `ReactiveSubscription`), and the away create path. WP3 owns.
//!
//! The subscription polls cheaply ([`POLL_EVERY`]); a tick with no ARMED
//! revision resets its schedule and returns after one indexed query, which is
//! what "stops when the standup ends" means for a polled loop. While a
//! revision is armed:
//!
//! - **Sweep** every [`SWEEP_EVERY_MS`]: read the fleet (stale sessions, runs
//!   held on a human or by the admission door, queue depth, items the arm path
//!   refused) and write ONE `sweep` event summarising it, per project in its
//!   detail.
//! - **Drift** every [`DRIFT_EVERY_MS`]: per armed project, put the agreed
//!   direction (`chosen`) beside what moved since the last check (commits on
//!   the main branch) and the project charter's latest channel notes, and ask
//!   the Athena engine ([`model_routing::TRIAGE`], the cheap judgment tier)
//!   whether the work is on course. Off course -> a corrective note through
//!   the charter's channel (the operator's say door the App Master reads) and
//!   a `drift` event. On course -> nothing.
//! - **Away create / retune**: when the drift verdict says the direction needs
//!   an agent (or a slower / faster charter), the away rules decide; a
//!   delegated create goes through the existing creation op (`build_oneshot`,
//!   the approval executor table) and writes `agent_created` with
//!   `origin = standup-away`; a delegated retune updates the charter's cadence
//!   and writes `agent_retuned`. A parked one writes `ask_parked`.
//!
//! The clock is injected ([`StandupSupervisor::with_clock`]) and the schedule
//! is a pure struct ([`SupervisorSchedule`]), so cadence is testable without
//! an `AppHandle`.

// REMOVE with the registration: until the Director adds `StandupSupervisor`
// to `engine/background/lifecycle.rs` (a file outside WP3's scope) nothing in
// a non-test build reaches this module, and the whole file would warn as
// dead. The line that makes it live is in this file's `StandupSupervisor` doc.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::commands::fleet::types::FleetSessionState;
use crate::companion::model_routing;
use crate::db::{DbPool, UserDbPool};
use crate::engine::subscription::ReactiveSubscription;
use crate::error::AppError;
use crate::AppState;

use super::away_rules::{self, AwayAction, AwayDecision, RESOLVE_STANDUP};
use super::model::{
    AwayRuleClass, CreateAgentSpec, CreatedAgentRef, RetuneAgentSpec, StandupEvent,
    StandupEventKind, StandupItemKind, StandupItemState,
};
use super::report::{self, ProjectRoot, StandupHead};

/// The tag every persona Athena creates while away carries, in its
/// `agent_created` event (`detail.origin`). Personas have no origin column
/// (`trust_origin` is the closed builtin|user|system set), so the standup
/// ledger is where the tag lives; the report reads it from there.
pub const AWAY_ORIGIN: &str = "standup-away";

/// How often the subscription polls. The sweep / drift cadences below are
/// measured against the injected clock, not against this.
pub const POLL_EVERY: Duration = Duration::from_secs(60);
/// Sweep cadence while armed.
pub const SWEEP_EVERY_MS: i64 = 20 * 60_000;
/// Drift-check cadence while armed.
pub const DRIFT_EVERY_MS: i64 = 60 * 60_000;

/// The one-shot leg the drift judgment is metered under (`turn_ledger`
/// `trigger_kind`).
pub const DRIFT_LEG: &str = "standup_drift";
/// Backstop for one drift judgment.
const DRIFT_TIMEOUT: Duration = Duration::from_secs(90);
/// Commits per project a drift prompt shows.
const DRIFT_COMMITS: usize = 20;
/// Channel notes per charter a drift prompt shows.
const DRIFT_NOTES: i64 = 8;
/// Bounds of a retuned charter cadence, minutes (the decision lane's own
/// next-wake bound).
const RETUNE_MIN_MINUTES: i32 = 10;
const RETUNE_MAX_MINUTES: i32 = 240;

// ---------------------------------------------------------------------------
// Clock + schedule (pure)
// ---------------------------------------------------------------------------

/// Epoch milliseconds now. Injected so tests can drive time.
pub type Clock = Arc<dyn Fn() -> i64 + Send + Sync>;

fn system_clock() -> Clock {
    Arc::new(|| chrono::Utc::now().timestamp_millis())
}

/// What a tick should do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Due {
    pub sweep: bool,
    /// `Some(since)` when a drift check is due: judge what moved since then.
    pub drift_since: Option<i64>,
}

/// When the last sweep / drift ran for the armed revision.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SupervisorSchedule {
    standup_id: Option<String>,
    last_sweep_ms: i64,
    last_drift_ms: i64,
}

impl SupervisorSchedule {
    /// Advance the schedule for `standup_id` (armed at `armed_at`) to `now`.
    /// Adopting a new revision starts both clocks at `armed_at`, or the
    /// sweep clock at `last_sweep_hint` (the newest `sweep` event, so an app
    /// restart does not sweep twice).
    pub fn due(
        &mut self,
        standup_id: &str,
        armed_at: i64,
        last_sweep_hint: Option<i64>,
        now: i64,
    ) -> Due {
        if self.standup_id.as_deref() != Some(standup_id) {
            self.standup_id = Some(standup_id.to_string());
            self.last_sweep_ms = last_sweep_hint.unwrap_or(armed_at).max(armed_at);
            self.last_drift_ms = armed_at;
        }
        let mut due = Due::default();
        if now - self.last_sweep_ms >= SWEEP_EVERY_MS {
            due.sweep = true;
            self.last_sweep_ms = now;
        }
        if now - self.last_drift_ms >= DRIFT_EVERY_MS {
            due.drift_since = Some(self.last_drift_ms);
            self.last_drift_ms = now;
        }
        due
    }

    /// The standup ended (no armed revision): forget it.
    pub fn reset(&mut self) {
        *self = Self::default();
    }
}

// ---------------------------------------------------------------------------
// Sweep (pure summary + live gather)
// ---------------------------------------------------------------------------

/// One fleet session as the sweep sees it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionFact {
    pub project_id: Option<String>,
    pub state: FleetSessionState,
    /// The admission door has found it unfit since this time (queued only).
    pub unfit_since_ms: Option<i64>,
}

/// Counts for one sweep (whole fleet, or one project).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SweepCounts {
    pub running: i32,
    pub stale: i32,
    /// Waiting on a human (`AwaitingInput`) or held by the admission door.
    pub held: i32,
    pub queued: i32,
    /// Plan items the arm path refused since the last sweep: WP1's arm
    /// writes a `stop` event naming the item (`detail.itemId`) and why
    /// (`detail.reason`, e.g. `headless_master`).
    pub refused: i32,
}

impl SweepCounts {
    fn add(&mut self, s: &SessionFact) {
        if crate::commands::fleet::registry::is_live_state(s.state) {
            self.running += 1;
        }
        match s.state {
            FleetSessionState::Stale => self.stale += 1,
            FleetSessionState::AwaitingInput => self.held += 1,
            FleetSessionState::Queued => {
                self.queued += 1;
                if s.unfit_since_ms.is_some() {
                    self.held += 1;
                }
            }
            _ => {}
        }
    }
}

/// Summarise a fleet snapshot: totals and per-project counts.
pub fn summarize_sweep(
    facts: &[SessionFact],
    refused_by_project: &HashMap<Option<String>, i32>,
) -> (SweepCounts, HashMap<String, SweepCounts>) {
    let mut total = SweepCounts::default();
    let mut per: HashMap<String, SweepCounts> = HashMap::new();
    for f in facts {
        total.add(f);
        if let Some(p) = &f.project_id {
            per.entry(p.clone()).or_default().add(f);
        }
    }
    for (p, n) in refused_by_project {
        total.refused += n;
        if let Some(p) = p {
            per.entry(p.clone()).or_default().refused += n;
        }
    }
    (total, per)
}

/// The one-line summary of a sweep event.
pub fn sweep_summary_text(c: &SweepCounts) -> String {
    format!(
        "Sweep: {} running, {} stale, {} held, {} queued, {} refused",
        c.running, c.stale, c.held, c.queued, c.refused
    )
}

/// Refused plan items per project among `events` newer than `since`.
fn refused_since(events: &[StandupEvent], since: i64) -> HashMap<Option<String>, i32> {
    let mut out = HashMap::new();
    for e in events {
        let names = |k: &str| {
            e.detail
                .as_ref()
                .and_then(|d| d.get(k))
                .and_then(|v| v.as_str())
                .is_some_and(|s| !s.is_empty())
        };
        let refused =
            e.kind == StandupEventKind::Stop && e.at > since && names("itemId") && names("reason");
        if refused {
            *out.entry(e.project_id.clone()).or_insert(0) += 1;
        }
    }
    out
}

/// Read the fleet registry into sweep facts.
fn fleet_facts(roots: &[ProjectRoot]) -> Vec<SessionFact> {
    let registry = crate::commands::fleet::registry::registry();
    let unfit: HashMap<String, Option<i64>> = registry
        .queued_admissions_in_order()
        .into_iter()
        .map(|(id, _, facts)| (id, facts.first_unfit_at_ms))
        .collect();
    registry
        .list_dto()
        .into_iter()
        .map(|s| SessionFact {
            project_id: report::project_for_cwd(roots, &s.cwd).map(str::to_string),
            unfit_since_ms: unfit.get(&s.id).copied().flatten(),
            state: s.state,
        })
        .collect()
}

/// Run one sweep and write its event. Blocking (DB).
pub fn run_sweep(
    user_db: &UserDbPool,
    sys_db: &DbPool,
    head: &StandupHead,
    since: i64,
    now: i64,
) -> Result<SweepCounts, AppError> {
    let roots = report::project_roots(user_db, sys_db);
    let facts = fleet_facts(&roots);
    let recent = report::list_events(user_db, &head.id, 500)?;
    let (total, per) = summarize_sweep(&facts, &refused_since(&recent, since));
    report::append_event(
        user_db,
        &StandupEvent {
            id: report::new_event_id(),
            standup_id: head.id.clone(),
            at: now,
            kind: StandupEventKind::Sweep,
            project_id: None,
            summary: sweep_summary_text(&total),
            detail: Some(serde_json::json!({
                "total": total,
                "projects": per,
            })),
        },
    )?;
    Ok(total)
}

// ---------------------------------------------------------------------------
// Drift (pure prompt + parse, live gather, act)
// ---------------------------------------------------------------------------

/// What the drift judgment returned.
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriftVerdict {
    pub on_course: bool,
    /// The corrective note, when off course.
    #[serde(default)]
    pub note: String,
    /// The direction needs a persona nobody holds yet.
    #[serde(default)]
    pub needs_agent: Option<DriftAgentNeed>,
    /// The project charter should wake more or less often.
    #[serde(default)]
    pub retune_pacing_minutes: Option<i32>,
}

/// A persona the drift judgment says the direction needs.
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriftAgentNeed {
    pub name: String,
    pub role: String,
    pub charter: String,
}

/// Everything one project's drift judgment sees.
#[derive(Debug, Clone, PartialEq)]
pub struct DriftEvidence {
    pub project_id: String,
    pub chosen: Vec<String>,
    pub commits: Vec<String>,
    pub notes: Vec<String>,
}

/// The drift prompt. Internal directive, not UI chrome.
pub fn drift_prompt(ev: &DriftEvidence) -> String {
    let list = |items: &[String]| {
        if items.is_empty() {
            "(none)".to_string()
        } else {
            items
                .iter()
                .map(|s| format!("- {}", s.chars().take(300).collect::<String>()))
                .collect::<Vec<_>>()
                .join("\n")
        }
    };
    format!(
        "You are Athena, supervising project `{project}` while the operator is away. At standup he \
         agreed this direction for it:\n{chosen}\n\n\
         Since your last check, these commits landed on its main branch:\n{commits}\n\n\
         The project charter's latest channel notes:\n{notes}\n\n\
         Is the work still on course for the agreed direction? Judge only drift away from the \
         direction, not code quality. Reply with ONLY one JSON object, no prose:\n\
         {{\"onCourse\": true|false, \"note\": \"<when off course: one to three sentences to the \
         charter holder that steer the work back, naming what to stop and what to do next>\", \
         \"needsAgent\": null | {{\"name\": \"...\", \"role\": \"...\", \"charter\": \"<what it owns>\"}}, \
         \"retunePacingMinutes\": null | <10-240, only if the charter should wake more or less often>}}\n\
         Propose needsAgent only when the direction plainly needs a capability no current charter \
         holds.",
        project = ev.project_id,
        chosen = list(&ev.chosen),
        commits = list(&ev.commits),
        notes = list(&ev.notes),
    )
}

/// Parse the judgment: the first `{` to the last `}`. `Err` carries why it
/// is not the contract plus a bounded head of the reply, so the skipped
/// check is logged with its reason (the check is skipped, never guessed).
pub fn parse_drift_verdict(raw: &str) -> Result<DriftVerdict, String> {
    let head = || raw.chars().take(160).collect::<String>();
    let (Some(start), Some(end)) = (raw.find('{'), raw.rfind('}')) else {
        return Err(format!("no JSON object in the reply: {:?}", head()));
    };
    if end < start {
        return Err(format!("no JSON object in the reply: {:?}", head()));
    }
    let mut v: DriftVerdict = serde_json::from_str(&raw[start..=end])
        .map_err(|e| format!("not the verdict contract ({e}): {:?}", head()))?;
    v.note = v.note.trim().to_string();
    if !v.on_course && v.note.is_empty() {
        return Err(format!("off course without a note: {:?}", head()));
    }
    v.retune_pacing_minutes = v
        .retune_pacing_minutes
        .map(|m| m.clamp(RETUNE_MIN_MINUTES, RETUNE_MAX_MINUTES));
    v.needs_agent = v
        .needs_agent
        .filter(|a| !a.name.trim().is_empty() && !a.charter.trim().is_empty());
    Ok(v)
}

/// The persona holding the project's active charter: its App Master when it
/// has one, else the newest holder. Blocking (system DB).
pub fn charter_holder(sys_db: &DbPool, project_id: &str) -> Result<Option<String>, AppError> {
    use rusqlite::OptionalExtension;
    let conn = sys_db.get()?;
    let holder = conn
        .query_row(
            "SELECT r.persona_id AS persona_id
             FROM persona_responsibilities r
             JOIN personas p ON p.id = r.persona_id
             WHERE r.project_id = ?1 AND r.status = 'active'
             ORDER BY (p.name LIKE 'App Master%') DESC, p.created_at DESC
             LIMIT 1",
            rusqlite::params![project_id],
            |r| r.get::<_, String>("persona_id"),
        )
        .optional()?;
    Ok(holder)
}

/// The charter holder's latest channel notes (chat + reports), newest first.
fn charter_notes(sys_db: &DbPool, persona_id: &str) -> Result<Vec<String>, AppError> {
    let conn = sys_db.get()?;
    let kinds = ["chat".to_string(), "report".to_string()];
    let items = crate::commands::communication::persona_channel::read_persona_channel(
        &conn,
        persona_id,
        Some(DRIFT_NOTES),
        None,
        None,
        Some(&kinds),
    )?;
    Ok(items
        .into_iter()
        .filter_map(|i| {
            let text = match (i.title, i.body) {
                (Some(t), Some(b)) => format!("{t}: {b}"),
                (Some(t), None) => t,
                (None, Some(b)) => b,
                (None, None) => return None,
            };
            Some(format!("[{} {}] {}", i.at, i.author_kind, text.trim()))
        })
        .collect())
}

/// Gather one project's evidence. Blocking (DB + git).
fn drift_evidence(
    sys_db: &DbPool,
    roots: &[ProjectRoot],
    head: &StandupHead,
    project_id: &str,
    since: i64,
) -> Result<(DriftEvidence, Option<String>), AppError> {
    let chosen = head
        .plan
        .items
        .iter()
        .filter(|i| i.project_id.as_deref() == Some(project_id))
        .filter(|i| i.kind == StandupItemKind::Direction)
        .filter(|i| {
            matches!(
                i.state,
                StandupItemState::Accepted | StandupItemState::Edited
            )
        })
        .filter_map(|i| i.chosen.as_deref().map(str::trim))
        .filter(|c| !c.is_empty())
        .map(str::to_string)
        .collect();
    let commits = roots
        .iter()
        .find(|r| r.id == project_id)
        .map(|r| match report::moved_commits(&r.root, since, DRIFT_COMMITS) {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!(project = %project_id, error = %e, "standup drift: git log failed");
                Vec::new()
            }
        })
        .unwrap_or_default()
        .into_iter()
        .map(|c| format!("{} {}", &c.sha[..c.sha.len().min(10)], c.summary))
        .collect();
    let holder = charter_holder(sys_db, project_id)?;
    let notes = match &holder {
        Some(pid) => charter_notes(sys_db, pid)?,
        None => Vec::new(),
    };
    Ok((
        DriftEvidence {
            project_id: project_id.to_string(),
            chosen,
            commits,
            notes,
        },
        holder,
    ))
}

/// Post the corrective note to the charter holder's channel. It rides the
/// operator's say door (`author_kind = 'user'`, the row both the in-app
/// attention loop's arrivals lane and the headless master read), labelled so
/// nobody mistakes it for the operator typing: the direction it restates is
/// the one HE agreed at standup.
fn post_correction(
    sys_db: &DbPool,
    persona_id: &str,
    chosen: &[String],
    note: &str,
) -> Result<String, AppError> {
    let body = format!(
        "[Standup drift check] The direction agreed at standup: {}\n\n{note}",
        chosen.join(" / ")
    );
    let (id, _at) = crate::db::repos::resources::team_channel::create_persona_channel_message(
        sys_db,
        crate::db::repos::resources::team_channel::CreatePersonaChannelMessageInput {
            id: None,
            persona_id: persona_id.to_string(),
            author_kind: "user".into(),
            author_id: None,
            author_label: Some("Athena (standup)".into()),
            body,
            reply_to: None,
            failed: false,
        },
    )?;
    Ok(id)
}

/// Run the drift check over every armed project, acting on each verdict.
pub async fn run_drift(
    app: &AppHandle,
    state: &Arc<AppState>,
    head: &StandupHead,
    since: i64,
    now: i64,
) {
    for project_id in report::armed_projects(&head.plan) {
        if let Err(e) = drift_one(app, state, head, &project_id, since, now).await {
            tracing::warn!(project = %project_id, error = %e, "standup drift: check failed");
        }
    }
}

async fn drift_one(
    app: &AppHandle,
    state: &Arc<AppState>,
    head: &StandupHead,
    project_id: &str,
    since: i64,
    now: i64,
) -> Result<(), AppError> {
    let (sys, user, h, pid) = (
        state.db.clone(),
        state.user_db.clone(),
        head.clone(),
        project_id.to_string(),
    );
    let (evidence, holder) = blocking(move || {
        let roots = report::project_roots(&user, &sys);
        drift_evidence(&sys, &roots, &h, &pid, since)
    })
    .await?;
    if evidence.chosen.is_empty() {
        return Ok(()); // nothing agreed to drift from
    }
    if evidence.commits.is_empty() && evidence.notes.is_empty() {
        return Ok(()); // nothing moved and nothing said: nothing to judge
    }
    let raw = crate::companion::brain::oneshot::call_claude_text(
        &state.user_db,
        &drift_prompt(&evidence),
        model_routing::TRIAGE.model,
        DRIFT_LEG,
        DRIFT_TIMEOUT,
    )
    .await?;
    let verdict = match parse_drift_verdict(&raw) {
        Ok(v) => v,
        Err(reason) => {
            tracing::warn!(project = %project_id, reason = %reason, "standup drift: judgment skipped");
            return Ok(());
        }
    };

    if !verdict.on_course {
        let (sys, user, h, pid, holder_c, chosen, note) = (
            state.db.clone(),
            state.user_db.clone(),
            head.id.clone(),
            project_id.to_string(),
            holder.clone(),
            evidence.chosen.clone(),
            verdict.note.clone(),
        );
        blocking(move || {
            let message_id = match &holder_c {
                Some(persona) => Some(post_correction(&sys, persona, &chosen, &note)?),
                None => None,
            };
            report::append_event(
                &user,
                &StandupEvent {
                    id: report::new_event_id(),
                    standup_id: h,
                    at: now,
                    kind: StandupEventKind::Drift,
                    project_id: Some(pid),
                    summary: format!("Off course: {}", note.chars().take(140).collect::<String>()),
                    detail: Some(serde_json::json!({
                        "note": note,
                        "chosen": chosen,
                        "deliveredTo": holder_c,
                        "messageId": message_id,
                    })),
                },
            )
        })
        .await?;
    }

    if let Some(need) = &verdict.needs_agent {
        let spec = CreateAgentSpec {
            name: need.name.trim().to_string(),
            role: need.role.trim().to_string(),
            project_id: Some(project_id.to_string()),
            charter: need.charter.trim().to_string(),
            model: None,
        };
        away_create(app, state, head, &spec, &verdict.note, now).await?;
    }
    if let (Some(minutes), Some(persona)) = (verdict.retune_pacing_minutes, holder) {
        let spec = RetuneAgentSpec {
            persona_id: persona,
            pacing_minutes: Some(minutes),
            note: Some(verdict.note.clone()).filter(|n| !n.is_empty()),
        };
        let (sys, user, h) = (state.db.clone(), state.user_db.clone(), head.clone());
        let pid = project_id.to_string();
        blocking(move || away_retune(&user, &sys, &h, Some(&pid), &spec, now)).await?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Away create / retune
// ---------------------------------------------------------------------------

/// The outcome of an away create or retune.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AwayOutcome<T> {
    /// Done; the event was written.
    Done(T),
    /// The away rules parked it; an `ask_parked` event was written.
    Parked,
}

/// An away act the rules parked, before it is written.
struct ParkedAct {
    class: AwayRuleClass,
    summary: String,
    options: Vec<String>,
    act: serde_json::Value,
}

/// Write the `ask_parked` event of an away act that has no card.
fn park_away_act(
    user_db: &UserDbPool,
    head: &StandupHead,
    project_id: Option<&str>,
    parked: ParkedAct,
    now: i64,
) -> Result<(), AppError> {
    report::append_event(
        user_db,
        &StandupEvent {
            id: report::new_event_id(),
            standup_id: head.id.clone(),
            at: now,
            kind: StandupEventKind::AskParked,
            project_id: project_id.map(str::to_string),
            summary: parked.summary,
            detail: Some(serde_json::json!({
                "class": away_rules::class_token(parked.class),
                "options": parked.options,
                "act": parked.act,
                "resolve": { "kind": RESOLVE_STANDUP },
            })),
        },
    )
}

/// The `build_oneshot` params an away create files. The op's own name
/// derivation is bypassed so the report names what was asked for.
pub fn create_params(spec: &CreateAgentSpec) -> serde_json::Value {
    serde_json::json!({
        "name": spec.name,
        "intent": format!("{}: {}", spec.role.trim(), spec.charter.trim()),
    })
}

/// Create a persona while away, under the away rules.
///
/// Delegated: the persona is created through the existing creation op
/// (`build_oneshot` via the approval executor table, the same path an
/// approved card takes), then an `agent_created` event records it with
/// `origin = standup-away`. Parked: an `ask_parked` event with the options.
pub async fn away_create(
    app: &AppHandle,
    state: &Arc<AppState>,
    head: &StandupHead,
    spec: &CreateAgentSpec,
    reason: &str,
    now: i64,
) -> Result<AwayOutcome<CreatedAgentRef>, AppError> {
    let params = create_params(spec);
    let params_json = params.to_string();
    let class = away_rules::classify(AwayAction::Op {
        action: "build_oneshot",
        params_json: &params_json,
    });
    let project = spec.project_id.clone();
    if away_rules::decide(&head.away_rules, class, None) == AwayDecision::Park {
        let (user, h, name) = (state.user_db.clone(), head.clone(), spec.name.clone());
        let act = serde_json::json!({ "op": "build_oneshot", "params": params, "reason": reason });
        blocking(move || {
            park_away_act(
                &user,
                &h,
                project.as_deref(),
                ParkedAct {
                    class,
                    summary: format!("Parked for you: create agent {name}"),
                    options: vec![format!("Create {name}"), "Skip".into()],
                    act,
                },
                now,
            )
        })
        .await?;
        return Ok(AwayOutcome::Parked);
    }

    let tauri_state = app.state::<Arc<AppState>>();
    let synthetic_id = format!("standup-away-{}", uuid::Uuid::new_v4().simple());
    crate::commands::companion::approvals::execute_approval_action(
        tauri_state,
        app.clone(),
        &synthetic_id,
        "build_oneshot",
        &params,
    )
    .await?;

    let (sys, user, h, name, role) = (
        state.db.clone(),
        state.user_db.clone(),
        head.id.clone(),
        spec.name.clone(),
        spec.role.clone(),
    );
    let reason = reason.to_string();
    blocking(move || {
        let persona_id = newest_persona_named(&sys, &name)?.ok_or_else(|| {
            AppError::Internal(format!(
                "away create: build_oneshot left no persona named `{name}`"
            ))
        })?;
        report::append_event(
            &user,
            &StandupEvent {
                id: report::new_event_id(),
                standup_id: h,
                at: now,
                kind: StandupEventKind::AgentCreated,
                project_id: project.clone(),
                summary: format!("Created {name} while you were away"),
                detail: Some(serde_json::json!({
                    "personaId": persona_id,
                    "name": name,
                    "role": role,
                    "origin": AWAY_ORIGIN,
                    "away": true,
                    "reason": reason,
                })),
            },
        )?;
        Ok(AwayOutcome::Done(CreatedAgentRef {
            persona_id,
            name,
            away: true,
        }))
    })
    .await
}

/// The newest persona with this exact name (the one `build_oneshot` just
/// created: the op does not return its id).
fn newest_persona_named(sys_db: &DbPool, name: &str) -> Result<Option<String>, AppError> {
    use rusqlite::OptionalExtension;
    let conn = sys_db.get()?;
    Ok(conn
        .query_row(
            "SELECT id FROM personas WHERE name = ?1 ORDER BY created_at DESC, rowid DESC LIMIT 1",
            rusqlite::params![name],
            |r| r.get::<_, String>("id"),
        )
        .optional()?)
}

/// Retune an existing charter's pacing while away, under the away rules.
///
/// The charter is the persona's active one bound to `project_id` (else its
/// newest active one). Delegated: its declared cadence
/// (`cadence.interval_minutes`) moves to the spec's pacing, bounded 10..=240,
/// and an `agent_retuned` event records before and after. Parked: an
/// `ask_parked` event. Blocking (DB).
pub fn away_retune(
    user_db: &UserDbPool,
    sys_db: &DbPool,
    head: &StandupHead,
    project_id: Option<&str>,
    spec: &RetuneAgentSpec,
    now: i64,
) -> Result<AwayOutcome<String>, AppError> {
    let Some(minutes) = spec.pacing_minutes else {
        return Err(AppError::Validation(
            "away retune: pacing_minutes is required".into(),
        ));
    };
    let minutes = minutes.clamp(RETUNE_MIN_MINUTES, RETUNE_MAX_MINUTES);
    let class = AwayRuleClass::Retune;
    if away_rules::decide(&head.away_rules, class, None) == AwayDecision::Park {
        park_away_act(
            user_db,
            head,
            project_id,
            ParkedAct {
                class,
                summary: format!(
                    "Parked for you: retune {} to every {minutes} min",
                    spec.persona_id
                ),
                options: vec![format!("Retune to {minutes} min"), "Keep".into()],
                act: serde_json::json!({ "personaId": spec.persona_id, "pacingMinutes": minutes }),
            },
            now,
        )?;
        return Ok(AwayOutcome::Parked);
    }

    let charters =
        crate::db::repos::core::responsibilities::list_by_persona(sys_db, &spec.persona_id, false)?;
    let charter = charters
        .iter()
        .filter(|c| c.status == "active")
        .find(|c| project_id.is_some() && c.project_id.as_deref() == project_id)
        .or_else(|| charters.iter().find(|c| c.status == "active"))
        .ok_or_else(|| {
            AppError::NotFound(format!("active charter for persona {}", spec.persona_id))
        })?;
    let before = charter.cadence.interval_minutes;
    let mut cadence = charter.cadence.clone();
    cadence.interval_minutes = Some(i64::from(minutes));
    crate::db::repos::core::responsibilities::update(
        sys_db,
        &charter.id,
        crate::db::repos::core::responsibilities::UpdateResponsibilityInput {
            cadence: Some(cadence),
            ..Default::default()
        },
    )?;
    report::append_event(
        user_db,
        &StandupEvent {
            id: report::new_event_id(),
            standup_id: head.id.clone(),
            at: now,
            kind: StandupEventKind::AgentRetuned,
            project_id: project_id.map(str::to_string),
            summary: format!("Retuned {} to every {minutes} min", charter.title),
            detail: Some(serde_json::json!({
                "personaId": spec.persona_id,
                "charterId": charter.id,
                "pacingMinutes": minutes,
                "beforeMinutes": before,
                "note": spec.note,
            })),
        },
    )?;
    Ok(AwayOutcome::Done(charter.id.clone()))
}

// ---------------------------------------------------------------------------
// Fleet worker asks (athena.request_guidance / athena.request_approval)
// ---------------------------------------------------------------------------

/// The armed standup's verdict on one blocking fleet-worker ask.
#[derive(Debug, Clone, PartialEq)]
pub struct WorkerJudgment {
    pub standup_id: String,
    pub class: AwayRuleClass,
    pub decision: AwayDecision,
    pub project_id: Option<String>,
}

/// The note a worker receives when its ask is parked.
pub const WORKER_PARK_NOTE: &str = "Parked for the operator under the standup's away rules: \
     skip this step, continue other safe work on your branch, or end the session cleanly. \
     It is listed in the standup report.";

/// Judge a worker's ask under the ARMED standup's away rules. `Ok(None)`
/// when no standup is armed (the legacy night-window path applies). The
/// worker's project is the registered project whose root holds the fleet
/// session's cwd; it scopes the event and is how a push can match a target.
pub fn judge_worker_ask(
    user_db: &UserDbPool,
    sys_db: &DbPool,
    fleet_session_id: &str,
    act: AwayAction<'_>,
) -> Result<Option<WorkerJudgment>, AppError> {
    let Some(head) = report::armed(user_db)? else {
        return Ok(None);
    };
    let project_id = crate::commands::fleet::registry::registry()
        .lookup_meta(fleet_session_id)
        .and_then(|(_label, cwd)| {
            let roots = report::project_roots(user_db, sys_db);
            report::project_for_cwd(&roots, &cwd).map(str::to_string)
        });
    let class = away_rules::classify(act);
    let target = away_rules::push_target_of(act, project_id.as_deref());
    Ok(Some(WorkerJudgment {
        standup_id: head.id.clone(),
        class,
        decision: away_rules::decide(&head.away_rules, class, target.as_ref()),
        project_id,
    }))
}

/// Record a worker ask's outcome as ONE event: `ask_parked` (with options,
/// open until the operator decides at the next standup: the worker itself
/// was answered with [`WORKER_PARK_NOTE`]) or `ask_delegated` (with what
/// Athena answered).
pub fn record_worker_ask(
    user_db: &UserDbPool,
    judgment: &WorkerJudgment,
    request_id: &str,
    ask: &str,
    answer: &str,
    now: i64,
) -> Result<(), AppError> {
    let class = away_rules::class_token(judgment.class);
    let ask_head: String = ask.chars().take(120).collect();
    let (kind, summary, detail) = match judgment.decision {
        AwayDecision::Park => (
            StandupEventKind::AskParked,
            format!("Parked for you: a worker asked to {ask_head} ({class})"),
            serde_json::json!({
                "class": class,
                "ask": ask,
                "requestId": request_id,
                "options": ["Allow it next time", "Keep it parked"],
                "resolve": { "kind": RESOLVE_STANDUP },
            }),
        ),
        AwayDecision::Delegate => (
            StandupEventKind::AskDelegated,
            format!("Answered a worker: {ask_head} ({class})"),
            serde_json::json!({
                "class": class,
                "ask": ask,
                "requestId": request_id,
                "reasoning": answer,
                "decider": "standup away rules",
            }),
        ),
    };
    report::append_event(
        user_db,
        &StandupEvent {
            id: report::new_event_id(),
            standup_id: judgment.standup_id.clone(),
            at: now,
            kind,
            project_id: judgment.project_id.clone(),
            summary,
            detail: Some(detail),
        },
    )
}

/// Settle a worker's `request_approval` under the armed standup: parked ->
/// DENIED with [`WORKER_PARK_NOTE`]; delegated -> APPROVED, naming the rule.
/// Returns `Ok(false)` when no standup is armed (nothing done) and `Ok(true)`
/// once it is settled (or a human answered first, which writes nothing).
pub fn settle_worker_approval(
    user_db: &UserDbPool,
    sys_db: &DbPool,
    request_id: &str,
    fleet_session_id: &str,
    action: &str,
    rationale: &str,
    now: i64,
) -> Result<bool, AppError> {
    let act = AwayAction::WorkerApproval {
        action,
        rationale,
        details_json: None,
    };
    let Some(judgment) = judge_worker_ask(user_db, sys_db, fleet_session_id, act)? else {
        return Ok(false);
    };
    let (approved, note) = match judgment.decision {
        AwayDecision::Park => (false, WORKER_PARK_NOTE.to_string()),
        AwayDecision::Delegate => (
            true,
            format!(
                "Approved under the standup's away rules ({}).",
                away_rules::class_token(judgment.class)
            ),
        ),
    };
    let resolved = crate::companion::orchestration::mcp::pending::resolve(
        request_id,
        Ok(serde_json::json!({ "approved": approved, "note": note })),
    );
    if resolved {
        record_worker_ask(user_db, &judgment, request_id, action, &note, now)?;
    }
    Ok(true)
}

// ---------------------------------------------------------------------------
// The subscription
// ---------------------------------------------------------------------------

/// Run a blocking DB closure off the async workers, surfacing a panic as an
/// error on this work item.
async fn blocking<T, F>(f: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
{
    match tokio::task::spawn_blocking(f).await {
        Ok(r) => r,
        Err(join) if join.is_panic() => Err(AppError::Internal(format!(
            "standup supervisor: blocking step panicked: {}",
            personas_core::utils::extract_panic_message(join.into_panic())
        ))),
        Err(join) => Err(AppError::Internal(format!(
            "standup supervisor: blocking step cancelled: {join}"
        ))),
    }
}

/// The armed plan's supervisor. Register it in
/// `engine/background/lifecycle.rs` beside the attention loop:
/// `Box::new(crate::companion::standup::supervisor::StandupSupervisor::new(app.clone()))`.
pub struct StandupSupervisor {
    app: AppHandle,
    clock: Clock,
    schedule: Mutex<SupervisorSchedule>,
}

impl StandupSupervisor {
    pub fn new(app: AppHandle) -> Self {
        Self::with_clock(app, system_clock())
    }

    pub fn with_clock(app: AppHandle, clock: Clock) -> Self {
        Self {
            app,
            clock,
            schedule: Mutex::new(SupervisorSchedule::default()),
        }
    }

    async fn tick_once(&self) -> Result<(), AppError> {
        let now = (self.clock)();
        let state = self.app.state::<Arc<AppState>>().inner().clone();
        let user = state.user_db.clone();
        let read = blocking(move || {
            let Some(head) = report::armed(&user)? else {
                return Ok(None);
            };
            let hint = report::last_event_at(&user, &head.id, StandupEventKind::Sweep)?;
            Ok(Some((head, hint)))
        })
        .await?;
        let Some((head, sweep_hint)) = read else {
            self.schedule
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .reset();
            return Ok(());
        };
        let armed_at = head.armed_at.unwrap_or(head.opened_at);
        let (due, sweep_since) = {
            let mut s = self.schedule.lock().unwrap_or_else(|e| e.into_inner());
            let prev_sweep = if s.standup_id.as_deref() == Some(head.id.as_str()) {
                s.last_sweep_ms
            } else {
                sweep_hint.unwrap_or(armed_at).max(armed_at)
            };
            (s.due(&head.id, armed_at, sweep_hint, now), prev_sweep)
        };
        if due.sweep {
            let (user, sys, h) = (state.user_db.clone(), state.db.clone(), head.clone());
            if let Err(e) = blocking(move || run_sweep(&user, &sys, &h, sweep_since, now)).await {
                tracing::warn!(standup_id = %head.id, error = %e, "standup supervisor: sweep failed");
            }
        }
        if let Some(since) = due.drift_since {
            run_drift(&self.app, &state, &head, since, now).await;
        }
        Ok(())
    }
}

#[async_trait::async_trait]
impl ReactiveSubscription for StandupSupervisor {
    fn name(&self) -> &'static str {
        "standup_supervisor"
    }

    fn interval(&self) -> Duration {
        POLL_EVERY
    }

    fn initial_delay(&self) -> Duration {
        Duration::from_secs(30)
    }

    async fn tick(&self) {
        if let Err(e) = self.tick_once().await {
            tracing::warn!(error = %e, "standup supervisor: tick failed");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::companion::standup::away_rules::default_rules;
    use crate::companion::standup::model::{AwayRules, StandupPlan, StandupStatus};

    const MIN: i64 = 60_000;

    #[test]
    fn the_schedule_sweeps_every_20_minutes_and_drifts_hourly_from_armed_at() {
        let mut s = SupervisorSchedule::default();
        let armed = 1_000_000;
        assert_eq!(s.due("su", armed, None, armed + 5 * MIN), Due::default());
        assert_eq!(
            s.due("su", armed, None, armed + 20 * MIN),
            Due {
                sweep: true,
                drift_since: None
            }
        );
        assert_eq!(s.due("su", armed, None, armed + 21 * MIN), Due::default());
        assert!(s.due("su", armed, None, armed + 40 * MIN).sweep);
        let at_hour = s.due("su", armed, None, armed + 60 * MIN);
        assert_eq!(
            at_hour,
            Due {
                sweep: true,
                drift_since: Some(armed)
            }
        );
        // The next drift judges from the last one.
        let two = s.due("su", armed, None, armed + 120 * MIN);
        assert_eq!(two.drift_since, Some(armed + 60 * MIN));
    }

    #[test]
    fn a_restart_seeds_the_sweep_from_the_ledger_and_a_new_revision_restarts_both() {
        let mut s = SupervisorSchedule::default();
        let armed = 0;
        // Last sweep was 5 min ago at a "now" of 3 h: no double sweep.
        let now = 180 * MIN;
        let due = s.due("su", armed, Some(now - 5 * MIN), now);
        assert!(!due.sweep);
        assert_eq!(due.drift_since, Some(armed), "drift has no ledger hint");
        // Re-open -> revision 2 armed now: clocks restart.
        assert_eq!(s.due("su-2", now, None, now + MIN), Due::default());
        s.reset();
        assert_eq!(s, SupervisorSchedule::default());
    }

    #[test]
    fn the_injected_clock_drives_the_cadence() {
        let t = Arc::new(std::sync::atomic::AtomicI64::new(0));
        let t2 = t.clone();
        let clock: Clock = Arc::new(move || t2.load(std::sync::atomic::Ordering::SeqCst));
        let mut s = SupervisorSchedule::default();
        let mut sweeps = 0;
        let mut drifts = 0;
        for minute in 0..=180 {
            t.store(minute * MIN, std::sync::atomic::Ordering::SeqCst);
            let d = s.due("su", 0, None, clock());
            sweeps += i32::from(d.sweep);
            drifts += i32::from(d.drift_since.is_some());
        }
        assert_eq!(
            (sweeps, drifts),
            (9, 3),
            "3 h armed = 9 sweeps, 3 drift checks"
        );
    }

    #[test]
    fn the_sweep_counts_stale_held_queued_and_refused_per_project() {
        let f = |p: Option<&str>, state, unfit: Option<i64>| SessionFact {
            project_id: p.map(str::to_string),
            state,
            unfit_since_ms: unfit,
        };
        let facts = vec![
            f(Some("kp"), FleetSessionState::Running, None),
            f(Some("kp"), FleetSessionState::AwaitingInput, None),
            f(Some("kp"), FleetSessionState::Queued, Some(5)),
            f(Some("pof"), FleetSessionState::Stale, None),
            f(Some("pof"), FleetSessionState::Queued, None),
            f(None, FleetSessionState::Exited, None),
        ];
        let refused = HashMap::from([(Some("kp".to_string()), 2), (None, 1)]);
        let (total, per) = summarize_sweep(&facts, &refused);
        assert_eq!(
            total,
            SweepCounts {
                running: 2,
                stale: 1,
                held: 2,
                queued: 2,
                refused: 3
            }
        );
        assert_eq!(per["kp"].held, 2);
        assert_eq!(per["kp"].refused, 2);
        assert_eq!(per["pof"].stale, 1);
        assert_eq!(
            sweep_summary_text(&total),
            "Sweep: 2 running, 1 stale, 2 held, 2 queued, 3 refused"
        );
    }

    fn head_with(rules: AwayRules) -> StandupHead {
        StandupHead {
            id: "su-1".into(),
            revision: 1,
            status: StandupStatus::Armed,
            opened_at: 0,
            armed_at: Some(0),
            plan: StandupPlan::default(),
            away_rules: rules,
        }
    }

    #[test]
    fn a_sweep_writes_one_summarising_event() {
        let pool = crate::db::init_test_user_db().unwrap();
        let head = head_with(default_rules());
        report::append_event(
            &pool,
            &StandupEvent {
                id: report::new_event_id(),
                standup_id: "su-1".into(),
                at: 50,
                kind: StandupEventKind::Stop,
                project_id: Some("kp".into()),
                summary: "refused: a headless master holds kp".into(),
                detail: Some(serde_json::json!({"itemId": "i1", "reason": "headless_master"})),
            },
        )
        .unwrap();
        // A refusal before the window does not count again.
        report::append_event(
            &pool,
            &StandupEvent {
                id: report::new_event_id(),
                standup_id: "su-1".into(),
                at: 5,
                kind: StandupEventKind::Stop,
                project_id: Some("kp".into()),
                summary: "older refusal".into(),
                detail: Some(serde_json::json!({"itemId": "i0", "reason": "headless_master"})),
            },
        )
        .unwrap();
        let sys = crate::db::init_test_db().unwrap();
        let total = run_sweep(&pool, &sys, &head, 10, 100).unwrap();
        assert_eq!(total.refused, 1);
        let evs = report::list_events(&pool, "su-1", 10).unwrap();
        let sweeps: Vec<_> = evs
            .iter()
            .filter(|e| e.kind == StandupEventKind::Sweep)
            .collect();
        assert_eq!(sweeps.len(), 1);
        assert!(sweeps[0].summary.starts_with("Sweep: "));
        assert_eq!(
            sweeps[0].detail.as_ref().unwrap()["projects"]["kp"]["refused"],
            1
        );
    }

    #[test]
    fn the_drift_verdict_parses_bounds_and_rejects_a_silent_off_course() {
        let v = parse_drift_verdict(
            "Here you go:\n{\"onCourse\": false, \"note\": \" Stop the refactor; ship the importer. \", \
             \"needsAgent\": {\"name\":\"Importer QA\",\"role\":\"qa\",\"charter\":\"own importer tests\"}, \
             \"retunePacingMinutes\": 5}",
        )
        .expect("contract");
        assert!(!v.on_course);
        assert_eq!(v.note, "Stop the refactor; ship the importer.");
        assert_eq!(v.retune_pacing_minutes, Some(10), "bounded");
        assert_eq!(v.needs_agent.unwrap().name, "Importer QA");
        assert_eq!(
            parse_drift_verdict(r#"{"onCourse": true}"#).map(|v| v.on_course),
            Ok(true)
        );
        let silent = parse_drift_verdict(r#"{"onCourse": false, "note": ""}"#).unwrap_err();
        assert!(silent.contains("without a note"), "{silent}");
        let prose = parse_drift_verdict("no json").unwrap_err();
        assert!(
            prose.contains("no json"),
            "the reason carries the reply head: {prose}"
        );
        let empty_need = parse_drift_verdict(
            r#"{"onCourse": true, "needsAgent": {"name":"","role":"x","charter":""}}"#,
        )
        .unwrap();
        assert!(empty_need.needs_agent.is_none());
    }

    #[test]
    fn the_drift_prompt_carries_the_direction_commits_and_notes() {
        let p = drift_prompt(&DriftEvidence {
            project_id: "kp".into(),
            chosen: vec!["ship the importer".into()],
            commits: vec!["abc123 feat: importer".into()],
            notes: vec![],
        });
        assert!(p.contains("ship the importer"));
        assert!(p.contains("abc123 feat: importer"));
        assert!(p.contains("(none)"));
        assert!(p.contains("\"onCourse\""));
    }

    #[test]
    fn a_parked_retune_writes_ask_parked_and_touches_no_charter() {
        let user = crate::db::init_test_user_db().unwrap();
        let sys = crate::db::init_test_db().unwrap();
        let mut rules = default_rules();
        rules.delegate.retain(|c| *c != AwayRuleClass::Retune);
        rules.park.push(AwayRuleClass::Retune);
        let head = head_with(rules);
        let spec = RetuneAgentSpec {
            persona_id: "p-1".into(),
            pacing_minutes: Some(30),
            note: None,
        };
        let out = away_retune(&user, &sys, &head, Some("kp"), &spec, 7).unwrap();
        assert_eq!(out, AwayOutcome::Parked);
        let evs = report::list_events(&user, "su-1", 10).unwrap();
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].kind, StandupEventKind::AskParked);
        assert_eq!(
            evs[0].detail.as_ref().unwrap()["resolve"]["kind"],
            "standup"
        );
    }

    #[test]
    fn a_delegated_retune_without_a_charter_is_not_found_and_writes_nothing() {
        let user = crate::db::init_test_user_db().unwrap();
        let sys = crate::db::init_test_db().unwrap();
        let head = head_with(default_rules());
        let spec = RetuneAgentSpec {
            persona_id: "nobody".into(),
            pacing_minutes: Some(30),
            note: None,
        };
        assert!(matches!(
            away_retune(&user, &sys, &head, None, &spec, 7),
            Err(AppError::NotFound(_))
        ));
        assert!(report::list_events(&user, "su-1", 10).unwrap().is_empty());
    }

    #[test]
    fn create_params_name_the_agent_and_classify_as_create_agent() {
        let spec = CreateAgentSpec {
            name: "Importer QA".into(),
            role: "qa".into(),
            project_id: Some("kp".into()),
            charter: "own the importer tests".into(),
            model: None,
        };
        let p = create_params(&spec);
        assert_eq!(p["name"], "Importer QA");
        assert_eq!(p["intent"], "qa: own the importer tests");
        let class = away_rules::classify(AwayAction::Op {
            action: "build_oneshot",
            params_json: &p.to_string(),
        });
        assert_eq!(class, AwayRuleClass::CreateAgent);
        assert_eq!(
            away_rules::decide(&default_rules(), class, None),
            AwayDecision::Delegate
        );
    }

    fn arm_standup(user: &UserDbPool, id: &str) -> Result<(), AppError> {
        user.get()?
            .execute(
                "INSERT INTO companion_standup
                   (id, revision, status, device_id, opened_at, armed_at, plan_json, away_rules_json)
                 VALUES (?1, 1, 'armed', 'dev-1', 0, 0, '{\"items\":[]}', ?2)",
                rusqlite::params![id, serde_json::to_string(&default_rules()).unwrap()],
            )?;
        Ok(())
    }

    #[tokio::test]
    async fn a_worker_approval_under_an_armed_standup_is_parked_or_approved_by_class() {
        use crate::companion::orchestration::mcp::pending::{self, RequestKind};
        let user = crate::db::init_test_user_db().unwrap();
        let sys = crate::db::init_test_db().unwrap();

        // No standup armed: nothing is done, the legacy path applies.
        let (rid, _rx0) = pending::submit("fleet-x", RequestKind::Approval);
        assert!(!settle_worker_approval(
            &user,
            &sys,
            &rid,
            "fleet-x",
            "drop table users",
            "cleanup",
            1
        )
        .unwrap());
        assert!(pending::is_pending(&rid), "left untouched");
        pending::resolve(&rid, Err("test cleanup".into()));

        arm_standup(&user, "su-w").unwrap();
        // A schema act parks: the worker hears DENIED + the park note.
        let (rid, rx) = pending::submit("fleet-x", RequestKind::Approval);
        assert!(settle_worker_approval(
            &user,
            &sys,
            &rid,
            "fleet-x",
            "drop table users",
            "cleanup",
            2
        )
        .unwrap());
        let reply = rx.await.unwrap().unwrap();
        assert_eq!(reply["approved"], false);
        assert_eq!(reply["note"], WORKER_PARK_NOTE);

        // A dependency bump is delegated: approved, naming the rule.
        let (rid, rx) = pending::submit("fleet-x", RequestKind::Approval);
        assert!(settle_worker_approval(
            &user,
            &sys,
            &rid,
            "fleet-x",
            "bump vite to 8.1",
            "HMR leak",
            3
        )
        .unwrap());
        let reply = rx.await.unwrap().unwrap();
        assert_eq!(reply["approved"], true);

        let evs = report::list_events(&user, "su-w", 10).unwrap();
        let kinds: Vec<_> = evs.iter().map(|e| e.kind).collect();
        assert_eq!(
            kinds,
            vec![StandupEventKind::AskDelegated, StandupEventKind::AskParked]
        );
        assert_eq!(evs[1].detail.as_ref().unwrap()["class"], "schema");
        // The parked worker ask stays open in the report until the standup ends.
        let r = report::build(&user, "su-w").unwrap();
        let unscoped = r
            .projects
            .iter()
            .find(|p| p.project_id == report::UNSCOPED_PROJECT_ID)
            .unwrap();
        assert_eq!(unscoped.parked.len(), 1);
    }
}
