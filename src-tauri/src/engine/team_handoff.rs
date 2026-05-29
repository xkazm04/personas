//! Team handoff wiring — translate the team **connection graph** into runtime
//! **event wiring** so an upstream member's completion actually fires the next
//! member.
//!
//! ## Why this exists
//! Adoption historically derived event subscriptions from each use-case's
//! `event_subscriptions` field. Personas whose job lives in `structured_prompt`
//! (empty `use_cases` — e.g. the SDLC roster) therefore got **no** handoff
//! wiring, so the chain died after the entry member and the team could not
//! cascade autonomously (see `docs/tests/autonomy-eval/runs/baseline-health.md`). The
//! connection graph (the visual design) was never translated into the event
//! triggers the runtime needs.
//!
//! ## What we wire (per NON-feedback edge S → T)
//! Two rows on the **target** persona T:
//!   1. a **`chain` trigger** keyed on `source_persona_id = S` (the EMITTER).
//!      When S completes, [`crate::engine::chain::evaluate_chain_triggers`]
//!      publishes a targeted event of type `team_handoff.<T>` aimed at T, with
//!      S's output forwarded (`payload_forward`).
//!   2. an **`event_listener`** for `team_handoff.<T>` (the RECEIVER). The event
//!      bus only executes a persona that has a matching listener/subscription
//!      ([`crate::engine::bus::match_event`]), and `chain` is intentionally
//!      excluded from the auto-listener policy ("the upstream's listener owns
//!      the wakeup"), so we add the receiver explicitly.
//!
//! Feedback edges are intentionally **not** wired — they are revision loops,
//! and the chain-cycle guard in `triggers::create` would reject them anyway.
//!
//! Idempotent: re-running skips edges already wired (matched by
//! `json_extract` on the plaintext `source_persona_id` / `listen_event_type`
//! keys, which `encrypt_trigger_config` leaves unencrypted).

use serde::Serialize;

use crate::db::models::CreateTriggerInput;
use crate::db::repos::resources::triggers as trigger_repo;
use crate::db::DbPool;
use crate::error::AppError;

/// Summary of a wiring pass — returned by the `repair_team_handoff` command
/// and logged by the adoption path.
#[derive(Debug, Clone, Serialize, Default)]
pub struct HandoffWireResult {
    pub team_id: String,
    /// Non-feedback edges considered.
    pub edges_total: usize,
    /// Edges where at least one new trigger was created this pass.
    pub edges_wired: usize,
    pub chain_triggers_created: usize,
    pub listeners_created: usize,
    /// Edges whose emitter chain trigger already existed (idempotent skip).
    pub skipped_existing: usize,
}

/// Internal event type a target listens for to receive its handoff. Per-target
/// so a fan-in target needs only one receiver even with multiple inbound edges.
fn handoff_event_type(target_persona_id: &str) -> String {
    format!("team_handoff.{target_persona_id}")
}

