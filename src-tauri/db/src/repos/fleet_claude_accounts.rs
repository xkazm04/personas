//! `claude_accounts` — stored Claude Code logins for the multi-plan switcher.
//!
//! The row carries the credentials file ENCRYPTED (`creds_ciphertext` +
//! `creds_nonce`, from `personas_core::crypto::encrypt_for_db`); decryption
//! is the app layer's business, so a plain `list` never materialises a token.

use rusqlite::params;

use crate::DbPool;
use personas_core::error::AppError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaudeAccountRow {
    /// Anthropic's account uuid.
    pub id: String,
    pub email: String,
    pub display_name: Option<String>,
    pub organization_uuid: Option<String>,
    pub organization_name: Option<String>,
    pub rate_limit_tier: Option<String>,
    pub subscription_type: Option<String>,
    /// Stable human ordinal, assigned once at capture.
    pub slot: i64,
    pub creds_ciphertext: String,
    pub creds_nonce: String,
    /// Set when the stored refresh token died; cleared by a re-capture.
    pub quarantine_reason: Option<String>,
    pub added_at_ms: i64,
    pub updated_at_ms: i64,
    pub last_switched_at_ms: Option<i64>,
}

const COLUMNS: &str = "id, email, display_name, organization_uuid, organization_name,
    rate_limit_tier, subscription_type, slot, creds_ciphertext, creds_nonce,
    quarantine_reason, added_at_ms, updated_at_ms, last_switched_at_ms";

row_mapper!(map_row -> ClaudeAccountRow {
    id, email, display_name, organization_uuid, organization_name,
    rate_limit_tier, subscription_type, slot, creds_ciphertext, creds_nonce,
    quarantine_reason, added_at_ms, updated_at_ms, last_switched_at_ms,
});

/// Insert or refresh an account. Identity + credentials are replaced; the
/// slot and `added_at_ms` are kept from the first capture; a re-capture
/// clears the quarantine (a fresh login is by definition alive).
pub fn upsert(pool: &DbPool, row: &ClaudeAccountRow) -> Result<(), AppError> {
    timed_query!("claude_accounts", "claude_accounts::upsert", {
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO claude_accounts
                (id, email, display_name, organization_uuid, organization_name,
                 rate_limit_tier, subscription_type, slot, creds_ciphertext, creds_nonce,
                 quarantine_reason, added_at_ms, updated_at_ms, last_switched_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11, ?12, ?13)
             ON CONFLICT(id) DO UPDATE SET
                email             = excluded.email,
                display_name      = COALESCE(excluded.display_name, claude_accounts.display_name),
                organization_uuid = COALESCE(excluded.organization_uuid, claude_accounts.organization_uuid),
                organization_name = COALESCE(excluded.organization_name, claude_accounts.organization_name),
                rate_limit_tier   = COALESCE(excluded.rate_limit_tier, claude_accounts.rate_limit_tier),
                subscription_type = COALESCE(excluded.subscription_type, claude_accounts.subscription_type),
                creds_ciphertext  = excluded.creds_ciphertext,
                creds_nonce       = excluded.creds_nonce,
                quarantine_reason = NULL,
                updated_at_ms     = excluded.updated_at_ms",
            params![
                row.id,
                row.email,
                row.display_name,
                row.organization_uuid,
                row.organization_name,
                row.rate_limit_tier,
                row.subscription_type,
                row.slot,
                row.creds_ciphertext,
                row.creds_nonce,
                row.added_at_ms,
                personas_core::utils::now_ms(),
                row.last_switched_at_ms,
            ],
        )?;
        Ok(())
    })
}

pub fn list(pool: &DbPool) -> Result<Vec<ClaudeAccountRow>, AppError> {
    timed_query!("claude_accounts", "claude_accounts::list", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLUMNS} FROM claude_accounts ORDER BY slot ASC"
        ))?;
        let rows = stmt.query_map([], map_row)?;
        Ok(rows.filter_map(Result::ok).collect())
    })
}

pub fn get(pool: &DbPool, id: &str) -> Result<Option<ClaudeAccountRow>, AppError> {
    timed_query!("claude_accounts", "claude_accounts::get", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLUMNS} FROM claude_accounts WHERE id = ?1"
        ))?;
        let mut rows = stmt.query_map(params![id], map_row)?;
        Ok(rows.next().transpose()?)
    })
}

pub fn delete(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("claude_accounts", "claude_accounts::delete", {
        let conn = pool.get()?;
        let n = conn.execute("DELETE FROM claude_accounts WHERE id = ?1", params![id])?;
        Ok(n > 0)
    })
}

