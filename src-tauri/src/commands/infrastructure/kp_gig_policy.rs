//! The IPC door onto the gig persona policy (`kp.gig_persona_policy`).
//!
//! The policy is the operator's standing approval for kp's one-persona-per-gig
//! hires (`personas_db::kp_gig_policy`, bridge doc §10.14). It is an
//! operator-only settings key: the generic settings writers — and so every
//! management-API route a kp key could reach — refuse it. These two commands,
//! behind the desktop session (`require_auth`), are its only writer; the UI is
//! the "Gig persona policy" section of Settings → API Keys.

use std::path::{Component, Path};
use std::sync::Arc;

use tauri::State;

use crate::db::kp_gig_policy::{self, GigPersonaPolicy};
use crate::db::settings_keys::KP_GIG_PERSONA_POLICY;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::state::AppState;

/// The policy in force (the disabled default when none is stored).
#[tauri::command]
pub async fn kp_gig_persona_policy_get(
    state: State<'_, Arc<AppState>>,
) -> Result<GigPersonaPolicy, AppError> {
    require_auth(&state).await?;
    let db = state.db.clone();
    // The handle is bound and awaited: a panic in the read surfaces as this
    // command's error instead of vanishing.
    let read = tokio::task::spawn_blocking(move || kp_gig_policy::load(&db));
    read.await
        .map_err(|e| AppError::Internal(format!("gig persona policy read: {e}")))
}

/// Validate, normalize and store the policy. Returns what was stored — the
/// Settings section renders that, so no change event is broadcast (nothing
/// else in the app reads the key; the management API reads it per request).
#[tauri::command]
pub async fn kp_gig_persona_policy_set(
    state: State<'_, Arc<AppState>>,
    policy: GigPersonaPolicy,
) -> Result<GigPersonaPolicy, AppError> {
    require_auth(&state).await?;
    let policy = normalize(policy)?;
    let json = serde_json::to_string(&policy)
        .map_err(|e| AppError::Internal(format!("gig persona policy encode: {e}")))?;
    let db = state.db.clone();
    let write = tokio::task::spawn_blocking(move || {
        crate::db::repos::core::settings::set_operator_only(&db, KP_GIG_PERSONA_POLICY, &json)
    });
    write
        .await
        .map_err(|e| AppError::Internal(format!("gig persona policy write: {e}")))??;
    Ok(policy)
}

/// The write-side rules: the shape rules every stored value obeys, the model
/// list trimmed and de-duplicated, and a non-empty `rootPath` absolute, free of
/// `..`, an existing directory and not a filesystem/drive root — stored in its
/// canonical form (the Windows `\\?\` prefix stripped), so the value the
/// operator reads back is the folder the check compares against.
pub(crate) fn normalize(mut policy: GigPersonaPolicy) -> Result<GigPersonaPolicy, AppError> {
    let mut models: Vec<String> = Vec::new();
    for m in policy.allowed_models.iter().map(|m| m.trim()) {
        if !m.is_empty() && !models.iter().any(|x| x.eq_ignore_ascii_case(m)) {
            models.push(m.to_string());
        }
    }
    policy.allowed_models = models;
    let root = policy.root_path.trim().to_string();
    policy.root_path = if root.is_empty() {
        String::new()
    } else {
        canonical_root(&root)?
    };
    kp_gig_policy::validate_shape(&policy).map_err(AppError::Validation)?;
    Ok(policy)
}

fn canonical_root(raw: &str) -> Result<String, AppError> {
    let path = Path::new(raw);
    if !path.is_absolute() {
        return Err(AppError::Validation(
            "the gig root folder must be an absolute path".into(),
        ));
    }
    if path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(AppError::Validation(
            "the gig root folder must not contain `..`".into(),
        ));
    }
    let canonical = std::fs::canonicalize(path)
        .map_err(|_| AppError::Validation(format!("the gig root folder {raw} does not exist")))?;
    if !canonical.is_dir() {
        return Err(AppError::Validation(format!(
            "the gig root folder {raw} is not a directory"
        )));
    }
    let canonical = crate::commands::credentials::auth_detect::strip_verbatim_prefix(canonical);
    if canonical.parent().is_none() {
        return Err(AppError::Validation(
            "the gig root folder cannot be a filesystem or drive root".into(),
        ));
    }
    Ok(canonical.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use personas_core::model_ids::OPUS_5_5;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let p =
            std::env::temp_dir().join(format!("kp_gig_policy_cmd_{tag}_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn a_policy_is_normalized_before_it_is_stored() {
        let dir = temp_dir("ok");
        let out = normalize(GigPersonaPolicy {
            enabled: true,
            max_budget_usd: Some(5.0),
            allowed_models: vec![
                format!(" {OPUS_5_5} "),
                OPUS_5_5.to_ascii_uppercase(),
                String::new(),
            ],
            root_path: dir.to_string_lossy().to_string(),
        })
        .unwrap();
        assert_eq!(out.allowed_models, vec![OPUS_5_5.to_string()]);
        assert!(Path::new(&out.root_path).is_absolute());
        assert!(!out.root_path.starts_with(r"\\?\"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn no_cap_is_stored_as_no_cap_and_a_bad_cap_is_refused() {
        let dir = temp_dir("nocap");
        let base = GigPersonaPolicy {
            enabled: true,
            max_budget_usd: None,
            allowed_models: vec!["m".into()],
            root_path: dir.to_string_lossy().to_string(),
        };
        // No cap stays no cap — normalizing never invents a number.
        assert_eq!(normalize(base.clone()).unwrap().max_budget_usd, None);
        for bad in [-1.0, f64::NAN, f64::INFINITY, 10_000.5] {
            let mut p = base.clone();
            p.max_budget_usd = Some(bad);
            assert!(normalize(p).is_err(), "{bad}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_root_that_is_not_an_existing_absolute_folder_is_refused() {
        let base = GigPersonaPolicy {
            enabled: true,
            max_budget_usd: Some(5.0),
            allowed_models: vec!["m".into()],
            root_path: String::new(),
        };
        // Enabled with no root.
        assert!(normalize(base.clone()).is_err());
        for bad in [
            "relative/gigs".to_string(),
            std::env::temp_dir()
                .join("no-such-gig-root-xyz")
                .to_string_lossy()
                .to_string(),
            std::env::temp_dir()
                .join("a")
                .join("..")
                .join("b")
                .to_string_lossy()
                .to_string(),
        ] {
            let mut p = base.clone();
            p.root_path = bad.clone();
            assert!(normalize(p).is_err(), "{bad}");
        }
        let mut p = base.clone();
        p.root_path = if cfg!(windows) {
            r"C:\".into()
        } else {
            "/".into()
        };
        assert!(normalize(p).is_err(), "a drive root is refused");
        // Disabled with no root is the default and is fine.
        assert!(normalize(GigPersonaPolicy::default()).is_ok());
    }
}
