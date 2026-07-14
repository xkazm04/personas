use rusqlite::params;

use crate::db::DbPool;
use crate::engine::trace::ExecutionTrace;
use crate::error::AppError;

/// Save an execution trace to the database.
pub fn save(pool: &DbPool, trace: &ExecutionTrace) -> Result<(), AppError> {
    timed_query!("execution_traces", "execution_traces::save", {
        let id = uuid::Uuid::new_v4().to_string();
        let spans_json =
            serde_json::to_string(&trace.spans).map_err(|e| AppError::Internal(e.to_string()))?;

        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO execution_traces (id, execution_id, trace_id, persona_id, chain_trace_id, spans, total_duration_ms, evicted_span_count, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                id,
                trace.execution_id,
                trace.trace_id,
                trace.persona_id,
                trace.chain_trace_id,
                spans_json,
                trace.total_duration_ms.map(|d| d as i64),
                trace.evicted_span_count as i64,
                trace.created_at,
            ],
        )?;

        Ok(())
    })
}

/// Get the trace for a specific execution.
pub fn get_by_execution_id(
    pool: &DbPool,
    execution_id: &str,
) -> Result<Option<ExecutionTrace>, AppError> {
    timed_query!(
        "execution_traces",
        "execution_traces::get_by_execution_id",
        {
            let conn = pool.get()?;
            let result = conn.query_row(
        "SELECT trace_id, execution_id, persona_id, chain_trace_id, spans, total_duration_ms, evicted_span_count, created_at
         FROM execution_traces WHERE execution_id = ?1 ORDER BY created_at DESC LIMIT 1",
        params![execution_id],
        |row| {
            let spans_json: String = row.get("spans")?;
            let total_duration_ms: Option<i64> = row.get("total_duration_ms")?;
            let evicted: i64 = row.get::<_, Option<i64>>("evicted_span_count")?.unwrap_or(0);
            Ok(ExecutionTrace {
                trace_id: row.get("trace_id")?,
                execution_id: row.get("execution_id")?,
                persona_id: row.get("persona_id")?,
                chain_trace_id: row.get("chain_trace_id")?,
                spans: serde_json::from_str(&spans_json).unwrap_or_default(),
                total_duration_ms: total_duration_ms.map(|d| d as u64),
                evicted_span_count: evicted as u64,
                created_at: row.get("created_at")?,
            })
        },
    );

            match result {
                Ok(trace) => Ok(Some(trace)),
                Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
                Err(e) => Err(AppError::Database(e)),
            }
        }
    )
}

/// Back-fill the `chain_trace_id` on an execution's already-saved trace row(s).
///
/// The ROOT of a fresh chain saves its trace with `chain_trace_id = NULL` (it
/// has no upstream id to inherit at spawn time); the chosen id is only known at
/// completion, after the cascade decides `chain_trace_id = own trace_id`. Without
/// this back-fill the root is absent from [`get_by_chain_trace_id`] and the Chain
/// tab reads 'partial' for real chains. Idempotent: re-writing the same id is a
/// no-op. Updates every trace row for the execution (there is normally one).
pub fn set_chain_trace_id(
    pool: &DbPool,
    execution_id: &str,
    chain_trace_id: &str,
) -> Result<(), AppError> {
    timed_query!("execution_traces", "execution_traces::set_chain_trace_id", {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE execution_traces SET chain_trace_id = ?1 WHERE execution_id = ?2",
            params![chain_trace_id, execution_id],
        )?;
        Ok(())
    })
}

