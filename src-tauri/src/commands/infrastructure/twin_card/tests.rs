//! End-to-end Twin Card tests on real migrated databases: export -> inspect
//! -> import -> export, the published examples, sealing, signing, conflicts,
//! and the third-party rule.
//!
//! The twin is the prompt compiler's fixture (`twin_prompt::fixture`, the
//! person of `examples/full.twin.json`) plus a training record, a legacy
//! Training Studio answer, and other people's data the card must never carry.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde_json::{json, Value};

use super::apply::Conflict;
use super::canonical::canonical_json;
use super::flow;
use super::open::{read_card_file, read_parts};
use super::sign::{test_keys, Signing};
use super::types::CardVoiceView;
use crate::db::models::{SetupReadiness, TwinCardExportOptions};
use crate::db::repos::twin as twin_repo;
use crate::db::repos::twin_setup::{self as setup_repo, NewGoal, NewStep, Placement, PlanRow};
use crate::db::DbPool;
use crate::engine::twin_prompt::fixture::{self, CONTACT, INBOUND};
use crate::engine::twin_prompt::{compile_twin_core, TwinPromptInput};
use crate::engine::twin_setup::session::training_qa_facts;
use crate::error::AppError;

const PASS: &str = "correct horse battery";
const OPINIONS_Q: &str = "Describe the last time you changed your mind at work.";
const OPINIONS_A: &str =
    "I used to push for feature flags everywhere; now I prefer short-lived branches plus fast reverts.";
const LEGACY_Q: &str = "What won't you compromise on?";
const LEGACY_A: &str = "Honesty, always.";
const CONTACT_NOTE: &str = "Jana is allergic to status meetings";
const OUTBOUND_TO_CONTACT: &str = "Thursday it is, Jana.";
const FULL: &str =
    include_str!("../../../../../docs/standards/twin-card/1.0/examples/full.twin.json");

/// A scratch folder for card files, removed on drop.
struct Scratch(PathBuf);

