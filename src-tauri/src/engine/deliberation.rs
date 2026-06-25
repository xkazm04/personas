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

use crate::db::models::TeamDeliberation;
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
/// Absolute backstop on moderator rounds — a deliberation that never stalls and
/// never breaches a floor still cannot run forever. High by design (long
/// productive conversations are the goal); this only catches a pathological
/// always-"progressed" loop.
pub const MAX_ROUNDS_BACKSTOP: i32 = 500;
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
) -> Transition {
    let round = progress.round + 1;
    let stall = match decision.round_outcome {
        RoundOutcome::Progressed => 0,
        RoundOutcome::Stalled => progress.consecutive_stall_rounds + 1,
    };

    // Termination precedence (highest first):
    // 1. Converged / concluded / empty agenda → resolve.
    if decision.status == StatusSignal::Converged
        || decision.action == ModeratorAction::Conclude
        || open_agenda_after == 0
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
    // 2. Stall limit / explicit escalate / stuck → escalate to user.
    if stall >= STALL_LIMIT
        || decision.action == ModeratorAction::EscalateToUser
        || decision.status == StatusSignal::Stuck
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
    // 3. Absolute round backstop → pause.
    if round >= MAX_ROUNDS_BACKSTOP {
        return Transition {
            status: DeliberationStatus::Paused,
            round,
            consecutive_stall_rounds: stall,
            outcome: TickOutcome::Pause {
                reason: "round_backstop",
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
}

/// The moderator runs on Haiku — cheap, one batched call per tick (plan §3).
pub const MODERATOR_MODEL: &str = "claude-haiku-4-5-20251001";
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
        "You are the MODERATOR of an autonomous team deliberation. You have no opinions of your own — you route the conversation, curate its agenda, judge whether it is making progress, and push it toward concrete decisions and tasks. Be SELECTIVE: pick only the 1-3 team members whose point of view most moves the current open agenda item forward. Never route the whole roster."
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
    let _ = writeln!(
        p,
        "\n## YOUR DECISION\nReturn EXACTLY one JSON object, no prose:"
    );
    let _ = writeln!(
        p,
        r#"{{"deliberation": {{"next_speakers": ["<persona id>"], "agenda_add": ["<new open question>"], "agenda_resolve": [{{"id": "<agenda item id>", "resolution": "<decision>"}}], "round_outcome": "progressed" | "stalled", "action": "discuss" | "invoke_capability" | "spawn_assignment" | "escalate_to_user" | "conclude", "status": "continue" | "converged" | "stuck", "reason": "<one line>"}}}}"#
    );
    let _ = writeln!(
        p,
        "\nRules: 'progressed' ONLY if this round produced a decision, a task, or genuinely new information — restating prior points is 'stalled'. Prefer 'invoke_capability'/'spawn_assignment' when an open item is better answered by doing than by more discussion. Use 'converged' or 'conclude' only when the agenda is effectively settled."
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

/// Run one moderation decision on Haiku. Records a `companion_turn` ledger row
/// (audit) and returns the decision plus the call's `cost_usd` (for the
/// deliberation's cost meter). An unparseable reply degrades to
/// [`ModeratorDecision::default`] — a `stalled` round with no speakers, which
/// the governance treats conservatively (the stall counter advances toward
/// escalation).
pub async fn run_moderator(
    ctx: &ModeratorContext,
    user_db: &crate::db::UserDbPool,
) -> Result<(ModeratorDecision, Option<f64>), AppError> {
    let prompt = build_moderator_prompt(ctx);
    let (blob, cost) = crate::companion::athena_reaction::cli_decision_with_model(
        prompt,
        user_db,
        "deliberation_moderate",
        MODERATOR_MODEL,
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

impl DeliberationSubscription {
    /// Gather the moderator context for one deliberation: roster (+ authored
    /// cores), team north star, open agenda, recent turns, and the last speaker
    /// (anti-self-loop).
    fn build_context(
        &self,
        delib: &TeamDeliberation,
    ) -> Result<(ModeratorContext, Option<String>), AppError> {
        let conn = self.pool.get()?;
        let mut stmt =
            conn.prepare("SELECT id, name, core_profile FROM personas WHERE home_team_id = ?1")?;
        let roster = stmt
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

        let north_star: Option<String> = conn
            .query_row(
                "SELECT north_star FROM persona_teams WHERE id = ?1",
                params![delib.team_id],
                |r| r.get::<_, Option<String>>(0),
            )
            .optional()
            .map_err(AppError::Database)?
            .flatten();

        let open_agenda = deliberation_repo::list_agenda(&self.pool, &delib.id)?
            .into_iter()
            .filter(|a| a.status == "open")
            .map(|a| (a.id, a.item))
            .collect::<Vec<_>>();

        let turns =
            team_channel_repo::list_for_deliberation(&self.pool, &delib.id, MODERATOR_TURN_WINDOW)?;
        let last_speaker = turns
            .iter()
            .find(|t| t.author_kind == "persona")
            .and_then(|t| t.author_id.clone());
        let recent_turns = turns
            .into_iter()
            .rev()
            .map(|t| (author_label(&t.author_kind).to_string(), t.body))
            .collect::<Vec<_>>();

        Ok((
            ModeratorContext {
                topic: delib.topic.clone(),
                goal: delib.goal.clone(),
                north_star,
                roster,
                open_agenda,
                recent_turns,
            },
            last_speaker,
        ))
    }
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

        let delibs = match deliberation_repo::list_advanceable(&self.pool) {
            Ok(d) => d,
            Err(e) => {
                tracing::warn!(error = %e, "deliberation: list_advanceable failed");
                return;
            }
        };

        for delib in delibs.into_iter().take(MAX_DELIBERATIONS_PER_TICK) {
            // Hard floors first (cost / idle) — pause and wait for the user.
            let now = chrono::Utc::now().to_rfc3339();
            if let Some(breach) = floor_breach(
                delib.cost_spent_usd,
                delib.cost_budget_usd,
                delib.idle_deadline.as_deref(),
                &now,
            ) {
                let _ = deliberation_repo::update_progress(
                    &self.pool,
                    &delib.id,
                    delib.round,
                    delib.consecutive_stall_rounds,
                    DeliberationStatus::Paused.as_str(),
                );
                tracing::info!(deliberation_id = %delib.id, ?breach, "deliberation: floor breach — paused");
                continue;
            }

            let (ctx, last_speaker) = match self.build_context(&delib) {
                Ok(c) => c,
                Err(e) => {
                    tracing::warn!(deliberation_id = %delib.id, error = %e, "deliberation: build_context failed");
                    continue;
                }
            };

            // One batched Haiku moderation decision (audited in companion_turn).
            let (decision, cost) = match run_moderator(&ctx, &user_db).await {
                Ok(x) => x,
                Err(e) => {
                    tracing::warn!(deliberation_id = %delib.id, error = %e, "deliberation: moderator call failed");
                    continue;
                }
            };
            if let Some(c) = cost {
                let _ = deliberation_repo::add_cost(&self.pool, &delib.id, c);
            }

            // Apply the moderator's agenda edits, then read the open count.
            for item in &decision.agenda_add {
                let _ = deliberation_repo::add_agenda_item(
                    &self.pool,
                    &delib.id,
                    item,
                    Some("moderator"),
                );
            }
            for res in &decision.agenda_resolve {
                let _ = deliberation_repo::resolve_agenda_item(
                    &self.pool,
                    &res.id,
                    "resolved",
                    Some(res.resolution.as_str()),
                );
            }
            let open_after =
                deliberation_repo::count_open_agenda(&self.pool, &delib.id).unwrap_or(0) as usize;

            let progress = DeliberationProgress {
                round: delib.round,
                consecutive_stall_rounds: delib.consecutive_stall_rounds,
            };
            let t = plan_transition(progress, &decision, open_after, last_speaker.as_deref());

            match t.outcome {
                TickOutcome::Continue { speakers } => {
                    let _ = deliberation_repo::update_progress(
                        &self.pool,
                        &delib.id,
                        t.round,
                        t.consecutive_stall_rounds,
                        t.status.as_str(),
                    );
                    for sp in &speakers {
                        // D3: run the persona's deliberation turn here (opinion
                        // or self-promote to a gated capability). Stubbed.
                        tracing::info!(deliberation_id = %delib.id, persona_id = %sp, reason = %decision.reason, "deliberation: would run persona turn (D3 stub)");
                    }
                }
                TickOutcome::Escalate { reason } => {
                    let _ = deliberation_repo::update_progress(
                        &self.pool,
                        &delib.id,
                        t.round,
                        t.consecutive_stall_rounds,
                        t.status.as_str(),
                    );
                    tracing::info!(deliberation_id = %delib.id, reason, "deliberation: escalated to user");
                    // D6 surfaces the escalation card; D4 wires the decision gate.
                }
                TickOutcome::Resolve { reason } => {
                    let _ = deliberation_repo::finalize(
                        &self.pool,
                        &delib.id,
                        t.status.as_str(),
                        Some(reason),
                        None,
                    );
                    tracing::info!(deliberation_id = %delib.id, reason, "deliberation: resolved (D4 spawns the proposal)");
                }
                TickOutcome::Pause { reason } => {
                    let _ = deliberation_repo::update_progress(
                        &self.pool,
                        &delib.id,
                        t.round,
                        t.consecutive_stall_rounds,
                        t.status.as_str(),
                    );
                    tracing::info!(deliberation_id = %delib.id, reason, "deliberation: paused (backstop)");
                }
            }
        }
    }
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
        let t = plan_transition(prog(2, 2), &decision(RoundOutcome::Progressed, &["a"]), 3, None);
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
        let t1 = plan_transition(prog(0, 0), &decision(RoundOutcome::Stalled, &["a"]), 2, None);
        assert_eq!(t1.consecutive_stall_rounds, 1);
        assert!(matches!(t1.outcome, TickOutcome::Continue { .. }));

        let t2 = plan_transition(
            prog(5, STALL_LIMIT - 1),
            &decision(RoundOutcome::Stalled, &["a"]),
            2,
            None,
        );
        assert_eq!(t2.consecutive_stall_rounds, STALL_LIMIT);
        assert_eq!(t2.status, DeliberationStatus::Escalated);
        assert_eq!(t2.outcome, TickOutcome::Escalate { reason: "stall_limit" });
    }

    #[test]
    fn empty_agenda_resolves() {
        let t = plan_transition(prog(1, 0), &decision(RoundOutcome::Progressed, &["a"]), 0, None);
        assert_eq!(t.status, DeliberationStatus::Resolved);
        assert_eq!(t.outcome, TickOutcome::Resolve { reason: "agenda_clear" });
    }

    #[test]
    fn converged_signal_resolves_even_with_open_agenda() {
        let mut d = decision(RoundOutcome::Progressed, &["a"]);
        d.status = StatusSignal::Converged;
        let t = plan_transition(prog(1, 0), &d, 4, None);
        assert_eq!(t.status, DeliberationStatus::Resolved);
        assert_eq!(t.outcome, TickOutcome::Resolve { reason: "converged" });
    }

    #[test]
    fn explicit_escalate_action_escalates() {
        let mut d = decision(RoundOutcome::Progressed, &["a"]);
        d.action = ModeratorAction::EscalateToUser;
        let t = plan_transition(prog(1, 0), &d, 3, None);
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
        let t = plan_transition(prog(1, 0), &d, 3, None);
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
        let t = plan_transition(prog(1, 0), &d, 3, Some("a"));
        assert_eq!(t.outcome, TickOutcome::Continue { speakers: vec![] });
    }

    #[test]
    fn round_backstop_pauses() {
        let t = plan_transition(
            prog(MAX_ROUNDS_BACKSTOP - 1, 0),
            &decision(RoundOutcome::Progressed, &["a"]),
            3,
            None,
        );
        assert_eq!(t.status, DeliberationStatus::Paused);
        assert_eq!(t.outcome, TickOutcome::Pause { reason: "round_backstop" });
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
        };
        let p = build_moderator_prompt(&ctx);
        assert!(p.contains("Ship faster"));
        assert!(p.contains("Architect"));
        assert!(p.contains("[a1] How to test?"));
        assert!(p.contains("\"deliberation\""));
    }
}
