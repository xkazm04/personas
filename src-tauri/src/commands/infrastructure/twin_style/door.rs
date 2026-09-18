//! The style studio's validation doors.
//!
//! Every LLM reply passes ONE door with path-addressed errors
//! (`candidates[1].dims.humor: 5 exceeds anchor 3 + 1`); the joined errors are
//! what the single repair retry is told. Inbound IPC payloads pass the same
//! caps, so a hand-crafted `twin_style_apply` call cannot write what the
//! materialize door would have refused.
//!
//! Coherence is split: the roll door enforces the full rule set (pair rules
//! plus at most 3 extremes); materialize and apply enforce range and the pair
//! rules only, because curated presets and channel shifts legitimately exceed
//! the extremes cap.

use std::collections::HashSet;

use serde::Deserialize;

use crate::db::models::{
    StyleCandidate, StyleChannelTarget, StyleToneDraft, TwinStyle, TwinStyleDims, TwinStylePins,
};

use super::sampler::{
    dims_array, dims_from, pins_array, style_coherence_errors, style_pair_errors, DIM_NAMES,
};

pub(crate) const CANDIDATE_COUNT: usize = 3;
pub(crate) const NAME_MAX: usize = 40;
pub(crate) const BLURB_MAX: usize = 160;
pub(crate) const SAMPLE_MAX: usize = 500;
pub(crate) const MAX_TARGETS: usize = 10;
pub(crate) const CHANNEL_MAX: usize = 64;
pub(crate) const VOICE_MAX: usize = 700;
pub(crate) const EXAMPLE_COUNT: usize = 3;
pub(crate) const EXAMPLE_MAX: usize = 400;
pub(crate) const CONSTRAINTS_MIN: usize = 3;
pub(crate) const CONSTRAINTS_MAX: usize = 6;
pub(crate) const CONSTRAINT_MAX: usize = 160;
pub(crate) const LENGTH_HINT_MAX: usize = 120;
pub(crate) const MAX_AVOID: usize = 64;
/// A chosen style's own text comes from the TS preset catalog or a rolled
/// candidate; these caps only bound what reaches the prompt and the row.
const STYLE_NAME_MAX: usize = 80;
const STYLE_BLURB_MAX: usize = 400;

pub(crate) fn join_errors(errors: &[String]) -> String {
    errors.join("; ")
}

fn char_len(s: &str) -> usize {
    s.chars().count()
}

fn text_errors(path: &str, value: &str, max: usize, errors: &mut Vec<String>) {
    let n = char_len(value.trim());
    if n == 0 {
        errors.push(format!("{path}: empty"));
    } else if n > max {
        errors.push(format!("{path}: {n} chars exceeds {max}"));
    }
}

/// The per-channel length guidance, derived here rather than asked of the
/// model: it is a pure function of the length dimension, and a model asked for
/// it drifts from the dimension it was given.
pub(crate) fn length_hint_for(length: u8) -> &'static str {
    match length {
        0 | 1 => "One line",
        2 => "One or two sentences",
        3 => "A short paragraph",
        4 => "Two or three short paragraphs",
        _ => "As long as the topic needs, structured",
    }
}

// ----------------------------------------------------------------------------
// Inbound payload validation (before any LLM call or write)
// ----------------------------------------------------------------------------

pub(crate) fn validate_roll_input(pins: &TwinStylePins, avoid: &[TwinStyleDims]) -> Vec<String> {
    let mut errors = super::sampler::pin_errors(pins);
    if avoid.len() > MAX_AVOID {
        errors.push(format!(
            "avoid: {} vectors exceeds {MAX_AVOID}",
            avoid.len()
        ));
    }
    errors
}

