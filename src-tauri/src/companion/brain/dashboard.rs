//! Phase F: dashboard composition. A singleton spec stored as a
//! markdown body on a single `companion_node` row (`kind='dashboard'`,
//! `id='dashboard'`). Athena's `compose_dashboard` op overwrites the
//! spec; the frontend re-reads on next dashboard tab open.
//!
//! Storage layout deliberately mirrors `reflection.rs` — we don't need
//! a sidecar table for typed metadata (the spec is the metadata), so
//! `companion_node` alone is enough plus the markdown file under
//! `dashboard.md`.
//!
//! ## Why this file looks like `cockpit.rs` now
//!
//! The two surfaces are the same shape — one JSON blob, one node row, one
//! file — and `cockpit.rs` had already learned three things this one had not:
//! a write lock around the read-modify-write cycle, a save that merges
//! user-pinned widgets forward instead of overwriting them, and the
//! understanding that a compose is destructive. Until 2026-09-03
//! [`save_dashboard`] was a bare `fs::write` followed by a blind
//! `ON CONFLICT DO UPDATE`, with no lock, no merge and no way back.
//!
//! Both of its callers are Athena — the `compose_dashboard` approval
//! executor and the auto-fire path in `companion::session::turn` — so the
//! race it lost was Athena against herself: two composes in flight (a card
//! approved while a later turn auto-fires) and the last `fs::write` wins,
//! with the node row's hash possibly describing the other one's bytes.
//!
//! What is preserved forward is a widget carrying `"pinned": true`, the same
//! field `cockpit.rs` defines and `companion_pin_widget_to_cockpit` stamps.
//! **The dashboard has no pin command yet** — there is no other user-owned
//! field in the spec, because nothing but Athena writes it — so the merge is
//! a no-op today and exists so the pin, when it lands, does not have to
//! remember to change the compose path. The part that is not speculative is
//! the snapshot: [`save_dashboard`] keeps exactly ONE prior version at
//! `dashboard.bak.md`, so a compose that wrecks a good layout can be undone
//! with [`reset_dashboard`].

use std::fs;
use std::sync::Mutex;

use chrono::Utc;
use rusqlite::{params, OptionalExtension};

use crate::companion::brain::util;
use crate::companion::disk;
use crate::db::UserDbPool;
use crate::error::AppError;

/// Singleton id — there's only ever one dashboard.
const DASHBOARD_ID: &str = "dashboard";
const DASHBOARD_REL_PATH: &str = "dashboard.md";

/// The single retained prior version. One slot, not a timestamped series:
/// the failure this protects against is "the compose I just approved made it
/// worse", which is answered by the version immediately before it. An
/// unbounded series would answer nothing extra and would repeat the mistake
/// the constitution backups already made — 31 of those accumulated with no
/// retention rule before anyone counted them.
const DASHBOARD_BAK_REL_PATH: &str = "dashboard.bak.md";

/// Serializes the dashboard's read-modify-write cycle, exactly as
/// `cockpit::COCKPIT_WRITE_LOCK` does for its twin. [`save_dashboard`] now
/// loads the prior spec, merges pinned widgets out of it, snapshots the file
/// and writes — four steps that must not interleave with another writer's
/// four.
pub static DASHBOARD_WRITE_LOCK: Mutex<()> = Mutex::new(());

/// Save the dashboard spec, preserving user-pinned widgets and keeping one
/// undo step. `spec_json` is the already-serialized JSON body the frontend
/// will parse.
///
/// This is the only save. Unlike `cockpit.rs`, which needs its low-level
/// writer exposed for the pin flow's own load-modify-save, nothing here
/// writes the dashboard except Athena's two compose paths — so making the
/// safe behaviour the default costs no call site a change and leaves no
/// bare writer for a future caller to reach for by mistake.
pub fn save_dashboard(pool: &UserDbPool, spec_json: &str) -> Result<(), AppError> {
    let _guard = DASHBOARD_WRITE_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let merged = match merge_with_pinned(pool, spec_json)? {
        Some(m) => m,
        None => spec_json.to_string(),
    };
    write_spec(pool, &merged)
}

