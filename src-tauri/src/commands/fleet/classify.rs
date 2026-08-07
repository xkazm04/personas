//! Parked-state classifier — telling DONE from BLOCKED from HUNG.
//!
//! "Stale" was one amber bucket holding three completely different
//! situations: a session that finished its task, a session waiting on a
//! question or a permission prompt, and a session genuinely wedged mid-tool.
//! The distinction existed only inside free-text `state_reason` strings, which
//! the frontend then string-matched. Nothing ever read the transcript, so the
//! one place that actually knows what a session was doing when it stopped was
//! never consulted.
//!
//! This module reads the transcript tail and returns a TYPED verdict. The
//! ticker maps each verdict onto the existing lifecycle: Done → `mark_finished`
//! (the same path the `FLEET:DONE` mechanical cue uses), Blocked →
//! `AwaitingInput` with a typed reason, Hung → `Stale` with the existing frozen
//! reasons. No new state machine — a new *reading* of the same one.

use serde_json::Value;

/// Why a session is blocked on the operator.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlockedKind {
    /// The model asked the operator a question and is waiting on the answer.
    Question,
    /// A tool needs permission (or a login / usage limit is in the way).
    Permission,
}

/// Why a session looks wedged.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HungKind {
    /// A tool call was issued and never returned a result, and nothing has
    /// grown since.
    MidTool,
}

/// The typed read of a parked session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParkedVerdict {
    /// The task is complete. `summary` is the trailing assistant text,
    /// clipped — it becomes the finished-state reason.
    Done { summary: String },
    Blocked(BlockedKind),
    Hung(HungKind),
    /// Not enough evidence. The caller keeps whatever the time-based rules
    /// decided — a classifier that guesses is worse than one that abstains.
    Unknown,
}

/// The machine-readable kind that rides on the session DTO, so the UI can
/// paint DONE / BLOCKED / HUNG distinctly instead of string-matching prose.
pub fn verdict_token(v: &ParkedVerdict) -> Option<&'static str> {
    match v {
        ParkedVerdict::Done { .. } => Some("done"),
        ParkedVerdict::Blocked(BlockedKind::Question) => Some("blocked_question"),
        ParkedVerdict::Blocked(BlockedKind::Permission) => Some("blocked_permission"),
        ParkedVerdict::Hung(HungKind::MidTool) => Some("hung_mid_tool"),
        ParkedVerdict::Unknown => None,
    }
}

/// Longest summary carried out of a Done verdict.
const SUMMARY_MAX: usize = 200;

/// Tool names that mean "the model is asking the operator something".
const QUESTION_TOOLS: &[&str] = &["askuserquestion", "exitplanmode"];

/// Screen text that means a prompt is on the terminal waiting for a keypress.
/// Deliberately narrow — these are the phrases the CLI actually renders.
const PERMISSION_CUES: &[&str] = &[
    "do you want to proceed",
    "do you want to allow",
    "yes, and don't ask again",
    "no, and tell claude what to do differently",
    "allow this tool",
    "trust the files in this folder",
    "press enter to continue",
];

/// Screen text that means the session cannot proceed without the operator
/// dealing with an account/session problem.
const LOGIN_CUES: &[&str] = &["/login", "please run /login", "invalid api key", "sign in to"];

