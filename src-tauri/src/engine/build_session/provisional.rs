//! Mid-turn release of finished results from the partial-message stream.
//!
//! The first build turn is ONE CLI call that runs 50-155 s, and its output is
//! validated (capability gates, `runner.rs` gate pass) only after the turn
//! ends. The runner already asks the CLI for `--include-partial-messages`, so
//! the model's text arrives as `content_block_delta` envelopes while it types.
//! This module turns that delta text back into complete top-level JSON
//! objects the moment each one closes, and classifies them:
//!
//! * `behavior_core` — released as the ordinary `BehaviorCoreUpdate` (+ its
//!   legacy mirror), exactly as the B2 early-core path always did, on every
//!   turn. Identity is not part of the gate state machine, so an early emit
//!   cannot contradict the validator.
//! * `capability_enumeration` / `capability_resolution` — released as
//!   PROVISIONAL events (`BuildEvent::Provisional*`), first turn only. They are
//!   a preview: the gate pass that runs after the turn stays the single
//!   authority, and `ProvisionalTurn::settle` closes the preview with an
//!   explicit retraction list once the authoritative events have gone out.
//! * everything else (questions, persona resolutions, agent_ir) is left to
//!   the post-turn parse. Questions are never streamed early.

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use crate::db::models::BuildEvent;

use super::parser::parse_json_object;

/// Pull the incremental text out of one CLI stream line, if it is a
/// `content_block_delta` inside a `stream_event` envelope. Returns None for every
/// other line type (system/assistant/result/etc.) — those go through the normal
/// post-turn parse. Thinking deltas carry `delta.thinking`, not `delta.text`,
/// so they are skipped too.
pub(super) fn stream_delta_text(line: &str) -> Option<String> {
    let v: Value = serde_json::from_str(line.trim()).ok()?;
    if v.get("type").and_then(|t| t.as_str())? != "stream_event" {
        return None;
    }
    let event = v.get("event")?;
    if event.get("type").and_then(|t| t.as_str())? != "content_block_delta" {
        return None;
    }
    let text = event.get("delta")?.get("text")?.as_str()?;
    if text.is_empty() {
        None
    } else {
        Some(text.to_string())
    }
}

// =============================================================================
// StreamObjectScanner — incremental, chunk-boundary-proof object splitter
// =============================================================================

/// Splits streamed model text into complete top-level JSON objects as soon as
/// each closing brace arrives, however the text was chunked.
///
/// It follows the same rules as the authoritative post-turn scan
/// (`parser::scan_json_objects`) so the preview never sees an object the
/// validator would not: an object only OPENS on a `{` that is the first
/// non-whitespace byte of a line (backticks count as whitespace, so a ```json
/// fence does not hide the object behind it), and a second object may follow
/// the first on the same line. Inside an object the depth counter is
/// string- and escape-aware, so `"curl {x}"` or `"a \"}\" b"` does not close
/// anything. State carries across `push` calls, so an object split at any
/// byte — mid-key, mid-escape, between `\` and `"` — still closes exactly
/// once. Work is O(total bytes): each byte is visited once.
///
/// A stray line-start `{` that never balances swallows the rest of the turn's
/// preview; the post-turn pass still reads everything, so the cost is a
/// preview that stops early, never a wrong build.
pub(super) struct StreamObjectScanner {
    cur: Vec<u8>,
    depth: usize,
    in_str: bool,
    esc: bool,
    at_line_start: bool,
}

impl Default for StreamObjectScanner {
    fn default() -> Self {
        Self {
            cur: Vec::new(),
            depth: 0,
            in_str: false,
            esc: false,
            // The stream starts at the beginning of a line.
            at_line_start: true,
        }
    }
}