/// The bare write: snapshot the current file into the `.bak` slot, put the
/// new bytes down, upsert the node row. Callers hold
/// [`DASHBOARD_WRITE_LOCK`].
fn write_spec(pool: &UserDbPool, spec_json: &str) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    let root = disk::brain_root()?;
    let abs_path = root.join(DASHBOARD_REL_PATH);
    // Snapshot before overwriting. Best-effort: no prior file (first compose)
    // is the normal case, and a failed copy must not stop the user getting
    // the dashboard they asked for.
    if abs_path.exists() {
        let _ = fs::copy(&abs_path, root.join(DASHBOARD_BAK_REL_PATH));
    }
    fs::write(&abs_path, spec_json)?;
    let hash = util::sha256_hex(spec_json);
    let excerpt = excerpt_500(spec_json);

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO companion_node (id, kind, file_path, content_hash, importance, body_excerpt, created_at, updated_at)
         VALUES (?1, 'dashboard', ?2, ?3, 3, ?4, ?5, ?5)
         ON CONFLICT(id) DO UPDATE SET
             content_hash = excluded.content_hash,
             body_excerpt = excluded.body_excerpt,
             updated_at = excluded.updated_at",
        params![DASHBOARD_ID, DASHBOARD_REL_PATH, hash, excerpt, now],
    )?;
    Ok(())
}

/// Pure-ish helper: load the existing spec, lift out any widget carrying
/// `"pinned": true`, append the ones the new spec does not already contain.
/// Returns `None` when no merge is needed — no current spec, nothing pinned,
/// or either side is not JSON with a `widgets` array — in which case the new
/// spec is saved as-is. Deliberately identical in shape and dedupe rule
/// (same `kind` + same `config`) to `cockpit::merge_with_pinned`, because two
/// surfaces that behave differently under a pin would be a worse outcome than
/// the duplication.
fn merge_with_pinned(pool: &UserDbPool, new_spec_json: &str) -> Result<Option<String>, AppError> {
    let Some(prior) = load_dashboard(pool)? else {
        return Ok(None);
    };
    let Ok(prior_spec) = serde_json::from_str::<serde_json::Value>(&prior.spec_json) else {
        return Ok(None);
    };
    let pinned: Vec<serde_json::Value> = prior_spec
        .get("widgets")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter(|w| w.get("pinned").and_then(|p| p.as_bool()).unwrap_or(false))
                .cloned()
                .collect()
        })
        .unwrap_or_default();
    if pinned.is_empty() {
        return Ok(None);
    }
    let Ok(mut new_spec) = serde_json::from_str::<serde_json::Value>(new_spec_json) else {
        return Ok(None);
    };
    let Some(new_widgets) = new_spec.get_mut("widgets").and_then(|v| v.as_array_mut()) else {
        return Ok(None);
    };
    for pin in pinned {
        let pin_kind = pin.get("kind").and_then(|v| v.as_str());
        let pin_config = pin.get("config").unwrap_or(&serde_json::Value::Null);
        let dup = new_widgets.iter().any(|w| {
            w.get("kind").and_then(|v| v.as_str()) == pin_kind
                && w.get("config").unwrap_or(&serde_json::Value::Null) == pin_config
        });
        if !dup {
            new_widgets.push(pin);
        }
    }
    Ok(Some(new_spec.to_string()))
}

