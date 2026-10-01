//! The Twin Card as serde structs (`docs/standards/twin-card/1.0/SPEC.md`
//! sections 3-11). Field names are the schema's own.
//!
//! `identity`, `voice` and `knowledge` are the renderer's view types
//! (`engine::twin_prompt::card`): they already ARE those parts, field for
//! field, and a second copy would be a second place for the schema to drift.
//! This file adds the parts the renderer never reads (`training`,
//! `evidence`) and the envelope around them.
//!
//! Every number in a part is an integer (SPEC.md 9): coverage is per-mille,
//! readiness a percent, dims 1-5, everything else a count.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub(super) use crate::engine::twin_prompt::card::{
    CardChannel, CardExemplar, CardFact, CardIdentity, CardKnowledge, CardMemory, CardQualityRules,
    CardStyle, CardStyleOrigin, CardVoice, CardVoiceView,
};

/// `$schema` of every card this app writes (SPEC.md 2).
pub(super) const SCHEMA_ID: &str =
    "https://personas.app/schemas/twin-card/1.0/twin-card.schema.json";
pub(super) const SPEC: &str = "twin-card";
pub(super) const SPEC_VERSION: &str = "1.0";
/// The one major this app reads (SPEC.md 12).
pub(super) const SUPPORTED_MAJOR: &str = "1";
pub(super) const STYLE_SCALE: &str = "twin-card.style/1";
pub(super) const RENDERER: &str = "twin-card.render/1";
pub(super) const GENERATOR_NAME: &str = "Personas";

// Limits the schema states, mirrored so the producer can fit a twin INTO a
// card instead of writing one its own schema rejects. A test in `schema.rs`
// reads each back out of the vendored schema, so the two cannot drift.
pub(super) const NAME_MAX: usize = 200;
pub(super) const ROLE_MAX: usize = 300;
pub(super) const BIO_MAX: usize = 5000;
pub(super) const DIRECTIVES_MAX: usize = 4000;
pub(super) const LENGTH_HINT_MAX: usize = 200;
pub(super) const CONSTRAINT_MAX: usize = 500;
pub(super) const CONSTRAINTS_PER_CHANNEL: usize = 100;
pub(super) const EXEMPLAR_MAX: usize = 8000;
pub(super) const EXEMPLARS_PER_CHANNEL: usize = 200;
pub(super) const CHANNELS_MAX: usize = 50;
pub(super) const MEMORY_TITLE_MAX: usize = 300;
pub(super) const MEMORY_CONTENT_MAX: usize = 8000;
pub(super) const MEMORIES_MAX: usize = 5000;
pub(super) const FACT_CONTENT_MAX: usize = 2000;
pub(super) const FACTS_MAX: usize = 2000;
pub(super) const QA_MAX: usize = 5000;

/// One content section of a card (SPEC.md 3, "the parts"), in file order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum Part {
    Identity,
    Voice,
    Knowledge,
    Training,
    Evidence,
}

impl Part {
    pub(super) const ALL: [Part; 5] = [
        Part::Identity,
        Part::Voice,
        Part::Knowledge,
        Part::Training,
        Part::Evidence,
    ];

    /// The member name in the file (and in `integrity.parts`).
    pub(super) fn key(self) -> &'static str {
        match self {
            Part::Identity => "identity",
            Part::Voice => "voice",
            Part::Knowledge => "knowledge",
            Part::Training => "training",
            Part::Evidence => "evidence",
        }
    }

    /// The partition a person picks and reads it under: `identity` always
    /// travels with `voice` (SPEC.md 3), so the commands name the pair
    /// `voice` (`TwinCardExportOptions.partitions`).
    pub(super) fn partition(self) -> &'static str {
        match self {
            Part::Identity | Part::Voice => "voice",
            other => other.key(),
        }
    }

    /// Only the personal parts may be sealed (SPEC.md 11).
    pub(super) fn sealable(self) -> bool {
        matches!(self, Part::Knowledge | Part::Training)
    }
}

