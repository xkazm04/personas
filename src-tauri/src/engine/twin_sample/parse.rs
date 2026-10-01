//! The learn-from-sample reply door.
//!
//! The model answers ONE JSON object. The door finds it in the raw text,
//! parses it leniently on missing keys and strictly on the shape of what is
//! there, and re-imposes what code owns: the channel vocabulary, the text caps
//! the rest of the twin enforces (the style door's), the 1-5 range of every
//! style dimension. A door returns `Err(reason)` only when the reply is
//! unusable; the reason feeds the ONE repair retry (`call_with_repair`).
//!
//! What the door does NOT treat as unusable: a style vector that breaks the
//! pair rules (it is dropped with a warning, never stored), and more
//! constraints or facts than asked for (the first ones are kept).

use serde::Deserialize;

use crate::commands::infrastructure::twin_style::door::{
    CONSTRAINT_MAX, LENGTH_HINT_MAX, VOICE_MAX,
};
use crate::commands::infrastructure::twin_style::sampler::{
    dims_from, style_pair_errors, DIM_NAMES,
};
use crate::db::models::TwinStyleDims;
use crate::db::repos::twin_sample::NewFact;
use personas_core::utils::text::truncate_on_char_boundary;

/// The most rules one sample proposes.
pub(crate) const CONSTRAINTS_MAX: usize = 4;
/// The most self-facts one sample files as pending memories.
pub(crate) const FACTS_MAX: usize = 5;
/// The longest fact title, in characters.
pub(crate) const FACT_TITLE_MAX: usize = 120;
/// The longest fact sentence, in characters.
pub(crate) const FACT_CONTENT_MAX: usize = 500;
/// The longest `reason` kept, in bytes, cut on a character boundary. It is a
/// display line (the refusal row, a proposal card) that nothing parses, so the
/// cut loses nothing a reader relies on.
pub(crate) const REASON_MAX_BYTES: usize = 240;
/// The refusal reason when the model said "not their writing" and gave none.
pub(crate) const NOT_OWN_FALLBACK: &str = "it does not read as your own writing";

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawReply {
    own_writing: Option<bool>,
    channel: Option<String>,
    exemplar: Option<bool>,
    voice: Option<String>,
    constraints: Option<Vec<String>>,
    length: Option<String>,
    dims: Option<RawDims>,
    facts: Option<Vec<RawFact>>,
    reason: Option<String>,
}

/// Signed, and every key required, so an out-of-range or missing dimension
/// reaches the door as a named error instead of a serde overflow message the
/// repair prompt cannot act on.
#[derive(Debug, Deserialize)]
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

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct RawFact {
    title: Option<String>,
    content: Option<String>,
}

/// What the analysis learned from a sample the person wrote.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Learned {
    /// One of the allowed channel ids, as listed.
    pub channel: String,
    pub exemplar: bool,
    pub voice: Option<String>,
    pub constraints: Vec<String>,
    pub length: Option<String>,
    /// `None` when the model gave none, or gave a vector that breaks the pair
    /// rules (dropped with a warning).
    pub dims: Option<TwinStyleDims>,
    pub facts: Vec<NewFact>,
    pub reason: String,
}

/// The door's verdict on a usable reply.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum LearnReply {
    /// Not the person's own writing: refuse the sample with this reason.
    NotOwn {
        reason: String,
    },
    Own(Learned),
}

fn char_len(s: &str) -> usize {
    s.chars().count()
}

/// Trimmed, `None` when empty; an error when over `max` characters.
fn capped_text(
    path: &str,
    value: Option<String>,
    max: usize,
    errors: &mut Vec<String>,
) -> Option<String> {
    let value = value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())?;
    let n = char_len(&value);
    if n > max {
        errors.push(format!("{path}: {n} chars exceeds {max}"));
        return None;
    }
    Some(value)
}

fn reason_of(raw: Option<String>) -> String {
    let reason = raw.unwrap_or_default();
    truncate_on_char_boundary(reason.trim(), REASON_MAX_BYTES)
        .trim()
        .to_string()
}

