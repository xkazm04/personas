//! The one door every twin LLM call goes through.
//!
//! Before this, the twin's call sites shared `spawn_claude_with_prompt`: one
//! hard-coded model, the default effort, no timeout, and nothing written to
//! the spend ledger. [`spawn_claude_logged`] takes the tier per call
//! ([`TwinCall`]: model + effort + timeout + a site name), kills the CLI when
//! the timeout elapses, and records a `dev_llm_spend` row (`source = "twin"`,
//! `trigger_kind = site`) from the stream's `result` event.
//!
//! The setup engine reaches the LLM through an [`LlmFn`] rather than calling
//! this directly, so its tests substitute a scripted reply and never spawn.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use personas_core::model_ids::{OPUS_5_5, SONNET_CURRENT};

use crate::db::repos::llm_spend::{self, SpendCtx};
use crate::db::DbPool;
use crate::engine::cli_process::{collect_within, CollectError};
use crate::error::AppError;

/// The spend-ledger `source` for every twin call.
pub(crate) const SPEND_SOURCE: &str = "twin";

/// One LLM call's tier: which model, how hard it thinks, how long it may run,
/// and the site name the ledger files it under.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct TwinCall {
    /// The ledger's `trigger_kind`, distinct per call site.
    pub site: &'static str,
    pub model: &'static str,
    /// `low` | `medium` | `high` — passed as the one `--effort` flag.
    pub effort: &'static str,
    pub timeout: Duration,
}

/// Legacy sites had no backend timeout at all; this one is generous so none of
/// them fails sooner than its frontend already gives up.
const LEGACY_TIMEOUT: Duration = Duration::from_secs(300);
/// The setup engine's per-answer calls (assess, refill).
const RECONCILE_TIMEOUT: Duration = Duration::from_secs(120);
/// The setup engine's deep pass.
const PLAN_TIMEOUT: Duration = Duration::from_secs(240);

impl TwinCall {
    /// A pre-existing twin call site: `SONNET_CURRENT` at `medium`, as before
    /// the ledger existed — only the logging and the timeout are new.
    pub(crate) const fn legacy(site: &'static str) -> Self {
        Self {
            site,
            model: SONNET_CURRENT,
            effort: "medium",
            timeout: LEGACY_TIMEOUT,
        }
    }

    pub(crate) const SETUP_ASSESS: Self = Self {
        site: "setup_assess",
        model: OPUS_5_5,
        effort: "low",
        timeout: RECONCILE_TIMEOUT,
    };

    pub(crate) const SETUP_REFILL: Self = Self {
        site: "setup_refill",
        model: OPUS_5_5,
        effort: "low",
        timeout: RECONCILE_TIMEOUT,
    };

    pub(crate) const SETUP_PLAN: Self = Self {
        site: "setup_plan",
        model: OPUS_5_5,
        effort: "medium",
        timeout: PLAN_TIMEOUT,
    };
}

/// A boxed LLM reply future.
pub(crate) type LlmFuture = Pin<Box<dyn Future<Output = Result<String, AppError>> + Send>>;

/// How the setup engine reaches the model. Production is [`real_llm`]; tests
/// pass a closure that returns scripted text.
pub(crate) type LlmFn = Arc<dyn Fn(DbPool, TwinCall, String) -> LlmFuture + Send + Sync>;

/// The production [`LlmFn`]: [`spawn_claude_logged`].
pub(crate) fn real_llm() -> LlmFn {
    Arc::new(|pool, call, prompt| {
        Box::pin(async move { spawn_claude_logged(&pool, call, prompt).await })
    })
}

