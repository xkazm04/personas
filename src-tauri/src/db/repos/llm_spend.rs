//! Repository for the headless LLM spend ledger (`dev_llm_spend`).
//!
//! `record` is best-effort: an insert failure logs and is swallowed so the
//! ledger can never break a real background call (mirrors
//! `companion::turn_ledger::record_turn`). `observe_line` is the convenience
//! for streaming loops that hold each stdout line as `&str` — it parses the
//! `result` event itself, so callers blindly feed every line.

use rusqlite::params;
use serde_json::Value;

use crate::db::models::{
    LlmSpendDashboard, LlmSpendDay, LlmSpendGroup, LlmSpendInsert, LlmSpendTotals,
};
use crate::db::DbPool;
use crate::error::AppError;

/// Call-time context for a spawn: the tier + specific site + optional refs.
#[derive(Debug, Clone, Default)]
pub struct SpendCtx<'a> {
    pub source: &'a str,
    pub trigger_kind: &'a str,
    pub model: Option<&'a str>,
    pub persona_id: Option<&'a str>,
    pub project_id: Option<&'a str>,
}

/// Best-effort insert. Logs + swallows on failure — never propagates to the
/// caller, so spend recording can't break a real LLM call.
pub fn record(pool: &DbPool, e: &LlmSpendInsert) {
    if let Err(err) = try_record(pool, e) {
        tracing::warn!(
            error = %err,
            source = %e.source,
            trigger_kind = %e.trigger_kind,
            "llm_spend: ledger insert failed",
        );
    }
}

fn try_record(pool: &DbPool, e: &LlmSpendInsert) -> Result<(), AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO dev_llm_spend
           (id, source, trigger_kind, model, input_tokens, output_tokens,
            cache_read_tokens, cache_creation_tokens, cost_usd, duration_ms,
            num_turns, is_error, persona_id, project_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            id,
            e.source,
            e.trigger_kind,
            e.model,
            e.input_tokens,
            e.output_tokens,
            e.cache_read_tokens,
            e.cache_creation_tokens,
            e.cost_usd,
            e.duration_ms,
            e.num_turns,
            e.is_error as i64,
            e.persona_id,
            e.project_id,
        ],
    )?;
    Ok(())
}

/// Parse a single stdout line as a stream-json `result` event and, if it is
/// one, record a spend row from `ctx` + the parsed usage. Returns `true` when a
/// row was written. Safe to call on every line (no-op for non-`result` lines).
/// Mirrors the field extraction in `companion::turn_ledger::CliUsage`.
pub fn observe_line(pool: &DbPool, ctx: &SpendCtx, line: &str) -> bool {
    let Some(entry) = parse_result_line(ctx, line) else {
        return false;
    };
    record(pool, &entry);
    true
}

/// Build an `LlmSpendInsert` from a stdout line if it's a `result` event.
pub fn parse_result_line(ctx: &SpendCtx, line: &str) -> Option<LlmSpendInsert> {
    let v: Value = serde_json::from_str(line).ok()?;
    if v.get("type").and_then(Value::as_str) != Some("result") {
        return None;
    }
    let usage = v.get("usage");
    let tok = |key: &str| -> Option<i64> { usage.and_then(|u| u.get(key)).and_then(Value::as_i64) };
    // Prefer the model the CLI actually reported; fall back to the ctx pin.
    let model = v
        .get("model")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| ctx.model.map(str::to_string));
    Some(LlmSpendInsert {
        source: ctx.source.to_string(),
        trigger_kind: ctx.trigger_kind.to_string(),
        model,
        input_tokens: tok("input_tokens"),
        output_tokens: tok("output_tokens"),
        cache_read_tokens: tok("cache_read_input_tokens"),
        cache_creation_tokens: tok("cache_creation_input_tokens"),
        cost_usd: v.get("total_cost_usd").and_then(Value::as_f64),
        duration_ms: v.get("duration_ms").and_then(Value::as_i64),
        num_turns: v.get("num_turns").and_then(Value::as_i64),
        is_error: v.get("is_error").and_then(Value::as_bool).unwrap_or(false),
        persona_id: ctx.persona_id.map(str::to_string),
        project_id: ctx.project_id.map(str::to_string),
    })
}

// ---------------------------------------------------------------------------
// Dashboard aggregation
// ---------------------------------------------------------------------------

/// Roll up spend over the last `window_days` (clamped 1..=365).
pub fn dashboard(pool: &DbPool, window_days: i64) -> Result<LlmSpendDashboard, AppError> {
    let days = window_days.clamp(1, 365);
    let since = format!("-{days} days");
    let conn = pool.get()?;

    let totals = conn.query_row(
        "SELECT COUNT(*),
                COALESCE(SUM(cost_usd), 0.0),
                COALESCE(SUM(input_tokens), 0),
                COALESCE(SUM(output_tokens), 0),
                COALESCE(SUM(cache_read_tokens), 0),
                COALESCE(SUM(CASE WHEN is_error = 1 THEN 1 ELSE 0 END), 0)
         FROM dev_llm_spend
         WHERE created_at >= datetime('now', ?1)",
        params![since],
        |r| {
            Ok(LlmSpendTotals {
                calls: r.get(0)?,
                cost_usd: r.get(1)?,
                input_tokens: r.get(2)?,
                output_tokens: r.get(3)?,
                cache_read_tokens: r.get(4)?,
                error_calls: r.get(5)?,
            })
        },
    )?;

    let mut daily_stmt = conn.prepare(
        "SELECT date(created_at) AS day, COUNT(*), COALESCE(SUM(cost_usd), 0.0)
         FROM dev_llm_spend
         WHERE created_at >= datetime('now', ?1)
         GROUP BY day
         ORDER BY day DESC",
    )?;
    let daily = daily_stmt
        .query_map(params![since], |r| {
            Ok(LlmSpendDay {
                day: r.get(0)?,
                calls: r.get(1)?,
                cost_usd: r.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let by_source = group_by(&conn, "source", &since)?;
    let by_trigger = group_by(&conn, "trigger_kind", &since)?;
    let by_model = group_by(&conn, "model", &since)?;

    Ok(LlmSpendDashboard {
        window_days: days,
        totals,
        daily,
        by_source,
        by_trigger,
        by_model,
    })
}

/// Group spend by a column (`source` | `trigger_kind` | `model`), cost-desc.
/// `col` is a fixed internal identifier, never user input.
fn group_by(
    conn: &rusqlite::Connection,
    col: &str,
    since: &str,
) -> Result<Vec<LlmSpendGroup>, AppError> {
    let sql = format!(
        "SELECT COALESCE({col}, '(unknown)') AS k, COUNT(*),
                COALESCE(SUM(cost_usd), 0.0),
                COALESCE(SUM(input_tokens), 0),
                COALESCE(SUM(output_tokens), 0)
         FROM dev_llm_spend
         WHERE created_at >= datetime('now', ?1)
         GROUP BY k
         ORDER BY 3 DESC, 2 DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params![since], |r| {
            Ok(LlmSpendGroup {
                key: r.get(0)?,
                calls: r.get(1)?,
                cost_usd: r.get(2)?,
                input_tokens: r.get(3)?,
                output_tokens: r.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}
