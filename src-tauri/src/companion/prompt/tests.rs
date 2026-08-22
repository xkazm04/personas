//! Moved verbatim out of the former single-file `prompt.rs`; the inner
//! `mod tests` wrapper became this file, so every test body is unchanged apart
//! from four columns of indentation.

use crate::companion::brain::retrieval::Recall;
use crate::companion::brain::semantic::Fact;
use crate::companion::observability;
use crate::db::DbPool;

use super::addenda::*;
use super::budget::*;
use super::compose::*;
use super::devices::*;
use super::indexes::*;
use super::memory::*;
use super::scene::*;

use super::*;

fn fact(key: &str, sources: Vec<String>) -> Fact {
    Fact {
        id: format!("fact_{key}"),
        scope: "user".to_string(),
        key: key.to_string(),
        value: format!("{key} value"),
        importance: 3,
        confidence: 0.9,
        sources,
        supersedes_id: None,
        contradicts_id: None,
        updated_at: "2026-01-01T00:00:00Z".to_string(),
    }
}

#[test]
fn language_directive_always_anchors_even_for_english() {
    // Regression (2026-08-05): English emitted no directive, so replayed
    // Spanish history captured every system-triggered turn for weeks.
    // The anchor must exist for every language, unset included.
    let en = language_directive("en");
    assert!(en.contains("The app UI language is `en`"));
    assert!(en.contains("mirror the user"));
    assert_eq!(language_directive(""), en, "unset falls back to en");
    assert_eq!(language_directive("  "), en, "blank falls back to en");
    let es = language_directive("es");
    assert!(es.contains("The app UI language is `es`"));
}

#[test]
fn format_facts_skips_a_fact_with_no_sources_rather_than_fabricate_one() {
    // Regression: this used to render the literal string "no-sources" as
    // if it were a real citation, teaching the model that uncited memory
    // is a legitimate shape. `semantic::write_fact` already refuses to
    // persist a sourceless fact, so reaching this case at all means the
    // write-time invariant was bypassed; the render must skip it (like
    // `consolidation.rs`'s `continue` on the same check), never fabricate
    // a placeholder citation.
    let facts = vec![
        fact("cited", vec!["ep_1".to_string()]),
        fact("uncited", vec![]),
    ];
    let out = format_facts(&facts);
    assert!(out.contains("cited"));
    assert!(out.contains("[from ep_1]"));
    assert!(!out.contains("uncited"));
    assert!(!out.contains("no-sources"));
}

#[test]
fn format_facts_empty_input_is_empty_string() {
    assert_eq!(format_facts(&[]), "");
}

// ─────────────────────────────────────────────────────────────────────
// Fleet index blocks
// ─────────────────────────────────────────────────────────────────────

/// In-memory system pool carrying only the columns the three index
/// blocks read. Deliberately not the full schema: the blocks are lean
/// projections and the test should fail loudly if that ever changes.
fn index_test_pool() -> DbPool {
    let manager = r2d2_sqlite::SqliteConnectionManager::memory();
    let pool = r2d2::Pool::builder()
        .max_size(1)
        .build(manager)
        .expect("pool");
    pool.get()
        .unwrap()
        .execute_batch(
            "CREATE TABLE personas (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
                system_prompt TEXT NOT NULL DEFAULT '', model_profile TEXT,
                enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL);
             CREATE TABLE dev_projects (id TEXT PRIMARY KEY, name TEXT NOT NULL,
                root_path TEXT NOT NULL);
             CREATE TABLE dev_context_groups (id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL, name TEXT NOT NULL);
             CREATE TABLE dev_contexts (id TEXT PRIMARY KEY, project_id TEXT,
                group_id TEXT, name TEXT NOT NULL, description TEXT,
                pinned INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);",
        )
        .unwrap();
    pool
}

/// A realistic UUID for fixture row N — the point of the persona block
/// is that Athena can copy one of these verbatim.
fn fixture_uuid(n: usize) -> String {
    format!("6f1c9a2b-4d3e-4f5a-9b8c-{n:012}")
}