impl StreamObjectScanner {
    /// Feed one delta chunk; returns every object that closed inside it, in
    /// order.
    pub(super) fn push(&mut self, chunk: &str) -> Vec<String> {
        let mut out = Vec::new();
        for &b in chunk.as_bytes() {
            if self.depth == 0 {
                match b {
                    b'{' if self.at_line_start => {
                        self.depth = 1;
                        self.in_str = false;
                        self.esc = false;
                        self.cur.clear();
                        self.cur.push(b);
                    }
                    b'\n' => self.at_line_start = true,
                    b'`' => {}
                    _ if b.is_ascii_whitespace() => {}
                    _ => self.at_line_start = false,
                }
                continue;
            }

            self.cur.push(b);
            if self.in_str {
                if self.esc {
                    self.esc = false;
                } else if b == b'\\' {
                    self.esc = true;
                } else if b == b'"' {
                    self.in_str = false;
                }
                continue;
            }
            match b {
                b'"' => self.in_str = true,
                b'{' => self.depth += 1,
                b'}' => {
                    self.depth -= 1;
                    if self.depth == 0 {
                        // Every delimiter the scan keys on is ASCII, and each
                        // chunk is a whole `&str`, so the object's bytes are
                        // whole UTF-8; lossy is a belt, never a brace.
                        out.push(String::from_utf8_lossy(&self.cur).into_owned());
                        self.cur.clear();
                        // Mirrors scan_json_objects, which resumes right after
                        // an object and may find another on the same line.
                        self.at_line_start = true;
                    }
                }
                _ => {}
            }
        }
        out
    }
}

// =============================================================================
// ProvisionalTurn — classification, de-duplication and settlement
// =============================================================================

/// One finished result lifted out of the stream, not yet emitted.
#[derive(Debug, Clone)]
pub(super) enum StreamItem {
    /// The `behavior_core` events, shaped exactly as the post-turn parse makes
    /// them (typed + legacy mirror). Released as-is, never provisional.
    BehaviorCore(Vec<BuildEvent>),
    /// A `capability_enumeration` payload (the value under the key).
    Enumeration(Value),
    /// One `capability_resolution` whose status is `resolved`.
    Resolution {
        capability_id: String,
        field: String,
        value: Value,
    },
}

impl StreamItem {
    /// The provisional wire event for a capability item. `None` for
    /// `BehaviorCore`, which carries its own authoritative events.
    pub(super) fn provisional_event(&self, session_id: &str) -> Option<BuildEvent> {
        match self {
            StreamItem::BehaviorCore(_) => None,
            StreamItem::Enumeration(data) => Some(BuildEvent::ProvisionalCapabilityEnumeration {
                session_id: session_id.to_string(),
                data: data.clone(),
            }),
            StreamItem::Resolution {
                capability_id,
                field,
                value,
            } => Some(BuildEvent::ProvisionalCapabilityResolution {
                session_id: session_id.to_string(),
                capability_id: capability_id.clone(),
                field: field.clone(),
                value: value.clone(),
            }),
        }
    }
}

/// Per-turn state for the mid-turn release.
pub(super) struct ProvisionalTurn {
    scanner: StreamObjectScanner,
    /// Capability items are only lifted on the first turn.
    capabilities: bool,
    core_seen: bool,
    seen_enumerations: Vec<Value>,
    seen_resolutions: HashMap<(String, String), Value>,
    /// What actually went out as provisional (the runner may withhold a seen
    /// item, e.g. a resolution a gate would suppress).
    emitted_enumerations: Vec<Value>,
    emitted_resolutions: HashMap<(String, String), Value>,
}

impl ProvisionalTurn {
    pub(super) fn new(capabilities: bool) -> Self {
        Self {
            scanner: StreamObjectScanner::default(),
            capabilities,
            core_seen: false,
            seen_enumerations: Vec::new(),
            seen_resolutions: HashMap::new(),
            emitted_enumerations: Vec::new(),
            emitted_resolutions: HashMap::new(),
        }
    }