/// Get all traces sharing a chain_trace_id (distributed trace across chain executions).
pub fn get_by_chain_trace_id(
    pool: &DbPool,
    chain_trace_id: &str,
) -> Result<Vec<ExecutionTrace>, AppError> {
    timed_query!(
        "execution_traces",
        "execution_traces::get_by_chain_trace_id",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
        "SELECT trace_id, execution_id, persona_id, chain_trace_id, spans, total_duration_ms, evicted_span_count, created_at
         FROM execution_traces WHERE chain_trace_id = ?1 ORDER BY created_at ASC",
    )?;
            let rows = stmt.query_map(params![chain_trace_id], |row| {
                let spans_json: String = row.get("spans")?;
                let total_duration_ms: Option<i64> = row.get("total_duration_ms")?;
                let evicted: i64 = row
                    .get::<_, Option<i64>>("evicted_span_count")?
                    .unwrap_or(0);
                Ok(ExecutionTrace {
                    trace_id: row.get("trace_id")?,
                    execution_id: row.get("execution_id")?,
                    persona_id: row.get("persona_id")?,
                    chain_trace_id: row.get("chain_trace_id")?,
                    spans: serde_json::from_str(&spans_json).unwrap_or_default(),
                    total_duration_ms: total_duration_ms.map(|d| d as u64),
                    evicted_span_count: evicted as u64,
                    created_at: row.get("created_at")?,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

/// Count the traces already saved under a `chain_trace_id` — i.e. how many
/// executions (links) this chain has spawned so far. Cheap: `chain_trace_id` is
/// indexed (`idx_et_chain`), so this is an index-only `COUNT(*)`. Used by the
/// cascade evaluator's fan-out BREADTH guard (the depth ceiling bounds path
/// length; this bounds total width). Counting traces is preferred over counting
/// the chain EVENTS because events store their trace id only inside the payload
/// JSON (unindexed — a full scan), whereas the trace column is indexed; the only
/// cost is that a link queued-but-not-yet-started has no trace row yet, so this
/// slightly UNDER-counts, which makes the guard trip conservatively-late, never
/// falsely.
pub fn count_by_chain_trace_id(pool: &DbPool, chain_trace_id: &str) -> Result<u32, AppError> {
    timed_query!(
        "execution_traces",
        "execution_traces::count_by_chain_trace_id",
        {
            let conn = pool.get()?;
            let count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM execution_traces WHERE chain_trace_id = ?1",
                params![chain_trace_id],
                |row| row.get(0),
            )?;
            Ok(count.max(0) as u32)
        }
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;

    fn make_trace(
        execution_id: &str,
        persona_id: &str,
        chain_trace_id: Option<&str>,
        created_at: &str,
    ) -> ExecutionTrace {
        ExecutionTrace {
            trace_id: format!("trace-{execution_id}"),
            execution_id: execution_id.to_string(),
            persona_id: persona_id.to_string(),
            chain_trace_id: chain_trace_id.map(String::from),
            spans: Vec::new(),
            total_duration_ms: Some(10),
            evicted_span_count: 0,
            created_at: created_at.to_string(),
        }
    }

    #[test]
    fn get_by_chain_trace_id_groups_shared_id_in_created_order() {
        let pool = init_test_db().unwrap();
        // Two hops share chain-A; an unrelated run is on chain-B.
        save(
            &pool,
            &make_trace("exec-2", "p-b", Some("chain-A"), "2026-07-10T00:00:02Z"),
        )
        .unwrap();
        save(
            &pool,
            &make_trace("exec-1", "p-a", Some("chain-A"), "2026-07-10T00:00:01Z"),
        )
        .unwrap();
        save(
            &pool,
            &make_trace("exec-9", "p-c", Some("chain-B"), "2026-07-10T00:00:03Z"),
        )
        .unwrap();

        let group = get_by_chain_trace_id(&pool, "chain-A").unwrap();
        assert_eq!(group.len(), 2, "only chain-A hops group together");
        // Ordered by created_at ASC.
        assert_eq!(group[0].execution_id, "exec-1");
        assert_eq!(group[1].execution_id, "exec-2");
        assert!(group.iter().all(|t| t.chain_trace_id.as_deref() == Some("chain-A")));
    }

    #[test]
    fn get_by_chain_trace_id_empty_when_none_match() {
        let pool = init_test_db().unwrap();
        assert!(get_by_chain_trace_id(&pool, "nonexistent")
            .unwrap()
            .is_empty());
    }

    #[test]
    fn count_by_chain_trace_id_counts_only_the_matching_chain() {
        let pool = init_test_db().unwrap();
        assert_eq!(count_by_chain_trace_id(&pool, "chain-A").unwrap(), 0);
        save(&pool, &make_trace("e1", "p", Some("chain-A"), "2026-07-10T00:00:01Z")).unwrap();
        save(&pool, &make_trace("e2", "p", Some("chain-A"), "2026-07-10T00:00:02Z")).unwrap();
        save(&pool, &make_trace("e3", "p", Some("chain-B"), "2026-07-10T00:00:03Z")).unwrap();
        // A run with no chain id must not be counted against any chain.
        save(&pool, &make_trace("e4", "p", None, "2026-07-10T00:00:04Z")).unwrap();
        assert_eq!(count_by_chain_trace_id(&pool, "chain-A").unwrap(), 2);
        assert_eq!(count_by_chain_trace_id(&pool, "chain-B").unwrap(), 1);
        assert_eq!(count_by_chain_trace_id(&pool, "chain-Z").unwrap(), 0);
    }

    #[test]
    fn set_chain_trace_id_backfills_root_row() {
        let pool = init_test_db().unwrap();
        // Root run saved with NULL chain_trace_id (the pre-fix reality).
        save(
            &pool,
            &make_trace("root-exec", "p-a", None, "2026-07-10T00:00:01Z"),
        )
        .unwrap();
        // Before back-fill: the root is invisible to the chain query.
        assert!(get_by_chain_trace_id(&pool, "trace-root-exec")
            .unwrap()
            .is_empty());

        // Back-fill with the chosen chain id (= its own trace id, root-of-chain).
        set_chain_trace_id(&pool, "root-exec", "trace-root-exec").unwrap();

        let group = get_by_chain_trace_id(&pool, "trace-root-exec").unwrap();
        assert_eq!(group.len(), 1);
        assert_eq!(group[0].execution_id, "root-exec");
        assert_eq!(group[0].chain_trace_id.as_deref(), Some("trace-root-exec"));
        // Idempotent re-write.
        set_chain_trace_id(&pool, "root-exec", "trace-root-exec").unwrap();
        assert_eq!(get_by_chain_trace_id(&pool, "trace-root-exec").unwrap().len(), 1);
    }

    /// End-to-end lineage of the event-bus dispatch shape: the ROOT run saves
    /// its trace with a NULL chain id; the wrapped `{_event, payload}` input a
    /// downstream hop receives still yields the chain id via
    /// `chain_trace_id_from_input`, so the hop's trace is saved WITH the id.
    /// After the completion back-fill of the root, `get_by_chain_trace_id`
    /// returns BOTH — the whole chain groups (no more 'partial').
    #[test]
    fn event_bus_shape_all_hops_share_one_chain_trace_id() {
        use crate::engine::chain::chain_trace_id_from_input;
        let pool = init_test_db().unwrap();

        // Root completes → chooses chain id = its own trace id.
        let root_trace_id = "trace-root";
        save(&pool, &make_trace("root", "p-root", None, "2026-07-10T00:00:01Z")).unwrap();
        // Completion back-fill (Direction 1b).
        set_chain_trace_id(&pool, "root", root_trace_id).unwrap();

        // The event bus wraps the raw chain payload the root emitted.
        let wrapped_input = serde_json::json!({
            "_event": { "event_type": "chain_triggered", "source_type": "chain" },
            "payload": {
                "source_persona_id": "p-root",
                "_chain_depth": 1,
                "_chain_trace_id": root_trace_id,
            }
        });
        // The stamper reads the wrapped input and MUST recover the chain id.
        let recovered = chain_trace_id_from_input(&wrapped_input);
        assert_eq!(recovered.as_deref(), Some(root_trace_id));

        // The hop's trace is therefore saved with the shared chain id at spawn.
        save(
            &pool,
            &make_trace("hop", "p-hop", recovered.as_deref(), "2026-07-10T00:00:02Z"),
        )
        .unwrap();

        let chain = get_by_chain_trace_id(&pool, root_trace_id).unwrap();
        assert_eq!(chain.len(), 2, "root + hop share one chain_trace_id");
        assert_eq!(chain[0].execution_id, "root");
        assert_eq!(chain[1].execution_id, "hop");
    }
}
