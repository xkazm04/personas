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

use tauri::{AppHandle, State};

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
    tokio::task::spawn_blocking(move || kp_gig_policy::load(&db))
        .await
        .map_err(|e| AppError::Internal(format!("gig persona policy read: {e}")))
}

/// Validate, normalize and store the policy. Returns what was stored.
#[tauri::command]
pub async fn kp_gig_persona_policy_set(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    policy: GigPersonaPolicy,
) -> Result<GigPersonaPolicy, AppError> {
    require_auth(&state).await?;
    let policy = normalize(policy)?;
    let json = serde_json::to_string(&policy)
        .map_err(|e| AppError::Internal(format!("gig persona policy encode: {e}")))?;
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || {
        crate::db::repos::core::settings::set_operator_only(&db, KP_GIG_PERSONA_POLICY, &json)
    })
    .await
    .map_err(|e| AppError::Internal(format!("gig persona policy write: {e}")))??;
    use tauri::Emitter;
    if let Err(e) = app.emit(
        "settings-changed",
        serde_json::json!({ "key": KP_GIG_PERSONA_POLICY }),
    ) {
        tracing::warn!(error = %e, "failed to emit settings-changed for the gig persona policy");
    }
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
            max_budget_usd: 5.0,
            allowed_models: vec![
                " claude-opus-5-5 ".into(),
                "CLAUDE-OPUS-5-5".into(),
                "".into(),
            ],
            root_path: dir.to_string_lossy().to_string(),
        })
        .unwrap();
        assert_eq!(out.allowed_models, vec!["claude-opus-5-5".to_string()]);
        assert!(Path::new(&out.root_path).is_absolute());
        assert!(!out.root_path.starts_with(r"\\?\"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_root_that_is_not_an_existing_absolute_folder_is_refused() {
        let base = GigPersonaPolicy {
            enabled: true,
            max_budget_usd: 5.0,
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
