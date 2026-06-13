//! Adaptive per-persona triage baselines (direction 3 / Phase D1 of
//! `docs/plans/athena-value-expansion.md`).
//!
//! Execution triage's "expensive" / "slow" flags were global constants
//! (`EXPENSIVE_USD = 0.50`, `SLOW_MS = 120_000`). A $1.50 run is an anomaly for
//! a triage persona and routine for a research team, so global thresholds
//! over-flag heavy personas and under-flag light ones. This module learns each
//! persona's own cost/duration distribution (p95 over a trailing window) so a
//! run is flagged when it deviates from *its persona's* norm — the global
//! constants stay as a fallback (and an absolute floor) for personas without
//! enough history.
//!
//! Baselines are cached in `companion_persona_baseline` (companion user DB) and
//! refreshed lazily: at the start of a triage pass, only personas present in
//! the current scan batch whose cache is older than 24h are recomputed.
//! Bounded work, no cron. `persona_executions` lives in the operational DB
//! (`sys_db`); the cache lives in the user DB — both handles are threaded in.

use std::collections::HashMap;

use rusqlite::params;

use crate::db::{DbPool, UserDbPool};
use crate::error::AppError;

/// Minimum runs before a persona earns a learned baseline. Below this it keeps
/// the global constants — too few samples make a noisy p95.
const MIN_SAMPLES: i64 = 8;
/// Trailing window for the distribution.
const WINDOW_DAYS: i64 = 30;
/// Cap on rows pulled per persona (newest-first) — bounds the per-pass work.
const SAMPLE_CAP: i64 = 500;
/// A cached baseline older than this is recomputed on next use.
const REFRESH_HOURS: i64 = 24;
/// Absolute floors so a near-zero-cost / near-instant persona can't make the
/// learned threshold flag routine runs. Mirror the intent of the global
/// constants at the low end.
const EXPENSIVE_FLOOR_USD: f64 = 0.10;
const SLOW_FLOOR_MS: f64 = 30_000.0;
/// How far above p95 a run must land to flag.
const DEVIATION_FACTOR: f64 = 1.5;

/// The fields the triage flagger needs. p50s are persisted for future
/// surfacing (UI / digest) but aren't part of the flag decision.
#[derive(Debug, Clone, Default)]
pub struct PersonaBaseline {
    pub sample_n: i64,
    pub p95_cost: Option<f64>,
    pub p95_duration_ms: Option<i64>,
    /// User-declared expected bands — override the learned p95 when set.
    pub declared_cost_usd: Option<f64>,
    pub declared_duration_ms: Option<i64>,
}

impl PersonaBaseline {
    pub fn has_history(&self) -> bool {
        self.sample_n >= MIN_SAMPLES
    }

    /// The expected cost band (declared wins over learned p95) when the persona
    /// has enough history — used to annotate digest exemplar lines
    /// ("3.2× this persona's p95"). `None` when on the global fallback.
    pub fn cost_band(&self) -> Option<f64> {
        self.has_history().then(|| self.declared_cost_usd.or(self.p95_cost)).flatten()
    }

    /// Expected duration band, same shape as [`cost_band`].
    pub fn duration_band(&self) -> Option<i64> {
        self.has_history().then(|| self.declared_duration_ms.or(self.p95_duration_ms)).flatten()
    }

    /// USD cost above which a run flags `expensive`. Uses `1.5 × p95` (declared
    /// band wins over the learned p95) with an absolute floor; falls back to
    /// `global` when the persona lacks history.
    pub fn expensive_threshold(b: Option<&PersonaBaseline>, global: f64) -> f64 {
        match b {
            Some(b) if b.has_history() => {
                let band = b.declared_cost_usd.or(b.p95_cost).unwrap_or(global);
                (DEVIATION_FACTOR * band).max(EXPENSIVE_FLOOR_USD)
            }
            _ => global,
        }
    }

