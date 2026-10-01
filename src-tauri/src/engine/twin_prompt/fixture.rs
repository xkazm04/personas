//! The fixture twin every compiler and lane test renders: the person from
//! `docs/standards/twin-card/1.0/examples/full.twin.json`, seeded through the
//! real repos into a migrated test database.
//!
//! Tones carry directives, exemplars and constraints on `generic` and
//! `email`; there are self-facts, a fact about a contact, an approved and a
//! pending memory, and standing directions.

use serde_json::{json, Value};

use crate::db::models::{TwinCommunication, TwinStyle, TwinStyleDims};
use crate::db::repos::twin as twin_repo;
use crate::db::DbPool;

use super::input::{
    json_strings, profile_languages, GrammaticalGender, TwinPromptInput, DEFAULT_CHANNEL,
};

pub(crate) const NAME: &str = "Marek Dvořák";
pub(crate) const CONTACT: &str = "jana@example.com";
pub(crate) const INBOUND: &str = "Can you confirm the release date for the updater fix?";

/// A fresh migrated database holding the fixture twin; returns its id.
pub(crate) fn seed_marek(pool: &DbPool) -> String {
    let profile = twin_repo::create_profile(
        pool,
        NAME,
        Some(
            "Runs the desktop team, ships weekly, mentors two juniors. Writes short, direct \
             messages and uses humour sparingly.",
        ),
        Some("Engineering lead"),
        Some(r#"["cs","en"]"#),
        Some("male"),
    )
    .expect("create the fixture twin");
    twin_repo::update_profile(
        pool,
        &profile.id,
        None,
        None,
        None,
        None,
        None,
        None,
        Some(Some(
            "Never promise a date I do not control. Answer the question asked first.",
        )),
    )
    .expect("set standing directions");

    twin_repo::apply_styled_tones(
        pool,
        &profile.id,
        &[
            styled(
                "generic",
                "Plain and direct. Leads with the answer, adds one reason, stops.",
                // Stored oldest first, as the append doors write them.
                &[
                    "who's blocked and on what? let's take it to a thread, not the channel",
                    "shipping thursday unless QA finds something. will confirm by noon",
                ],
                &[
                    "No exclamation marks",
                    "Never open with a greeting in a reply thread",
                ],
                "One or two sentences",
                style("preset", Some("plainspoken-direct"), [3, 3, 2, 3, 2, 2, 2, 3]),
            ),
            styled(
                "email",
                "Polite and concise. Signs off with \"M.\"",
                &[
                    "Hi Jana,\n\nThe release moves to Thursday; QA found a crash in the updater. I will confirm by noon tomorrow.\n\nM.",
                    // Opens with a filler opener: the allowance keeps
                    // "thanks" off this person's avoid list.
                    "Thanks Jana, Friday works for the retro.\n\nM.",
                ],
                &["Sign off \"M.\""],
                "A short paragraph",
                style("learned", None, [4, 3, 1, 3, 3, 2, 1, 3]),
            ),
        ],
    )
    .expect("write the fixture tones");

    let cite = ["c1".to_string()];
    for (contact, content, importance) in [
        (None, "Prefers async updates over status meetings.", 3),
        (None, "Leads a team of five on the desktop app.", 4),
        (Some(CONTACT), "Jana runs QA and wants dates in writing.", 4),
    ] {
        twin_repo::create_distilled_fact(pool, &profile.id, contact, content, importance, &cite)
            .expect("write a fixture fact");
    }

    let approved = twin_repo::create_pending_memory(
        pool,
        &profile.id,
        Some("training"),
        "Ships the desktop app every week on Thursday.",
        Some("Release cadence"),
        4,
        None,
    )
    .expect("queue a memory");
    twin_repo::review_pending_memory(pool, &approved.id, true, None).expect("approve it");
    twin_repo::create_pending_memory(
        pool,
        &profile.id,
        Some("training"),
        "Might move the team to a four-day week.",
        None,
        5,
        None,
    )
    .expect("queue a memory left pending");

    profile.id
}

/// The thread a fixture reply answers, newest first (the repo's order).
pub(crate) fn recent_thread() -> Vec<TwinCommunication> {
    [
        ("out", "Should be, QA is on it."),
        ("in", "Is the updater fix in this week?"),
    ]
    .into_iter()
    .map(|(direction, content)| TwinCommunication {
        id: content.into(),
        twin_id: "fixture".into(),
        channel: "email".into(),
        direction: direction.into(),
        contact_handle: Some(CONTACT.into()),
        content: content.into(),
        summary: None,
        key_facts_json: None,
        occurred_at: String::new(),
        created_at: String::new(),
    })
    .collect()
}

/// The twin expressed as Twin Card data, built straight from the database
/// rows with the schema's own field names (the way a Twin Card export reads
/// them), NOT through the compiler's view: a field-name or mapping slip on
/// either side makes the round trip differ. The one exception is the quality
/// rules, which an export takes from `TwinPromptInput::from_db(..).quality`
/// so the per-person allowances (dashes, filler openers) travel with the card.
pub(crate) fn card_json(pool: &DbPool, twin_id: &str) -> Value {
    let profile = twin_repo::get_profile_by_id(pool, twin_id).expect("profile");
    let tones = twin_repo::list_tones(pool, twin_id).expect("tones");
    let facts = twin_repo::list_distilled_facts(pool, twin_id, None).expect("facts");
    let memories =
        twin_repo::list_pending_memories(pool, twin_id, Some("approved"), None).expect("memories");
    let rules = TwinPromptInput::from_db(pool, twin_id, DEFAULT_CHANNEL)
        .expect("quality rules")
        .quality;

    let channels: Vec<Value> = tones
        .iter()
        .map(|t| {
            let mut exemplars = json_strings(t.examples_json.as_deref());
            exemplars.reverse(); // stored oldest first; a card is newest first
            let style = t
                .style_json
                .as_deref()
                .and_then(|raw| serde_json::from_str::<TwinStyle>(raw).ok())
                .map(|s| {
                    json!({
                        "dims": s.dims,
                        "origin": { "kind": s.source, "preset_id": s.preset_id },
                    })
                });
            json!({
                "channel": t.channel,
                "style": style,
                "directives": t.voice_directives,
                "length_hint": t.length_hint,
                "constraints": json_strings(t.constraints_json.as_deref()),
                "exemplars": exemplars
                    .iter()
                    .map(|text| json!({ "text": text, "source": "unknown" }))
                    .collect::<Vec<_>>(),
            })
        })
        .collect();

    json!({
        "$schema": "https://personas.app/schemas/twin-card/1.0/twin-card.schema.json",
        "spec": "twin-card",
        "spec_version": "1.0",
        "card_id": "0d7e9b14-52a8-4f3c-8a61-c2e4f9b07d35",
        "created_at": profile.created_at,
        "exported_at": profile.updated_at,
        "generator": { "name": "Personas", "version": "test" },
        "identity": {
            "name": profile.name,
            "role": profile.role,
            "bio": profile.bio,
            "languages": profile_languages(profile.languages.as_deref()),
            "grammatical_gender": GrammaticalGender::from_pronouns(profile.pronouns.as_deref()),
        },
        "voice": {
            "scale": "twin-card.style/1",
            "default_channel": "generic",
            "standing_directions": profile.training_directives,
            "quality_rules": {
                "profile": super::card::PLAIN_VOICE_PROFILE,
                "register": rules.register,
                "avoid_phrases": rules.avoid_phrases,
                "filler_openers": rules.filler_openers,
                "dash_policy": rules.dash_policy,
            },
            "channels": channels,
        },
        "knowledge": {
            "memories": memories
                .iter()
                .map(|m| json!({
                    "title": m.title,
                    "content": m.content,
                    "observed_at": m.created_at,
                    "source": m.channel,
                    "importance": m.importance,
                }))
                .collect::<Vec<_>>(),
            "facts": facts
                .iter()
                .filter(|f| f.contact_handle.is_none())
                .map(|f| json!({ "content": f.content, "importance": f.importance }))
                .collect::<Vec<_>>(),
        },
        "integrity": { "alg": "sha256", "canonicalization": "rfc8785", "parts": {} },
    })
}

fn styled(
    channel: &str,
    voice: &str,
    examples: &[&str],
    constraints: &[&str],
    length: &str,
    style_json: String,
) -> twin_repo::StyledToneWrite {
    twin_repo::StyledToneWrite {
        channel: channel.into(),
        voice_directives: voice.into(),
        examples_json: serde_json::to_string(examples).expect("examples json"),
        constraints_json: serde_json::to_string(constraints).expect("constraints json"),
        length_hint: Some(length.into()),
        style_json,
    }
}

fn style(source: &str, preset_id: Option<&str>, d: [u8; 8]) -> String {
    serde_json::to_string(&TwinStyle {
        source: source.into(),
        preset_id: preset_id.map(str::to_string),
        name: "Fixture style".into(),
        summary: String::new(),
        avoid: String::new(),
        dims: TwinStyleDims {
            formality: d[0],
            warmth: d[1],
            humor: d[2],
            energy: d[3],
            length: d[4],
            directness: d[5],
            expressiveness: d[6],
            detail: d[7],
        },
    })
    .expect("style json")
}
