//! Claude plan re-login storage: browser profiles, account links, run audit.
//! See `migrations/incremental/e56_claude_login_profiles.rs`. No secret lives
//! in any of these rows.

use rusqlite::params;

use crate::DbPool;
use personas_core::error::AppError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoginProfileRow {
    pub key: String,
    pub label: String,
    pub dir: String,
    pub vault_credential_id: Option<String>,
    pub last_warm_at_ms: Option<i64>,
    pub last_result: Option<String>,
    pub created_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccountLinkRow {
    pub account_id: String,
    pub profile_key: Option<String>,
    pub code_inbox_profile_key: Option<String>,
    pub relogin_unattended: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReloginRunRow {
    pub id: i64,
    pub account_id: String,
    pub trigger: String,
    pub started_at_ms: i64,
    pub finished_at_ms: Option<i64>,
    pub outcome: String,
    pub reason: Option<String>,
}

fn map_profile(r: &rusqlite::Row<'_>) -> rusqlite::Result<LoginProfileRow> {
    Ok(LoginProfileRow {
        key: r.get(0)?,
        label: r.get(1)?,
        dir: r.get(2)?,
        vault_credential_id: r.get(3)?,
        last_warm_at_ms: r.get(4)?,
        last_result: r.get(5)?,
        created_at_ms: r.get(6)?,
    })
}

const PROFILE_COLS: &str =
    "key, label, dir, vault_credential_id, last_warm_at_ms, last_result, created_at_ms";

pub fn list_profiles(pool: &DbPool) -> Result<Vec<LoginProfileRow>, AppError> {
    timed_query!("claude_login_profiles", "claude_login_profiles::list", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {PROFILE_COLS} FROM claude_login_profiles ORDER BY created_at_ms ASC"
        ))?;
        let rows = stmt.query_map([], map_profile)?;
        Ok(rows.filter_map(Result::ok).collect())
    })
}

pub fn get_profile(pool: &DbPool, key: &str) -> Result<Option<LoginProfileRow>, AppError> {
    timed_query!("claude_login_profiles", "claude_login_profiles::get", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {PROFILE_COLS} FROM claude_login_profiles WHERE key = ?1"
        ))?;
        let mut rows = stmt.query_map(params![key], map_profile)?;
        Ok(rows.next().transpose()?)
    })
}

/// Create or update a profile's label, directory and bound vault credential.
/// `last_warm_at_ms` / `last_result` are only ever written by `mark_profile_result`.
pub fn upsert_profile(
    pool: &DbPool,
    key: &str,
    label: &str,
    dir: &str,
    vault_credential_id: Option<&str>,
) -> Result<(), AppError> {
    timed_query!("claude_login_profiles", "claude_login_profiles::upsert", {
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO claude_login_profiles
                (key, label, kind, dir, vault_credential_id, created_at_ms)
             VALUES (?1, ?2, 'chrome', ?3, ?4, ?5)
             ON CONFLICT(key) DO UPDATE SET
                label = excluded.label,
                dir = excluded.dir,
                vault_credential_id = excluded.vault_credential_id",
            params![
                key,
                label,
                dir,
                vault_credential_id,
                personas_core::utils::now_ms()
            ],
        )?;
        Ok(())
    })
}

/// Record the outcome of a run on a profile. `warm` stamps `last_warm_at_ms`
/// (the profile completed a sign-in without a human); a failure keeps the old stamp.
pub fn mark_profile_result(
    pool: &DbPool,
    key: &str,
    warm: bool,
    result: &str,
) -> Result<(), AppError> {
    timed_query!(
        "claude_login_profiles",
        "claude_login_profiles::mark_result",
        {
            let conn = pool.get()?;
            conn.execute(
                "UPDATE claude_login_profiles
                SET last_result = ?2,
                    last_warm_at_ms = CASE WHEN ?3 THEN ?4 ELSE last_warm_at_ms END
              WHERE key = ?1",
                params![key, result, warm, personas_core::utils::now_ms()],
            )?;
            Ok(())
        }
    )
}

pub fn delete_profile(pool: &DbPool, key: &str) -> Result<bool, AppError> {
    timed_query!("claude_login_profiles", "claude_login_profiles::delete", {
        let conn = pool.get()?;
        let n = conn.execute(
            "DELETE FROM claude_login_profiles WHERE key = ?1",
            params![key],
        )?;
        Ok(n > 0)
    })
}

