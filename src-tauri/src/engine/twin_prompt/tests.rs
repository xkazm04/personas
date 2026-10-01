//! The compiler against RENDERER.md: section order, omission, limits, channel
//! resolution, and the DB-to-card round trip.

use super::card::{CardKnowledgePart, CardVoiceView};
use super::compile::{
    compile_sections, compile_twin_core, cut_at_word, CoreSection, CONSTRAINTS_MAX,
    CONSTRAINT_CHARS, EXEMPLARS_MAX, EXEMPLAR_CHARS, FACTS_MAX, FACT_MAX_CHARS,
};
use super::fixture;
use super::input::{
    json_strings, profile_languages, DashPolicy, GrammaticalGender, KnowledgeKind, PromptFact,
    TwinPromptInput,
};
use crate::commands::infrastructure::twin_voice::{DASH_RULE, FILLER_OPENERS, MACHINE_WORDS};
use crate::db::models::{TwinDistilledFact, TwinPendingMemory, TwinProfile, TwinTone};

const FULL_CARD: &str =
    include_str!("../../../../docs/standards/twin-card/1.0/examples/full.twin.json");
const MINIMAL_CARD: &str =
    include_str!("../../../../docs/standards/twin-card/1.0/examples/minimal.twin.json");

const ALL_SECTIONS: [CoreSection; 6] = [
    CoreSection::Identity,
    CoreSection::Languages,
    CoreSection::StandingDirections,
    CoreSection::ChannelVoice,
    CoreSection::Facts,
    CoreSection::QualityRules,
];

fn profile(name: &str) -> TwinProfile {
    TwinProfile {
        id: "tw".into(),
        name: name.into(),
        slug: "tw".into(),
        bio: None,
        role: None,
        languages: None,
        pronouns: None,
        obsidian_subpath: "personas/twins/tw".into(),
        is_active: true,
        knowledge_base_id: None,
        training_directives: None,
        created_at: String::new(),
        updated_at: String::new(),
    }
}

fn tone(channel: &str, directives: &str, examples: &[&str], constraints: &[&str]) -> TwinTone {
    TwinTone {
        id: format!("tone-{channel}"),
        twin_id: "tw".into(),
        channel: channel.into(),
        voice_directives: directives.into(),
        examples_json: Some(serde_json::to_string(examples).unwrap()),
        constraints_json: Some(serde_json::to_string(constraints).unwrap()),
        length_hint: None,
        style_json: None,
        updated_at: String::new(),
    }
}

fn fact(contact: Option<&str>, content: &str, importance: i32) -> TwinDistilledFact {
    TwinDistilledFact {
        id: content.into(),
        twin_id: "tw".into(),
        contact_handle: contact.map(str::to_string),
        content: content.into(),
        importance,
        sources_json: "[\"c1\"]".into(),
        created_at: String::new(),
        last_seen_at: String::new(),
    }
}

fn memory(content: &str, importance: i32, created_at: &str, status: &str) -> TwinPendingMemory {
    TwinPendingMemory {
        id: content.into(),
        twin_id: "tw".into(),
        channel: None,
        content: content.into(),
        title: None,
        importance,
        status: status.into(),
        reviewer_notes: None,
        source_communication_id: None,
        created_at: created_at.into(),
        reviewed_at: None,
    }
}

fn kinds(input: &TwinPromptInput) -> Vec<CoreSection> {
    compile_sections(input)
        .into_iter()
        .map(|(s, _)| s)
        .collect()
}

fn section(input: &TwinPromptInput, wanted: CoreSection) -> String {
    compile_sections(input)
        .into_iter()
        .find(|(s, _)| *s == wanted)
        .map(|(_, body)| body)
        .unwrap_or_default()
}

fn card(raw: &str) -> CardVoiceView {
    serde_json::from_str(raw).expect("a Twin Card deserializes into CardVoiceView")
}

fn golden(name: &str, actual: &str, expected: &str) {
    assert_eq!(actual, expected, "{name} drifted from its golden");
}

