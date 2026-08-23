//! Passphrase handling and the encrypt/decrypt of the sensitive
//! sections (credentials, twins, Athena).
//!
//! Extracted verbatim from the former single-file `data_portability.rs`.

use super::*;

/// The minimum passphrase length every encrypted section in this module
/// agrees on. Below it, a passphrase counts as absent.
pub(crate) const MIN_PASSPHRASE_LEN: usize = 8;

pub(crate) fn usable_passphrase(passphrase: Option<&str>) -> Option<&str> {
    passphrase.filter(|p| p.len() >= MIN_PASSPHRASE_LEN)
}

/// Refuse an export that ASKED for twins or Athena but supplied no passphrase.
///
/// The distinction against the Full-scope path matters: a full export that
/// quietly leaves them out is the same trade this command already makes for
/// credential secrets, and it is recorded in `export_warnings`. But a user who
/// ticked "Athena — learned" and got a file without it has been lied to, and
/// nothing in a `-> Result<bool>` would ever tell them. So that case fails.
///
/// The frontend gates this too (`passphraseMissing` in `useExportPicker`), but
/// the frontend is not the boundary — anything that can invoke can skip it.
pub(crate) fn require_passphrase_for_selection(
    twin_ids: &[String],
    athena_tiers: &[String],
    passphrase: Option<&str>,
) -> Result<(), AppError> {
    // Parse unconditionally: a typo'd tier must fail the same way whether or
    // not a passphrase was supplied, and it must not be masked by (or mask)
    // the passphrase error.
    let tiers = AthenaTiers::parse(athena_tiers)?;
    if passphrase.is_some() {
        return Ok(());
    }
    if twin_ids.is_empty() && !tiers.any() {
        return Ok(());
    }
    let mut what = Vec::new();
    if !twin_ids.is_empty() {
        what.push("digital twins");
    }
    if tiers.any() {
        what.push("Athena's memory");
    }
    Err(AppError::Validation(format!(
        "This export includes {}, which always travel encrypted. Enter a passphrase of at least {MIN_PASSPHRASE_LEN} characters, or deselect them.",
        what.join(" and ")
    )))
}

// ============================================================================
// Unified credential encryption helpers (shared by export_full / export_selective)
// ============================================================================

/// Format marker for the `encrypted_twins` envelope.
pub(crate) const TWINS_EXPORT_FORMAT: &str = "personas_twins_v1";
/// Format marker for the `encrypted_athena` envelope.
pub(crate) const ATHENA_EXPORT_FORMAT: &str = "personas_athena_v1";

/// Encrypt any serializable section into a `CredentialExportEnvelope`.
///
/// Same AES-256-GCM + PBKDF2-HMAC-SHA256 machinery the credential envelope has
/// shipped with — this is a factoring-out, not new cryptography. Each call
/// draws a fresh salt and nonce, so two sections sealed with the same
/// passphrase share no key material and either can be decrypted alone. The
/// `format` marker is what makes a section pasted into the wrong slot fail
/// loudly instead of decrypting into a confusing serde error.
pub(crate) fn encrypt_section<T: Serialize>(
    value: &T,
    passphrase: &str,
    format: &str,
) -> Result<CredentialExportEnvelope, AppError> {
    let plaintext = serde_json::to_vec(value)
        .map_err(|e| AppError::Internal(format!("Serialization failed: {e}")))?;

    use aes_gcm::aead::rand_core::RngCore;
    let mut salt = [0u8; 16];
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce_bytes);

    let key = derive_key(passphrase, &salt);
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| AppError::Internal(format!("Cipher init failed: {e}")))?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_ref())
        .map_err(|e| AppError::Internal(format!("Encryption failed: {e}")))?;

    Ok(CredentialExportEnvelope {
        format: format.into(),
        salt: B64.encode(salt),
        nonce: B64.encode(nonce_bytes),
        ciphertext: B64.encode(ciphertext),
    })
}

/// Inverse of [`encrypt_section`]. A wrong passphrase surfaces as a decryption
/// failure, never as a partial read.
pub(crate) fn decrypt_section<T: serde::de::DeserializeOwned>(
    envelope: &CredentialExportEnvelope,
    passphrase: &str,
    format: &str,
) -> Result<T, AppError> {
    if envelope.format != format {
        return Err(AppError::Validation(format!(
            "Unexpected encrypted section format: {} (expected {format})",
            envelope.format
        )));
    }
    let salt = B64
        .decode(&envelope.salt)
        .map_err(|e| AppError::Validation(format!("Invalid salt: {e}")))?;
    let nonce_bytes = B64
        .decode(&envelope.nonce)
        .map_err(|e| AppError::Validation(format!("Invalid nonce: {e}")))?;
    let ciphertext = B64
        .decode(&envelope.ciphertext)
        .map_err(|e| AppError::Validation(format!("Invalid ciphertext: {e}")))?;

    let key = derive_key(passphrase, &salt);
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| AppError::Internal(format!("Cipher init failed: {e}")))?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| AppError::Validation("Wrong passphrase or corrupted data".into()))?;

    serde_json::from_slice(&plaintext)
        .map_err(|e| AppError::Validation(format!("Decrypted section is not valid JSON: {e}")))
}

