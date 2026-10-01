//! The Twin Card door: the parts of a Twin Card 1.0 the renderer reads, and
//! [`TwinPromptInput::from_card`].
//!
//! Field names are the schema's own (`docs/standards/twin-card/1.0/
//! twin-card.schema.json`), so a whole card deserializes straight into
//! [`CardVoiceView`]: every member it does not name (the envelope, `training`,
//! `evidence`, `integrity`, `signature`, `extensions`, a channel's
//! `provenance`) is ignored. The Twin Card package
//! (`commands/infrastructure/twin_card`) builds and applies the identity,
//! voice and knowledge parts through these same types, and renders a
//! Character Card V3's `system_prompt` through [`TwinPromptInput::from_card`]:
//! this is the one place a card turns into prompt input.

use serde::{Deserialize, Serialize};

use super::input::{
    level, parse_time, resolve_channel, ChannelVoice, DashPolicy, GrammaticalGender, KnowledgeKind,
    PromptFact, PromptIdentity, QualityRules, TwinPromptInput,
};
use crate::db::models::TwinStyleDims;

/// The profile name the app's own quality rules (`twin_voice`) travel under
/// in a card it writes (`voice.quality_rules.profile`, SPEC.md 5.2). The
/// renderer never reads it; a card writer does.
pub const PLAIN_VOICE_PROFILE: &str = "personas.plain-voice/1";

/// The renderer's slice of a Twin Card (SPEC.md 4-6).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CardVoiceView {
    pub identity: CardIdentity,
    pub voice: CardVoice,
    /// Absent renders no facts; so does a sealed part (unseal it first).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub knowledge: Option<CardKnowledgePart>,
}

/// `identity` (SPEC.md 4).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CardIdentity {
    pub name: String,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub bio: Option<String>,
    pub languages: Vec<String>,
    #[serde(default)]
    pub grammatical_gender: Option<GrammaticalGender>,
}

/// `voice` (SPEC.md 5).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CardVoice {
    /// `"twin-card.style/1"`.
    pub scale: String,
    pub default_channel: String,
    #[serde(default)]
    pub standing_directions: Option<String>,
    pub quality_rules: CardQualityRules,
    pub channels: Vec<CardChannel>,
}

/// `voice.quality_rules` (SPEC.md 5.2).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CardQualityRules {
    pub profile: String,
    pub register: String,
    pub avoid_phrases: Vec<String>,
    pub filler_openers: Vec<String>,
    pub dash_policy: DashPolicy,
}

/// One `voice.channels[]` entry (SPEC.md 5.3).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CardChannel {
    pub channel: String,
    #[serde(default)]
    pub style: Option<CardStyle>,
    pub directives: String,
    #[serde(default)]
    pub length_hint: Option<String>,
    pub constraints: Vec<String>,
    /// Most recent first.
    pub exemplars: Vec<CardExemplar>,
}

/// A channel's `style`: the eight dimensions and where they came from.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CardStyle {
    pub dims: TwinStyleDims,
    pub origin: CardStyleOrigin,
}

/// `style.origin`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CardStyleOrigin {
    /// `preset` | `rolled` | `learned` | `manual`.
    pub kind: String,
    #[serde(default)]
    pub preset_id: Option<String>,
}

/// One `exemplars[]` entry.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CardExemplar {
    pub text: String,
    /// `sample` | `training` | `manual` | `unknown`.
    #[serde(default)]
    pub source: Option<String>,
}

/// `knowledge`, open or sealed (SPEC.md 6 and 11).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum CardKnowledgePart {
    Open(CardKnowledge),
    /// `{ "sealed": { alg, kdf, iterations, salt, nonce, ciphertext } }`.
    Sealed {
        sealed: serde_json::Value,
    },
}

/// An unsealed `knowledge` part.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CardKnowledge {
    pub memories: Vec<CardMemory>,
    pub facts: Vec<CardFact>,
}

/// One `knowledge.memories[]` entry.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CardMemory {
    #[serde(default)]
    pub title: Option<String>,
    pub content: String,
    /// RFC 3339.
    pub observed_at: String,
    #[serde(default)]
    pub source: Option<String>,
    pub importance: u8,
}

/// One `knowledge.facts[]` entry.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CardFact {
    pub content: String,
    pub importance: u8,
}

impl TwinPromptInput {
    /// Build the view of a card for `channel` (resolved against the card's
    /// own `default_channel`). A sealed `knowledge` part contributes nothing.
    pub fn from_card(card: &CardVoiceView, channel: &str) -> Self {
        let id = &card.identity;
        let voice = &card.voice;
        let mut knowledge: Vec<PromptFact> = Vec::new();
        if let Some(CardKnowledgePart::Open(open)) = &card.knowledge {
            knowledge.extend(open.facts.iter().map(|f| PromptFact {
                kind: KnowledgeKind::Fact,
                content: f.content.clone(),
                importance: level(i32::from(f.importance)),
                observed_at: None,
            }));
            knowledge.extend(open.memories.iter().map(|m| PromptFact {
                kind: KnowledgeKind::Memory,
                content: m.content.clone(),
                importance: level(i32::from(m.importance)),
                observed_at: parse_time(&m.observed_at),
            }));
        }
        let rules = &voice.quality_rules;
        Self {
            identity: PromptIdentity {
                name: id.name.clone(),
                role: id.role.clone(),
                bio: id.bio.clone(),
                languages: id.languages.clone(),
                grammatical_gender: id.grammatical_gender,
            },
            standing_directions: voice.standing_directions.clone(),
            voice: resolve_channel(
                &voice.channels,
                |c| c.channel.as_str(),
                channel,
                &voice.default_channel,
            )
            .map(card_voice),
            knowledge,
            quality: QualityRules {
                register: rules.register.clone(),
                avoid_phrases: rules.avoid_phrases.clone(),
                filler_openers: rules.filler_openers.clone(),
                dash_policy: rules.dash_policy,
            },
        }
    }
}

/// One card channel as the renderer sees it.
fn card_voice(channel: &CardChannel) -> ChannelVoice {
    ChannelVoice {
        channel: channel.channel.clone(),
        directives: channel.directives.clone(),
        length_hint: channel.length_hint.clone(),
        style: channel.style.as_ref().map(|s| s.dims),
        constraints: channel.constraints.clone(),
        exemplars: channel.exemplars.iter().map(|e| e.text.clone()).collect(),
    }
}
