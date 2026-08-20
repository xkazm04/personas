//! Parser — turns Claude CLI `stream-json` lines into typed `BuildEvent`s.
//!
//! The CLI with `--output-format stream-json --verbose` wraps content in
//! envelopes like `{"type":"assistant","message":{"content":[{"type":"text",
//! "text":"..."}]}}`. We unwrap the envelope to extract the LLM's text, then
//! parse that text for the structured JSON objects the build prompt asks
//! for (`behavior_core`, `capability_enumeration`, `capability_resolution`,
//! `persona_resolution`, `clarifying_question`, `agent_ir`).
//!
//! Legacy mirror: every v3 event also emits a legacy `CellUpdate` /
//! `Question` mirror so the existing 8-dim matrix UI renders the build
//! progress identically. The mapping lives in `map_*_to_legacy_dimension`
//! and `wrap_value_in_legacy_dimension_shape`.

use crate::db::models::BuildEvent;

// =============================================================================
// Helpers
// =============================================================================

/// Parse a single line of CLI output into zero or more BuildEvents.
///
/// The Claude CLI with `--output-format stream-json --verbose` wraps output in
/// envelopes like `{"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}`.
/// We unwrap the envelope to extract the LLM's actual text, then parse that text
/// for structured question/dimension/error JSON objects. A single response can
/// contain multiple resolved dimensions + one question.
pub(super) fn parse_build_line(line: &str, session_id: &str) -> Vec<BuildEvent> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return vec![];
    }

    // Fast-path: the Claude CLI streams a lot of non-JSON status text
    // (banners, thinking summaries, tool prelude lines) interleaved with the
    // stream-json envelopes we care about. Running serde_json::from_str on
    // every line tokenizes hundreds of discarded lines per build turn. Short-
    // circuit anything that can't be an envelope — must start with `{` and be
    // at least as long as the smallest meaningful envelope `{"type":"..."}`
    // (12 bytes). The slow JSON path below is still authoritative for any
    // candidate line that passes this check.
    if trimmed.len() < 12 || !trimmed.as_bytes().starts_with(b"{") {
        return vec![BuildEvent::Progress {
            session_id: session_id.to_string(),
            dimension: None,
            message: trimmed.to_string(),
            percent: None,
            activity: None,
        }];
    }

    // Try parsing as JSON
    let json: serde_json::Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => {
            // Non-JSON lines emitted as progress
            return vec![BuildEvent::Progress {
                session_id: session_id.to_string(),
                dimension: None,
                message: trimmed.to_string(),
                percent: None,
                activity: None,
            }];
        }
    };

    let obj = match json.as_object() {
        // Valid JSON that is not an object (a bare array, string or number).
        // It carries no envelope and no event, but dropping it silently means
        // the transcript loses a line the model actually emitted.
        None => {
            return vec![BuildEvent::Progress {
                session_id: session_id.to_string(),
                dimension: None,
                message: trimmed.to_string(),
                percent: None,
                activity: None,
            }]
        }
        Some(o) => o,
    };

    // Check for CLI streaming envelope
    let envelope_type = obj.get("type").and_then(|v| v.as_str()).unwrap_or("");
    match envelope_type {
        "system" | "rate_limit_event" => return vec![], // Skip system messages
        "assistant" => {
            // Unwrap: message.content[].text
            let text = obj
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
                .and_then(|arr| {
                    arr.iter()
                        .find(|item| item.get("type").and_then(|t| t.as_str()) == Some("text"))
                        .and_then(|item| item.get("text").and_then(|t| t.as_str()))
                });
            if let Some(text) = text {
                return parse_llm_text_content(text, session_id);
            }
            return vec![];
        }
        "result" => {
            // Unwrap: result field (string)
            if let Some(result_text) = obj.get("result").and_then(|v| v.as_str()) {
                return parse_llm_text_content(result_text, session_id);
            }
            // A `result` envelope is the model's FINAL word for the turn. When
            // it carries no text — `error_max_turns`, `error_during_execution`
            // — dropping it made a turn that BROKE look identical to a turn
            // that simply had nothing to add. Name the subtype instead.
            let subtype = obj
                .get("subtype")
                .and_then(|v| v.as_str())
                .unwrap_or("no result text");
            return vec![BuildEvent::Progress {
                session_id: session_id.to_string(),
                dimension: None,
                message: format!("The build model's turn ended without output ({subtype})."),
                percent: None,
                activity: None,
            }];
        }
        _ => {} // Fall through to direct JSON parsing (backward compat)
    }

    // Not an envelope — try direct parsing (backward compat for non-envelope output)
    parse_json_object(obj, &json, session_id)
}

/// Build telemetry (Phase 0): cost + token usage pulled from a stream-json
/// `result` envelope line. The parser normally discards these sibling fields
/// (it only unwraps `result` text); this reads them so the runner can sum
/// build cost across turns.
pub(super) struct ResultUsage {
    pub cost_usd: f64,
    pub input_tokens: i64,
    pub output_tokens: i64,
}

