//! Tiny shared helpers for reading the `design_context` JSON envelope.
//!
//! The design_context is stored on `personas.design_context` as a JSON
//! TEXT column. Two key shapes have shipped in production:
//!
//!   - **camelCase** — written by the matrix-builder promote path
//!     (`commands/design/build_sessions.rs::build_design_json`) and the
//!     template-adoption + team-synthesis paths. Wraps the array under
//!     `useCases` to match `DesignContextData`'s `#[serde(rename_all =
//!     "camelCase")]` envelope.
//!
//!   - **snake_case** — written by the C7 dry-run snapshot
//!     (`commands/design/build_simulate.rs::build_simulation_design_context`)
//!     and used in test fixtures + the `cascade_use_case_toggle` test
//!     seed. Matches what the runtime readers were originally written
//!     against.
//!
//! Historically each reader hardcoded one key, which created a latent
//! bug: `simulate_use_case` / `cascade_use_case_toggle` /
//! `execute_persona_inner` (snake-case readers) returned "no use_cases"
//! against personas built via the matrix builder (camelCase writer).
//!
//! This helper lets every design_context reader accept both shapes
//! without each call site re-doing the `.or_else()` dance. Template /
//! agent_ir readers (which are well-defined as snake_case via the build
//! prompt's IR schema) are intentionally NOT migrated to this helper —
//! the dual-shape concern is a design_context property, not an IR one.

use serde_json::Value;

/// Get the `use_cases` array from a parsed design_context value, accepting
/// either snake_case (`use_cases`) or camelCase (`useCases`). Returns
/// `None` when neither key is present or the value is not an array.
///
/// Pure: no I/O. Lifetimes preserved so callers can avoid clones.
pub fn pick_use_cases_array(dc: &Value) -> Option<&Vec<Value>> {
    dc.get("use_cases")
        .and_then(|v| v.as_array())
        .or_else(|| dc.get("useCases").and_then(|v| v.as_array()))
}

/// Mutable variant of [`pick_use_cases_array`] for sites that patch the
/// array in place (e.g. `cascade_use_case_toggle`). Resolves the same key
/// precedence: snake_case first, then camelCase.
pub fn pick_use_cases_array_mut(dc: &mut Value) -> Option<&mut Vec<Value>> {
    // Two-pass to satisfy the borrow checker: probe first to find which
    // key is present, then take the mutable borrow.
    let key = if dc.get("use_cases").map(|v| v.is_array()).unwrap_or(false) {
        "use_cases"
    } else if dc.get("useCases").map(|v| v.is_array()).unwrap_or(false) {
        "useCases"
    } else {
        return None;
    };
    dc.get_mut(key).and_then(|v| v.as_array_mut())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pick_array_returns_snake_case_first() {
        let v = serde_json::json!({
            "use_cases": [{"id": "snake_a"}],
            "useCases": [{"id": "camel_a"}]
        });
        let picked = pick_use_cases_array(&v).unwrap();
        assert_eq!(picked[0].get("id").unwrap(), "snake_a");
    }

    #[test]
    fn pick_array_falls_back_to_camel_case() {
        let v = serde_json::json!({
            "useCases": [{"id": "camel_only"}]
        });
        let picked = pick_use_cases_array(&v).unwrap();
        assert_eq!(picked.len(), 1);
        assert_eq!(picked[0].get("id").unwrap(), "camel_only");
    }

    #[test]
    fn pick_array_returns_none_when_neither_key_present() {
        let v = serde_json::json!({"summary": "nothing here"});
        assert!(pick_use_cases_array(&v).is_none());
    }

    #[test]
    fn pick_array_returns_none_when_value_is_not_array() {
        let v = serde_json::json!({"use_cases": "not an array"});
        assert!(pick_use_cases_array(&v).is_none());
        let v2 = serde_json::json!({"useCases": {"id": 1}});
        assert!(pick_use_cases_array(&v2).is_none());
    }

    #[test]
    fn pick_mut_resolves_snake_case() {
        let mut v = serde_json::json!({
            "use_cases": [{"id": "a", "enabled": true}]
        });
        let arr = pick_use_cases_array_mut(&mut v).unwrap();
        arr[0]["enabled"] = serde_json::json!(false);
        assert_eq!(v["use_cases"][0]["enabled"], serde_json::json!(false));
    }

    #[test]
    fn pick_mut_resolves_camel_case() {
        let mut v = serde_json::json!({
            "useCases": [{"id": "a", "enabled": true}]
        });
        let arr = pick_use_cases_array_mut(&mut v).unwrap();
        arr[0]["enabled"] = serde_json::json!(false);
        assert_eq!(v["useCases"][0]["enabled"], serde_json::json!(false));
    }

    #[test]
    fn pick_mut_returns_none_when_neither_key_present() {
        let mut v = serde_json::json!({"summary": "x"});
        assert!(pick_use_cases_array_mut(&mut v).is_none());
    }
}