/// Move `twins` and `athena` into their encrypted envelopes, leaving the
/// plaintext fields empty.
///
/// Wave-1 decision: **both sections always travel encrypted.** A twin is a
/// model of a real person's voice and Athena's `identity.md` is a dossier on
/// the operator; a zip that anyone can open is the wrong container for either.
/// The passphrase is the same one that seals credential secrets, so the user
/// types it once.
///
/// By the time this runs a passphrase-less export has already declined to
/// collect the sections (see `SensitiveSections`), so the error branch is a
/// backstop against a future caller that forgets — cheaper than discovering the
/// omission in a shipped plaintext bundle.
pub(crate) fn seal_sensitive_sections(
    bundle: &mut PortabilityBundle,
    passphrase: Option<&str>,
) -> Result<(), AppError> {
    let has_twins = !bundle.twins.is_empty();
    let has_athena = bundle.athena.as_ref().is_some_and(|a| !a.is_empty());
    if !has_twins && !has_athena {
        return Ok(());
    }
    let Some(pp) = usable_passphrase(passphrase) else {
        return Err(AppError::Validation(format!(
            "Digital twins and Athena's memory travel encrypted only. Enter a passphrase of at least {MIN_PASSPHRASE_LEN} characters."
        )));
    };

    if has_twins {
        bundle.encrypted_twins = Some(encrypt_section(&bundle.twins, pp, TWINS_EXPORT_FORMAT)?);
        bundle.twins = Vec::new();
    }
    if has_athena {
        bundle.encrypted_athena = Some(encrypt_section(&bundle.athena, pp, ATHENA_EXPORT_FORMAT)?);
        bundle.athena = None;
    }
    // Same rule the credential envelope already established: an encrypted
    // payload means format 3.
    bundle.format_version = 3;
    Ok(())
}

/// Inverse of [`seal_sensitive_sections`], run before validation so the rest of
/// the importer never has to know the sections were ever encrypted.
///
/// A missing or wrong passphrase is a WARNING, not a failure. That follows the
/// shipped credential behaviour, and the alternative is worse: refusing the
/// whole file would mean a user who wants the personas out of a bundle cannot
/// have them because they lost the passphrase for a twin they did not want.
pub(crate) fn unseal_sensitive_sections(
    bundle: &mut PortabilityBundle,
    passphrase: Option<&str>,
    warnings: &mut Vec<String>,
) {
    let pp = passphrase.filter(|p| !p.is_empty());

    // Each section is decrypted into a local first so the immutable borrow of
    // the envelope ends before the plaintext field is assigned.
    let twins = match (bundle.encrypted_twins.as_ref(), pp) {
        (None, _) => None,
        (Some(_), None) => {
            warnings.push(
                "This bundle contains encrypted digital twins. No passphrase was given, so they were not imported."
                    .into(),
            );
            None
        }
        (Some(env), Some(pp)) => {
            match decrypt_section::<Vec<TwinExport>>(env, pp, TWINS_EXPORT_FORMAT) {
                Ok(twins) => Some(twins),
                Err(e) => {
                    warnings.push(format!(
                        "Encrypted digital twins could not be decrypted ({e}); they were not imported."
                    ));
                    None
                }
            }
        }
    };
    if let Some(twins) = twins {
        bundle.twins = twins;
    }

    let athena = match (bundle.encrypted_athena.as_ref(), pp) {
        (None, _) => None,
        (Some(_), None) => {
            warnings.push(
                "This bundle contains Athena's encrypted memory. No passphrase was given, so it was not imported."
                    .into(),
            );
            None
        }
        (Some(env), Some(pp)) => {
            match decrypt_section::<AthenaMemoryExport>(env, pp, ATHENA_EXPORT_FORMAT) {
                Ok(athena) => Some(athena),
                Err(e) => {
                    warnings.push(format!(
                        "Athena's encrypted memory could not be decrypted ({e}); it was not imported."
                    ));
                    None
                }
            }
        }
    };
    if athena.is_some() {
        bundle.athena = athena;
    }
}