impl Scratch {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("twin-card-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("scratch dir");
        Self(dir)
    }
    fn file(&self, name: &str) -> String {
        self.0.join(name).to_string_lossy().into_owned()
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// The fixture twin, its training record, and third-party data around it.
fn seed(pool: &DbPool) -> Result<String, AppError> {
    let twin = fixture::seed_marek(pool);
    let conn = pool.get()?;
    setup_repo::upsert_plan_on(
        &conn,
        &PlanRow {
            status: "ready".into(),
            version: 2,
            stage: "training".into(),
            readiness: Some(SetupReadiness {
                identity: "set".into(),
                tone: "partial".into(),
                channels: "empty".into(),
                memories: "set".into(),
            }),
            ..PlanRow::fresh(&twin)
        },
    )?;
    let criteria = [
        "A real example".to_string(),
        "A stated trade-off".to_string(),
    ];
    let opinions = setup_repo::insert_goal_on(
        &conn,
        &twin,
        &NewGoal {
            slot: "training:opinions",
            title: "How Marek argues a position",
            intent: "So drafts can take a side the way he does.",
            criteria: &criteria,
        },
    )?;
    setup_repo::set_goal_progress_on(&conn, &twin, &opinions, 0.35, "open", 0)?;
    let who = setup_repo::insert_goal_on(
        &conn,
        &twin,
        &NewGoal {
            slot: "identity",
            title: "Who Marek is",
            intent: "",
            criteria: &[],
        },
    )?;
    setup_repo::set_goal_progress_on(&conn, &twin, &who, 1.0, "covered", 0)?;

    for (goal, stage, kind, question, incoming, answer) in [
        (
            Some(opinions.as_str()),
            "training",
            "scene",
            OPINIONS_Q,
            None,
            OPINIONS_A,
        ),
        (
            None,
            "setup",
            "reply_drill",
            "Reply to this.",
            Some("Can we move the demo?"),
            "friday works",
        ),
    ] {
        let step = setup_repo::insert_step_on(
            &conn,
            &twin,
            &NewStep {
                goal_id: goal,
                stage,
                origin: "plan",
                kind,
                question,
                answer_mode: if incoming.is_some() { "write" } else { "pick" },
                incoming,
                tone_channel: None,
                suggestions: &[],
                plan_version: 2,
            },
            "live",
            Placement::Tail,
        )?;
        setup_repo::finish_step_on(&conn, &twin, &step, Some(answer))?;
        if let Some(goal) = goal {
            setup_repo::bump_goal_answered_on(&conn, &twin, goal)?;
        }
    }
    for _ in 0..4 {
        setup_repo::note_observation_on(
            &conn,
            &twin,
            "Prefers concrete examples to principles.",
            20,
        )?;
    }
    setup_repo::note_observation_on(&conn, &twin, "Answers in the first person.", 20)?;
    drop(conn);

    // The engine writes a training answer twice (step + communication); the
    // card carries it once. A legacy Training Studio answer exists only here.
    for (q, a, topic) in [
        (OPINIONS_Q, OPINIONS_A, "opinions"),
        (LEGACY_Q, LEGACY_A, "values"),
    ] {
        twin_repo::record_interaction(
            pool,
            &twin,
            "training",
            "out",
            None,
            a,
            Some(&format!("Training Q&A: {q}")),
            Some(&training_qa_facts(q, a, Some(topic))),
            false,
        )?;
    }

    // Other people's data: an inbound message whose memory the owner
    // approved, a reply to that contact, the contact's notes.
    twin_repo::record_interaction(
        pool,
        &twin,
        "email",
        "in",
        Some(CONTACT),
        INBOUND,
        None,
        None,
        true,
    )?;
    twin_repo::record_interaction(
        pool,
        &twin,
        "email",
        "out",
        Some(CONTACT),
        OUTBOUND_TO_CONTACT,
        None,
        None,
        false,
    )?;
    for memory in twin_repo::list_pending_memories(pool, &twin, Some("pending"), None)? {
        if memory.content.contains(INBOUND) {
            twin_repo::review_pending_memory(pool, &memory.id, true, None)?;
        }
    }
    if let Some(contact) = twin_repo::list_contacts_with_activity(pool, &twin)?.first() {
        twin_repo::update_contact(pool, &contact.id, None, Some(CONTACT_NOTE))?;
    }
    Ok(twin)
}

fn options(path: &str, format: &str, partitions: &[&str]) -> TwinCardExportOptions {
    TwinCardExportOptions {
        partitions: partitions.iter().map(|p| p.to_string()).collect(),
        format: format.into(),
        path: path.into(),
    }
}

const ALL: [&str; 4] = ["voice", "knowledge", "training", "evidence"];

/// Every part's canonical plaintext, unsealed with `passphrase`.
fn parts(path: &str, passphrase: Option<&str>) -> BTreeMap<&'static str, String> {
    let opened = read_card_file(path).expect("card reads");
    read_parts(&opened.card, passphrase)
        .into_iter()
        .map(|r| (r.part.key(), canonical_json(&r.value.expect("part opens"))))
        .collect()
}

fn count(pool: &DbPool, table: &str) -> Result<i64, AppError> {
    let conn = pool.get()?;
    Ok(
        conn.query_row(&format!("SELECT COUNT(*) AS n FROM {table}"), [], |r| {
            r.get("n")
        })?,
    )
}

const TWIN_TABLES: [&str; 9] = [
    "twin_profiles",
    "twin_tones",
    "twin_pending_memories",
    "twin_distilled_facts",
    "twin_communications",
    "twin_setup_plans",
    "twin_setup_goals",
    "twin_setup_steps",
    "twin_setup_observations",
];

fn counts(pool: &DbPool) -> Result<Vec<i64>, AppError> {
    TWIN_TABLES.iter().map(|t| count(pool, t)).collect()
}

#[test]
fn a_sealed_card_round_trips_byte_identically_through_import() -> Result<(), AppError> {
    let source = crate::db::init_test_db()?;
    let twin = seed(&source)?;
    let scratch = Scratch::new();
    let first = scratch.file("marek.twin.json");
    let signing = test_keys::signing();
    let written = flow::export(
        &source,
        &twin,
        &options(&first, "twin-card", &ALL),
        Some(PASS),
        &signing,
    )?;
    assert_eq!(written.partitions, ALL);
    assert_eq!(written.sealed, ["knowledge", "training"]);
    assert_eq!(written.signed, matches!(signing, Signing::Key(_)));

    let seen = flow::inspect(&first, Some(PASS))?;
    assert!(seen.supported && seen.valid, "{:?}", seen.warnings);
    assert_eq!(seen.name.as_deref(), Some(fixture::NAME));
    assert_eq!(
        seen.signature,
        if written.signed { "valid" } else { "unsigned" }
    );
    for info in &seen.partitions {
        assert_eq!(info.hash_ok, Some(true), "{}", info.name);
    }
    let unopened = flow::inspect(&first, None)?;
    let sealed: Vec<_> = unopened
        .partitions
        .iter()
        .filter(|p| p.sealed)
        .map(|p| (p.name.as_str(), p.hash_ok))
        .collect();
    assert_eq!(sealed, [("knowledge", None), ("training", None)]);

    // Another machine: a fresh database, no name conflict.
    let target = crate::db::init_test_db()?;
    let imported = flow::import(&target, &first, Some(PASS), "duplicate")?;
    assert_eq!(imported.imported, ["voice", "knowledge", "training"]);
    let second = scratch.file("again.twin.json");
    flow::export(
        &target,
        &imported.twin_id,
        &options(&second, "twin-card", &ALL),
        Some(PASS),
        &signing,
    )?;

    let (a, b) = (parts(&first, Some(PASS)), parts(&second, Some(PASS)));
    for key in ["identity", "voice", "knowledge", "training"] {
        assert_eq!(a[key], b[key], "the {key} part survives the round trip");
    }
    // The imported twin drafts exactly as its card renders.
    let view: CardVoiceView = serde_json::from_value(json!({
        "identity": serde_json::from_str::<Value>(&a["identity"])?,
        "voice": serde_json::from_str::<Value>(&a["voice"])?,
        "knowledge": serde_json::from_str::<Value>(&a["knowledge"])?,
    }))?;
    for channel in ["generic", "email", "slack"] {
        assert_eq!(
            compile_twin_core(&TwinPromptInput::from_db(
                &target,
                &imported.twin_id,
                channel
            )?),
            compile_twin_core(&TwinPromptInput::from_card(&view, channel)),
            "channel {channel}"
        );
    }
    Ok(())
}

#[test]
fn the_record_carries_each_answer_once_and_the_legacy_one_without_a_kind() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    let twin = seed(&pool)?;
    let scratch = Scratch::new();
    let path = scratch.file("open.twin.json");
    flow::export(
        &pool,
        &twin,
        &options(&path, "twin-card", &ALL),
        None,
        &Signing::NoIdentity,
    )?;
    let card: Value = serde_json::from_str(&std::fs::read_to_string(&path)?)?;
    let qa = card["training"]["qa"].as_array().expect("qa");
    assert_eq!(qa.len(), 3, "{qa:#?}");
    assert_eq!(
        qa.iter()
            .filter(|q| q["question"] == json!(OPINIONS_Q))
            .count(),
        1
    );
    let legacy = qa
        .iter()
        .find(|q| q["question"] == json!(LEGACY_Q))
        .expect("legacy answer");
    assert_eq!(
        (&legacy["kind"], &legacy["slot"]),
        (&Value::Null, &json!("training:values"))
    );
    let drill = qa
        .iter()
        .find(|q| q["kind"] == json!("reply_drill"))
        .expect("drill");
    assert_eq!(drill["incoming"], json!("Can we move the demo?"));
    assert_eq!(
        card["training"]["goals"][0]["coverage_permille"],
        json!(350)
    );
    assert_eq!(card["training"]["observations"][0]["evidence"], json!(4));
    let evidence = &card["evidence"];
    assert_eq!(evidence["answers"], json!(3));
    assert_eq!(evidence["readiness_percent"], json!(63));
    assert_eq!(evidence["coverage_permille"]["training"], json!(675));
    assert_eq!(
        evidence["exemplars_per_channel"],
        json!({ "email": 2, "generic": 2 })
    );
    assert_eq!(evidence["renderer"], json!("twin-card.render/1"));
    assert!(card.get("signature").is_none());
    assert!(card["generator"]["version"]
        .as_str()
        .is_some_and(|v| v.contains('+')));
    Ok(())
}

