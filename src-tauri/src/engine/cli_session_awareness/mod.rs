//! Phase 5 v1: Claude CLI session-resume awareness.
//!
//! Lets a persona execution be **read-aware** of the user's currently-
//! active interactive Claude CLI session. When the user is mid-
//! conversation in `claude` and a persona fires (via trigger,
//! schedule, daemon), the persona can see the recent turns of that
//! interactive session as additional prompt context — without
//! attaching to or writing into the user's transcript.
//!
//! This is read-only awareness, not resume-attachment. The user's
//! interactive session id is never used as a `--resume` target by
//! persona executions; engine continues to manage its own per-
//! persona session_id pool (see `engine::session_pool`).
//!
//! # Privacy posture
//!
//! Two gates, both required:
//! 1. **Per-persona** `cli_awareness_enabled` (default false) — the
//!    persona must explicitly opt in via the editor UI.
//! 2. **Global master toggle** (default false) — the user must allow
//!    CLI session reads app-wide via the desktop-awareness card.
//!
//! Plus a freshness cutoff (10 min default): sessions inactive for
//! longer than the cutoff are treated as not-active. A 3am daemon
//! tick won't see yesterday afternoon's debugging session.
//!
//! Extracted content is NOT redacted. Rationale: explicit consent
//! is the gate. Redaction would corrupt code/snippets the user
//! wants the persona to see (tutorial pastes, example tokens, etc.)
//! that are legitimate context. If a persona shouldn't see a given
//! conversation, the right gate is the per-persona toggle.
//!
//! # Modules
//!
//! - `discovery` — locate the most-recently-active jsonl transcript
//! - `transcript` — tolerant JSONL parser (step 2)
//! - `render` — prompt-block renderer (step 3)

pub mod discovery;
pub mod render;
pub mod transcript;
