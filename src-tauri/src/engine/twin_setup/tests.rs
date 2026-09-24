//! Engine tests. The LLM is never called: jobs get a scripted [`LlmFn`].

use std::sync::{Arc, Mutex};

use tokio::sync::Notify;

use crate::db::models::{SetupOpener, SetupReadiness, SetupSteer, SetupUpdatedEvent};
use crate::db::repos::twin_setup::{self as repo, NewGoal, NewStep, Placement, PlanRow};
use crate::db::DbPool;
use crate::error::AppError;

use super::jobs::{self, JobCtx};
use super::llm::{LlmFn, TwinCall};
use super::parse::{parse_assess, parse_refill, PlanOut};
use super::session::{self, Want};
use super::{plan, reconcile};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

fn readiness() -> SetupReadiness {
    SetupReadiness {
        identity: "empty".into(),
        tone: "empty".into(),
        channels: "empty".into(),
        memories: "empty".into(),
    }
}

/// A fresh test database with one twin (unique id: the job registry is
/// process-global).
fn twin() -> Result<(DbPool, String), AppError> {
    let pool = crate::db::init_test_db()?;
    let id = uuid::Uuid::new_v4().to_string();
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO twin_profiles (id, name, slug, obsidian_subpath) VALUES (?1, 'Ada', ?1, ?1)",
        rusqlite::params![id],
    )?;
    Ok((pool.clone(), id))
}

fn set_plan(pool: &DbPool, twin_id: &str, edit: impl FnOnce(&mut PlanRow)) -> Result<(), AppError> {
    let mut plan = repo::get_plan(pool, twin_id)?.unwrap_or_else(|| PlanRow::fresh(twin_id));
    edit(&mut plan);
    repo::upsert_plan(pool, &plan)
}

fn goal(pool: &DbPool, twin_id: &str, slot: &str, title: &str) -> Result<String, AppError> {
    let conn = pool.get()?;
    repo::insert_goal_on(
        &conn,
        twin_id,
        &NewGoal {
            slot,
            title,
            intent: "",
            criteria: &[],
        },
    )
}

struct StepSpec<'a> {
    goal: Option<&'a str>,
    stage: &'a str,
    question: &'a str,
    mode: &'a str,
    channel: Option<&'a str>,
    status: &'a str,
    placement: Placement,
}

impl<'a> StepSpec<'a> {
    fn queued(goal: Option<&'a str>, question: &'a str) -> Self {
        Self {
            goal,
            stage: "setup",
            question,
            mode: "pick",
            channel: None,
            status: "queued",
            placement: Placement::Tail,
        }
    }
    fn live(goal: Option<&'a str>, question: &'a str) -> Self {
        Self {
            status: "live",
            ..Self::queued(goal, question)
        }
    }
}

fn step(pool: &DbPool, twin_id: &str, spec: StepSpec) -> Result<String, AppError> {
    let conn = pool.get()?;
    repo::insert_step_on(
        &conn,
        twin_id,
        &NewStep {
            goal_id: spec.goal,
            stage: spec.stage,
            origin: "plan",
            kind: "fact",
            question: spec.question,
            answer_mode: spec.mode,
            incoming: None,
            tone_channel: spec.channel,
            suggestions: &[],
            plan_version: 0,
        },
        spec.status,
        spec.placement,
    )
}

fn status_of(pool: &DbPool, twin_id: &str, step_id: &str) -> Result<String, AppError> {
    let conn = pool.get()?;
    Ok(repo::step_on(&conn, twin_id, step_id)?
        .map(|s| s.status)
        .unwrap_or_default())
}