// ---------------------------------------------------------------------------
// Order and omission (RENDERER.md "The core block, in order")
// ---------------------------------------------------------------------------

#[test]
fn the_fixture_twin_renders_every_section_in_renderer_order() {
    let pool = crate::db::init_test_db().unwrap();
    let twin = fixture::seed_marek(&pool);
    for channel in ["generic", "email"] {
        let input = TwinPromptInput::from_db(&pool, &twin, channel).unwrap();
        assert_eq!(kinds(&input), ALL_SECTIONS, "channel {channel}");
    }
    let core = |channel: &str| {
        compile_twin_core(&TwinPromptInput::from_db(&pool, &twin, channel).unwrap())
    };
    let (generic, email) = (core("generic"), core("email"));
    golden("core-email", &email, GOLDEN_CORE_EMAIL);
    golden("core-generic", &generic, GOLDEN_CORE_GENERIC);
}

#[test]
fn sections_with_nothing_to_say_are_omitted() {
    // A name and nothing else: who they are, and the rules every draft keeps.
    let bare = TwinPromptInput::from_rows(&profile("Ada"), &[], &[], &[], &[], "generic");
    assert_eq!(
        kinds(&bare),
        [CoreSection::Identity, CoreSection::QualityRules]
    );
    let core = compile_twin_core(&bare);
    assert!(core.starts_with("You are writing as Ada.\n\n"));
    assert!(!core.contains("writes in"), "no language was declared");
    assert!(!core.contains("Standing directions"));
    assert!(!core.contains("How Ada writes"));
    assert!(!core.contains("confirmed about themselves"));

    // A tone row with nothing in it says nothing either.
    let hollow = TwinPromptInput::from_rows(
        &profile("Ada"),
        &[tone("generic", "  ", &[], &["  "])],
        &[],
        &[],
        &[],
        "generic",
    );
    assert!(!kinds(&hollow).contains(&CoreSection::ChannelVoice));
}

// ---------------------------------------------------------------------------
// Limits (RENDERER.md 4 and 5)
// ---------------------------------------------------------------------------

#[test]
fn exemplars_are_the_five_newest_and_cut_at_a_word_with_an_ellipsis() {
    let long = "word ".repeat(150); // 750 chars
    let mut stored: Vec<String> = (1..=7).map(|i| format!("message {i}")).collect();
    stored.push(long.clone()); // the newest
    let stored: Vec<&str> = stored.iter().map(String::as_str).collect();
    let input = TwinPromptInput::from_rows(
        &profile("Ada"),
        &[tone("generic", "Short.", &stored, &[])],
        &[],
        &[],
        &[],
        "generic",
    );
    let voice = section(&input, CoreSection::ChannelVoice);
    let rendered: Vec<&str> = voice.split("\n---\n").skip(1).collect();
    assert_eq!(rendered.len(), EXEMPLARS_MAX, "{voice}");
    // Newest first: the long one, then 7, 6, 5, 4; 3 and older are dropped.
    assert!(rendered[0].starts_with("word word"));
    assert!(rendered[1].starts_with("message 7"));
    assert!(rendered[4].starts_with("message 4"));
    assert!(!voice.contains("message 3"));
    // The cut keeps whole words, stays inside the limit, and is marked.
    let cut = rendered[0];
    assert!(cut.ends_with("word…"), "{cut}");
    assert!(cut.chars().count() <= EXEMPLAR_CHARS);
}

#[test]
fn constraints_are_the_first_eight_and_cut_at_160_chars() {
    let mut rules: Vec<String> = (0..10).map(|i| format!("Never do thing {i}.")).collect();
    rules[0] = format!("Always {}", "explain the trade-off ".repeat(12)); // ~260 chars
    let rules: Vec<&str> = rules.iter().map(String::as_str).collect();
    let input = TwinPromptInput::from_rows(
        &profile("Ada"),
        &[tone("generic", "", &[], &rules)],
        &[],
        &[],
        &[],
        "generic",
    );
    let voice = section(&input, CoreSection::ChannelVoice);
    let listed: Vec<&str> = voice.lines().filter_map(|l| l.strip_prefix("- ")).collect();
    assert_eq!(listed.len(), CONSTRAINTS_MAX, "{voice}");
    assert!(listed[0].ends_with('…'));
    assert!(listed[0].chars().count() <= CONSTRAINT_CHARS);
    assert_eq!(listed[7], "Never do thing 7.");
    assert!(!voice.contains("thing 8"));
}

