//! Call classes — the one table that decides which model and effort a
//! headless one-shot LLM call runs on.
//!
//! **Why this module exists.** Until 2026-10-08 every headless call site
//! named its own model: ~45 `const *_MODEL` declarations, most of them a
//! `claude-sonnet-4-6` literal that nobody re-evaluated when a successor
//! shipped. The routing standard (`model-routing/turn-classification`) puts
//! it plainly: the call's class is asserted where the call originates, mapped
//! through ONE table, calibrated by measurement — and no call site names a
//! model.
//!
//! **The calibration.** The table below is an empirical artifact, not a
//! settings page of opinions. Measured 2026-10-08 with deterministic scoring
//! (no LLM judge) on `scripts/test/oneshot-model-bench.mjs` (61 tasks x 4
//! cells x 3 reps) and `scripts/test/athena-model-bench.mjs` (46 scenarios x
//! 3 reps): Haiku 5.5 at medium effort matched or beat Sonnet 5.5 on
//! extraction, structured JSON and SQL at ~95% lower cost; its one consistent
//! gap is JUDGMENT (triage verdicts 92% vs 100% on hard cases; Athena
//! memory-write proposals 0/3 vs 3/3, not fixable by prompt reinforcement).
//! So the cheap classes go to Haiku with a one-shot escalation to Sonnet when
//! the site's own validator rejects the output, and the judgment classes stay
//! on Sonnet. Re-measure before moving a row: `docs/tests/model-bench/haiku-5-5.md`.
//!
//! Persona executions are routed elsewhere (`db::model_routing`, the
//! persona/category/difficulty cascade) and Athena's conversational turns by
//! `companion::model_routing`; both read their ids from [`super::model_ids`].

use super::model_ids::{HAIKU_CURRENT, SONNET_CURRENT};

/// What kind of headless one-shot a call site is making. Closed vocabulary:
/// add a variant only with a measurement that justifies its row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CallClass {
    /// Short label for a session/thread/item (fleet session naming, titling).
    Title,
    /// Pick one of a small closed set of labels.
    Classify,
    /// Plain-language digest of material already gathered (no judgment).
    Summarize,
    /// Pull structured facts out of a document or page into a schema.
    Extract,
    /// Generate a strict JSON structure from an intent (team DAGs, transforms).
    StructuredJson,
    /// Write a SQL query from a natural-language question and a schema.
    Sql,
    /// Judge another output: approve/reject, score, critique, review.
    Verdict,
    /// Long-form reasoning over many inputs (moderation, consolidation,
    /// reflection, persona generation, standards and vault synthesis).
    Synthesis,
    /// A tool-using task that acts on the user's environment (credentials,
    /// dev tasks, fix passes, repo scans, dispatch).
    AgentTask,
    /// The Director. Pinned deliberately: it moves only by explicit decision,
    /// never as a side effect of re-tuning another row.
    Director,
    /// The persona build session and its test planning. `PERSONAS_BUILD_MODEL`
    /// overrides the model for benchmarking only (read by the build session).
    Build,
}

/// The route a class resolves to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClassRoute {
    pub model: &'static str,
    /// Always a concrete CLI `--effort` value; there is no "CLI default" path.
    pub effort: &'static str,
    /// `(model, effort)` to retry ONCE on when the site's own parser or
    /// validator rejects the output. `None` = no escalation.
    pub escalate_to: Option<(&'static str, &'static str)>,
}

const SONNET_MEDIUM: Option<(&str, &str)> = Some((SONNET_CURRENT, "medium"));

