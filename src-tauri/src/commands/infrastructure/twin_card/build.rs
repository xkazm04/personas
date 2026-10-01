//! Database -> card: the identity and voice parts (SPEC.md 4-5), and the
//! assembly of every part. Knowledge is in `build_knowledge.rs`, the
//! training record and the evidence block in `build_training.rs`.
//!
//! The mapping is the one the prompt compiler's test fixture pins
//! (`engine::twin_prompt::fixture::card_json`), so a card built here renders
//! the same core block as the database it came from: languages via
//! `profile_languages`, gender via `GrammaticalGender::from_pronouns`,
//! channels in `list_tones` order, exemplars newest first, memories with
//! `observed_at = created_at`, self-facts in `list_distilled_facts` order,
//! and the quality rules with the person's own allowances applied.
//!
//! Two departures, both because SPEC.md 1 forbids other people's data: a
//! fact scoped to a contact never enters, and neither does an approved memory
//! that was queued from a message with someone else (its title names them
//! and its body quotes them).
//!
//! Nothing here cuts a person's words to fit. A single field over its schema
//! limit fails the export with what to shorten; an item in a list (one
//! writing sample, one memory) over its limit is left out with a warning.

use super::build_knowledge;
use super::build_training::{self, TrainingRecord};
use super::stamp;
use super::types::{
    char_len, CardChannel, CardEvidence, CardExemplar, CardIdentity, CardKnowledge,
    CardQualityRules, CardStyle, CardStyleOrigin, CardTraining, CardVoice, BIO_MAX, CHANNELS_MAX,
    CONSTRAINTS_PER_CHANNEL, CONSTRAINT_MAX, DIRECTIVES_MAX, EXEMPLARS_PER_CHANNEL, EXEMPLAR_MAX,
    LENGTH_HINT_MAX, NAME_MAX, ROLE_MAX, STYLE_SCALE,
};
use crate::commands::infrastructure::twin_style::sampler::style_pair_errors;
use crate::db::models::{TwinProfile, TwinStyle, TwinTone};
use crate::db::repos::twin as twin_repo;
use crate::db::DbPool;
use crate::engine::twin_prompt::card::PLAIN_VOICE_PROFILE;
use crate::engine::twin_prompt::input::{json_strings, profile_languages, GrammaticalGender};
use crate::engine::twin_prompt::{TwinPromptInput, DEFAULT_CHANNEL};
use crate::error::AppError;

/// The optional parts an export asked for (`identity` and `voice` always).
#[derive(Debug, Clone, Copy, Default)]
pub(super) struct Want {
    pub knowledge: bool,
    pub training: bool,
    pub evidence: bool,
}

/// A twin as card parts, plus what the export should tell the person.
#[derive(Debug, Clone)]
pub(super) struct BuiltCard {
    pub card_id: String,
    /// When the twin was created (RFC 3339).
    pub created_at: Option<String>,
    pub identity: CardIdentity,
    pub voice: CardVoice,
    pub knowledge: Option<CardKnowledge>,
    pub training: Option<CardTraining>,
    pub evidence: Option<CardEvidence>,
    pub warnings: Vec<String>,
}

/// Build the parts of `twin_id`'s card. Reads only; third-party data never
/// leaves the database (see the module doc).
pub(super) fn build_card(pool: &DbPool, twin_id: &str, want: Want) -> Result<BuiltCard, AppError> {
    let profile = twin_repo::get_profile_by_id(pool, twin_id)?;
    let tones = twin_repo::list_tones(pool, twin_id)?;
    let mut warnings = Vec::new();

    let identity = identity_part(&profile, &mut warnings)?;
    let voice = voice_part(pool, &profile, &tones, &mut warnings)?;
    let knowledge = if want.knowledge {
        Some(build_knowledge::knowledge_part(
            pool,
            twin_id,
            &mut warnings,
        )?)
    } else {
        None
    };
    let record: Option<TrainingRecord> = if want.training || want.evidence {
        Some(build_training::read_record(pool, twin_id, &mut warnings)?)
    } else {
        None
    };
    let evidence = match (&record, want.evidence) {
        (Some(record), true) => Some(build_training::evidence_part(
            pool, &profile, &tones, &identity, &voice, record,
        )?),
        _ => None,
    };
    let training = record.filter(|_| want.training).map(|r| r.part);

    let created_at = stamp::to_card(&profile.created_at);
    if created_at.is_none() {
        warnings.push(
            "The twin's creation time could not be read; the card gives the export time instead."
                .into(),
        );
    }
    Ok(BuiltCard {
        card_id: card_id_for(twin_id),
        created_at,
        identity,
        voice,
        knowledge,
        training,
        evidence,
        warnings,
    })
}