type CallLog = Arc<Mutex<Vec<(&'static str, String)>>>;
type Events = Arc<Mutex<Vec<SetupUpdatedEvent>>>;

/// A job context whose LLM answers from `reply(site, prompt)`, optionally
/// holding every `setup_plan` call until `gate` is notified.
fn scripted_ctx(
    pool: &DbPool,
    reply: impl Fn(&'static str, &str) -> Result<String, AppError> + Send + Sync + 'static,
    gate: Option<Arc<Notify>>,
) -> (JobCtx, CallLog, Events) {
    let log: CallLog = Arc::new(Mutex::new(Vec::new()));
    let events: Events = Arc::new(Mutex::new(Vec::new()));
    let reply = Arc::new(reply);
    let log_in = log.clone();
    let llm: LlmFn = Arc::new(move |_pool, call: TwinCall, prompt: String| {
        let reply = reply.clone();
        let log = log_in.clone();
        let gate = gate.clone();
        Box::pin(async move {
            if call.site == "setup_plan" {
                if let Some(gate) = gate {
                    gate.notified().await;
                }
            }
            let out = reply(call.site, &prompt);
            log.lock()
                .unwrap_or_else(|e| e.into_inner())
                .push((call.site, prompt));
            out
        })
    });
    let events_in = events.clone();
    let ctx = JobCtx {
        pool: pool.clone(),
        llm,
        emit: Arc::new(move |e| events_in.lock().unwrap_or_else(|p| p.into_inner()).push(e)),
    };
    (ctx, log, events)
}

const PLAN_JSON: &str = r#"{"goals":[{"id":null,"slot":"identity","title":"What they do","intent":"","criteria":["role"]}],
 "observations":["Answers briefly"],
 "steps":[{"goalId":"new:0","kind":"fact","question":"What do you do for work?","answerMode":"pick",
           "suggestions":[{"text":"I build tools","reason":"sets the bio"}]}],
 "changeNote":"First plan."}"#;

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

#[test]
fn twin_setup_open_serves_the_opener_and_wants_a_plan() -> Result<(), AppError> {
    let (pool, twin) = twin()?;
    let opener = SetupOpener {
        slot: "identity".into(),
        question: "What do you do?".into(),
    };
    let out = session::open(
        &pool,
        &twin,
        Some("cs"),
        readiness(),
        Some(opener.clone()),
        false,
    )?;
    assert!(out.wants.contains(&Want::Plan));
    assert!(out.snapshot.planning);
    let live = out
        .snapshot
        .live
        .ok_or_else(|| AppError::NotFound("live".into()))?;
    assert_eq!((live.origin.as_str(), live.goal_id), ("opener", None));
    assert!(live.asked_at.is_some());
    let plan = repo::get_plan(&pool, &twin)?.ok_or_else(|| AppError::NotFound("plan".into()))?;
    assert_eq!(plan.locale.as_deref(), Some("cs"));
    assert!(plan.readiness.is_some() && plan.lease_at.is_some());

    // Reopening while a worker runs and the lease is fresh: same live step,
    // no second plan, no second opener.
    let again = session::open(&pool, &twin, None, readiness(), Some(opener), true)?;
    assert!(!again.wants.contains(&Want::Plan));
    assert_eq!(again.snapshot.live.map(|s| s.id), Some(live.id));
    Ok(())
}

#[test]
fn twin_setup_stale_lease_is_recovered_on_open() -> Result<(), AppError> {
    let (pool, twin) = twin()?;
    set_plan(&pool, &twin, |_| {})?;
    let conn = pool.get()?;
    conn.execute(
        "UPDATE twin_setup_plans SET status = 'building', lease_at = datetime('now', '-10 minutes')
          WHERE twin_id = ?1",
        rusqlite::params![twin],
    )?;
    drop(conn);
    let out = session::open(&pool, &twin, None, readiness(), None, true)?;
    assert!(
        out.wants.contains(&Want::Plan),
        "a lease older than 5 min is stale"
    );

    // Fresh lease + live worker: leave it. Fresh lease + no worker (restart): rebuild.
    let fresh = session::open(&pool, &twin, None, readiness(), None, true)?;
    assert!(!fresh.wants.contains(&Want::Plan));
    let orphaned = session::open(&pool, &twin, None, readiness(), None, false)?;
    assert!(orphaned.wants.contains(&Want::Plan));

    // A failed plan is rebuilt on open too.
    let conn = pool.get()?;
    repo::fail_plan_on(&conn, &twin, "boom")?;
    drop(conn);
    assert!(session::open(&pool, &twin, None, readiness(), None, true)?
        .wants
        .contains(&Want::Plan));
    Ok(())
}

#[test]
fn twin_setup_answer_promotes_the_next_step() -> Result<(), AppError> {
    let (pool, twin) = twin()?;
    set_plan(&pool, &twin, |p| p.status = "ready".into())?;
    let g = goal(&pool, &twin, "identity", "Who")?;
    let live = step(&pool, &twin, StepSpec::live(Some(g.as_str()), "Q live"))?;
    let q1 = step(&pool, &twin, StepSpec::queued(Some(g.as_str()), "Q one"))?;
    let _q2 = step(&pool, &twin, StepSpec::queued(Some(g.as_str()), "Q two"))?;

    let out = session::answer(
        &pool,
        &twin,
        &live,
        Some(" I build tools "),
        None,
        readiness(),
    )?;
    assert_eq!(
        out.snapshot.live.as_ref().map(|s| s.id.as_str()),
        Some(q1.as_str())
    );
    assert_eq!(out.wants, [Want::Reconcile]);
    let answered = &out.snapshot.transcript[0];
    assert_eq!(answered.answer.as_deref(), Some("I build tools"));
    assert!(out.snapshot.reconciling);
    assert_eq!(out.snapshot.goals[0].answered, 1);
    let plan = repo::get_plan(&pool, &twin)?.ok_or_else(|| AppError::NotFound("plan".into()))?;
    assert_eq!(plan.answers_since_deep, 1);
    Ok(())
}

#[test]
fn twin_setup_answer_for_a_non_live_step_is_a_no_op() -> Result<(), AppError> {
    let (pool, twin) = twin()?;
    set_plan(&pool, &twin, |p| p.status = "ready".into())?;
    let live = step(&pool, &twin, StepSpec::live(None, "Q live"))?;
    let queued = step(&pool, &twin, StepSpec::queued(None, "Q next"))?;

    let out = session::answer(&pool, &twin, &queued, Some("x"), None, readiness())?;
    assert!(out.wants.is_empty());
    assert_eq!(out.snapshot.live.map(|s| s.id), Some(live.clone()));
    assert!(out.snapshot.transcript.is_empty());

    // A second answer for a step already answered is the same no-op.
    session::answer(&pool, &twin, &live, Some("first"), None, readiness())?;
    let again = session::answer(&pool, &twin, &live, Some("second"), None, readiness())?;
    assert!(again.wants.is_empty());
    assert_eq!(again.snapshot.transcript.len(), 1);
    assert_eq!(
        again.snapshot.transcript[0].answer.as_deref(),
        Some("first")
    );
    Ok(())
}

#[test]
fn twin_setup_skip_never_stores_a_value() -> Result<(), AppError> {
    let (pool, twin) = twin()?;
    set_plan(&pool, &twin, |p| p.status = "ready".into())?;
    let a = step(&pool, &twin, StepSpec::live(None, "Q a"))?;
    let b = step(&pool, &twin, StepSpec::queued(None, "Q b"))?;
    session::answer(&pool, &twin, &a, None, None, readiness())?;
    let out = session::answer(&pool, &twin, &b, Some("   "), None, readiness())?;
    for s in &out.snapshot.transcript {
        assert_eq!(s.status, "skipped");
        assert_eq!(s.answer, None);
    }
    assert!(out.snapshot.offers.is_empty());
    Ok(())
}

#[test]
fn twin_setup_training_answer_records_the_exact_key_facts() -> Result<(), AppError> {
    let (pool, twin) = twin()?;
    set_plan(&pool, &twin, |p| {
        p.status = "ready".into();
        p.stage = "training".into();
    })?;
    let g = goal(&pool, &twin, "training:values", "Values")?;
    let live = step(
        &pool,
        &twin,
        StepSpec {
            stage: "training",
            ..StepSpec::live(Some(g.as_str()), "What won't you compromise on?")
        },
    )?;
    session::answer(
        &pool,
        &twin,
        &live,
        Some("Honesty, always."),
        None,
        readiness(),
    )?;

    let conn = pool.get()?;
    let (channel, direction, content, summary, facts): (String, String, String, String, String) =
        conn.query_row(
            "SELECT channel, direction, content, summary, key_facts_json FROM twin_communications
              WHERE twin_id = ?1",
            rusqlite::params![twin],
            |r| {
                Ok((
                    r.get("channel")?,
                    r.get("direction")?,
                    r.get("content")?,
                    r.get("summary")?,
                    r.get("key_facts_json")?,
                ))
            },
        )?;
    assert_eq!((channel.as_str(), direction.as_str()), ("training", "out"));
    assert_eq!(content, "Honesty, always.");
    assert_eq!(summary, "Training Q&A: What won't you compromise on?");
    assert_eq!(
        facts,
        r#"{"kind":"training_qa","topic":"values","pairs":[{"q":"What won't you compromise on?","a":"Honesty, always."}]}"#
    );
    let memories: i64 = conn.query_row(
        "SELECT COUNT(id) AS n FROM twin_pending_memories WHERE twin_id = ?1",
        rusqlite::params![twin],
        |r| r.get("n"),
    )?;
    assert_eq!(memories, 1, "create_memory = true");
    assert_eq!(
        session::training_qa_facts("q", "a", None),
        r#"[{"q":"q","a":"a"}]"#,
        "untagged: the bare array trainingQaFacts writes"
    );
    Ok(())
}

#[test]
fn twin_setup_write_answer_becomes_a_sample_offer() -> Result<(), AppError> {
    let (pool, twin) = twin()?;
    set_plan(&pool, &twin, |p| p.status = "ready".into())?;
    let live = step(
        &pool,
        &twin,
        StepSpec {
            mode: "write",
            channel: Some("slack"),
            ..StepSpec::live(None, "Reply to this")
        },
    )?;
    // Something to go live next, so resolved offers stay in view.
    step(&pool, &twin, StepSpec::queued(None, "next"))?;
    let out = session::answer(&pool, &twin, &live, Some("yep, on it"), None, readiness())?;
    assert_eq!(out.snapshot.offers.len(), 1);
    let offer = &out.snapshot.offers[0];
    assert_eq!(
        (
            offer.origin.as_str(),
            offer.kind.as_str(),
            offer.part.as_deref(),
            offer.channel.as_deref()
        ),
        ("sample", "tone", Some("examples"), Some("slack"))
    );
    assert_eq!(offer.value, "yep, on it");
    assert_eq!(out.snapshot.last_answer_offer_ids, [offer.id.clone()]);

    // The verdict flips once; a second verdict and an unknown one change nothing.
    let id = offer.id.clone();
    let after = session::offer_verdict(&pool, &twin, &id, "accepted")?;
    assert_eq!(after.snapshot.offers[0].status, "accepted");
    let again = session::offer_verdict(&pool, &twin, &id, "dismissed")?;
    assert_eq!(again.snapshot.offers[0].status, "accepted");
    assert!(matches!(
        session::offer_verdict(&pool, &twin, &id, "maybe"),
        Err(AppError::Validation(_))
    ));
    Ok(())
}

// ---------------------------------------------------------------------------
// Steer
// ---------------------------------------------------------------------------

#[test]
fn twin_setup_drop_goal_obsoletes_only_its_queued_steps() -> Result<(), AppError> {
    let (pool, twin) = twin()?;
    set_plan(&pool, &twin, |p| p.status = "ready".into())?;
    let g1 = goal(&pool, &twin, "identity", "Who")?;
    let g2 = goal(&pool, &twin, "tone", "How")?;
    let live = step(&pool, &twin, StepSpec::live(Some(g1.as_str()), "live g1"))?;
    let s1 = step(
        &pool,
        &twin,
        StepSpec::queued(Some(g1.as_str()), "queued g1"),
    )?;
    let s2 = step(
        &pool,
        &twin,
        StepSpec::queued(Some(g2.as_str()), "queued g2"),
    )?;

    let out = session::steer(
        &pool,
        &twin,
        SetupSteer::DropGoal {
            goal_id: g1.clone(),
        },
        None,
        readiness(),
    )?;
    assert_eq!(status_of(&pool, &twin, &s1)?, "obsolete");
    assert_eq!(status_of(&pool, &twin, &s2)?, "queued");
    assert_eq!(
        status_of(&pool, &twin, &live)?,
        "live",
        "the live step is never touched"
    );
    assert!(out.wants.contains(&Want::Refill));
    let dropped = out.snapshot.goals.iter().find(|g| g.id == g1);
    assert_eq!(dropped.map(|g| g.state.as_str()), Some("dropped"));

    session::steer(
        &pool,
        &twin,
        SetupSteer::RestoreGoal {
            goal_id: g1.clone(),
        },
        None,
        readiness(),
    )?;
    let pinned = session::steer(
        &pool,
        &twin,
        SetupSteer::PinGoal {
            goal_id: g1.clone(),
            pinned: true,
        },
        None,
        readiness(),
    )?;
    let g = pinned.snapshot.goals.iter().find(|g| g.id == g1);
    assert_eq!(
        g.map(|g| (g.state.as_str(), g.pinned)),
        Some(("open", true))
    );
    assert!(matches!(
        session::steer(
            &pool,
            &twin,
            SetupSteer::DropGoal {
                goal_id: "nope".into()
            },
            None,
            readiness()
        ),
        Err(AppError::NotFound(_))
    ));
    Ok(())
}

#[test]
fn twin_setup_ask_next_swaps_the_live_step() -> Result<(), AppError> {
    let (pool, twin) = twin()?;
    set_plan(&pool, &twin, |p| p.status = "ready".into())?;
    let live = step(&pool, &twin, StepSpec::live(None, "L"))?;
    let a = step(&pool, &twin, StepSpec::queued(None, "A"))?;
    let b = step(&pool, &twin, StepSpec::queued(None, "B"))?;

    let out = session::steer(
        &pool,
        &twin,
        SetupSteer::AskNext { step_id: b.clone() },
        None,
        readiness(),
    )?;
    assert_eq!(out.snapshot.live.map(|s| s.id), Some(b));
    let upcoming: Vec<String> = out.snapshot.upcoming.iter().map(|s| s.id.clone()).collect();
    assert_eq!(
        upcoming,
        [live.clone(), a],
        "the old live step waits at the head"
    );
    assert!(out.snapshot.upcoming[0].asked_at.is_none());
    Ok(())
}

#[test]
fn twin_setup_handoff_is_asked_verbatim_at_the_head() -> Result<(), AppError> {
    let (pool, twin) = twin()?;
    set_plan(&pool, &twin, |p| p.status = "ready".into())?;
    let setup_live = step(&pool, &twin, StepSpec::live(None, "setup q"))?;
    step(
        &pool,
        &twin,
        StepSpec {
            stage: "training",
            ..StepSpec::queued(None, "old training q")
        },
    )?;
    let out = session::steer(
        &pool,
        &twin,
        SetupSteer::EnqueueHandoff {
            questions: vec![
                "  First, exactly this?  ".into(),
                "Then this — verbatim".into(),
                " ".into(),
            ],
        },
        None,
        readiness(),
    )?;
    assert_eq!(out.snapshot.stage, "training");
    let live = out
        .snapshot
        .live
        .ok_or_else(|| AppError::NotFound("live".into()))?;
    assert_eq!(live.question, "First, exactly this?");
    assert_eq!(live.origin, "handoff");
    let upcoming: Vec<&str> = out
        .snapshot
        .upcoming
        .iter()
        .map(|s| s.question.as_str())
        .collect();
    assert_eq!(upcoming[0], "setup q", "the setup step waits, requeued");
    assert_eq!(
        upcoming[1], "Then this — verbatim",
        "no rewrite, dashes kept"
    );
    assert_eq!(upcoming[2], "old training q");
    assert_eq!(status_of(&pool, &twin, &setup_live)?, "queued");
    Ok(())
}

#[test]
fn twin_setup_redeal_obsoletes_the_live_step_and_refills() -> Result<(), AppError> {
    let (pool, twin) = twin()?;
    set_plan(&pool, &twin, |p| p.status = "ready".into())?;
    let live = step(&pool, &twin, StepSpec::live(None, "L"))?;
    let next = step(&pool, &twin, StepSpec::queued(None, "N"))?;
    let out = session::steer(&pool, &twin, SetupSteer::Redeal {}, None, readiness())?;
    assert_eq!(status_of(&pool, &twin, &live)?, "obsolete");
    assert_eq!(out.snapshot.live.map(|s| s.id), Some(next));
    assert_eq!(out.wants, [Want::Refill]);
    Ok(())
}

#[test]
fn twin_setup_stage_and_focus_steers_retarget_the_live_step() -> Result<(), AppError> {
    let (pool, twin) = twin()?;
    set_plan(&pool, &twin, |p| p.status = "ready".into())?;
    let id_goal = goal(&pool, &twin, "identity", "Who")?;
    let tone_goal = goal(&pool, &twin, "tone", "How")?;
    let live = step(
        &pool,
        &twin,
        StepSpec::live(Some(id_goal.as_str()), "identity q"),
    )?;
    let tone_q = step(
        &pool,
        &twin,
        StepSpec::queued(Some(tone_goal.as_str()), "tone q"),
    )?;

    let out = session::steer(
        &pool,
        &twin,
        SetupSteer::FocusSlot {
            slot: "tone".into(),
        },
        None,
        readiness(),
    )?;
    assert_eq!(out.snapshot.live.map(|s| s.id), Some(tone_q));
    assert_eq!(status_of(&pool, &twin, &live)?, "queued");

    let out = session::steer(
        &pool,
        &twin,
        SetupSteer::SetStage {
            stage: "training".into(),
        },
        None,
        readiness(),
    )?;
    assert!(
        out.wants.contains(&Want::Plan),
        "a stage change wants a deep pass"
    );
    assert!(out.snapshot.live.is_none(), "no training step queued yet");
    assert!(matches!(
        session::steer(
            &pool,
            &twin,
            SetupSteer::SetStage {
                stage: "later".into()
            },
            None,
            readiness()
        ),
        Err(AppError::Validation(_))
    ));
    assert!(matches!(
        session::steer(
            &pool,
            &twin,
            SetupSteer::SetTopic {
                preset_id: Some("cooking".into()),
                prompt: None
            },
            None,
            readiness()
        ),
        Err(AppError::Validation(_))
    ));
    Ok(())
}

// ---------------------------------------------------------------------------
// Plan apply
// ---------------------------------------------------------------------------

#[test]
fn twin_setup_plan_apply_keeps_the_skeleton_and_the_operators_goals() -> Result<(), AppError> {
    let (pool, twin) = twin()?;
    set_plan(&pool, &twin, |p| p.status = "building".into())?;
    let dropped = goal(&pool, &twin, "identity", "Dropped original")?;
    let pinned = goal(&pool, &twin, "tone", "Pinned original")?;
    let open = goal(&pool, &twin, "channels", "Open original")?;
    let conn = pool.get()?;
    repo::set_goal_state_on(&conn, &twin, &dropped, "dropped")?;
    repo::set_goal_pinned_on(&conn, &twin, &pinned, true)?;
    drop(conn);
    let live = step(
        &pool,
        &twin,
        StepSpec::live(Some(open.as_str()), "live stays"),
    )?;
    let old = step(
        &pool,
        &twin,
        StepSpec::queued(Some(open.as_str()), "old queued"),
    )?;

    let raw = format!(
        r#"{{"goals":[
            {{"id":"{dropped}","slot":"identity","title":"Model rewrite","intent":"","criteria":[]}},
            {{"id":"{pinned}","slot":"tone","title":"Model rewrite","intent":"","criteria":[]}},
            {{"id":"{open}","slot":"channels","title":"Sharper","intent":"why","criteria":["c1"]}},
            {{"id":null,"slot":"avatar","title":"Out of skeleton","intent":"","criteria":[]}},
            {{"id":null,"slot":"tone","title":"Slack habits","intent":"","criteria":["sign-off"]}}
          ],
          "observations":["a","b","c","d","e","f","g","h","i"],
          "steps":[
            {{"goalId":"new:4","kind":"preference","question":"Which is more you on Slack?","answerMode":"pick"}},
            {{"goalId":"{dropped}","kind":"fact","question":"For a dropped goal","answerMode":"pick"}},
            {{"goalId":"new:3","kind":"fact","question":"For a rejected goal","answerMode":"pick"}}
          ],
          "changeNote":"Sharpened channels."}}"#
    );
    let out: PlanOut = super::parse::parse_plan(&raw, false).map_err(AppError::Validation)?;
    let version = plan::apply_plan(&pool, &twin, &out)?;
    assert_eq!(version, 1);

    let snap = repo::snapshot(&pool, &twin)?;
    let by_id = |id: &str| snap.goals.iter().find(|g| g.id == id).cloned();
    assert_eq!(
        by_id(&dropped).map(|g| (g.title, g.state)),
        Some(("Dropped original".into(), "dropped".into()))
    );
    assert_eq!(
        by_id(&pinned).map(|g| (g.title, g.pinned)),
        Some(("Pinned original".into(), true))
    );
    assert_eq!(by_id(&open).map(|g| g.title), Some("Sharper".into()));
    assert!(
        !snap.goals.iter().any(|g| g.slot == "avatar"),
        "out-of-skeleton slot rejected"
    );
    for slot in super::skeleton::all_slots() {
        assert!(
            snap.goals.iter().any(|g| g.slot == slot),
            "slot {slot} has a goal"
        );
    }
    assert_eq!(snap.observations.len(), 8);
    let upcoming: Vec<&str> = snap.upcoming.iter().map(|s| s.question.as_str()).collect();
    assert_eq!(upcoming, ["Which is more you on Slack?"]);
    assert_eq!(status_of(&pool, &twin, &old)?, "obsolete");
    assert_eq!(status_of(&pool, &twin, &live)?, "live");
    assert_eq!(
        (snap.plan_status.as_str(), snap.change_note.as_deref()),
        ("ready", Some("Sharpened channels."))
    );
    assert!(snap.plan_error.is_none() && !snap.planning);
    Ok(())
}