/// Replace the stored credentials (a refreshed token, or the live file synced
/// back before a switch). Never touches identity or the slot.
pub fn set_creds(pool: &DbPool, id: &str, ciphertext: &str, nonce: &str) -> Result<(), AppError> {
    timed_query!("claude_accounts", "claude_accounts::set_creds", {
        let conn = pool.get()?;
        let n = conn.execute(
            "UPDATE claude_accounts
                SET creds_ciphertext = ?2, creds_nonce = ?3, quarantine_reason = NULL,
                    updated_at_ms = ?4
              WHERE id = ?1",
            params![id, ciphertext, nonce, personas_core::utils::now_ms()],
        )?;
        if n == 0 {
            return Err(AppError::NotFound(format!("claude account {id}")));
        }
        Ok(())
    })
}

pub fn set_quarantine(pool: &DbPool, id: &str, reason: Option<&str>) -> Result<(), AppError> {
    timed_query!("claude_accounts", "claude_accounts::set_quarantine", {
        let conn = pool.get()?;
        let n = conn.execute(
            "UPDATE claude_accounts SET quarantine_reason = ?2, updated_at_ms = ?3 WHERE id = ?1",
            params![id, reason, personas_core::utils::now_ms()],
        )?;
        if n == 0 {
            return Err(AppError::NotFound(format!("claude account {id}")));
        }
        Ok(())
    })
}

pub fn mark_switched(pool: &DbPool, id: &str) -> Result<(), AppError> {
    timed_query!("claude_accounts", "claude_accounts::mark_switched", {
        let conn = pool.get()?;
        let now = personas_core::utils::now_ms();
        let n = conn.execute(
            "UPDATE claude_accounts SET last_switched_at_ms = ?2, updated_at_ms = ?2 WHERE id = ?1",
            params![id, now],
        )?;
        if n == 0 {
            return Err(AppError::NotFound(format!("claude account {id}")));
        }
        Ok(())
    })
}

/// The next free ordinal: one past the highest slot in use.
pub fn next_slot(pool: &DbPool) -> Result<i64, AppError> {
    timed_query!("claude_accounts", "claude_accounts::next_slot", {
        let conn = pool.get()?;
        let max: Option<i64> = conn.query_row(
            "SELECT MAX(slot) AS max_slot FROM claude_accounts",
            [],
            |r| r.get("max_slot"),
        )?;
        Ok(max.unwrap_or(0) + 1)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_test_db;

    fn row(id: &str, slot: i64) -> ClaudeAccountRow {
        ClaudeAccountRow {
            id: id.into(),
            email: format!("{id}@example.com"),
            display_name: Some("Name".into()),
            organization_uuid: None,
            organization_name: Some("Org".into()),
            rate_limit_tier: Some("default_claude_max_20x".into()),
            subscription_type: Some("max".into()),
            slot,
            creds_ciphertext: "ct".into(),
            creds_nonce: "n".into(),
            quarantine_reason: None,
            added_at_ms: 1,
            updated_at_ms: 1,
            last_switched_at_ms: None,
        }
    }

    #[test]
    fn upsert_keeps_slot_and_clears_quarantine() {
        let pool = init_test_db().unwrap();
        assert_eq!(next_slot(&pool).unwrap(), 1);
        upsert(&pool, &row("a", 1)).unwrap();
        upsert(&pool, &row("b", 2)).unwrap();
        assert_eq!(next_slot(&pool).unwrap(), 3);

        set_quarantine(&pool, "a", Some("invalid_grant")).unwrap();
        assert_eq!(
            get(&pool, "a")
                .unwrap()
                .unwrap()
                .quarantine_reason
                .as_deref(),
            Some("invalid_grant")
        );

        // Re-capture with a different slot request: slot is kept, quarantine cleared.
        let mut again = row("a", 9);
        again.creds_ciphertext = "ct2".into();
        upsert(&pool, &again).unwrap();
        let a = get(&pool, "a").unwrap().unwrap();
        assert_eq!(a.slot, 1);
        assert_eq!(a.creds_ciphertext, "ct2");
        assert!(a.quarantine_reason.is_none());

        set_creds(&pool, "b", "ct3", "n3").unwrap();
        assert_eq!(get(&pool, "b").unwrap().unwrap().creds_nonce, "n3");
        mark_switched(&pool, "b").unwrap();
        assert!(get(&pool, "b")
            .unwrap()
            .unwrap()
            .last_switched_at_ms
            .is_some());

        let all = list(&pool).unwrap();
        assert_eq!(
            all.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
            ["a", "b"]
        );
        assert!(delete(&pool, "a").unwrap());
        assert!(!delete(&pool, "a").unwrap());
        assert!(get(&pool, "a").unwrap().is_none());
    }
}
