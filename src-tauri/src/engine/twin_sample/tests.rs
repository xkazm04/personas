//! Learn-from-sample engine tests. The LLM is never called: the context gets
//! a scripted [`LlmFn`], and the emit seam records every announcement.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::db::models::{TwinSampleUpdatedEvent, TwinStyle, TwinTone};
use crate::db::repos::twin as twin_repo;
use crate::db::repos::twin_sample::{
    self as repo, NewFact, NewProposal, NewSample, KIND_CONSTRAINT, KIND_DIMS, KIND_EXEMPLAR,
    KIND_LENGTH, KIND_VOICE, PROPOSAL_ACCEPTED, PROPOSAL_DISMISSED, PROPOSAL_EDITED, PROPOSAL_OPEN,
    STATUS_ANALYZING, STATUS_FAILED, STATUS_READY, STATUS_REFUSED,
};
use crate::db::DbPool;
use crate::engine::twin_setup::llm::{LlmFn, TwinCall, LEAN_ARGS};
use crate::error::AppError;

use super::analyze::proposals_for;
use super::parse::Learned;
use super::{accept, guard, jobs, SampleCtx, SAMPLE_MAX_CHARS};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type CallLog = Arc<Mutex<Vec<(&'static str, String)>>>;
type Events = Arc<Mutex<Vec<TwinSampleUpdatedEvent>>>;

/// How long a lane may take to go idle before the test calls it hung.
const IDLE_DEADLINE: Duration = Duration::from_secs(20);
const IDLE_POLL: Duration = Duration::from_millis(10);

const SAMPLE: &str = "Hi Jo,\n\nThursday works for me. I keep Thursdays for client calls anyway, \
so 10:00 is perfect.\n\nSpeak soon,\nAda";

/// A fresh test database with one twin (unique id: the lane registry is
/// process-global).
fn new_twin() -> Result<(DbPool, String), AppError> {
    let pool = crate::db::init_test_db()?;
    let id = uuid::Uuid::new_v4().to_string();
    pool.get()?.execute(
        "INSERT INTO twin_profiles (id, name, slug, obsidian_subpath) VALUES (?1, 'Ada', ?1, ?1)",
        rusqlite::params![id],
    )?;
    Ok((pool, id))
}

fn scripted(
    pool: &DbPool,
    reply: impl Fn(&str) -> Result<String, AppError> + Send + Sync + 'static,
) -> (SampleCtx, CallLog, Events) {
    let log: CallLog = Arc::new(Mutex::new(Vec::new()));
    let events: Events = Arc::new(Mutex::new(Vec::new()));
    let reply = Arc::new(reply);
    let log_in = log.clone();
    let llm: LlmFn = Arc::new(move |_pool, call: TwinCall, prompt: String| {
        let reply = reply.clone();
        let log = log_in.clone();
        Box::pin(async move {
            log.lock()
                .unwrap_or_else(|e| e.into_inner())
                .push((call.site, prompt.clone()));
            reply(&prompt)
        })
    });
    let events_in = events.clone();
    let ctx = SampleCtx {
        pool: pool.clone(),
        llm,
        emit: Arc::new(move |e| events_in.lock().unwrap_or_else(|p| p.into_inner()).push(e)),
    };
    (ctx, log, events)
}

fn full_reply(channel: &str) -> String {
    format!(
        r#"{{"ownWriting": true, "channel": "{channel}", "exemplar": true,
  "voice": "Open with the first name. Keep it to three short sentences. Sign off with Speak soon.",
  "constraints": ["Never use emoji."], "length": "Three short sentences",
  "dims": {{"formality": 2, "warmth": 4, "humor": 2, "energy": 3, "length": 2,
           "directness": 2, "expressiveness": 2, "detail": 2}},
  "facts": [{{"title": "Client calls", "content": "Ada keeps Thursdays for client calls."}}],
  "reason": "A short, warm email that says yes plainly."}}"#
    )
}