// ---------------------------------------------------------------------------
// Reconcile apply
// ---------------------------------------------------------------------------

#[test]
fn twin_setup_assess_apply_clamps_stalls_and_covers() -> Result<(), AppError> {
    let (pool, twin) = twin()?;
    set_plan(&pool, &twin, |p| p.status = "ready".into())?;
    let g = goal(&pool, &twin, "identity", "Who")?;
    let other = goal(&pool, &twin, "tone", "How")?;
    let conn = pool.get()?;
    repo::set_goal_progress_on(&conn, &twin, &g, 0.5, "open", 0)?;
    drop(conn);

    // A 0.01 gain is "no gain": stall 1. The examples-part offer is dropped at the door.
    let s1_id = step(&pool, &twin, StepSpec::live(Some(g.as_str()), "q1"))?;
    session::answer(&pool, &twin, &s1_id, Some("an answer"), None, readiness())?;
    let conn = pool.get()?;
    let s1 =
        repo::step_on(&conn, &twin, &s1_id)?.ok_or_else(|| AppError::NotFound("step".into()))?;
    drop(conn);
    let raw = format!(
        r#"{{"coverage":[{{"goalId":"{g}","coverage":0.51}},{{"goalId":"{other}","coverage":7}}],
            "offers":[{{"kind":"tone","part":"examples","channel":"slack","value":"sg","reason":""}},
                      {{"kind":"role","value":"Founder","reason":"said so"}}],
            "followUp":{{"question":"Tell me more about that?","kind":"scene","answerMode":"pick"}},
            "observation":"Short answers"}}"#
    );
    let assess = parse_assess(&raw, false).map_err(AppError::Validation)?;
    assert!(reconcile::apply(
        &pool,
        &twin,
        Some(&s1),
        Some(Ok(assess)),
        None
    )?);
    let snap = repo::snapshot(&pool, &twin)?;
    let goal_now = |id: &str| snap.goals.iter().find(|x| x.id == id).cloned();
    assert_eq!(
        goal_now(&other).map(|x| (x.coverage, x.state)),
        Some((1.0, "covered".into()))
    );
    let conn = pool.get()?;
    assert_eq!(repo::goal_stalls_on(&conn, &twin)?.get(&g), Some(&1));
    let gain: Option<f64> = conn.query_row(
        "SELECT coverage_gain FROM twin_setup_steps WHERE id = ?1",
        rusqlite::params![s1.id],
        |r| r.get("coverage_gain"),
    )?;
    drop(conn);
    assert!(gain.is_some_and(|x| (x - 0.01).abs() < 1e-9));
    let offers: Vec<&str> = snap.offers.iter().map(|o| o.kind.as_str()).collect();
    assert_eq!(offers, ["role"]);
    assert_eq!(snap.observations.len(), 1);

    // The queue was empty, so the follow-up went live at once. Answer it: a
    // real gain resets the stall; >= 0.8 reads covered, and a covered goal
    // takes no follow-up.
    let follow = snap
        .live
        .clone()
        .ok_or_else(|| AppError::NotFound("follow-up live".into()))?;
    assert_eq!(follow.origin, "follow_up");
    assert_eq!(follow.goal_id.as_deref(), Some(g.as_str()));
    session::answer(&pool, &twin, &follow.id, Some("more"), None, readiness())?;
    let conn = pool.get()?;
    let s2 = repo::step_on(&conn, &twin, &follow.id)?
        .ok_or_else(|| AppError::NotFound("step".into()))?;
    drop(conn);
    let raw = format!(
        r#"{{"coverage":[{{"goalId":"{g}","coverage":0.9}}],"offers":[],
            "followUp":{{"question":"Another angle?","kind":"fact","answerMode":"pick"}},"observation":"short answers"}}"#
    );
    let assess = parse_assess(&raw, false).map_err(AppError::Validation)?;
    reconcile::apply(&pool, &twin, Some(&s2), Some(Ok(assess)), None)?;
    let snap = repo::snapshot(&pool, &twin)?;
    let g_now = snap.goals.iter().find(|x| x.id == g).cloned();
    assert_eq!(g_now.map(|x| x.state), Some("covered".into()));
    assert!(!snap.upcoming.iter().any(|s| s.question == "Another angle?"));
    assert_eq!(snap.observations[0].evidence, 2, "same text bumps evidence");
    let conn = pool.get()?;
    assert_eq!(repo::goal_stalls_on(&conn, &twin)?.get(&g), Some(&0));
    Ok(())
}

