//! Prompt block renderer for the discovered CLI session.
//!
//! Takes a discovered `ActiveSession` plus the extracted turns and
//! produces the markdown block that gets prepended to the persona's
//! system prompt — sibling to the ambient block from Phase 3 c.
//!
//! Two distinct prefix blocks are intentional (per the Phase 5 v1
//! design refinement). Ambient context (clipboard / app_focus) and
//! Claude CLI session context are semantically different categories
//! and the persona benefits from the model seeing them as such.

use std::time::SystemTime;

use super::discovery::ActiveSession;
use super::transcript::TranscriptTurn;

/// Render the CLI session prompt block, or None if no turns.
///
/// Output shape (mirrors the Phase 3 c ambient block's tone):
///
/// ```text
/// ## Active Claude CLI Session
///
/// **Project**: <project_dir_name>
/// **Last activity**: 30s ago
///
/// **Recent turns** (chronological):
/// - [user]: <text>
/// - [assistant]: <text>
/// - [user]: <text>
/// ```
///
/// `now` is injectable so tests don't depend on real wall-clock time
/// when computing the "Nm ago" qualifier from `active.mtime`.
pub fn render_cli_session_for_prompt(
    active: &ActiveSession,
    turns: &[TranscriptTurn],
    now: SystemTime,
) -> Option<String> {
    if turns.is_empty() {
        return None;
    }

    let mut doc = String::with_capacity(512);
    doc.push_str("## Active Claude CLI Session\n");
    doc.push_str(
        "The user has an interactive Claude CLI conversation in flight. \
         Use these recent turns as context for what they're working on.\n\n",
    );

    doc.push_str(&format!("**Project**: {}\n", active.project_dir_name));
    doc.push_str(&format!(
        "**Last activity**: {}\n\n",
        format_age(now, active.mtime)
    ));

    // Chronological order — LLMs follow conversation arcs better
    // top-down. Caller is responsible for delivering turns in
    // chronological order (oldest first within the slice); the
    // transcript reader does this by default.
    doc.push_str("**Recent turns** (chronological):\n");
    for turn in turns {
        doc.push_str(&format!("- [{}]: {}\n", turn.role, turn.text));
    }

    Some(doc)
}

/// Render `now − mtime` as a human-friendly age. Mirrors the
/// ambient block's age formatter for consistency.
fn format_age(now: SystemTime, mtime: SystemTime) -> String {
    let secs = now
        .duration_since(mtime)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if secs < 60 {
        format!("{secs}s ago")
    } else if secs < 3600 {
        format!("{}m ago", secs / 60)
    } else {
        format!("{}h ago", secs / 3600)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::Duration;

    fn fake_session(name: &str, age_secs: u64, now: SystemTime) -> ActiveSession {
        ActiveSession {
            path: PathBuf::from(format!("/tmp/{name}.jsonl")),
            project_dir_name: name.to_string(),
            mtime: now - Duration::from_secs(age_secs),
        }
    }

    #[test]
    fn returns_none_on_empty_turns() {
        let now = SystemTime::now();
        let active = fake_session("p", 30, now);
        assert!(render_cli_session_for_prompt(&active, &[], now).is_none());
    }

    #[test]
    fn renders_header_and_metadata() {
        let now = SystemTime::now();
        let active = fake_session("my-project", 90, now);
        let turns = vec![TranscriptTurn {
            role: "user".into(),
            text: "hello".into(),
        }];

        let doc = render_cli_session_for_prompt(&active, &turns, now).unwrap();
        assert!(doc.starts_with("## Active Claude CLI Session"));
        assert!(doc.contains("**Project**: my-project"));
        assert!(doc.contains("**Last activity**: 1m ago"));
        assert!(doc.contains("- [user]: hello"));
    }

    #[test]
    fn preserves_chronological_order() {
        let now = SystemTime::now();
        let active = fake_session("p", 5, now);
        let turns = vec![
            TranscriptTurn { role: "user".into(), text: "first".into() },
            TranscriptTurn { role: "assistant".into(), text: "second".into() },
            TranscriptTurn { role: "user".into(), text: "third".into() },
        ];
        let doc = render_cli_session_for_prompt(&active, &turns, now).unwrap();
        // First turn in the input must appear before the second, etc.
        let idx_first = doc.find("first").expect("first present");
        let idx_second = doc.find("second").expect("second present");
        let idx_third = doc.find("third").expect("third present");
        assert!(idx_first < idx_second);
        assert!(idx_second < idx_third);
    }

    #[test]
    fn age_formatter_buckets_seconds_minutes_hours() {
        let now = SystemTime::now();
        let s = render_cli_session_for_prompt(
            &fake_session("p", 30, now),
            &[TranscriptTurn { role: "user".into(), text: "x".into() }],
            now,
        )
        .unwrap();
        assert!(s.contains("30s ago"));

        let m = render_cli_session_for_prompt(
            &fake_session("p", 4 * 60 + 12, now),
            &[TranscriptTurn { role: "user".into(), text: "x".into() }],
            now,
        )
        .unwrap();
        assert!(m.contains("4m ago"));

        let h = render_cli_session_for_prompt(
            &fake_session("p", 2 * 3600 + 30 * 60, now),
            &[TranscriptTurn { role: "user".into(), text: "x".into() }],
            now,
        )
        .unwrap();
        assert!(h.contains("2h ago"));
    }
}