/// SPEC.md 3 `card_id`: stable across re-exports of the same twin, without
/// putting the database id itself into a file that leaves the machine.
pub(super) fn card_id_for(twin_id: &str) -> String {
    uuid::Uuid::new_v5(
        &uuid::Uuid::NAMESPACE_URL,
        format!("urn:personas:twin-card:{twin_id}").as_bytes(),
    )
    .to_string()
}

fn identity_part(
    profile: &TwinProfile,
    warnings: &mut Vec<String>,
) -> Result<CardIdentity, AppError> {
    fits("The twin's name", &profile.name, NAME_MAX)?;
    if let Some(role) = &profile.role {
        fits("The role", role, ROLE_MAX)?;
    }
    if let Some(bio) = &profile.bio {
        fits("The bio", bio, BIO_MAX)?;
    }
    let mut languages = profile_languages(profile.languages.as_deref());
    let before = languages.len();
    languages.retain(|code| is_language_tag(code));
    if languages.len() < before {
        warnings.push(format!(
            "{} language entr{} that {} not a language code (like \"cs\" or \"en-GB\") {} left out.",
            before - languages.len(),
            if before - languages.len() == 1 { "y" } else { "ies" },
            if before - languages.len() == 1 { "is" } else { "are" },
            if before - languages.len() == 1 { "was" } else { "were" },
        ));
    }
    Ok(CardIdentity {
        name: profile.name.clone(),
        role: profile.role.clone(),
        bio: profile.bio.clone(),
        languages,
        grammatical_gender: GrammaticalGender::from_pronouns(profile.pronouns.as_deref()),
    })
}

fn voice_part(
    pool: &DbPool,
    profile: &TwinProfile,
    tones: &[TwinTone],
    warnings: &mut Vec<String>,
) -> Result<CardVoice, AppError> {
    if let Some(directions) = &profile.training_directives {
        fits("The standing directions", directions, DIRECTIVES_MAX)?;
    }
    // The app's register with THIS person's allowances (dashes, filler
    // openers they use themselves), decided by the compiler's own door.
    let rules = TwinPromptInput::from_profile(pool, profile, DEFAULT_CHANNEL)?.quality;
    let mut channels = Vec::new();
    for tone in tones {
        if let Some(channel) = channel_entry(tone, warnings)? {
            channels.push(channel);
        }
    }
    if channels.len() > CHANNELS_MAX {
        warnings.push(format!(
            "Only the first {CHANNELS_MAX} of {} channel voices fit in a card.",
            channels.len()
        ));
        channels.truncate(CHANNELS_MAX);
    }
    if channels.is_empty() {
        // A card needs one channel (SPEC.md 5). An empty `generic` entry says
        // "no voice recorded yet" without inventing one; an importer creates
        // no tone row for it.
        channels.push(CardChannel {
            channel: DEFAULT_CHANNEL.to_string(),
            style: None,
            directives: String::new(),
            length_hint: None,
            constraints: Vec::new(),
            exemplars: Vec::new(),
        });
    }
    Ok(CardVoice {
        scale: STYLE_SCALE.to_string(),
        default_channel: DEFAULT_CHANNEL.to_string(),
        standing_directions: profile.training_directives.clone(),
        quality_rules: CardQualityRules {
            profile: PLAIN_VOICE_PROFILE.to_string(),
            register: rules.register,
            avoid_phrases: rules.avoid_phrases,
            filler_openers: rules.filler_openers,
            dash_policy: rules.dash_policy,
        },
        channels,
    })
}

fn channel_entry(
    tone: &TwinTone,
    warnings: &mut Vec<String>,
) -> Result<Option<CardChannel>, AppError> {
    let channel = tone.channel.as_str();
    if !is_channel_id(channel) {
        warnings.push(format!(
            "The \"{channel}\" voice was left out: a card's channel id is a lowercase letter followed by up to 39 lowercase letters, digits, - or _."
        ));
        return Ok(None);
    }
    fits(
        &format!("The {channel} voice directions"),
        &tone.voice_directives,
        DIRECTIVES_MAX,
    )?;
    if let Some(hint) = &tone.length_hint {
        fits(&format!("The {channel} length hint"), hint, LENGTH_HINT_MAX)?;
    }
    let mut exemplars = json_strings(tone.examples_json.as_deref());
    // The append doors write oldest first; a card is newest first.
    exemplars.reverse();
    let exemplars = fit_list(
        exemplars,
        EXEMPLAR_MAX,
        EXEMPLARS_PER_CHANNEL,
        &format!("{channel} writing sample"),
        warnings,
    );
    let constraints = fit_list(
        json_strings(tone.constraints_json.as_deref()),
        CONSTRAINT_MAX,
        CONSTRAINTS_PER_CHANNEL,
        &format!("{channel} do-and-don't rule"),
        warnings,
    );
    Ok(Some(CardChannel {
        channel: channel.to_string(),
        style: tone
            .style_json
            .as_deref()
            .and_then(|raw| style_entry(raw, channel, warnings)),
        directives: tone.voice_directives.clone(),
        length_hint: tone.length_hint.clone(),
        constraints,
        exemplars: exemplars
            .into_iter()
            .map(|text| CardExemplar {
                text,
                // `examples_json` keeps the text only; where each came from
                // is not recorded, and a card never guesses.
                source: Some("unknown".to_string()),
            })
            .collect(),
    }))
}

