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

/// Persona free-parameter key carrying a POSITIVE tool roster (an allowlist).
///
/// Why a free parameter and not a `personas` column: the tree already runs two
/// per-persona runtime knobs through `parameters` — `execution_discipline` and
/// `deep_fanout` (above) — and both are read at CLI-args build time by the same
/// lookup shape. A parameter needs no migration, no `Persona` field, no ts-rs
/// binding and no new editor: the generic parameter editor already renders it,
/// so an operator can declare a roster today. A column would have bought
/// nothing this one does not, at the cost of a projection, two mappers, an
/// insert, an update and a binding.
pub const ALLOWED_TOOLS_PARAM: &str = "allowed_tools";

/// Longest roster we will accept from a persona parameter. A roster is a
/// latency lever, not a config dump; 64 names is far past the ~5 the source
/// benchmark found optimal and past personas' own 33-tool MCP surface, so
/// anything longer is a mistake rather than an intention.
const MAX_ROSTER_ENTRIES: usize = 64;

/// Whether a declared tool name is safe to place on a command line and
/// meaningful as a roster entry.
///
/// The value reaches `--allowedTools` as a single argv element, so it must not
/// smuggle a second flag or a shell fragment. Claude Code tool names are
/// `Bash`, `Read`, `mcp__playwright__*`, `Bash(git:*)` — letters, digits,
/// `_ - . : * ( ) /` and nothing else. Rejecting the entry (rather than the
/// whole roster) would silently widen the roster, so a malformed entry
/// invalidates the declaration: a roster you cannot trust must not be applied
/// as if it were narrower than it is.
fn valid_tool_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && !name.starts_with('-')
        && name.chars().all(|c| {
            c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | ':' | '*' | '(' | ')' | '/')
        })
}

/// Resolve the persona's declared tool roster.
///
/// `None` means "no declaration" — every caller must then behave exactly as it
/// did before this parameter existed (Claude Code's full default roster on the
/// CLI path, `REMOTE_SAFE_MCP_TOOLS` on the HTTP path). `Some(names)` is a
/// non-empty, validated allowlist.
///
/// Accepts either a JSON array of strings or a comma/whitespace-separated
/// string, because the generic parameter editor stores a `text` parameter as a
/// string and a `multiselect` as an array, and an operator should not have to
/// know which one they got.
///
/// Returns `None` — never a partial roster — when the declaration is empty,
/// unparseable, over [`MAX_ROSTER_ENTRIES`], or contains an entry that fails
/// [`valid_tool_name`]. Failing open to today's behaviour is the safe
/// direction: a mis-typed roster must not silently become a narrower one that
/// makes a persona fail in a way nobody can attribute.
pub fn resolve_allowed_tools(persona: &Persona) -> Option<Vec<String>> {
    let params_json = persona.parameters.as_deref()?;
    let params = serde_json::from_str::<Vec<serde_json::Value>>(params_json).ok()?;
    let raw = params.into_iter().find_map(|p| {
        if p.get("key").and_then(|v| v.as_str()) != Some(ALLOWED_TOOLS_PARAM) {
            return None;
        }
        p.get("value")
            .or_else(|| p.get("default_value"))
            .or_else(|| p.get("default"))
            .cloned()
    })?;

    let names: Vec<String> = match raw {
        serde_json::Value::Array(items) => items
            .iter()
            .map(|v| v.as_str().unwrap_or("").trim().to_string())
            .filter(|s| !s.is_empty())
            .collect(),
        serde_json::Value::String(s) => s
            .split([',', '\n', ' ', '\t'])
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect(),
        _ => return None,
    };

    if names.is_empty() || names.len() > MAX_ROSTER_ENTRIES {
        return None;
    }
    if !names.iter().all(|n| valid_tool_name(n)) {
        tracing::warn!(
            persona_id = %persona.id,
            "persona `allowed_tools` parameter contains an invalid tool name — roster ignored, \
             falling back to the unbounded default"
        );
        return None;
    }
    Some(names)
}

#[cfg(test)]
mod allowed_tools_tests {
    use super::*;

    fn persona_with_params(params: &str) -> Persona {
        Persona {
            id: "p1".into(),
            parameters: Some(params.to_string()),
            ..Default::default()
        }
    }

    #[test]
    fn absent_parameter_declares_nothing() {
        let mut p = persona_with_params("[]");
        assert_eq!(resolve_allowed_tools(&p), None);
        p.parameters = None;
        assert_eq!(resolve_allowed_tools(&p), None);
    }

    #[test]
    fn array_value_is_a_roster() {
        let p = persona_with_params(
            r#"[{"key":"allowed_tools","value":["Read","Grep","mcp__playwright__*"]}]"#,
        );
        assert_eq!(
            resolve_allowed_tools(&p),
            Some(vec![
                "Read".to_string(),
                "Grep".to_string(),
                "mcp__playwright__*".to_string()
            ])
        );
    }

    #[test]
    fn comma_separated_string_is_a_roster() {
        let p =
            persona_with_params(r#"[{"key":"allowed_tools","value":"Read, Grep,Bash(git:*)"}]"#);
        assert_eq!(
            resolve_allowed_tools(&p),
            Some(vec![
                "Read".to_string(),
                "Grep".to_string(),
                "Bash(git:*)".to_string()
            ])
        );
    }

    #[test]
    fn falls_back_to_default_value_when_value_absent() {
        let p = persona_with_params(r#"[{"key":"allowed_tools","default_value":"Read"}]"#);
        assert_eq!(resolve_allowed_tools(&p), Some(vec!["Read".to_string()]));
    }

    #[test]
    fn empty_declaration_is_not_a_roster() {
        let p = persona_with_params(r#"[{"key":"allowed_tools","value":"   "}]"#);
        assert_eq!(resolve_allowed_tools(&p), None);
        let p = persona_with_params(r#"[{"key":"allowed_tools","value":[]}]"#);
        assert_eq!(resolve_allowed_tools(&p), None);
    }

    /// A roster that cannot be trusted must not be applied as if it were
    /// narrower than it is — the whole declaration is dropped, not the entry.
    #[test]
    fn an_argv_smuggling_entry_invalidates_the_whole_roster() {
        for bad in [
            "--dangerously-skip-permissions",
            "Read; rm -rf /",
            "Read Write",
            "Read\"",
            "Read$(id)",
        ] {
            let p = persona_with_params(&format!(
                r#"[{{"key":"allowed_tools","value":["Read",{}]}}]"#,
                serde_json::to_string(bad).unwrap()
            ));
            assert_eq!(resolve_allowed_tools(&p), None, "should reject {bad:?}");
        }
    }

    #[test]
    fn an_absurdly_long_roster_is_a_mistake_not_an_intention() {
        let names: Vec<String> = (0..MAX_ROSTER_ENTRIES + 1)
            .map(|i| format!("T{i}"))
            .collect();
        let p = persona_with_params(&format!(
            r#"[{{"key":"allowed_tools","value":{}}}]"#,
            serde_json::to_string(&names).unwrap()
        ));
        assert_eq!(resolve_allowed_tools(&p), None);
    }
}