pub(crate) fn validate_style(style: &TwinStyle) -> Vec<String> {
    let mut errors = Vec::new();
    let preset_id = style
        .preset_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    match style.source.as_str() {
        "preset" if preset_id.is_none() => {
            errors.push("style.presetId: required when source is \"preset\"".to_string())
        }
        "rolled" if preset_id.is_some() => {
            errors.push("style.presetId: must be empty when source is \"rolled\"".to_string())
        }
        "preset" | "rolled" => {}
        other => errors.push(format!(
            "style.source: \"{other}\" is not \"preset\" or \"rolled\""
        )),
    }
    text_errors("style.name", &style.name, STYLE_NAME_MAX, &mut errors);
    if char_len(style.summary.trim()) > STYLE_BLURB_MAX {
        errors.push(format!("style.summary: exceeds {STYLE_BLURB_MAX} chars"));
    }
    if char_len(style.avoid.trim()) > STYLE_BLURB_MAX {
        errors.push(format!("style.avoid: exceeds {STYLE_BLURB_MAX} chars"));
    }
    errors.extend(
        style_pair_errors(&style.dims)
            .into_iter()
            .map(|e| format!("style.dims: {e}")),
    );
    errors
}

/// Shared by targets and apply tones: non-empty, capped, unique channels.
fn channel_errors<'a>(
    list: &str,
    channels: impl Iterator<Item = &'a str>,
    count: usize,
    errors: &mut Vec<String>,
) {
    if count == 0 {
        errors.push(format!("{list}: empty"));
    } else if count > MAX_TARGETS {
        errors.push(format!("{list}: {count} given, at most {MAX_TARGETS}"));
    }
    let mut seen = HashSet::new();
    for (i, channel) in channels.enumerate() {
        let path = format!("{list}[{i}].channel");
        text_errors(&path, channel, CHANNEL_MAX, errors);
        let key = channel.trim().to_ascii_lowercase();
        if !key.is_empty() && !seen.insert(key) {
            errors.push(format!("{path}: \"{}\" appears twice", channel.trim()));
        }
    }
}

pub(crate) fn validate_targets(targets: &[StyleChannelTarget]) -> Vec<String> {
    let mut errors = Vec::new();
    channel_errors(
        "targets",
        targets.iter().map(|t| t.channel.as_str()),
        targets.len(),
        &mut errors,
    );
    for (i, t) in targets.iter().enumerate() {
        errors.extend(
            style_pair_errors(&t.dims)
                .into_iter()
                .map(|e| format!("targets[{i}].dims: {e}")),
        );
    }
    errors
}

/// Tone text checks. `exact_counts` is the model door (exactly 3 examples,
/// 3-6 constraints); an applied draft may have been trimmed by the user in the
/// preview, so apply enforces only the upper bounds.
fn tone_text_errors(
    path: &str,
    voice: &str,
    examples: &[String],
    constraints: &[String],
    exact_counts: bool,
    errors: &mut Vec<String>,
) {
    text_errors(&format!("{path}.voiceDirectives"), voice, VOICE_MAX, errors);
    let wanted = if exact_counts { "exactly" } else { "at most" };
    if (exact_counts && examples.len() != EXAMPLE_COUNT) || examples.len() > EXAMPLE_COUNT {
        errors.push(format!(
            "{path}.examples: {} given, {wanted} {EXAMPLE_COUNT} required",
            examples.len()
        ));
    }
    for (j, ex) in examples.iter().enumerate() {
        text_errors(&format!("{path}.examples[{j}]"), ex, EXAMPLE_MAX, errors);
    }
    let n = constraints.len();
    if (exact_counts && n < CONSTRAINTS_MIN) || n > CONSTRAINTS_MAX {
        let range = if exact_counts {
            format!("{CONSTRAINTS_MIN}-{CONSTRAINTS_MAX}")
        } else {
            format!("at most {CONSTRAINTS_MAX}")
        };
        errors.push(format!("{path}.constraints: {n} given, {range} required"));
    }
    for (j, c) in constraints.iter().enumerate() {
        text_errors(
            &format!("{path}.constraints[{j}]"),
            c,
            CONSTRAINT_MAX,
            errors,
        );
    }
}

pub(crate) fn validate_apply_tones(tones: &[StyleToneDraft]) -> Vec<String> {
    let mut errors = Vec::new();
    channel_errors(
        "tones",
        tones.iter().map(|t| t.channel.as_str()),
        tones.len(),
        &mut errors,
    );
    for (i, t) in tones.iter().enumerate() {
        let path = format!("tones[{i}]");
        tone_text_errors(
            &path,
            &t.voice_directives,
            &t.examples,
            &t.constraints,
            false,
            &mut errors,
        );
        if char_len(t.length_hint.trim()) > LENGTH_HINT_MAX {
            errors.push(format!(
                "{path}.lengthHint: exceeds {LENGTH_HINT_MAX} chars"
            ));
        }
        errors.extend(
            style_pair_errors(&t.dims)
                .into_iter()
                .map(|e| format!("{path}.dims: {e}")),
        );
    }
    errors
}

