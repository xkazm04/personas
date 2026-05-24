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

#[cfg(test)]
mod integration_tests {
    //! End-to-end exercise of the CLI session awareness pipeline.
    //!
    //! Synthesizes a Claude Code-shaped JSONL transcript under a
    //! per-test scratch home, runs the full discovery → read →
    //! render → prepend pipeline, and asserts the persona's system
    //! prompt is augmented as expected.
    //!
    //! The unit tests in each submodule cover their own contracts
    //! in isolation; this module tests the *composition* — the
    //! contract that future readers care about. A regression in
    //! the boundary between any two stages will surface here even
    //! if the per-stage tests still pass.

    use super::discovery::{discover_active_session, DEFAULT_FRESHNESS_CUTOFF};
    use super::render::render_cli_session_for_prompt;
    use super::transcript::read_recent_turns;
    use crate::engine::ambient_context::prepend_ambient_to_system_prompt;
    use std::fs::File;
    use std::io::Write;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::SystemTime;

    fn scratch_home() -> PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        let pid = std::process::id();
        let mut p = std::env::temp_dir();
        p.push(format!("personas_cli_e2e_test_{pid}_{id}"));
        std::fs::create_dir_all(&p).expect("create scratch home");
        p
    }

    fn write_session(home: &std::path::Path, project: &str, name: &str, content: &str) -> PathBuf {
        let dir = home.join(".claude").join("projects").join(project);
        std::fs::create_dir_all(&dir).expect("project dir");
        let path = dir.join(name);
        let mut f = File::create(&path).expect("create jsonl");
        f.write_all(content.as_bytes()).expect("write");
        path
    }

    fn make_persona(system_prompt: &str) -> crate::db::models::Persona {
        crate::db::models::Persona {
            id: "p_e2e".into(),
            project_id: "proj_e2e".into(),
            name: "CLI E2E".into(),
            description: None,
            system_prompt: system_prompt.to_string(),
            structured_prompt: None,
            icon: None,
            color: None,
            enabled: true,
            sensitive: false,
            headless: false,
            max_concurrent: 1,
            timeout_ms: 60_000,
            notification_channels: None,
            last_design_result: None,
            last_test_report: None,
            model_profile: None,
            max_budget_usd: None,
            max_turns: None,
            design_context: None,
            group_id: None,
            source_review_id: None,
            trust_level: crate::db::models::PersonaTrustLevel::Verified,
            trust_origin: crate::db::models::PersonaTrustOrigin::default(),
            trust_verified_at: None,
            trust_score: 1.0,
            parameters: None,
            gateway_exposure: Default::default(),
            template_category: None,
            cli_awareness_enabled: true,
            langfuse_export_enabled: true,
            setup_status: "ready".to_string(),
            setup_detail: None,
            disabled_dims_json: None,
            created_at: "2026-05-09T00:00:00Z".into(),
            updated_at: "2026-05-09T00:00:00Z".into(),
        }
    }

    /// Full pipeline: a real-shape JSONL → discovered → parsed →
    /// rendered → prepended → asserted on the persona's prompt.
    ///
    /// This is the regression target for Phase 5 v1's contract.
    /// Anything that breaks the boundary between any two stages
    /// (e.g. discovery returning a path the reader can't open, or
    /// the renderer producing markdown the prepend helper rejects)
    /// surfaces here.
    #[test]
    fn full_pipeline_renders_cli_session_into_persona_prompt() {
        let home = scratch_home();
        // User message + assistant message with mixed block types
        // (matches the real Claude Code 2.x format observed in
        // ~/.claude/projects/*).
        let jsonl = r#"{"type":"queue-operation","content":"setup"}
{"type":"user","message":{"role":"user","content":"How do I add a column in SQLite?"}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":"recall ALTER TABLE syntax"},{"type":"text","text":"Use ALTER TABLE <name> ADD COLUMN <col> <type>;"}]}}
{"type":"user","message":{"role":"user","content":"Thanks!"}}
"#;
        let path = write_session(&home, "proj-e2e", "session.jsonl", jsonl);

        // Bump the file's mtime to "right now" so discovery's
        // freshness gate accepts it. (write_session is fast enough
        // that the file's natural mtime is already within the
        // 10-min window, but we set it explicitly for determinism.)
        let now = SystemTime::now();
        let f = std::fs::OpenOptions::new()
            .write(true)
            .open(&path)
            .expect("open for set_modified");
        f.set_modified(now).expect("set_modified");

        let active = discover_active_session(&home, now, DEFAULT_FRESHNESS_CUTOFF)
            .expect("active session must be found");
        assert_eq!(active.project_dir_name, "proj-e2e");
        assert_eq!(active.path, path);

        let turns = read_recent_turns(&active.path, 8);
        assert_eq!(turns.len(), 3, "user + assistant + user");
        assert_eq!(turns[0].role, "user");
        assert_eq!(turns[0].text, "How do I add a column in SQLite?");
        assert_eq!(turns[1].role, "assistant");
        assert!(turns[1].text.contains("ALTER TABLE"));
        assert!(
            !turns[1].text.contains("recall ALTER TABLE"),
            "thinking blocks must be filtered"
        );
        assert_eq!(turns[2].role, "user");
        assert_eq!(turns[2].text, "Thanks!");

        let md = render_cli_session_for_prompt(&active, &turns, now)
            .expect("non-empty turns must render");
        assert!(md.starts_with("## Active Claude CLI Session"));
        assert!(md.contains("**Project**: proj-e2e"));
        assert!(md.contains("- [user]: How do I add a column"));
        assert!(md.contains("- [assistant]: Use ALTER TABLE"));
        assert!(md.contains("- [user]: Thanks!"));

        let mut persona = make_persona("You are a SQL teacher.");
        prepend_ambient_to_system_prompt(&mut persona, &md);
        assert!(persona.system_prompt.starts_with("## Active Claude CLI Session"));
        assert!(persona.system_prompt.ends_with("You are a SQL teacher."));
        assert!(
            persona.system_prompt.contains("\n\nYou are a SQL teacher."),
            "CLI block must be separated from existing prompt by a blank line"
        );
    }

    /// Empty home → discovery None → no-op pipeline.
    /// Ensures the "first run, never used Claude CLI" path doesn't
    /// crash or leak partial state.
    #[test]
    fn empty_home_yields_no_injection() {
        let home = scratch_home();
        let now = SystemTime::now();
        let active = discover_active_session(&home, now, DEFAULT_FRESHNESS_CUTOFF);
        assert!(active.is_none());
        // No further pipeline calls; the runner's `if let Some(...)`
        // guard ensures discovery=None short-circuits the rest.
    }

    /// Stale session → discovery None.
    /// Regression guard for the "10-min cutoff" contract.
    #[test]
    fn stale_session_does_not_render() {
        let home = scratch_home();
        let path = write_session(
            &home,
            "proj-stale",
            "old.jsonl",
            r#"{"type":"user","message":{"role":"user","content":"hi"}}
"#,
        );
        let now = SystemTime::now();
        let stale = now - std::time::Duration::from_secs(60 * 60 * 24);
        let f = std::fs::OpenOptions::new()
            .write(true)
            .open(&path)
            .expect("open for set_modified");
        f.set_modified(stale).expect("set_modified");

        let active = discover_active_session(&home, now, DEFAULT_FRESHNESS_CUTOFF);
        assert!(
            active.is_none(),
            "freshness cutoff must filter day-old transcripts"
        );
    }
}
