//! Proposal job: per registered project, 2-4 directions with an evidence line
//! (status, merges, asks, git ahead-behind) from the Athena engine. WP1 owns.
//!
//! [`spawn`] returns at once; the job runs in the background behind a panic
//! boundary (`background_job::spawn_guarded`). For every undecided `direction`
//! card of a DRAFT revision it:
//!
//! 1. builds ONE evidence line from real state, read now and never invented by
//!    the model ([`evidence_line`]): the last commits (`git log -3`), ahead /
//!    behind against the upstream as of the LAST fetch (no fetch is run: it can
//!    hang on the network, and a stale count is labelled as such), the open
//!    App Master asks and the charter's state (the mandate list), and a live
//!    headless App Master's beat;
//! 2. asks the Athena engine for 2-4 [`DirectionProposal`]s and, when
//!    warranted, agent changes (`create_agent` / `retune_agent`), through the
//!    same one-shot engine path the night planner used
//!    (`brain::oneshot::call_claude_text`, ASIDE tier, metered as its own
//!    leg);
//! 3. writes the card (and any agent-change cards) and emits
//!    `standup://updated`, so cards fill in one by one.
//!
//! A project whose call fails keeps `proposals: []` with its evidence line:
//! the operator decides it by typing a direction. Three projects are asked at
//! a time. A second `standup_propose` for a revision whose job is still running
//! is a no-op.

use std::collections::HashSet;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::StreamExt;
use serde::Deserialize;
use tauri::{AppHandle, Manager};

use crate::companion::brain::oneshot::{call_claude_text, extract_json_span};
use crate::db::{DbPool, UserDbPool};
use crate::error::AppError;
use crate::AppState;

use super::model::{
    CreateAgentSpec, DirectionProposal, RetuneAgentSpec, StandupItemKind, StandupItemState,
    StandupStatus,
};
use super::{plan, service};

/// The turn-ledger leg token of a proposal call (`companion_turn.trigger_kind`).
const LEG_STANDUP_PROPOSE: &str = crate::companion::brain::oneshot::leg::STANDUP_PROPOSE;

/// Per-project call budget.
const PROPOSE_TIMEOUT: Duration = Duration::from_secs(120);
/// Projects asked at once.
const PARALLEL: usize = 3;
const MAX_PROPOSALS: usize = 4;
const MAX_AGENT_CHANGES: usize = 2;
const MAX_TEXT_CHARS: usize = 400;
const MAX_CHARTER_CHARS: usize = 1200;

/// Revisions whose job is running in this process.
static IN_FLIGHT: Mutex<Option<HashSet<String>>> = Mutex::new(None);

fn claim_in_flight(standup_id: &str) -> bool {
    let mut guard = IN_FLIGHT.lock().unwrap_or_else(|e| e.into_inner());
    guard
        .get_or_insert_with(HashSet::new)
        .insert(standup_id.to_string())
}

fn release_in_flight(standup_id: &str) {
    let mut guard = IN_FLIGHT.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(set) = guard.as_mut() {
        set.remove(standup_id);
    }
}

/// Start the proposal job for a draft revision. Returns at once; `false` when
/// a job for it is already running.
pub fn spawn(app: AppHandle, standup_id: String) -> bool {
    if !claim_in_flight(&standup_id) {
        return false;
    }
    let id_for_panic = standup_id.clone();
    let app_for_panic = app.clone();
    let _detached = crate::background_job::spawn_guarded(
        "standup_propose",
        standup_id.clone(),
        async move {
            if let Err(e) = run(&app, &standup_id).await {
                tracing::warn!(standup_id = %standup_id, error = %e, "standup: proposal job failed");
            }
            release_in_flight(&standup_id);
            service::emit_updated(&app, &standup_id);
        },
        move |_msg| async move {
            // The panic is logged by the boundary; the durable state is the
            // plan itself (cards that got no proposals stay decidable by hand).
            release_in_flight(&id_for_panic);
            service::emit_updated(&app_for_panic, &id_for_panic);
        },
    );
    true
}

/// What the job needs to ask about one project.
struct Ask {
    item_id: String,
    project_id: String,
    name: String,
    root: String,
    description: Option<String>,
}