fn calls(log: &CallLog) -> Vec<(&'static str, String)> {
    log.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

fn announced(events: &Events) -> Vec<(String, u32)> {
    events
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .map(|e| (e.status.clone(), e.proposals))
        .collect()
}

async fn wait_idle(twin_id: &str) -> Result<(), AppError> {
    let started = Instant::now();
    while jobs::is_running(twin_id) {
        if started.elapsed() > IDLE_DEADLINE {
            return Err(AppError::Internal("the sample lane never went idle".into()));
        }
        tokio::time::sleep(IDLE_POLL).await;
    }
    Ok(())
}

fn sample_row(pool: &DbPool, id: &str) -> Result<crate::db::models::TwinSample, AppError> {
    repo::get_sample(pool, id)?.ok_or_else(|| AppError::NotFound(format!("sample {id}")))
}

// ---------------------------------------------------------------------------
// The tier
// ---------------------------------------------------------------------------

#[test]
fn twin_sample_tier_is_sonnet_low_lean_on_the_per_answer_timeout() {
    let call = TwinCall::SAMPLE_LEARN;
    assert_eq!(call.site, "sample_learn");
    assert_eq!(
        (call.model, call.effort),
        (personas_core::model_ids::SONNET_CURRENT, "low")
    );
    assert_eq!(call.timeout, TwinCall::SETUP_REFILL.timeout);
    let lean: Vec<String> = LEAN_ARGS.iter().map(|a| a.to_string()).collect();
    let args =
        crate::engine::cli_process::headless_claude_args(call.model, call.effort, &lean).args;
    for flag in [
        "--tools",
        "--strict-mcp-config",
        "--disable-slash-commands",
        "--effort",
        "--model",
    ] {
        assert_eq!(args.iter().filter(|a| *a == flag).count(), 1, "{flag} once");
    }
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/// ACCEPTANCE 1: one sample yields one proposal of each kind plus one
/// pending memory; the sample ends `ready` with its channel, and the emit
/// seam announced it with `proposals = 5`.
#[tokio::test]
async fn twin_sample_yields_one_proposal_of_each_kind_and_a_pending_memory() -> Result<(), AppError>
{
    let (pool, twin) = new_twin()?;
    let (ctx, log, events) = scripted(&pool, |_| Ok(full_reply("email")));

    let stored = super::learn(
        &ctx,
        twin.clone(),
        format!("  {SAMPLE}  "),
        "selection".into(),
        Some("mail.example.com".into()),
    )
    .await?;
    assert_eq!(
        stored.status, STATUS_ANALYZING,
        "learn returns before the analysis"
    );
    assert_eq!(stored.text, SAMPLE, "stored trimmed");
    wait_idle(&twin).await?;

    let sample = sample_row(&pool, &stored.id)?;
    assert_eq!(sample.status, STATUS_READY);
    assert_eq!(sample.channel.as_deref(), Some("email"));
    assert!(sample.analyzed_at.is_some());

    let proposals = repo::list_proposals(&pool, &twin, Some(PROPOSAL_OPEN))?;
    let mut kinds: Vec<&str> = proposals.iter().map(|p| p.kind.as_str()).collect();
    kinds.sort_unstable();
    assert_eq!(
        kinds,
        vec![
            KIND_CONSTRAINT,
            KIND_DIMS,
            KIND_EXEMPLAR,
            KIND_LENGTH,
            KIND_VOICE
        ]
    );
    assert!(proposals
        .iter()
        .all(|p| p.channel == "email" && p.sample_id == stored.id));
    let exemplar = proposals
        .iter()
        .find(|p| p.kind == KIND_EXEMPLAR)
        .map(|p| p.value.as_str());
    assert_eq!(
        exemplar,
        Some(SAMPLE),
        "the exemplar is the sample verbatim"
    );
    let dims = proposals
        .iter()
        .find(|p| p.kind == KIND_DIMS)
        .map(|p| p.value.clone())
        .unwrap_or_default();
    let dims: crate::db::models::TwinStyleDims = serde_json::from_str(&dims)?;
    assert_eq!(dims.warmth, 4);

    let memories = twin_repo::list_pending_memories(&pool, &twin, Some("pending"), None)?;
    assert_eq!(memories.len(), 1);
    assert_eq!(memories[0].channel.as_deref(), Some(repo::FACT_CHANNEL));
    assert_eq!(memories[0].importance, 3);
    assert_eq!(memories[0].source_communication_id, None);

    assert_eq!(
        announced(&events),
        vec![
            (STATUS_ANALYZING.to_string(), 0),
            (STATUS_READY.to_string(), 5)
        ]
    );
    assert!(events
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .all(|e| e.twin_id == twin && e.sample_id == stored.id));

    let log = calls(&log);
    assert_eq!(log.len(), 1, "one call, no repair");
    assert_eq!(log[0].0, "sample_learn");
    assert!(
        log[0].1.contains("Thursday works for me."),
        "the prompt carries the sample"
    );
    assert!(log[0].1.contains("<twin-brief>"), "and the twin core");
    // Nothing reached a tone field: the proposals are the preview.
    assert!(twin_repo::list_tones(&pool, &twin)?.is_empty());
    Ok(())
}

/// ACCEPTANCE 2a: a sample equal to a draft the twin placed is refused with
/// no model call.
#[tokio::test]
async fn twin_sample_matching_a_placed_draft_is_refused_without_a_model_call(
) -> Result<(), AppError> {
    let (pool, twin) = new_twin()?;
    twin_repo::record_interaction(
        &pool,
        &twin,
        "browser",
        "out",
        None,
        SAMPLE,
        None,
        Some(r#"{"kind":"placement"}"#),
        false,
    )?;
    let (ctx, log, events) = scripted(&pool, |_| Ok(full_reply("email")));
    let stored = super::learn(&ctx, twin.clone(), SAMPLE.into(), "clipboard".into(), None).await?;
    wait_idle(&twin).await?;

    let sample = sample_row(&pool, &stored.id)?;
    assert_eq!(sample.status, STATUS_REFUSED);
    assert_eq!(sample.error.as_deref(), Some(guard::SELF_AUTHORED_REASON));
    assert!(
        calls(&log).is_empty(),
        "no LLM call for the twin's own text"
    );
    assert!(repo::list_proposals(&pool, &twin, None)?.is_empty());
    assert_eq!(
        announced(&events).last(),
        Some(&(STATUS_REFUSED.to_string(), 0))
    );
    Ok(())
}

/// An approved outbox reply is the twin's output too; a training answer is
/// the person's own and does not block.
#[tokio::test]
async fn twin_sample_outbox_reply_is_refused_and_a_training_answer_is_not() -> Result<(), AppError>
{
    let (pool, twin) = new_twin()?;
    twin_repo::record_interaction(
        &pool,
        &twin,
        "email",
        "out",
        Some("jo@x.com"),
        SAMPLE,
        None,
        None,
        false,
    )?;
    let (ctx, log, _) = scripted(&pool, |_| Ok(full_reply("email")));
    let refused = super::learn(&ctx, twin.clone(), SAMPLE.into(), "selection".into(), None).await?;
    wait_idle(&twin).await?;
    assert_eq!(sample_row(&pool, &refused.id)?.status, STATUS_REFUSED);

    let (pool2, twin2) = new_twin()?;
    let own = "My own answer about how I plan the week, written in training.";
    twin_repo::record_interaction(
        &pool2,
        &twin2,
        "training",
        "out",
        None,
        own,
        None,
        Some(r#"{"kind":"training_qa"}"#),
        false,
    )?;
    let (ctx2, log2, _) = scripted(&pool2, |_| Ok(full_reply("generic")));
    let learned = super::learn(&ctx2, twin2.clone(), own.into(), "clipboard".into(), None).await?;
    wait_idle(&twin2).await?;
    assert_eq!(sample_row(&pool2, &learned.id)?.status, STATUS_READY);
    assert!(calls(&log).is_empty());
    assert_eq!(calls(&log2).len(), 1);
    Ok(())
}

/// ACCEPTANCE 2b: `ownWriting: false` is refused with the model's reason.
#[tokio::test]
async fn twin_sample_not_own_writing_is_refused_with_the_models_reason() -> Result<(), AppError> {
    let (pool, twin) = new_twin()?;
    let (ctx, _, events) = scripted(&pool, |_| {
        Ok(
            r#"{"ownWriting": false, "reason": "This is a newsletter, not a message you wrote."}"#
                .into(),
        )
    });
    let stored = super::learn(&ctx, twin.clone(), SAMPLE.into(), "selection".into(), None).await?;
    wait_idle(&twin).await?;
    let sample = sample_row(&pool, &stored.id)?;
    assert_eq!(sample.status, STATUS_REFUSED);
    assert_eq!(
        sample.error.as_deref(),
        Some("This is a newsletter, not a message you wrote.")
    );
    assert!(repo::list_proposals(&pool, &twin, None)?.is_empty());
    assert!(twin_repo::list_pending_memories(&pool, &twin, None, None)?.is_empty());
    assert_eq!(
        announced(&events).last(),
        Some(&(STATUS_REFUSED.to_string(), 0))
    );
    Ok(())
}

/// A reply unusable twice fails the sample with the door's reason; the retry
/// was told what was wrong.
#[tokio::test]
async fn twin_sample_unusable_twice_fails_with_the_reason() -> Result<(), AppError> {
    let (pool, twin) = new_twin()?;
    let (ctx, log, events) = scripted(&pool, |_| {
        Ok(r#"{"ownWriting": true, "channel": "fax"}"#.into())
    });
    let stored = super::learn(&ctx, twin.clone(), SAMPLE.into(), "selection".into(), None).await?;
    wait_idle(&twin).await?;
    let sample = sample_row(&pool, &stored.id)?;
    assert_eq!(sample.status, STATUS_FAILED);
    assert!(
        sample
            .error
            .as_deref()
            .is_some_and(|e| e.contains("unusable output twice")),
        "{:?}",
        sample.error
    );
    let log = calls(&log);
    assert_eq!(log.len(), 2);
    assert!(log[1].1.contains("could not be used: channel: \"fax\""));
    assert_eq!(
        announced(&events).last(),
        Some(&(STATUS_FAILED.to_string(), 0))
    );
    Ok(())
}

/// A panicking analysis is recorded `failed` (durable) and announced; the
/// lane survives it and goes idle.
#[tokio::test]
async fn twin_sample_panic_is_recorded_as_failed() -> Result<(), AppError> {
    let (pool, twin) = new_twin()?;
    let (ctx, _, events) = scripted(&pool, |_| panic!("scripted model exploded"));
    let stored = super::learn(&ctx, twin.clone(), SAMPLE.into(), "selection".into(), None).await?;
    wait_idle(&twin).await?;
    let sample = sample_row(&pool, &stored.id)?;
    assert_eq!(sample.status, STATUS_FAILED);
    assert_eq!(
        sample.error.as_deref(),
        Some("The analysis stopped unexpectedly.")
    );
    assert_eq!(
        announced(&events).last(),
        Some(&(STATUS_FAILED.to_string(), 0))
    );
    Ok(())
}

/// Holds every scripted model call until opened, so a test can look at a
/// lane while it is provably still running.
#[derive(Default)]
struct Gate {
    open: Mutex<bool>,
    wake: std::sync::Condvar,
}

impl Gate {
    fn wait(&self) {
        let mut open = self.open.lock().unwrap_or_else(|e| e.into_inner());
        while !*open {
            open = self.wake.wait(open).unwrap_or_else(|e| e.into_inner());
        }
    }
    fn release(&self) {
        *self.open.lock().unwrap_or_else(|e| e.into_inner()) = true;
        self.wake.notify_all();
    }
}

/// The lane is single-flight and drains every `analyzing` sample, including
/// one orphaned by a restart, which `list` notices and restarts.
#[tokio::test]
async fn twin_sample_lane_is_single_flight_and_list_recovers_orphans() -> Result<(), AppError> {
    let (pool, twin) = new_twin()?;
    let gate = Arc::new(Gate::default());
    let held = gate.clone();
    let (ctx, log, _) = scripted(&pool, move |_| {
        held.wait();
        Ok(full_reply("email"))
    });
    let mut ids = Vec::new();
    for text in [
        "First sample, written by me to a colleague today.",
        "Second one, also mine, a quick note.",
    ] {
        ids.push(
            repo::insert_sample(
                &pool,
                &NewSample {
                    twin_id: &twin,
                    text,
                    source_kind: "clipboard",
                    source_host: None,
                },
            )?
            .id,
        );
    }
    let listed = super::list(&ctx, twin.clone()).await?;
    assert_eq!(listed.len(), 2);
    assert!(
        jobs::is_running(&twin),
        "list restarted the orphaned analyses"
    );
    assert!(
        jobs::schedule(&ctx, &twin).is_none(),
        "a running lane is joined, not doubled"
    );
    gate.release();
    wait_idle(&twin).await?;
    for id in &ids {
        assert_eq!(sample_row(&pool, id)?.status, STATUS_READY);
    }
    assert_eq!(calls(&log).len(), 2, "one call per sample, none repeated");
    Ok(())
}

#[tokio::test]
async fn twin_sample_learn_validates_its_input() -> Result<(), AppError> {
    let (pool, twin) = new_twin()?;
    let (ctx, log, events) = scripted(&pool, |_| Ok(full_reply("email")));
    let bad_kind = super::learn(&ctx, twin.clone(), "text".into(), "telepathy".into(), None).await;
    assert!(
        matches!(bad_kind, Err(AppError::Validation(_))),
        "{bad_kind:?}"
    );
    let empty = super::learn(&ctx, twin.clone(), "  \n ".into(), "clipboard".into(), None).await;
    assert!(matches!(empty, Err(AppError::Validation(_))), "{empty:?}");
    let bad_host = super::learn(
        &ctx,
        twin.clone(),
        "text".into(),
        "selection".into(),
        Some("https://x.com/a b".into()),
    )
    .await;
    assert!(
        matches!(bad_host, Err(AppError::Validation(_))),
        "{bad_host:?}"
    );
    let no_twin = super::learn(&ctx, "nobody".into(), "text".into(), "forge".into(), None).await;
    assert!(matches!(no_twin, Err(AppError::NotFound(_))), "{no_twin:?}");
    assert!(calls(&log).is_empty() && announced(&events).is_empty());
    Ok(())
}

/// A sample past the cap is stored cut, the prompt says so, and no exemplar
/// is proposed from a message that is not whole.
#[tokio::test]
async fn twin_sample_over_the_cap_is_cut_and_never_an_exemplar() -> Result<(), AppError> {
    let (pool, twin) = new_twin()?;
    let (ctx, log, _) = scripted(&pool, |_| Ok(full_reply("email")));
    let long = "word ".repeat(SAMPLE_MAX_CHARS);
    let stored = super::learn(&ctx, twin.clone(), long, "clipboard".into(), None).await?;
    assert_eq!(stored.text.chars().count(), SAMPLE_MAX_CHARS);
    wait_idle(&twin).await?;
    assert!(calls(&log)[0].1.contains("\"exemplar\" must be false"));
    let kinds: Vec<String> = repo::list_proposals(&pool, &twin, None)?
        .into_iter()
        .map(|p| p.kind)
        .collect();
    assert!(!kinds.iter().any(|k| k == KIND_EXEMPLAR), "{kinds:?}");
    assert_eq!(kinds.len(), 4);
    Ok(())
}

// ---------------------------------------------------------------------------
// De-duplication (pure)
// ---------------------------------------------------------------------------

fn tone(style: Option<&TwinStyle>) -> TwinTone {
    TwinTone {
        id: "t".into(),
        twin_id: "tw".into(),
        channel: "email".into(),
        voice_directives: "Open with the first name.".into(),
        examples_json: Some(serde_json::json!([SAMPLE]).to_string()),
        constraints_json: Some(r#"["Never use emoji."]"#.into()),
        length_hint: Some("Three short sentences".into()),
        style_json: style.map(|s| serde_json::to_string(s).unwrap_or_default()),
        updated_at: String::new(),
    }
}

fn learned() -> Learned {
    Learned {
        channel: "email".into(),
        exemplar: true,
        voice: Some("open with the first name.".into()),
        constraints: vec!["never  use emoji.".into(), "Always say yes plainly.".into()],
        length: Some("Three short sentences".into()),
        dims: Some(
            crate::commands::infrastructure::twin_style::sampler::dims_from([
                2, 4, 2, 3, 2, 2, 2, 2,
            ]),
        ),
        facts: vec![
            NewFact {
                title: None,
                content: "Known already.".into(),
            },
            NewFact {
                title: Some("New".into()),
                content: "Brand new fact.".into(),
            },
            NewFact {
                title: None,
                content: "brand new  fact.".into(),
            },
        ],
        reason: "why".into(),
    }
}

#[test]
fn twin_sample_proposals_skip_what_the_channel_already_holds() {
    let l = learned();
    let style = TwinStyle {
        source: "preset".into(),
        preset_id: Some("warm-helpful".into()),
        name: "Warm".into(),
        summary: String::new(),
        avoid: String::new(),
        dims: l
            .dims
            .unwrap_or(crate::commands::infrastructure::twin_style::sampler::dims_from([3; 8])),
    };
    let known = std::iter::once(guard::normalize("Known already.")).collect();
    let (proposals, facts) = proposals_for(SAMPLE, false, &l, Some(&tone(Some(&style))), &known);
    assert_eq!(
        proposals,
        vec![NewProposal {
            kind: KIND_CONSTRAINT,
            channel: "email".into(),
            value: "Always say yes plainly.".into(),
            reason: Some("why".into()),
        }],
        "the exemplar, voice, the emoji rule, length and dims are already on file"
    );
    assert_eq!(facts.len(), 1, "known and duplicate facts are dropped");
    assert_eq!(facts[0].content, "Brand new fact.");

    let (fresh, _) = proposals_for(SAMPLE, false, &l, None, &Default::default());
    assert_eq!(
        fresh.len(),
        6,
        "a channel with nothing on file takes every proposal"
    );
}

// ---------------------------------------------------------------------------
// The accept door
// ---------------------------------------------------------------------------

/// A ready sample with one open proposal of each kind on `email`, whose tone
/// row has every column set. Returns (proposal id by kind, sample id).
fn ready_sample(
    pool: &DbPool,
    twin: &str,
) -> Result<(Vec<(&'static str, String)>, String), AppError> {
    twin_repo::upsert_tone(
        pool,
        twin,
        "email",
        "Warm and brief.",
        Some(r#"["old example"]"#),
        Some(r#"["Never use emoji."]"#),
        Some("Short"),
    )?;
    let style = TwinStyle {
        source: "preset".into(),
        preset_id: Some("warm-helpful".into()),
        name: "Warm".into(),
        summary: String::new(),
        avoid: String::new(),
        dims: crate::commands::infrastructure::twin_style::sampler::dims_from([3; 8]),
    };
    pool.get()?.execute(
        "UPDATE twin_tones SET style_json = ?2 WHERE twin_id = ?1 AND channel = 'email'",
        rusqlite::params![twin, serde_json::to_string(&style)?],
    )?;
    let sample = repo::insert_sample(
        pool,
        &NewSample {
            twin_id: twin,
            text: SAMPLE,
            source_kind: "selection",
            source_host: None,
        },
    )?;
    let p = |kind: &'static str, value: &str| NewProposal {
        kind,
        channel: "email".into(),
        value: value.into(),
        reason: Some("the sample shows it".into()),
    };
    let all = [
        p(KIND_EXEMPLAR, SAMPLE),
        p(KIND_VOICE, "Open with the first name."),
        p(KIND_CONSTRAINT, "Always say yes plainly."),
        p(KIND_LENGTH, "Three short sentences"),
        p(
            KIND_DIMS,
            r#"{"formality":2,"warmth":4,"humor":2,"energy":3,"length":2,"directness":2,"expressiveness":2,"detail":2}"#,
        ),
    ];
    repo::finish_ready(pool, &sample.id, "email", &all, &[])?;
    let ids = repo::list_proposals(pool, twin, Some(PROPOSAL_OPEN))?
        .into_iter()
        .map(|row| {
            let kind = all
                .iter()
                .find(|n| n.kind == row.kind)
                .map(|n| n.kind)
                .unwrap_or("?");
            (kind, row.id)
        })
        .collect();
    Ok((ids, sample.id))
}

fn id_of(ids: &[(&'static str, String)], kind: &str) -> String {
    ids.iter()
        .find(|(k, _)| *k == kind)
        .map(|(_, id)| id.clone())
        .unwrap_or_default()
}

fn email_tone(pool: &DbPool, twin: &str) -> Result<TwinTone, AppError> {
    twin_repo::get_tone_optional(pool, twin, "email")?
        .ok_or_else(|| AppError::NotFound("tone".into()))
}

/// The tone row's five content columns, for "exactly one changed" checks.
fn columns(t: &TwinTone) -> [Option<String>; 5] {
    [
        Some(t.voice_directives.clone()),
        t.examples_json.clone(),
        t.constraints_json.clone(),
        t.length_hint.clone(),
        t.style_json.clone(),
    ]
}

/// ACCEPTANCE 3: accepting each kind writes exactly its column and leaves the
/// other four as they were.
#[test]
fn twin_sample_accept_writes_exactly_the_targeted_column() -> Result<(), AppError> {
    let (pool, twin) = new_twin()?;
    let (ids, _) = ready_sample(&pool, &twin)?;
    // (kind, the column index it may change)
    for (kind, column) in [
        (KIND_VOICE, 0),
        (KIND_EXEMPLAR, 1),
        (KIND_CONSTRAINT, 2),
        (KIND_LENGTH, 3),
        (KIND_DIMS, 4),
    ] {
        let before = columns(&email_tone(&pool, &twin)?);
        let resolved = accept::resolve(&pool, &id_of(&ids, kind), "accept", None)?;
        assert_eq!(resolved.status, PROPOSAL_ACCEPTED, "{kind}");
        let after = columns(&email_tone(&pool, &twin)?);
        for i in 0..5 {
            if i == column {
                assert_ne!(before[i], after[i], "{kind} must change column {i}");
            } else {
                assert_eq!(before[i], after[i], "{kind} must not touch column {i}");
            }
        }
    }
    let tone = email_tone(&pool, &twin)?;
    assert_eq!(tone.voice_directives, "Open with the first name.");
    assert_eq!(
        tone.examples_json.as_deref(),
        Some(
            serde_json::json!(["old example", SAMPLE])
                .to_string()
                .as_str()
        ),
        "appended, oldest first"
    );
    assert_eq!(
        tone.constraints_json.as_deref(),
        Some(r#"["Never use emoji.","Always say yes plainly."]"#)
    );
    assert_eq!(tone.length_hint.as_deref(), Some("Three short sentences"));
    let style: TwinStyle = serde_json::from_str(tone.style_json.as_deref().unwrap_or("{}"))?;
    assert_eq!(
        (style.source.as_str(), style.preset_id, style.dims.warmth),
        ("learned", None, 4)
    );
    assert_eq!(style.summary, "the sample shows it");
    assert!(repo::list_proposals(&pool, &twin, Some(PROPOSAL_OPEN))?.is_empty());
    Ok(())
}

#[test]
fn twin_sample_edit_records_edited_dismiss_writes_nothing_and_once_is_once() -> Result<(), AppError>
{
    let (pool, twin) = new_twin()?;
    let (ids, _) = ready_sample(&pool, &twin)?;

    let edited = accept::resolve(
        &pool,
        &id_of(&ids, KIND_VOICE),
        "accept",
        Some("  Be brief and kind.  "),
    )?;
    assert_eq!(
        (edited.status.as_str(), edited.value.as_str()),
        (PROPOSAL_EDITED, "Be brief and kind.")
    );
    assert_eq!(
        email_tone(&pool, &twin)?.voice_directives,
        "Be brief and kind."
    );

    // An "edit" that changes nothing is a plain accept.
    let same = accept::resolve(
        &pool,
        &id_of(&ids, KIND_LENGTH),
        "accept",
        Some("Three short sentences"),
    )?;
    assert_eq!(same.status, PROPOSAL_ACCEPTED);

    let before = columns(&email_tone(&pool, &twin)?);
    let dismissed = accept::resolve(&pool, &id_of(&ids, KIND_CONSTRAINT), "dismiss", None)?;
    assert_eq!(dismissed.status, PROPOSAL_DISMISSED);
    assert_eq!(
        columns(&email_tone(&pool, &twin)?),
        before,
        "a dismiss writes no tone column"
    );

    let again = accept::resolve(&pool, &id_of(&ids, KIND_CONSTRAINT), "accept", None);
    assert!(matches!(again, Err(AppError::Validation(_))), "{again:?}");
    let again = accept::resolve(&pool, &id_of(&ids, KIND_VOICE), "dismiss", None);
    assert!(matches!(again, Err(AppError::Validation(_))), "{again:?}");
    let verdict = accept::resolve(&pool, &id_of(&ids, KIND_EXEMPLAR), "maybe", None);
    assert!(
        matches!(verdict, Err(AppError::Validation(_))),
        "{verdict:?}"
    );
    let missing = accept::resolve(&pool, "nope", "accept", None);
    assert!(matches!(missing, Err(AppError::NotFound(_))), "{missing:?}");
    Ok(())
}

/// An edited value goes through the same caps; a style that breaks the pair
/// rules is refused and leaves the proposal open and the row untouched.
#[test]
fn twin_sample_accept_refuses_an_invalid_value_and_writes_nothing() -> Result<(), AppError> {
    let (pool, twin) = new_twin()?;
    let (ids, _) = ready_sample(&pool, &twin)?;
    let before = columns(&email_tone(&pool, &twin)?);

    let incoherent = r#"{"formality":5,"warmth":3,"humor":3,"energy":3,"length":3,"directness":3,"expressiveness":5,"detail":3}"#;
    let refused = accept::resolve(&pool, &id_of(&ids, KIND_DIMS), "accept", Some(incoherent));
    assert!(
        matches!(&refused, Err(AppError::Validation(m)) if m.contains("style.dims")),
        "{refused:?}"
    );
    let long = "x".repeat(200);
    let refused = accept::resolve(&pool, &id_of(&ids, KIND_CONSTRAINT), "accept", Some(&long));
    assert!(
        matches!(refused, Err(AppError::Validation(_))),
        "{refused:?}"
    );

    assert_eq!(columns(&email_tone(&pool, &twin)?), before);
    assert_eq!(
        repo::list_proposals(&pool, &twin, Some(PROPOSAL_OPEN))?.len(),
        5
    );
    Ok(())
}

/// The engine's resolve announces the sample's new open count.
#[tokio::test]
async fn twin_sample_resolve_announces_the_open_count() -> Result<(), AppError> {
    let (pool, twin) = new_twin()?;
    let (ids, sample_id) = ready_sample(&pool, &twin)?;
    let (ctx, _, events) = scripted(&pool, |_| Ok(String::new()));
    super::resolve(&ctx, id_of(&ids, KIND_LENGTH), "dismiss".into(), None).await?;
    let got = events.lock().unwrap_or_else(|e| e.into_inner()).clone();
    assert_eq!(got.len(), 1);
    assert_eq!(
        (
            got[0].sample_id.as_str(),
            got[0].status.as_str(),
            got[0].proposals
        ),
        (sample_id.as_str(), STATUS_READY, 4)
    );
    Ok(())
}

#[tokio::test]
async fn twin_sample_proposals_filter_validates_the_status() -> Result<(), AppError> {
    let (pool, twin) = new_twin()?;
    ready_sample(&pool, &twin)?;
    assert_eq!(
        super::proposals(&pool, twin.clone(), Some("open".into()))
            .await?
            .len(),
        5
    );
    assert_eq!(super::proposals(&pool, twin.clone(), None).await?.len(), 5);
    assert_eq!(
        super::proposals(&pool, twin.clone(), Some("dismissed".into()))
            .await?
            .len(),
        0
    );
    let bad = super::proposals(&pool, twin, Some("pending".into())).await;
    assert!(matches!(bad, Err(AppError::Validation(_))), "{bad:?}");
    Ok(())
}

#[test]
fn twin_sample_cap_chars_cuts_on_a_character_and_flags_it() {
    assert_eq!(super::cap_chars("héllo", 3), ("hél".to_string(), true));
    assert_eq!(super::cap_chars("hé", 3), ("hé".to_string(), false));
}