/// Restore the one retained prior version. Returns `false` when there is
/// nothing to restore (no compose has ever been overwritten).
///
/// It is a **swap**, not a pop: the spec being replaced becomes the new
/// `.bak`, so a reset can itself be reset. That is the honest shape for one
/// slot — the alternative (discard the current spec) makes the undo button
/// the most destructive control on the surface.
///
/// Not wired to a command yet: `commands::companion::consolidate` owns the
/// dashboard IPC surface and is outside this change's write set. The mechanism
/// is here so the command is three lines when the Director adds it.
#[allow(dead_code)] // awaiting a `companion_reset_dashboard` command
pub fn reset_dashboard(pool: &UserDbPool) -> Result<bool, AppError> {
    let _guard = DASHBOARD_WRITE_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let bak_path = disk::brain_root()?.join(DASHBOARD_BAK_REL_PATH);
    let Ok(prior) = fs::read_to_string(&bak_path) else {
        return Ok(false);
    };
    if prior.trim().is_empty() {
        return Ok(false);
    }
    // `write_spec` snapshots the current file into `.bak` on its way past,
    // which is what makes this a swap.
    write_spec(pool, &prior)?;
    Ok(true)
}

#[derive(Debug, Clone)]
pub struct Dashboard {
    pub spec_json: String,
    pub updated_at: String,
}

/// Read the current dashboard spec. Returns `None` if Athena hasn't
/// composed one yet (the dashboard tab will show an empty state).
pub fn load_dashboard(pool: &UserDbPool) -> Result<Option<Dashboard>, AppError> {
    let conn = pool.get()?;
    let row: Option<String> = conn
        .query_row(
            "SELECT updated_at FROM companion_node WHERE id = ?1 AND kind = 'dashboard'",
            params![DASHBOARD_ID],
            |r| r.get::<_, String>(0),
        )
        .optional()?;
    let Some(updated_at) = row else {
        return Ok(None);
    };
    let path = disk::brain_root()?.join(DASHBOARD_REL_PATH);
    let spec_json = fs::read_to_string(&path).unwrap_or_default();
    if spec_json.is_empty() {
        return Ok(None);
    }
    Ok(Some(Dashboard {
        spec_json,
        updated_at,
    }))
}

fn excerpt_500(s: &str) -> String {
    util::excerpt(s, 500)
}

#[cfg(test)]
mod tests {
    //! Three properties, all of which `save_dashboard` lacked until
    //! 2026-09-03: a pinned widget survives a compose, the node row keeps
    //! describing the bytes on disk, and there is exactly one step back.
    //!
    //! Pool checkouts propagate rather than unwrap, for the reason
    //! `pool-get-unwrapped` counts fixtures at all.

    use super::*;
    use crate::companion::brain::test_home::TestHome;

    struct Brain {
        pool: UserDbPool,
        _home: TestHome,
    }

    fn brain() -> Result<Brain, AppError> {
        let home = TestHome::new("dashboard");
        // In production `disk::ensure_initialized` has created this tree at
        // boot before any compose can reach here, so — like `cockpit.rs` —
        // the writer does not create it. The fixture stands in for that.
        fs::create_dir_all(disk::brain_root()?)?;
        Ok(Brain {
            pool: crate::db::init_test_user_db()?,
            _home: home,
        })
    }

    fn spec(widgets: &str) -> String {
        format!("{{\"title\":\"Ops\",\"widgets\":{widgets}}}")
    }

    fn widget_kinds(json: &str) -> Vec<String> {
        serde_json::from_str::<serde_json::Value>(json)
            .expect("spec is json")
            .get("widgets")
            .and_then(|v| v.as_array())
            .expect("widgets array")
            .iter()
            .map(|w| {
                w.get("kind")
                    .and_then(|k| k.as_str())
                    .unwrap_or("?")
                    .to_string()
            })
            .collect()
    }

    fn current_kinds(pool: &UserDbPool) -> Result<Vec<String>, AppError> {
        let d = load_dashboard(pool)?.ok_or_else(|| AppError::Internal("no spec".into()))?;
        Ok(widget_kinds(&d.spec_json))
    }

