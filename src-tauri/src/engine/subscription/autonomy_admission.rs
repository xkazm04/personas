//! **Autonomy admission** — the one question every autonomous Claude spender
//! asks before it starts work nobody asked for this minute: *may this persona
//! be run autonomously, now, on the Claude path?*
//!
//! # Why this exists (G55)
//!
//! Measured 2026-09-25: the operator switched the simulation off — attention
//! loop off, `attention.codex_mode` cleared, `attention.usage_stop_pct` set —
//! and the goal-advance / team-assignment engine still ran 203 Claude opus
//! executions (~$337) overnight for six App Master personas. Every switch the
//! operator reached for was honoured by exactly one engine, the attention
//! loop ([`super::attention`]); goal advance, assignment auto-resume, the
//! orchestrator's steps, boot-time orphan recovery, team-channel delegation
//! chains and incident continuation honoured none of them.
//!
//! This module adds no new policy. It **composes the existing gauges** into
//! one verdict so the other engines stop re-deriving (or skipping) them:
//!
//! | Gate | Source | Scope |
//! |---|---|---|
//! | quota stop | [`super::usage_governor::verdict`] / `stop_pct` | global |
//! | memory stop | [`super::usage_pacing::verdict_for_pass`] (`memory_slots`) | global |
//! | persona exists + `enabled` | `personas` row | persona |
//! | codex_mode | `attention.codex_mode` — these engines cannot route to codex | persona |
//! | concurrency cap | [`personas_engine::active_persona_cap::dispatch_refusal`] | persona |
//!
//! [`admit_global`] is the persona-less half, for ticks that decide before a
//! persona is known (goal advance, incident continuation, boot recovery).
//!
//! # Failure policy — mirrored, not invented
//!
//! * An **unreadable usage gauge fails open**, exactly as the governor does
//!   (its `verdict_from` returns `blocked: false` with an `unavailable_reason`).
//! * **No `AppState`** (no memory sampler reachable) skips the memory gate —
//!   the same "an unread gauge is not an empty tank" rule.
//! * A **failed DB read** on the persona half **defers**: that is the rule
//!   `active_persona_cap` states for itself — a guard that fails open under
//!   load is not a guard.
//!
//! The decision itself ([`decide_global`], [`decide`]) is pure over
//! [`GlobalGauges`] + [`PersonaFacts`] so every refusal is unit-testable
//! without a network, a sampler or a database.

use std::fmt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::{AppHandle, Manager};

use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::core::settings;
use crate::db::settings_keys;
use crate::db::DbPool;
use crate::error::AppError;

/// The verdict.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Admission {
    Go,
    Defer(DeferReason),
}

impl Admission {
    pub(crate) fn is_go(&self) -> bool {
        matches!(self, Admission::Go)
    }
}

/// Why an autonomous run was deferred. Every variant is a "not now", never a
/// failure: the caller leaves its work where it was and asks again later.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum DeferReason {
    /// The quota governor is at its stop (`attention.usage_stop_pct`).
    UsageStop { summary: String },
    /// One more worker would push memory past `fleet_autopilot.memory_stop_pct`.
    MemoryFull { used_pct: f64, stop_pct: f64 },
    /// The persona row is gone.
    PersonaMissing,
    /// The operator switched the persona off.
    PersonaDisabled,
    /// The persona is listed in `attention.codex_mode`; these engines can only
    /// run it on Claude, which is exactly what codex_mode opts it out of.
    CodexMode,
    /// `max_active_personas` is full and this persona is not already running.
    ConcurrencyCap { running: usize, cap: usize },
    /// A read the decision needed failed — deferred, not admitted.
    Unreadable(String),
}

impl DeferReason {
    /// Stable short code for logs, event payloads and tests.
    pub(crate) fn code(&self) -> &'static str {
        match self {
            DeferReason::UsageStop { .. } => "usage_stop",
            DeferReason::MemoryFull { .. } => "memory_full",
            DeferReason::PersonaMissing => "persona_missing",
            DeferReason::PersonaDisabled => "persona_disabled",
            DeferReason::CodexMode => "codex_mode",
            DeferReason::ConcurrencyCap { .. } => "concurrency_cap",
            DeferReason::Unreadable(_) => "unreadable",
        }
    }
}

