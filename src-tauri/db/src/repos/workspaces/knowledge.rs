use crate::models::WorkspaceKnowledge;
use crate::DbPool;
use personas_core::error::AppError;
use rusqlite::{params, OptionalExtension, Row};
use std::collections::HashMap;

use super::adoption::initial_adoption_state;
use super::org::get_workspace_by_id;

pub const KNOWLEDGE_KINDS: [&str; 5] = ["pattern", "pitfall", "decision", "howto", "fact"];

/// The zoom axis: workspace-wide doctrine (`macro`), project-level pattern
/// (`meso`), or a local technique (`micro`). Closed for the same reason
/// `topic`/`ftype` are (see `workspace_taxonomy`): the doctrine roll-up below
/// gates on an EXACT `Some("macro")`, and the TS binding casts this column
/// straight to a 3-value union (`Abstraction`) with no runtime check, so a
/// writer's `"Macro"` or `"high-level"` doesn't just fail to roll up — it also
/// breaks the TS-side type contract. Unlike `topic`/`ftype` this is a strict
/// 3-way enum, not an open taxonomy, so there is no natural "unsorted" shelf
/// to land an unrecognized value on; `normalize_abstraction` refuses it to
/// `None` instead (same disposition already used for `durability` below).
pub const KNOWLEDGE_ABSTRACTIONS: [&str; 3] = ["macro", "meso", "micro"];

/// Coerce a writer-supplied `abstraction` onto the closed zoom axis. Case and
/// surrounding whitespace are normalized; unset stays unset; anything else
/// unrecognized is refused to `None` rather than stored as a value the
/// roll-up gate and the TS `Abstraction` union both silently mishandle.
pub fn normalize_abstraction(raw: Option<&str>) -> Option<String> {
    let s = raw?.trim().to_lowercase();
    KNOWLEDGE_ABSTRACTIONS.contains(&s.as_str()).then_some(s)
}

pub const KNOWLEDGE_STATUSES: [&str; 5] =
    ["observed", "proposed", "adopted", "deprecated", "rejected"];

