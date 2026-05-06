use chrono::Utc;
use uuid::Uuid;

use crate::db::models::SyncConflict;

use super::markdown::compute_content_hash;

/// Result of a three-way comparison for a synced entity.
pub enum ThreeWayResult {
    /// Neither side changed since last sync.
    NoChange,
    /// Only the app side changed — safe to push.
    AppChanged,
    /// Only the vault side changed — safe to pull.
    VaultChanged,
    /// Both sides changed AND ended up with identical content (lucky
    /// convergence). Functionally safe — there's nothing to merge — but
    /// informationally distinct from `NoChange`: the user edited both sides
    /// and the system avoided a real conflict by chance. Surfaced as a
    /// confirmation toast in the SyncBridge UI so the audit trail records
    /// "both sides edited X and ended up identical — keeping shared
    /// version".
    ///
    /// Carries both hashes (which are equal) so callers can update sync
    /// state to the converged hash and log the event with full context.
    ConvergedConflict {
        app_hash: String,
        vault_hash: String,
        base_hash: String,
    },
    /// Both sides changed and diverged — real conflict.
    Conflict(SyncConflict),
}

/// Perform three-way comparison: base_hash (last sync) vs current app content vs current vault content.
pub fn three_way_compare(
    entity_type: &str,
    entity_id: &str,
    file_path: &str,
    base_hash: &str,
    app_content: &str,
    vault_content: &str,
) -> ThreeWayResult {
    let app_hash = compute_content_hash(app_content);
    let vault_hash = compute_content_hash(vault_content);

    let app_changed = app_hash != base_hash;
    let vault_changed = vault_hash != base_hash;

    match (app_changed, vault_changed) {
        (false, false) => ThreeWayResult::NoChange,
        (true, false) => ThreeWayResult::AppChanged,
        (false, true) => ThreeWayResult::VaultChanged,
        (true, true) => {
            // Both sides changed. If they converged to the same content,
            // surface that as a distinct event rather than collapsing it
            // into NoChange — the user did edit both sides, and we want
            // the audit trail to show that a real conflict was avoided
            // by chance.
            if app_hash == vault_hash {
                return ThreeWayResult::ConvergedConflict {
                    app_hash,
                    vault_hash,
                    base_hash: base_hash.to_string(),
                };
            }
            ThreeWayResult::Conflict(SyncConflict {
                id: Uuid::new_v4().to_string(),
                entity_type: entity_type.to_string(),
                entity_id: entity_id.to_string(),
                file_path: file_path.to_string(),
                app_content: app_content.to_string(),
                vault_content: vault_content.to_string(),
                app_hash,
                vault_hash,
                base_hash: base_hash.to_string(),
                detected_at: Utc::now().to_rfc3339(),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_change_when_neither_side_moves() {
        let base = compute_content_hash("hello");
        let r = three_way_compare("memory", "id", "p", &base, "hello", "hello");
        assert!(matches!(r, ThreeWayResult::NoChange));
    }

    #[test]
    fn app_only_change_pushes() {
        let base = compute_content_hash("hello");
        let r = three_way_compare("memory", "id", "p", &base, "hello v2", "hello");
        assert!(matches!(r, ThreeWayResult::AppChanged));
    }

    #[test]
    fn vault_only_change_pulls() {
        let base = compute_content_hash("hello");
        let r = three_way_compare("memory", "id", "p", &base, "hello", "hello v2");
        assert!(matches!(r, ThreeWayResult::VaultChanged));
    }

    #[test]
    fn divergent_edits_conflict() {
        let base = compute_content_hash("hello");
        let r = three_way_compare("memory", "id", "p", &base, "app side", "vault side");
        assert!(matches!(r, ThreeWayResult::Conflict(_)));
    }

    #[test]
    fn convergent_edits_yield_converged_conflict_not_no_change() {
        // Both sides moved off base AND landed on identical content. This
        // must be reported as ConvergedConflict, not NoChange — the latter
        // hides the audit trail from the user.
        let base = compute_content_hash("hello");
        let r = three_way_compare("memory", "id", "p", &base, "shared", "shared");
        match r {
            ThreeWayResult::ConvergedConflict {
                app_hash,
                vault_hash,
                base_hash,
            } => {
                assert_eq!(app_hash, vault_hash);
                assert_ne!(app_hash, base_hash);
                assert_eq!(base_hash, base);
            }
            _ => panic!("expected ConvergedConflict for lucky convergence"),
        }
    }
}
