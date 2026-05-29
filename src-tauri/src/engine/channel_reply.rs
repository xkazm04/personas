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

use serde_json::Value as JsonValue;

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
