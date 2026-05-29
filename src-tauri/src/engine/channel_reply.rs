//! Shared helpers for turning a persona execution's `output_data` into the
//! text a messaging connector should post back to the user.
//!
//! Both the Discord and Slack inbound pollers dispatch incoming messages
//! through `execute_persona_inner` and then need to extract a single
//! user-facing reply string from the finished execution's output. That output
//! follows the **dispatch protocol** — standalone JSON objects interleaved
//! with prose (`{"user_message": {...}}`, `{"agent_memory": {...}}`,
//! `{"emit_event": {...}}`, …). The reply we post is `user_message.content`.
//!
//! This module is transport-agnostic: per-transport concerns (Discord's 2000
//! char limit, Slack's `ts` threading, snowflake cursor comparison) live in
//! the individual poller modules.

use rusqlite::{params, OptionalExtension};
use serde_json::Value as JsonValue;

use crate::db::DbPool;
use crate::error::AppError;

/// Pull the user-facing reply text out of a persona execution's `output_data`.
///
/// Scans for the first dispatch-protocol `user_message.content`. Falls back to
/// legacy envelope keys (`reply`/`message`/`text`/…) and finally the raw
/// output, so a persona that just prints plain text still works.
pub fn extract_reply_from_output(output: &str) -> String {
    if let Some(content) = find_protocol_user_message(output) {
        return content;
    }
    let trimmed = output.trim();
    if trimmed.starts_with('{') {
        if let Ok(v) = serde_json::from_str::<JsonValue>(trimmed) {
            for key in &["reply", "message", "text", "content", "result", "output"] {
                if let Some(s) = v.get(*key).and_then(JsonValue::as_str) {
                    if !s.trim().is_empty() {
                        return s.to_string();
                    }
                }
            }
        }
    }
    output.to_string()
}

/// Scan `output` for the first dispatch-protocol `user_message` block and
/// return its `content`. Walks every `{`-delimited JSON object (protocol
/// blocks are emitted as standalone objects, often multi-line).
pub fn find_protocol_user_message(output: &str) -> Option<String> {
    let bytes = output.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'{' {
            if let Some(end) = match_json_object(bytes, i) {
                if let Ok(v) = serde_json::from_str::<JsonValue>(&output[i..=end]) {
                    if let Some(content) = v
                        .get("user_message")
                        .and_then(|um| um.get("content"))
                        .and_then(JsonValue::as_str)
                        .filter(|s| !s.trim().is_empty())
                    {
                        return Some(content.to_string());
                    }
                }
                i = end + 1;
                continue;
            }
        }
        i += 1;
    }
    None
}

/// Index of the `}` that closes the `{` at `start`, respecting JSON string
/// literals (so braces inside strings don't throw off the depth count).
pub fn match_json_object(bytes: &[u8], start: usize) -> Option<usize> {
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escaped = false;
    for (offset, &b) in bytes.iter().enumerate().skip(start) {
        if in_string {
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if b == b'"' {
                in_string = false;
            }
        } else {
            match b {
                b'"' => in_string = true,
                b'{' => depth += 1,
                b'}' => {
                    depth -= 1;
                    if depth == 0 {
                        return Some(offset);
                    }
                }
                _ => {}
            }
        }
    }
    None
}

/// Turn a finished persona execution into the text a connector should post.
///
/// Returns `Ok(Some(text))` when the execution has finished and we have a body
/// to post, `Ok(None)` when it's still running (try again next tick), and
/// `Err` when the execution row is missing or in a state we shouldn't reply
/// for (cancelled, etc.). The `_(…)_` markers render as italics in both
/// Discord and Slack mrkdwn, so this is transport-agnostic.
pub fn build_reply_text(pool: &DbPool, execution_id: &str) -> Result<Option<String>, AppError> {
    let conn = pool.get()?;
    let row = conn
        .query_row(
            "SELECT status, output_data, error_message FROM persona_executions WHERE id = ?1",
            params![execution_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()?;
    let (status, output, error_message) = match row {
        Some(r) => r,
        None => {
            return Err(AppError::Validation(format!(
                "execution {} disappeared before reply",
                execution_id
            )))
        }
    };

    match status.as_str() {
        "completed" => {
            let text = output
                .as_deref()
                .map(extract_reply_from_output)
                .unwrap_or_default();
            let trimmed = text.trim();
            if trimmed.is_empty() {
                Ok(Some("_(persona produced no reply text)_".to_string()))
            } else {
                Ok(Some(trimmed.to_string()))
            }
        }
        "failed" => Ok(Some(format!(
            "_(persona run failed: {})_",
            error_message
                .as_deref()
                .or(output.as_deref())
                .unwrap_or("unknown error")
                .chars()
                .take(200)
                .collect::<String>()
        ))),
        "cancelled" => Err(AppError::Validation(format!(
            "execution {} was cancelled",
            execution_id
        ))),
        _ => Ok(None), // queued/running — try again next tick
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_reply_pulls_known_keys() {
        let envelope = r#"{"reply":"hi there"}"#;
        assert_eq!(extract_reply_from_output(envelope), "hi there");
        assert_eq!(extract_reply_from_output("plain text"), "plain text");
    }

    #[test]
    fn extract_reply_falls_back_when_no_known_key() {
        let envelope = r#"{"other":"foo"}"#;
        assert_eq!(extract_reply_from_output(envelope), envelope);
    }

    #[test]
    fn extract_reply_pulls_user_message_from_dispatch_protocol() {
        // Real-world shape: prose preamble, then standalone protocol blocks.
        let output = "I'll reply via the protocol output.\n\n\
            Here's my reply:\n\n\
            {\"user_message\": {\"title\": \"Reply\", \"content\": \"Hey! I'm your assistant.\", \"priority\": \"normal\"}}\n\n\
            {\"agent_memory\": {\"title\": \"note\", \"content\": \"something\", \"importance\": 3}}\n\n\
            {\"outcome_assessment\": {\"accomplished\": true}}";
        assert_eq!(
            extract_reply_from_output(output),
            "Hey! I'm your assistant.",
        );
    }

    #[test]
    fn extract_reply_handles_braces_inside_strings() {
        // A `}` inside the content string must not end the object early.
        let output =
            r#"{"user_message": {"content": "use {curly} braces like {this}"}}"#;
        assert_eq!(
            extract_reply_from_output(output),
            "use {curly} braces like {this}",
        );
    }
}