    /// Feed one delta chunk; returns the items that finished inside it and
    /// have not been returned before this turn. An identical object repeated
    /// later in the stream is returned once; a resolution re-stated with a
    /// DIFFERENT value for the same (capability, field) is returned again, so
    /// the preview can follow the model's own correction.
    pub(super) fn push(&mut self, chunk: &str, session_id: &str) -> Vec<StreamItem> {
        let mut items = Vec::new();
        for text in self.scanner.push(chunk) {
            let Ok(val) = serde_json::from_str::<Value>(&text) else {
                continue; // malformed: the post-turn pass reports it
            };
            let Some(obj) = val.as_object() else { continue };

            if obj.contains_key("behavior_core") {
                if self.core_seen {
                    continue;
                }
                let events = parse_json_object(obj, &val, session_id);
                if events
                    .iter()
                    .any(|e| matches!(e, BuildEvent::BehaviorCoreUpdate { .. }))
                {
                    self.core_seen = true;
                    items.push(StreamItem::BehaviorCore(events));
                }
                continue;
            }
            if !self.capabilities {
                continue;
            }
            if let Some(enu) = obj.get("capability_enumeration") {
                if !self.seen_enumerations.contains(enu) {
                    self.seen_enumerations.push(enu.clone());
                    items.push(StreamItem::Enumeration(enu.clone()));
                }
                continue;
            }
            if obj.contains_key("capability_resolution") {
                // Reuse the authoritative parser so id/field/value extraction
                // cannot drift from what the validator will read.
                for ev in parse_json_object(obj, &val, session_id) {
                    let BuildEvent::CapabilityResolutionUpdate {
                        capability_id,
                        field,
                        value,
                        status,
                        ..
                    } = ev
                    else {
                        continue;
                    };
                    if capability_id.is_empty() || field.is_empty() || status != "resolved" {
                        continue;
                    }
                    let key = (capability_id.clone(), field.clone());
                    if self.seen_resolutions.get(&key) == Some(&value) {
                        continue;
                    }
                    self.seen_resolutions.insert(key, value.clone());
                    items.push(StreamItem::Resolution {
                        capability_id,
                        field,
                        value,
                    });
                }
            }
        }
        items
    }

    /// Record that `item` went out as a provisional event.
    pub(super) fn mark_emitted(&mut self, item: &StreamItem) {
        match item {
            StreamItem::BehaviorCore(_) => {}
            StreamItem::Enumeration(data) => self.emitted_enumerations.push(data.clone()),
            StreamItem::Resolution {
                capability_id,
                field,
                value,
            } => {
                self.emitted_resolutions
                    .insert((capability_id.clone(), field.clone()), value.clone());
            }
        }
    }

    /// Close the preview against the turn's validated events (the gate pass's
    /// `kept` list). `None` when nothing provisional was emitted this turn.
    ///
    /// The returned `ProvisionalSettled` lists every provisional capability id
    /// the authoritative enumeration does not carry, and every provisional
    /// (capability, field) whose authoritative resolution is missing or
    /// carries a different value. The frontend drops ALL provisional state on
    /// it regardless; the lists make the retraction explicit.
    pub(super) fn settle(&self, session_id: &str, validated: &[BuildEvent]) -> Option<BuildEvent> {
        if self.emitted_enumerations.is_empty() && self.emitted_resolutions.is_empty() {
            return None;
        }

        let mut confirmed_ids: HashSet<&str> = HashSet::new();
        let mut confirmed_res: HashMap<(&str, &str), &Value> = HashMap::new();
        for ev in validated {
            match ev {
                BuildEvent::CapabilityEnumerationUpdate { data, .. } => {
                    confirmed_ids.extend(capability_ids(data));
                }
                BuildEvent::CapabilityResolutionUpdate {
                    capability_id,
                    field,
                    value,
                    ..
                } => {
                    // Last one wins, as it does in the frontend store.
                    confirmed_res.insert((capability_id.as_str(), field.as_str()), value);
                }
                _ => {}
            }
        }

        let mut retracted_capability_ids: Vec<String> = Vec::new();
        for data in &self.emitted_enumerations {
            for id in capability_ids(data) {
                if !confirmed_ids.contains(id) && !retracted_capability_ids.iter().any(|r| r == id)
                {
                    retracted_capability_ids.push(id.to_string());
                }
            }
        }

        let mut retracted_resolutions: Vec<(String, String)> = self
            .emitted_resolutions
            .iter()
            .filter(|((cap, field), value)| {
                confirmed_res.get(&(cap.as_str(), field.as_str())) != Some(value)
            })
            .map(|(key, _)| key.clone())
            .collect();
        // HashMap order is arbitrary; keep the wire deterministic.
        retracted_resolutions.sort();

        Some(BuildEvent::ProvisionalSettled {
            session_id: session_id.to_string(),
            retracted_capability_ids,
            retracted_resolutions,
        })
    }
}

/// `data.capabilities[].id` of an enumeration payload.
fn capability_ids(data: &Value) -> impl Iterator<Item = &str> {
    data.get("capabilities")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .filter_map(|c| c.get("id").and_then(|v| v.as_str()))
}