/// Wire (or repair) intra-team handoff from the connection graph. Safe to call
/// repeatedly; only missing triggers are created.
pub fn wire_team_handoff(pool: &DbPool, team_id: &str) -> Result<HandoffWireResult, AppError> {
    let mut result = HandoffWireResult {
        team_id: team_id.to_string(),
        ..Default::default()
    };

    // member_id -> persona_id (connections reference member ids; triggers need persona ids)
    let member_to_persona: std::collections::HashMap<String, String> = {
        let conn = pool.get()?;
        let mut stmt =
            conn.prepare("SELECT id, persona_id FROM persona_team_members WHERE team_id = ?1")?;
        let rows = stmt
            .query_map([team_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?;
        rows.into_iter().collect()
    };

    // (source_member, target_member, connection_type, condition)
    let edges: Vec<(String, String, String, Option<String>)> = {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT source_member_id, target_member_id, connection_type, condition
             FROM persona_team_connections WHERE team_id = ?1",
        )?;
        let rows = stmt
            .query_map([team_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<String>>(3)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?;
        rows
    };

    for (src_m, dst_m, ctype, cond) in &edges {
        // Feedback edges are revision loops — never wired as forward handoff.
        if ctype == "feedback" {
            continue;
        }
        result.edges_total += 1;

        let (Some(src_p), Some(dst_p)) =
            (member_to_persona.get(src_m), member_to_persona.get(dst_m))
        else {
            tracing::warn!(
                team_id,
                src_member = %src_m,
                dst_member = %dst_m,
                "team_handoff: edge endpoint did not resolve to a persona; skipping"
            );
            continue;
        };

        let event_type = handoff_event_type(dst_p);
        let condition = build_condition(ctype, cond.as_deref());
        let mut wired_something = false;

        // 1. EMITTER — chain trigger on the target, keyed by the source persona.
        if chain_trigger_exists(pool, dst_p, src_p)? {
            result.skipped_existing += 1;
        } else {
            let cfg = serde_json::json!({
                "source_persona_id": src_p,
                "event_type": event_type,
                "condition": condition,
                "payload_forward": true,
            })
            .to_string();
            match trigger_repo::create(
                pool,
                CreateTriggerInput {
                    persona_id: dst_p.clone(),
                    trigger_type: "chain".into(),
                    config: Some(cfg),
                    enabled: Some(true),
                    use_case_id: None,
                },
            ) {
                Ok(_) => {
                    result.chain_triggers_created += 1;
                    wired_something = true;
                }
                Err(e) => tracing::warn!(
                    team_id, source = %src_p, target = %dst_p, error = %e,
                    "team_handoff: chain trigger create failed (continuing)"
                ),
            }
        }

        // 2. RECEIVER — event_listener on the target for the handoff event type.
        if !listener_exists(pool, dst_p, &event_type)? {
            let cfg = serde_json::json!({ "listen_event_type": event_type }).to_string();
            match trigger_repo::create(
                pool,
                CreateTriggerInput {
                    persona_id: dst_p.clone(),
                    trigger_type: "event_listener".into(),
                    config: Some(cfg),
                    enabled: Some(true),
                    use_case_id: None,
                },
            ) {
                Ok(_) => {
                    result.listeners_created += 1;
                    wired_something = true;
                }
                Err(e) => tracing::warn!(
                    team_id, target = %dst_p, error = %e,
                    "team_handoff: event_listener create failed (continuing)"
                ),
            }
        }

        if wired_something {
            result.edges_wired += 1;
        }
    }

    tracing::info!(
        team_id,
        edges_total = result.edges_total,
        edges_wired = result.edges_wired,
        chain_triggers_created = result.chain_triggers_created,
        listeners_created = result.listeners_created,
        skipped_existing = result.skipped_existing,
        "team_handoff: wiring complete"
    );
    Ok(result)
}

/// Build the chain-trigger condition predicate. Sequential/parallel edges fire
/// on success (the source `completed`); a `conditional` edge with a JSON-object
/// condition uses it verbatim; anything else defaults to success.
fn build_condition(connection_type: &str, condition: Option<&str>) -> serde_json::Value {
    if connection_type == "conditional" {
        if let Some(c) = condition {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(c) {
                if v.is_object() {
                    return v;
                }
            }
        }
    }
    serde_json::json!({ "type": "success" })
}

fn chain_trigger_exists(
    pool: &DbPool,
    persona_id: &str,
    source_persona_id: &str,
) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM persona_triggers
         WHERE persona_id = ?1 AND trigger_type = 'chain'
           AND json_extract(config, '$.source_persona_id') = ?2",
        rusqlite::params![persona_id, source_persona_id],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

fn listener_exists(pool: &DbPool, persona_id: &str, event_type: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM persona_triggers
         WHERE persona_id = ?1 AND trigger_type = 'event_listener'
           AND json_extract(config, '$.listen_event_type') = ?2",
        rusqlite::params![persona_id, event_type],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}