/// Spawn the Claude CLI on `call`'s tier, wait at most `call.timeout`, record
/// the spend row, and return the assistant's text.
///
/// On timeout the child is killed explicitly (`start_kill` + reap) before the
/// error returns — `kill_on_drop` is set on the spawn as a second line, but an
/// explicit kill does not depend on when the handle happens to drop.
pub(crate) async fn spawn_claude_logged(
    pool: &DbPool,
    call: TwinCall,
    prompt: String,
) -> Result<String, AppError> {
    let mut child = crate::engine::cli_process::spawn_headless_claude_tier(
        prompt,
        call.model,
        call.effort,
        &[],
        None,
        false,
    )?;

    let (status, stdout) = collect_within(&mut child, call.timeout)
        .await
        .map_err(|e| match e {
            CollectError::TimedOut => AppError::Internal(format!(
                "twin {}: the model did not answer within {} s",
                call.site,
                call.timeout.as_secs()
            )),
            CollectError::Io(e) => {
                AppError::Internal(format!("twin {}: CLI execution failed: {e}", call.site))
            }
        })?;

    let stdout = String::from_utf8_lossy(&stdout);
    record_spend(pool, call, &stdout);

    if !status.success() {
        return Err(AppError::Internal(format!(
            "twin {}: Claude CLI returned non-zero exit code",
            call.site
        )));
    }
    Ok(crate::commands::infrastructure::twin::claude_text_from_stream(&stdout))
}

/// Write one spend row per stream-json `result` event in `stdout`. Best
/// effort by construction (`llm_spend::record` logs and swallows), so the
/// ledger can never fail the call it measures.
pub(crate) fn record_spend(pool: &DbPool, call: TwinCall, stdout: &str) -> usize {
    let ctx = SpendCtx {
        source: SPEND_SOURCE,
        trigger_kind: call.site,
        model: Some(call.model),
        ..Default::default()
    };
    let mut written = 0;
    for line in stdout.lines() {
        let line = line.trim();
        if !line.starts_with('{') {
            continue;
        }
        if let Some(entry) = llm_spend::parse_result_line(&ctx, line) {
            llm_spend::record(pool, &entry);
            written += 1;
        }
    }
    written
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A real captured CLI stream (see the fixture's header), not an invented
    /// envelope.
    const JSON_ANSWER_STREAM: &str =
        include_str!("../../../tests/fixtures/twin_stream_json_answer.jsonl");

    #[test]
    fn twin_setup_spend_row_is_filed_under_twin_and_the_site() -> Result<(), AppError> {
        let pool = crate::db::init_test_db()?;
        let stream: String = JSON_ANSWER_STREAM
            .lines()
            .filter(|l| !l.trim_start().starts_with('#'))
            .collect::<Vec<_>>()
            .join("\n");
        assert_eq!(record_spend(&pool, TwinCall::SETUP_ASSESS, &stream), 1);
        assert_eq!(
            record_spend(&pool, TwinCall::legacy("generate_bio"), &stream),
            1
        );

        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT source, trigger_kind, cost_usd FROM dev_llm_spend ORDER BY trigger_kind",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>("source")?,
                    r.get::<_, String>("trigger_kind")?,
                    r.get::<_, Option<f64>>("cost_usd")?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].0, "twin");
        assert_eq!(rows[0].1, "generate_bio");
        assert_eq!(rows[1].1, "setup_assess");
        assert!(rows.iter().all(|r| r.2.is_some_and(|c| c > 0.0)));
        Ok(())
    }

    #[test]
    fn twin_setup_tiers_are_the_designed_ones() {
        assert_eq!(TwinCall::SETUP_PLAN.model, OPUS_5_5);
        assert_eq!(TwinCall::SETUP_PLAN.effort, "medium");
        assert_eq!(TwinCall::SETUP_PLAN.timeout, Duration::from_secs(240));
        for low in [TwinCall::SETUP_ASSESS, TwinCall::SETUP_REFILL] {
            assert_eq!((low.model, low.effort), (OPUS_5_5, "low"));
            assert_eq!(low.timeout, Duration::from_secs(120));
        }
        let legacy = TwinCall::legacy("reflect");
        assert_eq!((legacy.model, legacy.effort), (SONNET_CURRENT, "medium"));
    }
}