async fn run(app: &AppHandle, standup_id: &str) -> Result<(), AppError> {
    let state = app.state::<Arc<AppState>>();
    let (db, user_db) = (state.db.clone(), state.user_db.clone());
    let s = plan::require(&user_db, standup_id)?;
    if s.status != StandupStatus::Draft {
        return Ok(());
    }
    let projects = crate::db::repos::dev_tools::list_projects(&db, None)?;
    let asks: Vec<Ask> = s
        .plan
        .items
        .iter()
        .filter(|i| {
            i.kind == StandupItemKind::Direction
                && i.state == StandupItemState::Proposed
                && i.proposals.is_empty()
        })
        .filter_map(|i| {
            let pid = i.project_id.as_deref()?;
            let p = projects.iter().find(|p| p.id == pid)?;
            Some(Ask {
                item_id: i.id.clone(),
                project_id: p.id.clone(),
                name: p.name.clone(),
                root: p.root_path.clone(),
                description: p.description.clone(),
            })
        })
        .collect();
    let goals = crate::companion::brain::goals::list_goals(
        &user_db,
        Some(crate::companion::brain::goals::GoalStatus::Active),
        8,
    )
    .unwrap_or_default()
    .iter()
    .map(|g| format!("- {} (priority {})", g.title, g.priority))
    .collect::<Vec<_>>()
    .join("\n");
    let device_id = s.device_id.clone();

    futures_util::stream::iter(asks)
        .map(|ask| {
            let (db, user_db, goals) = (db.clone(), user_db.clone(), goals.clone());
            async move {
                let result = propose_one(&db, &user_db, &ask, &goals).await;
                (ask, result)
            }
        })
        .buffer_unordered(PARALLEL)
        .for_each(|(ask, result)| {
            let (user_db, device_id) = (user_db.clone(), device_id.clone());
            async move {
                let (evidence, reply) = result;
                let reply = match reply {
                    Ok(r) => Some(r),
                    Err(e) => {
                        tracing::warn!(project = %ask.name, error = %e, "standup: proposal call failed; the card stays decidable by hand");
                        None
                    }
                };
                let write = plan::mutate_draft(&user_db, standup_id, |s| {
                    write_reply(s, &ask, &evidence, reply.as_ref(), &device_id);
                    Ok(())
                });
                match write {
                    Ok(_) => service::emit_updated(app, standup_id),
                    Err(e) => tracing::warn!(standup_id, error = %e, "standup: proposals not written (the revision moved on)"),
                }
            }
        })
        .await;
    Ok(())
}

/// Fill one card from a reply (or only its evidence, when the call failed)
/// and append any agent-change cards it carried.
fn write_reply(
    s: &mut super::model::Standup,
    ask: &Ask,
    evidence: &str,
    reply: Option<&Bounded>,
    device_id: &str,
) {
    let next_priority = s.plan.items.iter().map(|i| i.priority).max().unwrap_or(-1) + 1;
    let Some(item) = s.plan.items.iter_mut().find(|i| i.id == ask.item_id) else {
        return;
    };
    item.evidence = evidence.to_string();
    let Some(reply) = reply else { return };
    if item.proposals.is_empty() && item.state == StandupItemState::Proposed {
        item.proposals = reply.proposals.clone();
    }
    for (n, change) in reply.agent_changes.iter().enumerate() {
        let mut card = plan::seed_item(&ask.project_id, device_id, next_priority + n as i32);
        card.evidence = change.rationale.clone();
        match &change.kind {
            AgentChange::Create(spec) => {
                card.kind = StandupItemKind::CreateAgent;
                card.create_spec = Some(spec.clone());
            }
            AgentChange::Retune(spec) => {
                card.kind = StandupItemKind::RetuneAgent;
                card.persona_id = Some(spec.persona_id.clone());
                card.retune_spec = Some(spec.clone());
            }
        }
        s.plan.items.push(card);
    }
}