/// Returns `Some` only for a `{"type":"result",...}` line carrying usage.
pub(super) fn extract_result_usage(line: &str) -> Option<ResultUsage> {
    let trimmed = line.trim();
    if trimmed.len() < 12 || !trimmed.as_bytes().starts_with(b"{") {
        return None;
    }
    let json: serde_json::Value = serde_json::from_str(trimmed).ok()?;
    let obj = json.as_object()?;
    if obj.get("type").and_then(|v| v.as_str()) != Some("result") {
        return None;
    }
    let cost_usd = obj
        .get("total_cost_usd")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let usage = obj.get("usage");
    let input_tokens = usage
        .and_then(|u| u.get("input_tokens"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let output_tokens = usage
        .and_then(|u| u.get("output_tokens"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    Some(ResultUsage {
        cost_usd,
        input_tokens,
        output_tokens,
    })
}

/// The structured payloads the build prompt asks the model to emit. Used only
/// to decide whether an unparseable blob was *meant* to be an event — prose
/// containing a stray `{` should not raise an alarm, a mangled `agent_ir`
/// should.
const STRUCTURED_KEYS: &[&str] = &[
    "behavior_core",
    "capability_enumeration",
    "capability_resolution",
    "persona_resolution",
    "clarifying_question",
    "agent_ir",
    "test_report",
];

/// Parse the LLM's actual text content (unwrapped from CLI envelope).
/// Handles multiple JSON objects per response (e.g., 3 resolved dimensions + 1 question).
fn parse_llm_text_content(text: &str, session_id: &str) -> Vec<BuildEvent> {
    let mut events = Vec::new();

    // Strip markdown code fences
    let cleaned = text.replace("```json", "").replace("```", "");

    // Walk balanced braces rather than lines.
    //
    // The build prompt asks for one compact JSON object per line, and the
    // model routinely pretty-prints instead. Under the old line-oriented loop
    // a pretty-printed object matched NOTHING: `{` alone is not valid JSON, so
    // an entire `agent_ir` — the build's whole output — silently degraded into
    // a 200-character `Progress` line with the rest thrown away.
    // `tool_tests::extract_test_plan` already parsed multi-line; this is the
    // same capability, applied to every event type.
    let scan = scan_json_objects(&cleaned);
    for val in &scan.objects {
        if let Some(obj) = val.as_object() {
            events.extend(parse_json_object(obj, val, session_id));
        }
    }

    if !events.is_empty() {
        return events;
    }

    if text.trim().is_empty() {
        return events;
    }

    // Nothing structured came out. If the text was *carrying* a structured
    // payload we could not read, say so — that is a dropped build event, not a
    // status line, and truncating it to 200 characters hid which.
    let looks_structured = STRUCTURED_KEYS
        .iter()
        .any(|k| cleaned.contains(&format!("\"{k}\"")));
    if looks_structured && scan.unparsed > 0 {
        tracing::warn!(
            session_id = %session_id,
            unparsed_candidates = scan.unparsed,
            text_bytes = text.len(),
            excerpt = %crate::utils::text::truncate_on_char_boundary(text, 400),
            "build parser: response carried a structured payload that could not be parsed as JSON — dropped"
        );
        events.push(BuildEvent::Progress {
            session_id: session_id.to_string(),
            dimension: None,
            message: format!(
                "The build model emitted a structured block ({} characters) that could not be read as JSON, so it was dropped.",
                text.len()
            ),
            percent: None,
            activity: None,
        });
        return events;
    }

    // Ordinary prose — emit as progress, truncated as before.
    let msg = if text.len() > 200 {
        crate::utils::text::truncate_on_char_boundary(text, 200)
    } else {
        text
    };
    events.push(BuildEvent::Progress {
        session_id: session_id.to_string(),
        dimension: None,
        message: msg.trim().to_string(),
        percent: None,
        activity: None,
    });

    events
}

/// What a balanced-brace scan found in a blob of model text.
struct ScanOutcome {
    objects: Vec<serde_json::Value>,
    /// `{`s that opened something which could not be parsed as JSON. Counted
    /// so an unreadable payload can be reported rather than silently skipped.
    unparsed: usize,
}

/// Find every JSON object in `text` that *starts* a line, however it is
/// formatted afterwards.
///
/// Line-anchoring is deliberate and matches the old behaviour: the build
/// prompt asks for structured objects on their own lines, and scanning
/// mid-sentence braces would let prose like `use {"error": "…"} for failures`
/// mint a real `BuildEvent::Error` (which flips the session to `failed`). What
/// changes is that the object no longer has to FIT on that line — the scan
/// walks to the matching `}` with a string/escape-aware depth counter, so
/// braces inside string values (`"curl": "curl {…}"`) do not throw it off, and
/// a pretty-printed object spanning 40 lines parses as one value.
///
/// Nested objects are not re-reported: the scan resumes AFTER a parsed object,
/// so `{"a":{"b":1}}` yields one value, not two.
fn scan_json_objects(text: &str) -> ScanOutcome {
    let bytes = text.as_bytes();
    let mut objects = Vec::new();
    let mut unparsed = 0usize;
    let mut pos = 0usize;

    while pos < text.len() {
        let line_end = text[pos..]
            .find('\n')
            .map(|i| pos + i)
            .unwrap_or_else(|| text.len());

        // First non-whitespace byte on what is left of this line.
        let mut start = pos;
        while start < line_end && bytes[start].is_ascii_whitespace() {
            start += 1;
        }

        if start < line_end && bytes[start] == b'{' {
            match balanced_object_end(bytes, start) {
                // `{` and `}` are ASCII, so both indices are char boundaries.
                Some(end) => match serde_json::from_str::<serde_json::Value>(&text[start..=end]) {
                    Ok(val) => {
                        objects.push(val);
                        pos = end + 1;
                        continue;
                    }
                    Err(_) => unparsed += 1,
                },
                None => {
                    // Unbalanced to the end of the text — a truncated stream.
                    // Nothing after this can close either, so stop.
                    unparsed += 1;
                    break;
                }
            }
        }

        pos = line_end + 1;
    }

    ScanOutcome { objects, unparsed }
}

/// Index of the `}` that closes the `{` at `start`, or `None` if unbalanced.
fn balanced_object_end(bytes: &[u8], start: usize) -> Option<usize> {
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escape_next = false;

    for (i, &b) in bytes.iter().enumerate().skip(start) {
        if escape_next {
            escape_next = false;
            continue;
        }
        if in_string {
            match b {
                b'\\' => escape_next = true,
                b'"' => in_string = false,
                _ => {}
            }
            continue;
        }
        match b {
            b'"' => in_string = true,
            b'{' => depth += 1,
            b'}' => {
                // Only reachable with depth >= 1: the caller always points at
                // a `{`. Guarded anyway rather than risking an underflow panic
                // inside the build parser.
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
    }
    None
}

// =============================================================================
// Tests
// =============================================================================
//
// Run with: node scripts/build/run-rust-tests.mjs -- build_session

#[cfg(test)]
mod tests {
    use super::*;

    const SID: &str = "sess-1";

    fn kinds(events: &[BuildEvent]) -> Vec<&'static str> {
        events
            .iter()
            .map(|e| match e {
                BuildEvent::CellUpdate { .. } => "cell",
                BuildEvent::Question { .. } => "question",
                BuildEvent::Progress { .. } => "progress",
                BuildEvent::Error { .. } => "error",
                BuildEvent::SessionStatus { .. } => "status",
                BuildEvent::BehaviorCoreUpdate { .. } => "behavior_core",
                BuildEvent::CapabilityEnumerationUpdate { .. } => "cap_enum",
                BuildEvent::CapabilityResolutionUpdate { .. } => "cap_res",
                BuildEvent::PersonaResolutionUpdate { .. } => "persona_res",
                BuildEvent::ClarifyingQuestionV3 { .. } => "question_v3",
            })
            .collect()
    }

    fn progress_messages(events: &[BuildEvent]) -> Vec<String> {
        events
            .iter()
            .filter_map(|e| match e {
                BuildEvent::Progress { message, .. } => Some(message.clone()),
                _ => None,
            })
            .collect()
    }

    /// Wrap `text` the way the CLI's stream-json assistant envelope does.
    fn assistant(text: &str) -> String {
        serde_json::json!({
            "type": "assistant",
            "message": { "content": [{ "type": "text", "text": text }] },
        })
        .to_string()
    }

    // ── the multi-line drop ──────────────────────────────────────────────

    /// The regression this file was opened for. A pretty-printed `agent_ir` —
    /// the entire output of a build — matched nothing under the old
    /// line-oriented loop, because `{` on its own is not valid JSON. The whole
    /// response then degraded into a truncated 200-character `Progress`.
    #[test]
    fn a_pretty_printed_agent_ir_is_no_longer_dropped() {
        let pretty = r#"{
  "agent_ir": {
    "name": "Inbox Triage",
    "tools": [
      { "name": "gmail" }
    ]
  }
}"#;
        let events = parse_build_line(&assistant(pretty), SID);
        assert_eq!(kinds(&events), vec!["cell"], "got: {events:?}");
        match &events[0] {
            BuildEvent::CellUpdate { cell_key, data, .. } => {
                assert_eq!(cell_key, "agent_ir");
                assert_eq!(data["name"], serde_json::json!("Inbox Triage"));
            }
            other => panic!("expected a cell update, got {other:?}"),
        }
    }

    #[test]
    fn a_pretty_printed_v3_event_still_emits_its_legacy_mirror() {
        let pretty = "{\n  \"behavior_core\": {\n    \"mission\": \"triage\"\n  }\n}";
        let events = parse_build_line(&assistant(pretty), SID);
        assert_eq!(kinds(&events), vec!["behavior_core", "cell"]);
    }

    #[test]
    fn compact_one_object_per_line_output_still_parses() {
        // The shape the prompt actually asks for: several objects, one per
        // line. Both must be seen — the scan must not stop after the first.
        let text = "{\"persona_resolution\":{\"field\":\"tools\",\"value\":[]}}\n\
                    {\"agent_ir\":{\"name\":\"x\"}}";
        let events = parse_build_line(&assistant(text), SID);
        assert_eq!(kinds(&events), vec!["persona_res", "cell"]);
        match events.last().expect("the agent_ir object") {
            BuildEvent::CellUpdate { cell_key, .. } => assert_eq!(cell_key, "agent_ir"),
            other => panic!("expected the second object to parse, got {other:?}"),
        }
    }

    #[test]
    fn braces_inside_string_values_do_not_break_the_scan() {
        // A curl command in a description is the realistic case.
        let text =
            "{\n  \"agent_ir\": {\n    \"note\": \"run curl -w '{http_code}' \\\"x\\\"\"\n  }\n}";
        let events = parse_build_line(&assistant(text), SID);
        assert_eq!(kinds(&events), vec!["cell"]);
    }

    #[test]
    fn a_nested_object_is_not_reported_as_a_second_event() {
        let text = "{\"agent_ir\":{\"question\":\"not a question event\"}}";
        let events = parse_build_line(&assistant(text), SID);
        assert_eq!(kinds(&events), vec!["cell"]);
    }

    /// Line-anchoring is load-bearing: `parse_json_object` turns any object
    /// carrying an `error` key into `BuildEvent::Error`, which flips the whole
    /// session to `failed`. Prose that merely mentions one must not do that.
    #[test]
    fn a_json_object_quoted_mid_sentence_does_not_mint_an_event() {
        let text = "If a tool breaks I will emit {\"error\": \"…\"} and stop.";
        let events = parse_build_line(&assistant(text), SID);
        assert_eq!(kinds(&events), vec!["progress"]);
    }

    // ── surfacing what could not be parsed ───────────────────────────────

    #[test]
    fn a_truncated_structured_payload_is_reported_not_silently_truncated() {
        // A stream that died mid-object: balanced-brace scan finds no close.
        let broken = format!(
            "{{\n  \"agent_ir\": {{\n    \"name\": \"{}\",\n    \"tools\": [",
            "x".repeat(400)
        );
        let events = parse_build_line(&assistant(&broken), SID);
        assert_eq!(kinds(&events), vec!["progress"]);
        let msg = &progress_messages(&events)[0];
        assert!(
            msg.contains("could not be read as JSON"),
            "a dropped build event must say it was dropped, got: {msg}"
        );
        assert!(
            !msg.contains("xxxxx"),
            "and must not pass a JSON fragment off as a status line: {msg}"
        );
    }

    #[test]
    fn ordinary_prose_still_becomes_a_plain_truncated_progress_line() {
        let prose = "Looking at the connectors you have available. ".repeat(20);
        let events = parse_build_line(&assistant(&prose), SID);
        assert_eq!(kinds(&events), vec!["progress"]);
        let msg = &progress_messages(&events)[0];
        assert!(msg.starts_with("Looking at the connectors"));
        assert!(msg.len() <= 200);
    }

    #[test]
    fn a_result_envelope_with_no_text_names_why_instead_of_vanishing() {
        // `error_max_turns` used to be indistinguishable from a silent turn.
        let line = r#"{"type":"result","subtype":"error_max_turns","is_error":true}"#;
        let events = parse_build_line(line, SID);
        assert_eq!(kinds(&events), vec!["progress"]);
        assert!(progress_messages(&events)[0].contains("error_max_turns"));
    }

    #[test]
    fn a_non_object_json_line_is_surfaced_rather_than_dropped() {
        let events = parse_build_line("[\"not an envelope at all\"]", SID);
        assert_eq!(kinds(&events), vec!["progress"]);
    }

    // ── behaviour that must not change ───────────────────────────────────

    #[test]
    fn system_and_rate_limit_envelopes_stay_silent() {
        for line in [
            r#"{"type":"system","subtype":"init","cwd":"/x"}"#,
            r#"{"type":"rate_limit_event","retry_after":30}"#,
        ] {
            assert!(parse_build_line(line, SID).is_empty(), "{line}");
        }
    }

    #[test]
    fn an_assistant_envelope_carrying_only_tool_use_stays_silent() {
        // Every build turn emits these; surfacing them would flood the stream.
        let line = serde_json::json!({
            "type": "assistant",
            "message": { "content": [{ "type": "tool_use", "name": "Read", "input": {} }] },
        })
        .to_string();
        assert!(parse_build_line(&line, SID).is_empty());
    }

    #[test]
    fn short_non_json_lines_take_the_fast_path_to_progress() {
        let events = parse_build_line("thinking…", SID);
        assert_eq!(kinds(&events), vec!["progress"]);
        assert_eq!(progress_messages(&events)[0], "thinking…");
    }

    #[test]
    fn blank_lines_produce_nothing() {
        assert!(parse_build_line("   ", SID).is_empty());
    }

    // ── the scanner itself ───────────────────────────────────────────────

    #[test]
    fn scanner_finds_multiple_pretty_printed_objects() {
        let text = "{\n \"a\": 1\n}\n{\n \"b\": 2\n}\n";
        let scan = scan_json_objects(text);
        assert_eq!(scan.objects.len(), 2);
        assert_eq!(scan.unparsed, 0);
    }

    #[test]
    fn scanner_counts_an_unbalanced_tail_as_unparsed() {
        let scan = scan_json_objects("{\n \"a\": 1\n}\n{\n \"b\":");
        assert_eq!(scan.objects.len(), 1);
        assert_eq!(scan.unparsed, 1);
    }

    #[test]
    fn scanner_survives_multibyte_text() {
        let text = "{\n  \"agent_ir\": { \"name\": \"Přehled — 日本語\" }\n}";
        let scan = scan_json_objects(text);
        assert_eq!(scan.objects.len(), 1);
        assert_eq!(
            scan.objects[0]["agent_ir"]["name"],
            serde_json::json!("Přehled — 日本語")
        );
    }

    #[test]
    fn scanner_ignores_a_line_that_does_not_start_with_a_brace() {
        let scan = scan_json_objects("here is one: {\"a\":1}\n");
        assert_eq!(scan.objects.len(), 0);
        assert_eq!(scan.unparsed, 0, "prose braces are not a parse failure");
    }

    #[test]
    fn extract_result_usage_reads_only_result_envelopes() {
        let line = r#"{"type":"result","total_cost_usd":0.42,"usage":{"input_tokens":10,"output_tokens":5}}"#;
        let usage = extract_result_usage(line).expect("a result envelope carries usage");
        assert_eq!(usage.cost_usd, 0.42);
        assert_eq!(usage.input_tokens, 10);
        assert_eq!(usage.output_tokens, 5);
        assert!(extract_result_usage(r#"{"type":"assistant","message":{}}"#).is_none());
    }
}

/// Parse a single JSON object into one or more `BuildEvent`s.
///
/// v3 events (behavior_core, capability_enumeration, capability_resolution,
/// persona_resolution, clarifying_question with a `scope`) each emit TWO
/// events: the typed v3 variant AND a legacy `CellUpdate` / `Question` mirror
/// so the existing 3×3 matrix UI keeps rendering during migration.
/// See §3.8 of C4-build-from-scratch-v3-handoff.md.
pub(super) fn parse_json_object(
    obj: &serde_json::Map<String, serde_json::Value>,
    full_val: &serde_json::Value,
    session_id: &str,
) -> Vec<BuildEvent> {
    // -----------------------------------------------------------------
    // v3 event: behavior_core
    // -----------------------------------------------------------------
    if let Some(core) = obj.get("behavior_core") {
        let mut out = vec![BuildEvent::BehaviorCoreUpdate {
            session_id: session_id.to_string(),
            data: core.clone(),
            status: "resolved".to_string(),
        }];
        // Legacy mirror: surface the core under a dedicated cell key so the
        // old matrix UI can show it as a synthetic 9th cell if desired.
        out.push(BuildEvent::CellUpdate {
            session_id: session_id.to_string(),
            cell_key: "behavior_core".to_string(),
            data: core.clone(),
            status: "resolved".to_string(),
        });
        return out;
    }

    // -----------------------------------------------------------------
    // v3 event: capability_enumeration
    // -----------------------------------------------------------------
    if let Some(enu) = obj.get("capability_enumeration") {
        let mut out = vec![BuildEvent::CapabilityEnumerationUpdate {
            session_id: session_id.to_string(),
            data: enu.clone(),
            status: "resolved".to_string(),
        }];
        // Legacy mirror: hoist the capability list under the use-cases key so
        // the old dimensional cell renders something useful. Map each
        // capability's title to `items[]` and full list to `use_cases[]`.
        let legacy_data = capabilities_to_legacy_use_cases(enu);
        out.push(BuildEvent::CellUpdate {
            session_id: session_id.to_string(),
            cell_key: "use-cases".to_string(),
            data: legacy_data,
            status: "resolved".to_string(),
        });
        return out;
    }

    // -----------------------------------------------------------------
    // v3 event: capability_resolution
    // -----------------------------------------------------------------
    if let Some(res) = obj.get("capability_resolution") {
        if let Some(res_obj) = res.as_object() {
            let capability_id = res_obj
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let field = res_obj
                .get("field")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let value = res_obj.get("value").cloned().unwrap_or_default();
            let status = res_obj
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("resolved")
                .to_string();

            let mut out = vec![BuildEvent::CapabilityResolutionUpdate {
                session_id: session_id.to_string(),
                capability_id: capability_id.clone(),
                field: field.clone(),
                value: value.clone(),
                status: status.clone(),
                // Single-lane sequential build today; the fan-out (Phase 4) sets this.
                lane: None,
            }];
            // Legacy mirror: map field → legacy dimension key and surface as CellUpdate.
            if let Some(legacy_key) = map_capability_field_to_legacy_dimension(&field) {
                let legacy_data =
                    wrap_value_in_legacy_dimension_shape(&field, &value, &capability_id);
                out.push(BuildEvent::CellUpdate {
                    session_id: session_id.to_string(),
                    cell_key: legacy_key.to_string(),
                    data: legacy_data,
                    status,
                });
            }
            return out;
        }
    }

    // -----------------------------------------------------------------
    // v3 event: persona_resolution
    // -----------------------------------------------------------------
    if let Some(res) = obj.get("persona_resolution") {
        if let Some(res_obj) = res.as_object() {
            let field = res_obj
                .get("field")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let value = res_obj.get("value").cloned().unwrap_or_default();
            let status = res_obj
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("resolved")
                .to_string();

            let mut out = vec![BuildEvent::PersonaResolutionUpdate {
                session_id: session_id.to_string(),
                field: field.clone(),
                value: value.clone(),
                status: status.clone(),
            }];
            if let Some(legacy_key) = map_persona_field_to_legacy_dimension(&field) {
                let legacy_data = wrap_value_in_legacy_dimension_shape(&field, &value, "");
                out.push(BuildEvent::CellUpdate {
                    session_id: session_id.to_string(),
                    cell_key: legacy_key.to_string(),
                    data: legacy_data,
                    status,
                });
            }
            return out;
        }
    }

    // -----------------------------------------------------------------
    // Question detection — handles BOTH legacy `{question, dimension}` and
    // v3 `{clarifying_question: {scope, ...}}` / bare `{question, scope, ...}`.
    // -----------------------------------------------------------------
    if let Some(cq) = obj.get("clarifying_question") {
        if let Some(cq_obj) = cq.as_object() {
            return build_clarifying_question_events(cq_obj, session_id);
        }
    }
    if obj.contains_key("question") {
        // A v3-style question is `{question, scope, ...}`; a legacy question is
        // `{question, dimension, options}`. Detect scope to route correctly.
        if obj.contains_key("scope") {
            return build_clarifying_question_events(obj, session_id);
        }

        let cell_key = obj
            .get("dimension")
            .or_else(|| obj.get("cell_key"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
        let question = match obj.get("question").and_then(|v| v.as_str()) {
            Some(q) => q.to_string(),
            None => return vec![],
        };
        let options = obj.get("options").and_then(|v| {
            v.as_array().map(|arr| {
                arr.iter()
                    .filter_map(|item| item.as_str().map(|s| s.to_string()))
                    .collect()
            })
        });
        return vec![BuildEvent::Question {
            session_id: session_id.to_string(),
            cell_key,
            question,
            options,
            connector_category: None,
            accepts_reference: false,
            accepts_webhook_source: false,
            suggested: Vec::new(),
        }];
    }

    // Agent IR detection
    if obj.contains_key("agent_ir") {
        let ir_data = obj.get("agent_ir").cloned().unwrap_or_default();
        return vec![BuildEvent::CellUpdate {
            session_id: session_id.to_string(),
            cell_key: "agent_ir".to_string(),
            data: ir_data,
            status: "resolved".to_string(),
        }];
    }

    // Test report detection
    if obj.contains_key("test_report") {
        let report = obj.get("test_report").cloned().unwrap_or_default();
        return vec![BuildEvent::CellUpdate {
            session_id: session_id.to_string(),
            cell_key: "_test_report".to_string(),
            data: report,
            status: "resolved".to_string(),
        }];
    }

    // Dimension/cell update detection (legacy v2 dimensional output)
    if obj.contains_key("dimension") || obj.contains_key("cell_key") {
        let cell_key = obj
            .get("dimension")
            .or_else(|| obj.get("cell_key"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
        let data = obj
            .get("data")
            .or_else(|| obj.get("result"))
            .cloned()
            .unwrap_or(full_val.clone());
        let status = obj
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("resolved")
            .to_string();
        return vec![BuildEvent::CellUpdate {
            session_id: session_id.to_string(),
            cell_key,
            data,
            status,
        }];
    }

    // Error detection
    if obj.contains_key("error") {
        let message = obj
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error")
            .to_string();
        let retryable = obj
            .get("retryable")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        return vec![BuildEvent::Error {
            session_id: session_id.to_string(),
            cell_key: obj
                .get("cell_key")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            message,
            retryable,
        }];
    }

    vec![]
}

/// Emit the typed v3 `ClarifyingQuestionV3` plus a legacy `Question` mirror
/// so the old dimension-scoped question panel keeps rendering.
pub(super) fn build_clarifying_question_events(
    obj: &serde_json::Map<String, serde_json::Value>,
    session_id: &str,
) -> Vec<BuildEvent> {
    let scope = obj
        .get("scope")
        .and_then(|v| v.as_str())
        .unwrap_or("mission")
        .to_string();
    let capability_id = obj
        .get("capability_id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let field = obj
        .get("field")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let question = match obj.get("question").and_then(|v| v.as_str()) {
        Some(q) => q.to_string(),
        None => return vec![],
    };
    let options = obj.get("options").and_then(|v| {
        v.as_array().map(|arr| {
            arr.iter()
                .filter_map(|item| item.as_str().map(|s| s.to_string()))
                .collect()
        })
    });
    // `category` is only meaningful when scope == "connector_category" but we
    // accept it as an optional field on any scope for forward-compatibility.
    let category = obj
        .get("category")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    // C7 — `accepts_reference` flips the answering UI into reference-attach
    // mode. Optional + defaults to false so older CLI streams keep working.
    let accepts_reference = obj
        .get("accepts_reference")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    // C7 — `accepts_webhook_source` flips the answering UI into smee.io
    // URL-input mode. Same backwards-compat default.
    let accepts_webhook_source = obj
        .get("accepts_webhook_source")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    // Ambient Context Fusion (Case 1) — connector keywords the build-session
    // gate seeder derived from ambient desktop signals. Optional + defaults to
    // empty so streams without the hint keep working.
    let suggested: Vec<String> = obj
        .get("suggested")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| item.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let mut events = vec![BuildEvent::ClarifyingQuestionV3 {
        session_id: session_id.to_string(),
        scope: scope.clone(),
        capability_id: capability_id.clone(),
        field: field.clone(),
        question: question.clone(),
        options: options.clone(),
        category: category.clone(),
        accepts_reference,
        accepts_webhook_source,
        suggested: suggested.clone(),
    }];

    // Legacy Question mirror — the old UI keys by `cell_key`. Pick the most
    // sensible legacy dimension for each scope so the old question panel
    // can surface it somewhere instead of dropping it.
    let cell_key = match scope.as_str() {
        "mission" => "behavior_core".to_string(),
        "capability" => "use-cases".to_string(),
        "connector_category" => "connectors".to_string(),
        "field" => field
            .as_deref()
            .and_then(map_capability_field_to_legacy_dimension)
            .unwrap_or("use-cases")
            .to_string(),
        _ => "use-cases".to_string(),
    };
    // Pass through connector_category on the legacy mirror so the answering
    // UI can route scope=connector_category questions to the vault picker.
    let legacy_category = if scope == "connector_category" {
        category.clone()
    } else {
        None
    };
    events.push(BuildEvent::Question {
        session_id: session_id.to_string(),
        cell_key,
        question,
        options,
        connector_category: legacy_category,
        accepts_reference,
        accepts_webhook_source,
        // Pre-rank hint only carries meaning on the connector_category mirror;
        // for other scopes the gate seeder leaves it empty.
        suggested,
    });

    events
}

/// Map a v3 capability field name to the legacy v2 dimension key the 3×3
/// matrix UI understands, for the legacy CellUpdate mirror. Returns `None`
/// for fields that have no legacy equivalent (e.g. `input_schema`,
/// `use_case_flow`) — those events surface only via v3 typed state.
pub(super) fn map_capability_field_to_legacy_dimension(field: &str) -> Option<&'static str> {
    match field {
        "suggested_trigger" => Some("triggers"),
        "connectors" => Some("connectors"),
        "notification_channels" => Some("messages"),
        "review_policy" => Some("human-review"),
        "memory_policy" => Some("memory"),
        "event_subscriptions" => Some("events"),
        "error_handling" => Some("error-handling"),
        // 2026-05-05 — without this entry, the legacy `Question` mirror for the
        // 5th gate fell back to cell_key="use-cases", and the answer handler's
        // `legacy_cell_to_v3_field("use-cases")` returned None, so the gate
        // never flipped Open and the same question fired in round 2. Mirror
        // matches the cell_key inverse in gates::legacy_cell_to_v3_field.
        "sample_output" => Some("sample-output"),
        _ => None,
    }
}

/// Map a v3 persona-wide field name to the legacy dimension key. Persona-wide
/// overlaps (connectors, error_handling, etc.) share the legacy key with
/// capability-scoped fields — the 3×3 UI rendered them as a single cell anyway.
pub(super) fn map_persona_field_to_legacy_dimension(field: &str) -> Option<&'static str> {
    match field {
        "connectors" => Some("connectors"),
        "notification_channels_default" => Some("messages"),
        "error_handling" => Some("error-handling"),
        "core_memories" => Some("memory"),
        _ => None,
    }
}

/// Wrap a v3 field value in the shape the legacy dimension cell expects.
/// The old UI consumes `{items, <dimension-key>[]}` shapes so each dimension
/// can render a summary + structured list. We reconstruct that on the fly
/// from v3 values.
fn wrap_value_in_legacy_dimension_shape(
    field: &str,
    value: &serde_json::Value,
    capability_id: &str,
) -> serde_json::Value {
    use serde_json::json;
    let suffix = if capability_id.is_empty() {
        String::new()
    } else {
        format!(" [{}]", capability_id)
    };

    match field {
        // Per-capability suggested_trigger — value is a single trigger object
        "suggested_trigger" => {
            let mut trig = value.clone();
            if let Some(obj) = trig.as_object_mut() {
                if !capability_id.is_empty() {
                    obj.insert("use_case_id".to_string(), json!(capability_id));
                }
            }
            let desc = trig
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            json!({
                "items": [format!("{}{}", desc, suffix)],
                "triggers": [trig]
            })
        }

        // Persona-wide or per-capability connector list
        "connectors" => {
            let arr = value.as_array().cloned().unwrap_or_default();
            // If entries are strings (capability references), skip legacy mirror;
            // otherwise assume they are full connector objects (persona registry).
            if arr.iter().all(|v| v.is_string()) {
                json!({
                    "items": arr.iter().filter_map(|v| v.as_str().map(|s| format!("{}{}", s, suffix))).collect::<Vec<_>>(),
                })
            } else {
                let items: Vec<String> = arr
                    .iter()
                    .map(|c| {
                        let name = c.get("name").and_then(|v| v.as_str()).unwrap_or("");
                        let svc = c.get("service_type").and_then(|v| v.as_str()).unwrap_or("");
                        let purp = c.get("purpose").and_then(|v| v.as_str()).unwrap_or("");
                        format!("{} ({}) — {}", name, svc, purp)
                    })
                    .collect();
                json!({
                    "items": items,
                    "connectors": arr,
                    "alternatives": {}
                })
            }
        }

        "notification_channels" | "notification_channels_default" => {
            let arr = value.as_array().cloned().unwrap_or_default();
            let items: Vec<String> = arr
                .iter()
                .map(|c| {
                    let ch = c.get("channel").and_then(|v| v.as_str()).unwrap_or("");
                    let tgt = c.get("target").and_then(|v| v.as_str()).unwrap_or("");
                    format!("{}: {}{}", ch, tgt, suffix)
                })
                .collect();
            json!({ "items": items, "channels": arr })
        }

        "review_policy" => {
            let mode = value
                .get("mode")
                .and_then(|v| v.as_str())
                .unwrap_or("never");
            let ctx = value.get("context").and_then(|v| v.as_str()).unwrap_or("");
            json!({
                "items": [format!("{}: {}{}", mode, ctx, suffix)],
                "policy": value.clone()
            })
        }

        "memory_policy" => {
            let enabled = value
                .get("enabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let ctx = value.get("context").and_then(|v| v.as_str()).unwrap_or("");
            json!({
                "items": [format!("enabled={}: {}{}", enabled, ctx, suffix)],
                "policy": value.clone()
            })
        }

        "event_subscriptions" => {
            let arr = value.as_array().cloned().unwrap_or_default();
            let mut subs_with_ucid = arr.clone();
            // Tag each subscription with its originating capability for
            // downstream tooling (persona_event_subscriptions.use_case_id).
            if !capability_id.is_empty() {
                for s in subs_with_ucid.iter_mut() {
                    if let Some(o) = s.as_object_mut() {
                        o.insert("use_case_id".to_string(), json!(capability_id));
                    }
                }
            }
            let items: Vec<String> = arr
                .iter()
                .map(|e| {
                    let typ = e.get("event_type").and_then(|v| v.as_str()).unwrap_or("");
                    let dir = e
                        .get("direction")
                        .and_then(|v| v.as_str())
                        .unwrap_or("subscribe");
                    format!("{}: {}{}", dir, typ, suffix)
                })
                .collect();
            json!({ "items": items, "subscriptions": subs_with_ucid })
        }

        "error_handling" => {
            let text = value.as_str().unwrap_or("").to_string();
            json!({ "items": [format!("{}{}", text, suffix)] })
        }

        "core_memories" => {
            let arr = value.as_array().cloned().unwrap_or_default();
            let items: Vec<String> = arr
                .iter()
                .map(|m| {
                    let t = m.get("title").and_then(|v| v.as_str()).unwrap_or("");
                    format!("{}{}", t, suffix)
                })
                .collect();
            json!({ "items": items, "memories": arr })
        }

        _ => json!({ "items": [], "value": value.clone() }),
    }
}

/// Convert a v3 capability_enumeration value into the legacy use-cases cell shape.
fn capabilities_to_legacy_use_cases(enu: &serde_json::Value) -> serde_json::Value {
    use serde_json::json;
    let caps = enu
        .get("capabilities")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let items: Vec<String> = caps
        .iter()
        .map(|c| {
            let title = c.get("title").and_then(|v| v.as_str()).unwrap_or("");
            let sum = c
                .get("capability_summary")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if sum.is_empty() {
                title.to_string()
            } else {
                format!("{title}: {sum}")
            }
        })
        .collect();
    let legacy_use_cases: Vec<serde_json::Value> = caps
        .iter()
        .map(|c| {
            let title = c.get("title").and_then(|v| v.as_str()).unwrap_or("");
            let sum = c
                .get("capability_summary")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let id = c.get("id").and_then(|v| v.as_str()).unwrap_or("");
            json!({
                "id": id,
                "title": title,
                "description": sum,
                "category": "other",
                "execution_mode": "e2e"
            })
        })
        .collect();
    json!({
        "items": items,
        "use_cases": legacy_use_cases
    })
}

/// Try to extract agent IR (the final JSON result) from accumulated output.
#[allow(dead_code)]
fn parse_agent_ir(output: &str) -> Option<String> {
    // Walk backwards through lines looking for the last complete JSON object
    for line in output.lines().rev() {
        let trimmed = line.trim();
        if trimmed.starts_with('{') && trimmed.ends_with('}') {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
                // Check if it looks like an agent IR (has typical fields)
                if let Some(obj) = val.as_object() {
                    if obj.contains_key("name")
                        || obj.contains_key("system_prompt")
                        || obj.contains_key("use_cases")
                        || obj.contains_key("result")
                    {
                        return Some(trimmed.to_string());
                    }
                }
            }
        }
    }
    None
}
