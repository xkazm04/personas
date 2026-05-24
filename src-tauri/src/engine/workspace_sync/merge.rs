//! Three-way + last-writer-wins merge for cross-device persona sync.
//!
//! Mirrors `commands/obsidian_brain/conflict.rs::three_way_compare`. The key
//! difference: both ends are the *same user's* devices, so a true divergent
//! conflict is auto-resolved by last-writer-wins rather than queued for manual
//! resolution. Deletions are first-class via [`WorkspaceEntity::Tombstone`]
//! because personas hard-delete with no `deleted_at` — without an explicit
//! tombstone, a delete on one device is indistinguishable from "never synced"
//! and the row resurrects on the next pull.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::snapshot::PersonaWorkspaceSnapshot;

/// One device's view of a persona for a sync round: either a live definition or
/// a tombstone recording that it was deleted here.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum WorkspaceEntity {
    Live {
        snapshot: PersonaWorkspaceSnapshot,
        /// Stable id of the device that authored this state (peer_id).
        device_id: String,
    },
    Tombstone {
        id: String,
        /// RFC3339 deletion time — the LWW ordering key for the tombstone.
        deleted_at: String,
        device_id: String,
    },
}

impl WorkspaceEntity {
    /// The content hash this side compares against the recorded base. A live
    /// entity hashes its snapshot; a tombstone has no content, so it carries a
    /// stable sentinel that differs from any live hash for the same id.
    pub fn content_hash(&self) -> String {
        match self {
            WorkspaceEntity::Live { snapshot, .. } => snapshot.content_hash(),
            WorkspaceEntity::Tombstone { id, .. } => format!("tombstone:{id}"),
        }
    }

    /// RFC3339 last-modified instant used for last-writer-wins ordering.
    pub fn modified_at(&self) -> &str {
        match self {
            WorkspaceEntity::Live { snapshot, .. } => &snapshot.updated_at,
            WorkspaceEntity::Tombstone { deleted_at, .. } => deleted_at,
        }
    }

    pub fn device_id(&self) -> &str {
        match self {
            WorkspaceEntity::Live { device_id, .. } => device_id,
            WorkspaceEntity::Tombstone { device_id, .. } => device_id,
        }
    }

    pub fn is_tombstone(&self) -> bool {
        matches!(self, WorkspaceEntity::Tombstone { .. })
    }
}

/// Which side won a last-writer-wins resolution.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum SyncWinner {
    Local,
    Remote,
}

/// Outcome of merging the local and remote views of one persona. Phrased from
/// the **local** device's perspective; the caller maps each outcome to an action
/// (write local, push local, adopt remote, delete local, …) and updates
/// `persona_sync_state` to the agreed hash. Deletion direction falls out of the
/// winning entity's [`WorkspaceEntity::is_tombstone`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase", tag = "outcome")]
pub enum WorkspaceMergeOutcome {
    /// Both sides match the recorded base — nothing to do.
    NoChange,
    /// Local moved off base, remote still matches it → local should push.
    PushLocal,
    /// Remote moved off base, local still matches it → local should adopt remote
    /// (if remote is a tombstone, that means delete locally).
    AdoptRemote,
    /// Both moved off base and landed on identical content (lucky convergence).
    /// No write needed; advance the base hash to `hash`.
    Converged { hash: String },
    /// Both moved off base and diverged. Auto-resolved by last-writer-wins.
    ConflictResolved { winner: SyncWinner },
}