#[test]
fn facts_come_first_then_memories_by_importance_then_recency_at_most_twelve() {
    let facts: Vec<TwinDistilledFact> = (0..10)
        .map(|i| fact(None, &format!("fact {i}"), if i == 9 { 5 } else { 2 }))
        .collect();
    let memories = vec![
        memory("older memory", 4, "2026-09-01T10:00:00Z", "approved"),
        memory("newer memory", 4, "2026-09-20T10:00:00+00:00", "approved"),
        memory("minor memory", 1, "2026-09-30T10:00:00Z", "approved"),
        memory("unreviewed memory", 5, "2026-09-30T10:00:00Z", "pending"),
    ];
    let input = TwinPromptInput::from_rows(&profile("Ada"), &[], &facts, &memories, &[], "generic");
    let body = section(&input, CoreSection::Facts);
    let lines: Vec<&str> = body.lines().filter_map(|l| l.strip_prefix("- ")).collect();
    assert_eq!(lines.len(), FACTS_MAX, "{body}");
    // The important fact jumps the queue; the rest keep their arrival order.
    assert_eq!(&lines[..3], ["fact 9", "fact 0", "fact 1"]);
    // Then memories, newest first within one importance (mixed offsets parse).
    assert_eq!(&lines[10..], ["newer memory", "older memory"]);
    assert!(!body.contains("minor memory"), "the twelfth slot was taken");
    assert!(!body.contains("unreviewed"), "only approved memories count");
}

#[test]
fn a_cut_is_marked_and_reported() {
    assert_eq!(cut_at_word("short", 10), ("short".to_string(), false));
    let (cut, was_cut) = cut_at_word("one two three four five", 12);
    assert!(was_cut);
    assert_eq!(cut, "one two…");
    // One unbroken run cuts hard rather than dropping everything.
    let (hard, _) = cut_at_word(&"x".repeat(30), 10);
    assert_eq!(hard, "xxxxxxxxx…");
    // Multi-byte text cuts on a char boundary.
    let (accented, _) = cut_at_word(&"é".repeat(20), 5);
    assert_eq!(accented.chars().count(), 5);
}

// ---------------------------------------------------------------------------
// Channel voice
// ---------------------------------------------------------------------------

#[test]
fn an_examples_only_tone_renders_its_exemplars_and_rules() {
    let input = TwinPromptInput::from_rows(
        &profile("Ada"),
        &[tone(
            "generic",
            "",
            &["sure, thursday works"],
            &["Never use emoji"],
        )],
        &[],
        &[],
        &[],
        "generic",
    );
    let voice = section(&input, CoreSection::ChannelVoice);
    assert!(voice.starts_with("How Ada writes:\n"), "{voice}");
    assert!(voice.contains("\n---\nsure, thursday works\n---"));
    assert!(voice.contains("- Never use emoji"));
}

#[test]
fn style_dimensions_speak_only_when_the_directives_are_empty() {
    let pool = crate::db::init_test_db().unwrap();
    let twin = fixture::seed_marek(&pool);
    let mut input = TwinPromptInput::from_db(&pool, &twin, "generic").unwrap();
    assert!(!section(&input, CoreSection::ChannelVoice).contains("Formality:"));
    if let Some(voice) = input.voice.as_mut() {
        voice.directives.clear();
    }
    let voice = section(&input, CoreSection::ChannelVoice);
    for line in [
        "Formality: consultative.",
        "Warmth: cordial.",
        "Humor: dry.",
        "Energy: engaged.",
        "Length: brief.",
        "Directness: direct.",
        "Expressiveness: rare.",
        "Detail: explained.",
    ] {
        assert!(voice.contains(line), "{line} missing from:\n{voice}");
    }
}