#[test]
fn twin_setup_failed_assess_retries_once_then_lets_go() -> Result<(), AppError> {
    let (pool, twin) = twin()?;
    set_plan(&pool, &twin, |p| p.status = "ready".into())?;
    let id = step(&pool, &twin, StepSpec::live(None, "q"))?;
    session::answer(&pool, &twin, &id, Some("a"), None, readiness())?;
    let conn = pool.get()?;
    let s = repo::step_on(&conn, &twin, &id)?.ok_or_else(|| AppError::NotFound("step".into()))?;
    drop(conn);
    assert!(!reconcile::apply(
        &pool,
        &twin,
        Some(&s),
        Some(Err("x".into())),
        None
    )?);
    assert!(repo::snapshot(&pool, &twin)?.reconciling);
    assert!(reconcile::apply(
        &pool,
        &twin,
        Some(&s),
        Some(Err("x".into())),
        None
    )?);
    let snap = repo::snapshot(&pool, &twin)?;
    assert!(!snap.reconciling && snap.offers.is_empty());
    Ok(())
}

#[test]
fn twin_setup_refill_never_exceeds_three_queued() -> Result<(), AppError> {
    let (pool, twin) = twin()?;
    set_plan(&pool, &twin, |p| p.status = "ready".into())?;
    let g = goal(&pool, &twin, "identity", "Who")?;
    step(&pool, &twin, StepSpec::live(Some(g.as_str()), "live"))?;
    let stale = step(&pool, &twin, StepSpec::queued(Some(g.as_str()), "stale"))?;
    step(&pool, &twin, StepSpec::queued(Some(g.as_str()), "kept"))?;
    let raw = format!(
        r#"{{"steps":[
            {{"goalId":"{g}","kind":"fact","question":"n1","answerMode":"pick"}},
            {{"goalId":"{g}","kind":"fact","question":"n2","answerMode":"pick"}},
            {{"goalId":"{g}","kind":"fact","question":"n3","answerMode":"pick"}},
            {{"goalId":"{g}","kind":"fact","question":"kept","answerMode":"pick"}},
            {{"goalId":"unknown","kind":"fact","question":"orphan","answerMode":"pick"}}
          ],"obsolete":["{stale}"]}}"#
    );
    let out = parse_refill(&raw, false).map_err(AppError::Validation)?;
    reconcile::apply(&pool, &twin, None, None, Some(out))?;
    let snap = repo::snapshot(&pool, &twin)?;
    let upcoming: Vec<&str> = snap.upcoming.iter().map(|s| s.question.as_str()).collect();
    assert_eq!(upcoming, ["kept", "n1", "n2"]);
    assert_eq!(status_of(&pool, &twin, &stale)?, "obsolete");
    Ok(())
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