    /// Wall-clock ms above which a run flags `slow`. Same shape as
    /// [`expensive_threshold`].
    pub fn slow_threshold(b: Option<&PersonaBaseline>, global: i64) -> i64 {
        match b {
            Some(b) if b.has_history() => {
                let band = b
                    .declared_duration_ms
                    .or(b.p95_duration_ms)
                    .map(|v| v as f64)
                    .unwrap_or(global as f64);
                (DEVIATION_FACTOR * band).max(SLOW_FLOOR_MS) as i64
            }
            _ => global,
        }
    }
}

/// Linear-interpolated percentile over a pre-sorted ascending slice.
fn percentile(sorted: &[f64], q: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    if sorted.len() == 1 {
        return sorted[0];
    }
    let rank = (q / 100.0) * (sorted.len() as f64 - 1.0);
    let lo = rank.floor() as usize;
    let hi = rank.ceil() as usize;
    if lo == hi {
        sorted[lo]
    } else {
        let frac = rank - lo as f64;
        sorted[lo] * (1.0 - frac) + sorted[hi] * frac
    }
}

/// Recompute baselines for any of `persona_ids` whose cache is missing or older
/// than [`REFRESH_HOURS`]. Best-effort per persona — a failure logs and skips,
/// leaving the persona on the global fallback. `persona_executions` is read
/// from `sys_db`; the cache is upserted into `user_db`.
pub fn refresh_stale(user_db: &UserDbPool, sys_db: &DbPool, persona_ids: &[String]) {
    let stale: Vec<&String> = persona_ids
        .iter()
        .filter(|id| is_stale(user_db, id))
        .collect();
    for id in stale {
        if let Err(e) = recompute_one(user_db, sys_db, id) {
            tracing::warn!(persona_id = %id, error = %e, "baselines: recompute failed (using global fallback)");
        }
    }
}

fn is_stale(user_db: &UserDbPool, persona_id: &str) -> bool {
    let Ok(conn) = user_db.get() else {
        return false; // can't check → don't thrash; treat as fresh
    };
    let fresh: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM companion_persona_baseline
             WHERE persona_id = ?1
               AND computed_at > datetime('now', ?2)",
            params![persona_id, format!("-{REFRESH_HOURS} hours")],
            |r| r.get(0),
        )
        .ok();
    fresh.is_none()
}

fn recompute_one(user_db: &UserDbPool, sys_db: &DbPool, persona_id: &str) -> Result<(), AppError> {
    let (mut costs, mut durations) = {
        let conn = sys_db.get()?;
        let mut stmt = conn.prepare(
            "SELECT COALESCE(cost_usd, 0.0), duration_ms
             FROM persona_executions
             WHERE persona_id = ?1
               AND status IN ('completed', 'failed', 'incomplete', 'cancelled')
               AND created_at > datetime('now', ?2)
             ORDER BY created_at DESC
             LIMIT ?3",
        )?;
        let rows = stmt
            .query_map(
                params![persona_id, format!("-{WINDOW_DAYS} days"), SAMPLE_CAP],
                |r| Ok((r.get::<_, f64>(0)?, r.get::<_, Option<i64>>(1)?)),
            )?
            .collect::<Result<Vec<_>, _>>()?;
        let costs: Vec<f64> = rows.iter().map(|(c, _)| *c).collect();
        let durations: Vec<f64> = rows.iter().filter_map(|(_, d)| d.map(|v| v as f64)).collect();
        (costs, durations)
    };
    let sample_n = costs.len() as i64;
    costs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    durations.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    let p50_cost = percentile(&costs, 50.0);
    let p95_cost = percentile(&costs, 95.0);
    let p50_dur = percentile(&durations, 50.0) as i64;
    let p95_dur = percentile(&durations, 95.0) as i64;

    let conn = user_db.get()?;
    // Preserve any user-declared overrides across recompute (they live in the
    // same row but are never derived here).
    conn.execute(
        "INSERT INTO companion_persona_baseline
            (persona_id, p50_cost, p95_cost, p50_duration_ms, p95_duration_ms,
             sample_n, computed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))
         ON CONFLICT(persona_id) DO UPDATE SET
            p50_cost = excluded.p50_cost,
            p95_cost = excluded.p95_cost,
            p50_duration_ms = excluded.p50_duration_ms,
            p95_duration_ms = excluded.p95_duration_ms,
            sample_n = excluded.sample_n,
            computed_at = excluded.computed_at",
        params![
            persona_id,
            p50_cost,
            p95_cost,
            p50_dur,
            p95_dur,
            sample_n
        ],
    )?;
    Ok(())
}

