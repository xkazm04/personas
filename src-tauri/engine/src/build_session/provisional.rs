//! Mid-turn release of finished results from the partial-message stream.
//!
//! A build turn that does design work is ONE CLI call that runs 50-224 s, and
//! its output is validated (capability gates, `runner.rs` gate pass) only after
//! the turn ends. The runner asks the CLI for `--include-partial-messages` on
//! every interactive turn, so the model's text arrives as
//! `content_block_delta` envelopes while it types.
//! This module turns that delta text back into complete top-level JSON
//! objects the moment each one closes, and classifies them:
//!
//! * `behavior_core` — released as the ordinary `BehaviorCoreUpdate` (+ its
//!   legacy mirror), exactly as the B2 early-core path always did, on every
//!   turn. Identity is not part of the gate state machine, so an early emit
//!   cannot contradict the validator.
//! * `capability_enumeration` / `capability_resolution` — released as
//!   PROVISIONAL events (`BuildEvent::Provisional*`) on EVERY turn, scoped by
//!   [`PreviewScope`] to what is not yet confirmed. They are a preview: the
//!   gate pass that runs after the turn stays the single authority, and
//!   `ProvisionalTurn::settle` closes the preview with an explicit retraction
//!   list once the authoritative events have gone out.
//! * everything else (questions, persona resolutions, agent_ir) is left to
//!   the post-turn parse. Questions are never streamed early.
//!
//! Why every turn and not the first: on a vague intent the first turn only
//! asks a design-direction question (~18 s) and the real design work - the
//! enumeration and its resolutions - runs in the NEXT turn (~224 s, observed
//! 2026-09-26). A first-turn-only preview never showed anything there. Later
//! "wiring" turns that re-resolve capabilities after answers are previewed
//! too, but only for what is still unconfirmed: once a validated enumeration
//! has landed its preview is withheld, and a resolution whose cell is already
//! confirmed is withheld, so a preview can fill a gap but can never overwrite
//! or regress a confirmed value.

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use personas_db::models::BuildEvent;

use super::parser::{map_capability_field_to_legacy_dimension, parse_json_object};

/// Pull the incremental text out of one CLI stream line, if it is a
/// `content_block_delta` inside a `stream_event` envelope. Returns None for every
/// other line type (system/assistant/result/etc.) — those go through the normal
/// post-turn parse. Thinking deltas carry `delta.thinking`, not `delta.text`,
/// so they are skipped too.
pub fn stream_delta_text(line: &str) -> Option<String> {
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
pub struct StreamObjectScanner {
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
    pub fn push(&mut self, chunk: &str) -> Vec<String> {
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
pub enum StreamItem {
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
    pub fn provisional_event(&self, session_id: &str) -> Option<BuildEvent> {
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
                cell_key: map_capability_field_to_legacy_dimension(field).map(str::to_string),
            }),
        }
    }
}

/// What a turn's preview may release, decided from the session's CONFIRMED
/// state at the moment the turn starts.
///
/// A preview only ever fills what is not yet confirmed:
/// * the enumeration is previewed until a validated enumeration has landed
///   (its legacy `use-cases` mirror is in `resolved_cells`) - so the turn that
///   first produces the capability set is previewed whichever turn it is;
/// * a resolution is previewed unless the cell it lights is already confirmed.
///   A field with no cell (e.g. `tool_hints`) develops nothing but the task
///   frame and is always allowed.
#[derive(Debug, Clone, Default)]
pub struct PreviewScope {
    enumeration_confirmed: bool,
    confirmed_cells: HashSet<String>,
}

/// The legacy cell the validated enumeration writes (parser.rs mirror).
const ENUMERATION_CELL: &str = "use-cases";

