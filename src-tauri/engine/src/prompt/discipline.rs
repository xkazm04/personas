use personas_db::models::Persona;

/// Execution discipline mode — picks between the default autonomous directive
/// (business personas) and a Karpathy-aligned "deliberate" variant (code personas
/// that need to clarify ambiguity, stay surgical, and verify before emitting).
///
/// Resolved from persona parameter `execution_discipline` (Select type, options
/// `autonomous` | `deliberate`). Default is `Autonomous` for backwards compat.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DisciplineMode {
    Autonomous,
    Deliberate,
}

impl DisciplineMode {
    pub(crate) fn resolve(persona: &Persona) -> Self {
        let Some(params_json) = persona.parameters.as_deref() else {
            return Self::Autonomous;
        };
        let Ok(params) = serde_json::from_str::<Vec<serde_json::Value>>(params_json) else {
            return Self::Autonomous;
        };
        for p in params {
            if p.get("key").and_then(|v| v.as_str()) == Some("execution_discipline") {
                let val = p
                    .get("value")
                    .and_then(|v| v.as_str())
                    .or_else(|| p.get("default_value").and_then(|v| v.as_str()))
                    .or_else(|| p.get("default").and_then(|v| v.as_str()))
                    .unwrap_or("autonomous");
                return match val {
                    "deliberate" => Self::Deliberate,
                    _ => Self::Autonomous,
                };
            }
        }
        Self::Autonomous
    }
}

/// Directive (P4) appended when a persona enables the `deep_fanout` parameter:
/// instructs the model to delegate independent parallel sub-tasks to subagents
/// via the Task tool. Harmless on plans that don't expose Task (the model simply
/// can't call it). Cost is bounded by the persona's `--max-budget-usd`, which a
/// fan-out persona should set (a fan-out can spawn many subagents).
pub(crate) const FANOUT_DIRECTIVE: &str = "\n## Parallel Delegation (deep fan-out)\nWhen the work contains independent sub-tasks that can run concurrently — gathering from multiple sources, reviewing multiple items, analyzing multiple angles — delegate each to a parallel subagent via the Task tool instead of doing them sequentially yourself, then synthesize their results. This is faster and reuses the cached system context. Delegate only genuinely independent work; keep dependent or sequential steps in the main thread.\n\n";

/// Whether the persona opted into deep fan-out (P4) via the `deep_fanout`
/// boolean parameter. Mirrors `DisciplineMode::resolve`'s parameter lookup.
pub(crate) fn deep_fanout_enabled(persona: &Persona) -> bool {
    let Some(params_json) = persona.parameters.as_deref() else {
        return false;
    };
    let Ok(params) = serde_json::from_str::<Vec<serde_json::Value>>(params_json) else {
        return false;
    };
    for p in params {
        if p.get("key").and_then(|v| v.as_str()) == Some("deep_fanout") {
            let v = p
                .get("value")
                .or_else(|| p.get("default_value"))
                .or_else(|| p.get("default"));
            return match v {
                Some(serde_json::Value::Bool(b)) => *b,
                Some(serde_json::Value::String(s)) => s == "true",
                _ => false,
            };
        }
    }
    false
}