// =============================================================================
// Tests
// =============================================================================
//
// Run with: npm run test:rust -- build_session::provisional

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const SID: &str = "sess-1";

    /// A realistic first-turn transcript: prose, a fenced behavior_core, a
    /// pretty-printed enumeration, compact resolutions (one with braces and an
    /// escaped quote inside a string), a question and agent_ir.
    fn transcript() -> String {
        [
            "I'll design this persona step by step.\n",
            "```json\n",
            "{\"behavior_core\": {\"mission\": \"Triage {urgent} mail\", \"identity\": {\"role\": \"Mail triager\"}}}\n",
            "```\n",
            "{\n  \"capability_enumeration\": {\n    \"capabilities\": [\n",
            "      {\"id\": \"uc_digest\", \"title\": \"Morning digest\"},\n",
            "      {\"id\": \"uc_alert\", \"title\": \"Urgent alert\"}\n    ]\n  }\n}\n",
            "{\"capability_resolution\": {\"id\": \"uc_digest\", \"field\": \"suggested_trigger\", \"value\": {\"trigger_type\": \"schedule\", \"config\": {\"cron\": \"0 7 * * *\"}, \"description\": \"Every day at 7 {local}\"}, \"status\": \"resolved\"}}\n",
            "{\"capability_resolution\": {\"id\": \"uc_digest\", \"field\": \"error_handling\", \"value\": \"Retry, then say \\\"}\\\" failed\", \"status\": \"resolved\"}}\n",
            "{\"capability_resolution\": {\"id\": \"uc_alert\", \"field\": \"connectors\", \"value\": [\"gmail\"], \"status\": \"pending\"}}\n",
            "{\"clarifying_question\": {\"scope\": \"field\", \"capability_id\": \"uc_alert\", \"field\": \"connectors\", \"question\": \"Which inbox?\"}}\n",
            "{\"agent_ir\": {\"name\": \"Mail triager\"}}\n",
        ]
        .concat()
    }

    fn kind(item: &StreamItem) -> String {
        match item {
            StreamItem::BehaviorCore(_) => "core".into(),
            StreamItem::Enumeration(_) => "enum".into(),
            StreamItem::Resolution {
                capability_id,
                field,
                ..
            } => format!("res:{capability_id}:{field}"),
        }
    }

    fn feed_in_chunks(turn: &mut ProvisionalTurn, text: &str, size: usize) -> Vec<StreamItem> {
        let chars: Vec<char> = text.chars().collect();
        let mut out = Vec::new();
        for piece in chars.chunks(size) {
            out.extend(turn.push(&piece.iter().collect::<String>(), SID));
        }
        out
    }

    const EXPECTED: [&str; 4] = [
        "core",
        "enum",
        "res:uc_digest:suggested_trigger",
        "res:uc_digest:error_handling",
    ];

    #[test]
    fn every_chunking_releases_the_same_items_once_in_order() {
        let text = transcript();
        // 1 = every char its own delta (splits every key, escape and brace).
        for size in [1, 2, 3, 7, 13, 64, text.len()] {
            let mut turn = ProvisionalTurn::new(true);
            let items = feed_in_chunks(&mut turn, &text, size);
            let kinds: Vec<String> = items.iter().map(kind).collect();
            assert_eq!(kinds, EXPECTED, "chunk size {size}");
        }
    }

    #[test]
    fn an_object_is_released_the_moment_its_brace_closes_not_before() {
        let mut turn = ProvisionalTurn::new(true);
        let head = "{\"capability_resolution\": {\"id\": \"uc_a\", \"field\": \"memory_policy\", \"value\": {\"enabled\": true}, \"status\": \"resolved\"}";
        assert!(turn.push(head, SID).is_empty(), "outer object still open");
        let items = turn.push("}\n", SID);
        assert_eq!(items.len(), 1);
        match &items[0] {
            StreamItem::Resolution {
                capability_id,
                field,
                value,
            } => {
                assert_eq!(capability_id, "uc_a");
                assert_eq!(field, "memory_policy");
                assert_eq!(value, &json!({"enabled": true}));
            }
            other => panic!("expected a resolution, got {other:?}"),
        }
    }

    #[test]
    fn braces_and_escaped_quotes_inside_strings_do_not_close_an_object() {
        let mut turn = ProvisionalTurn::new(true);
        // `"}` inside the string, split right between the backslash and the
        // quote it escapes.
        let items: Vec<StreamItem> = [
            "{\"capability_resolution\": {\"id\": \"uc_a\", \"field\": \"error_handling\", \"value\": \"say \\",
            "\"}\\\" and {x}\", \"status\": \"resolved\"}}\n",
        ]
        .iter()
        .flat_map(|c| turn.push(c, SID))
        .collect();
        assert_eq!(items.len(), 1);
        match &items[0] {
            StreamItem::Resolution { value, .. } => {
                assert_eq!(value, &json!("say \"}\" and {x}"));
            }
            other => panic!("expected a resolution, got {other:?}"),
        }
    }

    #[test]
    fn questions_persona_resolutions_and_agent_ir_are_never_released_early() {
        let mut turn = ProvisionalTurn::new(true);
        let items = turn.push(
            "{\"clarifying_question\": {\"scope\": \"mission\", \"question\": \"Who for?\"}}\n\
             {\"persona_resolution\": {\"field\": \"tools\", \"value\": [], \"status\": \"resolved\"}}\n\
             {\"agent_ir\": {\"name\": \"x\"}}\n",
            SID,
        );
        assert!(items.is_empty(), "{items:?}");
    }

    #[test]
    fn a_brace_mid_sentence_opens_nothing_just_like_the_post_turn_parser() {
        let mut turn = ProvisionalTurn::new(true);
        let items = turn.push(
            "Use {\"capability_resolution\": {\"id\": \"a\", \"field\": \"f\", \"value\": 1, \"status\": \"resolved\"}} later.\n",
            SID,
        );
        assert!(items.is_empty());
        // ...and the scanner is not left stuck: the next real object still lands.
        let items = turn.push(
            "{\"capability_enumeration\": {\"capabilities\": [{\"id\": \"uc_a\"}]}}\n",
            SID,
        );
        assert_eq!(items.len(), 1);
    }

    #[test]
    fn two_objects_on_one_line_are_both_released() {
        let mut turn = ProvisionalTurn::new(true);
        let items = turn.push(
            "{\"capability_enumeration\": {\"capabilities\": [{\"id\": \"uc_a\"}]}}{\"capability_resolution\": {\"id\": \"uc_a\", \"field\": \"tool_hints\", \"value\": [\"x\"], \"status\": \"resolved\"}}\n",
            SID,
        );
        let kinds: Vec<String> = items.iter().map(kind).collect();
        assert_eq!(kinds, vec!["enum", "res:uc_a:tool_hints"]);
    }

    #[test]
    fn a_repeated_identical_object_is_released_once_and_a_restated_value_again() {
        let res = |v: &str| {
            format!("{{\"capability_resolution\": {{\"id\": \"uc_a\", \"field\": \"tool_hints\", \"value\": [\"{v}\"], \"status\": \"resolved\"}}}}\n")
        };
        let mut turn = ProvisionalTurn::new(true);
        assert_eq!(turn.push(&res("x"), SID).len(), 1);
        assert!(turn.push(&res("x"), SID).is_empty(), "identical repeat");
        assert_eq!(
            turn.push(&res("y"), SID).len(),
            1,
            "the model corrected itself"
        );
        let enu = "{\"capability_enumeration\": {\"capabilities\": [{\"id\": \"uc_a\"}]}}\n";
        assert_eq!(turn.push(enu, SID).len(), 1);
        assert!(turn.push(enu, SID).is_empty());
    }

    #[test]
    fn later_turns_release_only_behavior_core() {
        let mut turn = ProvisionalTurn::new(false);
        let items = feed_in_chunks(&mut turn, &transcript(), 5);
        let kinds: Vec<String> = items.iter().map(kind).collect();
        assert_eq!(kinds, vec!["core"]);
        assert!(turn.settle(SID, &[]).is_none());
    }

    #[test]
    fn behavior_core_items_carry_the_same_events_as_the_post_turn_parse() {
        let mut turn = ProvisionalTurn::new(true);
        let items = turn.push("{\"behavior_core\": {\"mission\": \"m\"}}\n", SID);
        let StreamItem::BehaviorCore(events) = &items[0] else {
            panic!("expected core")
        };
        assert!(matches!(events[0], BuildEvent::BehaviorCoreUpdate { .. }));
        assert!(
            matches!(&events[1], BuildEvent::CellUpdate { cell_key, .. } if cell_key == "behavior_core")
        );
        assert!(items[0].provisional_event(SID).is_none());
    }

    #[test]
    fn nothing_emitted_means_nothing_to_settle() {
        let mut turn = ProvisionalTurn::new(true);
        // Seen but withheld by the runner (e.g. a gate would suppress it).
        let _ = turn.push(
            "{\"capability_resolution\": {\"id\": \"a\", \"field\": \"connectors\", \"value\": [], \"status\": \"resolved\"}}\n",
            SID,
        );
        assert!(turn.settle(SID, &[]).is_none());
    }

    #[test]
    fn settle_retracts_what_the_validator_dropped_or_changed_and_nothing_it_confirmed() {
        let mut turn = ProvisionalTurn::new(true);
        let items = feed_in_chunks(&mut turn, &transcript(), 9);
        for item in &items {
            turn.mark_emitted(item);
        }

        // The validator's view: uc_alert was dropped from the enumeration,
        // the trigger survived unchanged, error_handling was re-emitted with a
        // different value.
        let validated = vec![
            BuildEvent::CapabilityEnumerationUpdate {
                session_id: SID.into(),
                data: json!({"capabilities": [{"id": "uc_digest", "title": "Morning digest"}]}),
                status: "resolved".into(),
            },
            BuildEvent::CapabilityResolutionUpdate {
                session_id: SID.into(),
                capability_id: "uc_digest".into(),
                field: "suggested_trigger".into(),
                value: json!({"trigger_type": "schedule", "config": {"cron": "0 7 * * *"}, "description": "Every day at 7 {local}"}),
                status: "resolved".into(),
                lane: None,
            },
            BuildEvent::CapabilityResolutionUpdate {
                session_id: SID.into(),
                capability_id: "uc_digest".into(),
                field: "error_handling".into(),
                value: json!("Retry twice"),
                status: "resolved".into(),
                lane: None,
            },
        ];
        let Some(BuildEvent::ProvisionalSettled {
            session_id,
            retracted_capability_ids,
            retracted_resolutions,
        }) = turn.settle(SID, &validated)
        else {
            panic!("expected a settle event")
        };
        assert_eq!(session_id, SID);
        assert_eq!(retracted_capability_ids, vec!["uc_alert".to_string()]);
        assert_eq!(
            retracted_resolutions,
            vec![("uc_digest".to_string(), "error_handling".to_string())]
        );
    }

    #[test]
    fn settle_retracts_a_resolution_the_gate_pass_suppressed_entirely() {
        let mut turn = ProvisionalTurn::new(true);
        let item = turn
            .push(
                "{\"capability_resolution\": {\"id\": \"uc_a\", \"field\": \"review_policy\", \"value\": {\"mode\": \"never\"}, \"status\": \"resolved\"}}\n",
                SID,
            )
            .remove(0);
        turn.mark_emitted(&item);
        let Some(BuildEvent::ProvisionalSettled {
            retracted_resolutions,
            retracted_capability_ids,
            ..
        }) = turn.settle(SID, &[])
        else {
            panic!("expected a settle event")
        };
        assert!(retracted_capability_ids.is_empty());
        assert_eq!(
            retracted_resolutions,
            vec![("uc_a".to_string(), "review_policy".to_string())]
        );
    }

    #[test]
    fn provisional_events_serialise_under_their_own_wire_tags() {
        let enu = StreamItem::Enumeration(json!({"capabilities": []}))
            .provisional_event(SID)
            .unwrap();
        assert_eq!(
            serde_json::to_value(&enu).unwrap()["type"],
            "provisional_capability_enumeration"
        );
        let res = StreamItem::Resolution {
            capability_id: "a".into(),
            field: "f".into(),
            value: json!(1),
        }
        .provisional_event(SID)
        .unwrap();
        let v = serde_json::to_value(&res).unwrap();
        assert_eq!(v["type"], "provisional_capability_resolution");
        assert_eq!(v["capability_id"], "a");
        let settled = BuildEvent::ProvisionalSettled {
            session_id: SID.into(),
            retracted_capability_ids: vec![],
            retracted_resolutions: vec![("a".into(), "f".into())],
        };
        let v = serde_json::to_value(&settled).unwrap();
        assert_eq!(v["type"], "provisional_settled");
        assert_eq!(v["retracted_resolutions"], json!([["a", "f"]]));
    }

    #[test]
    fn stream_delta_text_reads_only_text_deltas() {
        let delta = r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"{\"a\""}}}"#;
        assert_eq!(stream_delta_text(delta).as_deref(), Some("{\"a\""));
        let thinking = r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"hm"}}}"#;
        assert!(stream_delta_text(thinking).is_none());
        assert!(stream_delta_text(r#"{"type":"assistant","message":{}}"#).is_none());
    }
}