#[test]
fn an_exported_card_renders_the_same_core_as_its_database() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    let twin = fixture::seed_marek(&pool);
    let scratch = Scratch::new();
    let path = scratch.file("open.twin.json");
    flow::export(
        &pool,
        &twin,
        &options(&path, "twin-card", &["knowledge"]),
        None,
        &Signing::NoIdentity,
    )?;
    let view = serde_json::from_str(&std::fs::read_to_string(&path)?)?;
    for channel in ["generic", "email", "browser", "slack"] {
        assert_eq!(
            compile_twin_core(&TwinPromptInput::from_card(&view, channel)),
            compile_twin_core(&TwinPromptInput::from_db(&pool, &twin, channel)?),
            "channel {channel}"
        );
    }
    Ok(())
}

#[test]
fn no_third_party_data_leaves_in_a_card() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    let twin = seed(&pool)?;
    let scratch = Scratch::new();
    let path = scratch.file("open.twin.json");
    let written = flow::export(
        &pool,
        &twin,
        &options(&path, "twin-card", &ALL),
        None,
        &Signing::NoIdentity,
    )?;
    let text = std::fs::read_to_string(&path)?;
    for leak in [
        CONTACT,
        "Jana runs QA",
        INBOUND,
        OUTBOUND_TO_CONTACT,
        CONTACT_NOTE,
    ] {
        assert!(!text.contains(leak), "{leak:?} leaked into the card");
    }
    assert!(
        text.contains("Ships the desktop app every week on Thursday."),
        "the owner's memory is there"
    );
    assert!(
        written.warnings.iter().any(|w| w.contains("other people")),
        "{:?}",
        written.warnings
    );
    Ok(())
}

