//! Card -> database, in ONE immediate transaction: the profile and the
//! channel voices here, the approved memories, self-facts and training
//! record in `apply_record.rs`. Either all of it lands or none does.
//!
//! The mapping is the inverse of `build.rs`, chosen so that exporting an
//! imported twin reproduces the card's identity, voice, knowledge and
//! training parts byte for byte: exemplars are stored oldest first (the
//! append doors' order), memories keep their observed time as `created_at`,
//! facts keep their order through decreasing stamps, answers keep their
//! seconds, and a legacy answer (no kind) goes back to being the training
//! communication it was exported from.
//!
//! What a card can say that this database cannot hold is dropped with a
//! warning, never approximated: a hand-set (`manual`) style, an exemplar's
//! source, a channel's provenance, a goal-less answer's slot.

use std::collections::HashSet;

use rusqlite::{Connection, TransactionBehavior};

use super::apply_record;
use super::types::{CardChannel, CardIdentity, CardKnowledge, CardStyle, CardTraining, CardVoice};
use crate::commands::infrastructure::twin_style::door::validate_style;
use crate::db::models::{TwinProfile, TwinStyle};
use crate::db::repos::twin::{self as twin_repo, NewTwinProfile, ToneField};
use crate::db::DbPool;
use crate::engine::twin_prompt::input::GrammaticalGender;
use crate::error::AppError;

/// What to do when a twin with the card's name exists.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Conflict {
    /// A new twin; its name gets a ` (2)`-style suffix when taken.
    Duplicate,
    /// Delete the existing twin (everything cascades), then import.
    Replace,
    /// Import nothing.
    Skip,
}

impl Conflict {
    pub(super) fn parse(raw: &str) -> Result<Self, AppError> {
        match raw {
            "duplicate" => Ok(Self::Duplicate),
            "replace" => Ok(Self::Replace),
            "skip" => Ok(Self::Skip),
            other => Err(AppError::Validation(format!(
                "\"{other}\" is not a conflict choice (duplicate, replace or skip)."
            ))),
        }
    }
}

/// The verified, typed parts an import applies. A part that failed its hash
/// check is already `None`.
#[derive(Debug, Clone)]
pub(super) struct ImportPlan {
    pub card_id: String,
    pub identity: CardIdentity,
    pub voice: Option<CardVoice>,
    pub knowledge: Option<CardKnowledge>,
    pub training: Option<CardTraining>,
}

/// What an import wrote.
#[derive(Debug, Clone, Default)]
pub(super) struct Applied {
    /// `""` when the conflict choice was `skip`.
    pub twin_id: String,
    /// The partitions applied.
    pub imported: Vec<String>,
    pub warnings: Vec<String>,
}

/// Apply `plan`. `is_active` is not taken from anywhere: the new twin is
/// active only when it replaces the active twin or is the first twin there
/// is (the rule `create_profile` follows), so an import never moves the
/// active twin.
pub(super) fn apply_card(
    pool: &DbPool,
    plan: &ImportPlan,
    conflict: Conflict,
) -> Result<Applied, AppError> {
    let mut warnings = Vec::new();
    let mut conn = pool.get()?;
    // Immediate: the name check decides the writes.
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let existing = twin_repo::list_profiles_on(&tx)?;
    let wanted = plan.identity.name.as_str();
    let clash = existing.iter().find(|p| same_name(&p.name, wanted));
    let mut is_active = existing.is_empty();
    let name = match (clash, conflict) {
        (None, _) => wanted.to_string(),
        (Some(twin), Conflict::Skip) => {
            return Ok(Applied {
                warnings: vec![format!(
                    "A twin named \"{}\" already exists, so the card was not imported.",
                    twin.name
                )],
                ..Applied::default()
            });
        }
        (Some(twin), Conflict::Replace) => {
            is_active = twin.is_active;
            twin_repo::delete_profile_on(&tx, &twin.id)?;
            wanted.to_string()
        }
        (Some(_), Conflict::Duplicate) => free_name(wanted, &existing),
    };

    let languages = (!plan.identity.languages.is_empty())
        .then(|| serde_json::to_string(&plan.identity.languages))
        .transpose()
        .map_err(|e| AppError::Internal(format!("twin card import: encode languages: {e}")))?;
    let profile = twin_repo::insert_profile_on(
        &tx,
        &NewTwinProfile {
            name: &name,
            bio: plan.identity.bio.as_deref(),
            role: plan.identity.role.as_deref(),
            languages: languages.as_deref(),
            pronouns: plan.identity.grammatical_gender.map(pronouns_token),
            training_directives: plan
                .voice
                .as_ref()
                .and_then(|v| v.standing_directions.as_deref()),
            is_active,
        },
    )?;

    let mut imported = Vec::new();
    if let Some(voice) = &plan.voice {
        apply_voice(&tx, &profile.id, voice, &mut warnings)?;
        imported.push("voice".to_string());
    }
    if let Some(knowledge) = &plan.knowledge {
        apply_record::apply_knowledge(&tx, &profile.id, knowledge, &plan.card_id, &mut warnings)?;
        imported.push("knowledge".to_string());
    }
    if let Some(training) = &plan.training {
        apply_record::apply_training(&tx, &profile.id, training, &mut warnings)?;
        imported.push("training".to_string());
    }
    tx.commit()?;
    Ok(Applied {
        twin_id: profile.id,
        imported,
        warnings,
    })
}

