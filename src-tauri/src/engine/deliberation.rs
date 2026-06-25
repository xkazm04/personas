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

use serde::Deserialize;

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
