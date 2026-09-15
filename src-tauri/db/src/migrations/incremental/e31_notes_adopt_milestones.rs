//! Every open milestone gets the brief it now needs — once.
//!
//! e30 made a note able to BE a milestone's brief. This step makes that the
//! only way a milestone is READ: the Factory's Ship tab was retired in the same
//! change, so a milestone with no note attached to it has no surface at all —
//! its cut, its exit criteria and its runs are reachable only through the pad,
//! and the pad only shows notes. On an existing database that would silently
//! hide every milestone the operator already has.
//!
//! So: one note per adoptable milestone, carrying the milestone's own words.
//!
//! | milestone            | note                                        |
//! |----------------------|---------------------------------------------|
//! | `name`               | `title`                                     |
//! | `description`        | `body_md` (`''` when NULL — the column is NOT NULL) |
//! | `project_id`         | `project_id`                                |
//! | `id`                 | `milestone_id` (the 1:1 link e30 added)     |
//! | `cut_at IS NULL`     | `status = 'scoped'`, else `'cut'`           |
//!
//! **Shipped milestones are not adopted.** A shipped milestone is history; a
//! note minted for it would land in the pad's Shipped archive as a brief nobody
//! wrote, for work nobody can still change.
//!
//! **This step bypasses the ten-note cap on purpose.** The cap
//! (`repos::dev::notes::NOTE_CAP`) is enforced by the COMMAND layer, not by the
//! table, and it is a working-set bound on what an operator puts on their desk
//! by hand — not a reason to leave a project's existing milestones unreadable.
//! An operator with twelve open milestones gets twelve notes and a desk that
//! reads "12 of 10"; archiving is never blocked by the cap, so recovering is one
//! pass through the pad.
//!
//! ## Why this step carries a marker instead of probing
//!
//! It is a ONE-TIME backfill at a retirement, and it fires exactly once. The
//! probe is [`settings_keys::MIGRATION_E31_NOTES_ADOPT_MILESTONES`] in
//! `app_settings` — the only migration marker in this chain, and the reason it
//! had to be one is worth stating rather than rediscovering.
//!
//! Every other step in this chain probes its own postcondition, which works
//! because a schema postcondition (`has_column`, `has_table`, `has_index`) is
//! reached once and stays reached. This step's natural postcondition — "no open
//! milestone lacks a brief" — is not like that: it becomes false again whenever
//! a new milestone is created, and nothing in a `COUNT(*)` can tell a milestone
//! the backfill has not seen from one created after it ran. A count probe would
//! therefore have turned a one-time migration into a standing boot-time rule
//! that silently mints notes, over the cap, for every future note-less
//! milestone. The marker is written in the SAME transaction as the inserts, so
//! a crash mid-backfill leaves neither the notes nor the marker.
//!
//! **The accepted follow-up, named here so nobody has to rediscover it either.**
//! A milestone can still be born without a brief after this step:
//! `passport/PassportActionsRow.tsx:95` seeds an onboarding milestone, and
//! `engine::management_api::ship::create_milestone_for_project` creates one for
//! an agent. Such a milestone shows nothing on the desk until the operator links
//! it from a note's Milestone picker. That is a product follow-up, not something
//! this migration should paper over by re-firing.

use rusqlite::{params, Connection};

use personas_core::error::AppError;

use crate::settings_keys::MIGRATION_E31_NOTES_ADOPT_MILESTONES;

use super::support::*;