#[test]
fn a_wrong_passphrase_writes_nothing() -> Result<(), AppError> {
    let source = crate::db::init_test_db()?;
    let twin = seed(&source)?;
    let scratch = Scratch::new();
    let path = scratch.file("sealed.twin.json");
    flow::export(
        &source,
        &twin,
        &options(&path, "twin-card", &ALL),
        Some(PASS),
        &Signing::NoIdentity,
    )?;
    let before = counts(&source)?;
    let err = flow::import(&source, &path, Some("not the passphrase"), "duplicate")
        .expect_err("must fail");
    assert!(
        matches!(err, AppError::Validation(ref m) if m.contains("Wrong passphrase")),
        "{err}"
    );
    let err = flow::import(&source, &path, None, "duplicate").expect_err("must fail");
    assert!(matches!(err, AppError::Validation(_)), "{err}");
    assert_eq!(counts(&source)?, before, "zero rows written");
    Ok(())
}

#[test]
fn a_ccv3_export_carries_the_whole_card_and_a_system_prompt() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    let twin = seed(&pool)?;
    let scratch = Scratch::new();
    let path = scratch.file("marek.card.json");
    flow::export(
        &pool,
        &twin,
        &options(&path, "ccv3", &ALL),
        Some(PASS),
        &test_keys::signing(),
    )?;
    let file: Value = serde_json::from_str(&std::fs::read_to_string(&path)?)?;
    assert_eq!(
        (&file["spec"], &file["spec_version"]),
        (&json!("chara_card_v3"), &json!("3.0"))
    );
    let data = &file["data"];
    assert_eq!(data["name"], json!(fixture::NAME));
    assert_eq!(data["extensions"]["twin-card"]["spec"], json!("twin-card"));
    let prompt = data["system_prompt"].as_str().expect("system prompt");
    assert!(
        prompt.starts_with("You are writing as Marek Dvořák, Engineering lead."),
        "{prompt}"
    );
    assert!(
        !prompt.contains("Ships the desktop app"),
        "sealed knowledge stays out of the plaintext prompt"
    );
    assert!(data["personality"]
        .as_str()
        .is_some_and(|p| p.contains("Formality: consultative.")));
    assert!(data["mes_example"]
        .as_str()
        .is_some_and(|m| m.starts_with("<START>\n{{char}}: ")));

    // Inspect and import read the card inside.
    let seen = flow::inspect(&path, Some(PASS))?;
    assert!(
        seen.valid && seen.partitions.iter().all(|p| p.hash_ok == Some(true)),
        "{seen:?}"
    );
    let other = crate::db::init_test_db()?;
    assert!(!flow::import(&other, &path, Some(PASS), "duplicate")?
        .twin_id
        .is_empty());
    Ok(())
}

#[test]
fn the_published_examples_inspect_clean_and_a_changed_part_does_not() -> Result<(), AppError> {
    let scratch = Scratch::new();
    let path = scratch.file("full.twin.json");
    std::fs::write(&path, FULL)?;
    let seen = flow::inspect(&path, None)?;
    assert!(seen.supported && seen.valid, "{:?}", seen.warnings);
    assert_eq!(seen.signature, "unsigned");
    assert!(
        seen.partitions.iter().all(|p| p.hash_ok == Some(true)),
        "{seen:?}"
    );

    let mut card: Value = serde_json::from_str(FULL)?;
    card["knowledge"]["facts"][0]["content"] = json!("Prefers status meetings.");
    std::fs::write(&path, serde_json::to_string(&card)?)?;
    let seen = flow::inspect(&path, None)?;
    let knowledge = seen
        .partitions
        .iter()
        .find(|p| p.name == "knowledge")
        .expect("knowledge");
    assert_eq!(knowledge.hash_ok, Some(false));
    // Import refuses the changed part and keeps the rest.
    let pool = crate::db::init_test_db()?;
    let imported = flow::import(&pool, &path, None, "duplicate")?;
    assert_eq!(imported.imported, ["voice", "training"]);
    assert!(imported.warnings.iter().any(|w| w.contains("knowledge")));

    card["spec_version"] = json!("2.0");
    std::fs::write(&path, serde_json::to_string(&card)?)?;
    let seen = flow::inspect(&path, None)?;
    assert_eq!(
        (seen.supported, seen.valid, seen.spec_version.as_str()),
        (false, false, "2.0")
    );
    assert!(flow::import(&pool, &path, None, "duplicate").is_err());

    card["spec_version"] = json!("1.0");
    card["identity"]["name"] = json!("Someone Else");
    std::fs::write(&path, serde_json::to_string(&card)?)?;
    let before = counts(&pool)?;
    assert!(
        flow::import(&pool, &path, None, "duplicate").is_err(),
        "a changed identity is refused"
    );
    assert_eq!(counts(&pool)?, before);
    Ok(())
}