async fn propose_one(
    db: &DbPool,
    user_db: &UserDbPool,
    ask: &Ask,
    goals: &str,
) -> (String, Result<Bounded, AppError>) {
    let mandate = crate::db::repos::core::mandates::list(db)
        .ok()
        .and_then(|all| all.into_iter().find(|m| m.project_id == ask.project_id));
    let headless = crate::commands::infrastructure::headless_master::headless_state(
        db,
        &ask.project_id,
        chrono::Utc::now(),
    )
    .ok()
    .flatten()
    .filter(|h| h.fresh);
    let commits = git_lines(&ask.root, &["log", "-3", "--format=%h %s (%cr)"]).await;
    let ahead_behind = git_lines(
        &ask.root,
        &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
    )
    .await;
    let evidence = evidence_line(
        &commits,
        ahead_behind.first().map(String::as_str),
        mandate
            .as_ref()
            .map(|m| (m.status.as_str(), m.load.open_asks)),
        headless.as_ref().map(|h| h.state.as_str()),
    );
    let personas: Vec<(String, String)> = mandate
        .as_ref()
        .map(|m| {
            vec![(
                m.steward_persona_id.clone(),
                m.steward_name
                    .clone()
                    .unwrap_or_else(|| m.steward_persona_id.clone()),
            )]
        })
        .unwrap_or_default();
    let prompt = build_prompt(ask, &evidence, goals, &personas);
    let reply = match call_claude_text(
        user_db,
        &prompt,
        crate::companion::model_routing::ASIDE.model,
        LEG_STANDUP_PROPOSE,
        PROPOSE_TIMEOUT,
    )
    .await
    {
        Ok(text) => parse_reply(&text).map(|r| bound_reply(r, &personas)),
        Err(e) => Err(e),
    };
    let reply = reply.and_then(|b| {
        if b.proposals.is_empty() {
            Err(AppError::Execution(format!(
                "{}: the reply carried no proposal",
                ask.name
            )))
        } else {
            Ok(b)
        }
    });
    (evidence, reply)
}

/// Non-empty trimmed stdout lines of one git command in `root`; empty on any
/// failure (a folder that is not a repo, no upstream).
async fn git_lines(root: &str, args: &[&str]) -> Vec<String> {
    match personas_engine::git_checkpoint::run_git(Path::new(root), args).await {
        Ok(out) => out
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(str::to_string)
            .collect(),
        Err(_) => Vec::new(),
    }
}

/// The one evidence line, from real state only.
pub(crate) fn evidence_line(
    commits: &[String],
    ahead_behind: Option<&str>,
    mandate: Option<(&str, Option<i64>)>,
    headless_state: Option<&str>,
) -> String {
    let mut parts: Vec<String> = Vec::new();
    if commits.is_empty() {
        parts.push("no commits readable".into());
    } else {
        parts.push(format!("last: {}", commits.join("; ")));
    }
    if let Some((ahead, behind)) = ahead_behind.and_then(|raw| {
        let mut it = raw.split_whitespace();
        Some((
            it.next()?.parse::<u32>().ok()?,
            it.next()?.parse::<u32>().ok()?,
        ))
    }) {
        parts.push(format!(
            "ahead {ahead} / behind {behind} of upstream (as of the last fetch)"
        ));
    }
    match mandate {
        Some((status, asks)) => {
            let asks = asks
                .map(|n| format!(", {n} open ask(s)"))
                .unwrap_or_default();
            parts.push(format!("App Master charter {status}{asks}"));
        }
        None => parts.push("no App Master charter".into()),
    }
    if let Some(state) = headless_state {
        parts.push(format!("headless App Master live ({state})"));
    }
    parts.join(" · ")
}

fn build_prompt(ask: &Ask, evidence: &str, goals: &str, personas: &[(String, String)]) -> String {
    let roster = if personas.is_empty() {
        "(none: do not propose a retune)".to_string()
    } else {
        personas
            .iter()
            .map(|(id, name)| format!("- {name}: personaId `{id}`"))
            .collect::<Vec<_>>()
            .join("\n")
    };
    format!(
        "You are Athena, at the operator's standup. Propose where ONE project should go next.\n\n\
         Project: {name} ({root}){desc}\n\
         What moved (read just now from git, the charter and the fleet): {evidence}\n\n\
         Athena's active goals:\n{goals}\n\n\
         Personas that may be retuned:\n{roster}\n\n\
         Propose 2 to 4 concrete directions for the next day and night, each doable by an \
         unattended session or the project's App Master, each one line. Mark exactly ONE as \
         recommended. Propose an agent change only when a direction needs a capability nobody \
         holds (create_agent) or the steward's pacing is wrong (retune_agent); usually none.\n\n\
         Reply with ONLY a JSON object, no code fence:\n\
         {{\"proposals\": [{{\"text\": \"...\", \"rationale\": \"why now, one line\", \"recommended\": true}}],\n\
           \"agentChanges\": [{{\"kind\": \"create_agent\", \"name\": \"...\", \"role\": \"...\", \"charter\": \"...\", \"rationale\": \"...\"}},\n\
                              {{\"kind\": \"retune_agent\", \"personaId\": \"...\", \"pacingMinutes\": 60, \"note\": \"...\", \"rationale\": \"...\"}}]}}",
        name = ask.name,
        root = ask.root,
        desc = ask
            .description
            .as_deref()
            .map(|d| format!(" - {d}"))
            .unwrap_or_default(),
        goals = if goals.trim().is_empty() { "(none)" } else { goals },
    )
}

