//! Execute rights follow a kp hire — and end with it.
//!
//! kp (the sibling recruiting app) hires a persona through
//! `POST /api/kp/persona-requests` with a paired key that holds only
//! `personas:read` + `personas:build`. Once a human approves the hire, kp needs
//! to hand the new persona real work over `POST /api/execute/{persona_id}`,
//! which `authorize` gates on `personas:execute` **or**
//! `personas:execute:persona:{persona_id}`.
//!
//! This module grants the narrow one, to exactly one key:
//!
//! * **At intake** the management API records which `external_api_keys` row
//!   authenticated the request, in `companion_approval.requested_by_key_id`
//!   (user database). The caller cannot choose that value — it is the key the
//!   middleware resolved, not a body field.
//! * **At approval** ([`grant_on_hire_approval`]) that key gains
//!   `personas:execute:persona:<new persona id>`. Nothing broader: never the
//!   blanket `personas:execute`, never `proxy`, never a persona kp did not
//!   request. A key that has since been revoked, disabled, expired or deleted
//!   is skipped with a logged reason — the hire itself still succeeds.
//! * **At retirement** ([`revoke_on_retire`]) the grant is removed again from
//!   the key(s) that submitted a hire for that persona, and from no other key:
//!   an operator who hand-granted a per-persona scope to some other key through
//!   the API-keys UI keeps it.
//!
//! Both halves are best-effort by design. A failed grant degrades kp to "hired
//! but cannot dispatch" (403 on execute, visible and recoverable by an operator
//! grant); a failed approval would lose the hire. Every skip is logged.

use personas_core::error::AppError;
use personas_db::repos::resources::external_api_keys::{self as api_keys, ScopeGrant, ScopeRevoke};
use personas_db::{DbPool, UserDbPool};
use rusqlite::{params, OptionalExtension};

/// Prefix of the resource-scoped execute grant. `authorize` in the app's
/// management API reads the same constant, so the grant written here and the
/// check that honours it cannot drift apart.
pub const EXECUTE_PERSONA_SCOPE_PREFIX: &str = "personas:execute:persona:";

/// The exact scope that lets a key execute one persona and nothing else.
pub fn execute_scope_for(persona_id: &str) -> String {
    format!("{EXECUTE_PERSONA_SCOPE_PREFIX}{persona_id}")
}

/// What approving one kp hire did to the submitting key's scopes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HireGrant {
    /// The scope was added to this key.
    Granted { key_id: String, scope: String },
    /// This key already held the scope (a re-run of the same approval).
    AlreadyHeld { key_id: String, scope: String },
    /// No grant was made; the reason is also logged.
    Skipped { reason: String },
}

/// The key that submitted approval row `approval_id`, if one was recorded.
pub fn submitting_key_id(
    user_db: &UserDbPool,
    approval_id: &str,
) -> Result<Option<String>, AppError> {
    let conn = user_db.get()?;
    let key_id: Option<Option<String>> = conn
        .query_row(
            "SELECT requested_by_key_id FROM companion_approval WHERE id = ?1",
            params![approval_id],
            |r| r.get("requested_by_key_id"),
        )
        .optional()?;
    Ok(key_id
        .flatten()
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty()))
}

/// Grant `personas:execute:persona:<persona_id>` to the key that submitted the
/// kp hire approval `approval_id`. Never fails: every reason not to grant is
/// returned as [`HireGrant::Skipped`] and logged at `warn`.
///
/// `pool` is the app database (`external_api_keys`); `user_db` is the user
/// database (`companion_approval`). The two pool types are the same Rust type,
/// so the argument ORDER is the contract.
pub fn grant_on_hire_approval(
    pool: &DbPool,
    user_db: &UserDbPool,
    approval_id: &str,
    persona_id: &str,
) -> HireGrant {
    let skip = |reason: String| {
        tracing::warn!(
            approval_id,
            persona_id,
            reason = %reason,
            "kp hire approved; execute grant skipped"
        );
        HireGrant::Skipped { reason }
    };

    let key_id = match submitting_key_id(user_db, approval_id) {
        Ok(Some(k)) => k,
        Ok(None) => {
            return skip(
                "no submitting key recorded on the hire request (written before \
                 requested_by_key_id existed, or not inserted by the management API)"
                    .into(),
            )
        }
        Err(e) => return skip(format!("could not read the submitting key: {e}")),
    };
    let scope = execute_scope_for(persona_id);
    match api_keys::grant_scope(pool, &key_id, &scope) {
        Ok(ScopeGrant::Granted) => {
            tracing::info!(
                approval_id,
                persona_id,
                key_id = %key_id,
                scope = %scope,
                "kp hire approved; granted the submitting key execute on this persona only"
            );
            HireGrant::Granted { key_id, scope }
        }
        Ok(ScopeGrant::AlreadyHeld) => HireGrant::AlreadyHeld { key_id, scope },
        Ok(ScopeGrant::KeyInactive) => skip(format!(
            "submitting key {key_id} is revoked, disabled or expired"
        )),
        Ok(ScopeGrant::KeyNotFound) => skip(format!("submitting key {key_id} no longer exists")),
        Err(e) => skip(format!("could not update key {key_id}: {e}")),
    }
}

