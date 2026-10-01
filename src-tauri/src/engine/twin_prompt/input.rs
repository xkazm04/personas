//! The neutral view the twin prompt compiler renders from, and the database
//! door that builds it ([`TwinPromptInput::from_db`]). The Twin Card door is
//! in `card.rs`.
//!
//! The view carries data, not prose, and only the data the renderer reads.
//! Trimming, ordering and every limit live in `compile.rs`, so the two doors
//! produce the same block for the same twin by construction rather than by
//! keeping two normalisers in step.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::commands::infrastructure::twin_voice;
use crate::db::models::{
    TwinDistilledFact, TwinPendingMemory, TwinProfile, TwinStyle, TwinStyleDims, TwinTone,
};
use crate::db::repos::twin as twin_repo;
use crate::db::repos::twin_setup::{self as setup_repo, StepOrder};
use crate::db::DbPool;
use crate::error::AppError;

/// The channel a twin falls back to when the requested one has no voice
/// (`voice.default_channel` in a Twin Card).
pub const DEFAULT_CHANNEL: &str = "generic";

/// Recent training answers read as evidence of the person's own habits (the
/// dash and filler-opener allowances): the same window the setup deep pass
/// replays as its transcript.
const OWN_WORDS_ANSWERS: i64 = 30;

/// Which grammatical forms the person uses about themselves
/// (`identity.grammatical_gender`, SPEC.md 4). Only `Masculine` and
/// `Feminine` render a line; `Neutral` is kept so a card from another
/// producer still deserializes, and renders nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GrammaticalGender {
    Masculine,
    Feminine,
    Neutral,
}

impl GrammaticalGender {
    /// Read the `twin_profiles.pronouns` token: `male` / `he/him` is
    /// masculine, `female` / `she/her` is feminine.
    ///
    /// `neutral` (and `they/them`) reads as `None`, never `Neutral`. The
    /// forge stores `neutral` when no gender was picked, so the token cannot
    /// tell "unset" from "neutral", and telling an unset Czech twin to use
    /// neutral forms is wrong. A Twin Card export built on this therefore
    /// writes `grammatical_gender: null` for it. Anything else says nothing
    /// either.
    pub fn from_pronouns(raw: Option<&str>) -> Option<Self> {
        let token = raw?.trim().to_ascii_lowercase();
        match token.as_str() {
            "female" | "feminine" | "she" => Some(Self::Feminine),
            "male" | "masculine" | "he" => Some(Self::Masculine),
            // `she/` before `he/`: "she/her" does not start with "he/", but
            // the order keeps the intent obvious.
            t if t.starts_with("she/") => Some(Self::Feminine),
            t if t.starts_with("he/") => Some(Self::Masculine),
            _ => None,
        }
    }

    /// The adjective the identity section uses.
    pub fn word(self) -> &'static str {
        match self {
            Self::Masculine => "masculine",
            Self::Feminine => "feminine",
            Self::Neutral => "neutral",
        }
    }
}

/// Whether the quality rules tell the model to avoid clause dashes
/// (`voice.quality_rules.dash_policy`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DashPolicy {
    /// Join clauses with commas and full stops.
    Avoid,
    /// The person uses clause dashes themselves.
    Allow,
}

/// Who the twin is (`identity`).
#[derive(Debug, Clone, PartialEq)]
pub struct PromptIdentity {
    pub name: String,
    pub role: Option<String>,
    pub bio: Option<String>,
    /// BCP 47 tags, most used first. Empty when the person never said, so
    /// the block names no language rather than assuming English.
    pub languages: Vec<String>,
    pub grammatical_gender: Option<GrammaticalGender>,
}

/// The resolved channel's voice (one `voice.channels[]` entry).
#[derive(Debug, Clone, PartialEq)]
pub struct ChannelVoice {
    pub channel: String,
    pub directives: String,
    pub length_hint: Option<String>,
    /// The channel's style on the `twin-card.style/1` scale, when one was
    /// measured or chosen.
    pub style: Option<TwinStyleDims>,
    pub constraints: Vec<String>,
    /// Messages the person wrote on this channel, MOST RECENT FIRST.
    pub exemplars: Vec<String>,
}

/// Where a confirmed item came from: facts render before memories.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KnowledgeKind {
    /// A self-fact (`knowledge.facts[]`).
    Fact,
    /// An approved memory (`knowledge.memories[]`).
    Memory,
}

/// One confirmed thing about the person.
#[derive(Debug, Clone, PartialEq)]
pub struct PromptFact {
    pub kind: KnowledgeKind,
    pub content: String,
    /// 1 to 5.
    pub importance: u8,
    /// When a memory was observed. Facts carry none: a card has no timestamp
    /// for them, so their recency is the order they arrive in (the repo's
    /// importance-then-recency order, or the card's array order).
    pub observed_at: Option<DateTime<Utc>>,
}