fn seed_index_fixtures(pool: &DbPool, personas: usize, contexts: usize) {
    let conn = pool.get().unwrap();
    conn.execute(
        "INSERT INTO dev_projects (id, name, root_path) VALUES ('proj_1', 'Personas', 'C:/repo')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO dev_context_groups (id, project_id, name)
         VALUES ('grp_1', 'proj_1', 'Agent Platform')",
        [],
    )
    .unwrap();
    for n in 0..personas {
        conn.execute(
            "INSERT INTO personas (id, name, description, system_prompt, model_profile, enabled, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                fixture_uuid(n),
                format!("Agent {n}"),
                format!("Handles workload number {n} across the whole fleet, end to end."),
                "You are a helpful agent. ".repeat(40),
                r#"{"model":"claude-sonnet-4-6"}"#,
                // Every 7th persona disabled, so ordering has something to sort.
                i64::from(n % 7 != 0),
                format!("2026-01-01T00:{:02}:00Z", n % 60),
            ],
        )
        .unwrap();
    }
    for n in 0..contexts {
        conn.execute(
            "INSERT INTO dev_contexts (id, project_id, group_id, name, description, pinned, updated_at)
             VALUES (?1, 'proj_1', 'grp_1', ?2, ?3, ?4, ?5)",
            rusqlite::params![
                format!("ctx_{n:04}"),
                format!("Context {n}"),
                format!("The {n}th feature area of the application, with a long description."),
                i64::from(n % 11 == 0),
                format!("2026-02-01T00:{:02}:00Z", n % 60),
            ],
        )
        .unwrap();
    }
}

fn fixture_skills(count: usize) -> Vec<SkillIndexEntry> {
    (0..count)
        .map(|n| SkillIndexEntry {
            name: format!("skill-number-{n:03}"),
            scope: "global".to_string(),
            description: format!(
                "Use this skill when you need to do job {n}, which is a long \
                 multi-clause description that would blow any budget if unbounded."
            ),
            path: format!("/skills/skill-number-{n:03}/SKILL.md"),
        })
        .collect()
}

#[test]
fn index_blocks_stay_under_budget_with_200_fixtures() {
    let pool = index_test_pool();
    seed_index_fixtures(&pool, 200, 200);
    let personas = format_persona_index(&pool);
    let contexts = format_context_index(&pool);
    let skills = render_skill_index(&fixture_skills(200));

    assert!(
        personas.len() <= PERSONA_INDEX_CHARS,
        "persona block {} > cap {PERSONA_INDEX_CHARS}",
        personas.len()
    );
    assert!(
        contexts.len() <= CONTEXT_INDEX_CHARS,
        "context block {} > cap {CONTEXT_INDEX_CHARS}",
        contexts.len()
    );
    assert!(
        skills.len() <= SKILL_INDEX_CHARS,
        "skill block {} > cap {SKILL_INDEX_CHARS}",
        skills.len()
    );
    assert!(
        personas.len() + contexts.len() + skills.len() <= INDEX_CHAR_BUDGET,
        "combined {} > budget {INDEX_CHAR_BUDGET}",
        personas.len() + contexts.len() + skills.len()
    );
}