#[derive(Debug, Deserialize)]
struct RawReply {
    #[serde(default)]
    proposals: Vec<RawProposal>,
    #[serde(default, rename = "agentChanges")]
    agent_changes: Vec<RawAgentChange>,
}

#[derive(Debug, Deserialize)]
struct RawProposal {
    #[serde(default)]
    text: String,
    #[serde(default)]
    rationale: String,
    #[serde(default)]
    recommended: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawAgentChange {
    #[serde(default)]
    kind: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    role: String,
    #[serde(default)]
    charter: String,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    persona_id: String,
    #[serde(default)]
    pacing_minutes: Option<i32>,
    #[serde(default)]
    note: Option<String>,
    #[serde(default)]
    rationale: String,
}

#[derive(Debug, Clone, PartialEq)]
enum AgentChange {
    Create(CreateAgentSpec),
    Retune(RetuneAgentSpec),
}

#[derive(Debug, Clone, PartialEq)]
struct BoundedChange {
    kind: AgentChange,
    rationale: String,
}

/// A reply after [`bound_reply`]: capped, one recommendation, valid personas.
#[derive(Debug, Clone, PartialEq)]
struct Bounded {
    proposals: Vec<DirectionProposal>,
    agent_changes: Vec<BoundedChange>,
}

fn parse_reply(text: &str) -> Result<RawReply, AppError> {
    let span = extract_json_span(text, "standup proposal reply")?;
    serde_json::from_str::<RawReply>(span)
        .map_err(|e| AppError::Validation(format!("standup proposal JSON did not parse: {e}")))
}

fn cap(s: &str, max: usize) -> String {
    let t = s.trim();
    if t.chars().count() <= max {
        t.to_string()
    } else {
        let cut: String = t.chars().take(max).collect();
        format!("{}\u{2026}", cut.trim_end())
    }
}

/// Cap the reply: at most four non-empty proposals with exactly one
/// recommended (the first the model marked, else the first), at most two
/// agent changes, a retune only for a listed persona.
fn bound_reply(raw: RawReply, personas: &[(String, String)]) -> Bounded {
    let mut proposals: Vec<DirectionProposal> = raw
        .proposals
        .into_iter()
        .filter(|p| !p.text.trim().is_empty())
        .take(MAX_PROPOSALS)
        .map(|p| DirectionProposal {
            id: format!("dp_{}", uuid::Uuid::new_v4().simple()),
            text: cap(&p.text, MAX_TEXT_CHARS),
            rationale: cap(&p.rationale, MAX_TEXT_CHARS),
            recommended: p.recommended,
        })
        .collect();
    let pick = proposals.iter().position(|p| p.recommended).unwrap_or(0);
    for (i, p) in proposals.iter_mut().enumerate() {
        p.recommended = i == pick;
    }
    let agent_changes = raw
        .agent_changes
        .into_iter()
        .filter_map(|c| {
            let kind = match c.kind.as_str() {
                "create_agent"
                    if !c.name.trim().is_empty()
                        && !c.role.trim().is_empty()
                        && !c.charter.trim().is_empty() =>
                {
                    AgentChange::Create(CreateAgentSpec {
                        name: cap(&c.name, 80),
                        role: cap(&c.role, MAX_TEXT_CHARS),
                        project_id: None,
                        charter: cap(&c.charter, MAX_CHARTER_CHARS),
                        model: c.model.map(|m| cap(&m, 80)).filter(|m| !m.is_empty()),
                    })
                }
                "retune_agent" if personas.iter().any(|(id, _)| *id == c.persona_id) => {
                    AgentChange::Retune(RetuneAgentSpec {
                        persona_id: c.persona_id.clone(),
                        pacing_minutes: c.pacing_minutes.filter(|m| *m >= 1),
                        note: c
                            .note
                            .map(|n| cap(&n, MAX_TEXT_CHARS))
                            .filter(|n| !n.is_empty()),
                    })
                }
                _ => return None,
            };
            Some(BoundedChange {
                kind,
                rationale: cap(&c.rationale, MAX_TEXT_CHARS),
            })
        })
        .take(MAX_AGENT_CHANGES)
        .collect();
    Bounded {
        proposals,
        agent_changes,
    }
}

/// The card a failed project keeps: evidence only, no proposals.
#[cfg(test)]
fn failed_card_shape(item: &super::model::StandupItem) -> bool {
    item.proposals.is_empty() && item.state == StandupItemState::Proposed
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ask() -> Ask {
        Ask {
            item_id: "sti_1".into(),
            project_id: "p1".into(),
            name: "alpha".into(),
            root: "C:/w/alpha".into(),
            description: None,
        }
    }

    #[test]
    fn reply_is_bounded_to_four_with_one_recommendation() {
        let raw = parse_reply(
            r#"```json
            {"proposals":[
              {"text":"A","rationale":"r","recommended":false},
              {"text":"B","rationale":"r","recommended":true},
              {"text":"C","rationale":"r","recommended":true},
              {"text":"  ","rationale":"empty"},
              {"text":"D","rationale":"r"},
              {"text":"E","rationale":"r"}],
             "agentChanges":[
              {"kind":"retune_agent","personaId":"stranger","pacingMinutes":30,"rationale":"x"},
              {"kind":"retune_agent","personaId":"p-steward","pacingMinutes":0,"rationale":"slow"},
              {"kind":"create_agent","name":"Scribe","role":"docs","charter":"keep docs","rationale":"y"}]}
            ```"#,
        )
        .unwrap();
        let b = bound_reply(raw, &[("p-steward".into(), "Steward".into())]);
        assert_eq!(
            b.proposals
                .iter()
                .map(|p| p.text.as_str())
                .collect::<Vec<_>>(),
            ["A", "B", "C", "D"]
        );
        assert_eq!(b.proposals.iter().filter(|p| p.recommended).count(), 1);
        assert!(b.proposals[1].recommended);
        assert_eq!(b.agent_changes.len(), 2, "the unknown persona is dropped");
        assert!(
            matches!(&b.agent_changes[0].kind, AgentChange::Retune(s) if s.pacing_minutes.is_none())
        );
        assert!(matches!(&b.agent_changes[1].kind, AgentChange::Create(s) if s.name == "Scribe"));
    }

    #[test]
    fn a_failed_project_keeps_its_evidence_and_no_proposals() {
        let mut s = super::super::plan::new_revision(
            None,
            vec![{
                let mut i = plan::seed_item("p1", "d", 0);
                i.id = "sti_1".into();
                i
            }],
            plan::default_away_rules(),
            "d",
            1,
        );
        write_reply(
            &mut s,
            &ask(),
            "no commits readable · no App Master charter",
            None,
            "d",
        );
        assert_eq!(s.plan.items.len(), 1);
        assert!(failed_card_shape(&s.plan.items[0]));
        assert_eq!(
            s.plan.items[0].evidence,
            "no commits readable · no App Master charter"
        );
    }

    #[test]
    fn agent_changes_become_their_own_cards() {
        let mut s = plan::new_revision(
            None,
            vec![{
                let mut i = plan::seed_item("p1", "d", 0);
                i.id = "sti_1".into();
                i
            }],
            plan::default_away_rules(),
            "d",
            1,
        );
        let reply = Bounded {
            proposals: vec![DirectionProposal {
                id: "a".into(),
                text: "A".into(),
                rationale: String::new(),
                recommended: true,
            }],
            agent_changes: vec![BoundedChange {
                kind: AgentChange::Retune(RetuneAgentSpec {
                    persona_id: "ps".into(),
                    pacing_minutes: Some(30),
                    note: None,
                }),
                rationale: "too slow".into(),
            }],
        };
        write_reply(&mut s, &ask(), "ev", Some(&reply), "d");
        assert_eq!(s.plan.items.len(), 2);
        assert_eq!(s.plan.items[0].proposals.len(), 1);
        let card = &s.plan.items[1];
        assert_eq!(card.kind, StandupItemKind::RetuneAgent);
        assert_eq!(card.persona_id.as_deref(), Some("ps"));
        assert_eq!(card.state, StandupItemState::Proposed);
    }

    #[test]
    fn evidence_line_reads_real_state_only() {
        let line = evidence_line(
            &["a1b2c3 fix flake (2 hours ago)".into()],
            Some("2\t0"),
            Some(("active", Some(1))),
            Some("running"),
        );
        assert_eq!(
            line,
            "last: a1b2c3 fix flake (2 hours ago) · ahead 2 / behind 0 of upstream (as of the last fetch) \
             · App Master charter active, 1 open ask(s) · headless App Master live (running)"
        );
        assert_eq!(
            evidence_line(&[], None, None, None),
            "no commits readable · no App Master charter"
        );
    }
}