/// `voice.quality_rules`, minus the profile name the renderer never reads.
#[derive(Debug, Clone, PartialEq)]
pub struct QualityRules {
    pub register: String,
    pub avoid_phrases: Vec<String>,
    pub filler_openers: Vec<String>,
    pub dash_policy: DashPolicy,
}

impl QualityRules {
    /// The app's own rules (`twin_voice`) with two per-person allowances
    /// decided by `own_words` (the person's exemplars and recent answers):
    /// clause dashes are allowed when they use them, and a filler opener
    /// they open their own messages with ("Thanks, ...") leaves the list.
    /// `FILLER_OPENERS` itself is untouched; the setup suggestion filter
    /// still uses all of it.
    ///
    /// A Twin Card export writes these fields as they stand, allowances
    /// applied, plus `card::PLAIN_VOICE_PROFILE`, so a consumer renders the
    /// same rules: take them from `TwinPromptInput::from_db(..).quality`.
    pub fn for_own_words(own_words: &[&str]) -> Self {
        let dash_policy = if twin_voice::uses_dashes(own_words.iter().copied()) {
            DashPolicy::Allow
        } else {
            DashPolicy::Avoid
        };
        Self {
            register: twin_voice::PLAIN_REGISTER.to_string(),
            avoid_phrases: twin_voice::MACHINE_WORDS
                .iter()
                .map(|w| w.to_string())
                .collect(),
            filler_openers: twin_voice::FILLER_OPENERS
                .iter()
                .filter(|opener| {
                    !own_words
                        .iter()
                        .any(|text| twin_voice::opens_with_word(text, opener))
                })
                .map(|w| w.to_string())
                .collect(),
            dash_policy,
        }
    }
}

/// Everything the core block is rendered from. Build it with
/// [`Self::from_db`] / [`Self::from_profile`] or from a card
/// (`TwinPromptInput::from_card`); render it with `compile_twin_core`.
#[derive(Debug, Clone, PartialEq)]
pub struct TwinPromptInput {
    pub identity: PromptIdentity,
    /// The person's own instructions for every draft
    /// (`training_directives` / `voice.standing_directions`).
    pub standing_directions: Option<String>,
    /// `None` when the twin has no voice on any channel yet.
    pub voice: Option<ChannelVoice>,
    pub knowledge: Vec<PromptFact>,
    pub quality: QualityRules,
}

impl TwinPromptInput {
    /// Build the view of `twin_id` for `channel` from the database.
    pub fn from_db(pool: &DbPool, twin_id: &str, channel: &str) -> Result<Self, AppError> {
        let profile = twin_repo::get_profile_by_id(pool, twin_id)?;
        Self::from_profile(pool, &profile, channel)
    }

    /// As [`Self::from_db`], for a caller that already holds the profile.
    pub fn from_profile(
        pool: &DbPool,
        profile: &TwinProfile,
        channel: &str,
    ) -> Result<Self, AppError> {
        let tones = twin_repo::list_tones(pool, &profile.id)?;
        let facts = twin_repo::list_distilled_facts(pool, &profile.id, None)?;
        let memories = twin_repo::list_pending_memories(pool, &profile.id, Some("approved"), None)?;
        let answered = setup_repo::list_steps(
            pool,
            &profile.id,
            &["answered"],
            StepOrder::Recent,
            OWN_WORDS_ANSWERS,
        )?;
        let answers: Vec<&str> = answered
            .iter()
            .filter_map(|s| s.answer.as_deref())
            .collect();
        Ok(Self::from_rows(
            profile, &tones, &facts, &memories, &answers, channel,
        ))
    }