    /// The whole point of the merge. Athena recomposing must not silently
    /// delete something the user pinned — the failure `cockpit.rs` already
    /// fixed and this file had not.
    #[test]
    fn a_pinned_widget_survives_a_recompose() -> Result<(), AppError> {
        let b = brain()?;
        save_dashboard(
            &b.pool,
            &spec(r#"[{"kind":"kpi_tile","config":{"m":"cost"},"pinned":true}]"#),
        )?;
        save_dashboard(
            &b.pool,
            &spec(r#"[{"kind":"activity_heatmap","config":{}}]"#),
        )?;

        let kinds = current_kinds(&b.pool)?;
        assert!(
            kinds.contains(&"activity_heatmap".to_string()),
            "the new compose renders first"
        );
        assert!(
            kinds.contains(&"kpi_tile".to_string()),
            "the pinned widget must be carried forward, not overwritten"
        );
        Ok(())
    }

    /// A pin Athena happens to re-compose must not render twice. Same
    /// (kind, config) is the same surface.
    #[test]
    fn a_recomposed_pin_is_not_duplicated() -> Result<(), AppError> {
        let b = brain()?;
        save_dashboard(
            &b.pool,
            &spec(r#"[{"kind":"kpi_tile","config":{"m":"cost"},"pinned":true}]"#),
        )?;
        save_dashboard(
            &b.pool,
            &spec(r#"[{"kind":"kpi_tile","config":{"m":"cost"}}]"#),
        )?;
        assert_eq!(current_kinds(&b.pool)?.len(), 1);
        Ok(())
    }

    /// Nothing pinned is the state of every dashboard today (no pin command
    /// exists for this surface yet), so the ordinary path must stay a plain
    /// overwrite.
    #[test]
    fn an_unpinned_dashboard_is_replaced_wholesale() -> Result<(), AppError> {
        let b = brain()?;
        save_dashboard(&b.pool, &spec(r#"[{"kind":"kpi_tile","config":{}}]"#))?;
        save_dashboard(
            &b.pool,
            &spec(r#"[{"kind":"activity_heatmap","config":{}}]"#),
        )?;
        assert_eq!(current_kinds(&b.pool)?, vec!["activity_heatmap"]);
        Ok(())
    }

    /// One step back, and the step back is itself reversible.
    #[test]
    fn reset_restores_the_previous_compose_and_can_be_undone() -> Result<(), AppError> {
        let b = brain()?;
        assert!(
            !reset_dashboard(&b.pool)?,
            "no prior version means no reset, not an error"
        );

        save_dashboard(&b.pool, &spec(r#"[{"kind":"kpi_tile","config":{}}]"#))?;
        save_dashboard(&b.pool, &spec(r#"[{"kind":"log_excerpt","config":{}}]"#))?;

        assert!(reset_dashboard(&b.pool)?);
        assert_eq!(current_kinds(&b.pool)?, vec!["kpi_tile"]);

        assert!(reset_dashboard(&b.pool)?);
        assert_eq!(
            current_kinds(&b.pool)?,
            vec!["log_excerpt"],
            "reset is a swap: the version it replaced becomes the new backup"
        );
        Ok(())
    }

    /// The node row is the index over the file. If its hash stops describing
    /// the bytes, every "has this changed" question answers wrongly forever.
    #[test]
    fn the_node_row_hash_matches_the_bytes_on_disk() -> Result<(), AppError> {
        let b = brain()?;
        save_dashboard(&b.pool, &spec(r#"[{"kind":"kpi_tile","config":{}}]"#))?;
        let on_disk = fs::read_to_string(disk::brain_root()?.join(DASHBOARD_REL_PATH))?;
        let conn = b.pool.get()?;
        let stored: String = conn.query_row(
            "SELECT content_hash FROM companion_node WHERE id = ?1",
            params![DASHBOARD_ID],
            |r| r.get(0),
        )?;
        assert_eq!(stored, util::sha256_hex(&on_disk));
        Ok(())
    }
}