fn row_to_knowledge(row: &Row) -> rusqlite::Result<WorkspaceKnowledge> {
    Ok(WorkspaceKnowledge {
        id: row.get("id")?,
        workspace_id: row.get("workspace_id")?,
        kind: row.get("kind")?,
        title: row.get("title")?,
        statement: row.get("statement")?,
        detail_md: row.get("detail_md")?,
        topic: row.get("topic")?,
        abstraction: row.get("abstraction")?,
        ftype: row.get("ftype")?,
        durability: row.get("durability")?,
        governing_id: row.get("governing_id")?,
        evidence_count: row.get("evidence_count")?,
        applicability: row.get("applicability")?,
        status: row.get("status")?,
        origin_project_id: row.get("origin_project_id")?,
        provenance: row.get("provenance")?,
        confidence: row.get("confidence")?,
        dedup_key: row.get("dedup_key")?,
        superseded_by: row.get("superseded_by")?,
        valid_from: row.get("valid_from")?,
        valid_to: row.get("valid_to")?,
        decided_at: row.get("decided_at")?,
        harvest_scope: row.get("harvest_scope")?,
        layer: row.get("layer")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub(super) fn validate_one_of(value: &str, allowed: &[&str], label: &str) -> Result<(), AppError> {
    if allowed.contains(&value) {
        Ok(())
    } else {
        Err(AppError::Validation(format!(
            "Invalid {label} '{value}' — expected one of: {}",
            allowed.join(", ")
        )))
    }
}

// ============================================================================
// Workspaces
// ============================================================================

pub fn list_knowledge(
    pool: &DbPool,
    workspace_id: &str,
    status: Option<&str>,
) -> Result<Vec<WorkspaceKnowledge>, AppError> {
    if let Some(s) = status {
        validate_one_of(s, &KNOWLEDGE_STATUSES, "status")?;
    }
    timed_query!("workspace_knowledge", "dev_workspaces::list_knowledge", {
        let conn = pool.get()?;
        if let Some(status) = status {
            let mut stmt = conn.prepare(
                "SELECT * FROM workspace_knowledge WHERE workspace_id = ?1 AND status = ?2
                 ORDER BY updated_at DESC",
            )?;
            let rows = stmt.query_map(params![workspace_id, status], row_to_knowledge)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        } else {
            let mut stmt = conn.prepare(
                "SELECT * FROM workspace_knowledge WHERE workspace_id = ?1
                 ORDER BY updated_at DESC",
            )?;
            let rows = stmt.query_map(params![workspace_id], row_to_knowledge)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    })
}

pub fn get_knowledge_by_id(pool: &DbPool, id: &str) -> Result<WorkspaceKnowledge, AppError> {
    timed_query!(
        "workspace_knowledge",
        "dev_workspaces::get_knowledge_by_id",
        {
            let conn = pool.get()?;
            conn.query_row(
                "SELECT * FROM workspace_knowledge WHERE id = ?1",
                params![id],
                row_to_knowledge,
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    AppError::NotFound(format!("Workspace knowledge {id}"))
                }
                other => AppError::Database(other),
            })
        }
    )
}

/// Create a human-authored practice. Lands as `proposed` (the author is
/// nominating it); machine writers (harvest/miners, Arc 2) use a dedicated
/// ingest path that lands `observed` with agent provenance.
#[allow(clippy::too_many_arguments)]
pub fn create_knowledge(
    pool: &DbPool,
    workspace_id: &str,
    kind: &str,
    title: &str,
    statement: &str,
    detail_md: Option<&str>,
    topic: Option<&str>,
    applicability: Option<&str>,
    origin_project_id: Option<&str>,
) -> Result<WorkspaceKnowledge, AppError> {
    validate_one_of(kind, &KNOWLEDGE_KINDS, "kind")?;
    if title.trim().is_empty() {
        return Err(AppError::Validation("Title cannot be empty".into()));
    }
    if statement.trim().is_empty() {
        return Err(AppError::Validation("Statement cannot be empty".into()));
    }
    if let Some(json) = applicability {
        serde_json::from_str::<serde_json::Value>(json)
            .map_err(|e| AppError::Validation(format!("Invalid applicability JSON: {e}")))?;
    }
    get_workspace_by_id(pool, workspace_id)?;

    timed_query!("workspace_knowledge", "dev_workspaces::create_knowledge", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let provenance = "{\"actor_kind\":\"human\"}";
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO workspace_knowledge
                 (id, workspace_id, kind, title, statement, detail_md, topic, applicability,
                  status, origin_project_id, provenance, valid_from, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'proposed', ?9, ?10, ?11, ?11, ?11)",
            params![
                id,
                workspace_id,
                kind,
                title.trim(),
                statement.trim(),
                detail_md,
                // A hand-authored topic is normalized onto the taxonomy too, so
                // a stray `ui/…` cannot reopen an area the library already
                // merged away. Blank stays blank: the human path may leave a
                // practice untopiced, unlike the machine door.
                topic
                    .map(|t| t.trim())
                    .filter(|t| !t.is_empty())
                    .map(|t| crate::repos::workspace_taxonomy::normalize_topic(Some(t))),
                applicability,
                origin_project_id,
                provenance,
                now
            ],
        )?;
        get_knowledge_by_id(pool, &id)
    })
}

#[allow(clippy::too_many_arguments)]
pub fn update_knowledge(
    pool: &DbPool,
    id: &str,
    kind: Option<&str>,
    title: Option<&str>,
    statement: Option<&str>,
    detail_md: Option<Option<&str>>,
    topic: Option<Option<&str>>,
    applicability: Option<Option<&str>>,
) -> Result<WorkspaceKnowledge, AppError> {
    if let Some(k) = kind {
        validate_one_of(k, &KNOWLEDGE_KINDS, "kind")?;
    }
    if let Some(Some(json)) = applicability {
        serde_json::from_str::<serde_json::Value>(json)
            .map_err(|e| AppError::Validation(format!("Invalid applicability JSON: {e}")))?;
    }
    timed_query!("workspace_knowledge", "dev_workspaces::update_knowledge", {
        get_knowledge_by_id(pool, id)?;
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;

        let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
        let mut param_idx = 2u32;
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

        push_field_param!(
            kind.map(|s| s.to_string()),
            "kind",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            title.map(|s| s.trim().to_string()),
            "title",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            statement.map(|s| s.trim().to_string()),
            "statement",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            // Same normalization as the create path — an edit is another way
            // to reopen a merged-away area. Explicit clear (None) survives.
            topic.map(|o| o.map(|s| crate::repos::workspace_taxonomy::normalize_topic(Some(s)))),
            "topic",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            detail_md.map(|o| o.map(|s| s.to_string())),
            "detail_md",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            applicability.map(|o| o.map(|s| s.to_string())),
            "applicability",
            sets,
            param_idx,
            param_values,
            clone
        );

        let sql = format!(
            "UPDATE workspace_knowledge SET {} WHERE id = ?{}",
            sets.join(", "),
            param_idx
        );
        param_values.push(Box::new(id.to_string()));
        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, params_ref.as_slice())?;

        get_knowledge_by_id(pool, id)
    })
}