impl fmt::Display for DeferReason {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DeferReason::UsageStop { summary } => write!(f, "quota governor stop: {summary}"),
            DeferReason::MemoryFull { used_pct, stop_pct } => write!(
                f,
                "memory stop: {used_pct:.0}% used, no room for another worker under {stop_pct:.0}%"
            ),
            DeferReason::PersonaMissing => write!(f, "persona no longer exists"),
            DeferReason::PersonaDisabled => write!(f, "persona is switched off"),
            DeferReason::CodexMode => write!(
                f,
                "persona is in attention.codex_mode; this engine can only run it on Claude"
            ),
            DeferReason::ConcurrencyCap { running, cap } => write!(
                f,
                "concurrency cap: {running} of {cap} active personas already running"
            ),
            DeferReason::Unreadable(e) => write!(f, "admission read failed: {e}"),
        }
    }
}

/// The global gauges, already read.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct GlobalGauges {
    pub usage_blocked: bool,
    pub usage_summary: String,
    /// `None` when no memory reading was available (fails open).
    pub memory: Option<MemoryGauge>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct MemoryGauge {
    pub used_pct: f64,
    pub stop_pct: f64,
    /// Workers the free memory below the stop line can hold.
    pub slots: usize,
}

/// The persona half, already read.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct PersonaFacts {
    pub exists: bool,
    pub enabled: bool,
    pub in_codex_mode: bool,
    /// `Some((running, cap))` when the concurrency cap refuses this persona.
    pub cap_refusal: Option<(usize, usize)>,
}

/// Pure: the persona-less half.
pub(crate) fn decide_global(g: &GlobalGauges) -> Admission {
    if g.usage_blocked {
        return Admission::Defer(DeferReason::UsageStop {
            summary: g.usage_summary.clone(),
        });
    }
    if let Some(m) = g.memory {
        if m.slots == 0 {
            return Admission::Defer(DeferReason::MemoryFull {
                used_pct: m.used_pct,
                stop_pct: m.stop_pct,
            });
        }
    }
    Admission::Go
}

/// Pure: the whole decision for one persona. The global gates first (they
/// refuse everyone alike), then the persona's own switches, then the cap.
pub(crate) fn decide(g: &GlobalGauges, p: &PersonaFacts) -> Admission {
    if let Admission::Defer(r) = decide_global(g) {
        return Admission::Defer(r);
    }
    if !p.exists {
        return Admission::Defer(DeferReason::PersonaMissing);
    }
    if !p.enabled {
        return Admission::Defer(DeferReason::PersonaDisabled);
    }
    if p.in_codex_mode {
        return Admission::Defer(DeferReason::CodexMode);
    }
    if let Some((running, cap)) = p.cap_refusal {
        return Admission::Defer(DeferReason::ConcurrencyCap { running, cap });
    }
    Admission::Go
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

/// The `AppState` behind an `AppHandle`, when it is managed (it is not in
/// unit tests).
pub(crate) fn app_state(app: &AppHandle) -> Option<Arc<crate::AppState>> {
    app.try_state::<Arc<crate::AppState>>()
        .map(|s| s.inner().clone())
}

/// Read the global gauges. The usage snapshot is the process-wide cached one
/// (at most one HTTP call per 45 s, shared with the governor and the pacing).
pub(crate) async fn read_global_gauges(
    pool: &DbPool,
    state: Option<&crate::AppState>,
) -> GlobalGauges {
    let verdict = super::usage_governor::verdict(pool).await;
    let stop = super::usage_governor::stop_pct(pool);
    let memory = match state {
        // codex_only = true: only the memory ceiling, not the Claude pace —
        // the pace is the attention loop's weekly plan, the memory stop is
        // the machine's.
        Some(s) => {
            let p = super::usage_pacing::verdict_for_pass(pool, s, true).await;
            Some(MemoryGauge {
                used_pct: p.memory_used_pct,
                stop_pct: p.memory_stop_pct,
                slots: p.memory_slots,
            })
        }
        None => None,
    };
    GlobalGauges {
        usage_blocked: verdict.blocked,
        usage_summary: verdict.summary(stop),
        memory,
    }
}

/// Parse the persona ids out of an `attention.codex_mode` value. Lenient on
/// everything but the list: a value the attention loop would reject for a bad
/// `effort` still names personas the operator moved off Claude, and deferring
/// them here is the conservative reading.
fn parse_codex_personas(raw: Option<&str>) -> Vec<String> {
    let Some(raw) = raw.filter(|v| !v.trim().is_empty()) else {
        return Vec::new();
    };
    serde_json::from_str::<serde_json::Value>(raw)
        .ok()
        .and_then(|v| {
            v.get("personas").and_then(|p| p.as_array()).map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str())
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect()
            })
        })
        .unwrap_or_default()
}