/// Classify a parked session from its transcript tail plus what is on screen.
///
/// `tail` is the output of `transcript_read::tail_lines`. `screen` is the
/// rendered terminal grid. `grew_recently` is the ticker's own transcript-growth
/// signal — a session whose log is still growing is never called hung, whatever
/// the tail looks like.
pub fn classify_parked(tail: &[String], screen: Option<&str>, grew_recently: bool) -> ParkedVerdict {
    // Screen cues win when present: a permission prompt on the terminal is
    // ground truth about what the session needs, and it is the case a
    // transcript cannot show (the tool call is issued but parked in the CLI).
    if let Some(screen) = screen {
        let lower = screen.to_lowercase();
        if PERMISSION_CUES.iter().any(|c| lower.contains(c))
            || LOGIN_CUES.iter().any(|c| lower.contains(c))
        {
            return ParkedVerdict::Blocked(BlockedKind::Permission);
        }
    }

    let records: Vec<Value> = tail
        .iter()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .collect();
    if records.is_empty() {
        return ParkedVerdict::Unknown;
    }

    // Walk the tail once, tracking the trailing assistant text and whether any
    // tool call is still outstanding.
    let mut last_assistant_text: Option<String> = None;
    let mut open_tool: Option<String> = None;
    let mut open_tool_name: Option<String> = None;
    let mut saw_stop_hook = false;

    for rec in &records {
        let kind = rec.get("type").and_then(Value::as_str).unwrap_or("");
        if is_stop_hook(rec) {
            saw_stop_hook = true;
        }
        match kind {
            "assistant" => {
                let blocks = content_blocks(rec);
                let mut text = String::new();
                for block in &blocks {
                    match block.get("type").and_then(Value::as_str) {
                        Some("text") => {
                            if let Some(t) = block.get("text").and_then(Value::as_str) {
                                text.push_str(t);
                            }
                        }
                        Some("tool_use") => {
                            let name = block
                                .get("name")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_ascii_lowercase();
                            if QUESTION_TOOLS.contains(&name.as_str()) {
                                return ParkedVerdict::Blocked(BlockedKind::Question);
                            }
                            open_tool = block
                                .get("id")
                                .and_then(Value::as_str)
                                .map(str::to_string)
                                .or(Some(String::new()));
                            open_tool_name = Some(name);
                        }
                        _ => {}
                    }
                }
                let text = text.trim();
                if !text.is_empty() {
                    last_assistant_text = Some(text.to_string());
                }
            }
            "user" => {
                // A tool_result closes the outstanding call. Any real user
                // message also means the session is past whatever it was on.
                for block in content_blocks(rec) {
                    if block.get("type").and_then(Value::as_str) == Some("tool_result") {
                        open_tool = None;
                        open_tool_name = None;
                    }
                }
                if content_blocks(rec).is_empty() {
                    open_tool = None;
                    open_tool_name = None;
                }
            }
            _ => {}
        }
    }

    // An unresolved tool call with a flat log is the wedge case.
    if open_tool.is_some() && !grew_recently {
        let _ = open_tool_name;
        return ParkedVerdict::Hung(HungKind::MidTool);
    }

    // Trailing assistant prose with nothing outstanding is a finished turn.
    // The Stop hook, when the tail carries one, is the stronger form of the
    // same signal.
    if open_tool.is_none() {
        if let Some(text) = last_assistant_text {
            if saw_stop_hook || !grew_recently {
                return ParkedVerdict::Done {
                    summary: clip(&text),
                };
            }
        }
    }

    ParkedVerdict::Unknown
}

/// `message.content` as a block list. Handles the string-content shape too
/// (older records serialize plain text as a bare string), which yields no
/// blocks — correct, since a bare string carries no tool calls.
fn content_blocks(rec: &Value) -> Vec<&Value> {
    rec.get("message")
        .and_then(|m| m.get("content"))
        .and_then(Value::as_array)
        .map(|a| a.iter().collect())
        .unwrap_or_default()
}

/// Does this record look like a Stop-hook execution? The CLI writes hook
/// activity as a system record naming the hook event.
fn is_stop_hook(rec: &Value) -> bool {
    if rec.get("type").and_then(Value::as_str) != Some("system") {
        return false;
    }
    let haystack = [
        rec.get("subtype").and_then(Value::as_str).unwrap_or(""),
        rec.get("hook_event_name").and_then(Value::as_str).unwrap_or(""),
        rec.get("content").and_then(Value::as_str).unwrap_or(""),
    ]
    .join(" ")
    .to_ascii_lowercase();
    haystack.contains("stop")
}

