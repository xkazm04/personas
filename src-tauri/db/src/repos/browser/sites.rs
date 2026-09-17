//! `browser_sites` — the Whitelist repo.
//!
//! Small table, opinionated door. Four rules live HERE rather than in a
//! command, because the repo is the one place every writer (the Whitelist
//! page, `browser_request_site`, the scan, a future importer) goes through:
//!
//! - **An override may only TIGHTEN.** [`set_override`] accepts
//!   [`BrowserToolClass::Gated`] and nothing else; `read`/`auto` come back as
//!   an `AppError::Forbidden` the command surfaces as the `refused_loosening`
//!   refusal. The class a page tool's manifest declares is a ceiling the
//!   operator may lower, never a floor they may raise.
//! - **Upsert never re-enables.** Creating a row that already exists updates
//!   its label/budget and touches `last_seen`; it does NOT flip `enabled`
//!   unless the caller asked for that explicitly, so an agent re-requesting
//!   a paused site cannot un-pause it.
//! - **`first_seen` is written once.** `ON CONFLICT` leaves it alone — it is
//!   the audit answer to "when did this origin first show up", and an upsert
//!   that rewrote it would erase exactly that.
//! - **Every origin goes through ONE normalisation door.** [`upsert`] runs
//!   `personas_core::models::normalize_site_origin`, which accepts a concrete
//!   origin (normalised by `url::Url::origin()`, as the gate does at runtime)
//!   or a PATTERN (`https://*.example.com`, `http://localhost:*`) and refuses
//!   every other shape. [`resolve`] is the read that pairs with it: exact row
//!   first, then the most specific matching pattern.
//! - **A malformed `overrides` / `scan_report` blob degrades, it does not
//!   poison the read.** Both columns are parsed in [`row_to_site`] with a
//!   `tracing::warn` and a safe fallback, because one bad blob must not make
//!   the Whitelist page unreadable — and a fallback that silently *loosened*
//!   is impossible here: an unparsable override map falls back to EMPTY,
//!   which is the tightest it can be (no override = the declared class).

use std::collections::BTreeMap;

use personas_core::error::AppError;
use personas_core::models::{
    normalize_site_origin, origin_matches, origin_pattern_specificity, BrowserScanStatus,
    BrowserSite, BrowserSiteScan, BrowserToolClass, Json, UpsertBrowserSiteInput,
};
use personas_core::validation::require_non_empty;
use rusqlite::params;

use crate::DbPool;

/// Every column of `browser_sites`, in the order [`row_to_site_raw`] reads
/// them. Named rather than `*` so a column added later is a deliberate edit
/// here and not a silent widening of every SELECT.
const SITE_COLUMNS: &str = "origin, label, enabled, overrides, budget, credential_id, \
     scan_status, scan_tier, scan_report, scan_at, first_seen, last_seen, created_by";

row_mapper!(row_to_site_raw -> BrowserSiteRow {
    origin, label,
    enabled [bool],
    overrides, budget, credential_id,
    scan_status, scan_tier, scan_report, scan_at, first_seen, last_seen, created_by,
});

/// The row exactly as SQLite hands it over: the two JSON columns and the
/// status still text. [`row_mapper!`] builds a `&Row -> rusqlite::Result<T>`
/// mapper and has no vocabulary for the fallible narrowing these three need,
/// so the macro maps into this shadow struct and [`row_to_site`] does the
/// narrowing — same shape as `repos::dev::notes`.
struct BrowserSiteRow {
    origin: String,
    label: String,
    enabled: bool,
    overrides: String,
    budget: i32,
    credential_id: Option<String>,
    scan_status: String,
    scan_tier: Option<u8>,
    scan_report: Option<String>,
    scan_at: Option<i64>,
    first_seen: i64,
    last_seen: i64,
    created_by: String,
}