#[test]
fn conflicts_duplicate_replace_and_skip() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    let twin = fixture::seed_marek(&pool);
    let scratch = Scratch::new();
    let path = scratch.file("marek.twin.json");
    flow::export(
        &pool,
        &twin,
        &options(&path, "twin-card", &ALL),
        None,
        &Signing::NoIdentity,
    )?;

    let before = counts(&pool)?;
    let skipped = flow::import(&pool, &path, None, "skip")?;
    assert_eq!((skipped.twin_id.as_str(), skipped.imported.len()), ("", 0));
    assert_eq!(counts(&pool)?, before, "skip writes nothing");

    let copy = flow::import(&pool, &path, None, "duplicate")?;
    let name = twin_repo::get_profile_by_id(&pool, &copy.twin_id)?.name;
    assert_eq!(name, format!("{} (2)", fixture::NAME));

    let replaced = flow::import(&pool, &path, None, "replace")?;
    assert!(matches!(
        twin_repo::get_profile_by_id(&pool, &twin),
        Err(AppError::NotFound(_))
    ));
    let profiles = twin_repo::list_profiles(&pool)?;
    let fresh = profiles
        .iter()
        .find(|p| p.id == replaced.twin_id)
        .expect("replacement");
    assert_eq!(fresh.name, fixture::NAME);
    assert!(fresh.is_active, "the replaced twin was the active one");
    assert_eq!(profiles.iter().filter(|p| p.is_active).count(), 1);
    assert!(Conflict::parse("merge").is_err());
    Ok(())
}

#[test]
fn a_twin_with_no_voice_exports_a_placeholder_channel_and_imports_none() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    let twin = twin_repo::create_profile(&pool, "Ada", None, None, None, None)?;
    let scratch = Scratch::new();
    let path = scratch.file("ada.twin.json");
    let written = flow::export(
        &pool,
        &twin.id,
        &options(&path, "twin-card", &[]),
        None,
        &Signing::Failed("the keyring was reset".into()),
    )?;
    assert_eq!(written.partitions, ["voice"]);
    assert!(!written.signed);
    assert_eq!(written.warnings, ["the keyring was reset"]);
    assert!(flow::inspect(&path, None)?.valid);
    let other = crate::db::init_test_db()?;
    let imported = flow::import(&other, &path, None, "duplicate")?;
    assert!(twin_repo::list_tones(&other, &imported.twin_id)?.is_empty());
    let err = flow::export(
        &pool,
        &twin.id,
        &options(&path, "twin-card", &["secrets"]),
        None,
        &Signing::NoIdentity,
    );
    assert!(matches!(err, Err(AppError::Validation(_))));
    let err = flow::export(
        &pool,
        &twin.id,
        &options(&path, "twin-card", &ALL),
        Some("short"),
        &Signing::NoIdentity,
    );
    assert!(matches!(err, Err(AppError::Validation(_))));
    Ok(())
}

#[cfg(feature = "p2p")]
#[test]
fn a_changed_file_breaks_its_signature() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    let twin = fixture::seed_marek(&pool);
    let scratch = Scratch::new();
    let path = scratch.file("signed.twin.json");
    flow::export(
        &pool,
        &twin,
        &options(&path, "twin-card", &ALL),
        None,
        &test_keys::signing(),
    )?;
    assert_eq!(flow::inspect(&path, None)?.signature, "valid");
    let mut card: Value = serde_json::from_str(&std::fs::read_to_string(&path)?)?;
    card["exported_at"] = json!("2030-01-01T00:00:00Z");
    std::fs::write(&path, serde_json::to_string(&card)?)?;
    assert_eq!(flow::inspect(&path, None)?.signature, "invalid");
    Ok(())
}
