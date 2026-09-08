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
/// Find one use case by id in a raw `design_context` JSON string. Read-side
/// helper for the focused-charter policy bridge (WP2): a charter minted from
/// a legacy use case (`spec.migratedFromUseCaseId`) still bridges its
/// review-policy / generation-settings prompt lines from the design-context
/// object, because those fields have no charter home. `None` on absent /
/// unparseable context or an unknown id.
pub fn find_use_case_by_id(design_context: Option<&str>, uc_id: &str) -> Option<Value> {
    let dc: Value = serde_json::from_str(design_context?).ok()?;
    pick_use_cases_array(&dc)?
        .iter()
        .find(|uc| uc.get("id").and_then(|v| v.as_str()) == Some(uc_id))
        .cloned()
}

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

// ── The project pins ───────────────────────────────────────────────────────
//
// Two keys, read as one question. `devProjectId` is the CODEBASE pin: it is
// what the `codebase` connector resolves and what `app_master_of_project` keys
// project ownership on, so writing it makes a persona that project's App
// Master. `homeProjectId` is the workspace-bound persona's writing surface —
// where its documents go and which project its project-shaped verbs default to
// — and it claims no ownership at all.
//
// Every reader that wants "the project this persona works in" wants
// [`working_project_id`], which prefers the codebase pin. Readers that
// genuinely mean ownership keep reading `devProjectId` alone.
//
// Read off the RAW JSON rather than through `DesignContextData`: the strict
// struct parse fails whole on one unexpected shape, and these call sites are
// on paths (a protocol verb, an execution's working directory) where losing a
// pin to a neighbouring field's drift would be silent.

/// Read one string key out of a raw `design_context` JSON string.
fn pin(design_context: Option<&str>, key: &str) -> Option<String> {
    let dc: Value = serde_json::from_str(design_context?).ok()?;
    dc.get(key)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// The `dev_projects.id` this persona is pinned to as a CODEBASE
/// (`design_context.devProjectId`). Ownership-bearing.
pub fn pinned_project_id(design_context: Option<&str>) -> Option<String> {
    pin(design_context, "devProjectId")
}

/// The `dev_projects.id` a workspace-bound persona calls home
/// (`design_context.homeProjectId`). Carries no ownership.
pub fn home_project_id(design_context: Option<&str>) -> Option<String> {
    pin(design_context, "homeProjectId")
}

/// The project this persona works in: its codebase pin, or its home when it
/// has no codebase of its own. `None` for a persona bound to neither.
pub fn working_project_id(design_context: Option<&str>) -> Option<String> {
    pinned_project_id(design_context).or_else(|| home_project_id(design_context))
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

    #[test]
    fn the_codebase_pin_wins_over_the_home_pin() {
        let dc = serde_json::json!({"devProjectId": "p1", "homeProjectId": "p2"}).to_string();
        assert_eq!(pinned_project_id(Some(&dc)).as_deref(), Some("p1"));
        assert_eq!(home_project_id(Some(&dc)).as_deref(), Some("p2"));
        assert_eq!(working_project_id(Some(&dc)).as_deref(), Some("p1"));
    }

    #[test]
    fn a_workspace_persona_works_in_its_home_project() {
        let dc = serde_json::json!({"workspaceId": "w1", "homeProjectId": "p2"}).to_string();
        assert_eq!(pinned_project_id(Some(&dc)), None);
        assert_eq!(working_project_id(Some(&dc)).as_deref(), Some("p2"));
    }

    #[test]
    fn a_persona_bound_to_neither_reads_as_none() {
        assert_eq!(working_project_id(None), None);
        assert_eq!(working_project_id(Some("not json")), None);
        assert_eq!(working_project_id(Some("{}")), None);
        // A blank pin is not a pin — an empty string would resolve to no
        // project anyway, one lookup later and with a worse error.
        let blank = serde_json::json!({"homeProjectId": "   "}).to_string();
        assert_eq!(working_project_id(Some(&blank)), None);
    }
}