fn row_to_site(row: &rusqlite::Row) -> rusqlite::Result<BrowserSite> {
    let raw = row_to_site_raw(row)?;

    // A status outside the vocabulary is only reachable past the column
    // CHECK; surface it as a mapping error rather than a defaulted `none`,
    // which would claim the site was never scanned.
    let scan_status = BrowserScanStatus::parse(&raw.scan_status).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("unknown browser_sites.scan_status `{}`", raw.scan_status),
            )),
        )
    })?;

    let overrides: BTreeMap<String, BrowserToolClass> = serde_json::from_str(&raw.overrides)
        .unwrap_or_else(|e| {
            tracing::warn!(
                origin = %raw.origin,
                error = %e,
                "browser_sites.overrides is not a tool-class map; falling back to no overrides \
                 (the declared class stands, which is the tighter reading)"
            );
            BTreeMap::new()
        });

    let scan_report = raw.scan_report.as_deref().and_then(|s| {
        serde_json::from_str::<BrowserSiteScan>(s)
            .map_err(|e| {
                tracing::warn!(
                    origin = %raw.origin,
                    error = %e,
                    "browser_sites.scan_report is not a scan report; reporting no scan"
                );
            })
            .ok()
            .map(Json)
    });

    Ok(BrowserSite {
        origin: raw.origin,
        label: raw.label,
        enabled: raw.enabled,
        overrides: Json(overrides),
        budget: raw.budget,
        credential_id: raw.credential_id,
        scan_status,
        scan_tier: raw.scan_tier,
        scan_report,
        scan_at: raw.scan_at,
        first_seen: raw.first_seen,
        last_seen: raw.last_seen,
        created_by: raw.created_by,
    })
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// The whole table, enabled rows first then alphabetically — the Whitelist
/// page's only read, and small enough that it is never paginated.
pub fn list(pool: &DbPool) -> Result<Vec<BrowserSite>, AppError> {
    timed_query!("browser_sites", "browser_sites::list", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare_cached(&format!(
            "SELECT {SITE_COLUMNS} FROM browser_sites ORDER BY enabled DESC, origin"
        ))?;
        let rows = stmt.query_map([], row_to_site)?;
        Ok(crate::repos::utils::collect_rows(
            rows,
            "browser_sites::list",
        ))
    })
}

/// One row, or `None` when the origin has never been seen. The gate's hot
/// read — `None` IS the answer `origin_not_allowed` is built from, so it is
/// deliberately not an `AppError::NotFound`.
pub fn get(pool: &DbPool, origin: &str) -> Result<Option<BrowserSite>, AppError> {
    timed_query!("browser_sites", "browser_sites::get", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare_cached(&format!(
            "SELECT {SITE_COLUMNS} FROM browser_sites WHERE origin = ?1"
        ))?;
        let mut rows = stmt.query_map(params![origin], row_to_site)?;
        match rows.next() {
            Some(Ok(site)) => Ok(Some(site)),
            Some(Err(e)) => Err(AppError::Database(e)),
            None => Ok(None),
        }
    })
}

/// The row that GOVERNS `concrete_origin` — the gate's real read.
///
/// An exact row wins outright. Otherwise the most specific matching PATTERN
/// row wins, ordered by [`origin_pattern_specificity`]: longest host suffix
/// first, an exact host over a wildcard label, an explicit port over `:*`.
/// A tie is broken by the origin string so the answer is deterministic
/// rather than dependent on row order.
///
/// The second query runs only on an exact miss, and only over rows whose
/// origin carries a `*` — the whole table is small and the pattern subset is
/// smaller, so the gate pays nothing on the hot path.
///
/// `None` is the answer `origin_not_allowed` is built from, exactly as in
/// [`get`]; the caller keeps naming the CONCRETE origin in its refusal, and
/// only budget / overrides / `enabled` follow the row.
pub fn resolve(pool: &DbPool, concrete_origin: &str) -> Result<Option<BrowserSite>, AppError> {
    if let Some(site) = get(pool, concrete_origin)? {
        return Ok(Some(site));
    }
    let candidates = list_patterns(pool)?;
    Ok(candidates
        .into_iter()
        .filter(|s| origin_matches(&s.origin, concrete_origin))
        .max_by(|a, b| {
            origin_pattern_specificity(&a.origin)
                .cmp(&origin_pattern_specificity(&b.origin))
                .then_with(|| a.origin.cmp(&b.origin))
        }))
}

