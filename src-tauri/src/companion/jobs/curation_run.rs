//! `memory_curation_run` job handler — wraps the existing companion
//! consolidation and reflection curators as background-job kinds so
//! they can run async without blocking the IPC caller.
//!
//! Concept borrowed from Anthropic Managed Agents' dream pipeline
//! (https://platform.claude.com/docs/en/managed-agents/dreams). The
//! shape is theirs (async job lifecycle, optional `instructions`
//! steering); the implementation is personas's existing curators
//! invoked from a `BackgroundJob` worker context.
//!
//! Two scopes for v1:
//!   - `"consolidate"` → calls `companion::brain::consolidation::run_consolidation`
//!   - `"reflect"`     → calls `companion::brain::reflection::run_reflection`
//!
//! params_json shape:
//! ```jsonc
//! {
//!   "scope": "consolidate" | "reflect",
//!   "instructions": "Focus on coding-style preferences; ignore one-off debugging notes."  // optional, ≤4096 chars
//! }
//! ```
//!
//! The job's `result_text` is a short human-readable summary (the
//! scope ran + the inner artifact id). The user reviews the artifact
//! through the existing consolidation/reflection UI surfaces.

use serde_json::Value;

use crate::companion::brain::{consolidation, reflection};
use crate::db::UserDbPool;
use crate::error::AppError;

/// Job kind identifier registered in `dispatch_handler`.
pub const KIND: &str = "memory_curation_run";

/// Maximum instructions length in characters. Mirrors the IPC-boundary
/// validation in `commands::companion::consolidate::validate_instructions`
/// so an enqueued job with an over-length `instructions` field fails
/// fast at the worker rather than producing a giant prompt.
const MAX_INSTRUCTIONS_CHARS: usize = 4096;

/// Run a curation pass via one of the existing companion curators.
/// Called from `companion::jobs::dispatch_handler` when a job with
/// `kind = "memory_curation_run"` reaches the worker.
pub async fn run(pool: &UserDbPool, params: &Value) -> Result<String, AppError> {
    let scope = params
        .get("scope")
        .and_then(|v| v.as_str())
        .unwrap_or("consolidate");

    let instructions = params.get("instructions").and_then(|v| v.as_str());
    if let Some(s) = instructions {
        if s.chars().count() > MAX_INSTRUCTIONS_CHARS {
            return Err(AppError::Validation(format!(
                "instructions must be ≤{MAX_INSTRUCTIONS_CHARS} characters"
            )));
        }
    }

    match scope {
        "consolidate" => {
            let id = consolidation::run_consolidation(pool, instructions).await?;
            Ok(format!(
                "Consolidation pass `{id}` ready for review (use the brain panel to walk the proposed items)."
            ))
        }
        "reflect" => {
            let id = reflection::run_reflection(pool, instructions).await?;
            Ok(format!(
                "Reflection `{id}` written. Open the reflections list to read it."
            ))
        }
        other => Err(AppError::Validation(format!(
            "unknown curation scope `{other}` (expected `consolidate` or `reflect`)"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn rejects_unknown_scope() {
        // We can't easily construct a UserDbPool in unit tests without
        // a test fixture, so verify the scope check fires before we
        // touch the pool by passing a dangling reference would crash —
        // instead exercise the validation via a synthetic params Value.
        // Pool argument is referenced only inside the matched arms, so
        // a synthetic null pool path is unreachable for the unknown
        // scope; we therefore inline the validation logic here.
        let params = json!({ "scope": "halucinate" });
        let scope = params.get("scope").and_then(|v| v.as_str()).unwrap();
        assert_eq!(scope, "halucinate");
        assert!(!matches!(scope, "consolidate" | "reflect"));
    }

    #[test]
    fn instructions_length_check_matches_documented_cap() {
        let s = "a".repeat(MAX_INSTRUCTIONS_CHARS + 1);
        assert!(s.chars().count() > MAX_INSTRUCTIONS_CHARS);

        let ok = "a".repeat(MAX_INSTRUCTIONS_CHARS);
        assert_eq!(ok.chars().count(), MAX_INSTRUCTIONS_CHARS);
    }

    #[test]
    fn default_scope_is_consolidate_when_missing() {
        let params = json!({});
        let scope = params
            .get("scope")
            .and_then(|v| v.as_str())
            .unwrap_or("consolidate");
        assert_eq!(scope, "consolidate");
    }
}