/// `training` (SPEC.md 7).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(super) struct CardTraining {
    pub goals: Vec<CardGoal>,
    /// Oldest first.
    pub qa: Vec<CardQa>,
    /// Best-supported first.
    pub observations: Vec<CardObservation>,
}

/// One `training.goals[]` entry.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(super) struct CardGoal {
    /// `identity` | `tone` | `channels` | `memories` | `training:<topic>`.
    pub slot: String,
    pub title: String,
    #[serde(default)]
    pub intent: Option<String>,
    pub criteria: Vec<String>,
    /// `open` | `covered` | `dropped`.
    pub state: String,
    pub coverage_permille: u32,
    pub answered: u32,
}

/// One `training.qa[]` entry: the person's answer, verbatim.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(super) struct CardQa {
    pub question: String,
    pub answer: String,
    /// `scene` | `opinion` | `reply_drill` | `fact` | `rule` | `preference`;
    /// `null` for an answer the legacy Training Studio recorded, which kept
    /// no kind.
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub slot: Option<String>,
    /// For a reply drill, the message answered.
    #[serde(default)]
    pub incoming: Option<String>,
    /// RFC 3339.
    pub answered_at: String,
}

/// One `training.observations[]` entry.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(super) struct CardObservation {
    pub text: String,
    /// How many answers support it.
    pub evidence: u32,
}

/// `evidence` (SPEC.md 8). Written, never imported: every field is derived
/// from the other parts or from the producer's own database.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub(super) struct CardEvidence {
    pub exemplars_per_channel: BTreeMap<String, u32>,
    pub coverage_permille: CoveragePermille,
    pub readiness_percent: Option<u32>,
    pub answers: u32,
    pub last_trained_at: Option<String>,
    pub renderer: String,
}

/// `evidence.coverage_permille`: each 0-1000, `null` when unmeasured.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub(super) struct CoveragePermille {
    pub identity: Option<u32>,
    pub voice: Option<u32>,
    pub knowledge: Option<u32>,
    pub training: Option<u32>,
}

/// `generator`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub(super) struct Generator {
    pub name: String,
    pub version: String,
}

/// `integrity` (SPEC.md 9).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub(super) struct Integrity {
    pub alg: String,
    pub canonicalization: String,
    /// Part key -> lowercase hex SHA-256 of its canonical plaintext.
    pub parts: BTreeMap<String, String>,
}

/// `signature` (SPEC.md 10). `public_key` and `value` are base64url.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(super) struct Signature {
    pub alg: String,
    pub key_id: String,
    pub public_key: String,
    pub value: String,
}

/// The file as this app writes it, members in SPEC.md 3 order. Parts are
/// already JSON (a sealed part is its `{ "sealed": ... }` object).
#[derive(Debug, Clone, Serialize)]
pub(super) struct CardEnvelope {
    #[serde(rename = "$schema")]
    pub schema: String,
    pub spec: String,
    pub spec_version: String,
    pub card_id: String,
    pub created_at: String,
    pub exported_at: String,
    pub generator: Generator,
    pub identity: Value,
    pub voice: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub knowledge: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub training: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence: Option<Value>,
    pub integrity: Integrity,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<Signature>,
}

/// `generator.version`: the app version plus, as semver build metadata, the
/// optional feature set it was compiled with (`+ml.p2p`, or `+lite` with
/// neither). The bare version names many materially different builds; the
/// feature set is also what decides whether this build could sign at all.
pub(super) fn generator_version() -> String {
    let features: Vec<&str> = [("ml", cfg!(feature = "ml")), ("p2p", cfg!(feature = "p2p"))]
        .into_iter()
        .filter_map(|(name, on)| on.then_some(name))
        .collect();
    let build = if features.is_empty() {
        "lite".to_string()
    } else {
        features.join(".")
    };
    format!("{}+{build}", env!("CARGO_PKG_VERSION"))
}

/// Characters, as JSON Schema's `maxLength` counts them (code points).
pub(super) fn char_len(text: &str) -> usize {
    text.chars().count()
}