/// A stored style as a card style. A row that does not parse is a
/// hand-written tone (the compiler reads it the same way); a parsed style
/// the scale's coherence rules reject is left out with a warning rather than
/// written into a card that would break SPEC.md 5.1.
fn style_entry(raw: &str, channel: &str, warnings: &mut Vec<String>) -> Option<CardStyle> {
    let style = serde_json::from_str::<TwinStyle>(raw).ok()?;
    let known = matches!(style.source.as_str(), "preset" | "rolled" | "learned");
    let problems = style_pair_errors(&style.dims);
    if !known || !problems.is_empty() {
        warnings.push(format!(
            "The {channel} style settings were left out: {}.",
            if known {
                problems.join("; ")
            } else {
                format!("\"{}\" is not a style origin a card knows", style.source)
            }
        ));
        return None;
    }
    Some(CardStyle {
        dims: style.dims,
        origin: CardStyleOrigin {
            kind: style.source,
            preset_id: style.preset_id,
        },
    })
}

/// A single field over its schema limit fails the export: the person
/// shortens it, the card never cuts it.
fn fits(what: &str, value: &str, max: usize) -> Result<(), AppError> {
    let n = char_len(value);
    if n > max {
        return Err(AppError::Validation(format!(
            "{what} is {n} characters; a Twin Card holds at most {max}. Shorten it and export again."
        )));
    }
    Ok(())
}

/// A list's items over `max_chars` are left out, then the list is capped at
/// `max_items` (keeping its head: newest samples, first rules), each with a
/// warning naming how many.
fn fit_list(
    items: Vec<String>,
    max_chars: usize,
    max_items: usize,
    what: &str,
    warnings: &mut Vec<String>,
) -> Vec<String> {
    let before = items.len();
    let mut kept: Vec<String> = items
        .into_iter()
        .filter(|item| char_len(item) <= max_chars)
        .collect();
    if kept.len() < before {
        let n = before - kept.len();
        warnings.push(format!(
            "{n} {what}{} longer than {max_chars} characters left out.",
            if n == 1 { " was" } else { "s were" }
        ));
    }
    cap(&mut kept, max_items, &format!("{what}s"), warnings);
    kept
}

pub(super) fn cap<T>(items: &mut Vec<T>, max: usize, what: &str, warnings: &mut Vec<String>) {
    if items.len() > max {
        warnings.push(format!(
            "Only {max} of {} {what} fit in a card; the rest were left out.",
            items.len()
        ));
        items.truncate(max);
    }
}

/// `^[a-z][a-z0-9_-]{0,39}$` (the schema's channel id).
fn is_channel_id(id: &str) -> bool {
    let mut chars = id.chars();
    chars.next().is_some_and(|c| c.is_ascii_lowercase())
        && id.len() <= 40
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
}

/// `^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$` (the schema's BCP 47 subset).
fn is_language_tag(code: &str) -> bool {
    let mut parts = code.split('-');
    let primary_ok = parts
        .next()
        .is_some_and(|p| (2..=3).contains(&p.len()) && p.chars().all(|c| c.is_ascii_alphabetic()));
    primary_ok
        && parts.all(|p| (2..=8).contains(&p.len()) && p.chars().all(|c| c.is_ascii_alphanumeric()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channel_ids_and_language_tags_follow_the_schema() {
        assert!(is_channel_id("generic"));
        assert!(is_channel_id("my-slack_2"));
        assert!(!is_channel_id("Email"));
        assert!(!is_channel_id("2fa"));
        assert!(!is_channel_id(&"a".repeat(41)));
        assert!(is_language_tag("cs"));
        assert!(is_language_tag("en-GB"));
        assert!(is_language_tag("zh-Hant-TW"));
        assert!(!is_language_tag("English"));
        assert!(!is_language_tag("e"));
        assert!(!is_language_tag("en-"));
    }

    #[test]
    fn the_card_id_is_stable_per_twin_and_hides_the_twin_id() {
        let one = card_id_for("twin-1");
        assert_eq!(one, card_id_for("twin-1"));
        assert_ne!(one, card_id_for("twin-2"));
        assert!(!one.contains("twin-1"));
        assert_eq!(one.len(), 36);
    }
}