/// Load cached baselines for `persona_ids`. Personas without a cached row are
/// simply absent from the map (the caller falls back to the global constants).
pub fn load(user_db: &UserDbPool, persona_ids: &[String]) -> HashMap<String, PersonaBaseline> {
    let mut out = HashMap::new();
    let Ok(conn) = user_db.get() else {
        return out;
    };
    let Ok(mut stmt) = conn.prepare(
        "SELECT p95_cost, p95_duration_ms, sample_n, declared_cost_usd, declared_duration_ms
         FROM companion_persona_baseline WHERE persona_id = ?1",
    ) else {
        return out;
    };
    for id in persona_ids {
        let b = stmt.query_row(params![id], |r| {
            Ok(PersonaBaseline {
                p95_cost: r.get(0)?,
                p95_duration_ms: r.get(1)?,
                sample_n: r.get(2)?,
                declared_cost_usd: r.get(3)?,
                declared_duration_ms: r.get(4)?,
            })
        });
        if let Ok(b) = b {
            out.insert(id.clone(), b);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percentile_basics() {
        let v: Vec<f64> = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        assert!((percentile(&v, 50.0) - 3.0).abs() < 1e-9);
        assert!((percentile(&v, 0.0) - 1.0).abs() < 1e-9);
        assert!((percentile(&v, 100.0) - 5.0).abs() < 1e-9);
        assert_eq!(percentile(&[], 95.0), 0.0);
        assert_eq!(percentile(&[7.0], 95.0), 7.0);
    }

    #[test]
    fn threshold_falls_back_without_history() {
        // No baseline → global.
        assert_eq!(PersonaBaseline::expensive_threshold(None, 0.50), 0.50);
        assert_eq!(PersonaBaseline::slow_threshold(None, 120_000), 120_000);
        // Too few samples → still global.
        let thin = PersonaBaseline { sample_n: 3, p95_cost: Some(0.02), ..Default::default() };
        assert_eq!(PersonaBaseline::expensive_threshold(Some(&thin), 0.50), 0.50);
    }

    #[test]
    fn learned_threshold_uses_p95_with_floor() {
        // Cheap persona: p95 = $0.02 → 1.5× = $0.03, floored to $0.10. A $0.12
        // run now flags where the $0.50 global never would.
        let cheap = PersonaBaseline { sample_n: 40, p95_cost: Some(0.02), ..Default::default() };
        assert!((PersonaBaseline::expensive_threshold(Some(&cheap), 0.50) - 0.10).abs() < 1e-9);
        // Expensive-by-design persona: p95 = $1.00 → 1.5× = $1.50. A routine
        // $0.60 run no longer flags (the $0.50 global would have).
        let heavy = PersonaBaseline { sample_n: 40, p95_cost: Some(1.0), ..Default::default() };
        assert!((PersonaBaseline::expensive_threshold(Some(&heavy), 0.50) - 1.50).abs() < 1e-9);
        assert!(0.60 < PersonaBaseline::expensive_threshold(Some(&heavy), 0.50));
    }

    #[test]
    fn declared_overrides_learned() {
        let b = PersonaBaseline {
            sample_n: 40,
            p95_cost: Some(0.02),
            declared_cost_usd: Some(2.0),
            ..Default::default()
        };
        // declared band $2.00 → 1.5× = $3.00, beats the learned p95.
        assert!((PersonaBaseline::expensive_threshold(Some(&b), 0.50) - 3.0).abs() < 1e-9);
    }

    #[test]
    fn slow_threshold_floor() {
        // p95 = 5s → 1.5× = 7.5s, floored to 30s.
        let fast = PersonaBaseline { sample_n: 40, p95_duration_ms: Some(5_000), ..Default::default() };
        assert_eq!(PersonaBaseline::slow_threshold(Some(&fast), 120_000), 30_000);
    }
}