/// The single governance gate. `decision`:
/// - `propose`   — nominate an `observed` item (machine-harvested) for review
/// - `adopt`     — adopt a `proposed` item; fans out the adoption queue to
///                 every member project (`proposed`/`na` by applicability)
/// - `reject`    — reject with retention (miners dedup against it)
/// - `deprecate` — retire an adopted item, optionally superseded by another
pub fn decide_knowledge(
    pool: &DbPool,
    id: &str,
    decision: &str,
    superseded_by: Option<&str>,
) -> Result<WorkspaceKnowledge, AppError> {
    decide_knowledge_cas(pool, id, decision, superseded_by, None)
}

/// [`decide_knowledge`] with a COMPARE-AND-SWAP guard.
///
/// `expected` is the status the calling surface SAW on the row. The triage deck
/// and the practice modal both render a pending (`observed`/`proposed`) row and
/// then write a verdict against it; without the predicate below, two surfaces
/// holding the same row each committed a governance decision, and `adopt`
/// additionally fanned an `INSERT OR IGNORE` adoption cell into every member
/// repo — so a rejected practice could end up `adopted` with adoption cells
/// nobody asked for, or vice versa, with no warning.
///
/// Pass `None` from paths with no rendered row (the bulk adjudicator selects
/// its own working set); the swap then runs against the status read in this
/// call, which still closes the read→write interleave that the adoption fan-out
/// must never pass through twice.
///
/// Returns [`AppError::Validation`] on a lost swap. The MESSAGE is a contract:
/// `src/lib/decisions/rowWrites.ts` (`isDecisionConflict`) and the error registry
/// both match `/already (decided|resolved) … by a concurrent action/` to tell a
/// lost swap apart from a failed write — the two make optimistic surfaces behave
/// differently, so reword it and they silently degrade to "could not record that
/// decision". `src/lib/decisions/__tests__/rowWrites.test.ts` pins the exact
/// strings all three row types emit.
pub fn decide_knowledge_cas(
    pool: &DbPool,
    id: &str,
    decision: &str,
    superseded_by: Option<&str>,
    expected: Option<&str>,
) -> Result<WorkspaceKnowledge, AppError> {
    let item = get_knowledge_by_id(pool, id)?;
    let new_status = match decision {
        "propose" => "proposed",
        "adopt" => "adopted",
        "reject" => "rejected",
        "deprecate" => "deprecated",
        other => {
            return Err(AppError::Validation(format!(
                "Invalid decision '{other}' — expected propose, adopt, reject or deprecate"
            )))
        }
    };
    if let Some(sup) = superseded_by {
        if decision != "deprecate" {
            return Err(AppError::Validation(
                "superseded_by is only valid with decision 'deprecate'".into(),
            ));
        }
        get_knowledge_by_id(pool, sup)?;
    }

    // Re-applying the status a row already carries is a no-op success, not a
    // conflict — same posture as the idea verdict core, and what keeps a replayed
    // bulk decision from reporting failures it did not cause.
    if item.status == new_status {
        return Ok(item);
    }

    // Fail fast with the informative message before opening a transaction.
    if let Some(seen) = expected {
        if item.status != seen {
            return Err(AppError::Validation(format!(
                "Practice {id} was already decided as '{}' by a concurrent action",
                item.status
            )));
        }
    }
    let swap_from = item.status.clone();

    timed_query!("workspace_knowledge", "dev_workspaces::decide_knowledge", {
        let now = chrono::Utc::now().to_rfc3339();
        let mut conn = pool.get()?;
        let tx = conn.transaction()?;

        let rows = tx.execute(
            "UPDATE workspace_knowledge
             SET status = ?1, decided_at = ?2, updated_at = ?2,
                 superseded_by = COALESCE(?3, superseded_by),
                 valid_to = CASE WHEN ?1 IN ('deprecated','rejected') THEN ?2 ELSE valid_to END
             WHERE id = ?4 AND status = ?5",
            params![new_status, now, superseded_by, id, swap_from],
        )?;

        if rows == 0 {
            // The row exists (read above), so a 0-row swap means someone else's
            // verdict landed first. Roll back rather than fan out adoption cells
            // for a decision that never committed.
            tx.rollback()?;
            let actual = get_knowledge_by_id(pool, id)?;
            return Err(AppError::Validation(format!(
                "Practice {id} was already decided as '{}' by a concurrent action",
                actual.status
            )));
        }

        if new_status == "adopted" {
            // F4: an adopted EXTENSION joins its parent's cluster when it has
            // no real home of its own (no topic, or quarantined `unsorted/*`).
            // Only the topic is inherited — playbook membership stays a
            // curator suggestion in the rail, never an automatic join.
            let needs_home = item
                .topic
                .as_deref()
                .map(|t| t.is_empty() || t.starts_with("unsorted"))
                .unwrap_or(true);
            if needs_home {
                let parent_topic: Option<String> = tx
                    .query_row(
                        "SELECT k.topic FROM workspace_pattern_edges e
                         JOIN workspace_knowledge k ON k.id = e.to_id
                         WHERE e.from_id = ?1 AND e.rel = 'extends'
                         LIMIT 1",
                        params![id],
                        |r| r.get(0),
                    )
                    .unwrap_or(None);
                if let Some(t) = parent_topic {
                    tx.execute(
                        "UPDATE workspace_knowledge SET topic = ?1 WHERE id = ?2",
                        params![t, id],
                    )?;
                }
            }

            let members: Vec<(String, Option<String>)> =
                crate::repos::dev::projects::workspace_members_with_tech_stack(
                    &tx,
                    &item.workspace_id,
                )?;
            for (project_id, tech_stack) in members {
                let state = initial_adoption_state(
                    &item.kind,
                    item.applicability.as_deref(),
                    tech_stack.as_deref(),
                );
                tx.execute(
                    "INSERT OR IGNORE INTO workspace_practice_adoption
                         (practice_id, project_id, state, updated_at)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![id, project_id, state, now],
                )?;
            }
        }

        tx.commit()?;
        get_knowledge_by_id(pool, id)
    })
}