/// Build an encrypted `CredentialExportEnvelope` for embedding in a portability bundle.
/// When `filter_ids` is Some, only credentials matching those IDs are included.
/// When None, all credentials are included.
pub(crate) fn build_encrypted_credentials(
    pool: &DbPool,
    passphrase: &str,
    filter_ids: Option<&Vec<String>>,
) -> Result<CredentialExportEnvelope, AppError> {
    let all_creds = cred_repo::get_all(pool)?;

    let mut entries = Vec::new();
    for cred in &all_creds {
        if let Some(ids) = filter_ids {
            if !ids.contains(&cred.id) {
                continue;
            }
        }

        let fields = cred_repo::get_decrypted_fields(pool, cred).unwrap_or_default();
        if let Err(e) = audit_log::log_decrypt(
            pool,
            &cred.id,
            &cred.name,
            "data_portability:unified_export",
            None,
            None,
        ) {
            tracing::warn!(
                credential_id = %cred.id,
                error = %e,
                "Failed to write audit log for credential decrypt"
            );
        }
        entries.push(CredentialExportEntry {
            name: cred.name.clone(),
            service_type: cred.service_type.clone(),
            metadata: cred.metadata.clone(),
            fields,
        });
    }

    let bundle = CredentialExportBundle {
        format_version: 1,
        exported_at: chrono::Utc::now().to_rfc3339(),
        credentials: entries,
    };

    encrypt_section(&bundle, passphrase, CREDENTIAL_EXPORT_FORMAT)
}

/// Decrypt embedded credentials from a portability bundle and write the fields
/// to the matching imported credential shells.
/// Returns `(applied, unmatched_names)` — the count of credentials whose
/// secrets were successfully applied, and the names of any entries that had
/// no matching imported shell (e.g. Phase 3 skipped creating one because a
/// same-name credential already existed) so the caller can surface an
/// explicit warning instead of the failure being invisible.
pub(crate) fn apply_encrypted_credentials(
    pool: &DbPool,
    envelope: &CredentialExportEnvelope,
    passphrase: &str,
    _credential_metas: &[CredentialMetaExport],
) -> Result<(u32, Vec<String>), AppError> {
    if envelope.format != CREDENTIAL_EXPORT_FORMAT {
        return Err(AppError::Validation(format!(
            "Unsupported embedded credential format: {} (expected {})",
            envelope.format, CREDENTIAL_EXPORT_FORMAT
        )));
    }

    let salt = B64
        .decode(&envelope.salt)
        .map_err(|e| AppError::Validation(format!("Invalid salt: {e}")))?;
    let nonce_bytes = B64
        .decode(&envelope.nonce)
        .map_err(|e| AppError::Validation(format!("Invalid nonce: {e}")))?;
    let ciphertext = B64
        .decode(&envelope.ciphertext)
        .map_err(|e| AppError::Validation(format!("Invalid ciphertext: {e}")))?;

    let key = derive_key(passphrase, &salt);
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| AppError::Internal(format!("Cipher init failed: {e}")))?;
    let nonce = Nonce::from_slice(&nonce_bytes);

    let plaintext = cipher.decrypt(nonce, ciphertext.as_ref()).map_err(|_| {
        AppError::Validation("Decryption failed -- wrong passphrase or corrupted data".into())
    })?;

    let cred_bundle: CredentialExportBundle = serde_json::from_slice(&plaintext)
        .map_err(|e| AppError::Validation(format!("Invalid inner credential data: {e}")))?;

    // Find matching imported credential shells by name + service_type
    // The import_bundle creates credentials with " (imported)" suffix
    let existing = cred_repo::get_all(pool).unwrap_or_default();

    let mut applied = 0u32;
    let mut unmatched: Vec<String> = Vec::new();
    let mut conn = pool.get()?;
    let tx = conn.transaction().map_err(AppError::Database)?;

    for entry in &cred_bundle.credentials {
        // The imported credential shell has name "{name} (imported)" and same service_type
        let imported_name = format!("{} (imported)", entry.name);
        let matching_cred = existing
            .iter()
            .find(|c| c.name == imported_name && c.service_type == entry.service_type);

        let Some(cred) = matching_cred else {
            unmatched.push(entry.name.clone());
            continue;
        };

        // Derive field sensitivity from connector schema
        let sens_map = cred_repo::sensitivity_map_for_connector(pool, &entry.service_type);

        for (key, value) in &entry.fields {
            let is_sensitive = cred_repo::is_field_sensitive(sens_map.as_ref(), key);
            let (enc_val, field_iv) = crypto::encrypt_field(value, is_sensitive)
                .map_err(|e| AppError::Internal(format!("Field encryption failed: {}", e)))?;

            let field_type = classify_field_type(key);
            let field_id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().to_rfc3339();

            // Insert or replace (the shell may have empty fields from import_bundle)
            tx.execute(
                "INSERT OR REPLACE INTO credential_fields
                 (id, credential_id, field_key, encrypted_value, iv, field_type, is_sensitive, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
                rusqlite::params![
                    field_id,
                    cred.id,
                    key,
                    enc_val,
                    field_iv,
                    field_type,
                    is_sensitive as i32,
                    now,
                ],
            )?;
        }

        applied += 1;
    }

    tx.commit().map_err(AppError::Database)?;
    Ok((applied, unmatched))
}