// ----------------------------------------------------------------------------
// Roll door
// ----------------------------------------------------------------------------

/// Signed so an out-of-range value reaches the door as a named error instead
/// of a serde overflow message the repair prompt cannot act on.
#[derive(Deserialize)]
struct RawDims {
    formality: i64,
    warmth: i64,
    humor: i64,
    energy: i64,
    length: i64,
    directness: i64,
    expressiveness: i64,
    detail: i64,
}

impl RawDims {
    fn array(&self) -> [i64; 8] {
        [
            self.formality,
            self.warmth,
            self.humor,
            self.energy,
            self.length,
            self.directness,
            self.expressiveness,
            self.detail,
        ]
    }
}

#[derive(Deserialize)]
struct RawCandidate {
    #[serde(default)]
    name: String,
    #[serde(default)]
    summary: String,
    #[serde(default)]
    avoid: String,
    dims: RawDims,
    #[serde(default)]
    sample: String,
}

#[derive(Deserialize)]
struct RollReply {
    candidates: Vec<RawCandidate>,
}

/// Check one candidate's dims against its anchor and the pins. Returns the
/// validated dims only when every dimension passed.
fn candidate_dims(
    path: &str,
    raw: &RawDims,
    anchor: &TwinStyleDims,
    pins: &[Option<u8>; 8],
    errors: &mut Vec<String>,
) -> Option<TwinStyleDims> {
    let before = errors.len();
    let anchor = dims_array(anchor);
    let mut out = [0u8; 8];
    for (d, v) in raw.array().into_iter().enumerate() {
        let name = DIM_NAMES[d];
        let a = i64::from(anchor[d]);
        if !(1..=5).contains(&v) {
            errors.push(format!("{path}.dims.{name}: {v} outside 1-5"));
        } else if let Some(p) = pins[d] {
            if v != i64::from(p) {
                errors.push(format!("{path}.dims.{name}: {v} but pinned to {p}"));
            }
        } else if v > a + 1 {
            errors.push(format!("{path}.dims.{name}: {v} exceeds anchor {a} + 1"));
        } else if v < a - 1 {
            errors.push(format!("{path}.dims.{name}: {v} is below anchor {a} - 1"));
        }
        // In range here or already reported; the cast is only kept on success.
        out[d] = v.clamp(1, 5) as u8;
    }
    if errors.len() > before {
        return None;
    }
    let dims = dims_from(out);
    let incoherent = style_coherence_errors(&dims);
    if incoherent.is_empty() {
        Some(dims)
    } else {
        errors.extend(incoherent.into_iter().map(|e| format!("{path}.dims: {e}")));
        None
    }
}

/// The roll door. Candidate `i` must derive from anchor `i`.
pub(crate) fn roll_door(
    raw: &str,
    anchors: &[TwinStyleDims; 3],
    pins: &TwinStylePins,
) -> Result<Vec<StyleCandidate>, String> {
    let span = crate::companion::brain::oneshot::extract_json_span(raw, "style roll reply")
        .map_err(|e| e.to_string())?;
    let reply: RollReply = serde_json::from_str(span).map_err(|e| format!("invalid JSON: {e}"))?;

    let mut errors = Vec::new();
    if reply.candidates.len() != CANDIDATE_COUNT {
        errors.push(format!(
            "candidates: {} given, exactly {CANDIDATE_COUNT} required",
            reply.candidates.len()
        ));
    }
    let pin_slots = pins_array(pins);
    let mut out = Vec::with_capacity(CANDIDATE_COUNT);
    for (i, (c, anchor)) in reply.candidates.iter().zip(anchors).enumerate() {
        let path = format!("candidates[{i}]");
        text_errors(&format!("{path}.name"), &c.name, NAME_MAX, &mut errors);
        text_errors(
            &format!("{path}.summary"),
            &c.summary,
            BLURB_MAX,
            &mut errors,
        );
        text_errors(&format!("{path}.avoid"), &c.avoid, BLURB_MAX, &mut errors);
        text_errors(
            &format!("{path}.sample"),
            &c.sample,
            SAMPLE_MAX,
            &mut errors,
        );
        if let Some(dims) = candidate_dims(&path, &c.dims, anchor, &pin_slots, &mut errors) {
            out.push(StyleCandidate {
                // Ours, not the model's: the client keys selection by it.
                id: uuid::Uuid::new_v4().to_string(),
                name: c.name.trim().to_string(),
                summary: c.summary.trim().to_string(),
                avoid: c.avoid.trim().to_string(),
                dims,
                sample: c.sample.trim().to_string(),
            });
        }
    }
    if errors.is_empty() {
        Ok(out)
    } else {
        Err(join_errors(&errors))
    }
}