fn clip(text: &str) -> String {
    let one_line = text.split('\n').find(|l| !l.trim().is_empty()).unwrap_or(text);
    let mut out: String = one_line.trim().chars().take(SUMMARY_MAX).collect();
    if one_line.trim().chars().count() > SUMMARY_MAX {
        out.push('…');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn trailing_assistant_text_on_a_flat_log_is_done() {
        let tail = lines(&[
            r#"{"type":"user","message":{"content":[{"type":"tool_result","content":"ok"}]}}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Fixed the flaky test and pushed.\nDetails below."}]}}"#,
        ]);
        assert_eq!(
            classify_parked(&tail, None, false),
            ParkedVerdict::Done {
                summary: "Fixed the flaky test and pushed.".into()
            }
        );
    }

    #[test]
    fn a_question_tool_is_blocked_not_stale() {
        let tail = lines(&[
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"AskUserQuestion","input":{}}]}}"#,
        ]);
        assert_eq!(
            classify_parked(&tail, None, false),
            ParkedVerdict::Blocked(BlockedKind::Question)
        );
    }

    #[test]
    fn a_permission_prompt_on_screen_wins_over_the_transcript() {
        let tail = lines(&[
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"All done."}]}}"#,
        ]);
        assert_eq!(
            classify_parked(&tail, Some("  Do you want to proceed?\n  1. Yes"), false),
            ParkedVerdict::Blocked(BlockedKind::Permission)
        );
        assert_eq!(
            classify_parked(&tail, Some("Please run /login to continue"), false),
            ParkedVerdict::Blocked(BlockedKind::Permission)
        );
    }

    #[test]
    fn an_unresolved_tool_call_on_a_flat_log_is_hung() {
        let tail = lines(&[
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t9","name":"Bash","input":{}}]}}"#,
        ]);
        assert_eq!(
            classify_parked(&tail, None, false),
            ParkedVerdict::Hung(HungKind::MidTool)
        );
        // …but a log that is still growing is never called hung.
        assert_eq!(classify_parked(&tail, None, true), ParkedVerdict::Unknown);
    }

    #[test]
    fn a_resolved_tool_call_does_not_read_as_hung() {
        let tail = lines(&[
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t9","name":"Bash","input":{}}]}}"#,
            r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t9","content":"done"}]}}"#,
        ]);
        assert_eq!(classify_parked(&tail, None, false), ParkedVerdict::Unknown);
    }

    #[test]
    fn a_stop_hook_makes_done_confident_even_while_growing() {
        let tail = lines(&[
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Shipped."}]}}"#,
            r#"{"type":"system","subtype":"hook","hook_event_name":"Stop"}"#,
        ]);
        assert_eq!(
            classify_parked(&tail, None, true),
            ParkedVerdict::Done {
                summary: "Shipped.".into()
            }
        );
    }

    #[test]
    fn no_evidence_abstains() {
        assert_eq!(classify_parked(&[], None, false), ParkedVerdict::Unknown);
        assert_eq!(
            classify_parked(&lines(&["not json at all"]), None, false),
            ParkedVerdict::Unknown
        );
    }

    #[test]
    fn tokens_are_stable_and_unknown_carries_none() {
        assert_eq!(
            verdict_token(&ParkedVerdict::Done { summary: String::new() }),
            Some("done")
        );
        assert_eq!(
            verdict_token(&ParkedVerdict::Blocked(BlockedKind::Question)),
            Some("blocked_question")
        );
        assert_eq!(
            verdict_token(&ParkedVerdict::Blocked(BlockedKind::Permission)),
            Some("blocked_permission")
        );
        assert_eq!(
            verdict_token(&ParkedVerdict::Hung(HungKind::MidTool)),
            Some("hung_mid_tool")
        );
        assert_eq!(verdict_token(&ParkedVerdict::Unknown), None);
    }
}