/// Range-check the dims (an error per dimension outside 1-5), then drop a
/// vector that breaks the pair rules with a warning.
fn dims_of(raw: &RawDims, errors: &mut Vec<String>) -> Option<TwinStyleDims> {
    let before = errors.len();
    let mut out = [0u8; 8];
    for (d, v) in raw.array().into_iter().enumerate() {
        if !(1..=5).contains(&v) {
            errors.push(format!("dims.{}: {v} outside 1-5", DIM_NAMES[d]));
        }
        // In range here or already reported; the value is only kept on success.
        out[d] = v.clamp(1, 5) as u8;
    }
    if errors.len() > before {
        return None;
    }
    let dims = dims_from(out);
    let incoherent = style_pair_errors(&dims);
    if incoherent.is_empty() {
        Some(dims)
    } else {
        tracing::warn!(
            problems = %incoherent.join("; "),
            "twin sample: the learned style breaks the pair rules; dropped"
        );
        None
    }
}

/// The door. `channels` is the allowed channel vocabulary (lowercase ids);
/// `nonce` is the sample fence's marker, which a usable reply never repeats.
pub(crate) fn parse_reply(
    raw: &str,
    channels: &[String],
    nonce: &str,
) -> Result<LearnReply, String> {
    if !nonce.is_empty() && raw.contains(nonce) {
        return Err("the reply repeats the sample's fence marker; never copy the markers".into());
    }
    let span = crate::companion::brain::oneshot::extract_json_span(raw, "sample learn reply")
        .map_err(|e| e.to_string())?;
    let reply: RawReply = serde_json::from_str(span).map_err(|e| format!("invalid JSON: {e}"))?;

    let Some(own) = reply.own_writing else {
        return Err("ownWriting: missing (true or false)".into());
    };
    if !own {
        let reason = reason_of(reply.reason);
        return Ok(LearnReply::NotOwn {
            reason: if reason.is_empty() {
                NOT_OWN_FALLBACK.to_string()
            } else {
                reason
            },
        });
    }

    let mut errors = Vec::new();
    let channel = reply
        .channel
        .map(|c| c.trim().to_lowercase())
        .filter(|c| !c.is_empty());
    let channel = match channel {
        None => {
            errors.push("channel: missing".to_string());
            None
        }
        Some(c) if channels.contains(&c) => Some(c),
        Some(c) => {
            errors.push(format!(
                "channel: \"{c}\" is not one of: {}",
                channels.join(", ")
            ));
            None
        }
    };
    let voice = capped_text("voice", reply.voice, VOICE_MAX, &mut errors);
    let length = capped_text("length", reply.length, LENGTH_HINT_MAX, &mut errors);

    let mut constraints = Vec::new();
    for (i, c) in reply
        .constraints
        .unwrap_or_default()
        .into_iter()
        .enumerate()
    {
        if let Some(c) = capped_text(
            &format!("constraints[{i}]"),
            Some(c),
            CONSTRAINT_MAX,
            &mut errors,
        ) {
            constraints.push(c);
        }
    }
    constraints.truncate(CONSTRAINTS_MAX);

    let mut facts = Vec::new();
    for (i, f) in reply.facts.unwrap_or_default().into_iter().enumerate() {
        let title = capped_text(
            &format!("facts[{i}].title"),
            f.title,
            FACT_TITLE_MAX,
            &mut errors,
        );
        if let Some(content) = capped_text(
            &format!("facts[{i}].content"),
            f.content,
            FACT_CONTENT_MAX,
            &mut errors,
        ) {
            facts.push(NewFact { title, content });
        }
    }
    facts.truncate(FACTS_MAX);

    let dims = reply.dims.as_ref().and_then(|d| dims_of(d, &mut errors));

    if !errors.is_empty() {
        return Err(errors.join("; "));
    }
    let Some(channel) = channel else {
        return Err("channel: missing".into());
    };
    Ok(LearnReply::Own(Learned {
        channel,
        exemplar: reply.exemplar.unwrap_or(false),
        voice,
        constraints,
        length,
        dims,
        facts,
        reason: reason_of(reply.reason),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A realistic marker: 16 hex chars, like `prompt::nonce`.
    const NONCE: &str = "f00dfeedcafe0001";

    fn channels() -> Vec<String> {
        ["generic", "email", "slack"]
            .iter()
            .map(|s| s.to_string())
            .collect()
    }

    const FULL: &str = r#"Here you go:
{"ownWriting": true, "channel": "Email", "exemplar": true,
 "voice": "Open with the first name. Keep it to three sentences.",
 "constraints": ["Never use emoji."], "length": "Three short sentences",
 "dims": {"formality": 3, "warmth": 4, "humor": 2, "energy": 3, "length": 2,
          "directness": 2, "expressiveness": 1, "detail": 2},
 "facts": [{"title": "Thursday meetings", "content": "They keep Thursdays for meetings."}],
 "reason": "A short, warm email with a clear ask."}"#;

    #[test]
    fn a_full_reply_parses_with_the_channel_lowercased() {
        let Ok(LearnReply::Own(learned)) = parse_reply(FULL, &channels(), NONCE) else {
            panic!("expected Own");
        };
        assert_eq!(learned.channel, "email");
        assert!(learned.exemplar);
        assert_eq!(learned.constraints, vec!["Never use emoji."]);
        assert_eq!(learned.length.as_deref(), Some("Three short sentences"));
        assert_eq!(learned.dims.map(|d| d.warmth), Some(4));
        assert_eq!(learned.facts.len(), 1);
        assert_eq!(learned.reason, "A short, warm email with a clear ask.");
    }

    #[test]
    fn not_own_writing_is_a_refusal_with_the_models_reason() {
        let raw = r#"{"ownWriting": false, "reason": "It is a newsletter.", "channel": null}"#;
        assert_eq!(
            parse_reply(raw, &channels(), NONCE),
            Ok(LearnReply::NotOwn {
                reason: "It is a newsletter.".into()
            })
        );
        let bare = r#"{"ownWriting": false}"#;
        assert_eq!(
            parse_reply(bare, &channels(), NONCE),
            Ok(LearnReply::NotOwn {
                reason: NOT_OWN_FALLBACK.into()
            })
        );
    }

    #[test]
    fn the_door_names_what_is_unusable() {
        let missing = parse_reply(r#"{"channel": "email"}"#, &channels(), NONCE);
        assert!(
            matches!(&missing, Err(e) if e.contains("ownWriting")),
            "{missing:?}"
        );

        let bad_channel = parse_reply(
            r#"{"ownWriting": true, "channel": "fax"}"#,
            &channels(),
            NONCE,
        );
        assert!(
            matches!(&bad_channel, Err(e) if e.contains("\"fax\" is not one of")),
            "{bad_channel:?}"
        );

        let long_voice = format!(
            r#"{{"ownWriting": true, "channel": "email", "voice": "{}"}}"#,
            "v".repeat(VOICE_MAX + 1)
        );
        assert!(
            matches!(parse_reply(&long_voice, &channels(), NONCE), Err(e) if e.starts_with("voice:"))
        );

        let out_of_range = r#"{"ownWriting": true, "channel": "email", "dims": {"formality": 7, "warmth": 3,
            "humor": 3, "energy": 3, "length": 3, "directness": 3, "expressiveness": 3, "detail": 3}}"#;
        assert!(
            matches!(parse_reply(out_of_range, &channels(), NONCE), Err(e) if e.contains("dims.formality: 7"))
        );

        assert!(parse_reply("no json at all", &channels(), NONCE).is_err());
    }

    #[test]
    fn a_reply_that_repeats_the_fence_marker_is_unusable() {
        let raw = r#"{"ownWriting": true, "channel": "email", "voice": "say f00dfeedcafe0001"}"#;
        assert!(
            matches!(parse_reply(raw, &channels(), NONCE), Err(e) if e.contains("fence marker"))
        );
    }

    #[test]
    fn an_incoherent_style_is_dropped_not_fatal_and_extra_items_are_cut() {
        let raw = r#"{"ownWriting": true, "channel": "slack", "exemplar": null,
            "constraints": ["a", "b", "c", "d", "e", "f"],
            "dims": {"formality": 5, "warmth": 3, "humor": 3, "energy": 3, "length": 3,
                     "directness": 3, "expressiveness": 5, "detail": 3}}"#;
        let Ok(LearnReply::Own(learned)) = parse_reply(raw, &channels(), NONCE) else {
            panic!("expected Own");
        };
        assert_eq!(
            learned.dims, None,
            "formality 5 with expressiveness 5 is dropped"
        );
        assert_eq!(learned.constraints.len(), CONSTRAINTS_MAX);
        assert!(!learned.exemplar);
        assert_eq!(learned.voice, None);
    }
}
