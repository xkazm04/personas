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

/// Wire-format struct mirroring the n8n payload-size limits, exported to
/// TypeScript via ts-rs. The numeric values themselves are emitted to
/// `src/lib/n8nLimits.generated.ts` by `scripts/generate-n8n-limits.mjs`.
#[derive(Debug, Clone, Copy, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct N8nPayloadLimits {
    pub max_workflow_json_bytes: u64,
    pub max_transform_payload_bytes: u64,
}

impl N8nPayloadLimits {
    pub const fn current() -> Self {
        Self {
            max_workflow_json_bytes: MAX_WORKFLOW_JSON_BYTES as u64,
            max_transform_payload_bytes: MAX_TRANSFORM_PAYLOAD_BYTES as u64,
        }
    }
}

/// Tauri command exposing the canonical limits to the frontend at runtime.
/// Static-import callers should prefer `src/lib/n8nLimits.generated.ts`;
/// this command exists for tests, diagnostics, and future dynamic surfaces.
#[tauri::command]
pub fn get_n8n_payload_limits() -> N8nPayloadLimits {
    N8nPayloadLimits::current()
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