pub fn list_links(pool: &DbPool) -> Result<Vec<AccountLinkRow>, AppError> {
    timed_query!(
        "claude_account_login_links",
        "claude_account_login_links::list",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT account_id, profile_key, code_inbox_profile_key, relogin_unattended
               FROM claude_account_login_links",
            )?;
            let rows = stmt.query_map([], |r| {
                Ok(AccountLinkRow {
                    account_id: r.get(0)?,
                    profile_key: r.get(1)?,
                    code_inbox_profile_key: r.get(2)?,
                    relogin_unattended: r.get::<_, i64>(3)? != 0,
                })
            })?;
            Ok(rows.filter_map(Result::ok).collect())
        }
    )
}

pub fn get_link(pool: &DbPool, account_id: &str) -> Result<Option<AccountLinkRow>, AppError> {
    Ok(list_links(pool)?
        .into_iter()
        .find(|l| l.account_id == account_id))
}

pub fn set_link(pool: &DbPool, link: &AccountLinkRow) -> Result<(), AppError> {
    timed_query!(
        "claude_account_login_links",
        "claude_account_login_links::set",
        {
            let conn = pool.get()?;
            conn.execute(
                "INSERT INTO claude_account_login_links
                (account_id, profile_key, code_inbox_profile_key, relogin_unattended, updated_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(account_id) DO UPDATE SET
                profile_key = excluded.profile_key,
                code_inbox_profile_key = excluded.code_inbox_profile_key,
                relogin_unattended = excluded.relogin_unattended,
                updated_at_ms = excluded.updated_at_ms",
                params![
                    link.account_id,
                    link.profile_key,
                    link.code_inbox_profile_key,
                    link.relogin_unattended,
                    personas_core::utils::now_ms()
                ],
            )?;
            Ok(())
        }
    )
}

/// Open an audit row; returns its id for `finish_run`.
pub fn start_run(pool: &DbPool, account_id: &str, trigger: &str) -> Result<i64, AppError> {
    timed_query!("claude_relogin_runs", "claude_relogin_runs::start", {
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO claude_relogin_runs (account_id, trigger, started_at_ms, outcome)
             VALUES (?1, ?2, ?3, 'running')",
            params![account_id, trigger, personas_core::utils::now_ms()],
        )?;
        Ok(conn.last_insert_rowid())
    })
}

pub fn finish_run(
    pool: &DbPool,
    id: i64,
    outcome: &str,
    reason: Option<&str>,
) -> Result<(), AppError> {
    timed_query!("claude_relogin_runs", "claude_relogin_runs::finish", {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE claude_relogin_runs SET finished_at_ms = ?2, outcome = ?3, reason = ?4 WHERE id = ?1",
            params![id, personas_core::utils::now_ms(), outcome, reason],
        )?;
        Ok(())
    })
}

/// Runs for an account that STARTED at or after `since_ms` (the 3-per-hour limit).
pub fn count_runs_since(pool: &DbPool, account_id: &str, since_ms: i64) -> Result<i64, AppError> {
    timed_query!("claude_relogin_runs", "claude_relogin_runs::count_since", {
        let conn = pool.get()?;
        Ok(conn.query_row(
            "SELECT COUNT(*) FROM claude_relogin_runs WHERE account_id = ?1 AND started_at_ms >= ?2",
            params![account_id, since_ms],
            |r| r.get(0),
        )?)
    })
}

pub fn recent_runs(
    pool: &DbPool,
    account_id: &str,
    limit: i64,
) -> Result<Vec<ReloginRunRow>, AppError> {
    timed_query!("claude_relogin_runs", "claude_relogin_runs::recent", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, account_id, trigger, started_at_ms, finished_at_ms, outcome, reason
               FROM claude_relogin_runs WHERE account_id = ?1
              ORDER BY started_at_ms DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![account_id, limit], |r| {
            Ok(ReloginRunRow {
                id: r.get(0)?,
                account_id: r.get(1)?,
                trigger: r.get(2)?,
                started_at_ms: r.get(3)?,
                finished_at_ms: r.get(4)?,
                outcome: r.get(5)?,
                reason: r.get(6)?,
            })
        })?;
        Ok(rows.filter_map(Result::ok).collect())
    })
}
