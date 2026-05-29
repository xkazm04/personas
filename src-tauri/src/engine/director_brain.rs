//! Director ↔ Obsidian Brain bridge.
//!
//! When `director.brain_enabled` is on AND a vault is configured, the Director
//! turns its rendered review into durable long-term memory:
//!
//!   - [`read_brain_history`] folds the persona's most recent Director notes
//!     into the evaluator's payload before a review;
//!   - [`write_brain_note`] persists the new review back into the vault under
//!     a `Director/<persona>/` folder after.
//!
//! Plain `std::fs` + the `obsidian_brain::mirror_*` helpers — no embeddings,
//! works in the lite build, fully best-effort (a vault failure never breaks
//! a review).
//!
//! Extracted out of `engine::director` in v2 so the gating + filesystem code
//! stays out of the evaluator's main pipeline.
//!
//! Used by `engine::director::evaluate_with_llm`; visibility kept at
//! `pub(super)` for the engine module.

use crate::db::repos::core::settings;
use crate::db::settings_keys::DIRECTOR_BRAIN_ENABLED;
use crate::db::DbPool;

/// Vault-relative folder for a persona's Director notes, e.g. `Director/My-Bot`.
/// Non-alphanumerics in the persona name collapse to `-` so the path is safe
/// across Windows + Unix and stays predictable for users browsing the vault.
pub(super) fn director_vault_folder(persona_name: &str) -> String {
    let slug: String = persona_name
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect();
    format!("Director/{}", slug.trim_matches('-'))
}

/// True when the Director may use the Brain vault: the setting is on AND a
/// vault is configured. Both signals are required — if either is missing we
/// skip the read/write so the evaluator behaves identically to the no-brain
/// case.
pub(super) fn brain_enabled(pool: &DbPool) -> bool {
    let on = matches!(
        settings::get(pool, DIRECTOR_BRAIN_ENABLED),
        Ok(Some(v)) if v == "true"
    );
    on && crate::commands::obsidian_brain::mirror_vault_root(pool).is_some()
}

/// Read up to the 3 most recent Director notes for this persona from the
/// vault. Plain `std::fs` (no embeddings); best-effort. Returns the
/// concatenated markdown bodies separated by horizontal rules, or `None` if
/// no vault, no folder, or no `.md` files.
pub(super) fn read_brain_history(pool: &DbPool, persona_name: &str) -> Option<String> {
    let cfg = crate::commands::obsidian_brain::mirror_vault_root(pool)?;
    let dir = std::path::Path::new(&cfg.vault_path).join(director_vault_folder(persona_name));
    let mut files: Vec<std::path::PathBuf> = std::fs::read_dir(&dir)
        .ok()?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("md"))
        .collect();
    files.sort();
    let recent: Vec<String> = files
        .iter()
        .rev()
        .take(3)
        .filter_map(|p| std::fs::read_to_string(p).ok())
        .collect();
    (!recent.is_empty()).then(|| recent.join("\n\n---\n\n"))
}

/// Write the Director's review note into the vault as durable memory (best-
/// effort). Logs + swallows write errors — the Director run must succeed even
/// if the vault is temporarily unavailable.
pub(super) fn write_brain_note(
    pool: &DbPool,
    persona_id: &str,
    persona_name: &str,
    review_md: &str,
) {
    let Some(cfg) = crate::commands::obsidian_brain::mirror_vault_root(pool) else {
        return;
    };
    let rel = format!(
        "{}/{}.md",
        director_vault_folder(persona_name),
        chrono::Utc::now().format("%Y-%m-%d-%H%M%S")
    );
    if let Err(e) = crate::commands::obsidian_brain::mirror_write_note(
        pool,
        &cfg.vault_path,
        &rel,
        "director_verdict",
        persona_id,
        review_md,
    ) {
        tracing::warn!(error = %e, persona = %persona_id, "Director: failed to write Brain note");
    }
}

#[cfg(test)]
mod tests {
    use super::director_vault_folder;

    #[test]
    fn folder_slugifies_non_alphanumerics() {
        assert_eq!(director_vault_folder("My Bot 2.0!"), "Director/My-Bot-2-0");
        assert_eq!(director_vault_folder("plain"), "Director/plain");
        assert_eq!(director_vault_folder("---weird---"), "Director/weird");
    }
}