/// Three-way merge of one persona across two of a user's devices.
///
/// `base_hash` is the content hash recorded at the last successful sync for this
/// `(persona, remote-device)` pair, or `None` on first contact.
pub fn merge_persona(
    base_hash: Option<&str>,
    local: &WorkspaceEntity,
    remote: &WorkspaceEntity,
) -> WorkspaceMergeOutcome {
    let local_hash = local.content_hash();
    let remote_hash = remote.content_hash();

    let local_changed = base_hash != Some(local_hash.as_str());
    let remote_changed = base_hash != Some(remote_hash.as_str());

    match (local_changed, remote_changed) {
        (false, false) => WorkspaceMergeOutcome::NoChange,
        (true, false) => WorkspaceMergeOutcome::PushLocal,
        (false, true) => WorkspaceMergeOutcome::AdoptRemote,
        (true, true) => {
            if local_hash == remote_hash {
                // Both edited, identical result — mirror Obsidian's
                // ConvergedConflict: safe, but recorded as a distinct event.
                WorkspaceMergeOutcome::Converged { hash: local_hash }
            } else {
                WorkspaceMergeOutcome::ConflictResolved {
                    winner: last_writer_wins(local, remote),
                }
            }
        }
    }
}

/// Deterministic last-writer-wins: the later `modified_at` wins. On an exact tie
/// (including unparseable timestamps that compare equal), the lexicographically
/// **larger** `device_id` wins. Both devices run identical inputs through this
/// function, so they always agree on the winner without coordination.
fn last_writer_wins(local: &WorkspaceEntity, remote: &WorkspaceEntity) -> SyncWinner {
    use std::cmp::Ordering;

    let ord = compare_rfc3339(local.modified_at(), remote.modified_at())
        .then_with(|| local.device_id().cmp(remote.device_id()));

    match ord {
        Ordering::Greater => SyncWinner::Local,
        Ordering::Less => SyncWinner::Remote,
        // Identical timestamp AND identical device id — impossible for two
        // distinct devices, but resolve deterministically to Remote so the
        // function is total.
        Ordering::Equal => SyncWinner::Remote,
    }
}