/// Adjudicate many practices in one call.
///
/// A twelve-territory scan lands a few hundred `observed` items at once. At one
/// modal per item a reviewer needs hours, the governance pillar sits at ~5%
/// forever, and the honest response to a large harvest becomes "don't run one".
/// Reviewing a whole topic at a time is the shape that actually matches how a
/// human reads a library.
///
/// Per-item failures are collected, never fatal: one malformed row must not
/// discard a reviewer's decision on the other forty-nine.
pub fn decide_knowledge_bulk(
    pool: &DbPool,
    ids: &[String],
    decision: &str,
    superseded_by: Option<&str>,
) -> Result<BulkDecision, AppError> {
    let mut out = BulkDecision::default();
    for id in ids {
        match decide_knowledge(pool, id, decision, superseded_by) {
            Ok(k) => {
                out.decided += 1;
                out.ids.push(k.id);
            }
            Err(e) => {
                tracing::warn!(practice_id = %id, error = %e, "bulk decide: item failed");
                out.failed.push(format!("{id}: {e}"));
            }
        }
    }
    Ok(out)
}

#[derive(Debug, Default, Clone, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BulkDecision {
    pub decided: u32,
    pub ids: Vec<String>,
    pub failed: Vec<String>,
}

/// Link every practice in a topic to that topic's governing doctrine.
///
/// `governing_id` has existed since the categorization axes shipped and the
/// 2026-07-27 scan set it on 0 of 330 items — a harvest session sees one
/// territory and cannot know what a topic already holds. So the app derives it
/// after ingest, where the whole topic IS visible.
///
/// The rule is deliberately dumb and deterministic: within a topic, the
/// `macro` item with the most evidence is the doctrine, and every other live
/// item in that topic with no governor points at it. No doctrine, no linking —
/// an invented parent is worse than a flat list.
pub fn roll_up_topic_doctrine(pool: &DbPool, workspace_id: &str) -> Result<u32, AppError> {
    timed_query!(
        "workspace_knowledge",
        "dev_workspaces::roll_up_topic_doctrine",
        {
            let now = chrono::Utc::now().to_rfc3339();
            let mut conn = pool.get()?;
            let tx = conn.transaction()?;
            let rows: Vec<(String, String, Option<String>, i64, Option<String>)> = {
                let mut stmt = tx.prepare(
                    "SELECT id, topic, abstraction, COALESCE(evidence_count, 0), governing_id
                 FROM workspace_knowledge
                 WHERE workspace_id = ?1 AND status NOT IN ('rejected', 'deprecated')",
                )?;
                let r = stmt
                    .query_map(params![workspace_id], |r| {
                        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                r
            };

            let mut doctrine: HashMap<String, (String, i64)> = HashMap::new();
            for (id, topic, abstraction, evidence, _) in &rows {
                if abstraction.as_deref() != Some("macro") {
                    continue;
                }
                doctrine
                    .entry(topic.clone())
                    .and_modify(|best| {
                        // Ties break on id so the choice is stable across runs.
                        if *evidence > best.1 || (*evidence == best.1 && *id < best.0) {
                            *best = (id.clone(), *evidence);
                        }
                    })
                    .or_insert((id.clone(), *evidence));
            }

            let mut linked = 0u32;
            for (id, topic, _, _, governing) in &rows {
                if governing.is_some() {
                    continue;
                }
                let Some((doc_id, _)) = doctrine.get(topic) else {
                    continue;
                };
                if doc_id == id {
                    continue; // the doctrine does not govern itself
                }
                tx.execute(
                "UPDATE workspace_knowledge SET governing_id = ?1, updated_at = ?2 WHERE id = ?3",
                params![doc_id, now, id],
            )?;
                linked += 1;
            }
            tx.commit()?;
            Ok(linked)
        }
    )
}

pub fn delete_knowledge(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("workspace_knowledge", "dev_workspaces::delete_knowledge", {
        let mut conn = pool.get()?;
        let tx = conn.transaction()?;
        tx.execute(
            "DELETE FROM workspace_practice_adoption WHERE practice_id = ?1",
            params![id],
        )?;
        let rows = tx.execute("DELETE FROM workspace_knowledge WHERE id = ?1", params![id])?;
        tx.commit()?;
        Ok(rows > 0)
    })
}

// ============================================================================
// Harvest coverage — which territory of a member repo has been read
// ============================================================================

/// Set a knowledge row's place in the three-layer hierarchy (pattern-fabric
/// v2). Nullable-patch semantics per field: outer `None` = leave alone, inner
/// `None` = clear. Setting `governing_id` also mirrors the `governs` edge
/// (and clearing removes the mirror from the OLD governor), so the graph and
/// the fast-path column cannot drift.
pub fn set_knowledge_structure(
    pool: &DbPool,
    id: &str,
    layer: Option<Option<&str>>,
    governing_id: Option<Option<&str>>,
) -> Result<WorkspaceKnowledge, AppError> {
    let conn = pool.get()?;
    let now = chrono::Utc::now().to_rfc3339();
    if let Some(l) = layer {
        if let Some(v) = l {
            validate_one_of(v, &["principle", "manifestation"], "layer")?;
        }
        conn.execute(
            "UPDATE workspace_knowledge SET layer = ?1, updated_at = ?2 WHERE id = ?3",
            params![l, now, id],
        )?;
    }
    if let Some(g) = governing_id {
        // Old governor first, so a cleared/changed parent drops its mirror.
        let old: Option<String> = conn
            .query_row(
                "SELECT governing_id FROM workspace_knowledge WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .optional()?
            .flatten();
        if let Some(new_parent) = g {
            if new_parent == id {
                return Err(AppError::Validation(
                    "a knowledge row cannot govern itself".into(),
                ));
            }
            let exists: bool = conn
                .query_row(
                    "SELECT 1 FROM workspace_knowledge WHERE id = ?1",
                    params![new_parent],
                    |_| Ok(true),
                )
                .optional()?
                .unwrap_or(false);
            if !exists {
                return Err(AppError::Validation(format!(
                    "governing target `{new_parent}` does not exist"
                )));
            }
        }
        conn.execute(
            "UPDATE workspace_knowledge SET governing_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![g, now, id],
        )?;
        if let Some(prev) = old.filter(|p| Some(p.as_str()) != g) {
            conn.execute(
                "DELETE FROM workspace_pattern_edges
                 WHERE from_id = ?1 AND to_id = ?2 AND rel = 'governs'",
                params![prev, id],
            )?;
        }
        if let Some(new_parent) = g {
            conn.execute(
                "INSERT OR IGNORE INTO workspace_pattern_edges
                     (from_id, to_id, rel, note, created_at)
                 VALUES (?1, ?2, 'governs', NULL, ?3)",
                params![new_parent, id, now],
            )?;
        }
    }
    get_knowledge_by_id(pool, id)
}

#[cfg(test)]
mod extends_loop_tests {
    use super::*;
    use crate::repos::workspaces::ingest::{ingest_candidates, KnowledgeCandidate};
    use crate::repos::workspaces::org::create_workspace;
    use crate::repos::workspaces::pattern_edges::list_pattern_edges;

    /// Delegates to the crate fixture, which copies a once-built,
    /// fully-migrated template instead of re-running the migration chain
    /// (~436 statements) per test. This fixture used to run the chain
    /// itself against a shared-cache in-memory DB; correct, but it paid
    /// the full setup cost on every one of these tests.
    fn pool() -> DbPool {
        crate::init_test_db().expect("test db")
    }

    fn candidate(title: &str, extends: Option<&str>) -> KnowledgeCandidate {
        KnowledgeCandidate {
            harvest_scope: None,
            kind: "pattern".into(),
            title: title.into(),
            statement: "A statement.".into(),
            detail_md: None,
            topic: None,
            abstraction: None,
            ftype: None,
            durability: None,
            governing_id: None,
            evidence_count: None,
            applicability: None,
            origin_project_id: None,
            dedup_key: Some(format!("t:{title}")),
            confidence: None,
            extends: extends.map(str::to_string),
            layer: None,
            evidence: Vec::new(),
        }
    }

    #[test]
    fn extends_creates_a_child_to_parent_edge_and_dangling_is_reported() {
        let pool = pool();
        let ws = create_workspace(&pool, "WS", None, None, false).unwrap();
        // Parent enters the library first.
        let s1 =
            ingest_candidates(&pool, &ws.id, &[candidate("Parent", None)], "test", None).unwrap();
        assert_eq!(s1.inserted, 1);
        let parent_id: String = pool
            .get()
            .unwrap()
            .query_row(
                "SELECT id FROM workspace_knowledge WHERE title = 'Parent'",
                [],
                |r| r.get(0),
            )
            .unwrap();

        // Child extends it; a second child extends a ghost.
        let s2 = ingest_candidates(
            &pool,
            &ws.id,
            &[
                candidate("Child", Some(&parent_id)),
                candidate("Ghost child", Some("nope")),
            ],
            "test",
            None,
        )
        .unwrap();
        assert_eq!(s2.inserted, 2, "a dangling extends never blocks the item");
        assert!(
            s2.skipped
                .iter()
                .any(|m| m.contains("extends target nope not found")),
            "the skipped edge is reported: {:?}",
            s2.skipped
        );

        let edges = list_pattern_edges(&pool, &ws.id).unwrap();
        assert_eq!(edges.len(), 1);
        // Direction: CHILD extends PARENT — from is the refinement, to is canon.
        assert_eq!(edges[0].to_id, parent_id);
        assert_eq!(edges[0].rel, "extends");
    }

    #[test]
    fn adopting_an_extension_inherits_the_parents_topic_when_it_has_none() {
        let pool = pool();
        let ws = create_workspace(&pool, "WS", None, None, false).unwrap();
        ingest_candidates(&pool, &ws.id, &[candidate("Parent", None)], "test", None).unwrap();
        let parent_id: String = pool
            .get()
            .unwrap()
            .query_row(
                "SELECT id FROM workspace_knowledge WHERE title = 'Parent'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        // Give the parent a real home.
        pool.get()
            .unwrap()
            .execute(
                "UPDATE workspace_knowledge SET topic = 'data/migrations/tables' WHERE id = ?1",
                params![parent_id],
            )
            .unwrap();
        ingest_candidates(
            &pool,
            &ws.id,
            &[candidate("Child", Some(&parent_id))],
            "test",
            None,
        )
        .unwrap();
        let child_id: String = pool
            .get()
            .unwrap()
            .query_row(
                "SELECT id FROM workspace_knowledge WHERE title = 'Child'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        // Child landed with a quarantined topic (no topic given -> unsorted/*).
        let adopted = decide_knowledge(&pool, &child_id, "adopt", None).unwrap();
        assert_eq!(
            adopted.topic.as_deref(),
            Some("data/migrations/tables"),
            "an adopted extension joins its parent's cluster when it has no home of its own"
        );
    }
}

// ============================================================================
// Deterministic miners (no LLM) — Arc 2
// ============================================================================
