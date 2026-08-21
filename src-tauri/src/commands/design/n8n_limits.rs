//! Centralized payload-size limits for the n8n workflow → persona pipeline.
//!
//! Two distinct limits exist intentionally — they guard different stages of
//! the pipeline and live alongside each other on purpose:
//!
//! - [`MAX_WORKFLOW_JSON_BYTES`] (5 MB) bounds a **single** raw workflow JSON
//!   accepted by [`create_n8n_session`]. Realistic n8n exports are typically
//!   under 200 KB; anything past 5 MB is almost always minified output dumped
//!   from another tool, not an actionable workflow.
//!
//! - [`MAX_TRANSFORM_PAYLOAD_BYTES`] (10 MB) bounds the **combined** payload
//!   sent to [`start_n8n_transform_background`], which concatenates the
//!   workflow JSON, the parser-result JSON, the optional adjustment request,
//!   and the optional previous draft. A 5 MB workflow plus a similarly sized
//!   parser_result alone consumes the 5 MB session cap twice over, so the
//!   transform cap must be ≥ 2× the session cap with headroom for adjustment
//!   text and prior drafts. 10 MB also keeps the resulting Claude CLI prompt
//!   under reasonable bounds.
//!
//! These constants are exported to TypeScript via the [`N8nPayloadLimits`]
//! struct (ts-rs) and the `scripts/generate-n8n-limits.mjs` codegen, which
//! emits `src/lib/n8nLimits.generated.ts`. CI verifies the generated file is
//! up to date so the limits cannot drift between Rust and the frontend.
//!
//! [`create_n8n_session`]: super::n8n_sessions::create_n8n_session
//! [`start_n8n_transform_background`]: super::n8n_transform::cli_runner::start_n8n_transform_background

use serde::Serialize;
use ts_rs::TS;

/// Maximum size (bytes) of a single raw workflow JSON accepted by
/// `create_n8n_session`. See module docs for rationale.
pub const MAX_WORKFLOW_JSON_BYTES: usize = 5 * 1024 * 1024;

/// Maximum size (bytes) of the **combined** payload (workflow + parser
/// result + adjustment + previous draft) accepted by
/// `start_n8n_transform_background`. See module docs for rationale.
pub const MAX_TRANSFORM_PAYLOAD_BYTES: usize = 10 * 1024 * 1024;

// NOTE (deliberately a `//` comment, not a doc comment: ts-rs copies doc
// comments into `src/lib/bindings/N8nPayloadLimits.ts`, and this note is
// about the Rust side only).
//
// NOTHING CONSTRUCTS `N8nPayloadLimits` AT RUNTIME ANY MORE. Its only runtime
// consumer was the `get_n8n_payload_limits` IPC command, removed in `4bf1845d7`
// along with 71 other unreachable commands. What still depends on the type is
// purely compile-time and one hop wide: ts-rs emits
// `src/lib/bindings/N8nPayloadLimits.ts`, which the generated
// `n8nLimits.generated.ts` imports solely to annotate its `N8N_PAYLOAD_LIMITS`
// const — a const that no `.ts`/`.tsx` file imports. knip cannot see that,
// because `n8nLimits.generated.ts` sits in its `ignore` list.
//
// The two `pub const`s above are the live half and must stay: Rust reads them
// at `n8n_sessions.rs:94` and `n8n_transform/cli_runner.rs:57`, and the
// generated TS re-exports `MAX_WORKFLOW_JSON_BYTES` to two frontend modules.
//
// Deleting the struct is a frontend-coupled change (binding + generator
// template + `bindings/index.ts`), so it is annotated here and raised as a
// recommendation rather than taken unilaterally.
/// Wire-format struct mirroring the n8n payload-size limits, exported to
/// TypeScript via ts-rs. The numeric values themselves are emitted to
/// `src/lib/n8nLimits.generated.ts` by `scripts/generate-n8n-limits.mjs`.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct N8nPayloadLimits {
    #[ts(type = "number")]
    pub max_workflow_json_bytes: u64,
    #[ts(type = "number")]
    pub max_transform_payload_bytes: u64,
}

impl N8nPayloadLimits {
    /// Only caller is `current_matches_consts` below; see the struct docs.
    #[allow(dead_code)]
    pub const fn current() -> Self {
        Self {
            max_workflow_json_bytes: MAX_WORKFLOW_JSON_BYTES as u64,
            max_transform_payload_bytes: MAX_TRANSFORM_PAYLOAD_BYTES as u64,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transform_cap_must_exceed_workflow_cap() {
        // The combined transform payload concatenates the workflow JSON with
        // the parser result, an optional adjustment request, and an optional
        // previous draft. If the transform cap ever drops to or below the
        // session cap, a legitimate workflow at the session limit cannot be
        // transformed. Keep at least 2× headroom.
        assert!(
            MAX_TRANSFORM_PAYLOAD_BYTES >= MAX_WORKFLOW_JSON_BYTES * 2,
            "transform payload cap must be at least 2x the session workflow cap"
        );
    }

    #[test]
    fn current_matches_consts() {
        let limits = N8nPayloadLimits::current();
        assert_eq!(
            limits.max_workflow_json_bytes as usize,
            MAX_WORKFLOW_JSON_BYTES
        );
        assert_eq!(
            limits.max_transform_payload_bytes as usize,
            MAX_TRANSFORM_PAYLOAD_BYTES
        );
    }
}
