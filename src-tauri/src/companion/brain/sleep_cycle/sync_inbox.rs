//! Draining the paired device's staged distillate through the same
//! validate/apply path compress uses — semi-trusted, same caps, same id checks.
//!
//! Moved verbatim out of the former single-file `sleep_cycle.rs`.

use std::collections::HashSet;

use serde_json::Value;

use super::apply::{apply_candidates, apply_tag_proposals};
use super::limits::MAX_STAGED_PER_CYCLE;
use super::parse::normalize_tag;
use super::run::{CycleNotes, CycleStats};
use crate::companion::brain::{sync_staging, taxonomy};
use crate::db::UserDbPool;
use crate::error::AppError;

/// Drain the sync inbox through the SAME validate/apply path as compress.
///
/// Semi-trusted: an arriving delta is another device's judgement, not a fact,
/// so it faces the same schema, the same caps and the same id checks. What it
/// does NOT face is provenance-against-this-machine's-episodes, because episodes
/// never cross the wire by design — see [`staged_provenance`].
///
/// Every listed row is stamped exactly once, including the malformed ones. A
/// poison payload that stayed unprocessed would be re-read, re-fail and
/// re-report on every future cycle forever; counting it and moving on is the
/// only shape that cannot wedge the lane.
pub(super) fn consume_sync_inbox(
    pool: &UserDbPool,
    cycle_id: &str,
    stats: &mut CycleStats,
    notes: &mut CycleNotes,
) -> Result<(), AppError> {
    let deltas = sync_staging::list_unprocessed(pool, MAX_STAGED_PER_CYCLE)?;
    if deltas.is_empty() {
        return Ok(());
    }

    let vocabulary = taxonomy::list_active(pool)?;
    let active_tags: HashSet<String> = vocabulary
        .iter()
        .map(|t| normalize_tag(&t.tag))
        .filter(|t| !t.is_empty())
        .collect();

    let mut ids = Vec::with_capacity(deltas.len());
    for delta in &deltas {
        ids.push(delta.id.clone());
        let fallback = staged_provenance(delta);
        let payload: Value = match serde_json::from_str(&delta.payload_json) {
            Ok(v) => v,
            Err(e) => {
                stats.staged_malformed += 1;
                notes.staged.push(format!(
                    "`{}` from {} — payload is not JSON ({e}); counted, marked processed, ignored",
                    delta.id, delta.origin_device
                ));
                continue;
            }
        };

        match delta.item_kind.as_str() {
            sync_staging::KIND_FACT => {
                let envelope = serde_json::json!({ "facts": [payload] });
                let before = stats.facts_applied;
                apply_candidates(
                    pool,
                    cycle_id,
                    &envelope,
                    &active_tags,
                    None,
                    Some(&fallback),
                    stats,
                    notes,
                )?;
                if stats.facts_applied > before {
                    stats.staged_consumed += 1;
                    notes.staged.push(format!(
                        "fact from {} applied ({})",
                        delta.origin_device, delta.id
                    ));
                } else {
                    stats.staged_malformed += 1;
                    notes.staged.push(format!(
                        "fact from {} rejected by validation ({})",
                        delta.origin_device, delta.id
                    ));
                }
            }
            sync_staging::KIND_PROCEDURAL => {
                let envelope = serde_json::json!({ "procedurals": [payload] });
                let before = stats.procedurals_applied;
                apply_candidates(
                    pool,
                    cycle_id,
                    &envelope,
                    &active_tags,
                    None,
                    Some(&fallback),
                    stats,
                    notes,
                )?;
                if stats.procedurals_applied > before {
                    stats.staged_consumed += 1;
                    notes.staged.push(format!(
                        "procedural from {} applied ({})",
                        delta.origin_device, delta.id
                    ));
                } else {
                    stats.staged_malformed += 1;
                    notes.staged.push(format!(
                        "procedural from {} rejected by validation ({})",
                        delta.origin_device, delta.id
                    ));
                }
            }
            sync_staging::KIND_TAXONOMY => {
                let envelope = serde_json::json!({ "proposed_tags": [payload] });
                let before = stats.tags_proposed;
                apply_tag_proposals(pool, cycle_id, &envelope, stats, notes)?;
                if stats.tags_proposed > before {
                    stats.staged_consumed += 1;
                    notes.staged.push(format!(
                        "taxonomy proposal from {} staged for review ({})",
                        delta.origin_device, delta.id
                    ));
                } else {
                    // A tag the registry already knows is a no-op, not a defect —
                    // both devices deriving the same classification is the system
                    // working. Consumed, not malformed.
                    stats.staged_consumed += 1;
                    notes.staged.push(format!(
                        "taxonomy row from {} was already known ({})",
                        delta.origin_device, delta.id
                    ));
                }
            }
            other => {
                stats.staged_malformed += 1;
                notes.staged.push(format!(
                    "`{}` from {} — unknown item kind `{other}`; counted, marked processed, ignored",
                    delta.id, delta.origin_device
                ));
            }
        }
    }

    let marked = sync_staging::mark_processed(pool, &ids, cycle_id)?;
    if marked != ids.len() {
        notes.caveats.push(format!(
            "{} of {} staged deltas were already claimed by an earlier cycle.",
            ids.len() - marked,
            ids.len()
        ));
    }
    Ok(())
}

/// Provenance for a staged item that arrived without any.
///
/// The anti-hallucination contract (`semantic::write_fact` rejects a sourceless
/// fact) is about being able to answer "where did this come from". For a
/// cross-device delta the honest answer is the delta itself: episodes are
/// local-only by design, so a remote fact's real sources do not exist on this
/// machine and never will. `sync:<device>:<delta id>` says exactly that and
/// keeps the row auditable back to the inbox entry that carried it — which is
/// strictly better than dropping legitimate distillate for failing a check it
/// structurally cannot pass.
fn staged_provenance(delta: &sync_staging::SyncDelta) -> String {
    format!("sync:{}:{}", delta.origin_device, delta.id)
}
