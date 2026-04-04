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
    /// Both sides changed — conflict.
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
            // Both changed — but if they converged to the same content, no conflict
            if app_hash == vault_hash {
                return ThreeWayResult::NoChange;
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