/// A synthetic canvas scene: `count` projects, each with a full fifteen
/// cells of which many are unhealthy and carry long detail strings, so the
/// fixture pushes on the budget the way a real 50-project portfolio would.
fn fixture_scene(count: usize) -> crate::companion::canvas::CanvasScene {
    let states = ["critical", "warning", "building", "healthy"];
    let statuses = ["alert", "risk", "unknown", "absent", "solid", "partial"];
    let projects: Vec<String> = (0..count)
        .map(|n| {
            let dims: Vec<String> = (0..15)
                .map(|d| {
                    format!(
                        r#"{{"key":"dim{d}","label":"Dimension {d}","status":"{}",
                            "detail":"a long concrete detail string naming a tool and a number {n}"}}"#,
                        statuses[(n + d) % statuses.len()]
                    )
                })
                .collect();
            format!(
                r#"{{"slug":"project-slug-{n:03}","name":"Project Number {n} With A Long Name",
                     "state":"{}","attention":{},"blockers":{},"fleet":{},
                     "dims":[{}]}}"#,
                states[n % states.len()],
                n % 7 == 0,
                n % 5,
                n % 3,
                dims.join(",")
            )
        })
        .collect();
    serde_json::from_str(&format!(
        r#"{{"version":1,"publishedAt":"2026-08-04T09:00:00Z",
             "families":{{"scans":"failed","goals":"loaded"}},
             "projects":[{}]}}"#,
        projects.join(",")
    ))
    .expect("fixture scene parses")
}

#[test]
fn scene_digest_stays_under_its_own_budget_with_50_projects() {
    let digest = render_scene_digest(&fixture_scene(50));
    assert!(
        digest.len() <= SCENE_CHAR_BUDGET,
        "scene digest {} > cap {SCENE_CHAR_BUDGET}",
        digest.len()
    );
    // Its budget is its OWN: adding it must not have shrunk the three
    // index blocks, which is the failure mode a shared budget invites.
    assert_eq!(
        PERSONA_INDEX_CHARS + CONTEXT_INDEX_CHARS + SKILL_INDEX_CHARS,
        INDEX_CHAR_BUDGET
    );
}

#[test]
fn a_truncated_scene_digest_still_reports_the_true_project_count() {
    let digest = render_scene_digest(&fixture_scene(50));
    assert!(digest.contains("of 50 projects"), "{digest}");
    assert!(
        !digest.contains("Listing 50 of 50"),
        "50 projects must actually truncate, or the honesty line is decorative"
    );
    // The escape hatches must survive truncation.
    assert!(digest.contains("describe_canvas_project"), "{digest}");
    assert!(digest.contains("describe_canvas_freshness"), "{digest}");
    // And the degraded family must be named, since cells fed by it lie.
    assert!(digest.contains("scans (failed)"), "{digest}");
}

#[test]
fn the_scene_digest_leads_with_what_needs_attention() {
    // Ordering is the product here: the block is a triage surface, so a
    // blocked session must outrank an alphabetically earlier healthy row.
    let scene: crate::companion::canvas::CanvasScene = serde_json::from_str(
        r#"{"version":1,"projects":[
            {"slug":"aaa-fine","name":"Fine","state":"healthy"},
            {"slug":"zzz-blocked","name":"Blocked","state":"healthy","attention":true},
            {"slug":"mmm-critical","name":"Critical","state":"critical"}
        ]}"#,
    )
    .unwrap();
    let digest = render_scene_digest(&scene);
    let pos = |s: &str| digest.find(s).unwrap_or(usize::MAX);
    assert!(pos("zzz-blocked") < pos("mmm-critical"), "{digest}");
    assert!(pos("mmm-critical") < pos("aaa-fine"), "{digest}");
    assert!(digest.contains("NEEDS YOU"), "{digest}");
}

#[test]
fn no_published_scene_means_no_block_at_all() {
    // A user who never opens Mastermind must not pay prompt budget for it.
    let pool = index_test_pool();
    assert_eq!(format_scene_digest(&pool), "");
}

// ── Paired devices (WP3) ────────────────────────────────────────────
//
// Asserted through the render half so the SAME shape is pinned in both
// feature sets: the data half is `p2p`-gated, the doctrine surface is not.

fn device_row(name: &str, is_home: bool, reachable: bool) -> PairedDeviceRow {
    PairedDeviceRow {
        name: name.into(),
        is_home,
        reachable,
    }
}

#[test]
fn no_paired_devices_means_no_block_at_all() {
    // Not an empty header — a user who never paired anything pays nothing,
    // on every single turn. This is also the LITE-build shape: there
    // `paired_device_rows` always returns empty.
    assert_eq!(render_paired_devices(&[]), "");
    let pool = index_test_pool();
    assert_eq!(format_paired_devices(&pool), "");
}