// same setting as attention::read_codex_mode; unify when attention.rs is free
fn codex_mode_personas(pool: &DbPool) -> Result<Vec<String>, AppError> {
    let raw = settings::get(pool, settings_keys::ATTENTION_CODEX_MODE)?;
    Ok(parse_codex_personas(raw.as_deref()))
}

/// Read the persona half. A NotFound persona is a fact (`exists: false`);
/// any other read failure propagates so the caller defers.
pub(crate) fn read_persona_facts(
    pool: &DbPool,
    persona_id: &str,
) -> Result<PersonaFacts, AppError> {
    let persona = match persona_repo::get_by_id(pool, persona_id) {
        Ok(p) => p,
        Err(AppError::NotFound(_)) => return Ok(PersonaFacts::default()),
        Err(e) => return Err(e),
    };
    let in_codex_mode = codex_mode_personas(pool)?
        .iter()
        .any(|id| id == persona_id.trim());
    let cap_refusal = personas_engine::active_persona_cap::dispatch_refusal(pool, persona_id)?
        .map(|h| (h.running, h.cap));
    Ok(PersonaFacts {
        exists: true,
        enabled: persona.enabled,
        in_codex_mode,
        cap_refusal,
    })
}

/// May an autonomous tick that has not yet picked a persona proceed?
/// (quota governor + memory stop)
pub(crate) async fn admit_global(pool: &DbPool, state: Option<&crate::AppState>) -> Admission {
    decide_global(&read_global_gauges(pool, state).await)
}

/// May `persona_id` be run autonomously, now, on the Claude path?
pub(crate) async fn admit_autonomous(
    pool: &DbPool,
    state: Option<&crate::AppState>,
    persona_id: &str,
) -> Admission {
    let gauges = read_global_gauges(pool, state).await;
    if let Admission::Defer(r) = decide_global(&gauges) {
        return Admission::Defer(r);
    }
    match read_persona_facts(pool, persona_id) {
        Ok(facts) => decide(&gauges, &facts),
        Err(e) => Admission::Defer(DeferReason::Unreadable(e.to_string())),
    }
}