/// Every row whose origin is a pattern. Private: `resolve` is the contract,
/// and a caller that read this list itself would be re-implementing the
/// precedence rule beside it.
fn list_patterns(pool: &DbPool) -> Result<Vec<BrowserSite>, AppError> {
    timed_query!("browser_sites", "browser_sites::list_patterns", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare_cached(&format!(
            "SELECT {SITE_COLUMNS} FROM browser_sites WHERE origin LIKE '%*%'"
        ))?;
        let rows = stmt.query_map([], row_to_site)?;
        Ok(crate::repos::utils::collect_rows(
            rows,
            "browser_sites::list_patterns",
        ))
    })
}

/// Fetch a row that must exist. Every mutator below goes through it so a
/// write to an unknown origin is `NotFound` rather than a silent no-op.
fn require(pool: &DbPool, origin: &str) -> Result<BrowserSite, AppError> {
    get(pool, origin)?.ok_or_else(|| AppError::NotFound(format!("BrowserSite {origin}")))
}

/// Create the row, or update the fields the caller named.
///
/// `enabled` is only touched when the caller passes it — see the module note.
pub fn upsert(pool: &DbPool, input: UpsertBrowserSiteInput) -> Result<BrowserSite, AppError> {
    require_non_empty("origin", &input.origin)?;
    // The ONE origin door. A concrete origin is normalised by
    // `url::Url::origin()` so a row and the gate's runtime origin are the
    // same string; a pattern (`https://*.example.com`, `http://localhost:*`)
    // is parsed and normalised by the same function, which is also where
    // every refused shape is refused. Validating here rather than in the
    // command means `browser_request_site`, the scan and a future importer
    // all meet the same rule.
    let origin = normalize_site_origin(&input.origin)?;
    let origin = origin.as_str();
    if let Some(budget) = input.budget {
        if budget < 0 {
            return Err(AppError::Validation("budget must not be negative".into()));
        }
    }
    let now = now_ms();
    // The COALESCE arms below carry the ORIGINAL Options, so an absent field
    // keeps what the row already has; the VALUES arms carry the defaulted
    // values, which only a first write ever reaches.
    let label_opt = input.label.clone();
    let enabled_opt = input.enabled.map(|b| b as i32);
    let budget_opt = input.budget;
    let label = input.label.unwrap_or_default();
    let enabled = input.enabled.unwrap_or(false) as i32;
    let budget = input.budget.unwrap_or(DEFAULT_BUDGET);
    let created_by = input.created_by.unwrap_or_else(|| "operator".to_string());

    timed_query!("browser_sites", "browser_sites::upsert", {
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO browser_sites
                 (origin, label, enabled, overrides, budget, credential_id,
                  scan_status, scan_tier, scan_report, scan_at,
                  first_seen, last_seen, created_by)
             VALUES (?1, ?2, ?3, '{}', ?4, NULL, 'none', NULL, NULL, NULL, ?5, ?5, ?6)
             ON CONFLICT(origin) DO UPDATE SET
                 label     = COALESCE(?7, label),
                 enabled   = COALESCE(?8, enabled),
                 budget    = COALESCE(?9, budget),
                 last_seen = ?5",
            params![
                origin,
                label,
                enabled,
                budget,
                now,
                created_by,
                label_opt,
                enabled_opt,
                budget_opt,
            ],
        )?;
        require(pool, origin)
    })
}

/// The default per-origin call budget. Mirrors `browser_bridge::backend::
/// DEFAULT_BUDGET` and the TS `BROWSER_DEFAULT_BUDGET`; the column default
/// says the same thing for writes that never reach this crate.
pub const DEFAULT_BUDGET: i32 = 50;

/// Remove the row entirely. Returns whether one was there.
pub fn delete(pool: &DbPool, origin: &str) -> Result<bool, AppError> {
    timed_query!("browser_sites", "browser_sites::delete", {
        let conn = pool.get()?;
        let rows = conn.execute(
            "DELETE FROM browser_sites WHERE origin = ?1",
            params![origin],
        )?;
        Ok(rows > 0)
    })
}