#[tokio::test]
async fn twin_setup_single_flight_runs_both_phases_on_one_worker() -> Result<(), AppError> {
    let (pool, twin) = twin()?;
    // An answered, unreconciled step for the reconcile phase to find.
    set_plan(&pool, &twin, |p| p.status = "building".into())?;
    let g = goal(&pool, &twin, "identity", "Who")?;
    let s = step(
        &pool,
        &twin,
        StepSpec::live(Some(g.as_str()), "What do you do?"),
    )?;
    session::answer(&pool, &twin, &s, Some("I build tools"), None, readiness())?;

    let gate = Arc::new(Notify::new());
    let g_for_reply = g.clone();
    let (ctx, log, events) = scripted_ctx(
        &pool,
        move |site, _prompt| {
            Ok(match site {
                "setup_plan" => PLAN_JSON.to_string(),
                "setup_assess" => format!(
                    r#"{{"coverage":[{{"goalId":"{g_for_reply}","coverage":0.4}}],"offers":[],"followUp":null,"observation":null}}"#
                ),
                _ => r#"{"steps":[],"obsolete":[]}"#.to_string(),
            })
        },
        Some(gate.clone()),
    );

    let handle = jobs::schedule(&ctx, &twin, &[Want::Plan])
        .ok_or_else(|| AppError::Internal("first schedule starts a worker".into()))?;
    assert!(jobs::is_running(&twin));
    assert!(
        jobs::schedule(&ctx, &twin, &[Want::Reconcile]).is_none(),
        "a second schedule joins the running worker"
    );
    gate.notify_one();
    handle
        .await
        .map_err(|e| AppError::Internal(format!("worker: {e}")))?;
    assert!(!jobs::is_running(&twin));

    let sites: Vec<&str> = log
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .map(|(site, _)| *site)
        .collect();
    assert_eq!(
        sites.first(),
        Some(&"setup_plan"),
        "the deep pass runs first and alone"
    );
    assert!(
        sites.contains(&"setup_assess"),
        "the reconcile wanted mid-plan still ran"
    );
    let reasons: Vec<String> = events
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .map(|e| e.reason.clone())
        .collect();
    assert_eq!(reasons.first().map(String::as_str), Some("plan_ready"));
    assert!(reasons.iter().any(|r| r == "reconciled"));

    let snap = repo::snapshot(&pool, &twin)?;
    assert_eq!((snap.plan_status.as_str(), snap.plan_version), ("ready", 1));
    assert!(!snap.reconciling);
    Ok(())
}