/// The milestones this step adopts: not shipped, and not already briefed.
const ADOPTABLE: &str = "FROM dev_milestones m
     WHERE m.status != 'shipped'
       AND NOT EXISTS (SELECT 1 FROM dev_notes n WHERE n.milestone_id = m.id)";

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_notes.adopt_open_milestones",
            description:
                "Notepad: one-time backfill minting a brief note for every open milestone that has none, so retiring the Factory Ship tab does not hide work the operator already has",
            already_applied: |conn| {
                // A database that has not reached e22/c03 yet has nothing to
                // adopt and nowhere to put it, and one without `app_settings`
                // has nowhere to record that it ran — running without being
                // able to record it is what makes a backfill repeat. All three
                // are guaranteed by the time this step runs on the real boot
                // path; the guard is for the partially-built connections tests
                // hand around.
                if !has_table(conn, "dev_notes")?
                    || !has_table(conn, "dev_milestones")?
                    || !has_table(conn, "app_settings")?
                {
                    return Ok(true);
                }
                marker_present(conn)
            },
            apply: adopt_open_milestones,
        },
    )?;

    Ok(())
}

/// Has the backfill already run? Presence of the key is the whole answer — the
/// value is the instant it ran and is never parsed.
fn marker_present(conn: &Connection) -> Result<bool, AppError> {
    // Aliased so the read is BY NAME: a positional `get(0)` is the shape
    // `positional-row-get` counts, and an aggregate is the one place a name has
    // to be invented rather than borrowed.
    let found: i64 = conn.query_row(
        "SELECT COUNT(*) AS found FROM app_settings WHERE key = ?1",
        params![MIGRATION_E31_NOTES_ADOPT_MILESTONES],
        |r| r.get("found"),
    )?;
    Ok(found > 0)
}

/// One note per adoptable milestone, plus the marker, in one transaction.
///
/// `order_index` is taken one row at a time rather than as `MAX + rownum`:
/// `dev_notes` carries `UNIQUE(order_index)` (e22), and the value has to be read
/// back after each insert or the second note of the batch collides with the
/// first. This mirrors `repos::dev::notes::create_note`, which takes
/// `COALESCE(MAX(order_index), -1) + 1` for the same reason.
fn adopt_open_milestones(conn: &Connection) -> Result<(), AppError> {
    let tx = conn.unchecked_transaction()?;

    let candidates: Vec<(String, String, String, Option<String>, bool)> = {
        let mut stmt = tx.prepare(&format!(
            "SELECT m.id, m.project_id, m.name, m.description, m.cut_at IS NOT NULL AS is_cut
             {ADOPTABLE}
             ORDER BY m.project_id, m.order_index, m.created_at"
        ))?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>("id")?,
                r.get::<_, String>("project_id")?,
                r.get::<_, String>("name")?,
                r.get::<_, Option<String>>("description")?,
                r.get::<_, bool>("is_cut")?,
            ))
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?
    };

    let now = chrono::Utc::now().to_rfc3339();
    for (milestone_id, project_id, name, description, is_cut) in &candidates {
        let order_index: i64 = tx.query_row(
            "SELECT COALESCE(MAX(order_index), -1) + 1 AS next_index FROM dev_notes",
            [],
            |row| row.get("next_index"),
        )?;
        // A cut milestone's brief is `cut`, an uncut one's is `scoped` — the
        // same two states the pad's own promote/cut ceremony moves a note
        // through, so an adopted note is indistinguishable from one the
        // operator produced by hand.
        let status = if *is_cut { "cut" } else { "scoped" };
        tx.execute(
            "INSERT INTO dev_notes
                (id, project_id, milestone_id, title, body_md, status, order_index, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
            params![
                uuid::Uuid::new_v4().to_string(),
                project_id,
                milestone_id,
                name,
                description.as_deref().unwrap_or(""),
                status,
                order_index,
                now,
            ],
        )?;
    }

    // Same transaction as the inserts, deliberately: a crash between them would
    // otherwise leave the notes minted and the backfill still "pending", and the
    // next boot would re-run it against a database that had already been done.
    tx.execute(
        "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![MIGRATION_E31_NOTES_ADOPT_MILESTONES, now],
    )?;

    tx.commit()?;
    tracing::info!(
        adopted = candidates.len(),
        "e31: adopted open milestones as notepad briefs (one-time backfill)",
    );
    Ok(())
}