/// The import dialog's rule: equal after trimming, ignoring case.
fn same_name(a: &str, b: &str) -> bool {
    a.trim().to_lowercase() == b.trim().to_lowercase()
}

/// `name (2)`, `name (3)`, ... : the first no existing twin carries.
fn free_name(name: &str, existing: &[TwinProfile]) -> String {
    (2u32..)
        .map(|n| format!("{name} ({n})"))
        .find(|candidate| !existing.iter().any(|p| same_name(&p.name, candidate)))
        .unwrap_or_else(|| name.to_string())
}

/// The `twin_profiles.pronouns` token the forge writes for each form.
fn pronouns_token(gender: GrammaticalGender) -> &'static str {
    match gender {
        GrammaticalGender::Masculine => "male",
        GrammaticalGender::Feminine => "female",
        GrammaticalGender::Neutral => "neutral",
    }
}

fn apply_voice(
    conn: &Connection,
    twin_id: &str,
    voice: &CardVoice,
    warnings: &mut Vec<String>,
) -> Result<(), AppError> {
    let mut seen: HashSet<&str> = HashSet::new();
    let mut sources_dropped = false;
    for channel in &voice.channels {
        if !seen.insert(channel.channel.as_str()) {
            warnings.push(format!(
                "The card lists the {} voice twice; the first was kept.",
                channel.channel
            ));
            continue;
        }
        if is_empty_channel(channel) {
            // The placeholder a producer writes when no voice exists yet.
            continue;
        }
        sources_dropped |= channel
            .exemplars
            .iter()
            .any(|e| e.source.as_deref().is_some_and(|s| s != "unknown"));
        let style_json = channel
            .style
            .as_ref()
            .and_then(|style| stored_style(style, &channel.channel, warnings))
            .map(|style| serde_json::to_string(&style))
            .transpose()
            .map_err(|e| AppError::Internal(format!("twin card import: encode a style: {e}")))?;
        // Stored oldest first, the order the append doors write.
        let examples: Vec<&str> = channel
            .exemplars
            .iter()
            .rev()
            .map(|e| e.text.as_str())
            .collect();
        let fields: [(ToneField, Option<String>); 5] = [
            (ToneField::Directives, Some(channel.directives.clone())),
            (ToneField::Examples, json_list(&examples)?),
            (ToneField::Constraints, json_list(&channel.constraints)?),
            (ToneField::LengthHint, channel.length_hint.clone()),
            (ToneField::Style, style_json),
        ];
        for (field, value) in fields {
            twin_repo::set_tone_field_on(conn, twin_id, &channel.channel, field, value.as_deref())?;
        }
    }
    if sources_dropped {
        warnings.push(
            "Where each writing sample came from (sample, training, manual) is not kept; the samples themselves are."
                .to_string(),
        );
    }
    Ok(())
}

/// No directions, style, length, rules or samples.
fn is_empty_channel(channel: &CardChannel) -> bool {
    channel.directives.trim().is_empty()
        && channel.style.is_none()
        && channel.length_hint.is_none()
        && channel.constraints.is_empty()
        && channel.exemplars.is_empty()
}

/// A card style as the `style_json` a tone row stores, through the style
/// studio's own door. The card carries no name (that is localized UI copy):
/// a preset is named by its id, which the UI re-translates; a rolled style
/// is named for where it came from; a learned one has no name by contract.
fn stored_style(style: &CardStyle, channel: &str, warnings: &mut Vec<String>) -> Option<TwinStyle> {
    let kind = style.origin.kind.as_str();
    let name = match kind {
        "preset" => style.origin.preset_id.clone().unwrap_or_default(),
        "rolled" => "Twin Card".to_string(),
        "learned" => String::new(),
        _ => {
            warnings.push(format!(
                "The {channel} style is hand-set (\"{kind}\"), which Personas does not store; its directions, samples and rules were imported without it."
            ));
            return None;
        }
    };
    let stored = TwinStyle {
        source: kind.to_string(),
        preset_id: style.origin.preset_id.clone().filter(|_| kind == "preset"),
        name,
        summary: String::new(),
        avoid: String::new(),
        dims: style.dims,
    };
    let problems = validate_style(&stored);
    if problems.is_empty() {
        Some(stored)
    } else {
        warnings.push(format!(
            "The {channel} style settings were not imported: {}.",
            problems.join("; ")
        ));
        None
    }
}

/// A JSON array of strings, or `None` for an empty list (a hand-written row
/// stores NULL there; every reader treats the two the same).
fn json_list<S: AsRef<str>>(items: &[S]) -> Result<Option<String>, AppError> {
    if items.is_empty() {
        return Ok(None);
    }
    let texts: Vec<&str> = items.iter().map(AsRef::as_ref).collect();
    serde_json::to_string(&texts)
        .map(Some)
        .map_err(|e| AppError::Internal(format!("twin card import: encode a list: {e}")))
}