/// Log a site's admission once per transition (into a hold, and out of it),
/// not once per tick: a held loop ticks every few minutes for as long as the
/// operator's switch stays set, and a line each time buries the one that
/// matters. `announced` is the site's own flag.
pub(crate) fn log_transition(announced: &AtomicBool, site: &str, admission: &Admission) {
    match admission {
        Admission::Defer(reason) => {
            if !announced.swap(true, Ordering::Relaxed) {
                tracing::info!(
                    site,
                    reason = reason.code(),
                    detail = %reason,
                    "autonomy admission: HELD — no autonomous Claude work starts here until it clears"
                );
            }
        }
        Admission::Go => {
            if announced.swap(false, Ordering::Relaxed) {
                tracing::info!(
                    site,
                    "autonomy admission: released — autonomous work resumes"
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open() -> GlobalGauges {
        GlobalGauges {
            usage_blocked: false,
            usage_summary: "seven_day at 40% of 97% stop".into(),
            memory: Some(MemoryGauge {
                used_pct: 40.0,
                stop_pct: 85.0,
                slots: 3,
            }),
        }
    }

    fn healthy() -> PersonaFacts {
        PersonaFacts {
            exists: true,
            enabled: true,
            in_codex_mode: false,
            cap_refusal: None,
        }
    }

    #[test]
    fn admission_goes_when_every_gate_is_open() {
        assert_eq!(decide_global(&open()), Admission::Go);
        assert_eq!(decide(&open(), &healthy()), Admission::Go);
    }

    #[test]
    fn admission_defers_on_the_quota_stop() {
        let mut g = open();
        g.usage_blocked = true;
        g.usage_summary = "five_hour at 97% of 97% stop — DISPATCH STOPPED".into();
        let a = decide(&g, &healthy());
        match &a {
            Admission::Defer(r) => {
                assert_eq!(r.code(), "usage_stop");
                assert!(r.to_string().contains("DISPATCH STOPPED"));
            }
            Admission::Go => panic!("a stopped governor must defer"),
        }
        assert_eq!(decide_global(&g), a, "the global half refuses alike");
    }

    /// The governor fails open on an unreadable gauge (`blocked: false`);
    /// admission mirrors it rather than inventing a stricter policy.
    #[test]
    fn admission_fails_open_on_an_unread_gauge_and_no_memory_reading() {
        let g = GlobalGauges {
            usage_blocked: false,
            usage_summary: "usage gauge unreadable (no_credentials)".into(),
            memory: None,
        };
        assert_eq!(decide_global(&g), Admission::Go);
        assert_eq!(decide(&g, &healthy()), Admission::Go);
    }

    #[test]
    fn admission_defers_on_the_memory_stop() {
        let mut g = open();
        g.memory = Some(MemoryGauge {
            used_pct: 91.0,
            stop_pct: 85.0,
            slots: 0,
        });
        match decide_global(&g) {
            Admission::Defer(r) => assert_eq!(r.code(), "memory_full"),
            Admission::Go => panic!("no room for a worker must defer"),
        }
    }

    #[test]
    fn admission_defers_a_missing_or_disabled_persona() {
        let missing = PersonaFacts::default();
        assert_eq!(
            decide(&open(), &missing),
            Admission::Defer(DeferReason::PersonaMissing)
        );
        let mut off = healthy();
        off.enabled = false;
        assert_eq!(
            decide(&open(), &off),
            Admission::Defer(DeferReason::PersonaDisabled)
        );
    }

    #[test]
    fn admission_defers_a_codex_mode_persona() {
        let mut p = healthy();
        p.in_codex_mode = true;
        assert_eq!(
            decide(&open(), &p),
            Admission::Defer(DeferReason::CodexMode)
        );
    }

    #[test]
    fn admission_defers_at_the_concurrency_cap() {
        let mut p = healthy();
        p.cap_refusal = Some((6, 6));
        assert_eq!(
            decide(&open(), &p),
            Admission::Defer(DeferReason::ConcurrencyCap { running: 6, cap: 6 })
        );
    }

    /// The quota stop outranks the persona's own facts: one reason, the one
    /// that applies to everyone.
    #[test]
    fn admission_global_refusal_wins_over_persona_refusal() {
        let mut g = open();
        g.usage_blocked = true;
        let mut p = healthy();
        p.enabled = false;
        match decide(&g, &p) {
            Admission::Defer(r) => assert_eq!(r.code(), "usage_stop"),
            Admission::Go => panic!("must defer"),
        }
    }

    #[test]
    fn admission_parses_the_codex_mode_persona_list() {
        assert!(parse_codex_personas(None).is_empty());
        assert!(parse_codex_personas(Some("  ")).is_empty());
        assert!(parse_codex_personas(Some("not json")).is_empty());
        assert!(parse_codex_personas(Some(r#"{"personas":[]}"#)).is_empty());
        assert_eq!(
            parse_codex_personas(Some(
                r#"{"personas":["p1"," p2 ",""],"model":"gpt","effort":"bogus"}"#
            )),
            vec!["p1".to_string(), "p2".to_string()],
            "a bad effort still names personas the operator moved off Claude"
        );
    }

    #[test]
    fn admission_reads_persona_facts_from_the_db() -> Result<(), AppError> {
        use crate::db::models::CreatePersonaInput;
        let pool = crate::db::init_test_db()?;
        let mk = |name: &str, enabled: bool| {
            persona_repo::create(
                &pool,
                CreatePersonaInput {
                    name: name.into(),
                    system_prompt: "You are a test agent.".into(),
                    project_id: None,
                    description: None,
                    structured_prompt: None,
                    icon: None,
                    color: None,
                    enabled: Some(enabled),
                    max_concurrent: None,
                    timeout_ms: None,
                    model_profile: None,
                    max_budget_usd: None,
                    max_turns: None,
                    design_context: None,
                    notification_channels: None,
                    lifecycle: None,
                },
            )
            .map(|p| p.id)
        };
        let on = mk("On", true)?;
        let off = mk("Off", false)?;
        settings::set(
            &pool,
            settings_keys::ATTENTION_CODEX_MODE,
            &format!(r#"{{"personas":["{on}"]}}"#),
        )?;

        let on_facts = read_persona_facts(&pool, &on)?;
        assert!(on_facts.exists && on_facts.enabled && on_facts.in_codex_mode);
        assert_eq!(
            decide(&open(), &on_facts),
            Admission::Defer(DeferReason::CodexMode)
        );

        let off_facts = read_persona_facts(&pool, &off)?;
        assert!(off_facts.exists && !off_facts.enabled && !off_facts.in_codex_mode);

        let gone = read_persona_facts(&pool, "no-such-persona")?;
        assert!(!gone.exists);
        Ok(())
    }
}