/// The table. One row per class; see the module doc for the calibration.
pub const fn route(class: CallClass) -> ClassRoute {
    match class {
        // name-*: h55-low 97.2% vs s55-low 94.4%.
        CallClass::Title => ClassRoute {
            model: HAIKU_CURRENT,
            effort: "low",
            escalate_to: None,
        },
        CallClass::Classify => ClassRoute {
            model: HAIKU_CURRENT,
            effort: "low",
            escalate_to: SONNET_MEDIUM,
        },
        CallClass::Summarize => ClassRoute {
            model: HAIKU_CURRENT,
            effort: "medium",
            escalate_to: None,
        },
        // kb-*: h55-med 100% = s55; h55-low 97% (missed a split-paragraph merge).
        CallClass::Extract => ClassRoute {
            model: HAIKU_CURRENT,
            effort: "medium",
            escalate_to: SONNET_MEDIUM,
        },
        // team-synthesis: h55-med 100% vs s55-low 95.8%.
        CallClass::StructuredJson => ClassRoute {
            model: HAIKU_CURRENT,
            effort: "medium",
            escalate_to: SONNET_MEDIUM,
        },
        // sql-*: h55-med 100% vs s55-low 95.2%.
        CallClass::Sql => ClassRoute {
            model: HAIKU_CURRENT,
            effort: "medium",
            escalate_to: SONNET_MEDIUM,
        },
        // triage-*: h55 92% on hard vs s55 100% — Haiku's measured gap.
        CallClass::Verdict => ClassRoute {
            model: SONNET_CURRENT,
            effort: "medium",
            escalate_to: None,
        },
        CallClass::Synthesis => ClassRoute {
            model: SONNET_CURRENT,
            effort: "medium",
            escalate_to: None,
        },
        CallClass::AgentTask => ClassRoute {
            model: SONNET_CURRENT,
            effort: "medium",
            escalate_to: None,
        },
        CallClass::Director => ClassRoute {
            model: SONNET_CURRENT,
            effort: "medium",
            escalate_to: None,
        },
        // Unmeasured on Haiku until the build bench runs; keeps BUILD_MODEL's
        // historical `--effort low`.
        CallClass::Build => ClassRoute {
            model: SONNET_CURRENT,
            effort: "low",
            escalate_to: None,
        },
    }
}

impl CallClass {
    pub const ALL: [CallClass; 11] = [
        CallClass::Title,
        CallClass::Classify,
        CallClass::Summarize,
        CallClass::Extract,
        CallClass::StructuredJson,
        CallClass::Sql,
        CallClass::Verdict,
        CallClass::Synthesis,
        CallClass::AgentTask,
        CallClass::Director,
        CallClass::Build,
    ];

    /// Stable snake_case name for logs and spend rows.
    pub const fn as_str(self) -> &'static str {
        match self {
            CallClass::Title => "title",
            CallClass::Classify => "classify",
            CallClass::Summarize => "summarize",
            CallClass::Extract => "extract",
            CallClass::StructuredJson => "structured_json",
            CallClass::Sql => "sql",
            CallClass::Verdict => "verdict",
            CallClass::Synthesis => "synthesis",
            CallClass::AgentTask => "agent_task",
            CallClass::Director => "director",
            CallClass::Build => "build",
        }
    }

    pub const fn route(self) -> ClassRoute {
        route(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model_ids::is_retired;

    #[test]
    fn every_route_is_a_current_dated_id_with_a_concrete_effort() {
        for c in CallClass::ALL {
            let r = c.route();
            assert!(
                r.model.starts_with("claude-") && !is_retired(r.model),
                "{c:?}: {}",
                r.model
            );
            assert!(
                matches!(r.effort, "low" | "medium" | "high"),
                "{c:?}: {}",
                r.effort
            );
            if let Some((m, e)) = r.escalate_to {
                assert_ne!(m, r.model, "{c:?} escalates to itself");
                assert!(!is_retired(m) && matches!(e, "low" | "medium" | "high"));
            }
        }
    }

    #[test]
    fn judgment_classes_stay_off_haiku() {
        for c in [
            CallClass::Verdict,
            CallClass::Synthesis,
            CallClass::AgentTask,
            CallClass::Director,
            CallClass::Build,
        ] {
            assert_ne!(
                c.route().model,
                HAIKU_CURRENT,
                "{c:?} is a measured-judgment class"
            );
        }
    }

    #[test]
    fn names_are_unique() {
        let mut v: Vec<_> = CallClass::ALL.iter().map(|c| c.as_str()).collect();
        v.sort();
        v.dedup();
        assert_eq!(v.len(), CallClass::ALL.len());
    }
}
