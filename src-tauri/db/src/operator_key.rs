//! The local **operator** API key — `operator-local`, delivered as a file.
//!
//! **Why.** Some approvals are the operator's alone (a kp hire, a cloud
//! pairing), and until now the only way to give them was a click in the desktop
//! UI. The operator wants to decide them programmatically too — from a script,
//! a terminal, another local tool — WITHOUT that door being reachable by any
//! key an external app can hold. The door is the `personas:approve` scope
//! ([`APPROVE_SCOPE`]); this module is how the operator, and only the
//! operator, holds a key carrying it.
//!
//! **The trust argument, which is the whole reason this is default-ON.** The
//! token is written to `<app data dir>/operator-api-key`, the same directory
//! that holds `personas.db`, `master.key` and the logs. Whoever can read that
//! directory already controls Personas completely: they can open the database,
//! read the master key (or the keychain entry it guards) and decrypt every
//! stored credential. A token readable only by them grants nothing they do not
//! already have, so minting it on every install does not widen the trust
//! boundary. It does NOT cross it either: the file is never served, never
//! logged, and the scope is never grantable through pairing
//! (`personas_engine::pairing::is_pairable_scope`) or implied by any other
//! scope (`management_api::authorize` checks it exactly).
//!
//! File protection: on Unix the file is `0600`. On Windows it inherits the app
//! data directory's ACL — `%APPDATA%\<app id>` lives under the user profile
//! (owner-only by default), and `init_db` already restricts the directory to
//! the current user (`restrict_dir_permissions`, inheritable). No `icacls` call
//! is made for the file itself.
//!
//! Opt-out: `PERSONAS_OPERATOR_KEY=0` at launch revokes any active
//! `operator-local` key and deletes the file (see [`operator_key_enabled`]).
//!
//! **The key material is only known at creation** (the table stores a hash),
//! so the file is the one place the token exists. Boot therefore reconciles
//! the two: reuse when the file's token still resolves to the active
//! `operator-local` key with exactly the expected scopes; otherwise revoke
//! every active `operator-local` key and mint a fresh one.

use std::path::{Path, PathBuf};

use personas_core::error::AppError;

use crate::repos::resources::external_api_keys as key_repo;
use crate::DbPool;

/// The scope that authorizes the operator approval routes. Never pairable,
/// never implied.
pub const APPROVE_SCOPE: &str = "personas:approve";
/// Name of the one operator key.
pub const OPERATOR_KEY_NAME: &str = "operator-local";
/// File name, inside the app data dir.
pub const OPERATOR_KEY_FILE: &str = "operator-api-key";
/// Opt-out env var: `0` / `false` / `off` disables the operator key.
pub const OPERATOR_KEY_ENV: &str = "PERSONAS_OPERATOR_KEY";

/// Exactly the scopes the operator key carries.
pub fn operator_scopes() -> Vec<String> {
    vec!["personas:read".to_string(), APPROVE_SCOPE.to_string()]
}

/// Default ON; `PERSONAS_OPERATOR_KEY=0|false|off|no` turns it off.
pub fn operator_key_enabled() -> bool {
    parse_enabled(std::env::var(OPERATOR_KEY_ENV).ok().as_deref())
}

fn parse_enabled(raw: Option<&str>) -> bool {
    !matches!(
        raw.map(|v| v.trim().to_ascii_lowercase()).as_deref(),
        Some("0" | "false" | "off" | "no")
    )
}

pub fn operator_key_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(OPERATOR_KEY_FILE)
}

/// What [`ensure_operator_key`] did. Carries ids and prefixes only — never
/// the token.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OperatorKeyOutcome {
    /// The file's token still resolves to the active key; nothing changed
    /// (besides revoking `revoked_duplicates` stray active copies).
    Reused {
        key_id: String,
        revoked_duplicates: usize,
    },
    /// A fresh key was minted and written; `revoked` older ones were revoked.
    Minted {
        key_id: String,
        key_prefix: String,
        revoked: usize,
    },
    /// Opt-out: `revoked` keys revoked, the file removed if it existed.
    Disabled { revoked: usize },
}

