//! Boot phase: idempotent seeds that must exist before anything reads the DB.

use crate::db::{self, DbPool};
use crate::engine;
use crate::startup_timing::StartupTimer;

// Seed built-in local credentials (database, vector KB, messaging)
pub fn seed_builtin_data(
    pool: &DbPool,
    st: &mut StartupTimer,
) -> Result<(), Box<dyn std::error::Error>> {
    {
        let conn = pool
            .get()
            .map_err(|e| format!("Failed to get DB connection for credential seed: {e}"))?;
        if let Err(e) = db::seed_builtin_credentials(&conn) {
            tracing::warn!("Failed to seed built-in credentials: {}", e);
        }
    }
    st.checkpoint("credential_seed");

    // Seed the single system-owned Director persona (coaches every
    // other persona; idempotent on every boot).
    match engine::director::ensure_director_persona(pool) {
        Ok(id) => tracing::info!(director_id = %id, "Director persona ready"),
        Err(e) => tracing::warn!("Director seed deferred: {}", e),
    }
    st.checkpoint("director_seed");

    // Stage B Phase 2.4 — seed the recipe catalog from the embedded
    // bundle so adoption of recipe_ref-shaped templates works on a
    // fresh install. Idempotent: existing rows are left untouched.
    match engine::recipe_seed::seed_recipes_from_bundle(pool) {
        Ok(report) => tracing::info!(
            total = report.total,
            created = report.created,
            skipped = report.skipped_existing,
            failed = report.failed,
            "Recipe catalog seeded from bundle"
        ),
        Err(e) => tracing::warn!("Recipe catalog seed failed: {}", e),
    }
    st.checkpoint("recipe_seed");

    // Initialize P2P identity (Invisible Apps Phase 1)
    #[cfg(feature = "p2p")]
    match engine::identity::get_or_create_identity(pool) {
        Ok(identity) => {
            tracing::info!(peer_id = %identity.peer_id, "P2P identity ready");
        }
        Err(e) => {
            tracing::warn!("P2P identity initialization deferred: {}", e);
        }
    }
    st.checkpoint("p2p_identity");

    Ok(())
}