#[test]
fn one_paired_device_renders_its_name_home_flag_and_reachability() {
    let block = render_paired_devices(&[device_row("Studio Mac", true, true)]);
    assert!(block.contains("# Paired devices"), "{block}");
    // The row carries all three facts, in one line she cannot misread.
    assert!(
        block.contains("- **Studio Mac** — home device · reachable\n"),
        "{block}"
    );
    // The two rules she cannot derive from the list itself.
    assert!(block.contains("never invent one"), "{block}");
    assert!(
        block.contains("Omitting `device` means the home device"),
        "{block}"
    );
    // A complete list carries no truncation footer.
    assert!(!block.contains("Listing"), "{block}");
}

#[test]
fn several_devices_lead_with_home_and_mark_the_unreachable_ones() {
    let block = render_paired_devices(&[
        device_row("Desktop", true, true),
        device_row("Air", false, false),
        device_row("Work laptop", false, true),
    ]);
    let pos = |s: &str| block.find(s).unwrap_or(usize::MAX);
    assert!(pos("Desktop") < pos("Air"), "home leads: {block}");
    assert!(
        pos("Air") < pos("Work laptop"),
        "then alphabetical: {block}"
    );
    // Exactly one row is marked home, and the sleeping machine says so.
    assert_eq!(block.matches("— home device").count(), 1, "{block}");
    assert!(block.contains("Air** — unreachable right now"), "{block}");
    assert!(block.contains("Work laptop** — reachable"), "{block}");
}

#[test]
fn the_device_block_stays_inside_its_own_budget_and_says_when_it_cut() {
    let many: Vec<PairedDeviceRow> = (0..60)
        .map(|i| device_row(&format!("Device number {i:02}"), i == 0, i % 2 == 0))
        .collect();
    let block = render_paired_devices(&many);
    assert!(
        block.len() <= DEVICE_CHAR_BUDGET,
        "device block grew to {} chars (budget {DEVICE_CHAR_BUDGET})",
        block.len()
    );
    assert!(block.contains("of 60 paired devices"), "{block}");
    assert!(!block.contains("Listing 60 of 60"), "{block}");
}

#[test]
fn truncated_blocks_still_report_the_true_total() {
    // The whole point of the cap: a partial list that reads as complete
    // is worse than no list, because she'd conclude an agent doesn't
    // exist. Each block must name the real total and the escape hatch.
    let pool = index_test_pool();
    seed_index_fixtures(&pool, 200, 200);
    let personas = format_persona_index(&pool);
    let contexts = format_context_index(&pool);
    let skills = render_skill_index(&fixture_skills(200));

    assert!(personas.contains("of 200 agents"), "{personas}");
    assert!(personas.contains("describe_persona"));
    assert!(personas.contains("list_teams"));
    assert!(contexts.contains("of 200 contexts"), "{contexts}");
    assert!(contexts.contains("describe_context"));
    assert!(skills.contains("of 200 installed skills"), "{skills}");
    assert!(skills.contains("describe_skill"));

    // And they really are truncated at this corpus size, so the
    // "showing N of M" wording is load-bearing rather than decorative.
    assert!(!personas.contains("Listing 200 of 200"));
    assert!(!contexts.contains("Listing 200 of 200"));
    assert!(!skills.contains("Listing 200 of 200"));
}

#[test]
fn persona_index_carries_a_real_uuid_and_enabled_agents_first() {
    let pool = index_test_pool();
    seed_index_fixtures(&pool, 200, 0);
    let out = format_persona_index(&pool);
    // Agent 59 is enabled (only every 7th is disabled) and carries the
    // newest updated_at, so it heads the list; its id must be
    // verbatim-copyable out of the block.
    assert!(out.contains(&fixture_uuid(59)), "{out}");
    // Agent 0 is the disabled one; enabled rows sort ahead of it, and at
    // this corpus size the disabled tail never fits.
    assert!(!out.contains(" · DISABLED"), "{out}");
}