fn active_operator_keys(
    pool: &DbPool,
) -> Result<Vec<personas_core::models::ExternalApiKey>, AppError> {
    let now = chrono::Utc::now();
    Ok(key_repo::list(pool)?
        .into_iter()
        .filter(|k| {
            k.name == OPERATOR_KEY_NAME
                && k.enabled
                && k.revoked_at.is_none()
                && !k.is_expired_at(now)
        })
        .collect())
}

fn same_scopes(key: &personas_core::models::ExternalApiKey) -> bool {
    let mut have = key.parsed_scopes();
    let mut want = operator_scopes();
    have.sort();
    want.sort();
    have == want
}

/// Write `token` to `path` atomically: a sibling temp file, restricted, then
/// renamed over the target (a replace on every platform std supports).
fn write_token_atomically(path: &Path, token: &str) -> std::io::Result<()> {
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    std::fs::create_dir_all(dir)?;
    let tmp = dir.join(format!(".{OPERATOR_KEY_FILE}.{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        std::fs::write(&tmp, token.as_bytes())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))?;
        }
        std::fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

/// Reconcile the operator key with its file. Idempotent; see the module doc.
pub fn ensure_operator_key(
    pool: &DbPool,
    app_data_dir: &Path,
    enabled: bool,
) -> Result<OperatorKeyOutcome, AppError> {
    let path = operator_key_path(app_data_dir);
    let active = active_operator_keys(pool)?;

    if !enabled {
        let mut revoked = 0;
        for k in &active {
            key_repo::revoke(pool, &k.id)?;
            revoked += 1;
        }
        match std::fs::remove_file(&path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(AppError::Io(e)),
        }
        return Ok(OperatorKeyOutcome::Disabled { revoked });
    }

    // Reuse: the file's token resolves to an active operator key with exactly
    // the operator scopes.
    let file_token = std::fs::read_to_string(&path)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    if let Some(token) = file_token {
        if let Some(key) = key_repo::find_by_token(pool, &token)? {
            if key.name == OPERATOR_KEY_NAME && same_scopes(&key) {
                let mut revoked_duplicates = 0;
                for stray in active.iter().filter(|k| k.id != key.id) {
                    key_repo::revoke(pool, &stray.id)?;
                    revoked_duplicates += 1;
                }
                return Ok(OperatorKeyOutcome::Reused {
                    key_id: key.id,
                    revoked_duplicates,
                });
            }
        }
    }

    // Re-mint: the token of any active key is unknowable now, so every active
    // operator key is revoked before its replacement exists.
    let mut revoked = 0;
    for k in &active {
        key_repo::revoke(pool, &k.id)?;
        revoked += 1;
    }
    let resp = key_repo::create(
        pool,
        OPERATOR_KEY_NAME,
        operator_scopes(),
        None,
        None,
        Some("Local operator key — token in the app data dir's operator-api-key file".into()),
    )?;
    if let Err(e) = write_token_atomically(&path, &resp.plaintext_token) {
        // A key whose token nobody holds is litter at best; revoke it.
        let _ = key_repo::revoke(pool, &resp.record.id);
        return Err(AppError::Io(e));
    }
    Ok(OperatorKeyOutcome::Minted {
        key_id: resp.record.id,
        key_prefix: resp.record.key_prefix,
        revoked,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_test_db;

    struct TempDir(PathBuf);
    impl TempDir {
        fn new() -> Self {
            let p = std::env::temp_dir()
                .join(format!("personas_operator_key_{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&p).unwrap();
            Self(p)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn file_token(dir: &Path) -> String {
        std::fs::read_to_string(operator_key_path(dir)).unwrap()
    }

    #[test]
    fn first_boot_mints_a_key_whose_token_is_only_in_the_file() {
        let pool = init_test_db().unwrap();
        let dir = TempDir::new();
        let out = ensure_operator_key(&pool, &dir.0, true).unwrap();
        let OperatorKeyOutcome::Minted {
            key_id, revoked, ..
        } = out
        else {
            panic!("expected Minted, got {out:?}");
        };
        assert_eq!(revoked, 0);
        let token = file_token(&dir.0);
        let key = key_repo::find_by_token(&pool, &token)
            .unwrap()
            .expect("token resolves");
        assert_eq!(key.id, key_id);
        assert_eq!(key.name, OPERATOR_KEY_NAME);
        assert!(same_scopes(&key), "exactly read + approve: {}", key.scopes);
        assert!(key.bound_origin.is_none());
        assert!(key.expires_at.is_none());
        // No stray temp files.
        let leftovers: Vec<_> = std::fs::read_dir(&dir.0)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty());
    }

    #[test]
    fn a_second_boot_reuses_the_key_and_leaves_the_file_alone() {
        let pool = init_test_db().unwrap();
        let dir = TempDir::new();
        let OperatorKeyOutcome::Minted { key_id, .. } =
            ensure_operator_key(&pool, &dir.0, true).unwrap()
        else {
            panic!()
        };
        let token = file_token(&dir.0);
        let again = ensure_operator_key(&pool, &dir.0, true).unwrap();
        assert_eq!(
            again,
            OperatorKeyOutcome::Reused {
                key_id: key_id.clone(),
                revoked_duplicates: 0
            }
        );
        assert_eq!(file_token(&dir.0), token, "file untouched");
        assert_eq!(active_operator_keys(&pool).unwrap().len(), 1);
    }

    #[test]
    fn a_missing_or_garbled_file_revokes_and_re_mints() {
        let pool = init_test_db().unwrap();
        let dir = TempDir::new();
        let OperatorKeyOutcome::Minted { key_id: first, .. } =
            ensure_operator_key(&pool, &dir.0, true).unwrap()
        else {
            panic!()
        };
        let old_token = file_token(&dir.0);

        std::fs::remove_file(operator_key_path(&dir.0)).unwrap();
        let out = ensure_operator_key(&pool, &dir.0, true).unwrap();
        let OperatorKeyOutcome::Minted {
            key_id: second,
            revoked,
            ..
        } = out
        else {
            panic!("expected Minted, got {out:?}");
        };
        assert_ne!(second, first);
        assert_eq!(revoked, 1, "the unreachable key is revoked");
        assert!(key_repo::find_by_token(&pool, &old_token)
            .unwrap()
            .is_none());
        assert_eq!(active_operator_keys(&pool).unwrap().len(), 1);

        std::fs::write(operator_key_path(&dir.0), "pk_not_a_real_token").unwrap();
        let out = ensure_operator_key(&pool, &dir.0, true).unwrap();
        assert!(
            matches!(out, OperatorKeyOutcome::Minted { revoked: 1, .. }),
            "{out:?}"
        );
        assert_eq!(active_operator_keys(&pool).unwrap().len(), 1);
    }

    #[test]
    fn a_file_holding_another_keys_token_is_not_reused() {
        let pool = init_test_db().unwrap();
        let dir = TempDir::new();
        let other = key_repo::create(
            &pool,
            "kp",
            vec!["personas:read".into(), "personas:build".into()],
            None,
            None,
            None,
        )
        .unwrap();
        std::fs::write(operator_key_path(&dir.0), &other.plaintext_token).unwrap();
        let out = ensure_operator_key(&pool, &dir.0, true).unwrap();
        assert!(matches!(out, OperatorKeyOutcome::Minted { .. }), "{out:?}");
        assert_ne!(file_token(&dir.0), other.plaintext_token);
        // The foreign key is left alone.
        assert!(key_repo::find_by_token(&pool, &other.plaintext_token)
            .unwrap()
            .is_some());
    }

    #[test]
    fn opting_out_revokes_and_removes_the_file() {
        let pool = init_test_db().unwrap();
        let dir = TempDir::new();
        ensure_operator_key(&pool, &dir.0, true).unwrap();
        let token = file_token(&dir.0);
        let out = ensure_operator_key(&pool, &dir.0, false).unwrap();
        assert_eq!(out, OperatorKeyOutcome::Disabled { revoked: 1 });
        assert!(!operator_key_path(&dir.0).exists());
        assert!(key_repo::find_by_token(&pool, &token).unwrap().is_none());
        // Idempotent.
        assert_eq!(
            ensure_operator_key(&pool, &dir.0, false).unwrap(),
            OperatorKeyOutcome::Disabled { revoked: 0 }
        );
    }

    #[test]
    fn the_env_switch_is_default_on() {
        assert!(parse_enabled(None));
        assert!(parse_enabled(Some("1")));
        assert!(parse_enabled(Some("")));
        for off in ["0", "false", "OFF", " no "] {
            assert!(!parse_enabled(Some(off)), "{off}");
        }
    }
}
