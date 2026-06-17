//! Quality-gate fix-loop decision engine (fabro F7 lesson, reframed for personas'
//! per-execution model — NO workflow graph).
//!
//! Fabro's `goal_gate` + `retry_target` loops an agent back to a fix node when a
//! quality check fails, bounded by a visit limit and a failure-signature breaker.
//! Personas evaluates `output_assertions` / quality gates *after* a run but never
//! loops the agent back. This module is the pure decision core: given the gate
//! failures, the current attempt count, and the per-persona config, decide whether
//! to RE-ENTER the persona with a constructed fix prompt or STOP.
//!
//! Safety posture (honoring the "do not harm execution/evaluation" constraint):
//! the loop is **opt-in per persona and OFF by default**, hard-bounded by
//! `max_attempts`, and gated by the [`super::failure_signature`] breaker so a
//! deterministic failure can't loop forever. The runner additionally refuses to
//! re-enter during test/eval/lab/headless executions.

use serde_json::Value;

/// Default attempt cap when the persona enables the loop without specifying one.
const DEFAULT_MAX_ATTEMPTS: u32 = 2;

/// Per-persona fix-loop configuration, parsed from the `parameters` JSON column.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FixLoopConfig {
    pub enabled: bool,
    pub max_attempts: u32,
}

impl Default for FixLoopConfig {
    fn default() -> Self {
        Self { enabled: false, max_attempts: DEFAULT_MAX_ATTEMPTS }
    }
}

impl FixLoopConfig {
    /// Parse from the persona `parameters` JSON (an array of `PersonaParameter`
    /// objects). Looks for `fix_loop_enabled` (bool) and `max_fix_attempts`
    /// (number, clamped to 1..=5). Missing/malformed → default (disabled).
    #[must_use]
    pub fn from_persona_parameters(params_json: Option<&str>) -> Self {
        let mut cfg = Self::default();
        let Some(raw) = params_json else { return cfg };
        let Ok(Value::Array(params)) = serde_json::from_str::<Value>(raw) else {
            return cfg;
        };
        for p in &params {
            let Some(key) = p.get("key").and_then(Value::as_str) else { continue };
            // The stored value may live under "value" or fall back to "default".
            let v = p.get("value").or_else(|| p.get("default"));
            match key {
                "fix_loop_enabled" => {
                    if let Some(b) = coerce_bool(v) {
                        cfg.enabled = b;
                    }
                }
                "max_fix_attempts" => {
                    if let Some(n) = coerce_u32(v) {
                        cfg.max_attempts = n.clamp(1, 5);
                    }
                }
                _ => {}
            }
        }
        cfg
    }
}

/// What the runner should do after a run whose quality gate failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FixDecision {
    /// Re-run the SAME persona with `fix_prompt` prepended, as attempt `attempt`.
    ReEnter { fix_prompt: String, attempt: u32 },
    /// Stop looping; `reason` explains why (for the trace/log).
    Stop { reason: String },
}

/// Decide the next step. `attempt` is the number of fix attempts already made
/// (0 on the first failure). `signature_tripped` comes from the failure-signature
/// breaker (the same failure recurred too many times).
#[must_use]
pub fn decide(
    config: &FixLoopConfig,
    failures: &[String],
    attempt: u32,
    signature_tripped: bool,
) -> FixDecision {
    if !config.enabled {
        return FixDecision::Stop { reason: "fix-loop not enabled for this persona".into() };
    }
    if failures.is_empty() {
        return FixDecision::Stop { reason: "quality gate passed".into() };
    }
    if signature_tripped {
        return FixDecision::Stop {
            reason: "same failure recurred — circuit breaker tripped".into(),
        };
    }
    if attempt >= config.max_attempts {
        return FixDecision::Stop {
            reason: format!("reached max fix attempts ({})", config.max_attempts),
        };
    }
    FixDecision::ReEnter { fix_prompt: build_fix_prompt(failures), attempt: attempt + 1 }
}

/// Construct the corrective instruction injected as the next run's input.
#[must_use]
pub fn build_fix_prompt(failures: &[String]) -> String {
    let mut out = String::from(
        "Your previous output did not pass these quality checks:\n",
    );
    for f in failures {
        out.push_str("- ");
        out.push_str(f.trim());
        out.push('\n');
    }
    out.push_str(
        "\nReview the failures above and produce a corrected result that satisfies every check. \
         Do not repeat the same mistake.",
    );
    out
}

fn coerce_bool(v: Option<&Value>) -> Option<bool> {
    match v? {
        Value::Bool(b) => Some(*b),
        Value::String(s) => match s.trim().to_ascii_lowercase().as_str() {
            "true" | "1" | "yes" | "on" => Some(true),
            "false" | "0" | "no" | "off" | "" => Some(false),
            _ => None,
        },
        Value::Number(n) => Some(n.as_i64().unwrap_or(0) != 0),
        _ => None,
    }
}

fn coerce_u32(v: Option<&Value>) -> Option<u32> {
    match v? {
        Value::Number(n) => n.as_u64().map(|x| x as u32),
        Value::String(s) => s.trim().parse::<u32>().ok(),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_by_default() {
        assert_eq!(FixLoopConfig::from_persona_parameters(None), FixLoopConfig::default());
        assert!(!FixLoopConfig::from_persona_parameters(Some("not json")).enabled);
    }

    #[test]
    fn parses_enabled_and_attempts() {
        let json = r#"[
            {"key":"fix_loop_enabled","type":"boolean","value":true},
            {"key":"max_fix_attempts","type":"number","value":3}
        ]"#;
        let cfg = FixLoopConfig::from_persona_parameters(Some(json));
        assert!(cfg.enabled);
        assert_eq!(cfg.max_attempts, 3);
    }

    #[test]
    fn coerces_string_values_and_clamps() {
        let json = r#"[
            {"key":"fix_loop_enabled","value":"true"},
            {"key":"max_fix_attempts","value":"99"}
        ]"#;
        let cfg = FixLoopConfig::from_persona_parameters(Some(json));
        assert!(cfg.enabled);
        assert_eq!(cfg.max_attempts, 5, "should clamp to 5");
    }

    #[test]
    fn decide_stops_when_disabled() {
        let cfg = FixLoopConfig::default();
        assert!(matches!(
            decide(&cfg, &["x".into()], 0, false),
            FixDecision::Stop { .. }
        ));
    }

    #[test]
    fn decide_reenters_on_failure_within_budget() {
        let cfg = FixLoopConfig { enabled: true, max_attempts: 2 };
        match decide(&cfg, &["lint failed".into()], 0, false) {
            FixDecision::ReEnter { fix_prompt, attempt } => {
                assert_eq!(attempt, 1);
                assert!(fix_prompt.contains("lint failed"));
            }
            other => panic!("expected ReEnter, got {other:?}"),
        }
    }

    #[test]
    fn decide_stops_at_max_attempts_and_on_breaker() {
        let cfg = FixLoopConfig { enabled: true, max_attempts: 2 };
        assert!(matches!(
            decide(&cfg, &["x".into()], 2, false),
            FixDecision::Stop { .. }
        ));
        assert!(matches!(
            decide(&cfg, &["x".into()], 0, true),
            FixDecision::Stop { .. }
        ));
        assert!(matches!(
            decide(&cfg, &[], 0, false),
            FixDecision::Stop { .. }
        ));
    }
}