#[tokio::test]
async fn twin_setup_plan_failure_is_recorded_after_one_repair() -> Result<(), AppError> {
    let (pool, twin) = twin()?;
    set_plan(&pool, &twin, |_| {})?;
    let (ctx, log, events) = scripted_ctx(&pool, |_, _| Ok("not json".to_string()), None);
    let handle = jobs::schedule(&ctx, &twin, &[Want::Plan])
        .ok_or_else(|| AppError::Internal("worker".into()))?;
    handle
        .await
        .map_err(|e| AppError::Internal(format!("worker: {e}")))?;
    let prompts: Vec<String> = log
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .map(|(_, p)| p.clone())
        .collect();
    assert_eq!(prompts.len(), 2, "one call plus ONE repair");
    assert!(prompts[1].contains("Your previous reply could not be used"));
    let snap = repo::snapshot(&pool, &twin)?;
    assert_eq!(snap.plan_status, "failed");
    assert!(snap.plan_error.is_some() && !snap.planning);
    let last = events
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .last()
        .map(|e| e.reason.clone());
    assert_eq!(last.as_deref(), Some("plan_failed"));
    Ok(())
}

#[tokio::test]
async fn twin_setup_repair_retry_recovers_a_bad_first_reply() -> Result<(), AppError> {
    let (pool, _twin) = twin()?;
    let calls = Arc::new(Mutex::new(0usize));
    let calls_in = calls.clone();
    let (ctx, log, _) = scripted_ctx(
        &pool,
        move |_, _| {
            let mut n = calls_in.lock().unwrap_or_else(|e| e.into_inner());
            *n += 1;
            Ok(if *n == 1 {
                "{\"steps\": 5}".to_string()
            } else {
                r#"{"steps":[{"goalId":"g","kind":"fact","question":"Fine?","answerMode":"pick"}],"obsolete":[]}"#
                    .to_string()
            })
        },
        None,
    );
    let out = jobs::call_with_repair(
        &ctx,
        TwinCall::SETUP_REFILL,
        |repair| format!("prompt repair={}", repair.unwrap_or("-")),
        |raw| parse_refill(raw, false),
    )
    .await
    .map_err(AppError::Validation)?;
    assert_eq!(out.steps.len(), 1);
    let prompts: Vec<String> = log
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .map(|(_, p)| p.clone())
        .collect();
    assert!(
        prompts[1].contains("invalid JSON"),
        "the retry is told what was wrong"
    );
    Ok(())
}