    /// The pure half of [`Self::from_profile`]: the rows in, the view out.
    /// Facts about a contact are third-party data and never enter the view;
    /// only approved memories do.
    pub fn from_rows(
        profile: &TwinProfile,
        tones: &[TwinTone],
        facts: &[TwinDistilledFact],
        memories: &[TwinPendingMemory],
        answers: &[&str],
        channel: &str,
    ) -> Self {
        // The person's own words, on every channel: the evidence both quality
        // rule allowances are decided by.
        let exemplars: Vec<String> = tones
            .iter()
            .flat_map(|t| json_strings(t.examples_json.as_deref()))
            .collect();
        let own_words: Vec<&str> = exemplars
            .iter()
            .map(String::as_str)
            .chain(answers.iter().copied())
            .collect();

        let mut knowledge: Vec<PromptFact> = facts
            .iter()
            .filter(|f| is_self_fact(f))
            .map(|f| PromptFact {
                kind: KnowledgeKind::Fact,
                content: f.content.clone(),
                importance: level(f.importance),
                observed_at: None,
            })
            .collect();
        knowledge.extend(
            memories
                .iter()
                .filter(|m| m.status == "approved")
                .map(|m| PromptFact {
                    kind: KnowledgeKind::Memory,
                    content: m.content.clone(),
                    importance: level(m.importance),
                    observed_at: parse_time(&m.created_at),
                }),
        );

        Self {
            identity: PromptIdentity {
                name: profile.name.clone(),
                role: profile.role.clone(),
                bio: profile.bio.clone(),
                languages: profile_languages(profile.languages.as_deref()),
                grammatical_gender: GrammaticalGender::from_pronouns(profile.pronouns.as_deref()),
            },
            standing_directions: profile.training_directives.clone(),
            voice: resolve_channel(tones, |t| t.channel.as_str(), channel, DEFAULT_CHANNEL)
                .map(tone_voice),
            knowledge,
            quality: QualityRules::for_own_words(&own_words),
        }
    }
}

/// RENDERER.md "Channel resolution": the entry for `target`, else the entry
/// for `default`, else the first.
pub(crate) fn resolve_channel<'a, T>(
    items: &'a [T],
    channel_of: impl Fn(&T) -> &str,
    target: &str,
    default: &str,
) -> Option<&'a T> {
    let target = target.trim();
    items
        .iter()
        .find(|item| channel_of(item) == target)
        .or_else(|| items.iter().find(|item| channel_of(item) == default))
        .or_else(|| items.first())
}

/// One tone row as the renderer sees it.
fn tone_voice(tone: &TwinTone) -> ChannelVoice {
    let mut exemplars = json_strings(tone.examples_json.as_deref());
    // The append doors (setup offers, sample learning) write oldest first;
    // the view, like a Twin Card, is most recent first.
    exemplars.reverse();
    ChannelVoice {
        channel: tone.channel.clone(),
        directives: tone.voice_directives.clone(),
        length_hint: tone.length_hint.clone(),
        style: tone
            .style_json
            .as_deref()
            .and_then(|raw| serde_json::from_str::<TwinStyle>(raw).ok())
            .map(|style| style.dims),
        constraints: json_strings(tone.constraints_json.as_deref()),
        exemplars,
    }
}

/// The string items of a JSON-array column (`examples_json`,
/// `constraints_json`), trimmed, empty ones dropped, in stored order.
/// Anything that is not an array (hand-edited, legacy, garbage) yields
/// nothing rather than an error: the rest of the voice still carries the tone.
pub(crate) fn json_strings(raw: Option<&str>) -> Vec<String> {
    let Some(raw) = raw.map(str::trim).filter(|s| !s.is_empty()) else {
        return Vec::new();
    };
    match serde_json::from_str::<serde_json::Value>(raw) {
        Ok(serde_json::Value::Array(items)) => items
            .iter()
            .filter_map(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect(),
        _ => Vec::new(),
    }
}

/// The languages the person declared, without the English default the setup
/// guide falls back to: a twin that never said renders no language line.
pub(crate) fn profile_languages(raw: Option<&str>) -> Vec<String> {
    let Some(raw) = raw.map(str::trim).filter(|s| !s.is_empty()) else {
        return Vec::new();
    };
    // A JSON array of codes (`["cs","en"]`); anything else is read as a comma
    // list, as `twin_style::prompt::parse_languages` does.
    let listed: Vec<String> = serde_json::from_str::<Vec<String>>(raw)
        .unwrap_or_else(|_| raw.split(',').map(str::to_string).collect());
    let mut out: Vec<String> = Vec::new();
    for code in listed {
        let code = code.trim();
        if !code.is_empty() && !out.iter().any(|seen| seen.eq_ignore_ascii_case(code)) {
            out.push(code.to_string());
        }
    }
    out
}

/// A fact with no contact scope is about the person themselves.
fn is_self_fact(fact: &TwinDistilledFact) -> bool {
    !fact
        .contact_handle
        .as_deref()
        .is_some_and(|handle| !handle.trim().is_empty())
}

/// An importance clamped onto the card's 1-5 scale.
pub(crate) fn level(importance: i32) -> u8 {
    // INVARIANT: clamped to 1..=5, so the cast cannot truncate.
    importance.clamp(1, 5) as u8
}

/// An RFC 3339 timestamp, or `None` when it does not parse (it then sorts
/// after every dated item of the same importance).
pub(crate) fn parse_time(raw: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(raw.trim())
        .ok()
        .map(|t| t.with_timezone(&Utc))
}