/// Pause / un-pause an origin. The operator's switch; nothing else calls it.
pub fn set_enabled(pool: &DbPool, origin: &str, enabled: bool) -> Result<BrowserSite, AppError> {
    require(pool, origin)?;
    timed_query!("browser_sites", "browser_sites::set_enabled", {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE browser_sites SET enabled = ?2 WHERE origin = ?1",
            params![origin, enabled as i32],
        )?;
        require(pool, origin)
    })
}

/// Tighten (`Some(Gated)`) or clear (`None`) the class of one tool on one
/// origin.
///
/// Anything other than `Gated` is refused: an override is the operator's
/// brake, and a lane that could also raise a class would let a page's own
/// manifest be overruled upward by whoever can write this table.
pub fn set_override(
    pool: &DbPool,
    origin: &str,
    tool: &str,
    class: Option<BrowserToolClass>,
) -> Result<BrowserSite, AppError> {
    require_non_empty("tool", tool)?;
    let tool = tool.trim();
    if let Some(c) = class {
        if c != BrowserToolClass::Gated {
            return Err(AppError::Forbidden(format!(
                "refused_loosening: an override may only tighten a tool to `gated`, not `{}`",
                c.as_str()
            )));
        }
    }
    let site = require(pool, origin)?;
    let mut overrides = site.overrides.into_inner();
    match class {
        Some(c) => {
            overrides.insert(tool.to_string(), c);
        }
        None => {
            overrides.remove(tool);
        }
    }
    let encoded = serde_json::to_string(&overrides)?;

    timed_query!("browser_sites", "browser_sites::set_override", {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE browser_sites SET overrides = ?2 WHERE origin = ?1",
            params![origin, encoded],
        )?;
        require(pool, origin)
    })
}

/// Bind (or clear) the vault credential `browser_login` draws from. The
/// value never leaves Rust — only the id is stored.
pub fn bind_credential(
    pool: &DbPool,
    origin: &str,
    credential_id: Option<&str>,
) -> Result<BrowserSite, AppError> {
    require(pool, origin)?;
    timed_query!("browser_sites", "browser_sites::bind_credential", {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE browser_sites SET credential_id = ?2 WHERE origin = ?1",
            params![origin, credential_id],
        )?;
        require(pool, origin)
    })
}

/// File the controllability scan's result.
///
/// `report_json` is stored as TEXT verbatim; it is validated by being parsed
/// on the way in, so a report that cannot round-trip is refused here rather
/// than degrading silently on every later read.
pub fn set_scan(
    pool: &DbPool,
    origin: &str,
    status: BrowserScanStatus,
    tier: Option<u8>,
    report_json: Option<&str>,
    at: Option<i64>,
) -> Result<BrowserSite, AppError> {
    require(pool, origin)?;
    if let Some(raw) = report_json {
        serde_json::from_str::<BrowserSiteScan>(raw)?;
    }
    let at = at.unwrap_or_else(now_ms);

    timed_query!("browser_sites", "browser_sites::set_scan", {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE browser_sites
                SET scan_status = ?2, scan_tier = ?3, scan_report = ?4, scan_at = ?5
              WHERE origin = ?1",
            params![origin, status.as_str(), tier, report_json, at],
        )?;
        require(pool, origin)
    })
}

/// Stamp `last_seen`. Called by the gate on every allowed navigation, so it
/// is deliberately the cheapest write in the file: no read-back, no row
/// returned, and a missing origin is not an error (the gate already refused
/// it — this must never become a second failure path).
pub fn touch_last_seen(pool: &DbPool, origin: &str) -> Result<(), AppError> {
    timed_query!("browser_sites", "browser_sites::touch_last_seen", {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE browser_sites SET last_seen = ?2 WHERE origin = ?1",
            params![origin, now_ms()],
        )?;
        Ok(())
    })
}

#[cfg(test)]
#[path = "sites_tests.rs"]
mod tests;