impl PreviewScope {
    /// Scope for a turn that starts with these confirmed cells (the runner's
    /// `resolved_cells`, keyed by legacy cell key).
    pub fn from_confirmed<'a>(confirmed_cells: impl IntoIterator<Item = &'a String>) -> Self {
        let confirmed_cells: HashSet<String> = confirmed_cells.into_iter().cloned().collect();
        Self {
            enumeration_confirmed: confirmed_cells.contains(ENUMERATION_CELL),
            confirmed_cells,
        }
    }

    fn allows_enumeration(&self) -> bool {
        !self.enumeration_confirmed
    }

    fn allows_resolution(&self, field: &str) -> bool {
        !matches!(
            map_capability_field_to_legacy_dimension(field),
            Some(cell) if self.confirmed_cells.contains(cell)
        )
    }
}

/// Per-turn state for the mid-turn release.
pub struct ProvisionalTurn {
    scanner: StreamObjectScanner,
    /// What this turn's preview may release.
    scope: PreviewScope,
    core_seen: bool,
    seen_enumerations: Vec<Value>,
    seen_resolutions: HashMap<(String, String), Value>,
    /// What actually went out as provisional (the runner may withhold a seen
    /// item, e.g. a resolution a gate would suppress).
    emitted_enumerations: Vec<Value>,
    emitted_resolutions: HashMap<(String, String), Value>,
}

