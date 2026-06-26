//! Design D — the deliberation governance core (D2).
//!
//! The PURE state machine that bounds a deliberation by PROGRESS rather than a
//! turn count (decision 5): an agenda backbone, stall accounting, rate-shaping,
//! and hard cost/idle floors. The moderator (a Haiku call, added in D2b)
//! proposes a [`ModeratorDecision`] each tick; [`plan_transition`] turns that
//! decision — together with the current state — into a deterministic
//! [`Transition`] the subscription applies. Keeping this layer pure (no DB, no
//! LLM) makes it the unit-test surface the whole feature's safety rests on.
//!
//! See docs/plans/team-deliberation-engine.md §3, §6.

use std::sync::Arc;
use std::time::Duration;

use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use tauri::{AppHandle, Manager};

use crate::db::models::{DeliberationAgendaItem, ProposalSpec, TeamDeliberation};
use crate::db::repos::resources::{
    deliberation as deliberation_repo, team_channel as team_channel_repo,
};
use crate::db::settings_keys::AUTONOMOUS_DELIBERATION;
use crate::db::DbPool;
use crate::engine::subscription::{quota_cooldown_active, ReactiveSubscription};
use crate::error::AppError;

// ── Governance constants (tuned in D2/D7; see plan §12) ─────────────────────

/// Consecutive non-productive rounds before the moderator is forced to escalate
/// to the user. The circularity bound that replaces the turn budget.
pub const STALL_LIMIT: i32 = 3;
/// Max persona turns advanced per tick — rate-shaping. Uncapped total length,
/// bounded cost/time per unit of wall-clock. THE mechanism that makes a
/// turn-budget-free deliberation safe.
pub const MAX_TURNS_PER_TICK: usize = 3;
/// A single persona may not speak more than this many times in a row.
pub const MAX_CONSECUTIVE_PERSONA_TURNS: usize = 2;
/// Force a resolution (synthesize a proposal from the current state) by this
/// round if the moderator hasn't converged on its own — a productive
/// deliberation must still PRODUCE an outcome rather than run out a budget with
/// nothing. Generous so genuinely long conversations are allowed; this is a
/// safety net, not a tight cap. (The cooperation cert surfaced under-convergence
/// — a run with 5/5 cooperation that never declared `converged` and ended with
/// no proposal.)
pub const CONVERGE_BY_ROUND: i32 = 12;
/// Default cost ceiling (USD) when a deliberation declares none.
pub const DEFAULT_COST_BUDGET_USD: f64 = 5.0;
/// Default idle window (minutes) — no progress and no user activity past this
/// auto-pauses the deliberation.
pub const DEFAULT_IDLE_MINUTES: i64 = 180;

// ── The moderator's decision (the JSON protocol it returns) ─────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum RoundOutcome {
    /// Conservative default: an unparseable / silent round counts as a stall.
    #[default]
    Stalled,
    Progressed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ModeratorAction {
    #[default]
    Discuss,
    InvokeCapability,
    SpawnAssignment,
    EscalateToUser,
    Conclude,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum StatusSignal {
    #[default]
    Continue,
    Converged,
    Stuck,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgendaResolution {
    pub id: String,
    #[serde(default)]
    pub resolution: String,
}

/// One moderator decision — selective routing + agenda curation + a progress
/// verdict. Mirrors the `{"deliberation": {...}}` protocol (plan §3). All
/// fields are `#[serde(default)]` so a partial / sloppy LLM object still
/// deserializes (the conservative defaults — `Stalled`, `Discuss`, `Continue`
/// — fail safe).
#[derive(Debug, Clone, Deserialize, Default)]
pub struct ModeratorDecision {
    #[serde(default)]
    pub next_speakers: Vec<String>,
    #[serde(default)]
    pub agenda_add: Vec<String>,
    #[serde(default)]
    pub agenda_resolve: Vec<AgendaResolution>,
    #[serde(default)]
    pub round_outcome: RoundOutcome,
    #[serde(default)]
    pub action: ModeratorAction,
    #[serde(default)]
    pub status: StatusSignal,
    #[serde(default)]
    pub reason: String,
}

/// Envelope: the model wraps its decision in `{"deliberation": {...}}`.
#[derive(Debug, Clone, Deserialize)]
pub struct ModeratorEnvelope {
    pub deliberation: ModeratorDecision,
}

// ── Deliberation status (the persisted `status` column, typed) ──────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliberationStatus {
    Open,
    Converging,
    Resolved,
    Escalated,
    Paused,
    Aborted,
}

impl DeliberationStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Converging => "converging",
            Self::Resolved => "resolved",
            Self::Escalated => "escalated",
            Self::Paused => "paused",
            Self::Aborted => "aborted",
        }
    }
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Resolved | Self::Aborted)
    }
}

// ── Hard floors ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FloorBreach {
    /// Cost ceiling exceeded.
    Cost,
    /// Idle deadline passed with no progress / no user activity.
    Idle,
}

/// Check the hard floors. `now_rfc3339` and `idle_deadline` are compared
/// lexically — both are normalized RFC3339 UTC (sortable). Cost ceiling falls
/// back to [`DEFAULT_COST_BUDGET_USD`] when the deliberation declared none.
pub fn floor_breach(
    cost_spent_usd: f64,
    cost_budget_usd: Option<f64>,
    idle_deadline: Option<&str>,
    now_rfc3339: &str,
) -> Option<FloorBreach> {
    let budget = cost_budget_usd.unwrap_or(DEFAULT_COST_BUDGET_USD);
    if budget > 0.0 && cost_spent_usd >= budget {
        return Some(FloorBreach::Cost);
    }
    if let Some(deadline) = idle_deadline {
        if now_rfc3339 >= deadline {
            return Some(FloorBreach::Idle);
        }
    }
    None
}

// ── The transition (pure) ───────────────────────────────────────────────────

