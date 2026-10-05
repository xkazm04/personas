//! Command-side orchestration: post-import background work and the
//! shared read-validate-import sequence.
//!
//! Extracted verbatim from the former single-file `data_portability.rs`.

use super::*;

/// Kick the background re-embed for every knowledge base an import created.
/// Vectors never travel in a bundle, so a freshly imported KB has text but no
/// index until this runs. Fire-and-forget by design: `kb_reindex` returns a job
/// id immediately and reports through the usual `kb:ingest_*` events, and a
/// build without the `ml` feature has no embedder at all — in which case the
/// KB stays searchable by keyword (FTS) and the user can reindex later.
pub(crate) fn spawn_pending_kb_reindex(
    app: &AppHandle,
    state: &State<'_, Arc<AppState>>,
    result: &PortabilityImportResult,
) {
    if result.pending_kb_reindex.is_empty() {
        return;
    }
    #[cfg(feature = "ml")]
    {
        for kb_id in &result.pending_kb_reindex {
            let app = app.clone();
            let state = state.inner().clone();
            let kb_id = kb_id.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = crate::commands::credentials::vector_kb::reindex_kb_internal(
                    app,
                    state,
                    kb_id.clone(),
                )
                .await
                {
                    tracing::warn!(kb_id = %kb_id, error = %e, "Imported knowledge base could not be re-indexed");
                }
            });
        }
    }
    #[cfg(not(feature = "ml"))]
    {
        let _ = (app, state);
        tracing::info!(
            count = result.pending_kb_reindex.len(),
            "Imported knowledge base(s) left unindexed — this build has no embedder (ml feature off)"
        );
    }
}

/// Kick the background vector backfill for memory an import just landed.
///
/// A bundle carries Athena's text and never her vectors — the exporting
/// machine's embedding model is not necessarily this one's, and a vector
/// recorded under the wrong model is worse than no vector at all (the recall
/// model guard drops it). So the imported nodes arrive searchable by recency
/// and importance but not by meaning until this runs.
///
/// Fire-and-forget, same posture as `spawn_pending_kb_reindex`: the counts are
/// already reported to the user as `reembed_queued`, and a build without the
/// `ml` feature reports `available: false` instead of failing.
pub(crate) fn spawn_pending_reembed(
    state: &State<'_, Arc<AppState>>,
    result: &PortabilityImportResult,
) {
    if result.reembed_queued == 0 {
        return;
    }
    let state = state.inner().clone();
    let queued = result.reembed_queued;
    tauri::async_runtime::spawn(async move {
        match crate::commands::companion::brain::reembed_missing_internal(&state).await {
            Ok(r) if !r.available => tracing::info!(
                queued,
                "Imported Athena memory left unvectored — this build has no embedder (ml feature off)"
            ),
            Ok(r) => tracing::info!(
                queued,
                embedded = r.embedded,
                skipped = r.skipped,
                "Imported Athena memory re-embedded"
            ),
            Err(e) => {
                tracing::warn!(queued, error = %e, "Imported Athena memory could not be re-embedded")
            }
        }
    });
}

/// Bundle generations this build reads: 2 is the plain portability format,
/// 3 adds the sealed sections. Anything above the last was written by a newer
/// Personas.
const READABLE_FORMAT_VERSIONS: [u64; 2] = [2, 3];

/// Refuse a bundle by its declared generation, naming the three cases a reader
/// can hit apart: no stamp, a newer generation, an older one this build no
/// longer reads. Runs over the untyped value so the refusal never depends on
/// which fields a generation it cannot read happens to carry.
pub(crate) fn check_bundle_generation(raw: &serde_json::Value) -> Result<(), AppError> {
    let Some(version) = raw
        .get("format_version")
        .and_then(serde_json::Value::as_u64)
    else {
        return Err(AppError::Validation(
            "Invalid export file: no format version, so this is not a Personas export bundle"
                .into(),
        ));
    };
    if READABLE_FORMAT_VERSIONS.contains(&version) {
        return Ok(());
    }
    let newest = READABLE_FORMAT_VERSIONS[READABLE_FORMAT_VERSIONS.len() - 1];
    if version > newest {
        return Err(AppError::Validation(format!(
            "This bundle was written by a newer version of Personas (format version \
             {version}); this build reads format versions 2 and 3. Update Personas to \
             import it."
        )));
    }
    Err(AppError::Validation(format!(
        "Unsupported format version: {version} (this build reads 2 and 3)"
    )))
}