#[test]
fn channel_resolution_is_target_then_generic_then_first() {
    let tones = [
        tone("email", "Email voice.", &[], &[]),
        tone("generic", "Generic voice.", &[], &[]),
        tone("slack", "Slack voice.", &[], &[]),
    ];
    let pick = |tones: &[TwinTone], channel: &str| {
        TwinPromptInput::from_rows(&profile("Ada"), tones, &[], &[], &[], channel)
            .voice
            .map(|v| v.channel)
    };
    assert_eq!(pick(&tones, "slack").as_deref(), Some("slack"));
    assert_eq!(pick(&tones, "browser").as_deref(), Some("generic"));
    assert_eq!(pick(&tones[2..], "browser").as_deref(), Some("slack"));
    assert_eq!(pick(&[], "browser"), None);
    // The section names the channel it speaks for, and not the default one.
    let slack = TwinPromptInput::from_rows(&profile("Ada"), &tones, &[], &[], &[], "slack");
    assert!(section(&slack, CoreSection::ChannelVoice).starts_with("How Ada writes on slack:"));
}

// ---------------------------------------------------------------------------
// Identity, knowledge scope, quality rules
// ---------------------------------------------------------------------------

#[test]
fn grammatical_gender_reads_the_pronouns_token_and_needs_an_inflecting_language() {
    use GrammaticalGender::*;
    for (token, expected) in [
        (Some("male"), Some(Masculine)),
        (Some(" Female "), Some(Feminine)),
        (Some("she/her"), Some(Feminine)),
        (Some("he/him"), Some(Masculine)),
        // The forge's "never picked" is indistinguishable from neutral.
        (Some("neutral"), None),
        (Some("they/them"), None),
        (Some("her"), None),
        (None, None),
    ] {
        assert_eq!(
            GrammaticalGender::from_pronouns(token),
            expected,
            "{token:?}"
        );
    }

    let mut czech = profile("Marek");
    czech.pronouns = Some("male".into());
    czech.languages = Some(r#"["cs","en"]"#.into());
    let core = compile_twin_core(&TwinPromptInput::from_rows(&czech, &[], &[], &[], &[], "x"));
    assert!(core.contains("Use masculine grammatical forms when Marek refers to themselves."));
    assert!(core.contains("Marek writes in Czech (cs) and English (en)."));

    let mut english = czech.clone();
    english.languages = Some(r#"["en"]"#.into());
    let core = compile_twin_core(&TwinPromptInput::from_rows(
        &english,
        &[],
        &[],
        &[],
        &[],
        "x",
    ));
    assert!(
        !core.contains("grammatical forms"),
        "English does not inflect"
    );

    // An unset (forge-default) Czech twin gets no gender line.
    let mut unset = czech.clone();
    unset.pronouns = Some("neutral".into());
    let core = compile_twin_core(&TwinPromptInput::from_rows(&unset, &[], &[], &[], &[], "x"));
    assert!(!core.contains("grammatical forms"), "{core}");

    // Nor does a card from another producer that says "neutral".
    let mut value: serde_json::Value = serde_json::from_str(FULL_CARD).unwrap();
    value["identity"]["grammatical_gender"] = serde_json::json!("neutral");
    let view: CardVoiceView = serde_json::from_value(value).unwrap();
    assert_eq!(view.identity.grammatical_gender, Some(Neutral));
    let core = compile_twin_core(&TwinPromptInput::from_card(&view, "generic"));
    assert!(core.contains("Czech (cs)"));
    assert!(!core.contains("grammatical forms"), "{core}");
}

#[test]
fn every_fact_line_is_cut_at_300_chars() {
    let long = format!("Started {}", "the team from scratch ".repeat(30)); // ~640 chars
    let input = TwinPromptInput::from_rows(
        &profile("Ada"),
        &[],
        &[fact(None, &long, 3)],
        &[memory(&long, 3, "2026-09-01T10:00:00Z", "approved")],
        &[],
        "generic",
    );
    let body = section(&input, CoreSection::Facts);
    let lines: Vec<&str> = body.lines().filter_map(|l| l.strip_prefix("- ")).collect();
    assert_eq!(lines.len(), 2, "{body}");
    let whole = long.trim();
    for line in lines {
        assert!(line.chars().count() <= FACT_MAX_CHARS, "{line}");
        let kept = line.strip_suffix('…').expect("a cut is marked");
        assert!(whole.starts_with(kept), "{line}");
        assert!(
            whole[kept.len()..].starts_with(' '),
            "cut at a word: {line}"
        );
    }
}

#[test]
fn a_filler_opener_the_person_uses_leaves_their_avoid_list() {
    let input = TwinPromptInput::from_rows(
        &profile("Ada"),
        &[tone("email", "", &["Thanks, see you Friday."], &[])],
        &[],
        &[],
        &["OK sure, Tuesday works.", "Thanksgiving is busy"],
        "generic",
    );
    let fillers = &input.quality.filler_openers;
    assert!(
        !fillers.iter().any(|f| f == "thanks"),
        "their exemplar opens with it"
    );
    assert!(
        !fillers.iter().any(|f| f == "ok"),
        "their answer opens with it"
    );
    // Whole words only, and nothing else leaves the list.
    assert!(fillers.iter().any(|f| f == "okay"));
    assert!(fillers.iter().any(|f| f == "thank you"));
    assert_eq!(fillers.len(), FILLER_OPENERS.len() - 2);
    let rules = section(&input, CoreSection::QualityRules);
    assert!(!rules.contains("\"thanks\""));
    assert!(rules.contains("\"thank you\""));
    // The setup filter's list is untouched.
    assert!(FILLER_OPENERS.contains(&"thanks"));
}

#[test]
fn contact_facts_and_unapproved_memories_never_enter_the_core() {
    let pool = crate::db::init_test_db().unwrap();
    let twin = fixture::seed_marek(&pool);
    let core = compile_twin_core(&TwinPromptInput::from_db(&pool, &twin, "email").unwrap());
    assert!(!core.contains("Jana runs QA"), "third-party data stays out");
    assert!(
        !core.contains("four-day week"),
        "a pending memory is a guess"
    );
    assert!(core.contains("- Leads a team of five on the desktop app."));
    assert!(core.contains("- Ships the desktop app every week on Thursday."));
}

#[test]
fn the_dash_rule_follows_the_persons_own_words() {
    let plain = TwinPromptInput::from_rows(&profile("Ada"), &[], &[], &[], &[], "generic");
    assert_eq!(plain.quality.dash_policy, DashPolicy::Avoid);
    assert!(section(&plain, CoreSection::QualityRules).contains(DASH_RULE));

    let dashing_exemplar = TwinPromptInput::from_rows(
        &profile("Ada"),
        &[tone("email", "", &["fine — ship it"], &[])],
        &[],
        &[],
        &[],
        "generic",
    );
    assert_eq!(dashing_exemplar.quality.dash_policy, DashPolicy::Allow);
    assert!(!section(&dashing_exemplar, CoreSection::QualityRules).contains(DASH_RULE));

    let dashing_answer = TwinPromptInput::from_rows(
        &profile("Ada"),
        &[],
        &[],
        &[],
        &["I'd say no — politely"],
        "generic",
    );
    assert_eq!(dashing_answer.quality.dash_policy, DashPolicy::Allow);
}

#[test]
fn the_quality_rules_carry_the_avoid_list_and_the_filler_openers() {
    let rules = section(
        &TwinPromptInput::from_rows(&profile("Ada"), &[], &[], &[], &[], "generic"),
        CoreSection::QualityRules,
    );
    for word in MACHINE_WORDS {
        assert!(rules.contains(&format!("\"{word}\"")), "{word}");
    }
    assert!(rules.contains("\"got it\""));
    assert!(rules.starts_with("Write the way a thoughtful person types"));
}

#[test]
fn json_columns_and_languages_tolerate_garbage() {
    for bad in [
        "not json",
        "{\"a\":1}",
        "\"a string\"",
        "[1, 2, null]",
        "   ",
    ] {
        assert!(json_strings(Some(bad)).is_empty(), "{bad:?}");
    }
    assert_eq!(json_strings(Some(r#"[" a ", "", "b"]"#)), ["a", "b"]);
    assert_eq!(profile_languages(Some(r#"["cs","en","cs"]"#)), ["cs", "en"]);
    assert_eq!(profile_languages(Some("de, fr")), ["de", "fr"]);
    assert!(profile_languages(Some("[]")).is_empty());
    assert!(profile_languages(None).is_empty());
}

// ---------------------------------------------------------------------------
// The card door (RENDERER.md Inputs; SPEC.md 4-6)
// ---------------------------------------------------------------------------

#[test]
fn a_card_built_from_the_database_renders_the_identical_core() {
    let pool = crate::db::init_test_db().unwrap();
    let twin = fixture::seed_marek(&pool);
    let json = serde_json::to_string(&fixture::card_json(&pool, &twin)).unwrap();
    let view = card(&json);
    // Every lane's channel, plus one the twin has no voice for.
    for channel in ["generic", "email", "browser", "slack"] {
        let from_db = TwinPromptInput::from_db(&pool, &twin, channel).unwrap();
        let from_card = TwinPromptInput::from_card(&view, channel);
        assert_eq!(
            compile_twin_core(&from_card),
            compile_twin_core(&from_db),
            "channel {channel}"
        );
        assert_eq!(from_card, from_db, "the views agree too, channel {channel}");
    }
}

#[test]
fn the_published_example_cards_render_in_renderer_order() {
    let full = TwinPromptInput::from_card(&card(FULL_CARD), "email");
    assert_eq!(kinds(&full), ALL_SECTIONS);
    let core = compile_twin_core(&full);
    assert!(core.starts_with("You are writing as Marek Dvořák, Engineering lead.\n"));
    assert!(core.contains("How Marek Dvořák writes on email:\nPolite and concise."));
    assert!(core.contains("- Prefers async updates over status meetings."));
    assert!(core.contains("- Ships the desktop app every week on Thursday."));

    // An unknown channel falls back to the card's default channel.
    let fallback = TwinPromptInput::from_card(&card(FULL_CARD), "telegram");
    assert_eq!(
        fallback.voice.map(|v| v.channel).as_deref(),
        Some("generic")
    );

    let minimal = TwinPromptInput::from_card(&card(MINIMAL_CARD), "generic");
    assert_eq!(
        kinds(&minimal),
        [
            CoreSection::Identity,
            CoreSection::Languages,
            CoreSection::QualityRules
        ]
    );
}

#[test]
fn a_sealed_knowledge_part_renders_no_facts() {
    let mut value: serde_json::Value = serde_json::from_str(FULL_CARD).unwrap();
    value["knowledge"] = serde_json::json!({ "sealed": {
        "alg": "AES-256-GCM", "kdf": "PBKDF2-HMAC-SHA256", "iterations": 600000,
        "salt": "c2FsdA==", "nonce": "bm9uY2U=", "ciphertext": "Y2lwaGVy"
    }});
    let view: CardVoiceView = serde_json::from_value(value).unwrap();
    assert!(matches!(
        view.knowledge,
        Some(CardKnowledgePart::Sealed { .. })
    ));
    let input = TwinPromptInput::from_card(&view, "generic");
    assert!(input.knowledge.is_empty());
    assert!(!kinds(&input).contains(&CoreSection::Facts));
}

#[test]
fn a_memory_with_no_parseable_time_sorts_after_dated_ones() {
    let items = vec![
        PromptFact {
            kind: KnowledgeKind::Memory,
            content: "undated".into(),
            importance: 3,
            observed_at: None,
        },
        PromptFact {
            kind: KnowledgeKind::Memory,
            content: "dated".into(),
            importance: 3,
            observed_at: super::input::parse_time("2026-01-01T00:00:00Z"),
        },
    ];
    assert_eq!(
        super::compile::ordered_knowledge(&items),
        ["dated", "undated"]
    );
}

// ---------------------------------------------------------------------------
// Goldens: the fixture twin's core block per channel
// ---------------------------------------------------------------------------

const GOLDEN_CORE_GENERIC: &str = r#"You are writing as Marek Dvořák, Engineering lead.
Runs the desktop team, ships weekly, mentors two juniors. Writes short, direct messages and uses humour sparingly.
Use masculine grammatical forms when Marek Dvořák refers to themselves.

Marek Dvořák writes in Czech (cs) and English (en). Reply in the language of the message being answered unless told otherwise.

Standing directions from Marek Dvořák, for every draft:
Never promise a date I do not control. Answer the question asked first.

How Marek Dvořák writes:
Plain and direct. Leads with the answer, adds one reason, stops.
Length: One or two sentences
Messages Marek Dvořák actually wrote. Match their register, length and habits, but never copy them:
---
shipping thursday unless QA finds something. will confirm by noon
---
who's blocked and on what? let's take it to a thread, not the channel
---
Do and don't:
- No exclamation marks
- Never open with a greeting in a reply thread

What Marek Dvořák has confirmed about themselves. Stay consistent with it, and state nothing verifiable that neither this nor the material you are given supports:
- Leads a team of five on the desktop app.
- Prefers async updates over status meetings.
- Ships the desktop app every week on Thursday.

Write the way a thoughtful person types to someone they know: plain words, short sentences, contractions where they'd use them. Say the thing directly and stop. Keep praise, thanks and recaps of what was just said out of it, and don't group things in threes for rhythm.
Leave out the words and constructions people now read as machine-written: "delve", "tapestry", "testament", "vibrant", "seamless", "leverage", "elevate", "unlock", "journey", "realm", "crucial", "navigate", "not just x, but y".
Never open with filler that carries nothing, like "great", "awesome", "perfect", "love that", "love it", "nice", "got it", "thank you", "wonderful", "fantastic", "amazing", "absolutely", "that's great", "that's helpful", "that helps", "interesting", "excellent", "cool", "okay", "ok", "understood".
Join clauses with commas and full stops rather than dashes."#;

const GOLDEN_CORE_EMAIL: &str = r#"You are writing as Marek Dvořák, Engineering lead.
Runs the desktop team, ships weekly, mentors two juniors. Writes short, direct messages and uses humour sparingly.
Use masculine grammatical forms when Marek Dvořák refers to themselves.

Marek Dvořák writes in Czech (cs) and English (en). Reply in the language of the message being answered unless told otherwise.

Standing directions from Marek Dvořák, for every draft:
Never promise a date I do not control. Answer the question asked first.

How Marek Dvořák writes on email:
Polite and concise. Signs off with "M."
Length: A short paragraph
Messages Marek Dvořák actually wrote on email. Match their register, length and habits, but never copy them:
---
Thanks Jana, Friday works for the retro.

M.
---
Hi Jana,

The release moves to Thursday; QA found a crash in the updater. I will confirm by noon tomorrow.

M.
---
Do and don't on email:
- Sign off "M."

What Marek Dvořák has confirmed about themselves. Stay consistent with it, and state nothing verifiable that neither this nor the material you are given supports:
- Leads a team of five on the desktop app.
- Prefers async updates over status meetings.
- Ships the desktop app every week on Thursday.

Write the way a thoughtful person types to someone they know: plain words, short sentences, contractions where they'd use them. Say the thing directly and stop. Keep praise, thanks and recaps of what was just said out of it, and don't group things in threes for rhythm.
Leave out the words and constructions people now read as machine-written: "delve", "tapestry", "testament", "vibrant", "seamless", "leverage", "elevate", "unlock", "journey", "realm", "crucial", "navigate", "not just x, but y".
Never open with filler that carries nothing, like "great", "awesome", "perfect", "love that", "love it", "nice", "got it", "thank you", "wonderful", "fantastic", "amazing", "absolutely", "that's great", "that's helpful", "that helps", "interesting", "excellent", "cool", "okay", "ok", "understood".
Join clauses with commas and full stops rather than dashes."#;