/// What the subscription should do after applying a moderator decision.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TickOutcome {
    /// Keep going — run these persona turns (already capped + filtered).
    Continue { speakers: Vec<String> },
    /// Hand to the user (stall limit hit, moderator asked, or stuck).
    Escalate { reason: &'static str },
    /// The agenda is clear / the moderator converged — synthesize a proposal.
    Resolve { reason: &'static str },
    /// A backstop tripped — park the deliberation.
    Pause { reason: &'static str },
}

/// The persisted progress the transition reasons over.
#[derive(Debug, Clone, Copy)]
pub struct DeliberationProgress {
    pub round: i32,
    pub consecutive_stall_rounds: i32,
}

/// The deterministic next state + action for one tick.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Transition {
    pub status: DeliberationStatus,
    pub round: i32,
    pub consecutive_stall_rounds: i32,
    pub outcome: TickOutcome,
}

/// Fold a moderator decision into the next state. `open_agenda_after` is the
/// count of open agenda items AFTER the decision's agenda edits are applied
/// (0 ⇒ the conversation is done). `last_speaker` is who spoke most recently
/// (anti-self-loop). Pure — no DB, no clock.
pub fn plan_transition(
    progress: DeliberationProgress,
    decision: &ModeratorDecision,
    open_agenda_after: usize,
    last_speaker: Option<&str>,
    result_pending: bool,
) -> Transition {
    let round = progress.round + 1;
    // A freshly-returned capability result IS progress, and the team must react
    // to it before the deliberation may end (Fix 1/4: stop resolving/escalating
    // while paid-for work is undiscussed). The round-cap backstop below still
    // applies so this can't loop forever.
    let stall = if result_pending {
        0
    } else {
        match decision.round_outcome {
            RoundOutcome::Progressed => 0,
            RoundOutcome::Stalled => progress.consecutive_stall_rounds + 1,
        }
    };

    // Termination precedence (highest first):
    // 1. Converged / concluded / empty agenda → resolve — UNLESS a capability
    //    result just landed and hasn't been discussed (force a reaction round).
    if !result_pending
        && (decision.status == StatusSignal::Converged
            || decision.action == ModeratorAction::Conclude
            || open_agenda_after == 0)
    {
        return Transition {
            status: DeliberationStatus::Resolved,
            round,
            consecutive_stall_rounds: stall,
            outcome: TickOutcome::Resolve {
                reason: if open_agenda_after == 0 {
                    "agenda_clear"
                } else {
                    "converged"
                },
            },
        };
    }
    // 2. Stall limit / explicit escalate / stuck → escalate to user. Never while
    //    a result is pending discussion (the team isn't stuck, it has new data).
    if !result_pending
        && (stall >= STALL_LIMIT
            || decision.action == ModeratorAction::EscalateToUser
            || decision.status == StatusSignal::Stuck)
    {
        let reason = if stall >= STALL_LIMIT {
            "stall_limit"
        } else {
            "moderator_escalation"
        };
        return Transition {
            status: DeliberationStatus::Escalated,
            round,
            consecutive_stall_rounds: stall,
            outcome: TickOutcome::Escalate { reason },
        };
    }
    // 3. Round cap → force a resolution (synthesize a proposal from what's
    //    there) so a productive-but-unconverged deliberation still ships an
    //    outcome rather than ending empty.
    if round >= CONVERGE_BY_ROUND {
        return Transition {
            status: DeliberationStatus::Resolved,
            round,
            consecutive_stall_rounds: stall,
            outcome: TickOutcome::Resolve {
                reason: "round_cap",
            },
        };
    }
    // 4. Continue — select the key personas (capped, deduped, anti-self-loop).
    let speakers = select_speakers(&decision.next_speakers, last_speaker);
    Transition {
        status: DeliberationStatus::Open,
        round,
        consecutive_stall_rounds: stall,
        outcome: TickOutcome::Continue { speakers },
    }
}

/// Cap to [`MAX_TURNS_PER_TICK`], dedupe (preserve order), drop blanks, and drop
/// the immediately-previous speaker when it would be the *sole* pick — so one
/// persona can't monologue tick-after-tick (anti-self-loop).
fn select_speakers(requested: &[String], last_speaker: Option<&str>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out: Vec<String> = Vec::new();
    for s in requested {
        let s = s.trim();
        if s.is_empty() {
            continue;
        }
        if seen.insert(s.to_string()) {
            out.push(s.to_string());
        }
        if out.len() >= MAX_TURNS_PER_TICK {
            break;
        }
    }
    if let Some(prev) = last_speaker {
        if out.len() == 1 && out[0] == prev {
            out.clear();
        }
    }
    out
}

/// Map a moderator-supplied speaker token to a canonical roster persona id. The
/// LLM is imprecise — it may return a display name ("QA Guardian"), a guessed
/// snake_case id ("dev_clone"), or the real id. Match by exact id, then by
/// normalized (alphanumeric-lowercased) id/name. `None` if nothing matches (a
/// hallucinated persona is dropped, not run). Without this the routed persona is
/// silently skipped — a real bug the live harness surfaced.
pub fn resolve_speaker(requested: &str, roster: &[RosterMember]) -> Option<String> {
    let req = requested.trim();
    if req.is_empty() {
        return None;
    }
    if let Some(m) = roster.iter().find(|m| m.id == req) {
        return Some(m.id.clone());
    }
    let norm = |s: &str| -> String {
        s.chars()
            .filter(|c| c.is_alphanumeric())
            .flat_map(|c| c.to_lowercase())
            .collect()
    };
    let nreq = norm(req);
    roster
        .iter()
        .find(|m| norm(&m.id) == nreq || norm(&m.name) == nreq)
        .map(|m| m.id.clone())
}

// ── The moderator (Haiku) + the deliberation tick (D2b) ─────────────────────

/// A persona as the moderator sees it — enough to route by relevance.
pub struct RosterMember {
    pub id: String,
    pub name: String,
    /// Raw `core_profile` JSON (a [`crate::db::models::PersonaCore`]) when
    /// authored (D5), else `None`.
    pub core_profile: Option<String>,
}

/// Everything the moderator reasons over for one tick. Plain data so
/// [`build_moderator_prompt`] stays pure + testable.
pub struct ModeratorContext {
    pub topic: String,
    pub goal: Option<String>,
    /// Raw `north_star` JSON (a [`crate::db::models::TeamNorthStar`]) when
    /// authored (D5), else `None`.
    pub north_star: Option<String>,
    pub roster: Vec<RosterMember>,
    /// Open agenda items oldest-first: (id, text).
    pub open_agenda: Vec<(String, String)>,
    /// Recent turns oldest-first: (author_label, body).
    pub recent_turns: Vec<(String, String)>,
    /// A capability result (🛠) or failure (⚠) just landed as the newest turn and
    /// the team hasn't reacted yet — block convergence/escalation for one round.
    pub result_pending: bool,
}

/// The moderator (orchestrator) runs on Opus — promoted from Haiku to test how
/// far a more capable conversation manager pushes flow efficiency. Reasoning
/// effort isn't exposed on the headless `claude -p` path, so it runs at default.
pub const MODERATOR_MODEL: &str = "claude-opus-4-8";
/// Track (child) moderator — Sonnet. A track is one scoped checklist item, so a
/// cheaper conversation manager suffices; keeps the Opus tax on the parent only.
pub const TRACK_MODERATOR_MODEL: &str = "claude-sonnet-4-6";
/// Max deliberations advanced per tick — bounds a cold-start fan-out.
const MAX_DELIBERATIONS_PER_TICK: usize = 8;
/// Recent turns shown to the moderator.
const MODERATOR_TURN_WINDOW: i64 = 12;

/// Build the moderator prompt. The moderator is a CONVERSATION MANAGER, not a
/// participant: it routes the key personas, curates the agenda, judges whether
/// the round made progress, and biases toward action. Pure + testable.
pub fn build_moderator_prompt(ctx: &ModeratorContext) -> String {
    use std::fmt::Write as _;
    let mut p = String::new();
    let _ = writeln!(
        p,
        "You are the MODERATOR of an autonomous team deliberation. You have no opinions of your own — you route the conversation, curate its agenda, judge whether it is making progress, and push it toward concrete decisions and tasks. Be SELECTIVE: pick only the 1-3 team members whose point of view most moves the current open agenda item forward. Never route the whole roster. ROTATE VOICES: a deliberation needs its distinct cores in tension — prefer a relevant member who has NOT yet spoken on the current open item over re-hearing the same person, and never route one lone member two rounds running (that is a monologue, not a deliberation)."
    );
    let _ = writeln!(p, "\n## TOPIC\n{}", ctx.topic);
    if let Some(goal) = &ctx.goal {
        let _ = writeln!(p, "\n## DESIRED OUTCOME\n{goal}");
    }
    if let Some(ns) = &ctx.north_star {
        let _ = writeln!(p, "\n## TEAM NORTH STAR (shared)\n{ns}");
    }
    let _ = writeln!(p, "\n## TEAM MEMBERS (route by their core)");
    for m in &ctx.roster {
        match &m.core_profile {
            Some(core) => {
                let _ = writeln!(p, "- {} ({}): {}", m.name, m.id, core);
            }
            None => {
                let _ = writeln!(p, "- {} ({})", m.name, m.id);
            }
        }
    }
    let _ = writeln!(p, "\n## OPEN AGENDA");
    if ctx.open_agenda.is_empty() {
        let _ = writeln!(p, "(empty — if the topic is settled, conclude)");
    } else {
        for (id, item) in &ctx.open_agenda {
            let _ = writeln!(p, "- [{id}] {item}");
        }
    }
    let _ = writeln!(p, "\n## RECENT CONVERSATION");
    if ctx.recent_turns.is_empty() {
        let _ = writeln!(p, "(none yet — open the agenda and pick who speaks first)");
    } else {
        for (who, body) in &ctx.recent_turns {
            let line = body.replace(['\n', '\r'], " ");
            let line = if line.chars().count() > 240 {
                line.chars().take(240).collect::<String>() + "…"
            } else {
                line
            };
            let _ = writeln!(p, "- {who}: {line}");
        }
    }
    if ctx.result_pending {
        let _ = writeln!(
            p,
            "\n## A RESULT JUST LANDED\nThe newest message is a capability result (🛠) or a failed attempt (⚠). Route ONE round for the most relevant member to react to it — pull out the decision it implies, or note the gap if it failed. Do NOT converge or escalate this round; the team must build on this data first. Never re-request a capability that already ran or failed above."
        );
    }
    let _ = writeln!(
        p,
        "\n## YOUR DECISION\nReturn EXACTLY one JSON object, no prose:"
    );
    let _ = writeln!(
        p,
        r#"{{"deliberation": {{"next_speakers": ["<exact id from the TEAM MEMBERS parentheses, e.g. qa>"], "agenda_add": ["<new open question>"], "agenda_resolve": [{{"id": "<agenda item id>", "resolution": "<decision>"}}], "round_outcome": "progressed" | "stalled", "action": "discuss" | "invoke_capability" | "spawn_assignment" | "escalate_to_user" | "conclude", "status": "continue" | "converged" | "stuck", "reason": "<one line>"}}}}"#
    );
    let _ = writeln!(
        p,
        "\nRules: mark 'progressed' if this round produced a decision, a task, genuinely new information, OR a participant MOVED their position, narrowed the disagreement, or put a new concrete option on the table — a stance shift toward common ground IS progress, not restating. Mark 'stalled' only when a round merely repeats already-settled points or circles without moving any position. Prefer 'invoke_capability'/'spawn_assignment' when an open item is better answered by doing than by more discussion. Bias toward CONVERGING: as soon as the team has a workable decision (even if minor sub-questions remain open), set status:'converged' to lock it into a proposal — do NOT keep deliberating once the core decision is clear. next_speakers MUST be the exact ids shown in parentheses in TEAM MEMBERS (e.g. 'qa', 'engineer') — never the display names. Bias to ACTION over process: if a member has announced it will run a capability across rounds with no result ever appearing, that capability is unavailable — stop routing for it and converge or move to the next item. Never spend rounds debating whether you *can* act, or re-running work the team already has results for."
    );
    p
}

/// Extract the `{"deliberation": {...}}` object from possibly-prose output,
/// reusing the channel decision's tolerant brace-matcher. `None` when no
/// well-formed envelope is present (the caller falls back to a safe default).
pub fn parse_decision(blob: &str) -> Option<ModeratorDecision> {
    let marker = "\"deliberation\"";
    let mut result = None;
    let mut from = 0;
    while let Some(rel) = blob[from..].find(marker) {
        let pos = from + rel;
        from = pos + marker.len();
        let Some(open) = blob[..pos].rfind('{') else {
            continue;
        };
        if let Some(close) = crate::companion::athena_reaction::match_braces(&blob[open..]) {
            let candidate = &blob[open..open + close + 1];
            if let Ok(env) = serde_json::from_str::<ModeratorEnvelope>(candidate) {
                result = Some(env.deliberation);
            }
        }
    }
    result
}

/// The moderator model for a deliberation: Opus on the top-level parent (the
/// hard conversation-management + cross-track synthesis), Sonnet on child tracks
/// (a single scoped checklist item — cheaper, still capable). Cost lever: tracks
/// dominate the call volume when a deliberation splits, so this is where the
/// Opus tax is biggest.
pub fn moderator_model_for(delib: &TeamDeliberation) -> &'static str {
    if delib.parent_id.is_some() {
        TRACK_MODERATOR_MODEL
    } else {
        MODERATOR_MODEL
    }
}

/// Run one moderation decision. Records a `companion_turn` ledger row (audit) and
/// returns the decision plus the call's `cost_usd` (for the deliberation's cost
/// meter). An unparseable reply degrades to [`ModeratorDecision::default`] — a
/// `stalled` round with no speakers, which the governance treats conservatively.
pub async fn run_moderator(
    ctx: &ModeratorContext,
    user_db: &crate::db::UserDbPool,
    model: &str,
) -> Result<(ModeratorDecision, Option<f64>), AppError> {
    let prompt = build_moderator_prompt(ctx);
    let (blob, cost) = crate::companion::athena_reaction::cli_decision_with_model(
        prompt,
        user_db,
        "deliberation_moderate",
        model,
    )
    .await?;
    Ok((parse_decision(&blob).unwrap_or_default(), cost))
}