/// Compare two RFC3339 timestamps chronologically, falling back to byte order if
/// either fails to parse (so the function never panics on malformed input).
fn compare_rfc3339(a: &str, b: &str) -> std::cmp::Ordering {
    match (
        chrono::DateTime::parse_from_rfc3339(a),
        chrono::DateTime::parse_from_rfc3339(b),
    ) {
        (Ok(da), Ok(db)) => da.cmp(&db),
        _ => a.cmp(b),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snap(id: &str, prompt: &str, updated_at: &str) -> PersonaWorkspaceSnapshot {
        PersonaWorkspaceSnapshot {
            id: id.into(),
            name: "P".into(),
            description: None,
            system_prompt: prompt.into(),
            structured_prompt: None,
            icon: None,
            color: None,
            enabled: true,
            headless: false,
            max_concurrent: 1,
            timeout_ms: 1000,
            max_turns: None,
            max_budget_usd: None,
            parameters: None,
            template_category: None,
            gateway_exposure: "local_only".into(),
            cli_awareness_enabled: false,
            updated_at: updated_at.into(),
        }
    }

    fn live(id: &str, prompt: &str, updated_at: &str, device: &str) -> WorkspaceEntity {
        WorkspaceEntity::Live {
            snapshot: snap(id, prompt, updated_at),
            device_id: device.into(),
        }
    }

    fn tomb(id: &str, deleted_at: &str, device: &str) -> WorkspaceEntity {
        WorkspaceEntity::Tombstone {
            id: id.into(),
            deleted_at: deleted_at.into(),
            device_id: device.into(),
        }
    }

    #[test]
    fn no_change_when_both_match_base() {
        let l = live("p", "v1", "2026-05-24T10:00:00Z", "A");
        let r = live("p", "v1", "2026-05-24T10:00:00Z", "B");
        let base = l.content_hash();
        assert_eq!(
            merge_persona(Some(&base), &l, &r),
            WorkspaceMergeOutcome::NoChange
        );
    }

    #[test]
    fn local_only_change_pushes() {
        let base = snap("p", "v1", "2026-05-24T10:00:00Z").content_hash();
        let l = live("p", "v2", "2026-05-24T11:00:00Z", "A");
        let r = live("p", "v1", "2026-05-24T10:00:00Z", "B");
        assert_eq!(
            merge_persona(Some(&base), &l, &r),
            WorkspaceMergeOutcome::PushLocal
        );
    }

    #[test]
    fn remote_only_change_adopts() {
        let base = snap("p", "v1", "2026-05-24T10:00:00Z").content_hash();
        let l = live("p", "v1", "2026-05-24T10:00:00Z", "A");
        let r = live("p", "v2", "2026-05-24T11:00:00Z", "B");
        assert_eq!(
            merge_persona(Some(&base), &l, &r),
            WorkspaceMergeOutcome::AdoptRemote
        );
    }

    #[test]
    fn convergent_edits_report_converged() {
        let base = snap("p", "v0", "2026-05-24T09:00:00Z").content_hash();
        let l = live("p", "shared", "2026-05-24T10:00:00Z", "A");
        let r = live("p", "shared", "2026-05-24T11:00:00Z", "B");
        match merge_persona(Some(&base), &l, &r) {
            WorkspaceMergeOutcome::Converged { hash } => {
                assert_eq!(hash, l.content_hash());
            }
            other => panic!("expected Converged, got {other:?}"),
        }
    }

    #[test]
    fn divergent_edits_resolve_by_latest_timestamp() {
        let base = snap("p", "v0", "2026-05-24T09:00:00Z").content_hash();
        let l = live("p", "local-edit", "2026-05-24T12:00:00Z", "A");
        let r = live("p", "remote-edit", "2026-05-24T11:00:00Z", "B");
        assert_eq!(
            merge_persona(Some(&base), &l, &r),
            WorkspaceMergeOutcome::ConflictResolved {
                winner: SyncWinner::Local
            }
        );
    }

    #[test]
    fn divergent_edits_tie_break_by_device_id() {
        let base = snap("p", "v0", "2026-05-24T09:00:00Z").content_hash();
        // Same timestamp, different content → tie broken by larger device_id ("B").
        let l = live("p", "local-edit", "2026-05-24T12:00:00Z", "A");
        let r = live("p", "remote-edit", "2026-05-24T12:00:00Z", "B");
        assert_eq!(
            merge_persona(Some(&base), &l, &r),
            WorkspaceMergeOutcome::ConflictResolved {
                winner: SyncWinner::Remote
            }
        );
    }

    #[test]
    fn remote_tombstone_propagates_delete() {
        // Local unchanged since base; remote deleted the persona → adopt the
        // remote tombstone, i.e. delete locally.
        let base = snap("p", "v1", "2026-05-24T10:00:00Z").content_hash();
        let l = live("p", "v1", "2026-05-24T10:00:00Z", "A");
        let r = tomb("p", "2026-05-24T11:00:00Z", "B");
        let outcome = merge_persona(Some(&base), &l, &r);
        assert_eq!(outcome, WorkspaceMergeOutcome::AdoptRemote);
        assert!(r.is_tombstone(), "adopting remote here means deleting locally");
    }

    #[test]
    fn local_edit_after_remote_delete_wins_over_tombstone() {
        // Both moved off base: local re-edited the persona, remote deleted it.
        // Local edit is newer → keep local (resist resurrection-by-delete).
        let base = snap("p", "v1", "2026-05-24T10:00:00Z").content_hash();
        let l = live("p", "v2", "2026-05-24T13:00:00Z", "A");
        let r = tomb("p", "2026-05-24T11:00:00Z", "B");
        assert_eq!(
            merge_persona(Some(&base), &l, &r),
            WorkspaceMergeOutcome::ConflictResolved {
                winner: SyncWinner::Local
            }
        );
    }

    #[test]
    fn first_contact_identical_content_converges() {
        // No recorded base (first sync). Identical content on both sides → no
        // conflict, converge on the shared hash.
        let l = live("p", "v1", "2026-05-24T10:00:00Z", "A");
        let r = live("p", "v1", "2026-05-24T10:30:00Z", "B");
        match merge_persona(None, &l, &r) {
            WorkspaceMergeOutcome::Converged { .. } => {}
            other => panic!("expected Converged on first-contact identical, got {other:?}"),
        }
    }
}