// ----------------------------------------------------------------------------
// Materialize door
// ----------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawTone {
    #[serde(default)]
    channel: String,
    #[serde(default)]
    voice_directives: String,
    #[serde(default)]
    examples: Vec<String>,
    #[serde(default)]
    constraints: Vec<String>,
}

#[derive(Deserialize)]
struct MaterializeReply {
    tones: Vec<RawTone>,
}

/// The materialize door. The reply's channel set must equal the requested set
/// exactly; drafts come back in the order of `targets`, carrying each target's
/// dims and the derived length hint.
pub(crate) fn materialize_door(
    raw: &str,
    targets: &[StyleChannelTarget],
) -> Result<Vec<StyleToneDraft>, String> {
    let span = crate::companion::brain::oneshot::extract_json_span(raw, "style materialize reply")
        .map_err(|e| e.to_string())?;
    let reply: MaterializeReply =
        serde_json::from_str(span).map_err(|e| format!("invalid JSON: {e}"))?;

    let mut errors = Vec::new();
    let mut matched: Vec<Option<&RawTone>> = vec![None; targets.len()];
    for (i, tone) in reply.tones.iter().enumerate() {
        let path = format!("tones[{i}]");
        let channel = tone.channel.trim();
        match targets
            .iter()
            .position(|t| t.channel.trim().eq_ignore_ascii_case(channel))
        {
            None => errors.push(format!("{path}.channel: \"{channel}\" was not requested")),
            Some(k) if matched[k].is_some() => {
                errors.push(format!("{path}.channel: \"{channel}\" appears twice"))
            }
            Some(k) => matched[k] = Some(tone),
        }
        tone_text_errors(
            &path,
            &tone.voice_directives,
            &tone.examples,
            &tone.constraints,
            true,
            &mut errors,
        );
    }
    for (t, m) in targets.iter().zip(&matched) {
        if m.is_none() {
            errors.push(format!("tones: channel \"{}\" missing", t.channel.trim()));
        }
    }
    if !errors.is_empty() {
        return Err(join_errors(&errors));
    }

    Ok(targets
        .iter()
        .zip(matched)
        .filter_map(|(t, m)| m.map(|tone| (t, tone)))
        .map(|(t, tone)| StyleToneDraft {
            channel: t.channel.trim().to_string(),
            voice_directives: tone.voice_directives.trim().to_string(),
            examples: tone.examples.iter().map(|s| s.trim().to_string()).collect(),
            constraints: tone
                .constraints
                .iter()
                .map(|s| s.trim().to_string())
                .collect(),
            length_hint: length_hint_for(t.dims.length).to_string(),
            dims: t.dims,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(a: [u8; 8]) -> TwinStyleDims {
        dims_from(a)
    }

    fn anchors() -> [TwinStyleDims; 3] {
        [
            d([3, 3, 3, 3, 3, 3, 3, 3]),
            d([2, 4, 3, 3, 2, 2, 3, 2]),
            d([4, 2, 2, 2, 4, 3, 2, 4]),
        ]
    }

    fn cand(name: &str, dims: [i64; 8]) -> String {
        format!(
            r#"{{"name":"{name}","summary":"Sounds calm.","avoid":"Never gushes.","dims":{{"formality":{},"warmth":{},"humor":{},"energy":{},"length":{},"directness":{},"expressiveness":{},"detail":{}}},"sample":"Sure, next week works."}}"#,
            dims[0], dims[1], dims[2], dims[3], dims[4], dims[5], dims[6], dims[7]
        )
    }

    fn roll_reply(c: &[String]) -> String {
        format!("```json\n{{\"candidates\":[{}]}}\n```", c.join(","))
    }

    fn valid_roll() -> Vec<String> {
        vec![
            cand("Quiet anchor", [3, 3, 3, 3, 3, 3, 3, 3]),
            cand("Warm brevity", [2, 4, 4, 3, 2, 2, 3, 2]),
            cand("Formal depth", [4, 2, 2, 2, 4, 3, 2, 5]),
        ]
    }

    #[test]
    fn roll_door_accepts_a_valid_reply_and_mints_ids() {
        let out = roll_door(
            &roll_reply(&valid_roll()),
            &anchors(),
            &TwinStylePins::default(),
        )
        .expect("valid");
        assert_eq!(out.len(), 3);
        assert_eq!(out[1].dims.humor, 4, "a +1 nudge is allowed");
        assert!(out.iter().all(|c| !c.id.is_empty()));
        assert_ne!(out[0].id, out[1].id);
    }

    #[test]
    fn roll_door_names_an_off_anchor_dimension() {
        let mut c = valid_roll();
        c[1] = cand("Warm brevity", [2, 4, 5, 3, 2, 2, 3, 2]);
        let err = roll_door(&roll_reply(&c), &anchors(), &TwinStylePins::default()).unwrap_err();
        assert!(
            err.contains("candidates[1].dims.humor: 5 exceeds anchor 3 + 1"),
            "{err}"
        );
        c[1] = cand("Warm brevity", [2, 4, 1, 3, 2, 2, 3, 2]);
        let err = roll_door(&roll_reply(&c), &anchors(), &TwinStylePins::default()).unwrap_err();
        assert!(
            err.contains("candidates[1].dims.humor: 1 is below anchor 3 - 1"),
            "{err}"
        );
    }

    #[test]
    fn roll_door_holds_pins_exactly() {
        let pins = TwinStylePins {
            formality: Some(3),
            ..TwinStylePins::default()
        };
        let pinned_anchors = [
            d([3, 3, 3, 3, 3, 3, 3, 3]),
            d([3, 4, 3, 3, 2, 2, 3, 2]),
            d([3, 2, 2, 2, 4, 3, 2, 4]),
        ];
        let c = vec![
            cand("One", [3, 3, 3, 3, 3, 3, 3, 3]),
            cand("Two", [2, 4, 3, 3, 2, 2, 3, 2]),
            cand("Three", [3, 2, 2, 2, 4, 3, 2, 4]),
        ];
        let err = roll_door(&roll_reply(&c), &pinned_anchors, &pins).unwrap_err();
        assert!(
            err.contains("candidates[1].dims.formality: 2 but pinned to 3"),
            "{err}"
        );
    }

    #[test]
    fn roll_door_rejects_an_incoherent_candidate() {
        let mut c = valid_roll();
        // Both nudges are within +1 of the all-3 anchor; together they break
        // the formal-and-expressive rule.
        c[0] = cand("Loud formal", [4, 3, 3, 3, 3, 3, 4, 3]);
        let err = roll_door(&roll_reply(&c), &anchors(), &TwinStylePins::default()).unwrap_err();
        assert!(
            err.contains("candidates[0].dims: formality 4 with expressiveness 4"),
            "{err}"
        );
    }

    #[test]
    fn roll_door_enforces_the_extremes_rule() {
        let extreme_anchors = [
            d([1, 1, 1, 2, 3, 3, 3, 3]),
            d([2, 4, 3, 3, 2, 2, 3, 2]),
            d([4, 2, 2, 2, 4, 3, 2, 4]),
        ];
        let mut c = valid_roll();
        c[0] = cand("Blunt minimal", [1, 1, 1, 1, 3, 3, 3, 3]);
        let err =
            roll_door(&roll_reply(&c), &extreme_anchors, &TwinStylePins::default()).unwrap_err();
        assert!(
            err.contains("candidates[0].dims: 4 dimensions at 1 or 5"),
            "{err}"
        );
    }

    #[test]
    fn materialize_and_apply_accept_a_preset_past_the_extremes_cap() {
        // Executive brief sits at 5 extremes by design; the voice channel
        // shift can add one more. Only the roll path caps extremes.
        let executive = d([4, 1, 1, 2, 1, 1, 1, 3]);
        let style = TwinStyle {
            source: "preset".into(),
            preset_id: Some("executive-brief".into()),
            name: "Executive brief".into(),
            summary: String::new(),
            avoid: String::new(),
            dims: executive,
        };
        assert!(
            validate_style(&style).is_empty(),
            "{:?}",
            validate_style(&style)
        );
        let targets = [StyleChannelTarget {
            channel: "voice".into(),
            dims: executive,
        }];
        assert!(validate_targets(&targets).is_empty());
        let draft = StyleToneDraft {
            channel: "voice".into(),
            voice_directives: "Lead with the answer.".into(),
            examples: vec!["Yes.".into()],
            constraints: vec!["Never pad.".into()],
            length_hint: "One line".into(),
            dims: executive,
        };
        assert!(validate_apply_tones(&[draft]).is_empty());
    }

    #[test]
    fn roll_door_rejects_the_wrong_count() {
        let c = valid_roll()[..2].to_vec();
        let err = roll_door(&roll_reply(&c), &anchors(), &TwinStylePins::default()).unwrap_err();
        assert!(
            err.contains("candidates: 2 given, exactly 3 required"),
            "{err}"
        );
    }

    #[test]
    fn roll_door_enforces_text_caps() {
        let mut c = valid_roll();
        c[2] = cand(&"N".repeat(41), [4, 2, 2, 2, 4, 3, 2, 4]);
        let err = roll_door(&roll_reply(&c), &anchors(), &TwinStylePins::default()).unwrap_err();
        assert!(
            err.contains("candidates[2].name: 41 chars exceeds 40"),
            "{err}"
        );
        c[2] = cand(" ", [4, 2, 2, 2, 4, 3, 2, 4]);
        let err = roll_door(&roll_reply(&c), &anchors(), &TwinStylePins::default()).unwrap_err();
        assert!(err.contains("candidates[2].name: empty"), "{err}");
    }

    #[test]
    fn roll_door_names_out_of_range_and_prose() {
        let mut c = valid_roll();
        c[0] = cand("Quiet anchor", [3, 3, 3, 3, 3, 3, 3, -2]);
        let err = roll_door(&roll_reply(&c), &anchors(), &TwinStylePins::default()).unwrap_err();
        assert!(
            err.contains("candidates[0].dims.detail: -2 outside 1-5"),
            "{err}"
        );
        assert!(roll_door(
            "Sure! Here are three.",
            &anchors(),
            &TwinStylePins::default()
        )
        .is_err());
    }

    fn target(channel: &str, length: u8) -> StyleChannelTarget {
        StyleChannelTarget {
            channel: channel.into(),
            dims: d([3, 3, 3, 3, length, 3, 3, 3]),
        }
    }

    fn tone_json(channel: &str, examples: usize, constraint_len: usize) -> String {
        let ex: Vec<String> = (0..examples).map(|i| format!("\"Example {i}\"")).collect();
        format!(
            r#"{{"channel":"{channel}","voiceDirectives":"Open with the name. Sign off with a dash.","examples":[{}],"constraints":["Always greet.","Never use emoji.","{}"]}}"#,
            ex.join(","),
            "N".repeat(constraint_len)
        )
    }

    fn mat_reply(t: &[String]) -> String {
        format!("{{\"tones\":[{}]}}", t.join(","))
    }

    #[test]
    fn materialize_door_accepts_valid_and_derives_length_hint() {
        let targets = vec![target("generic", 3), target("sms", 1)];
        let out = materialize_door(
            &mat_reply(&[tone_json("SMS", 3, 20), tone_json("generic", 3, 20)]),
            &targets,
        )
        .expect("valid");
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].channel, "generic", "drafts follow the target order");
        assert_eq!(out[0].length_hint, "A short paragraph");
        assert_eq!(out[1].channel, "sms", "the requested spelling wins");
        assert_eq!(out[1].length_hint, "One line");
        assert_eq!(out[1].dims, targets[1].dims);
        assert_eq!(out[0].examples.len(), 3);
    }

    #[test]
    fn materialize_door_rejects_missing_and_extra_channels() {
        let targets = vec![target("generic", 3), target("email", 4)];
        let err =
            materialize_door(&mat_reply(&[tone_json("generic", 3, 20)]), &targets).unwrap_err();
        assert!(err.contains("tones: channel \"email\" missing"), "{err}");

        let err = materialize_door(
            &mat_reply(&[
                tone_json("generic", 3, 20),
                tone_json("email", 3, 20),
                tone_json("discord", 3, 20),
            ]),
            &targets,
        )
        .unwrap_err();
        assert!(
            err.contains("tones[2].channel: \"discord\" was not requested"),
            "{err}"
        );
    }

    #[test]
    fn materialize_door_rejects_two_examples_and_over_cap() {
        let targets = vec![target("generic", 3)];
        let err =
            materialize_door(&mat_reply(&[tone_json("generic", 2, 20)]), &targets).unwrap_err();
        assert!(
            err.contains("tones[0].examples: 2 given, exactly 3 required"),
            "{err}"
        );
        let err =
            materialize_door(&mat_reply(&[tone_json("generic", 3, 161)]), &targets).unwrap_err();
        assert!(
            err.contains("tones[0].constraints[2]: 161 chars exceeds 160"),
            "{err}"
        );
    }

    #[test]
    fn length_hints_follow_the_length_dimension() {
        assert_eq!(length_hint_for(1), "One line");
        assert_eq!(length_hint_for(2), "One or two sentences");
        assert_eq!(length_hint_for(3), "A short paragraph");
        assert_eq!(length_hint_for(4), "Two or three short paragraphs");
        assert_eq!(length_hint_for(5), "As long as the topic needs, structured");
    }

    #[test]
    fn inbound_validation_rejects_bad_targets_style_and_apply_payloads() {
        assert!(validate_targets(&[]).iter().any(|e| e == "targets: empty"));
        let dup = validate_targets(&[target("slack", 2), target("Slack", 2)]);
        assert!(dup
            .iter()
            .any(|e| e.contains("targets[1].channel: \"Slack\" appears twice")));
        let many: Vec<StyleChannelTarget> = (0..11).map(|i| target(&format!("c{i}"), 2)).collect();
        assert!(validate_targets(&many)
            .iter()
            .any(|e| e.contains("at most 10")));
        let bad = StyleChannelTarget {
            channel: "email".into(),
            dims: d([5, 3, 5, 3, 3, 3, 3, 3]),
        };
        assert!(validate_targets(&[bad])
            .iter()
            .any(|e| e.starts_with("targets[0].dims:")));

        let mut style = TwinStyle {
            source: "preset".into(),
            preset_id: None,
            name: "Warm".into(),
            summary: String::new(),
            avoid: String::new(),
            dims: d([3, 3, 3, 3, 3, 3, 3, 3]),
        };
        assert!(validate_style(&style)
            .iter()
            .any(|e| e.starts_with("style.presetId")));
        style.source = "invented".into();
        assert!(validate_style(&style)
            .iter()
            .any(|e| e.starts_with("style.source")));
        style.source = "rolled".into();
        assert!(validate_style(&style).is_empty());

        let draft = StyleToneDraft {
            channel: "generic".into(),
            voice_directives: "V".repeat(701),
            examples: vec!["a".into(); 4],
            constraints: vec![],
            length_hint: "One line".into(),
            dims: d([3, 3, 3, 3, 1, 3, 3, 3]),
        };
        let errors = validate_apply_tones(&[draft]);
        assert!(errors
            .iter()
            .any(|e| e.contains("tones[0].voiceDirectives: 701 chars")));
        assert!(errors
            .iter()
            .any(|e| e.contains("tones[0].examples: 4 given")));
        assert!(
            !errors.iter().any(|e| e.contains("constraints")),
            "apply enforces caps, not the model's minimums: {errors:?}"
        );
    }
}