/// Shared body of [`import_portability_bundle`] and its debug from-path twin:
/// read + parse + version-gate + validate the bundle at `path`, run the DB
/// import (with optional conflict resolutions), then apply embedded encrypted
/// credentials. Keeping the two commands on one code path is what keeps them
/// in lockstep.
pub(crate) fn run_bundle_import(
    pool: &DbPool,
    user_db: Option<&UserDbPool>,
    path: &std::path::Path,
    passphrase: Option<&str>,
    resolutions_json: Option<&str>,
) -> Result<PortabilityImportResult, AppError> {
    let content = if path.extension().is_some_and(|ext| ext == "zip") {
        read_zip_bundle(path)?
    } else {
        std::fs::read_to_string(path)
            .map_err(|e| AppError::Internal(format!("Failed to read file: {e}")))?
    };

    // Gate on the generation BEFORE the typed parse. A newer generation is by
    // contract a shape change, so parsing first turns "written by a newer
    // Personas" into whichever "missing field" the new shape trips first.
    let raw: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| AppError::Validation(format!("Invalid export file: {e}")))?;
    check_bundle_generation(&raw)?;
    let mut bundle: PortabilityBundle = serde_json::from_value(raw)
        .map_err(|e| AppError::Validation(format!("Invalid export file: {e}")))?;

    // Decrypt the always-encrypted sections BEFORE validation, so
    // `validate_bundle` sees the real twin / Athena content rather than an
    // opaque blob. A missing or wrong passphrase leaves the sections empty and
    // records why, matching how embedded credentials already behave: an import
    // the user can only half-complete still completes the half it can.
    let mut unseal_warnings = Vec::new();
    unseal_sensitive_sections(&mut bundle, passphrase, &mut unseal_warnings);

    validate_bundle(&bundle)?;

    let resolutions: HashMap<String, String> = resolutions_json
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    let is_resolution_pass = !resolutions.is_empty();

    let mut result = import_bundle(pool, user_db, &bundle, &resolutions)?;
    if !is_resolution_pass {
        result.warnings.extend(unseal_warnings);
    }

    // Returned conflicts need the file path back so the frontend can re-invoke
    // the resolution pass against the same bundle without a second dialog.
    if !result.import_conflicts.is_empty() {
        result.bundle_file_path = Some(path.to_string_lossy().to_string());
    }

    // Encrypted credentials apply on the first pass only — the resolution pass
    // re-reads the same bundle, and the shells were already populated.
    if !is_resolution_pass {
        if let (Some(envelope), Some(pp)) = (&bundle.encrypted_credentials, passphrase) {
            if !pp.is_empty() {
                match apply_encrypted_credentials(pool, envelope, pp, &bundle.credentials) {
                    Ok((count, unmatched)) => {
                        if count > 0 {
                            result.warnings.push(format!(
                                "{} credential secret(s) decrypted and applied",
                                count
                            ));
                        }
                        if !unmatched.is_empty() {
                            result.warnings.push(format!(
                                "{} credential secret(s) had no matching imported shell and were not applied: {}",
                                unmatched.len(),
                                unmatched.join(", ")
                            ));
                        }
                    }
                    Err(e) => {
                        result.warnings.push(format!(
                            "Failed to decrypt embedded credentials: {}. Credential shells were still imported without secrets.",
                            e
                        ));
                    }
                }
            }
        }
    }

    Ok(result)
}
