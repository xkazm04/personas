//! Signed bundle (.persona) export/import for the Invisible Apps P2P layer.
//!
//! A `.persona` bundle is a ZIP archive containing:
//! - `manifest.json`  — what's included, exposure settings, owner identity
//! - `signature.json`  — Ed25519 signature over manifest + content hash
//! - `persona.json`   — persona definition (filtered by fields_exposed)
//! - `metadata.json`  — bundle metadata (app version, timestamps)
//!
//! The bundle is deterministically ordered so that the content hash is
//! reproducible.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};

use crate::db::models::{CreateProvenanceInput, ExposedResource};
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::resources::exposure as exposure_repo;
use crate::db::DbPool;
use crate::engine::identity;
use crate::error::AppError;

// ── Bundle types ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleManifest {
    pub format_version: u32,
    pub owner_peer_id: String,
    pub owner_display_name: String,
    pub created_at: String,
    pub resources: Vec<BundleResourceEntry>,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleResourceEntry {
    pub resource_type: String,
    pub resource_id: String,
    pub display_name: String,
    pub access_level: String,
    pub fields_exposed: Vec<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleSignature {
    pub signer_peer_id: String,
    pub signer_public_key_b64: String,
    pub signature_b64: String,
    pub algorithm: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleMetadata {
    pub app_version: String,
    pub app_name: String,
    pub created_at: String,
    pub bundle_format: String,
}

// ── Public types for commands ───────────────────────────────────────────

use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BundleExportResult {
    pub bundle_hash: String,
    pub resource_count: u32,
    pub byte_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BundleImportPreview {
    pub preview_id: String,
    pub signer_peer_id: String,
    pub signer_display_name: String,
    pub signature_valid: bool,
    pub signer_trusted: bool,
    pub resources: Vec<BundleResourcePreview>,
    pub bundle_hash: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BundleResourcePreview {
    pub resource_type: String,
    pub resource_id: String,
    pub display_name: String,
    pub access_level: String,
    pub tags: Vec<String>,
    pub conflict: bool,
    pub conflict_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BundleImportOptions {
    pub skip_conflicts: bool,
    pub rename_prefix: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BundleImportResult {
    pub imported: u32,
    pub skipped: u32,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BundleVerification {
    pub signature_valid: bool,
    pub signer_peer_id: String,
    pub signer_display_name: String,
    pub signer_trusted: bool,
    pub resource_count: u32,
    pub bundle_hash: String,
    pub created_at: String,
}

// ── Export ───────────────────────────────────────────────────────────────

/// Export selected exposed resources into a signed .persona bundle.
pub fn export_bundle(
    pool: &DbPool,
    resource_ids: &[String],
) -> Result<(Vec<u8>, BundleExportResult), AppError> {
    let local_identity = identity::get_or_create_identity(pool)?;

    // Gather resources
    let mut entries = Vec::new();
    let mut persona_data: Vec<(String, serde_json::Value)> = Vec::new();

    for id in resource_ids {
        let resource = exposure_repo::get_exposed_resource(pool, id)?;
        let fields: Vec<String> = serde_json::from_str(&resource.fields_exposed)?;
        let tags: Vec<String> = serde_json::from_str(&resource.tags)?;

        entries.push(BundleResourceEntry {
            resource_type: resource.resource_type.clone(),
            resource_id: resource.resource_id.clone(),
            display_name: resource.display_name.clone(),
            access_level: resource.access_level.clone(),
            fields_exposed: fields,
            tags,
        });

        // Load the actual resource data and filter fields
        if resource.resource_type == "persona" {
            match persona_repo::get_by_id(pool, &resource.resource_id) {
                Ok(persona) => {
                    let mut value = serde_json::to_value(&persona)?;
                    filter_fields(&mut value, &resource);
                    persona_data.push((resource.resource_id.clone(), value));
                }
                Err(e) => {
                    tracing::warn!(resource_id = %resource.resource_id, "Skipping persona export: {}", e);
                }
            }
        }
    }

    // Build content to hash (deterministic: sorted JSON)
    let mut content_parts: Vec<String> = Vec::new();
    for (id, data) in &persona_data {
        content_parts.push(format!("{}:{}", id, serde_json::to_string(data)?));
    }
    content_parts.sort();
    let content_blob = content_parts.join("\n");
    let content_hash = hex::encode(Sha256::digest(content_blob.as_bytes()));

    let now = chrono::Utc::now().to_rfc3339();

    let manifest = BundleManifest {
        format_version: 1,
        owner_peer_id: local_identity.peer_id.clone(),
        owner_display_name: local_identity.display_name.clone(),
        created_at: now.clone(),
        resources: entries,
        content_hash: content_hash.clone(),
    };

    // Sign the manifest
    let manifest_json = serde_json::to_string_pretty(&manifest)?;
    let signature_b64 = identity::sign_message(manifest_json.as_bytes())?;

    let sig = BundleSignature {
        signer_peer_id: local_identity.peer_id.clone(),
        signer_public_key_b64: local_identity.public_key_b64.clone(),
        signature_b64,
        algorithm: "Ed25519".into(),
    };

    let metadata = BundleMetadata {
        app_version: env!("CARGO_PKG_VERSION").into(),
        app_name: "personas-desktop".into(),
        created_at: now,
        bundle_format: "persona-bundle-v1".into(),
    };

    // Build ZIP
    let mut buf = Vec::new();
    {
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        zip.start_file("manifest.json", options)
            .map_err(|e| AppError::Internal(format!("ZIP write error: {e}")))?;
        zip.write_all(manifest_json.as_bytes())?;

        zip.start_file("signature.json", options)
            .map_err(|e| AppError::Internal(format!("ZIP write error: {e}")))?;
        zip.write_all(serde_json::to_string_pretty(&sig)?.as_bytes())?;

        zip.start_file("metadata.json", options)
            .map_err(|e| AppError::Internal(format!("ZIP write error: {e}")))?;
        zip.write_all(serde_json::to_string_pretty(&metadata)?.as_bytes())?;

        // Write persona data files
        for (id, data) in &persona_data {
            let filename = format!("personas/{}.json", id);
            zip.start_file(filename, options)
                .map_err(|e| AppError::Internal(format!("ZIP write error: {e}")))?;
            zip.write_all(serde_json::to_string_pretty(data)?.as_bytes())?;
        }

        zip.finish()
            .map_err(|e| AppError::Internal(format!("ZIP finalize error: {e}")))?;
    }

    let bundle_hash = hex::encode(Sha256::digest(&buf));
    let result = BundleExportResult {
        bundle_hash,
        resource_count: resource_ids.len() as u32,
        byte_size: buf.len() as u64,
    };

    Ok((buf, result))
}

// ── Import Preview ──────────────────────────────────────────────────────

/// Preview a .persona bundle without importing anything.
pub fn preview_bundle(
    pool: &DbPool,
    bundle_bytes: &[u8],
) -> Result<BundleImportPreview, AppError> {
    let bundle_hash = hex::encode(Sha256::digest(bundle_bytes));
    let (manifest, sig) = parse_bundle(bundle_bytes)?;

    // Verify signature
    let sig_valid = identity::verify_signature(
        &sig.signer_public_key_b64,
        serde_json::to_string(&manifest)?.as_bytes(),
        &sig.signature_b64,
    )
    .unwrap_or(false);

    // Check if signer is trusted
    let signer_trusted = crate::db::repos::resources::identity::get_trusted_peer(
        pool,
        &sig.signer_peer_id,
    )
    .map(|p| p.trust_level != "revoked")
    .unwrap_or(false);

    // Check for conflicts
    let mut resources = Vec::new();
    for entry in &manifest.resources {
        let (conflict, conflict_name) = if entry.resource_type == "persona" {
            match persona_repo::get_by_id(pool, &entry.resource_id) {
                Ok(p) => (true, Some(p.name)),
                Err(_) => (false, None),
            }
        } else {
            (false, None)
        };

        resources.push(BundleResourcePreview {
            resource_type: entry.resource_type.clone(),
            resource_id: entry.resource_id.clone(),
            display_name: entry.display_name.clone(),
            access_level: entry.access_level.clone(),
            tags: entry.tags.clone(),
            conflict,
            conflict_name,
        });
    }

    Ok(BundleImportPreview {
        preview_id: uuid::Uuid::new_v4().to_string(),
        signer_peer_id: sig.signer_peer_id,
        signer_display_name: manifest.owner_display_name,
        signature_valid: sig_valid,
        signer_trusted,
        resources,
        bundle_hash,
        created_at: manifest.created_at,
    })
}

// ── Import Apply ────────────────────────────────────────────────────────

/// Import personas from a .persona bundle into the local database.
pub fn apply_import(
    pool: &DbPool,
    bundle_bytes: &[u8],
    options: BundleImportOptions,
) -> Result<BundleImportResult, AppError> {
    let bundle_hash = hex::encode(Sha256::digest(bundle_bytes));
    let (manifest, sig) = parse_bundle(bundle_bytes)?;
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bundle_bytes))
        .map_err(|e| AppError::Validation(format!("Invalid bundle ZIP: {e}")))?;

    let mut imported = 0u32;
    let mut skipped = 0u32;
    let mut errors = Vec::new();

    for entry in &manifest.resources {
        if entry.resource_type == "persona" {
            let filename = format!("personas/{}.json", entry.resource_id);
            let persona_json = match read_zip_entry(&mut archive, &filename) {
                Ok(data) => data,
                Err(e) => {
                    errors.push(format!("Failed to read {}: {}", filename, e));
                    continue;
                }
            };

            // Check for name conflicts with existing personas
            let mut persona_value: serde_json::Value =
                serde_json::from_str(&persona_json)?;

            // Check if a persona with this exact name already exists
            let original_name = persona_value
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("Imported Persona")
                .to_string();
            let name_exists = persona_repo::get_all(pool)
                .map(|ps| ps.iter().any(|p| p.name == original_name))
                .unwrap_or(false);

            if name_exists {
                if options.skip_conflicts {
                    skipped += 1;
                    continue;
                }
                // Rename to avoid confusion
                if let Some(obj) = persona_value.as_object_mut() {
                    let prefix = options.rename_prefix.as_deref().unwrap_or("Imported");
                    obj.insert(
                        "name".into(),
                        serde_json::Value::String(format!("[{}] {}", prefix, original_name)),
                    );
                }
            }

            match import_persona_from_value(pool, &persona_value) {
                Ok(new_id) => {
                    record_provenance(pool, "persona", &new_id, &sig, &bundle_hash);
                    imported += 1;
                }
                Err(e) => errors.push(format!("Import {}: {}", entry.display_name, e)),
            }
        }
    }

    Ok(BundleImportResult {
        imported,
        skipped,
        errors,
    })
}

// ── Verify Only ─────────────────────────────────────────────────────────

/// Verify a bundle's signature and integrity without importing.
pub fn verify_bundle(
    pool: &DbPool,
    bundle_bytes: &[u8],
) -> Result<BundleVerification, AppError> {
    let bundle_hash = hex::encode(Sha256::digest(bundle_bytes));
    let (manifest, sig) = parse_bundle(bundle_bytes)?;

    let sig_valid = identity::verify_signature(
        &sig.signer_public_key_b64,
        serde_json::to_string(&manifest)?.as_bytes(),
        &sig.signature_b64,
    )
    .unwrap_or(false);

    let signer_trusted = crate::db::repos::resources::identity::get_trusted_peer(
        pool,
        &sig.signer_peer_id,
    )
    .map(|p| p.trust_level != "revoked")
    .unwrap_or(false);

    Ok(BundleVerification {
        signature_valid: sig_valid,
        signer_peer_id: sig.signer_peer_id,
        signer_display_name: manifest.owner_display_name,
        signer_trusted,
        resource_count: manifest.resources.len() as u32,
        bundle_hash,
        created_at: manifest.created_at,
    })
}

// ── Internal helpers ────────────────────────────────────────────────────

fn parse_bundle(
    bundle_bytes: &[u8],
) -> Result<(BundleManifest, BundleSignature), AppError> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bundle_bytes))
        .map_err(|e| AppError::Validation(format!("Invalid bundle ZIP: {e}")))?;

    let manifest_json = read_zip_entry(&mut archive, "manifest.json")?;
    let manifest: BundleManifest = serde_json::from_str(&manifest_json)
        .map_err(|e| AppError::Validation(format!("Invalid manifest.json: {e}")))?;

    let sig_json = read_zip_entry(&mut archive, "signature.json")?;
    let sig: BundleSignature = serde_json::from_str(&sig_json)
        .map_err(|e| AppError::Validation(format!("Invalid signature.json: {e}")))?;

    Ok((manifest, sig))
}

fn read_zip_entry<R: Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
    name: &str,
) -> Result<String, AppError> {
    let mut file = archive
        .by_name(name)
        .map_err(|e| AppError::Validation(format!("Missing {name} in bundle: {e}")))?;
    let mut content = String::new();
    file.read_to_string(&mut content)?;
    Ok(content)
}

fn filter_fields(value: &mut serde_json::Value, resource: &ExposedResource) {
    let fields: Vec<String> = serde_json::from_str(&resource.fields_exposed).unwrap_or_default();
    if fields.is_empty() {
        return; // Empty whitelist = expose all fields
    }

    // Always include id and name for usability
    let mut allowed: std::collections::HashSet<&str> =
        fields.iter().map(|s| s.as_str()).collect();
    allowed.insert("id");
    allowed.insert("name");
    allowed.insert("created_at");
    allowed.insert("updated_at");

    if let Some(obj) = value.as_object_mut() {
        let keys: Vec<String> = obj.keys().cloned().collect();
        for key in keys {
            if !allowed.contains(key.as_str()) {
                obj.remove(&key);
            }
        }
    }
}

/// Import a persona from a JSON value using the standard create path.
/// Returns the newly created persona's ID.
fn import_persona_from_value(
    pool: &DbPool,
    value: &serde_json::Value,
) -> Result<String, AppError> {
    use crate::db::models::CreatePersonaInput;

    let obj = value
        .as_object()
        .ok_or_else(|| AppError::Validation("Persona data must be a JSON object".into()))?;

    let name = obj
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Imported Persona")
        .to_string();
    let system_prompt = obj
        .get("system_prompt")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let description = obj
        .get("description")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let input = CreatePersonaInput {
        name,
        description,
        system_prompt,
        structured_prompt: obj.get("structured_prompt").and_then(|v| v.as_str()).map(|s| s.to_string()),
        icon: obj.get("icon").and_then(|v| v.as_str()).map(|s| s.to_string()),
        color: obj.get("color").and_then(|v| v.as_str()).map(|s| s.to_string()),
        model_profile: obj.get("model_profile").and_then(|v| v.as_str()).map(|s| s.to_string()),
        max_budget_usd: obj.get("max_budget_usd").and_then(|v| v.as_f64()),
        max_turns: obj.get("max_turns").and_then(|v| v.as_i64()).map(|n| n as i32),
        group_id: None,
        project_id: None,
        enabled: Some(true),
        max_concurrent: None,
        timeout_ms: None,
        design_context: obj.get("design_context").and_then(|v| v.as_str()).map(|s| s.to_string()),
        notification_channels: None,
    };

    let persona = persona_repo::create(pool, input)?;
    Ok(persona.id)
}

fn record_provenance(
    pool: &DbPool,
    resource_type: &str,
    resource_id: &str,
    sig: &BundleSignature,
    bundle_hash: &str,
) {
    let input = CreateProvenanceInput {
        resource_type: resource_type.into(),
        resource_id: resource_id.into(),
        source_peer_id: sig.signer_peer_id.clone(),
        source_display_name: None,
        bundle_hash: Some(bundle_hash.into()),
        signature_verified: true,
    };
    if let Err(e) = exposure_repo::upsert_provenance(pool, input) {
        tracing::warn!("Failed to record provenance for {}/{}: {}", resource_type, resource_id, e);
    }
}