impl ProvisionalTurn {
    pub fn new(scope: PreviewScope) -> Self {
        Self {
            scanner: StreamObjectScanner::default(),
            scope,
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
    pub fn push(&mut self, chunk: &str, session_id: &str) -> Vec<StreamItem> {
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
            if let Some(enu) = obj.get("capability_enumeration") {
                if self.scope.allows_enumeration() && !self.seen_enumerations.contains(enu) {
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
                    if capability_id.is_empty()
                        || field.is_empty()
                        || status != "resolved"
                        || !self.scope.allows_resolution(&field)
                    {
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
    pub fn mark_emitted(&mut self, item: &StreamItem) {
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
    pub fn settle(&self, session_id: &str, validated: &[BuildEvent]) -> Option<BuildEvent> {
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
    use super::super::parser::parse_build_line;
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
            let mut turn = ProvisionalTurn::new(PreviewScope::default());
            let items = feed_in_chunks(&mut turn, &text, size);
            let kinds: Vec<String> = items.iter().map(kind).collect();
            assert_eq!(kinds, EXPECTED, "chunk size {size}");
        }
    }

    #[test]
    fn an_object_is_released_the_moment_its_brace_closes_not_before() {
        let mut turn = ProvisionalTurn::new(PreviewScope::default());
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
        let mut turn = ProvisionalTurn::new(PreviewScope::default());
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
        let mut turn = ProvisionalTurn::new(PreviewScope::default());
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
        let mut turn = ProvisionalTurn::new(PreviewScope::default());
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
        let mut turn = ProvisionalTurn::new(PreviewScope::default());
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
        let mut turn = ProvisionalTurn::new(PreviewScope::default());
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
    fn a_turn_after_the_validated_set_previews_only_unconfirmed_cells() {
        // The enumeration and the trigger are confirmed; error handling is not.
        let confirmed = ["use-cases".to_string(), "triggers".to_string()];
        let mut turn = ProvisionalTurn::new(PreviewScope::from_confirmed(&confirmed));
        let items = feed_in_chunks(&mut turn, &transcript(), 5);
        let kinds: Vec<String> = items.iter().map(kind).collect();
        assert_eq!(kinds, vec!["core", "res:uc_digest:error_handling"]);
    }

    #[test]
    fn a_confirmed_non_enumeration_cell_does_not_hold_back_the_enumeration() {
        // behavior_core confirmed on a question-only first turn: the
        // capability set has still never landed, so it is previewed.
        let confirmed = ["behavior_core".to_string()];
        let mut turn = ProvisionalTurn::new(PreviewScope::from_confirmed(&confirmed));
        let kinds: Vec<String> = feed_in_chunks(&mut turn, &transcript(), 5)
            .iter()
            .map(kind)
            .collect();
        assert_eq!(kinds, EXPECTED);
    }

    #[test]
    fn behavior_core_items_carry_the_same_events_as_the_post_turn_parse() {
        let mut turn = ProvisionalTurn::new(PreviewScope::default());
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
        let mut turn = ProvisionalTurn::new(PreviewScope::default());
        // Seen but withheld by the runner (e.g. a gate would suppress it).
        let _ = turn.push(
            "{\"capability_resolution\": {\"id\": \"a\", \"field\": \"connectors\", \"value\": [], \"status\": \"resolved\"}}\n",
            SID,
        );
        assert!(turn.settle(SID, &[]).is_none());
    }

    #[test]
    fn settle_retracts_what_the_validator_dropped_or_changed_and_nothing_it_confirmed() {
        let mut turn = ProvisionalTurn::new(PreviewScope::default());
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
        let mut turn = ProvisionalTurn::new(PreviewScope::default());
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
        // A field with no frame carries no cell key; a mapped one carries the
        // cell the authoritative pass lights, so the client never re-derives it.
        assert!(v["cell_key"].is_null());
        for (field, cell) in [
            ("suggested_trigger", "triggers"),
            ("connectors", "connectors"),
            ("notification_channels", "messages"),
            ("review_policy", "human-review"),
            ("memory_policy", "memory"),
            ("event_subscriptions", "events"),
            ("error_handling", "error-handling"),
            ("sample_output", "sample-output"),
        ] {
            let ev = StreamItem::Resolution {
                capability_id: "a".into(),
                field: field.into(),
                value: json!(1),
            }
            .provisional_event(SID)
            .unwrap();
            assert_eq!(
                serde_json::to_value(&ev).unwrap()["cell_key"],
                cell,
                "{field}"
            );
        }
        let settled = BuildEvent::ProvisionalSettled {
            session_id: SID.into(),
            retracted_capability_ids: vec![],
            retracted_resolutions: vec![("a".into(), "f".into())],
        };
        let v = serde_json::to_value(&settled).unwrap();
        assert_eq!(v["type"], "provisional_settled");
        assert_eq!(v["retracted_resolutions"], json!([["a", "f"]]));
    }

    /// Captured Claude CLI stream-json lines (a thinking block, then a text
    /// block, the assistant snapshot and the result), recorded from a real
    /// run by the stream-timing bench. Each JSONL row wraps one CLI line as
    /// `{"ms": .., "raw": "<the line>"}`. Real bytes, not an invented
    /// envelope: see docs/concepts/golden-paths/model-output-streaming.md §2.5.
    const CAPTURED_THINKING_THEN_TEXT: &str =
        include_str!("../../../../scripts/test/fixtures/stream-timing/thinking-then-text.jsonl");

    fn captured_lines() -> Vec<String> {
        CAPTURED_THINKING_THEN_TEXT
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|l| {
                let row: Value = serde_json::from_str(l).expect("fixture row is JSON");
                row["raw"]
                    .as_str()
                    .expect("fixture row has raw")
                    .to_string()
            })
            .collect()
    }

    #[test]
    fn stream_delta_text_reads_only_text_deltas() {
        let lines = captured_lines();
        let text: String = lines.iter().filter_map(|l| stream_delta_text(l)).collect();
        // Only the text block's deltas: not the thinking / signature deltas,
        // the message_start, the assistant snapshot, the stops or the result.
        assert_eq!(text, "A proxy typically times T");
        let released = lines
            .iter()
            .filter(|l| stream_delta_text(l).is_some())
            .count();
        assert_eq!(released, 3);
        assert!(
            lines.iter().any(|l| l.contains("\"thinking_delta\"")),
            "fixture carries thinking deltas"
        );
        assert!(
            lines
                .iter()
                .any(|l| l.starts_with("{\"type\":\"assistant\"")),
            "fixture carries an assistant line"
        );

        // A captured text delta whose text is JSON with an escaped quote and a
        // brace: the model text comes back decoded, exactly as the scanner
        // must see it.
        let mut delta: Value = lines
            .iter()
            .map(|l| serde_json::from_str::<Value>(l).unwrap())
            .find(|v| v["event"]["delta"]["type"] == "text_delta")
            .expect("a captured text delta");
        delta["event"]["delta"]["text"] = json!("{\"a\"");
        assert_eq!(
            stream_delta_text(&delta.to_string()).as_deref(),
            Some("{\"a\"")
        );
        // An empty text delta releases nothing.
        delta["event"]["delta"]["text"] = json!("");
        assert!(stream_delta_text(&delta.to_string()).is_none());
    }
    // -------------------------------------------------------------------------
    // Multi-turn sessions, driven through recorded CLI envelopes.
    // -------------------------------------------------------------------------

    /// A recorded `text_delta` envelope from the fixture, carrying `text`. The
    /// envelope bytes are the CLI's own; only the model text is ours.
    fn recorded_delta(text: &str) -> String {
        let mut delta: Value = captured_lines()
            .iter()
            .map(|l| serde_json::from_str::<Value>(l).unwrap())
            .find(|v| v["event"]["delta"]["type"] == "text_delta")
            .expect("a captured text delta");
        delta["event"]["delta"]["text"] = json!(text);
        delta.to_string()
    }

    /// One turn as the runner sees it: the recorded non-text lines (message
    /// start, thinking deltas, the assistant snapshot, the result) plus the
    /// model text chunked into recorded text-delta envelopes, each passed
    /// through `stream_delta_text` exactly as runner.rs does. Every released
    /// capability item is marked emitted (the runner's gate preview withholds
    /// nothing in these scripts).
    fn stream_turn(scope: PreviewScope, model_text: &str) -> (ProvisionalTurn, Vec<StreamItem>) {
        let mut turn = ProvisionalTurn::new(scope);
        let mut lines: Vec<String> = captured_lines()
            .into_iter()
            .filter(|l| stream_delta_text(l).is_none())
            .collect();
        let chars: Vec<char> = model_text.chars().collect();
        lines.extend(
            chars
                .chunks(11)
                .map(|c| recorded_delta(&c.iter().collect::<String>())),
        );
        let mut items = Vec::new();
        for line in &lines {
            if let Some(txt) = stream_delta_text(line) {
                for item in turn.push(&txt, SID) {
                    if item.provisional_event(SID).is_some() {
                        turn.mark_emitted(&item);
                    }
                    items.push(item);
                }
            }
        }
        (turn, items)
    }

    /// The validated events of a turn whose gate pass kept everything: the
    /// recorded `assistant` snapshot envelope carrying the whole model text,
    /// read by the authoritative post-turn parser (`parse_build_line`).
    fn validated(model_text: &str) -> Vec<BuildEvent> {
        let mut snapshot: Value = captured_lines()
            .iter()
            .map(|l| serde_json::from_str::<Value>(l).unwrap())
            .find(|v| v["type"] == "assistant" && v["message"]["content"][0]["type"] == "text")
            .expect("a captured assistant text snapshot");
        snapshot["message"]["content"][0]["text"] = json!(model_text);
        parse_build_line(&snapshot.to_string(), SID)
            .into_iter()
            .filter(|e| !matches!(e, BuildEvent::Progress { .. }))
            .collect()
    }

    /// Fold a turn's validated cell updates into the runner's confirmed map.
    fn confirm(resolved: &mut serde_json::Map<String, Value>, events: &[BuildEvent]) {
        for ev in events {
            if let BuildEvent::CellUpdate { cell_key, data, .. } = ev {
                if cell_key != "agent_ir" {
                    resolved.insert(cell_key.clone(), data.clone());
                }
            }
        }
    }

    #[test]
    fn the_design_turn_after_a_direction_question_is_previewed_and_settled() {
        let mut resolved = serde_json::Map::new();

        // Turn 1 (vague intent): the identity and ONE design-direction
        // question. No capability work, so nothing provisional and no settle.
        let t1 = concat!(
            "Before I design this I need one direction.\n",
            "{\"behavior_core\": {\"mission\": \"Keep an eye on my finances\"}}\n",
            "{\"clarifying_question\": {\"scope\": \"mission\", \"question\": \"Budgets or investments?\"}}\n",
        );
        let (turn1, items1) = stream_turn(PreviewScope::from_confirmed(resolved.keys()), t1);
        assert_eq!(items1.iter().map(kind).collect::<Vec<_>>(), vec!["core"]);
        let v1 = validated(t1);
        assert!(turn1.settle(SID, &v1).is_none());
        confirm(&mut resolved, &v1);
        assert!(resolved.contains_key("behavior_core"));

        // Turn 2 (after the answer, via --continue): the real design work.
        // The capability set has never landed, so it is previewed.
        let t2 = transcript();
        let (turn2, items2) = stream_turn(PreviewScope::from_confirmed(resolved.keys()), &t2);
        assert_eq!(items2.iter().map(kind).collect::<Vec<_>>(), EXPECTED);
        let wire: Vec<Value> = items2
            .iter()
            .filter_map(|i| i.provisional_event(SID))
            .map(|e| serde_json::to_value(&e).unwrap())
            .collect();
        assert_eq!(wire[0]["type"], "provisional_capability_enumeration");
        assert_eq!(wire[1]["cell_key"], "triggers");

        // The validator kept everything: the preview settles with nothing to
        // retract, after that turn's own validated events.
        let v2 = validated(&t2);
        let Some(BuildEvent::ProvisionalSettled {
            retracted_capability_ids,
            retracted_resolutions,
            ..
        }) = turn2.settle(SID, &v2)
        else {
            panic!("turn 2 previewed, so it must settle")
        };
        assert!(
            retracted_capability_ids.is_empty(),
            "{retracted_capability_ids:?}"
        );
        assert!(
            retracted_resolutions.is_empty(),
            "{retracted_resolutions:?}"
        );
        confirm(&mut resolved, &v2);
        assert!(resolved.contains_key("use-cases") && resolved.contains_key("triggers"));
    }

    #[test]
    fn a_wiring_turn_after_answers_never_regresses_a_confirmed_value() {
        // State after the design turn: set, trigger and error handling
        // confirmed; uc_alert's connectors were asked about.
        let resolved: Vec<String> = ["behavior_core", "use-cases", "triggers", "error-handling"]
            .iter()
            .map(|s| s.to_string())
            .collect();

        // Turn 3 re-states the set, restates the confirmed trigger with a
        // DIFFERENT value, and resolves the answered connectors + channels.
        let t3 = concat!(
            "Wiring the answers in.\n",
            "{\"capability_enumeration\": {\"capabilities\": [{\"id\": \"uc_digest\", \"title\": \"Morning digest\"}, {\"id\": \"uc_alert\", \"title\": \"Urgent alert\"}]}}\n",
            "{\"capability_resolution\": {\"id\": \"uc_digest\", \"field\": \"suggested_trigger\", \"value\": {\"trigger_type\": \"manual\"}, \"status\": \"resolved\"}}\n",
            "{\"capability_resolution\": {\"id\": \"uc_alert\", \"field\": \"connectors\", \"value\": [\"gmail\"], \"status\": \"resolved\"}}\n",
            "{\"capability_resolution\": {\"id\": \"uc_alert\", \"field\": \"notification_channels\", \"value\": [{\"channel\": \"slack\"}], \"status\": \"resolved\"}}\n",
        );
        let (turn3, items3) = stream_turn(PreviewScope::from_confirmed(&resolved), t3);
        assert_eq!(
            items3.iter().map(kind).collect::<Vec<_>>(),
            vec![
                "res:uc_alert:connectors",
                "res:uc_alert:notification_channels"
            ],
            "no enumeration and no confirmed trigger may be previewed again"
        );

        // Suppose the gate pass dropped the channels: only they are retracted.
        let v3: Vec<BuildEvent> = validated(t3)
            .into_iter()
            .filter(|e| {
                !matches!(e, BuildEvent::CapabilityResolutionUpdate { field, .. } if field == "notification_channels")
            })
            .collect();
        let Some(BuildEvent::ProvisionalSettled {
            retracted_capability_ids,
            retracted_resolutions,
            ..
        }) = turn3.settle(SID, &v3)
        else {
            panic!("turn 3 previewed, so it must settle")
        };
        assert!(retracted_capability_ids.is_empty());
        assert_eq!(
            retracted_resolutions,
            vec![("uc_alert".to_string(), "notification_channels".to_string())]
        );
    }
}