fn author_label(author_kind: &str) -> &'static str {
    match author_kind {
        "user" => "User",
        "athena" => "Athena",
        "director" => "Director",
        "persona" => "Teammate",
        _ => "System",
    }
}

/// Design D — the deliberation tick. Advances each open team deliberation by a
/// bounded number of persona turns (rate-shaping); the Haiku moderator routes
/// the key personas + curates the agenda; progress/stall + cost/idle floors
/// bound it (no turn budget). Default-OFF (`AUTONOMOUS_DELIBERATION`). The LLM
/// stays OUT of the execution tick loop — this is a separate, budgeted,
/// moderated loop that (in D4) emits work into the deterministic engine.
pub struct DeliberationSubscription {
    pub pool: DbPool,
    pub app: AppHandle,
}

/// Gather the moderator context for one deliberation: roster (+ authored cores),
/// team north star, open agenda, recent turns, and the last speaker
/// (anti-self-loop).
fn build_moderator_context(
    pool: &DbPool,
    delib: &TeamDeliberation,
) -> Result<(ModeratorContext, Option<String>), AppError> {
    let conn = pool.get()?;
    let mut stmt =
        conn.prepare("SELECT id, name, core_profile FROM personas WHERE home_team_id = ?1")?;
    let full_roster = stmt
        .query_map(params![delib.team_id], |r| {
            Ok(RosterMember {
                id: r.get(0)?,
                name: r.get(1)?,
                core_profile: r.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::Database)?;
    drop(stmt);

    // Track scope: a track deliberation restricts the roster to its assigned
    // personas (only when at least one matches — never strand a track with an
    // empty roster).
    let roster = match delib
        .roster_ids
        .as_deref()
        .and_then(|j| serde_json::from_str::<Vec<String>>(j).ok())
    {
        Some(ids)
            if !ids.is_empty()
                && full_roster.iter().any(|m| ids.iter().any(|x| x == &m.id)) =>
        {
            let set: std::collections::HashSet<String> = ids.into_iter().collect();
            full_roster
                .into_iter()
                .filter(|m| set.contains(&m.id))
                .collect()
        }
        _ => full_roster,
    };

    let north_star: Option<String> = conn
        .query_row(
            "SELECT north_star FROM persona_teams WHERE id = ?1",
            params![delib.team_id],
            |r| r.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(AppError::Database)?
        .flatten();

    let open_agenda = deliberation_repo::list_agenda(pool, &delib.id)?
        .into_iter()
        .filter(|a| a.status == "open")
        .map(|a| (a.id, a.item))
        .collect::<Vec<_>>();

    let turns = team_channel_repo::list_for_deliberation(pool, &delib.id, MODERATOR_TURN_WINDOW)?;
    let last_speaker = turns
        .iter()
        .find(|t| t.author_kind == "persona")
        .and_then(|t| t.author_id.clone());
    let recent_turns = turns
        .into_iter()
        .rev()
        .map(|t| (author_label(&t.author_kind).to_string(), t.body))
        .collect::<Vec<_>>();

    // A capability result/failure as the newest turn that no one has answered.
    let result_pending = recent_turns
        .last()
        .map(|(_, b)| b.starts_with('🛠') || b.starts_with('⚠'))
        .unwrap_or(false);

    Ok((
        ModeratorContext {
            topic: delib.topic.clone(),
            goal: delib.goal.clone(),
            north_star,
            roster,
            open_agenda,
            recent_turns,
            result_pending,
        },
        last_speaker,
    ))
}

/// Advance ONE deliberation by a single moderated round — the unit the
/// subscription loops over and the on-demand `advance_team_deliberation` command
/// invokes. Best-effort persona turns; surfaces context / moderator errors so an
/// explicit (user-initiated) caller can show them.
pub async fn advance_one_deliberation(
    pool: &DbPool,
    user_db: &crate::db::UserDbPool,
    delib: &TeamDeliberation,
) -> Result<(), AppError> {
    // Hard floors first (cost / idle) → pause and wait for the user.
    let now = chrono::Utc::now().to_rfc3339();
    if let Some(breach) = floor_breach(
        delib.cost_spent_usd,
        delib.cost_budget_usd,
        delib.idle_deadline.as_deref(),
        &now,
    ) {
        let _ = deliberation_repo::update_progress(
            pool,
            &delib.id,
            delib.round,
            delib.consecutive_stall_rounds,
            DeliberationStatus::Paused.as_str(),
        );
        tracing::info!(deliberation_id = %delib.id, ?breach, "deliberation: floor breach — paused");
        return Ok(());
    }

    let (ctx, last_speaker) = build_moderator_context(pool, delib)?;
    let (mut decision, cost) = run_moderator(&ctx, user_db, moderator_model_for(delib)).await?;
    if let Some(c) = cost {
        let _ = deliberation_repo::add_cost(pool, &delib.id, c);
    }
    for item in &decision.agenda_add {
        let _ = deliberation_repo::add_agenda_item(pool, &delib.id, item, Some("moderator"));
    }
    for res in &decision.agenda_resolve {
        let _ =
            deliberation_repo::resolve_agenda_item(pool, &res.id, "resolved", Some(res.resolution.as_str()));
    }
    let open_after = deliberation_repo::count_open_agenda(pool, &delib.id).unwrap_or(0) as usize;
    decision.next_speakers = decision
        .next_speakers
        .iter()
        .filter_map(|s| resolve_speaker(s, &ctx.roster))
        .collect();

    let progress = DeliberationProgress {
        round: delib.round,
        consecutive_stall_rounds: delib.consecutive_stall_rounds,
    };
    let t = plan_transition(
        progress,
        &decision,
        open_after,
        last_speaker.as_deref(),
        ctx.result_pending,
    );

    match t.outcome {
        TickOutcome::Continue { mut speakers } => {
            // A forced reaction round (a result just landed) must route someone
            // even if the moderator tried to converge with no speakers.
            if speakers.is_empty() && ctx.result_pending {
                if let Some(m) = ctx
                    .roster
                    .iter()
                    .find(|m| Some(m.id.as_str()) != last_speaker.as_deref())
                    .or_else(|| ctx.roster.first())
                {
                    speakers.push(m.id.clone());
                }
            }
            let _ = deliberation_repo::update_progress(
                pool,
                &delib.id,
                t.round,
                t.consecutive_stall_rounds,
                t.status.as_str(),
            );
            for sp in &speakers {
                match run_persona_deliberation_turn(pool, user_db, delib, sp, ctx.north_star.as_deref()).await {
                    Ok(TurnOutcome::RequestedAction(action)) => {
                        // Park on the gated capability — no more speakers this tick.
                        if let Ok(json) = serde_json::to_string(&action) {
                            let _ = deliberation_repo::set_pending_action(pool, &delib.id, &json);
                            let _ = team_channel_repo::post_deliberation_turn(
                                pool,
                                &delib.id,
                                &delib.team_id,
                                "system",
                                None,
                                &format!(
                                    "⏸ {} wants to run “{}” — awaiting your approval.",
                                    action.persona_name, action.use_case_title
                                ),
                            );
                        }
                        break;
                    }
                    Ok(TurnOutcome::Spoke) => {}
                    Err(e) => {
                        tracing::warn!(deliberation_id = %delib.id, persona_id = %sp, error = %e, "deliberation: persona turn failed");
                    }
                }
            }
        }
        TickOutcome::Escalate { reason } => {
            let _ = deliberation_repo::update_progress(
                pool,
                &delib.id,
                t.round,
                t.consecutive_stall_rounds,
                t.status.as_str(),
            );
            tracing::info!(deliberation_id = %delib.id, reason, "deliberation: escalated to user");
        }
        TickOutcome::Resolve { reason } => {
            let proposal = synthesize_proposal(pool, user_db, delib).await;
            let resolution_json = serde_json::json!({
                "kind": "proposal",
                "status": "pending",
                "reason": reason,
                "proposal": proposal,
            })
            .to_string();
            let _ = deliberation_repo::finalize(pool, &delib.id, t.status.as_str(), Some(&resolution_json), None);
            let note = match &proposal {
                Some(p) => format!(
                    "Deliberation resolved — proposed: “{}” (awaiting your approval).",
                    p.title
                ),
                None => "Deliberation resolved (no proposal synthesized — awaiting your review).".to_string(),
            };
            let _ = team_channel_repo::post_deliberation_turn(pool, &delib.id, &delib.team_id, "system", None, &note);
            tracing::info!(deliberation_id = %delib.id, reason, "deliberation: resolved + proposal synthesized");
        }
        TickOutcome::Pause { reason } => {
            let _ = deliberation_repo::update_progress(
                pool,
                &delib.id,
                t.round,
                t.consecutive_stall_rounds,
                t.status.as_str(),
            );
            tracing::info!(deliberation_id = %delib.id, reason, "deliberation: paused (backstop)");
        }
    }
    Ok(())
}

#[async_trait::async_trait]
impl ReactiveSubscription for DeliberationSubscription {
    fn name(&self) -> &'static str {
        "deliberation"
    }
    fn interval(&self) -> Duration {
        Duration::from_secs(120)
    }
    fn idle_interval(&self) -> Duration {
        Duration::from_secs(300)
    }
    fn initial_delay(&self) -> Duration {
        Duration::from_secs(240)
    }

    async fn tick(&self) {
        let enabled = crate::db::repos::core::settings::get(&self.pool, AUTONOMOUS_DELIBERATION)
            .ok()
            .flatten()
            .as_deref()
            == Some("true");
        if !enabled {
            return;
        }
        if quota_cooldown_active(&self.pool) {
            tracing::info!("deliberation: quota cooldown active — skipping tick");
            return;
        }
        let Some(state) = self.app.try_state::<Arc<crate::AppState>>() else {
            return;
        };
        let user_db = state.user_db.clone();
        drop(state);

        // Reap finished background actions first (post output + resume to 'open'
        // so the next advance discusses the result — the recovery path).
        if let Ok(running) = deliberation_repo::list_action_running(&self.pool) {
            for d in running {
                if let Err(e) = reap_action(&self.pool, &d) {
                    tracing::warn!(deliberation_id = %d.id, error = %e, "deliberation: reap_action failed");
                }
            }
        }

        let delibs = match deliberation_repo::list_advanceable(&self.pool) {
            Ok(d) => d,
            Err(e) => {
                tracing::warn!(error = %e, "deliberation: list_advanceable failed");
                return;
            }
        };

        for delib in delibs.into_iter().take(MAX_DELIBERATIONS_PER_TICK) {
            if let Err(e) = advance_one_deliberation(&self.pool, &user_db, &delib).await {
                tracing::warn!(deliberation_id = %delib.id, error = %e, "deliberation: advance failed");
            }
        }
    }
}

// ── The persona deliberation turn (D3) ──────────────────────────────────────

/// A persona's protocol reply for one turn. The persona decides for ITSELF
/// whether to just opine (`message`) or to act (`invoke_capability` /
/// `propose_assignment`). All fields default so a partial object still parses.
#[derive(Debug, Clone, Deserialize, Default)]
pub struct PersonaTurn {
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub invoke_capability: Option<CapabilityRequest>,
    #[serde(default)]
    pub propose_assignment: Option<AssignmentProposal>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CapabilityRequest {
    pub use_case_id: String,
    #[serde(default)]
    pub rationale: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AssignmentProposal {
    pub title: String,
    #[serde(default)]
    pub rationale: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PersonaTurnEnvelope {
    pub turn: PersonaTurn,
}

/// What a persona turn produced — either it just spoke, or it requested a
/// (gated) capability that parks the deliberation for user approval (decision 8).
#[derive(Debug, Clone)]
pub enum TurnOutcome {
    Spoke,
    RequestedAction(crate::db::models::PendingAction),
}

/// A persona's enabled capabilities `(use_case_id, title)` from
/// `personas.design_context`. Offered to the turn prompt as real ids and used to
/// validate a requested capability (a hallucinated id is dropped — the turn
/// degrades to a plain message).
fn parse_capabilities(design_context: Option<&str>) -> Vec<(String, String)> {
    let Some(dc) = design_context else {
        return vec![];
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(dc) else {
        return vec![];
    };
    let Some(arr) = crate::engine::design_context::pick_use_cases_array(&v) else {
        return vec![];
    };
    arr.iter()
        .filter_map(|uc| {
            if uc.get("enabled").and_then(|b| b.as_bool()) == Some(false) {
                return None;
            }
            let id = uc.get("id").and_then(|x| x.as_str())?.trim().to_string();
            if id.is_empty() {
                return None;
            }
            let title = uc
                .get("title")
                .and_then(|x| x.as_str())
                .unwrap_or(&id)
                .to_string();
            Some((id, title))
        })
        .collect()
}

/// Resolve a persona-supplied capability id against its real capabilities (exact
/// id, then normalized fuzzy — the same tolerance as [`resolve_speaker`]).
fn resolve_capability(
    requested: &str,
    capabilities: &[(String, String)],
) -> Option<(String, String)> {
    let req = requested.trim();
    if req.is_empty() {
        return None;
    }
    if let Some(c) = capabilities.iter().find(|(id, _)| id == req) {
        return Some(c.clone());
    }
    let norm = |s: &str| -> String {
        s.chars()
            .filter(|c| c.is_alphanumeric())
            .flat_map(|c| c.to_lowercase())
            .collect()
    };
    let nreq = norm(req);
    capabilities
        .iter()
        .find(|(id, title)| norm(id) == nreq || norm(title) == nreq)
        .cloned()
}

/// Pull the capability title out of a marker turn body (🛠 Ran “X” / ▶ Running
/// “X” / ⚠ …“X” / ⏸ …run “X”) into `set`.
fn extract_capability_title(body: &str, set: &mut std::collections::BTreeSet<String>) {
    if body.starts_with('🛠')
        || body.starts_with('▶')
        || body.starts_with('⚠')
        || body.starts_with('⏸')
    {
        if let Some(a) = body.find('“') {
            let rest = &body[a + '“'.len_utf8()..];
            if let Some(b) = rest.find('”') {
                set.insert(rest[..b].to_string());
            }
        }
    }
}

/// Capabilities already run / attempted across the TEAM's recent deliberations
/// (last 6h) — spans this deliberation, its parent + sibling tracks, AND recent
/// prior deliberations. Fixes (1) cross-track duplicate runs and (2) stale
/// re-validation of unchanged work: a persona is shown these and won't re-request
/// them (the prompt still allows a re-run if the code genuinely changed).
fn gather_attempted(pool: &DbPool, delib: &TeamDeliberation) -> Vec<String> {
    let mut set = std::collections::BTreeSet::new();
    if let Ok(conn) = pool.get() {
        if let Ok(mut stmt) = conn.prepare(
            "SELECT body FROM team_channel_messages
             WHERE team_id = ?1 AND deliberation_id IS NOT NULL
               AND datetime(created_at) > datetime('now','-6 hours')
             ORDER BY datetime(created_at) DESC LIMIT 200",
        ) {
            if let Ok(rows) = stmt.query_map(params![delib.team_id], |r| r.get::<_, String>(0)) {
                for body in rows.flatten() {
                    extract_capability_title(&body, &mut set);
                }
            }
        }
    }
    set.into_iter().collect()
}

/// Recent turns a persona sees for context.
const TURN_CONTEXT_WINDOW: i64 = 12;
/// Scoped memories injected into a persona's turn.
const TURN_MEMORY_LIMIT: i64 = 5;

/// Build a persona's deliberation-turn prompt — its identity + core (distinct
/// viewpoint) + the team north star + topic + scoped memory + the conversation
/// so far. LICENSES disagreement (the anti-bland-convergence lever, plan §11).
/// Pure + testable.
#[allow(clippy::too_many_arguments)]
pub fn build_turn_prompt(
    name: &str,
    identity: &str,
    core_profile: Option<&str>,
    north_star: Option<&str>,
    topic: &str,
    memories: &[String],
    recent_turns: &[(String, String)],
    capabilities: &[(String, String)],
    attempted: &[String],
) -> String {
    use std::fmt::Write as _;
    let mut p = String::new();
    let _ = writeln!(
        p,
        "You are {name}, a member of an autonomous product team in a live deliberation."
    );
    let _ = writeln!(p, "\n## YOUR IDENTITY\n{identity}");
    if let Some(core) = core_profile {
        let _ = writeln!(p, "\n## YOUR CORE (think and speak from this)\n{core}");
    }
    if let Some(ns) = north_star {
        let _ = writeln!(p, "\n## TEAM NORTH STAR (shared)\n{ns}");
    }
    let _ = writeln!(p, "\n## THE TOPIC\n{topic}");
    if !memories.is_empty() {
        let _ = writeln!(p, "\n## WHAT YOU REMEMBER (from this deliberation)");
        for m in memories {
            let _ = writeln!(p, "- {m}");
        }
    }
    let _ = writeln!(p, "\n## THE CONVERSATION SO FAR");
    if recent_turns.is_empty() {
        let _ = writeln!(p, "(you are opening the discussion)");
    } else {
        for (who, body) in recent_turns {
            let line = body.replace(['\n', '\r'], " ");
            let line = if line.chars().count() > 280 {
                line.chars().take(280).collect::<String>() + "…"
            } else {
                line
            };
            let _ = writeln!(p, "- {who}: {line}");
        }
    }
    if !capabilities.is_empty() {
        let _ = writeln!(
            p,
            "\n## YOUR CAPABILITIES (you may request ONE by its EXACT id)"
        );
        for (id, title) in capabilities {
            let _ = writeln!(p, "- {id}: {title}");
        }
    }
    if !attempted.is_empty() {
        let _ = writeln!(
            p,
            "\n## ALREADY RUN / ATTEMPTED (this deliberation, its tracks, and the team's recent work) — do NOT request these again; build on their results. Only re-run one if you have a SPECIFIC reason the underlying code/data changed since:"
        );
        for title in attempted {
            let _ = writeln!(p, "- {title}");
        }
    }
    let act_clause = if capabilities.is_empty() {
        "Be concise (2-5 sentences). If the team is ready to commit to a concrete piece of work, propose it."
    } else {
        "Be concise (2-5 sentences). When an open point is better answered by DOING than by more talk — running an analysis, pulling real data, drafting the artifact — request the matching capability from YOUR CAPABILITIES via invoke_capability with its EXACT id, BUT never one under ALREADY RUN / ATTEMPTED (use its result or move on). Do NOT merely ANNOUNCE you will run something — either request it THIS turn, or contribute substance; 'I will run X' without actually requesting it wastes the round. The team pauses for approval; once it runs, its real output is posted back. Prefer acting over speculating when data would settle the question. If the team is ready to commit, propose the concrete piece of work."
    };
    let _ = writeln!(
        p,
        "\n## YOUR TURN\nContribute ONE substantive message that moves the team forward FROM YOUR POINT OF VIEW. You are EXPECTED to push back when a proposal conflicts with your core — productive disagreement improves the outcome; do not just agree. {act_clause}"
    );
    let _ = writeln!(
        p,
        r#"Return EXACTLY one JSON object, no prose:
{{"turn": {{"message": "<your contribution>", "invoke_capability": {{"use_case_id": "<exact id from YOUR CAPABILITIES>", "rationale": "<why acting now beats discussing>"}}, "propose_assignment": {{"title": "<title>", "rationale": "<why>"}}}}}}
Omit invoke_capability / propose_assignment unless you mean them. Always include a `message` explaining your point (and, if acting, why)."#
    );
    p
}

/// Extract `{"turn": {...}}` from possibly-prose output (tolerant brace-match).
pub fn parse_turn(blob: &str) -> Option<PersonaTurn> {
    let marker = "\"turn\"";
    let mut result = None;
    let mut from = 0;
    while let Some(rel) = blob[from..].find(marker) {
        let pos = from + rel;
        from = pos + marker.len();
        let Some(open) = blob[..pos].rfind('{') else {
            continue;
        };
        if let Some(close) = crate::companion::athena_reaction::match_braces(&blob[open..]) {
            let candidate = &blob[open..open + close + 1];
            if let Ok(env) = serde_json::from_str::<PersonaTurnEnvelope>(candidate) {
                result = Some(env.turn);
            }
        }
    }
    result
}

/// Run ONE persona's deliberation turn — the ad-hoc single-turn primitive the
/// engine never had (only multi-step DAG assignments). The persona reads its
/// identity + core + the conversation + its scoped memory and either opines or
/// self-promotes to a capability / proposes work. Tool-less (an opinion is
/// cheap); the turn posts into the deliberation channel and rolls its cost into
/// the deliberation meter. Capability / proposal requests are SURFACED only —
/// always gated; D4 wires the approval + DAG handoff (decision 8).
pub async fn run_persona_deliberation_turn(
    pool: &DbPool,
    user_db: &crate::db::UserDbPool,
    delib: &TeamDeliberation,
    persona_id: &str,
    north_star: Option<&str>,
) -> Result<TurnOutcome, AppError> {
    // Persona voice + viewpoint + model + capabilities + readiness.
    let (name, identity, model_profile, core_profile, design_context, setup_status): (
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    ) = {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT name, system_prompt, model_profile, core_profile, design_context, setup_status FROM personas WHERE id = ?1",
            params![persona_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
        )
        .map_err(AppError::Database)?
    };
    // Pre-flight (Fix 2/3): a persona whose connectors aren't set up can't run
    // capabilities — the executor's needs_credentials gate would reject them — so
    // don't offer any; it discusses instead of requesting unrunnable work.
    let capabilities = if setup_status.as_deref() == Some("needs_credentials") {
        Vec::new()
    } else {
        parse_capabilities(design_context.as_deref())
    };
    // Speak on the persona's own model tier (opinion turn — tool-less).
    let model = model_profile
        .as_deref()
        .and_then(|mp| serde_json::from_str::<serde_json::Value>(mp).ok())
        .and_then(|v| v.get("model").and_then(|m| m.as_str()).map(String::from))
        .unwrap_or_else(|| crate::engine::prompt::DEFAULT_CAPABILITY_MODEL.to_string());

    // Deliberation-scoped memory (what this persona argued before).
    let memories: Vec<String> = {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT title, content FROM persona_memories
             WHERE persona_id = ?1 AND deliberation_id = ?2
             ORDER BY datetime(created_at) DESC LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![persona_id, delib.id, TURN_MEMORY_LIMIT], |r| {
            let title: String = r.get(0)?;
            let content: String = r.get(1)?;
            Ok(format!("{title}: {content}"))
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?
    };

    // The conversation so far (re-read so sequential same-tick speakers see each
    // other), oldest-first.
    let turns = team_channel_repo::list_for_deliberation(pool, &delib.id, TURN_CONTEXT_WINDOW)?;
    let recent_turns: Vec<(String, String)> = turns
        .into_iter()
        .rev()
        .map(|t| (author_label(&t.author_kind).to_string(), t.body))
        .collect();

    // Capabilities already run / attempted across the team's recent work (this
    // deliberation, its parent + sibling tracks, and recent prior deliberations)
    // so the persona doesn't re-run them (cross-track + stale-revalidation dedup).
    let attempted = gather_attempted(pool, delib);

    let prompt = build_turn_prompt(
        &name,
        &identity,
        core_profile.as_deref(),
        north_star,
        &delib.topic,
        &memories,
        &recent_turns,
        &capabilities,
        &attempted,
    );

    let (blob, cost) = crate::companion::athena_reaction::cli_decision_with_model(
        prompt,
        user_db,
        "deliberation_turn",
        &model,
    )
    .await?;
    if let Some(c) = cost {
        let _ = deliberation_repo::add_cost(pool, &delib.id, c);
    }

    let turn = parse_turn(&blob).unwrap_or_default();
    if !turn.message.trim().is_empty() {
        let _ = team_channel_repo::post_deliberation_turn(
            pool,
            &delib.id,
            &delib.team_id,
            "persona",
            Some(persona_id),
            &turn.message,
        );
    }
    // A capability request parks the deliberation for user approval (decision 8 —
    // always gated). Validate the id against the persona's REAL capabilities; a
    // hallucinated id degrades to a plain message (just spoke).
    if let Some(cap) = &turn.invoke_capability {
        if let Some((use_case_id, use_case_title)) =
            resolve_capability(&cap.use_case_id, &capabilities)
        {
            // Fix 2/3: don't re-run a capability already attempted this
            // deliberation — degrade to the message (the persona still spoke).
            if attempted.iter().any(|a| a == &use_case_title) {
                tracing::info!(deliberation_id = %delib.id, persona_id, use_case = %use_case_id, "deliberation: capability already attempted — dropping re-request");
            } else {
                tracing::info!(deliberation_id = %delib.id, persona_id, use_case = %use_case_id, "deliberation: persona requested a capability (gated — awaiting approval)");
                return Ok(TurnOutcome::RequestedAction(crate::db::models::PendingAction {
                    persona_id: persona_id.to_string(),
                    persona_name: name,
                    use_case_id,
                    use_case_title,
                    rationale: cap.rationale.clone(),
                }));
            }
        } else {
            tracing::info!(deliberation_id = %delib.id, persona_id, requested = %cap.use_case_id, "deliberation: persona requested an unknown capability — ignored");
        }
    }
    // propose_assignment stays a soft signal — the resolve-time proposal path
    // turns the deliberation's conclusion into one assignment.
    if let Some(prop) = &turn.propose_assignment {
        tracing::info!(deliberation_id = %delib.id, persona_id, title = %prop.title, "deliberation: persona proposed an assignment (synthesized at resolve)");
    }
    Ok(TurnOutcome::Spoke)
}

/// Reap an approved capability that has finished: post its output back into the
/// deliberation as a turn (+ roll its cost into the meter) and resume the
/// conversation ('open'). Returns `Ok(true)` if it reaped, `Ok(false)` if the
/// execution is still running. No LLM — pure DB + a channel post — so it's cheap
/// to sweep from the tick and the on-demand poll alike. This is what makes the
/// action flow recover even when a capability outlives the approving request.
pub fn reap_action(pool: &DbPool, delib: &TeamDeliberation) -> Result<bool, AppError> {
    let Some(exec_id) = delib.action_execution_id.as_deref() else {
        return Ok(false);
    };
    let action: Option<crate::db::models::PendingAction> = delib
        .pending_action
        .as_deref()
        .and_then(|j| serde_json::from_str(j).ok());
    let title = action
        .as_ref()
        .map(|a| a.use_case_title.clone())
        .unwrap_or_else(|| "the capability".to_string());
    let persona_id = action.as_ref().map(|a| a.persona_id.clone());

    let row = {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT status, output_data, cost_usd FROM persona_executions WHERE id = ?1",
            params![exec_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, f64>(2)?,
                ))
            },
        )
        .optional()
        .map_err(AppError::Database)?
    };
    // Missing row ⇒ don't hang forever; treat as terminal.
    let (status, output, cost) = row.unwrap_or_else(|| ("missing".to_string(), None, 0.0));
    if matches!(status.as_str(), "queued" | "running" | "pending") {
        return Ok(false); // still cooking
    }
    if cost > 0.0 {
        let _ = deliberation_repo::add_cost(pool, &delib.id, cost);
    }
    let body = match (status.as_str(), output.as_deref()) {
        ("completed", Some(out)) if !out.trim().is_empty() => {
            format!("🛠 Ran “{title}”:\n\n{}", out.trim())
        }
        ("completed", _) => format!("🛠 Ran “{title}” — it produced no output."),
        ("missing", _) => format!("⚠ “{title}” could not be found — continuing discussion."),
        _ => format!("⚠ “{title}” did not complete ({status}) — continuing discussion."),
    };
    let _ = team_channel_repo::post_deliberation_turn(
        pool,
        &delib.id,
        &delib.team_id,
        "persona",
        persona_id.as_deref(),
        &body,
    );
    deliberation_repo::clear_pending_action(pool, &delib.id, "open")?;
    Ok(true)
}

// ── Proposal synthesis + the decision gate (D4) ─────────────────────────────

/// Build the proposal-synthesis prompt — turn a resolved deliberation into ONE
/// concrete, executable assignment spec. Pure + testable.
pub fn build_proposal_prompt(
    topic: &str,
    goal: Option<&str>,
    agenda: &[DeliberationAgendaItem],
    recent_turns: &[(String, String)],
) -> String {
    use std::fmt::Write as _;
    let mut p = String::new();
    let _ = writeln!(
        p,
        "You are synthesizing the outcome of a team deliberation into ONE concrete piece of work the team can execute next."
    );
    let _ = writeln!(p, "\n## TOPIC\n{topic}");
    if let Some(g) = goal {
        let _ = writeln!(p, "\n## DESIRED OUTCOME\n{g}");
    }
    let _ = writeln!(p, "\n## AGENDA");
    if agenda.is_empty() {
        let _ = writeln!(p, "(none recorded)");
    } else {
        for a in agenda {
            match &a.resolution {
                Some(r) => {
                    let _ = writeln!(p, "- [{}] {} → {}", a.status, a.item, r);
                }
                None => {
                    let _ = writeln!(p, "- [{}] {}", a.status, a.item);
                }
            }
        }
    }
    let _ = writeln!(p, "\n## KEY POINTS FROM THE CONVERSATION");
    if recent_turns.is_empty() {
        let _ = writeln!(p, "(no turns recorded)");
    } else {
        for (who, body) in recent_turns {
            let line = body.replace(['\n', '\r'], " ");
            let line = if line.chars().count() > 240 {
                line.chars().take(240).collect::<String>() + "…"
            } else {
                line
            };
            let _ = writeln!(p, "- {who}: {line}");
        }
    }
    let _ = writeln!(
        p,
        "\n## YOUR OUTPUT\nProduce a single actionable assignment the team will execute. Return EXACTLY one JSON object, no prose:"
    );
    let _ = writeln!(
        p,
        r#"{{"proposal": {{"title": "<short title>", "objective": "<a clear, self-contained instruction the team will execute>", "summary": "<2-3 sentences: what was decided and why>"}}}}"#
    );
    p
}

/// Extract `{"proposal": {...}}` from possibly-prose output (tolerant brace-match).
pub fn parse_proposal(blob: &str) -> Option<ProposalSpec> {
    #[derive(serde::Deserialize)]
    struct Env {
        proposal: ProposalSpec,
    }
    let marker = "\"proposal\"";
    let mut result = None;
    let mut from = 0;
    while let Some(rel) = blob[from..].find(marker) {
        let pos = from + rel;
        from = pos + marker.len();
        let Some(open) = blob[..pos].rfind('{') else {
            continue;
        };
        if let Some(close) = crate::companion::athena_reaction::match_braces(&blob[open..]) {
            let candidate = &blob[open..open + close + 1];
            if let Ok(env) = serde_json::from_str::<Env>(candidate) {
                result = Some(env.proposal);
            }
        }
    }
    result
}

/// Synthesize a proposal from a resolved deliberation (one Sonnet call —
/// quality matters for the spec the team will execute). `None` if the call or
/// parse fails; the resolution then carries no proposal (the user reviews the
/// transcript). Rolls cost into the deliberation meter.
pub async fn synthesize_proposal(
    pool: &DbPool,
    user_db: &crate::db::UserDbPool,
    delib: &TeamDeliberation,
) -> Option<ProposalSpec> {
    let agenda = deliberation_repo::list_agenda(pool, &delib.id).ok()?;
    let turns = team_channel_repo::list_for_deliberation(pool, &delib.id, 20).ok()?;
    let recent: Vec<(String, String)> = turns
        .into_iter()
        .rev()
        .map(|t| (author_label(&t.author_kind).to_string(), t.body))
        .collect();
    let prompt = build_proposal_prompt(&delib.topic, delib.goal.as_deref(), &agenda, &recent);
    let (blob, cost) = crate::companion::athena_reaction::cli_decision_with_model(
        prompt,
        user_db,
        "deliberation_proposal",
        "claude-sonnet-4-6",
    )
    .await
    .ok()?;
    if let Some(c) = cost {
        let _ = deliberation_repo::add_cost(pool, &delib.id, c);
    }
    parse_proposal(&blob)
}

// ── Parallel tracks: partition planner + merge (P2/P3) ──────────────────────

/// One track the split planner proposes: a focus label, the open agenda item ids
/// it owns, and the key personas (by id) assigned to it. All fields default so a
/// partial object still parses.
#[derive(Debug, Clone, Deserialize, Default)]
pub struct TrackPlan {
    #[serde(default)]
    pub focus: String,
    #[serde(default)]
    pub agenda_item_ids: Vec<String>,
    #[serde(default)]
    pub persona_ids: Vec<String>,
}

#[derive(Deserialize)]
struct SplitEnvelope {
    #[serde(default)]
    tracks: Vec<TrackPlan>,
}

/// Build the split-planner prompt: partition the open agenda into independent,
/// parallelizable tracks. Pure + testable.
pub fn build_split_prompt(
    topic: &str,
    goal: Option<&str>,
    roster: &[RosterMember],
    open_agenda: &[(String, String)],
) -> String {
    use std::fmt::Write as _;
    let mut p = String::new();
    let _ = writeln!(
        p,
        "You are planning how to PARALLELIZE a team deliberation. Partition the OPEN agenda into parallel tracks — PREFER ONE TRACK PER INDEPENDENT CHECKLIST ITEM so the team can work every item at the SAME TIME until each hits a wall. Put items in the same track ONLY when one genuinely blocks or depends on the other. Aim for 2-6 tracks."
    );
    let _ = writeln!(p, "\n## TOPIC\n{topic}");
    if let Some(g) = goal {
        let _ = writeln!(p, "\n## DESIRED OUTCOME\n{g}");
    }
    let _ = writeln!(p, "\n## TEAM MEMBERS (assign the key ones per track by id)");
    for m in roster {
        match &m.core_profile {
            Some(core) => {
                let _ = writeln!(p, "- {} ({}): {}", m.name, m.id, core);
            }
            None => {
                let _ = writeln!(p, "- {} ({})", m.name, m.id);
            }
        }
    }
    let _ = writeln!(p, "\n## OPEN AGENDA (assign EVERY item id to exactly one track)");
    for (id, item) in open_agenda {
        let _ = writeln!(p, "- [{id}] {item}");
    }
    let _ = writeln!(p, "\n## YOUR OUTPUT\nReturn EXACTLY one JSON object, no prose:");
    let _ = writeln!(
        p,
        r#"{{"tracks": [{{"focus": "<short track label>", "agenda_item_ids": ["<id>", ...], "persona_ids": ["<member id>", ...]}}]}}"#
    );
    let _ = writeln!(
        p,
        "Rules: 2-6 tracks (one per independent checklist item where possible); assign EVERY agenda item id to exactly one track; 2-4 key personas per track by their EXACT id; the focus is a short label for the item."
    );
    p
}

/// Extract `{"tracks": [...]}` from possibly-prose output (tolerant brace-match).
pub fn parse_split(blob: &str) -> Vec<TrackPlan> {
    let marker = "\"tracks\"";
    let mut from = 0;
    while let Some(rel) = blob[from..].find(marker) {
        let pos = from + rel;
        from = pos + marker.len();
        let Some(open) = blob[..pos].rfind('{') else {
            continue;
        };
        if let Some(close) = crate::companion::athena_reaction::match_braces(&blob[open..]) {
            let candidate = &blob[open..open + close + 1];
            if let Ok(env) = serde_json::from_str::<SplitEnvelope>(candidate) {
                return env.tracks;
            }
        }
    }
    vec![]
}

/// Run the split planner (Haiku) over a deliberation's open agenda + roster.
pub async fn plan_split(
    pool: &DbPool,
    user_db: &crate::db::UserDbPool,
    delib: &TeamDeliberation,
) -> Result<Vec<TrackPlan>, AppError> {
    let (ctx, _) = build_moderator_context(pool, delib)?;
    let prompt = build_split_prompt(&ctx.topic, ctx.goal.as_deref(), &ctx.roster, &ctx.open_agenda);
    let (blob, cost) = crate::companion::athena_reaction::cli_decision_with_model(
        prompt,
        user_db,
        "deliberation_split",
        MODERATOR_MODEL,
    )
    .await?;
    if let Some(c) = cost {
        let _ = deliberation_repo::add_cost(pool, &delib.id, c);
    }
    Ok(parse_split(&blob))
}

/// Build the merge prompt: fold the resolved tracks' outcomes into ONE coherent
/// proposal. `tracks` is (focus, outcome summary). Pure + testable.
pub fn build_merge_prompt(
    topic: &str,
    goal: Option<&str>,
    tracks: &[(String, String)],
) -> String {
    use std::fmt::Write as _;
    let mut p = String::new();
    let _ = writeln!(
        p,
        "Several PARALLEL sub-teams each deliberated one track of a larger topic. Merge their outcomes into ONE coherent, executable piece of work — reconcile overlaps and conflicts, keep every track's key decision."
    );
    let _ = writeln!(p, "\n## TOPIC\n{topic}");
    if let Some(g) = goal {
        let _ = writeln!(p, "\n## DESIRED OUTCOME\n{g}");
    }
    let _ = writeln!(p, "\n## TRACK OUTCOMES");
    for (focus, outcome) in tracks {
        let _ = writeln!(p, "- {focus}: {outcome}");
    }
    let _ = writeln!(
        p,
        "\n## YOUR OUTPUT\nProduce a single combined assignment. Return EXACTLY one JSON object, no prose:"
    );
    let _ = writeln!(
        p,
        r#"{{"proposal": {{"title": "<short title>", "objective": "<a clear, self-contained instruction the team will execute>", "summary": "<2-3 sentences: what was decided across the tracks and why>"}}}}"#
    );
    p
}

/// Synthesize ONE combined proposal from a parent's resolved tracks (Sonnet).
pub async fn synthesize_merged_proposal(
    pool: &DbPool,
    user_db: &crate::db::UserDbPool,
    parent: &TeamDeliberation,
    tracks: &[TeamDeliberation],
) -> Option<ProposalSpec> {
    let summaries: Vec<(String, String)> = tracks
        .iter()
        .map(|t| {
            let outcome = t
                .resolution
                .as_deref()
                .and_then(|r| serde_json::from_str::<serde_json::Value>(r).ok())
                .and_then(|v| v.get("proposal").cloned())
                .filter(|p| !p.is_null())
                .map(|p| {
                    let g = |k: &str| {
                        p.get(k)
                            .and_then(|x| x.as_str())
                            .unwrap_or("")
                            .to_string()
                    };
                    format!("{} — {} ({})", g("title"), g("objective"), g("summary"))
                })
                .unwrap_or_else(|| format!("(no proposal; status {})", t.status));
            (t.topic.clone(), outcome)
        })
        .collect();
    let prompt = build_merge_prompt(&parent.topic, parent.goal.as_deref(), &summaries);
    let (blob, cost) = crate::companion::athena_reaction::cli_decision_with_model(
        prompt,
        user_db,
        "deliberation_merge",
        "claude-sonnet-4-6",
    )
    .await
    .ok()?;
    if let Some(c) = cost {
        let _ = deliberation_repo::add_cost(pool, &parent.id, c);
    }
    parse_proposal(&blob)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decision(outcome: RoundOutcome, speakers: &[&str]) -> ModeratorDecision {
        ModeratorDecision {
            next_speakers: speakers.iter().map(|s| s.to_string()).collect(),
            round_outcome: outcome,
            ..Default::default()
        }
    }
    fn prog(round: i32, stall: i32) -> DeliberationProgress {
        DeliberationProgress {
            round,
            consecutive_stall_rounds: stall,
        }
    }

    #[test]
    fn progressed_round_resets_stall_and_continues() {
        let t = plan_transition(prog(2, 2), &decision(RoundOutcome::Progressed, &["a"]), 3, None, false);
        assert_eq!(t.consecutive_stall_rounds, 0);
        assert_eq!(t.round, 3);
        assert_eq!(t.status, DeliberationStatus::Open);
        assert_eq!(
            t.outcome,
            TickOutcome::Continue {
                speakers: vec!["a".into()]
            }
        );
    }

    #[test]
    fn stalled_rounds_accumulate_then_escalate_at_limit() {
        let t1 = plan_transition(prog(0, 0), &decision(RoundOutcome::Stalled, &["a"]), 2, None, false);
        assert_eq!(t1.consecutive_stall_rounds, 1);
        assert!(matches!(t1.outcome, TickOutcome::Continue { .. }));

        let t2 = plan_transition(
            prog(5, STALL_LIMIT - 1),
            &decision(RoundOutcome::Stalled, &["a"]),
            2,
            None,
            false,
        );
        assert_eq!(t2.consecutive_stall_rounds, STALL_LIMIT);
        assert_eq!(t2.status, DeliberationStatus::Escalated);
        assert_eq!(t2.outcome, TickOutcome::Escalate { reason: "stall_limit" });
    }

    #[test]
    fn empty_agenda_resolves() {
        let t = plan_transition(prog(1, 0), &decision(RoundOutcome::Progressed, &["a"]), 0, None, false);
        assert_eq!(t.status, DeliberationStatus::Resolved);
        assert_eq!(t.outcome, TickOutcome::Resolve { reason: "agenda_clear" });
    }

    #[test]
    fn converged_signal_resolves_even_with_open_agenda() {
        let mut d = decision(RoundOutcome::Progressed, &["a"]);
        d.status = StatusSignal::Converged;
        let t = plan_transition(prog(1, 0), &d, 4, None, false);
        assert_eq!(t.status, DeliberationStatus::Resolved);
        assert_eq!(t.outcome, TickOutcome::Resolve { reason: "converged" });
    }

    #[test]
    fn explicit_escalate_action_escalates() {
        let mut d = decision(RoundOutcome::Progressed, &["a"]);
        d.action = ModeratorAction::EscalateToUser;
        let t = plan_transition(prog(1, 0), &d, 3, None, false);
        assert_eq!(t.status, DeliberationStatus::Escalated);
        assert_eq!(
            t.outcome,
            TickOutcome::Escalate {
                reason: "moderator_escalation"
            }
        );
    }

    #[test]
    fn speakers_capped_and_deduped() {
        let d = decision(RoundOutcome::Progressed, &["a", "a", "b", "c", "d"]);
        let t = plan_transition(prog(1, 0), &d, 3, None, false);
        match t.outcome {
            TickOutcome::Continue { speakers } => {
                assert_eq!(speakers, vec!["a".to_string(), "b".into(), "c".into()]);
                assert_eq!(speakers.len(), MAX_TURNS_PER_TICK);
            }
            other => panic!("expected continue, got {other:?}"),
        }
    }

    #[test]
    fn anti_self_loop_drops_sole_repeat_speaker() {
        let d = decision(RoundOutcome::Progressed, &["a"]);
        let t = plan_transition(prog(1, 0), &d, 3, Some("a"), false);
        assert_eq!(t.outcome, TickOutcome::Continue { speakers: vec![] });
    }

    #[test]
    fn round_cap_forces_resolve() {
        let t = plan_transition(
            prog(CONVERGE_BY_ROUND - 1, 0),
            &decision(RoundOutcome::Progressed, &["a"]),
            3,
            None,
            false,
        );
        assert_eq!(t.status, DeliberationStatus::Resolved);
        assert_eq!(t.outcome, TickOutcome::Resolve { reason: "round_cap" });
    }

    #[test]
    fn result_pending_blocks_resolve_and_escalate() {
        // A converged signal is suppressed while a capability result is undiscussed.
        let mut d = decision(RoundOutcome::Progressed, &["a"]);
        d.status = StatusSignal::Converged;
        let t = plan_transition(prog(1, 0), &d, 4, None, true);
        assert_eq!(t.status, DeliberationStatus::Open);
        assert!(matches!(t.outcome, TickOutcome::Continue { .. }));
        // Stall-limit escalation is also suppressed, and the stall counter resets.
        let s = plan_transition(
            prog(5, STALL_LIMIT - 1),
            &decision(RoundOutcome::Stalled, &["a"]),
            2,
            None,
            true,
        );
        assert_eq!(s.consecutive_stall_rounds, 0);
        assert!(matches!(s.outcome, TickOutcome::Continue { .. }));
        // The round-cap backstop still applies even with a result pending.
        let cap = plan_transition(
            prog(CONVERGE_BY_ROUND - 1, 0),
            &decision(RoundOutcome::Progressed, &["a"]),
            3,
            None,
            true,
        );
        assert_eq!(cap.status, DeliberationStatus::Resolved);
    }

    #[test]
    fn cost_floor_breach() {
        assert_eq!(
            floor_breach(5.0, Some(5.0), None, "2026-01-01T00:00:00Z"),
            Some(FloorBreach::Cost)
        );
        assert_eq!(floor_breach(1.0, Some(5.0), None, "2026-01-01T00:00:00Z"), None);
    }

    #[test]
    fn idle_floor_breach() {
        assert_eq!(
            floor_breach(0.0, Some(5.0), Some("2026-01-01T00:00:00Z"), "2026-01-02T00:00:00Z"),
            Some(FloorBreach::Idle)
        );
        assert_eq!(
            floor_breach(0.0, Some(5.0), Some("2026-01-02T00:00:00Z"), "2026-01-01T00:00:00Z"),
            None
        );
    }

    #[test]
    fn envelope_deserializes_partial_object() {
        let env: ModeratorEnvelope = serde_json::from_str(
            r#"{"deliberation": {"next_speakers": ["x"], "round_outcome": "progressed"}}"#,
        )
        .unwrap();
        assert_eq!(env.deliberation.next_speakers, vec!["x".to_string()]);
        assert_eq!(env.deliberation.round_outcome, RoundOutcome::Progressed);
        // Unspecified fields fall back to the safe defaults.
        assert_eq!(env.deliberation.action, ModeratorAction::Discuss);
        assert_eq!(env.deliberation.status, StatusSignal::Continue);
    }
}

#[cfg(test)]
mod moderator_tests {
    use super::*;

    #[test]
    fn parse_extracts_envelope_from_prose() {
        let blob = "Here is my call:\n{\"deliberation\": {\"next_speakers\": [\"p1\"], \"round_outcome\": \"progressed\", \"status\": \"continue\"}}\nthanks";
        let d = parse_decision(blob).unwrap();
        assert_eq!(d.next_speakers, vec!["p1".to_string()]);
        assert_eq!(d.round_outcome, RoundOutcome::Progressed);
    }

    #[test]
    fn parse_returns_none_without_marker() {
        assert!(parse_decision("no json here").is_none());
    }

    #[test]
    fn prompt_includes_topic_roster_and_agenda() {
        let ctx = ModeratorContext {
            topic: "Ship faster".into(),
            goal: None,
            north_star: None,
            roster: vec![RosterMember {
                id: "p1".into(),
                name: "Architect".into(),
                core_profile: None,
            }],
            open_agenda: vec![("a1".into(), "How to test?".into())],
            recent_turns: vec![],
            result_pending: false,
        };
        let p = build_moderator_prompt(&ctx);
        assert!(p.contains("Ship faster"));
        assert!(p.contains("Architect"));
        assert!(p.contains("[a1] How to test?"));
        assert!(p.contains("\"deliberation\""));
        // With a result pending, the moderator is told to react first.
        let ctx2 = ModeratorContext { result_pending: true, ..ctx };
        assert!(build_moderator_prompt(&ctx2).contains("A RESULT JUST LANDED"));
    }

    #[test]
    fn resolve_speaker_handles_names_and_guessed_ids() {
        // Exactly the mismatches the live harness surfaced.
        let roster = vec![
            RosterMember { id: "qa".into(), name: "QA Guardian".into(), core_profile: None },
            RosterMember { id: "engineer".into(), name: "Dev Clone".into(), core_profile: None },
            RosterMember { id: "product".into(), name: "Product Strategist".into(), core_profile: None },
        ];
        assert_eq!(resolve_speaker("qa", &roster).as_deref(), Some("qa")); // exact id
        assert_eq!(resolve_speaker("QA Guardian", &roster).as_deref(), Some("qa")); // display name
        assert_eq!(resolve_speaker("dev_clone", &roster).as_deref(), Some("engineer")); // guessed id
        assert_eq!(resolve_speaker("product_strategist", &roster).as_deref(), Some("product"));
        assert_eq!(resolve_speaker("nobody", &roster), None); // hallucinated → dropped
    }
}

#[cfg(test)]
mod turn_tests {
    use super::*;

    #[test]
    fn parse_turn_extracts_message_and_capability() {
        let blob = r#"sure: {"turn": {"message": "I disagree — harden first.", "invoke_capability": {"use_case_id": "uc_audit", "rationale": "check deps"}}}"#;
        let t = parse_turn(blob).unwrap();
        assert_eq!(t.message, "I disagree — harden first.");
        assert_eq!(t.invoke_capability.unwrap().use_case_id, "uc_audit");
        assert!(t.propose_assignment.is_none());
    }

    #[test]
    fn parse_turn_message_only() {
        let t = parse_turn(r#"{"turn": {"message": "Agreed."}}"#).unwrap();
        assert_eq!(t.message, "Agreed.");
        assert!(t.invoke_capability.is_none());
    }

    #[test]
    fn turn_prompt_licenses_disagreement_and_includes_core() {
        let p = build_turn_prompt(
            "QA Guardian",
            "You guard quality.",
            Some(r#"{"stance":"challenger"}"#),
            Some("Be #1"),
            "Should we ship Friday?",
            &["prior: I flagged flaky tests".to_string()],
            &[("Teammate".to_string(), "Let's ship.".to_string())],
            &[],
            &[],
        );
        assert!(p.contains("QA Guardian"));
        assert!(p.contains("challenger"));
        assert!(p.contains("Be #1"));
        assert!(p.contains("Should we ship Friday?"));
        assert!(p.contains("push back"));
        assert!(p.contains("prior: I flagged flaky tests"));
        assert!(p.contains("\"turn\""));
    }

    #[test]
    fn turn_prompt_offers_real_capabilities_and_invites_acting() {
        let caps = [
            ("run-regression".to_string(), "Run the regression suite".to_string()),
            ("pull-metrics".to_string(), "Pull payment metrics".to_string()),
        ];
        let with = build_turn_prompt(
            "QA",
            "id",
            None,
            None,
            "topic",
            &[],
            &[],
            &caps,
            &[],
        );
        assert!(with.contains("## YOUR CAPABILITIES"));
        assert!(with.contains("run-regression: Run the regression suite"));
        assert!(with.contains("invoke_capability")); // invited to act
                                                      // No capabilities → no capability section (the JSON schema still
                                                      // names the field, so check the section HEADER, not the substring).
        let without = build_turn_prompt("QA", "id", None, None, "topic", &[], &[], &[], &[]);
        assert!(!without.contains("## YOUR CAPABILITIES"));
        // Already-attempted capabilities are listed so the persona won't re-request.
        let dedup = build_turn_prompt(
            "QA", "id", None, None, "topic", &[], &[],
            &[("uc-x".to_string(), "Run X".to_string())],
            &["Run X".to_string()],
        );
        assert!(dedup.contains("ALREADY RUN / ATTEMPTED"));
        assert!(dedup.contains("- Run X"));
    }

    #[test]
    fn parse_capabilities_filters_disabled_and_blank() {
        let dc = r#"{"use_cases":[
            {"id":"a","title":"Alpha"},
            {"id":"b","title":"Beta","enabled":false},
            {"id":"","title":"blank"},
            {"id":"c"}
        ]}"#;
        let caps = parse_capabilities(Some(dc));
        assert_eq!(caps.len(), 2);
        assert_eq!(caps[0], ("a".to_string(), "Alpha".to_string()));
        assert_eq!(caps[1], ("c".to_string(), "c".to_string())); // title falls back to id
        assert!(parse_capabilities(None).is_empty());
        assert!(parse_capabilities(Some("not json")).is_empty());
    }

    #[test]
    fn resolve_capability_exact_then_fuzzy_else_none() {
        let caps = [
            ("run-regression".to_string(), "Run the regression suite".to_string()),
            ("pull-metrics".to_string(), "Pull payment metrics".to_string()),
        ];
        assert_eq!(
            resolve_capability("run-regression", &caps).unwrap().0,
            "run-regression"
        ); // exact id
        assert_eq!(
            resolve_capability("Run the regression suite", &caps).unwrap().0,
            "run-regression"
        ); // by title
        assert_eq!(
            resolve_capability("pull_metrics", &caps).unwrap().0,
            "pull-metrics"
        ); // normalized id (underscore vs hyphen)
        assert!(resolve_capability("ship-it-now", &caps).is_none()); // hallucinated → dropped
    }
}

#[cfg(test)]
mod proposal_tests {
    use super::*;

    #[test]
    fn parse_proposal_extracts_spec() {
        let blob = r#"ok: {"proposal": {"title": "Harden auth", "objective": "Add rate limiting to the login route and a regression test.", "summary": "Team agreed security before speed."}}"#;
        let spec = parse_proposal(blob).unwrap();
        assert_eq!(spec.title, "Harden auth");
        assert!(spec.objective.contains("rate limiting"));
    }

    #[test]
    fn parse_proposal_none_without_marker() {
        assert!(parse_proposal("no proposal here").is_none());
    }

    #[test]
    fn parse_split_extracts_tracks_from_prose() {
        let blob = r#"Here's the plan: {"tracks": [
            {"focus": "Auth", "agenda_item_ids": ["a1","a2"], "persona_ids": ["qa","security"]},
            {"focus": "Billing", "agenda_item_ids": ["a3"], "persona_ids": ["product","engineer"]}
        ]} done."#;
        let tracks = parse_split(blob);
        assert_eq!(tracks.len(), 2);
        assert_eq!(tracks[0].focus, "Auth");
        assert_eq!(tracks[0].agenda_item_ids, vec!["a1", "a2"]);
        assert_eq!(tracks[1].persona_ids, vec!["product", "engineer"]);
        assert!(parse_split("no tracks here").is_empty());
    }

    #[test]
    fn split_prompt_lists_agenda_ids_and_roster() {
        let roster = vec![RosterMember {
            id: "qa".into(),
            name: "QA Guardian".into(),
            core_profile: None,
        }];
        let agenda = vec![("a1".to_string(), "Harden auth".to_string())];
        let p = build_split_prompt("Ship v2", Some("be safe"), &roster, &agenda);
        assert!(p.contains("[a1] Harden auth"));
        assert!(p.contains("QA Guardian (qa)"));
        assert!(p.contains("\"tracks\""));
    }

    #[test]
    fn merge_prompt_lists_track_outcomes() {
        let p = build_merge_prompt(
            "Ship v2",
            None,
            &[("Auth".to_string(), "decided to gate".to_string())],
        );
        assert!(p.contains("Auth: decided to gate"));
        assert!(p.contains("\"proposal\""));
    }

    #[test]
    fn proposal_prompt_includes_agenda_resolution() {
        let agenda = vec![DeliberationAgendaItem {
            id: "a1".into(),
            deliberation_id: "d1".into(),
            item: "Ship Friday?".into(),
            status: "resolved".into(),
            resolution: Some("No — harden first".into()),
            opened_by: Some("moderator".into()),
            created_at: "2026-01-01T00:00:00Z".into(),
            resolved_at: None,
        }];
        let p = build_proposal_prompt(
            "Release cadence",
            Some("Decide Friday ship"),
            &agenda,
            &[("Teammate".into(), "I vote harden".into())],
        );
        assert!(p.contains("Release cadence"));
        assert!(p.contains("Ship Friday? → No — harden first"));
        assert!(p.contains("\"proposal\""));
    }
}

#[cfg(test)]
mod core_content_tests {
    //! D5b — verify the SDLC templates carry well-formed, *deliberately
    //! divergent* cores (the anti-bland-convergence content). Reads the JSON
    //! straight off disk (no DB/AppState), so it's the cheap content gate.
    use crate::db::models::PersonaCore;

    const SDLC_CORES: &[&str] = &[
        "development/solution-architect.json",
        "development/dev-clone.json",
        "development/qa-guardian.json",
        "development/code-reviewer.json",
        "security/security-sentinel.json",
        "devops/release-manager.json",
        "development/docs-steward.json",
        "marketing/visual-brand-asset-factory.json",
        "project-management/product-strategist.json",
    ];

    fn load_core(rel: &str) -> PersonaCore {
        let path = format!(
            "{}/../scripts/templates/{}",
            env!("CARGO_MANIFEST_DIR"),
            rel
        );
        let raw =
            std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {rel}: {e}"));
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let core = v
            .get("payload")
            .and_then(|p| p.get("persona"))
            .and_then(|p| p.get("core"))
            .cloned()
            .unwrap_or_else(|| panic!("{rel}: missing payload.persona.core"));
        serde_json::from_value(core).unwrap_or_else(|e| panic!("{rel}: core is not a PersonaCore: {e}"))
    }

    #[test]
    fn every_sdlc_member_has_a_wellformed_core() {
        for rel in SDLC_CORES {
            let c = load_core(rel);
            assert!(!c.motivation.trim().is_empty(), "{rel}: empty motivation");
            assert!(!c.stance.trim().is_empty(), "{rel}: empty stance");
            assert!(
                !c.north_star_commitment.trim().is_empty(),
                "{rel}: empty north_star_commitment"
            );
            for (name, d) in [
                ("risk_tolerance", c.risk_tolerance),
                ("speed_vs_quality", c.speed_vs_quality),
                ("deference", c.deference),
            ] {
                assert!((0.0..=1.0).contains(&d), "{rel}: {name} dial {d} out of [0,1]");
            }
            assert!(
                matches!(
                    c.conflict_style.as_str(),
                    "challenger" | "harmonizer" | "analyst" | "pragmatist"
                ),
                "{rel}: bad conflict_style {}",
                c.conflict_style
            );
        }
    }

    #[test]
    fn cores_are_deliberately_divergent() {
        // The whole point: shared north star, different routes. Verify the
        // ship-fast vs verify-first tension is actually encoded in the dials —
        // otherwise the deliberation converges to bland agreement (plan §11).
        let product = load_core("project-management/product-strategist.json");
        let qa = load_core("development/qa-guardian.json");
        let security = load_core("security/security-sentinel.json");
        let architect = load_core("development/solution-architect.json");

        assert!(
            product.speed_vs_quality > qa.speed_vs_quality + 0.3,
            "product should lean far more to speed than QA ({} vs {})",
            product.speed_vs_quality,
            qa.speed_vs_quality
        );
        assert!(
            security.risk_tolerance < product.risk_tolerance - 0.3,
            "security should be far more risk-averse than product"
        );
        assert!(architect.speed_vs_quality < 0.4, "architect should lean to quality");
        assert!(
            product.risk_tolerance > 0.5 && qa.risk_tolerance < 0.3,
            "the ship-fast vs verify-first tension must be encoded"
        );
    }
}