/// Every key that submitted a kp hire which produced `persona_id`. Read from
/// the hire rows the approval executor stamped with `result.personaId`.
fn hire_submitter_keys(user_db: &UserDbPool, persona_id: &str) -> Result<Vec<String>, AppError> {
    let conn = user_db.get()?;
    let mut stmt = conn.prepare(
        "SELECT DISTINCT requested_by_key_id FROM companion_approval
         WHERE requested_by_key_id IS NOT NULL
           AND json_extract(payload, '$.action') = 'kp_hire_request'
           AND json_extract(payload, '$.result.personaId') = ?1",
    )?;
    let rows = stmt.query_map(params![persona_id], |r| {
        r.get::<_, String>("requested_by_key_id")
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Remove `personas:execute:persona:<persona_id>` from the key(s) that hired
/// this persona through kp. Returns the ids of the keys it was actually
/// removed from. Never fails; problems are logged and the retirement goes on.
/// Idempotent — a second retire of the same persona removes nothing.
pub fn revoke_on_retire(pool: &DbPool, user_db: &UserDbPool, persona_id: &str) -> Vec<String> {
    let keys = match hire_submitter_keys(user_db, persona_id) {
        Ok(k) => k,
        Err(e) => {
            tracing::warn!(
                persona_id,
                error = %e,
                "persona retired; could not look up the kp hire's submitting key, so its \
                 execute grant (if any) was NOT removed"
            );
            return Vec::new();
        }
    };
    let scope = execute_scope_for(persona_id);
    let mut removed = Vec::new();
    for key_id in keys {
        match api_keys::revoke_scope(pool, &key_id, &scope) {
            Ok(ScopeRevoke::Removed) => {
                tracing::info!(
                    persona_id,
                    key_id = %key_id,
                    scope = %scope,
                    "persona retired; removed the kp key's execute grant"
                );
                removed.push(key_id);
            }
            Ok(ScopeRevoke::NotHeld | ScopeRevoke::KeyNotFound) => {}
            Err(e) => tracing::warn!(
                persona_id,
                key_id = %key_id,
                error = %e,
                "persona retired; could not remove the kp key's execute grant"
            ),
        }
    }
    removed
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pools() -> (DbPool, UserDbPool) {
        (
            personas_db::init_test_db().expect("app db"),
            personas_db::init_test_user_db().expect("user db"),
        )
    }

    fn kp_key(pool: &DbPool) -> String {
        api_keys::create(
            pool,
            "kp (paired)",
            vec!["personas:read".into(), "personas:build".into()],
            None,
            Some("http://localhost:3000".into()),
            None,
        )
        .expect("create kp key")
        .record
        .id
    }

    fn scopes_of(pool: &DbPool, key_id: &str) -> Vec<String> {
        api_keys::list(pool)
            .expect("list")
            .into_iter()
            .find(|k| k.id == key_id)
            .expect("key row")
            .parsed_scopes()
    }

    /// A hire row as `insert_kp_hire_approval` writes it, plus the result
    /// stamp `execute_kp_hire_request` merges in once the persona exists.
    fn hire_row(user_db: &UserDbPool, approval_id: &str, key_id: Option<&str>, persona_id: &str) {
        let payload = serde_json::json!({
            "action": "kp_hire_request",
            "params": { "requestId": approval_id },
            "rationale": "test",
            "result": { "personaId": persona_id, "personaName": "Scout", "buildSessionId": "s" },
        })
        .to_string();
        user_db
            .get()
            .expect("conn")
            .execute(
                "INSERT INTO companion_approval
                     (id, session_id, kind, payload, status, requested_by_key_id, created_at)
                 VALUES (?1, 'default', 'op_execute', ?2, 'approved', ?3, datetime('now'))",
                params![approval_id, payload, key_id],
            )
            .expect("insert hire row");
    }

    #[test]
    fn approval_grants_exactly_the_one_per_persona_scope() {
        let (pool, user_db) = pools();
        let key = kp_key(&pool);
        hire_row(&user_db, "appr_1", Some(&key), "p1");

        let out = grant_on_hire_approval(&pool, &user_db, "appr_1", "p1");
        assert_eq!(
            out,
            HireGrant::Granted {
                key_id: key.clone(),
                scope: "personas:execute:persona:p1".into()
            }
        );
        assert_eq!(
            scopes_of(&pool, &key),
            vec![
                "personas:read".to_string(),
                "personas:build".to_string(),
                "personas:execute:persona:p1".to_string(),
            ],
            "one scope added, nothing broader"
        );
        // A re-run of the same approval does not duplicate it.
        assert!(matches!(
            grant_on_hire_approval(&pool, &user_db, "appr_1", "p1"),
            HireGrant::AlreadyHeld { .. }
        ));
        assert_eq!(scopes_of(&pool, &key).len(), 3);
    }

    #[test]
    fn a_second_hire_adds_a_second_grant_and_touches_no_other_key() {
        let (pool, user_db) = pools();
        let key = kp_key(&pool);
        let bystander = kp_key(&pool);
        hire_row(&user_db, "appr_1", Some(&key), "p1");
        hire_row(&user_db, "appr_2", Some(&key), "p2");

        grant_on_hire_approval(&pool, &user_db, "appr_1", "p1");
        grant_on_hire_approval(&pool, &user_db, "appr_2", "p2");

        let scopes = scopes_of(&pool, &key);
        assert!(scopes.contains(&"personas:execute:persona:p1".to_string()));
        assert!(scopes.contains(&"personas:execute:persona:p2".to_string()));
        assert!(!scopes
            .iter()
            .any(|s| s == "personas:execute" || s == "proxy"));
        assert_eq!(
            scopes_of(&pool, &bystander),
            vec!["personas:read".to_string(), "personas:build".to_string()]
        );
    }

    #[test]
    fn retire_removes_only_that_personas_grant() {
        let (pool, user_db) = pools();
        let key = kp_key(&pool);
        hire_row(&user_db, "appr_1", Some(&key), "p1");
        hire_row(&user_db, "appr_2", Some(&key), "p2");
        grant_on_hire_approval(&pool, &user_db, "appr_1", "p1");
        grant_on_hire_approval(&pool, &user_db, "appr_2", "p2");

        assert_eq!(revoke_on_retire(&pool, &user_db, "p1"), vec![key.clone()]);
        let scopes = scopes_of(&pool, &key);
        assert!(!scopes.contains(&"personas:execute:persona:p1".to_string()));
        assert!(scopes.contains(&"personas:execute:persona:p2".to_string()));

        // Idempotent: a second retire has nothing left to remove.
        assert!(revoke_on_retire(&pool, &user_db, "p1").is_empty());
    }

    #[test]
    fn retire_leaves_an_operator_grant_on_another_key_alone() {
        let (pool, user_db) = pools();
        let kp = kp_key(&pool);
        let operator_key = api_keys::create(
            &pool,
            "operator script",
            vec!["personas:execute:persona:p1".into()],
            None,
            None,
            None,
        )
        .expect("create")
        .record
        .id;
        hire_row(&user_db, "appr_1", Some(&kp), "p1");
        grant_on_hire_approval(&pool, &user_db, "appr_1", "p1");

        revoke_on_retire(&pool, &user_db, "p1");
        assert_eq!(
            scopes_of(&pool, &operator_key),
            vec!["personas:execute:persona:p1".to_string()],
            "only the key that hired the persona loses the grant"
        );
    }

    #[test]
    fn a_revoked_submitting_key_is_skipped_without_failing() {
        let (pool, user_db) = pools();
        let key = kp_key(&pool);
        api_keys::revoke(&pool, &key).expect("revoke");
        hire_row(&user_db, "appr_1", Some(&key), "p1");

        match grant_on_hire_approval(&pool, &user_db, "appr_1", "p1") {
            HireGrant::Skipped { reason } => assert!(reason.contains("revoked"), "{reason}"),
            other => panic!("expected a skip, got {other:?}"),
        }
        assert!(!scopes_of(&pool, &key).contains(&"personas:execute:persona:p1".to_string()));
    }

    #[test]
    fn a_deleted_key_or_an_unrecorded_submitter_is_skipped() {
        let (pool, user_db) = pools();
        let key = kp_key(&pool);
        api_keys::delete(&pool, &key).expect("delete");
        hire_row(&user_db, "appr_gone", Some(&key), "p1");
        hire_row(&user_db, "appr_legacy", None, "p2");

        assert!(matches!(
            grant_on_hire_approval(&pool, &user_db, "appr_gone", "p1"),
            HireGrant::Skipped { .. }
        ));
        assert!(matches!(
            grant_on_hire_approval(&pool, &user_db, "appr_legacy", "p2"),
            HireGrant::Skipped { .. }
        ));
        assert!(matches!(
            grant_on_hire_approval(&pool, &user_db, "appr_missing", "p3"),
            HireGrant::Skipped { .. }
        ));
    }
}