#[test]
fn small_corpus_renders_completely() {
    let pool = index_test_pool();
    seed_index_fixtures(&pool, 3, 2);
    let personas = format_persona_index(&pool);
    assert!(personas.contains("Listing 3 of 3 agents"), "{personas}");
    assert!(personas.contains(&fixture_uuid(0)));
    assert!(personas.contains(&fixture_uuid(2)));
    let contexts = format_context_index(&pool);
    assert!(contexts.contains("Listing 2 of 2 contexts"), "{contexts}");
}

#[test]
fn empty_corpus_emits_nothing() {
    let pool = index_test_pool();
    assert_eq!(format_persona_index(&pool), "");
    assert_eq!(format_context_index(&pool), "");
    assert_eq!(render_skill_index(&[]), "");
}

#[test]
fn model_tier_label_reduces_to_the_family_word() {
    assert_eq!(model_tier_label(r#"{"model":"claude-opus-4-5"}"#), "opus");
    assert_eq!(model_tier_label(r#"{"model":"claude-haiku-4-5"}"#), "haiku");
    assert_eq!(model_tier_label(""), "default tier");
    assert_eq!(model_tier_label("not json"), "default tier");
    assert_eq!(model_tier_label(r#"{"model":"qwen-max"}"#), "qwen-max");
}

#[test]
fn observability_digest_no_longer_duplicates_the_persona_listing() {
    // Reconciliation guard: two persona lists in one prompt (one with
    // ids, one without) is what taught Athena to name agents she could
    // not act on. `format_persona_index` is authoritative now.
    let digest = observability::ObservabilityDigest {
        personas_total: 3,
        personas_enabled: 2,
        top_personas: vec!["Scout".to_string(), "Archivist".to_string()],
        ..Default::default()
    };
    let out = observability::format_for_prompt(&digest);
    assert!(!out.contains("Recently active"), "{out}");
    assert!(!out.contains("Scout"), "{out}");
    // Counts still belong to the digest.
    assert!(out.contains("3 total, 2 enabled"));
}

// ─────────────────────────────────────────────────────────────────────
// Per-block size ledger
// ─────────────────────────────────────────────────────────────────────

fn empty_recall() -> Recall {
    Recall {
        episodes: Vec::new(),
        doctrine: Vec::new(),
        facts: Vec::new(),
        procedurals: Vec::new(),
        goals: Vec::new(),
        backlog: Vec::new(),
    }
}

#[test]
fn compose_output_is_byte_identical_under_instrumentation() {
    // The size ledger AND the churn hashes (2026-08-08) must both be pure
    // observation — a "measurement" that perturbs the prompt would make
    // every L2 before/after comparison meaningless. This pins the composed
    // string against a hand-written expectation assembled in compose()'s
    // documented order, so any future edit that "just" reorders or
    // re-pads a block while touching the instrumentation fails here
    // rather than silently changing what the model reads.
    let recall = empty_recall();
    let (out, _) = compose(
        "CONSTITUTION",
        "IDENTITY",
        "OBSERVABILITY",
        &recall,
        None,
        "PLUGINS",
        "CONNECTORS",
        "ONBOARDING",
        "VOICE",
        "DISPLAY",
        "MODE",
    );
    // Empty recall + no briefing ⇒ all six memory blocks and the
    // synthesis block render as "" (asserted separately for facts in
    // `format_facts_empty_input_is_empty_string`).
    let expected = format!(
        "CONSTITUTION\n\n# Identity (live, evolves)\n\nIDENTITY\
         OBSERVABILITYPLUGINSCONNECTORSONBOARDINGVOICEDISPLAY{tools}{delegation}MODE",
        tools = tools_addendum(),
        delegation = delegation_addendum(),
    );
    assert_eq!(out, expected);
}

#[test]
fn block_sizes_report_every_block_and_the_real_total() {
    let mut recall = empty_recall();
    recall.facts = vec![fact("alpha", vec!["identity.md".to_string()])];
    let facts_len = format_facts(&recall.facts).len();
    assert!(
        facts_len > 0,
        "fixture should render a non-empty facts block"
    );

    let (out, sizes) = compose(
        "CONSTITUTION",
        "IDENTITY",
        "OBSERVABILITY",
        &recall,
        None,
        "PLUGINS",
        "CONNECTORS",
        "ONBOARDING",
        "VOICE",
        "DISPLAY",
        "MODE",
    );

    // `total` is the real composed length, never a sum of estimates.
    assert_eq!(sizes.total(), out.len());

    let json = sizes.to_json().expect("breakdown serializes");
    let map: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(&json).expect("breakdown is a JSON object");
    for name in [
        "constitution",
        "identity",
        "observability",
        "recall",
        "briefing",
        "plugins",
        "connectors",
        "onboarding",
        "voice",
        "display",
        "mode_addenda",
        "static_addenda",
    ] {
        assert!(map.contains_key(name), "missing block {name} in {json}");
    }
    assert_eq!(
        map["constitution"].as_u64(),
        Some("CONSTITUTION".len() as u64)
    );
    assert_eq!(map["mode_addenda"].as_u64(), Some("MODE".len() as u64));
    // The six raw memory blocks collapse into one `recall` bucket.
    assert_eq!(map["recall"].as_u64(), Some(facts_len as u64));
    // No briefing was passed, so that bucket is genuinely zero.
    assert_eq!(map["briefing"].as_u64(), Some(0));
    // The blocks account for everything but compose()'s own headings.
    let block_sum: u64 = map.values().filter_map(serde_json::Value::as_u64).sum();
    assert!(block_sum <= sizes.total() as u64);
    assert!(
        sizes.total() as u64 - block_sum < 128,
        "scaffolding drifted"
    );
}

/// The hash must be a pure function of the bytes, stable across calls and
/// processes — a churn series compares hashes recorded days apart. It must
/// also actually discriminate: a same-length, different-content block is
/// precisely the case the size ledger is blind to.
#[test]
fn block_hashes_are_stable_and_content_sensitive() {
    let recall = empty_recall();
    let compose_with = |identity: &str| {
        let (_, sizes) = compose(
            "CONSTITUTION",
            identity,
            "OBSERVABILITY",
            &recall,
            None,
            "PLUGINS",
            "CONNECTORS",
            "ONBOARDING",
            "VOICE",
            "DISPLAY",
            "MODE",
        );
        let json = sizes.hashes_json().expect("hashes serialize");
        serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&json)
            .expect("hashes are a JSON object")
    };

    let a = compose_with("IDENTITY");
    let b = compose_with("IDENTITY");
    assert_eq!(a, b, "same input must hash the same, every time");

    // Every measured block reports a hash, and it is 16 hex chars.
    for (name, value) in &a {
        let hex = value
            .as_str()
            .unwrap_or_else(|| panic!("{name} not a string"));
        assert_eq!(hex.len(), 16, "{name} hash is not 16 hex chars: {hex}");
        assert!(
            hex.chars().all(|c| c.is_ascii_hexdigit()),
            "{name} hash is not hex: {hex}"
        );
    }

    // Same length, different bytes — invisible to `to_json()`, caught here.
    let c = compose_with("IDENTITZ");
    assert_ne!(
        a["identity"], c["identity"],
        "a same-length content change must move the hash"
    );
    assert_eq!(
        a["constitution"], c["constitution"],
        "an untouched block must keep its hash"
    );
}

#[test]
fn every_measured_block_has_a_budget() {
    // A block added to compose() without a budget entry would be
    // measured but never audited — the exact silence this feature exists
    // to end.
    let recall = empty_recall();
    let (_, sizes) = compose("", "", "", &recall, None, "", "", "", "", "", "");
    for (name, _) in &sizes.blocks {
        assert!(budget_for(name).is_some(), "block {name} has no budget");
    }
}
